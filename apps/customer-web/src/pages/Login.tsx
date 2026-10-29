import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import type { NewPasswordRequired } from "../auth/cognito";

type Mode = "signin" | "register" | "confirm" | "newPassword" | "forgot" | "reset";

export function Login() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<NewPasswordRequired | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function run(fn: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function onSignIn(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const result = await auth.signIn(email.trim(), password);
      if (result.kind === "newPasswordRequired") {
        setPending(result);
        setName(result.name);
        setPassword("");
        setMode("newPassword");
      }
    });
  }

  function onNewPassword(e: FormEvent) {
    e.preventDefault();
    if (!pending) return;
    void run(() => auth.completeNewPassword(pending, password, name.trim() || "Client"));
  }

  function onRegister(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await auth.register(email.trim(), name.trim(), password);
      setMode("confirm");
      setNotice("We emailed you a confirmation code.");
    });
  }

  function onForgot(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await auth.startForgotPassword(email.trim());
      setMode("reset");
      setNotice("We emailed you a reset code.");
    });
  }

  function onReset(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await auth.confirmForgotPassword(email.trim(), code.trim(), password);
      setMode("signin");
      setNotice("Password updated — sign in with it now.");
      setCode("");
    });
  }

  function onConfirm(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await auth.confirm(email.trim(), code.trim());
      const result = await auth.signIn(email.trim(), password);
      if (result.kind === "newPasswordRequired") setMode("signin");
    });
  }

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    type = "text",
    autoComplete?: string
  ) => (
    <div className="field">
      <label>{label}</label>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => set(e.target.value)}
        required
      />
    </div>
  );

  return (
    <div className="auth-wrap">
      <div className="panel auth-card">
        <div>
          <div className="eyebrow">Apartment search</div>
          <h1 style={{ fontSize: 40 }}>
            Berlin <span className="u">Calling</span>
          </h1>
        </div>

        {mode === "signin" && (
          <form onSubmit={onSignIn}>
            {notice && <p className="note-line" style={{ margin: 0 }}>{notice}</p>}
            {field("Email", email, setEmail, "email", "username")}
            {field("Password", password, setPassword, "password", "current-password")}
            {error && <p className="err">{error}</p>}
            <button className="btn primary" disabled={busy} type="submit">
              Sign in
            </button>
            <span className="auth-switch">
              Invited by email? Sign in with the temporary password you received.
              <br />
              New here?{" "}
              <button type="button" onClick={() => setMode("register")}>
                Create an account
              </button>
              {" · "}
              <button type="button" onClick={() => setMode("forgot")}>
                Forgot password?
              </button>
            </span>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={onForgot}>
            <p className="note-line" style={{ margin: 0 }}>
              Enter your email and we'll send a reset code.
            </p>
            {field("Email", email, setEmail, "email", "username")}
            {error && <p className="err">{error}</p>}
            <button className="btn primary" disabled={busy} type="submit">
              Send reset code
            </button>
            <span className="auth-switch">
              <button type="button" onClick={() => setMode("signin")}>
                Back to sign in
              </button>
            </span>
          </form>
        )}

        {mode === "reset" && (
          <form onSubmit={onReset}>
            {notice && <p className="note-line" style={{ margin: 0 }}>{notice}</p>}
            {field("Reset code", code, setCode, "text", "one-time-code")}
            {field("New password (12+ characters)", password, setPassword, "password", "new-password")}
            {error && <p className="err">{error}</p>}
            <button className="btn primary" disabled={busy} type="submit">
              Set new password
            </button>
          </form>
        )}

        {mode === "newPassword" && (
          <form onSubmit={onNewPassword}>
            <p className="note-line" style={{ margin: 0 }}>
              Welcome! Choose your own password to finish setting up your account.
            </p>
            {field("Your name", name, setName, "text", "name")}
            {field("New password", password, setPassword, "password", "new-password")}
            {error && <p className="err">{error}</p>}
            <button className="btn primary" disabled={busy} type="submit">
              Set password &amp; sign in
            </button>
          </form>
        )}

        {mode === "register" && (
          <form onSubmit={onRegister}>
            {field("Your name", name, setName, "text", "name")}
            {field("Email", email, setEmail, "email", "username")}
            {field("Password (12+ characters)", password, setPassword, "password", "new-password")}
            {error && <p className="err">{error}</p>}
            <button className="btn primary" disabled={busy} type="submit">
              Create account
            </button>
            <span className="auth-switch">
              Already have an account?{" "}
              <button type="button" onClick={() => setMode("signin")}>
                Sign in
              </button>
            </span>
          </form>
        )}

        {mode === "confirm" && (
          <form onSubmit={onConfirm}>
            {notice && <p className="note-line" style={{ margin: 0 }}>{notice}</p>}
            {field("Confirmation code", code, setCode, "text", "one-time-code")}
            {error && <p className="err">{error}</p>}
            <button className="btn primary" disabled={busy} type="submit">
              Confirm &amp; sign in
            </button>
            <span className="auth-switch">
              No code?{" "}
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    await auth.resendCode(email.trim());
                    setNotice("Code re-sent.");
                  })
                }
              >
                Send again
              </button>
            </span>
          </form>
        )}
      </div>
    </div>
  );
}
