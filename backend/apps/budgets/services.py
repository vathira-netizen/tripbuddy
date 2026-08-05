"""Pure budget math.

No Django ORM access below this docstring — every function takes plain data
(an iterable of BudgetItem-like objects exposing ``.category``, ``.amount``,
and ``.payer_id``, plus a couple of scalars) and returns plain data. That
makes each one a one-line unit test away from a regression, and it's the
`apps.trips` budget-summary view's job to bridge a real queryset in.
"""

from decimal import Decimal

from apps.budgets.models import BudgetItem

TWO_PLACES = Decimal("0.01")


def _round(value):
    return value.quantize(TWO_PLACES)


def category_totals(items):
    """{category: total}, zero-filled for every category.

    Zero-filling means a chart never has to special-case "no spend yet" for
    a category — every key from BudgetItem.Category is always present.
    """
    totals = {category: Decimal("0") for category in BudgetItem.Category.values}
    for item in items:
        totals[item.category] = totals.get(item.category, Decimal("0")) + item.amount
    return {category: _round(total) for category, total in totals.items()}


def per_day_breakdown(items, nights):
    """total/nights and each category's total/nights.

    Zero (not an error) when nights is 0 — a trip without dates set yet has
    no meaningful daily figure.
    """
    totals = category_totals(items)
    total = sum(totals.values(), Decimal("0"))

    if not nights or nights <= 0:
        zero = Decimal("0.00")
        return {
            "total_per_day": zero,
            "category_per_day": {category: zero for category in totals},
        }

    nights_dec = Decimal(nights)
    return {
        "total_per_day": _round(total / nights_dec),
        "category_per_day": {
            category: _round(amount / nights_dec) for category, amount in totals.items()
        },
    }


def per_person_split(items, members):
    """Equal split of the total across ``members`` (an iterable of user ids),
    plus paid-vs-owed per member wherever ``BudgetItem.payer`` is set.

    ``owed`` is always a member's equal share of the total; ``paid`` is what
    they're on record as having actually paid (0 if they never appear as a
    payer). ``balance`` = paid - owed: positive means they're owed money
    back, negative means they still owe.
    """
    member_ids = list(dict.fromkeys(members))  # de-dupe, keep order
    total = Decimal("0")
    paid_by_member = {member_id: Decimal("0") for member_id in member_ids}

    for item in items:
        total += item.amount
        if item.payer_id in paid_by_member:
            paid_by_member[item.payer_id] += item.amount

    equal_share = _round(total / len(member_ids)) if member_ids else Decimal("0.00")

    per_member = {
        member_id: {
            "paid": _round(paid),
            "owed": equal_share,
            "balance": _round(paid - equal_share),
        }
        for member_id, paid in paid_by_member.items()
    }

    return {
        "total": _round(total),
        "equal_share": equal_share,
        "per_member": per_member,
    }


def running_total_vs_target(items, target):
    """{total, target, remaining, over_budget}.

    ``target`` may be None (trip has no budget set) — ``remaining`` is then
    None too, rather than a nonsense number, and ``over_budget`` is False.
    """
    total = _round(sum((item.amount for item in items), Decimal("0")))

    if target is None:
        return {"total": total, "target": None, "remaining": None, "over_budget": False}

    remaining = _round(target - total)
    return {
        "total": total,
        "target": _round(target),
        "remaining": remaining,
        "over_budget": total > target,
    }
