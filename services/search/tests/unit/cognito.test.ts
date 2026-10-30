import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-cognito-identity-provider", () => {
  class Cmd {
    constructor(readonly input: Record<string, unknown>) {}
  }
  class AdminCreateUserCommand extends Cmd {}
  class AdminGetUserCommand extends Cmd {}
  class ListUsersCommand extends Cmd {}
  class UsernameExistsException extends Error {}
  class CognitoIdentityProviderClient {
    send = send;
  }
  return {
    AdminCreateUserCommand,
    AdminGetUserCommand,
    ListUsersCommand,
    UsernameExistsException,
    CognitoIdentityProviderClient
  };
});

import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  UsernameExistsException
} from "@aws-sdk/client-cognito-identity-provider";
import { ensureCustomerUser } from "../../src/cognito.js";

type Call = { input: Record<string, unknown> };
const creates = () =>
  send.mock.calls
    .map(([c]) => c as Call)
    .filter((c) => c instanceof AdminCreateUserCommand)
    .map((c) => c.input);

const SUB = [{ Name: "sub", Value: "sub-1" }];

describe("ensureCustomerUser", () => {
  beforeEach(() => {
    process.env.CUSTOMER_POOL_ID = "eu-central-1_test";
    send.mockReset();
  });

  it("creates the account and lets Cognito email the temporary password", async () => {
    send.mockResolvedValueOnce({ User: { Attributes: SUB } });
    const out = await ensureCustomerUser("new@example.com", "New");
    expect(out).toEqual({ userId: "sub-1", created: true, invitation: "new" });
    expect(creates()).toEqual([
      expect.objectContaining({
        Username: "new@example.com",
        DesiredDeliveryMediums: ["EMAIL"]
      })
    ]);
    expect(creates()[0]).not.toHaveProperty("MessageAction");
  });

  it("re-sends the invitation when the account exists but was never signed in", async () => {
    send.mockImplementation(async (cmd: Call) => {
      if (cmd instanceof AdminGetUserCommand) {
        return { UserStatus: "FORCE_CHANGE_PASSWORD", UserAttributes: SUB };
      }
      if (cmd instanceof AdminCreateUserCommand && cmd.input["MessageAction"] === "RESEND") {
        return {};
      }
      throw new UsernameExistsException({ message: "User account already exists", $metadata: {} });
    });
    const out = await ensureCustomerUser("waiting@example.com", "Waiting");
    expect(out).toEqual({ userId: "sub-1", created: false, invitation: "resent" });
    expect(creates()).toHaveLength(2);
    expect(creates()[1]).toEqual({
      UserPoolId: "eu-central-1_test",
      Username: "waiting@example.com",
      MessageAction: "RESEND",
      DesiredDeliveryMediums: ["EMAIL"]
    });
  });

  it("just reuses an account that is already in use, without emailing", async () => {
    send.mockImplementation(async (cmd: Call) => {
      if (cmd instanceof AdminGetUserCommand) {
        return { UserStatus: "CONFIRMED", UserAttributes: SUB };
      }
      throw new UsernameExistsException({ message: "User account already exists", $metadata: {} });
    });
    const out = await ensureCustomerUser("active@example.com", "Active");
    expect(out).toEqual({ userId: "sub-1", created: false, invitation: "existing" });
    expect(creates()).toHaveLength(1);
  });

  it("passes other Cognito errors through", async () => {
    send.mockRejectedValueOnce(new Error("TooManyRequestsException"));
    await expect(ensureCustomerUser("x@example.com", "X")).rejects.toThrow(
      "TooManyRequestsException"
    );
  });
});
