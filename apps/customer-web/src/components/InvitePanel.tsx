import { useEffect, useState, type FormEvent } from "react";
import type { Member, MemberRole } from "@jj/shared";
import { api } from "../api/client";

const ROLE_LABEL: Record<MemberRole, string> = {
  client: "Can edit",
  viewer: "View only"
};

/**
 * "Invite someone" overlay: who already has access, plus a form to add a
 * person with edit (rate + comment) or view-only (browse + comment) access.
 */
export function InvitePanel({
  searchId,
  myEmail,
  canInvite
}: {
  searchId: string;
  myEmail: string;
  canInvite: boolean;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  const load = () =>
    api
      .members(searchId)
      .then((r) => setMembers(r.items))
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load members"));

  useEffect(() => {
    void load();
  }, [searchId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setDone("");
    try {
      const m = await api.invite(searchId, {
        email: email.trim(),
        displayName: name.trim(),
        role
      });
      setDone(
        m.accountCreated
          ? `${m.displayName} has been invited. They'll get an email with a temporary password.`
          : `${m.displayName} has been added. They can sign in with their existing account.`
      );
      setName("");
      setEmail("");
      await load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="invite">
      <div className="vbox">
        <div className="vbox-h">
          <h4>Who has access</h4>
        </div>
        {members === null ? (
          <p className="note-line" style={{ margin: 0 }}>
            Loading…
          </p>
        ) : (
          <ul className="members">
            {members.map((m) => (
              <li key={m.userId}>
                <span className="who">
                  <b>{m.displayName}</b>
                  {m.email.toLowerCase() === myEmail.toLowerCase() && (
                    <span className="you">you</span>
                  )}
                  <span className="mail">{m.email}</span>
                </span>
                <span className="cstat" data-c={m.role === "client" ? "confirmed" : ""}>
                  {ROLE_LABEL[m.role]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canInvite ? (
        <form className="vbox" onSubmit={submit}>
          <div className="vbox-h">
            <h4>Invite someone</h4>
          </div>
          <div className="two">
            <div className="field">
              <label htmlFor="inv-name">Name</label>
              <input
                id="inv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                maxLength={100}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="inv-email">Email</label>
              <input
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                maxLength={254}
                required
              />
            </div>
          </div>
          <fieldset className="roles">
            <legend>Access</legend>
            <label>
              <input
                type="radio"
                name="role"
                value="viewer"
                checked={role === "viewer"}
                onChange={() => setRole("viewer")}
              />
              <span>
                <b>View only</b>
                <small>Can browse apartments and read comments. Nothing else.</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="role"
                value="client"
                checked={role === "client"}
                onChange={() => setRole("client")}
              />
              <span>
                <b>Can edit</b>
                <small>Can rate, comment, and invite others.</small>
              </span>
            </label>
          </fieldset>
          {err && <p className="err">{err}</p>}
          {done && (
            <p className="note-line" style={{ margin: 0 }}>
              {done}
            </p>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Inviting…" : "Send invite"}
            </button>
          </div>
        </form>
      ) : (
        <p className="note-line" style={{ margin: 0 }}>
          You have view-only access, so you can't invite others. Ask someone with
          edit access to add them.
        </p>
      )}
    </div>
  );
}
