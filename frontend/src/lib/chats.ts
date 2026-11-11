import { api } from "@/lib/api";
import type { AssistantReply } from "@/lib/trips";

/** A catalogue destination the assistant mentioned (validated server-side). */
export interface ChatPlace {
  id: number;
  slug: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
  image_url: string;
  avg_daily_budget: number;
}

/** What the assistant has pulled out of the conversation so far. */
export interface ChatContext {
  destination?: string;
  days?: number;
  travellers?: number;
  /** Total INR for the group. */
  budget?: number;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  data: {
    places?: ChatPlace[];
    /** Already budget-checked by the server. */
    plan?: AssistantReply["plan"];
    follow_up?: string | null;
  };
  created_at: string;
}

export interface ConversationSummary {
  id: number;
  title: string;
  trip: number | null;
  trip_title: string | null;
  updated_at: string;
}

export interface Conversation extends ConversationSummary {
  context: ChatContext;
  messages: ChatMessage[];
  created_at: string;
}

export const listChats = () =>
  api.get<{ results: ConversationSummary[] }>("/api/chats/").then((p) => p.results);

export const getChat = (id: number) => api.get<Conversation>(`/api/chats/${id}/`);

export const startChat = (message: string, trip?: number) =>
  api.post<Conversation>("/api/chats/", { message, trip: trip ?? null });

export const sendChatMessage = (id: number, message: string) =>
  api.post<Conversation>(`/api/chats/${id}/messages/`, { message });

export const updateChat = (id: number, patch: { title?: string; trip?: number | null }) =>
  api.patch<Conversation>(`/api/chats/${id}/`, patch);

export const deleteChat = (id: number) => api.delete<void>(`/api/chats/${id}/`);

/** User-facing copy for a failed assistant call. */
export function chatErrorMessage(err: unknown): string {
  const status = (err as { status?: number })?.status;
  return status === 503
    ? "The assistant isn't configured on the server yet."
    : "The assistant is unavailable right now. Try again.";
}
