import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-secrets-manager", () => {
  class GetSecretValueCommand {
    constructor(readonly input: Record<string, unknown>) {}
  }
  class SecretsManagerClient {
    send = send;
  }
  return { GetSecretValueCommand, SecretsManagerClient };
});

import {
  MISSING_SECRET_TTL_MS,
  readSecretFromEnv,
  resetSecretCache
} from "../../src/import/secrets.js";

describe("readSecretFromEnv", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.TEST_SECRET_ARN = "arn:aws:secretsmanager:eu-central-1:1:secret:x";
    send.mockReset();
    resetSecretCache();
  });
  afterEach(() => vi.useRealTimers());

  it("caches a real value for the life of the container", async () => {
    send.mockResolvedValue({ SecretString: "sk-ant-real" });
    expect(await readSecretFromEnv("TEST_SECRET_ARN")).toBe("sk-ant-real");
    vi.advanceTimersByTime(MISSING_SECRET_TTL_MS * 100);
    expect(await readSecretFromEnv("TEST_SECRET_ARN")).toBe("sk-ant-real");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("re-reads a placeholder after the short TTL, so a stored key is picked up", async () => {
    send.mockResolvedValueOnce({ SecretString: '{"placeholder":true,"nonce":"abc"}' });
    expect(await readSecretFromEnv("TEST_SECRET_ARN")).toBeNull();
    expect(await readSecretFromEnv("TEST_SECRET_ARN")).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);

    send.mockResolvedValueOnce({ SecretString: "sk-ant-stored-later" });
    vi.advanceTimersByTime(MISSING_SECRET_TTL_MS + 1);
    expect(await readSecretFromEnv("TEST_SECRET_ARN")).toBe("sk-ant-stored-later");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("treats a read failure as missing, briefly", async () => {
    send.mockRejectedValueOnce(new Error("AccessDenied"));
    expect(await readSecretFromEnv("TEST_SECRET_ARN")).toBeNull();
    send.mockResolvedValueOnce({ SecretString: "sk-ant-ok" });
    vi.advanceTimersByTime(MISSING_SECRET_TTL_MS + 1);
    expect(await readSecretFromEnv("TEST_SECRET_ARN")).toBe("sk-ant-ok");
  });

  it("returns null without a call when the env var is unset", async () => {
    expect(await readSecretFromEnv("UNSET_SECRET_ARN")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
