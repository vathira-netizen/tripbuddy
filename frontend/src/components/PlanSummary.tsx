import { formatINR } from "@/lib/discover";
import type { AssistantReply } from "@/lib/trips";

/** A server-budget-checked plan from the assistant; red when over budget. */
export default function PlanSummary({ plan }: { plan: NonNullable<AssistantReply["plan"]> }) {
  return (
    <div
      className={`rounded-xl border p-3 text-sm ${
        plan.over_budget ? "border-red-300 bg-red-50 text-red-900" : "border-line bg-[#efece4]"
      }`}
    >
      <p className="font-bold">
        Suggested plan: {formatINR(Number(plan.total))}
        {plan.target != null && ` of ${formatINR(Number(plan.target))}`}
        {plan.over_budget && " — over budget"}
      </p>
      <ol className="mt-1 list-decimal pl-5">
        {plan.days.map((d, di) => (
          <li key={di}>
            {d.items.map((it) => `${it.title} (${formatINR(Number(it.est_cost))})`).join(", ")}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-xs">{plan.disclaimer}</p>
    </div>
  );
}
