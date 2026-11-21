"use client";

import { useState } from "react";

import { avatarTint, initials } from "@/lib/buddies";

/** Profile photo with a monogram fallback when there is none or it fails to load. */
export function Avatar({
  name,
  src,
  seed,
  size = 44,
}: {
  name: string;
  src?: string;
  seed: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const showPhoto = !!src && !failed;
  return (
    <span
      aria-hidden="true"
      // Initials scale with the circle, so a large profile avatar isn't tiny text.
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.34)) }}
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full text-sm font-bold ${
        showPhoto ? "" : avatarTint(seed)
      }`}
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- external portrait URL
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
