import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import * as cognito from "../auth/cognito";

type Pending =
  | { kind: "none" }
  | cognito.NewPasswordRequired
  | cognito.MfaSetup
  | cognito.TotpRequired;

export function Login() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<Pending>({ kind: "none" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<cognito.SignInResult>) {
    setError("");
    setBusy(true);
    try {
      const result = await fn();
      auth.handleResult(result);
      if (result.kind !== "signedIn") setPending(result);
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending.kind === "none") {
      void run(() => cognito.signIn(email.trim(), password));
    } else if (pending.kind === "newPasswordRequired") {
      void run(() => cognito.completeNewPassword(pending, password, email.trim()));
    } else if (pending.kind === "mfaSetup") {
      void run(() => cognito.completeMfaSetup(pending, code.trim()));
    } else {
      void run(() => cognito.submitTotp(pending, code.trim(), email.trim()));
    }
  };

  return (
    <div className="auth-wrap">
      <div className="panel auth-card">
        <div>
          <div className="eyebrow">Admin</div>
          <h1 style={{ fontSize: 40 }}>
            Berlin <span className="u">Calling</span>
          </h1>
        </div>
        <form onSubmit={submit}>
          {pending.kind === "none" && (
            <>
              <div className="field">
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  autoComplete="username"
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </>
          )}
          {pending.kind === "newPasswordRequired" && (
            <div className="field">
              <label>Choose a new password (14+ chars, mixed)</label>
              <input
                type="password"
                value={password}
                autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          )}
          {pending.kind === "mfaSetup" && (
            <>
              <p className="note-line" style={{ margin: 0 }}>
                Add this account to your authenticator app (scan a QR from the
                otpauth URL or paste the secret), then enter the 6-digit code.
              </p>
              <div className="secret">{pending.secret}</div>
              <div className="secret">{pending.otpauthUrl}</div>
              <div className="field">
                <label>Code from your authenticator</label>
                <input
                  inputMode="numeric"
                  value={code}
                  autoComplete="one-time-code"
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
            </>
          )}
          {pending.kind === "totpRequired" && (
            <div className="field">
              <label>6-digit code from your authenticator</label>
              <input
                inputMode="numeric"
                value={code}
                autoComplete="one-time-code"
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>
          )}
          {error && <p className="err">{error}</p>}
          <button className="btn primary" disabled={busy} type="submit">
            {pending.kind === "none" ? "Sign in" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
