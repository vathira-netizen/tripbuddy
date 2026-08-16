import type { RealtimeChannel } from "@supabase/supabase-js";

import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { Connection } from "@/lib/buddies";

/**
 * Messaging: an HTTP write path and a Realtime read path.
 *
 * Sending and loading history go through Django, which is where the "connection
 * must be accepted" rule lives. New messages arrive over Supabase Realtime,
 * which applies the RLS policy on `messaging_message` per subscriber — so a
 * subscription can only ever deliver rows from the user's own accepted
 * conversations, whatever filter is requested here.
 *
 * Bodies are plain text and are rendered as text. Never pass a message body to
 * `dangerouslySetInnerHTML`: React escapes interpolated strings, and that is
 * the whole XSS defence on this path.
 */

export interface Message {
  id: number;
  connection: number;
  /** The sender's Supabase user id. */
  sender: string;
  sender_name: string;
  /** True when the requesting user sent it. */
  is_mine: boolean;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface MessagePage {
  count: number;
  next: string | null;
  previous: string | null;
  results: Message[];
}

export interface UnreadSummary {
  unread_messages: number;
  pending_requests: number;
  /** connection id (as a string) -> unread count */
  unread_by_connection: Record<string, number>;
}

/** Must match MAX_BODY_LENGTH in backend/apps/messaging/serializers.py. */
export const MAX_BODY_LENGTH = 2000;

/** Most recent page first; within a page, oldest to newest. */
export const listMessages = (connectionId: number, page?: number) =>
  api.get<MessagePage>(
    `/api/connections/${connectionId}/messages/${page ? `?page=${page}` : ""}`,
  );

export const sendMessage = (connectionId: number, body: string) =>
  api.post<Message>(`/api/connections/${connectionId}/messages/`, { body });

export const markConversationRead = (connectionId: number) =>
  api.post<{ marked_read: number }>(
    `/api/connections/${connectionId}/messages/read/`,
    {},
  );

export const getUnreadSummary = () =>
  api.get<UnreadSummary>("/api/messages/summary/");

/** Accepted connections are exactly the conversations that exist. */
export const listConversations = () =>
  api
    .get<{ results: Connection[] }>("/api/connections/?status=accepted")
    .then((p) => p.results);

/**
 * Subscribe to new messages on one conversation.
 *
 * The `filter` narrows what this client asks for; it is not what makes the
 * subscription safe. Postgres RLS decides what Realtime is allowed to send, so
 * a tampered filter still yields nothing the user may not read.
 *
 * Returns an unsubscribe function — call it on unmount, or the channel leaks
 * and duplicate messages appear when the thread is reopened.
 */
export function subscribeToMessages(
  connectionId: number,
  onInsert: (message: Message) => void,
  onStatus?: (status: string) => void,
): () => void {
  const supabase = createClient();

  const channel: RealtimeChannel = supabase
    .channel(`messages:connection:${connectionId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messaging_message",
        filter: `connection_id=eq.${connectionId}`,
      },
      (payload) => {
        // The row arrives as raw table columns, not as the API's shape: it has
        // sender_id (a Django pk) and no display name. The thread reconciles
        // the rest; what matters here is the id, body and timestamp.
        const row = payload.new as {
          id: number;
          connection_id: number;
          body: string;
          read_at: string | null;
          created_at: string;
          sender_id: number;
        };
        onInsert({
          id: row.id,
          connection: row.connection_id,
          sender: "",
          sender_name: "",
          // Realtime cannot tell us this; the thread decides using the ids it
          // already has, and treats an unknown sender as "not mine".
          is_mine: false,
          body: row.body,
          read_at: row.read_at,
          created_at: row.created_at,
        });
      },
    )
    .subscribe((status) => onStatus?.(status));

  return () => {
    void supabase.removeChannel(channel);
  };
}

/** "14:32" for today, otherwise "12 Aug, 14:32". */
export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  return date.toLocaleString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(sameDay ? {} : { day: "numeric", month: "short" }),
  });
}
