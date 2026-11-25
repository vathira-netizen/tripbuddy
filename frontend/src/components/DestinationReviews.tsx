"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { avatarTint, initials } from "@/lib/buddies";
import { DestinationReview, listReviews, submitReview } from "@/lib/discover";
import { fieldErrors, REVIEW_MAX, reviewSchema } from "@/lib/schemas";

function Star({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path d="M12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2Z" />
    </svg>
  );
}

function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange?: (v: number) => void;
}) {
  return (
    <div className={`flex gap-0.5 text-brand-coral ${onChange ? "" : "pointer-events-none"}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          onClick={() => onChange?.(n)}
          className={onChange ? "cursor-pointer" : ""}
        >
          <Star filled={n <= value} />
        </button>
      ))}
    </div>
  );
}

export default function DestinationReviews({
  destinationId,
  avgRating,
  reviewCount,
}: {
  destinationId: number;
  avgRating: number | null;
  reviewCount: number;
}) {
  const [reviews, setReviews] = useState<DestinationReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listReviews(destinationId)
      .then((rows) => !cancelled && setReviews(rows))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [destinationId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = reviewSchema.safeParse({ rating, body });
    if (!parsed.success) {
      setFormError(Object.values(fieldErrors(parsed.error))[0]);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await submitReview(destinationId, parsed.data.rating, parsed.data.body);
      // Refetch rather than merge client-side: we have no reliable id to
      // dedupe an edit against (author_name isn't guaranteed unique).
      const fresh = await listReviews(destinationId);
      setReviews(fresh);
      setRating(0);
      setBody("");
      toast.success("Thanks for the review!");
    } catch {
      toast.error("Couldn't save your review. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-brand-teal">Reviews</h2>
        {avgRating != null && (
          <span className="flex items-center gap-1 text-xs text-text-subtle">
            <StarRating value={Math.round(avgRating)} />
            {avgRating.toFixed(1)} ({reviewCount})
          </span>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-2 rounded-2xl border border-line bg-surface p-4"
      >
        <p className="text-sm font-medium text-brand-teal">Leave a review</p>
        <StarRating value={rating} onChange={setRating} />
        <textarea
          rows={2}
          value={body}
          maxLength={REVIEW_MAX}
          onChange={(e) => setBody(e.target.value)}
          placeholder="How was it?"
          aria-describedby="review-count"
          className="w-full rounded-xl border border-line-input bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-brand-coral focus:ring-2 focus:ring-brand-coral/30"
        />
        <div className="flex items-center justify-between text-xs text-text-subtle">
          <span role="alert" className="text-[#8c2f1d]">
            {formError}
          </span>
          <span id="review-count">
            {body.length}/{REVIEW_MAX}
          </span>
        </div>
        <button
          type="submit"
          disabled={submitting || rating === 0}
          className="rounded-full bg-brand-coral px-4 py-1.5 text-sm font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Submit review"}
        </button>
      </form>

      {!loading && reviews.length === 0 && (
        <p className="text-sm text-text-subtle">No reviews yet — be the first.</p>
      )}

      <ul className="space-y-3">
        {reviews.map((review) => (
          <li key={review.id} className="flex gap-3 rounded-2xl border border-line bg-surface p-3.5">
            {review.author_avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- user-supplied external URL
              <img
                src={review.author_avatar_url}
                alt=""
                className="h-9 w-9 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold ${avatarTint(
                  review.author_name,
                )}`}
              >
                {initials(review.author_name)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">{review.author_name}</p>
                <StarRating value={review.rating} />
              </div>
              {review.body && <p className="mt-1 text-sm text-text-subtle">{review.body}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
