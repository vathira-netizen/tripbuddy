/**
 * Booking hand-off links: plain search-query URLs to third-party sites.
 *
 * There is no flight/train code data (IATA codes, station codes) anywhere in
 * this app, so these are deliberately search-query deep links, not precise
 * "from X to Y" itinerary links — the destination name is enough to land on a
 * real results page. No API keys involved; every provider here supports a
 * public, unauthenticated search URL.
 */

function ymd(date: string | null | undefined): string | null {
  if (!date) return null;
  // Dates already arrive as YYYY-MM-DD from the API; guard against anything else.
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export function googleFlightsUrl(destination: string): string {
  const q = encodeURIComponent(`Flights to ${destination}`);
  return `https://www.google.com/travel/flights?q=${q}`;
}

export function makeMyTripFlightsUrl(destination: string): string {
  const q = encodeURIComponent(destination);
  return `https://www.makemytrip.com/flights/search?searchText=${q}`;
}

export function bookingComUrl(
  destination: string,
  startDate?: string | null,
  endDate?: string | null,
): string {
  const params = new URLSearchParams({ ss: destination });
  const checkin = ymd(startDate);
  const checkout = ymd(endDate);
  if (checkin) params.set("checkin", checkin);
  if (checkout) params.set("checkout", checkout);
  return `https://www.booking.com/searchresults.html?${params.toString()}`;
}

export function airbnbUrl(
  destination: string,
  startDate?: string | null,
  endDate?: string | null,
): string {
  const params = new URLSearchParams({ query: destination });
  const checkin = ymd(startDate);
  const checkout = ymd(endDate);
  if (checkin) params.set("checkin", checkin);
  if (checkout) params.set("checkout", checkout);
  return `https://www.airbnb.com/s/homes?${params.toString()}`;
}
