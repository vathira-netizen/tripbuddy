import { avatarTint, initials } from "@/lib/buddies";
import { BUDGET_CATEGORIES, BudgetSummary, formatINR } from "@/lib/budget";

/** Green while within the trip's target_amount, red once spend exceeds it. */
export function RunningTotalBar({
  runningTotal,
}: {
  runningTotal: BudgetSummary["running_total"];
}) {
  const total = Number(runningTotal.total);

  if (runningTotal.target == null) {
    return (
      <div className="space-y-1">
        <p className="text-sm">
          Spent so far: <span className="font-semibold">{formatINR(total)}</span>
        </p>
        <p className="text-xs text-black/40 dark:text-white/40">
          Set a target on the trip to track progress against it.
        </p>
      </div>
    );
  }

  const target = Number(runningTotal.target);
  const remaining = Number(runningTotal.remaining);
  const overBudget = runningTotal.over_budget;
  const pct = target > 0 ? Math.min((total / target) * 100, 100) : 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span>
          <span className="font-semibold">{formatINR(total)}</span> of{" "}
          {formatINR(target)}
        </span>
        <span
          className={`font-medium ${overBudget ? "text-red-600" : "text-green-600"}`}
        >
          {overBudget
            ? `${formatINR(Math.abs(remaining))} over`
            : `${formatINR(remaining)} left`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-3 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
      >
        <div
          className={`h-full rounded-full transition-all ${
            overBudget ? "bg-red-500" : "bg-green-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function PerDayPanel({ perDay }: { perDay: BudgetSummary["per_day"] }) {
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-semibold">{formatINR(perDay.total_per_day)}</span> / day
      </p>
      <ul className="space-y-1 text-sm text-black/70 dark:text-white/70">
        {BUDGET_CATEGORIES.map((category) => (
          <li key={category} className="flex justify-between">
            <span>{category}</span>
            <span className="tabular-nums">
              {formatINR(perDay.category_per_day[category])}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PerPersonPanel({
  perPerson,
  members,
}: {
  perPerson: BudgetSummary["per_person"];
  members: BudgetSummary["members"];
}) {
  const entries = Object.entries(perPerson.per_member);

  if (entries.length === 0) {
    return (
      <p className="text-sm text-black/60 dark:text-white/60">
        No trip members yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-black/60 dark:text-white/60">
        Equal share: <span className="font-semibold">{formatINR(perPerson.equal_share)}</span>{" "}
        each
      </p>
      <ul className="space-y-2 text-sm">
        {entries.map(([memberId, split]) => {
          const balance = Number(split.balance);
          const settled = balance === 0;
          const member = members[memberId];
          const name = member?.display_name || `Traveller #${memberId}`;
          return (
            <li key={memberId} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                {member?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small avatar, not worth next/image's overhead here
                  <img
                    src={member.avatar_url}
                    alt=""
                    className="h-6 w-6 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${avatarTint(
                      memberId,
                    )}`}
                  >
                    {initials(name)}
                  </span>
                )}
                <span className="truncate">
                  {name}
                  {member?.is_owner && (
                    <span className="ml-1 text-xs text-black/40 dark:text-white/40">(owner)</span>
                  )}
                </span>
              </span>
              <span
                className={`shrink-0 ${
                  settled
                    ? "text-black/60 dark:text-white/60"
                    : balance > 0
                      ? "text-green-600"
                      : "text-red-600"
                }`}
              >
                {settled
                  ? "settled up"
                  : balance > 0
                    ? `owed ${formatINR(balance)}`
                    : `owes ${formatINR(Math.abs(balance))}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
