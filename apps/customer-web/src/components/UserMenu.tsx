import { useEffect, useState, type FormEvent } from "react";

export type Theme = "auto" | "light" | "dark";

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function storedTheme(): Theme {
  const t = localStorage.getItem("jj-theme");
  return t === "light" || t === "dark" ? t : "auto";
}

export function UserMenu({
  name,
  email,
  onSignOut,
  changePassword
}: {
  name: string;
  email: string;
  onSignOut: () => void;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [pwOpen, setPwOpen] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => applyTheme(theme), [theme]);

  function pickTheme(t: Theme) {
    setTheme(t);
    try {
      localStorage.setItem("jj-theme", t);
    } catch {
      /* private mode */
    }
  }

  function submitPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    changePassword(oldPw, newPw)
      .then(() => {
        setMsg("Password changed.");
        setOldPw("");
        setNewPw("");
        setPwOpen(false);
      })
      .catch((err) => setMsg(err instanceof Error ? err.message : "Failed"))
      .finally(() => setBusy(false));
  }

  return (
    <div className="usermenu">
      <button
        className="btn ghost"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {name || email} ▾
      </button>
      {open && (
        <>
          <div className="usermenu-backdrop" onClick={() => setOpen(false)} />
          <div className="usermenu-panel" role="menu">
            <div className="usermenu-row">
              <b>{name}</b>
            </div>
            <div className="usermenu-row note-line">{email}</div>
            <div className="usermenu-row">
              <span>Theme</span>
              <span style={{ display: "flex", gap: 4 }}>
                {(["auto", "light", "dark"] as Theme[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="chip"
                    aria-pressed={theme === t}
                    onClick={() => pickTheme(t)}
                  >
                    {t}
                  </button>
                ))}
              </span>
            </div>
            {!pwOpen ? (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setPwOpen(true);
                  setMsg("");
                }}
              >
                Change password…
              </button>
            ) : (
              <form
                onSubmit={submitPassword}
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                <div className="field">
                  <label>Current password</label>
                  <input
                    type="password"
                    value={oldPw}
                    autoComplete="current-password"
                    onChange={(e) => setOldPw(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label>New password</label>
                  <input
                    type="password"
                    value={newPw}
                    autoComplete="new-password"
                    onChange={(e) => setNewPw(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button className="btn ghost" type="button" onClick={() => setPwOpen(false)}>
                    Cancel
                  </button>
                  <button className="btn primary" type="submit" disabled={busy}>
                    Change
                  </button>
                </div>
              </form>
            )}
            {msg && <p className="note-line" style={{ margin: 0 }}>{msg}</p>}
            <button className="btn ghost danger" type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
