"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { blockTraveller, initials, monogramAccent, type Connection } from "@/lib/buddies";
import {
  clearConversation,
  listMessages,
  markConversationRead,
  sendMessage,
  subscribeToMessages,
} from "@/lib/messages";
import { ChatPanel, type ChatSource } from "@/components/ChatPanel";
import ReportUserDialog from "@/components/ReportUserDialog";

/** One 1:1 conversation: the shared chat UI plus report/block for the other traveller. */
export function MessageThread({ connection }: { connection: Connection }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const source = useMemo<ChatSource>(
    () => ({
      list: () => listMessages(connection.id).then((p) => p.results),
      send: (body) => sendMessage(connection.id, body),
      markRead: () => markConversationRead(connection.id),
      clear: () => clearConversation(connection.id),
      subscribe: (onInsert, onStatus) =>
        subscribeToMessages(connection.id, onInsert, onStatus),
    }),
    [connection.id],
  );

  const other = connection.other;
  const accent = monogramAccent(other?.supabase_user_id ?? String(connection.id));

  const avatar = (
    <span
      aria-hidden="true"
      className={`grid h-[34px] w-[34px] shrink-0 place-items-center overflow-hidden rounded-full text-xs font-bold ${
        accent === "teal" ? "bg-brand-teal text-background" : "bg-brand-coral text-white"
      }`}
    >
      {other?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- user-supplied external URL
        <img src={other.avatar_url} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(other?.display_name ?? "?")
      )}
    </span>
  );

  const menu = (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Conversation options"
        aria-expanded={menuOpen}
        className="grid h-7 w-7 place-items-center rounded-full text-text-subtle hover:bg-surface-alt hover:text-brand-teal"
      >
        ⋯
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setShowReport(true);
              }}
              className="block w-full px-3.5 py-2 text-left text-xs font-semibold text-text-subtle hover:bg-surface-alt hover:text-brand-teal"
            >
              Report {other?.display_name ?? "traveller"}
            </button>
            <button
              type="button"
              onClick={async () => {
                setMenuOpen(false);
                if (!other) return;
                if (
                  !window.confirm(
                    `Block ${other.display_name}? You won't see each other again.`,
                  )
                ) {
                  return;
                }
                try {
                  await blockTraveller(other.supabase_user_id);
                  toast.success(`Blocked ${other.display_name}`);
                } catch {
                  toast.error("Couldn't block this traveller. Try again.");
                }
              }}
              className="block w-full px-3.5 py-2 text-left text-xs font-semibold text-brand-coral-ink hover:bg-brand-coral-tint"
            >
              Block {other?.display_name ?? "traveller"}
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <ChatPanel
        source={source}
        avatar={avatar}
        title={other?.display_name ?? "Traveller"}
        subtitle={other?.area_label || "Area not set"}
        menu={menu}
      />
      {showReport && other && (
        <ReportUserDialog
          supabaseUserId={other.supabase_user_id}
          displayName={other.display_name}
          onClose={() => setShowReport(false)}
        />
      )}
    </>
  );
}
