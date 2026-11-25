import { describe, expect, it } from "vitest";

import {
  formatCountdown,
  formatIndianPhone,
  needsPhoneVerification,
  phoneErrorMessage,
} from "@/lib/phone";
import { normaliseIndianPhone, otpSchema, PHONE_ERROR, phoneSchema } from "@/lib/schemas";

describe("normaliseIndianPhone", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["98765-43210", "+919876543210"],
    ["(98765) 43210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["+919876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["0091 98765 43210", "+919876543210"],
    ["098765 43210", "+919876543210"],
    ["  6123456789  ", "+916123456789"],
    // A 10-digit number that happens to start with 91 is still a number, not a prefix.
    ["9123456789", "+919123456789"],
  ])("accepts %s", (input, expected) => {
    expect(normaliseIndianPhone(input)).toBe(expected);
  });

  it.each([
    "",
    "12345",
    "987654321", // 9 digits
    "98765432101", // 11 digits
    "5876543210", // Indian mobiles start 6-9
    "+1 415 555 0100", // not India
    "+44 7700 900123",
    "+92 300 1234567",
    "9876abc210",
    "+91 98765 4321O", // letter O
    "++919876543210",
  ])("rejects %s", (input) => {
    expect(normaliseIndianPhone(input)).toBeNull();
  });
});

describe("phoneSchema", () => {
  it("parses to E.164", () => {
    expect(phoneSchema.parse("098765 43210")).toBe("+919876543210");
  });

  it("asks for a number when empty", () => {
    const result = phoneSchema.safeParse("   ");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Enter your mobile number.");
  });

  it("explains what's accepted for anything else", () => {
    const result = phoneSchema.safeParse("+1 415 555 0100");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(PHONE_ERROR);
  });
});

describe("otpSchema", () => {
  it("accepts exactly six digits", () => {
    expect(otpSchema.parse(" 123456 ")).toBe("123456");
  });

  it.each(["12345", "1234567", "12345a", ""])("rejects %s", (input) => {
    expect(otpSchema.safeParse(input).success).toBe(false);
  });
});

describe("needsPhoneVerification", () => {
  it("spots the backend's phone-required 403", () => {
    expect(
      needsPhoneVerification({ status: 403, data: { code: "phone_verification_required" } }),
    ).toBe(true);
  });

  it("ignores other errors", () => {
    expect(needsPhoneVerification({ status: 403, data: { detail: "nope" } })).toBe(false);
    expect(
      needsPhoneVerification({ status: 400, data: { code: "phone_verification_required" } }),
    ).toBe(false);
    expect(needsPhoneVerification(new Error("network"))).toBe(false);
    expect(needsPhoneVerification(null)).toBe(false);
  });
});

describe("phoneErrorMessage", () => {
  it("tells a wrong code from an expired one", () => {
    const err = { code: "otp_expired", status: 403 };
    expect(phoneErrorMessage(err, "verify", 20)).toMatch(/isn't right/);
    expect(phoneErrorMessage(err, "verify", 61)).toMatch(/expired/);
  });

  it("explains rate limits", () => {
    expect(phoneErrorMessage({ code: "over_sms_send_rate_limit", status: 429 }, "send")).toMatch(
      /Too many attempts/,
    );
    expect(phoneErrorMessage({ status: 429 }, "verify")).toMatch(/Too many attempts/);
  });

  it("explains a number already in use", () => {
    expect(phoneErrorMessage({ code: "phone_exists", status: 422 }, "send")).toMatch(
      /another TripBuddy account/,
    );
  });

  it("never echoes the raw error", () => {
    const raw = { code: "something_new", status: 500, message: "pq: relation does not exist" };
    for (const stage of ["send", "verify"] as const) {
      const message = phoneErrorMessage(raw, stage);
      expect(message).not.toContain("pq:");
      expect(message).not.toContain("something_new");
    }
    expect(phoneErrorMessage(undefined, "send")).toBe("Couldn't send the code. Try again.");
  });
});

describe("formatting", () => {
  it("formats countdowns as m:ss", () => {
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(42.3)).toBe("0:43");
    expect(formatCountdown(-5)).toBe("0:00");
  });

  it("formats a number for display", () => {
    expect(formatIndianPhone("+919876543210")).toBe("+91 98765 43210");
  });
});
