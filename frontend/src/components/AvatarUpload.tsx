"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { avatarTint, initials } from "@/lib/buddies";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Uploads a profile photo straight to the Supabase Storage `avatars` bucket
 * from the browser, then PATCHes the resulting public URL onto the profile.
 * Django never touches the file itself — only the URL.
 */
export default function AvatarUpload({
  supabaseUserId,
  displayName,
  avatarUrl,
  onUploaded,
}: {
  supabaseUserId: string;
  displayName: string;
  avatarUrl: string;
  onUploaded: (avatarUrl: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Choose a PNG, JPEG, WEBP or GIF image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("That image is too large — 5 MB max.");
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const extension = file.name.split(".").pop() || "jpg";
      const path = `${supabaseUserId}/${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path);

      await api.patch("/api/profile/me/", { avatar_url: publicUrl });
      onUploaded(publicUrl);
      toast.success("Profile photo updated");
    } catch {
      toast.error("Couldn't upload that photo. Try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <span className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-supplied external URL, not a static asset
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className={`grid h-full w-full place-items-center text-lg font-bold ${avatarTint(
              supabaseUserId,
            )}`}
          >
            {initials(displayName || "?")}
          </span>
        )}
      </span>
      <div>
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="rounded-full border border-line-input px-4 py-1.5 text-sm font-semibold text-brand-teal transition hover:border-brand-teal disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? "Uploading…" : "Change photo"}
        </button>
        <p className="mt-1 text-xs text-text-subtle">PNG, JPEG, WEBP or GIF. Up to 5 MB.</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}
