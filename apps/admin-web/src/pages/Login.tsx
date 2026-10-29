import { useEffect, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { useAuth } from "../auth/AuthContext";
import * as cognito from "../auth/cognito";

function TotpQr({ value }: { value: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) {
      void QRCode.toCanvas(ref.current, value, { width: 200, margin: 2 });
    }
  }, [value]);
  return (
    <canvas
      ref={ref}
      style={{ borderRadius: 8, alignSelf: "center", maxWidth: "100%" }}
      aria-label="Scan this QR code with your authenticator app"
    />
  );
}

type Pending =
  | { kind: "none" }
  | { kind: "forgot" }
  | { kind: "reset" }
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
      const message = e instanceof Error ? e.message : "Sign-in failed";
      // Cognito challenge sessions expire after ~3 minutes. Restart cleanly:
      // a retry against the dead session can never succeed, and each sign-in
      // issues a fresh TOTP secret anyway.
      if (/session is expired|invalid session/i.test(message)) {
        setPending({ kind: "none" });
        setPassword("");
        setCode("");
        setError(
          "That took longer than Cognito's 3-minute window — sign in again. " +
            "Tip: have your authenticator app open and ready first. If you " +
            "already added an entry for this site, delete it; a fresh secret " +
            "is issued each attempt."
        );
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending.kind === "forgot") {
      setBusy(true);
      setError("");
      void cognito
        .startForgotPassword(email.trim())
        .then(() => setPending({ kind: "reset" }))
        .catch((err) => setError(err instanceof Error ? err.message : "Failed"))
        .finally(() => setBusy(false));
      return;
    }
    if (pending.kind === "reset") {
      setBusy(true);
      setError("");
      void cognito
        .confirmForgotPassword(email.trim(), code.trim(), password)
        .then(() => {
          setPending({ kind: "none" });
          setPassword("");
          setCode("");
          setError("");
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Failed"))
        .finally(() => setBusy(false));
      return;
    }
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
            Genau <span className="u">Here</span>
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
                Scan this QR code with your authenticator app (or enter the
                setup key below manually), then type the 6-digit code it shows.
              </p>
              <TotpQr value={pending.otpauthUrl} />
              <details>
                <summary className="note-line" style={{ cursor: "pointer" }}>
                  Can't scan? Show the setup key
                </summary>
                <div className="secret">{pending.secret}</div>
              </details>
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
          {pending.kind === "forgot" && (
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
          )}
          {pending.kind === "reset" && (
            <>
              <p className="note-line" style={{ margin: 0 }}>
                We emailed you a reset code.
              </p>
              <div className="field">
                <label>Reset code</label>
                <input
                  inputMode="numeric"
                  value={code}
                  autoComplete="one-time-code"
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label>New password (14+ chars, mixed)</label>
                <input
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </>
          )}
          {error && <p className="err">{error}</p>}
          <button className="btn primary" disabled={busy} type="submit">
            {pending.kind === "none"
              ? "Sign in"
              : pending.kind === "forgot"
                ? "Send reset code"
                : pending.kind === "reset"
                  ? "Set new password"
                  : "Continue"}
          </button>
          {pending.kind === "none" && (
            <span className="auth-switch">
              <button type="button" onClick={() => setPending({ kind: "forgot" })}>
                Forgot password?
              </button>
            </span>
          )}
          {(pending.kind === "forgot" || pending.kind === "reset") && (
            <span className="auth-switch">
              <button type="button" onClick={() => setPending({ kind: "none" })}>
                Back to sign in
              </button>
            </span>
          )}
        </form>
      </div>
    </div>
  );
}
