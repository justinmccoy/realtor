import { describe, expect, it } from "vitest";
import type { UserType } from "@aws-sdk/client-cognito-identity-provider";
import { toCustomerAccount } from "../../src/cognito.js";

function user(over: Partial<UserType>): UserType {
  return {
    Username: "brian@example.com",
    Enabled: true,
    UserStatus: "CONFIRMED",
    UserCreateDate: new Date("2026-10-28T10:00:00Z"),
    Attributes: [
      { Name: "sub", Value: "sub-123" },
      { Name: "email", Value: "brian@example.com" },
      { Name: "name", Value: "Brian" }
    ],
    ...over
  };
}

describe("toCustomerAccount", () => {
  it("maps a confirmed self-registered user", () => {
    expect(toCustomerAccount(user({}))).toEqual({
      userId: "sub-123",
      email: "brian@example.com",
      name: "Brian",
      status: "confirmed",
      enabled: true,
      createdAt: "2026-10-28T10:00:00.000Z"
    });
  });

  it("maps invite + registration statuses to readable slugs", () => {
    expect(toCustomerAccount(user({ UserStatus: "FORCE_CHANGE_PASSWORD" }))!.status).toBe(
      "temp-password"
    );
    expect(toCustomerAccount(user({ UserStatus: "UNCONFIRMED" }))!.status).toBe(
      "unconfirmed"
    );
    expect(toCustomerAccount(user({ UserStatus: "RESET_REQUIRED" }))!.status).toBe(
      "reset_required"
    );
  });

  it("skips records without a sub and tolerates missing attributes", () => {
    expect(toCustomerAccount(user({ Attributes: [] }))).toBeNull();
    const bare = toCustomerAccount(
      user({ Attributes: [{ Name: "sub", Value: "s1" }], UserCreateDate: undefined })
    );
    expect(bare).toEqual({
      userId: "s1",
      email: "brian@example.com", // falls back to Username
      name: "",
      status: "confirmed",
      enabled: true,
      createdAt: null
    });
  });
});
