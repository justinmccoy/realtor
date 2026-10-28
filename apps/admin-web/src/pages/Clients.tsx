import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  MEMBER_ROLES,
  type Member,
  type MemberRole,
  type Search
} from "@jj/shared";
import { api } from "../api/client";
import { fmtWhen } from "../lib/format";
import { DangerButton, Field, useToast } from "../components/ui";

interface ClientRow {
  member: Member;
  search: Search;
  publishedListings: number;
  totalListings: number;
  ratingsGiven: number;
  avgScore: number | null;
  commentsPosted: number;
  events30d: number;
}

export function Clients({
  searches,
  onChanged
}: {
  searches: Search[];
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [partial, setPartial] = useState("");
  const [toastEl, toast] = useToast();

  const load = useCallback(async () => {
    setLoadError("");
    setPartial("");
    try {
      // One failing search must not blank the whole page.
      const settled = await Promise.allSettled(
        searches.map(async (search) => {
          const [detail, listings, ratings, comments] = await Promise.all([
            api.searchDetail(search.id),
            api.listings(search.id),
            api.ratings(search.id),
            api.comments(search.id)
          ]);
          return { search, detail, listings, ratings, comments };
        })
      );
      const failed: string[] = [];
      const perSearch = settled.flatMap((r, i) => {
        if (r.status === "fulfilled") return [r.value];
        failed.push(
          `${searches[i]?.clientName ?? "?"}: ${
            r.reason instanceof Error ? r.reason.message : String(r.reason)
          }`
        );
        return [];
      });
      const cutoff = Date.now() - 30 * 86_400_000;
      const built: ClientRow[] = [];
      for (const { search, detail, listings, ratings, comments } of perSearch) {
        for (const member of detail.members) {
          const mine = ratings.items.filter((r) => r.userId === member.userId);
          // Activity is nice-to-have; never let it block the roster.
          let events30d = 0;
          try {
            const activity = await api.activity({
              actorId: member.userId,
              limit: 100
            });
            events30d = activity.items.filter(
              (e) => new Date(e.at).getTime() >= cutoff
            ).length;
          } catch {
            /* column shows 0; the page still renders */
          }
          built.push({
            member,
            search,
            publishedListings: listings.items.filter((l) => l.published).length,
            totalListings: listings.items.length,
            ratingsGiven: mine.length,
            avgScore: mine.length
              ? mine.reduce((a, r) => a + r.score, 0) / mine.length
              : null,
            commentsPosted: comments.items.filter(
              (c) => c.authorId === member.userId && !c.deletedAt
            ).length,
            events30d
          });
        }
      }
      built.sort(
        (a, b) =>
          (b.member.lastSeenAt ?? "").localeCompare(a.member.lastSeenAt ?? "") ||
          a.member.displayName.localeCompare(b.member.displayName)
      );
      setRows(built);
      if (failed.length) {
        setPartial(`Couldn't load ${failed.length} search(es): ${failed.join(" · ")}`);
      }
    } catch (e) {
      setRows([]);
      setLoadError(e instanceof Error ? e.message : "Couldn't load clients");
    }
  }, [searches]);

  useEffect(() => {
    void load();
  }, [load]);

  /* invite form */
  const [sid, setSid] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("client");
  const [err, setErr] = useState("");
  const active = searches.filter((s) => s.status === "active");

  async function invite(e: FormEvent) {
    e.preventDefault();
    setErr("");
    const target = sid || active[0]?.id;
    if (!target) {
      setErr("Create a search first.");
      return;
    }
    try {
      await api.invite(target, {
        email: email.trim(),
        displayName: name.trim(),
        role
      });
      setEmail("");
      setName("");
      toast("Invitation sent — Cognito emails the temporary password");
      onChanged();
      await load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Invite failed");
    }
  }

  const quiet = (iso: string | null) =>
    !iso || Date.now() - new Date(iso).getTime() > 7 * 86_400_000;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="page-h">
        <h2>Clients</h2>
      </div>

      <form className="panel" onSubmit={invite}>
        <h2 style={{ fontSize: 20 }}>Add a client</h2>
        <div className="three">
          <Field label="Search">
            <select
              className="inline"
              value={sid || active[0]?.id || ""}
              onChange={(e) => setSid(e.target.value)}
            >
              {active.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.clientName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
        </div>
        <div className="three">
          <Field label="Role" hint="Viewers comment but can't save star ratings">
            <select
              className="inline"
              value={role}
              onChange={(e) => setRole(e.target.value as MemberRole)}
            >
              {MEMBER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {err && <p className="err">{err}</p>}
        <div className="sheet-f">
          <button className="btn primary" type="submit">
            Invite
          </button>
        </div>
      </form>

      {loadError && (
        <div className="bulkbar">
          <span className="err">{loadError}</span>
          <button className="btn" type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {partial && <p className="note-line">{partial}</p>}
      {rows === null ? (
        <div className="loading">Loading clients…</div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <h3>No clients yet</h3>
          <p>Invite your first client above — they'll get an email with a temporary password.</p>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Client</th>
                <th>Search</th>
                <th>Role</th>
                <th>Listings for them</th>
                <th>Last seen</th>
                <th>Activity (30d)</th>
                <th>Ratings</th>
                <th>Comments</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.search.id}-${r.member.userId}`}>
                  <td>
                    <b>{r.member.displayName}</b>
                    <br />
                    <small className="muted">{r.member.email}</small>
                  </td>
                  <td>
                    {r.search.clientName}
                    {r.search.status === "archived" && (
                      <small className="muted"> (archived)</small>
                    )}
                  </td>
                  <td>{r.member.role}</td>
                  <td className="num">
                    {r.publishedListings}
                    <small className="muted"> / {r.totalListings}</small>
                  </td>
                  <td className="muted">
                    {r.member.lastSeenAt ? fmtWhen(r.member.lastSeenAt) : "never"}
                    {quiet(r.member.lastSeenAt) && (
                      <>
                        {" "}
                        <span className="rmini2">quiet</span>
                      </>
                    )}
                  </td>
                  <td className="num">{r.events30d}</td>
                  <td className="num">
                    {r.ratingsGiven}
                    {r.avgScore !== null && (
                      <small className="muted"> · {r.avgScore.toFixed(1)}★</small>
                    )}
                  </td>
                  <td className="num">{r.commentsPosted}</td>
                  <td>
                    <div className="row-actions">
                      <DangerButton
                        label="Remove"
                        onConfirm={() =>
                          void api
                            .removeMember(r.search.id, r.member.userId)
                            .then(() => {
                              toast(`${r.member.displayName} removed`);
                              onChanged();
                              return load();
                            })
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="note-line">
        "Listings for them" = published / total in their search. Removing a
        client revokes access immediately; their Cognito account remains and can
        be re-invited. Activity counts the client's tracked interactions in the
        last 30 days.
      </p>
      {toastEl}
    </section>
  );
}
