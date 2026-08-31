"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Uploads a trip cover photo straight to the Supabase Storage `trip-covers`
 * bucket from the browser, then PATCHes the resulting public URL onto the
 * trip. Django never touches the file itself — only the URL. Adapted from
 * AvatarUpload; the storage path is keyed by trip id, not user id, matching
 * the RLS policy on that bucket (a trip member may write inside their trip's
 * own folder).
 */
export default function TripCoverUpload({
  tripId,
  coverImageUrl,
  onUploaded,
}: {
  tripId: number;
  coverImageUrl: string;
  onUploaded: (coverImageUrl: string) => void;
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
      const path = `${tripId}/${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("trip-covers")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("trip-covers").getPublicUrl(path);

      await api.patch(`/api/trips/${tripId}/`, { cover_image_url: publicUrl });
      onUploaded(publicUrl);
      toast.success("Trip cover updated");
    } catch {
      toast.error("Couldn't upload that photo. Try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="relative h-40 w-full overflow-hidden rounded-2xl border border-line bg-brand-teal">
      {coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- user-supplied external URL, not a static asset
        <img src={coverImageUrl} alt="" className="h-full w-full object-cover" />
      )}
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="absolute bottom-3 right-3 rounded-full bg-white/90 px-4 py-1.5 text-sm font-semibold text-brand-teal shadow-sm backdrop-blur transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {uploading ? "Uploading…" : coverImageUrl ? "Change cover" : "Add a cover photo"}
      </button>
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
