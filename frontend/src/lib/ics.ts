import type { ItineraryItem, Trip } from "@/lib/trips";

/**
 * Builds an RFC-5545 .ics calendar with one all-day event per day that has
 * itinerary items. Pure string building — no dependency, matching the CSV
 * budget export's zero-dependency Blob-download approach (lib/budget.ts).
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** YYYYMMDD, the DATE form VALUE=DATE wants for an all-day event. */
function toIcsDate(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/** Escapes text per RFC 5545 §3.3.11 — commas, semicolons, backslashes, newlines. */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\n/g, "\\n");
}

/** DTSTAMP wants full UTC date-time, unlike the all-day DTSTART/DTEND below. */
function nowStamp(): string {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export function buildTripIcs(
  trip: Pick<Trip, "id" | "title">,
  items: Pick<ItineraryItem, "day_index" | "title" | "notes">[],
  dayLabels: string[],
  startDate: string | null,
): string {
  const byDay = new Map<number, typeof items>();
  for (const item of items) {
    const list = byDay.get(item.day_index) ?? [];
    list.push(item);
    byDay.set(item.day_index, list);
  }

  const stamp = nowStamp();
  const events: string[] = [];

  const dayCount = Math.max(dayLabels.length, byDay.size, 1);
  const start = startDate ? new Date(`${startDate}T00:00:00`) : null;

  for (let day = 0; day < dayCount; day += 1) {
    const dayItems = byDay.get(day);
    if (!dayItems || dayItems.length === 0) continue;

    const summary = `${trip.title} — ${dayLabels[day] ?? `Day ${day + 1}`}`;
    const description = dayItems
      .map((it) => (it.notes ? `${it.title} (${it.notes})` : it.title))
      .join("\\n");

    let dtstart: string;
    let dtend: string;
    if (start) {
      const dayStart = new Date(start);
      dayStart.setDate(dayStart.getDate() + day);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1); // DTEND is exclusive for all-day events
      dtstart = toIcsDate(dayStart);
      dtend = toIcsDate(dayEnd);
    } else {
      // No trip dates set: still produce a valid event, anchored on today.
      const fallback = new Date();
      fallback.setDate(fallback.getDate() + day);
      const fallbackEnd = new Date(fallback);
      fallbackEnd.setDate(fallbackEnd.getDate() + 1);
      dtstart = toIcsDate(fallback);
      dtend = toIcsDate(fallbackEnd);
    }

    events.push(
      [
        "BEGIN:VEVENT",
        `UID:tripbuddy-${trip.id}-day-${day}@tripbuddy`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${dtstart}`,
        `DTEND;VALUE=DATE:${dtend}`,
        `SUMMARY:${escapeText(summary)}`,
        `DESCRIPTION:${escapeText(description)}`,
        "END:VEVENT",
      ].join("\r\n"),
    );
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TripBuddy//Itinerary Export//EN",
    "CALSCALE:GREGORIAN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadIcs(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
