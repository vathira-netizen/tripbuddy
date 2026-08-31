"use client";

import { useState } from "react";

import { BudgetMember, formatINR, Settlement } from "@/lib/budget";
import { buildUpiPayUrl, qrImageUrl } from "@/lib/upi";

/** Group settle-up: the minimal set of payments that clears every balance. */
export default function SettleUpPanel({
  settlements,
  members,
}: {
  settlements: Settlement[];
  members: Record<string, BudgetMember>;
}) {
  const [open, setOpen] = useState<number | null>(null);

  if (settlements.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-brand-teal">
          Settle up
        </h2>
        <p className="text-sm text-text-subtle">Everyone&apos;s square — nothing to settle.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-xs font-bold uppercase tracking-wide text-brand-teal">Settle up</h2>
      <ul className="space-y-2">
        {settlements.map((s, i) => {
          const from = members[String(s.from_user)];
          const to = members[String(s.to_user)];
          if (!from || !to) return null;
          const isPayer = from.is_me;
          const isPayee = to.is_me;

          return (
            <li key={`${s.from_user}-${s.to_user}`} className="rounded-xl border border-line p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm">
                  <span className="font-semibold">{isPayer ? "You" : from.display_name}</span>{" "}
                  owe{isPayer ? "" : "s"}{" "}
                  <span className="font-semibold">{isPayee ? "you" : to.display_name}</span>{" "}
                  <span className="font-serif text-brand-coral-ink">{formatINR(s.amount)}</span>
                </p>
                {isPayer && (
                  <button
                    type="button"
                    onClick={() => setOpen(open === i ? null : i)}
                    className="shrink-0 rounded-full bg-brand-teal px-4 py-1.5 text-xs font-bold text-background transition hover:brightness-90"
                  >
                    Settle Up
                  </button>
                )}
              </div>

              {isPayer && open === i && (
                <div className="mt-3 flex flex-col items-center gap-2 border-t border-line pt-3 text-center">
                  {to.upi_vpa ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- external QR image service, not a static asset */}
                      <img
                        src={qrImageUrl(
                          buildUpiPayUrl({
                            vpa: to.upi_vpa,
                            payeeName: to.display_name,
                            amount: s.amount,
                          }),
                        )}
                        alt={`UPI QR code to pay ${to.display_name}`}
                        width={180}
                        height={180}
                        className="rounded-lg border border-line"
                      />
                      <a
                        href={buildUpiPayUrl({
                          vpa: to.upi_vpa,
                          payeeName: to.display_name,
                          amount: s.amount,
                        })}
                        className="rounded-full border border-[#d5d9d0] px-4 py-1.5 text-xs font-semibold text-brand-teal transition hover:border-brand-teal"
                      >
                        Open in UPI app
                      </a>
                      <p className="text-[11px] text-text-subtle">
                        Scan with any UPI app, or tap to pay {to.display_name} directly.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-text-subtle">
                      {to.display_name} hasn&apos;t added a UPI ID yet — ask them to add one on
                      their profile so you can pay via UPI.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
