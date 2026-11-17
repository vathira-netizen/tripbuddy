"use client";

import { useState } from "react";

// ponytail: a fixed list, no search/skin tones. Swap in emoji-picker-element
// if people ask for the full set.
const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎", "🤩", "🥳",
  "😅", "😉", "🙂", "🤔", "😴", "😭", "😡", "🥺", "😱", "🤗",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "👋", "🤝", "✌️", "👌",
  "❤️", "💙", "💚", "🔥", "✨", "🎉", "💯", "✅", "❌", "⭐",
  "✈️", "🧳", "🏖️", "🏔️", "🏕️", "🌴", "🌅", "🚆", "🚗", "🛵",
  "🍕", "🍜", "🍛", "🍹", "☕", "📸", "🗺️", "📍", "🏨", "💸",
];

/** A button that opens a small emoji grid; calls `onPick` with the chosen emoji. */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Add emoji"
        aria-expanded={open}
        className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full text-lg text-text-subtle transition hover:bg-surface-alt"
      >
        😊
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            aria-label="Emoji"
            className="absolute bottom-11 left-0 z-20 grid w-[280px] grid-cols-10 gap-0.5 rounded-xl border border-line bg-surface p-2 shadow-lg"
          >
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onPick(emoji);
                  setOpen(false);
                }}
                className="grid h-6 w-6 place-items-center rounded text-base hover:bg-surface-alt"
              >
                {emoji}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
