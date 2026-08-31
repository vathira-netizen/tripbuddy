/**
 * UPI (India's Unified Payments Interface) pay-intent deep link, plus a QR
 * rendering of it for scanning from another device.
 *
 * The QR is rendered via the free, no-auth api.qrserver.com image endpoint —
 * the payload is a payee VPA + amount + name, i.e. exactly what a UPI QR is
 * meant to broadcast for scanning, not sensitive data.
 */

export function buildUpiPayUrl({
  vpa,
  payeeName,
  amount,
  note,
}: {
  vpa: string;
  payeeName: string;
  amount: string;
  note?: string;
}): string {
  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName,
    am: amount,
    cu: "INR",
    tn: note ?? "TripBuddy Settlement",
  });
  return `upi://pay?${params.toString()}`;
}

export function qrImageUrl(data: string, size = 220): string {
  const params = new URLSearchParams({ size: `${size}x${size}`, data });
  return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`;
}
