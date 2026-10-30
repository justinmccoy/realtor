import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  MEMBER_ROLES,
  visibility,
  type Member,
  type MemberRole,
  type Search
} from "@jj/shared";
import { api, type CustomerAccount } from "../api/client";
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
  const [accounts, setAccounts] = useState<CustomerAccount[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [partial, setPartial] = useState("");
  const [toastEl, toast] = useToast();

  const load = useCallback(async () => {
    setLoadError("");
    setPartial("");
    try {
      // Sequential per search: new AWS accounts have low Lambda concurrency
      // limits, and a parallel fan-out here gets throttled into 503s.
      // One failing search still must not blank the whole page.
      const pool = (await api.listings()).items;
      const failed: string[] = [];
      const perSearch: {
        search: Search;
        detail: Awaited<ReturnType<typeof api.searchDetail>>;
        visibleCount: number;
        ratings: Awaited<ReturnType<typeof api.ratings>>;
        comments: Awaited<ReturnType<typeof api.comments>>;
      }[] = [];
      for (const search of searches) {
        try {
          const detail = await api.searchDetail(search.id);
          const shares = await api.shares(search.id);
          const shareMap = new Map(shares.items.map((i) => [i.listingId, i.mode]));
          const visibleCount = pool.filter(
            (l) =>
              visibility(l, detail.brief, search.settings, shareMap.get(l.id))
                .visible
          ).length;
          const ratings = await api.ratings(search.id);
          const comments = await api.comments(search.id);
          perSearch.push({ search, detail, visibleCount, ratings, comments });
        } catch (reason) {
          failed.push(
            `${search.clientName}: ${
              reason instanceof Error ? reason.message : String(reason)
            }`
          );
        }
      }
      // One aggregate call for all members' 30-day activity counts.
      const allMemberIds = [
        ...new Set(perSearch.flatMap((p) => p.detail.members.map((m) => m.userId)))
      ];
      let eventsByActor = new Map<string, number>();
      try {
        const summary = await api.activitySummary({ actorIds: allMemberIds });
        eventsByActor = new Map(summary.actors.map((a) => [a.actorId, a.events30d]));
      } catch {
        /* column shows 0; the page still renders */
      }
      const built: ClientRow[] = [];
      for (const { search, detail, visibleCount, ratings, comments } of perSearch) {
        for (const member of detail.members) {
          const mine = ratings.items.filter((r) => r.userId === member.userId);
          const events30d = eventsByActor.get(member.userId) ?? 0;
          built.push({
            member,
            search,
            publishedListings: visibleCount,
            totalListings: pool.length,
            ratingsGiven: mine.length,
            avgScore: mine.length
              ? mine.reduce((a, r) => a + r.score, 0) / mine.length
              : null,
            commentsPosted: comments.items.filter((c) => c.authorId === member.userId)
              .length,
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

  useEffect(() => {
    api
      .users()
      .then((r) => setAccounts(r.items))
      .catch(() => setAccounts([]));
  }, []);

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
      const m = await api.invite(target, {
        email: email.trim(),
        displayName: name.trim(),
        role
      });
      setEmail("");
      setName("");
      toast(
        m.invitation === "resent"
          ? "They were invited before but never signed in — a fresh temporary password has been emailed"
          : m.invitation === "existing"
            ? "Added to the search — they already have an account, so no email was sent"
            : "Invitation sent — Cognito emails the temporary password"
      );
      onChanged();
      await load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Invite failed");
    }
  }

  const quiet = (iso: string | null) =>
    !iso || Date.now() - new Date(iso).getTime() > 7 * 86_400_000;

  const membershipsOf = (userId: string) =>
    (rows ?? []).filter((r) => r.member.userId === userId);

  const prefillInvite = (account: CustomerAccount) => {
    setEmail(account.email);
    setName(account.name || account.email.split("@")[0] || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast("Invite form pre-filled — pick the search and hit Invite");
  };

  const ACCOUNT_STATUS: Record<string, string> = {
    confirmed: "active",
    "temp-password": "invited — temp password not used yet",
    unconfirmed: "registered — email not confirmed"
  };

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
          <Field label="Role" hint="Clients rate and comment; viewers are read-only">
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
      <section className="panel">
        <h2 style={{ fontSize: 20 }}>Registered accounts</h2>
        <p className="note-line" style={{ margin: 0 }}>
          Everyone with a login on the customer site — including people who
          self-registered and aren't attached to any search yet.
        </p>
        {accounts === null ? (
          <p className="note-line">Loading accounts…</p>
        ) : accounts.length === 0 ? (
          <p className="note-line">No accounts yet.</p>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Status</th>
                  <th>Registered</th>
                  <th>Member of</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const memberships = membershipsOf(a.userId);
                  return (
                    <tr key={a.userId}>
                      <td>
                        <b>{a.name || "—"}</b>
                        <br />
                        <small className="muted">{a.email}</small>
                      </td>
                      <td>
                        {ACCOUNT_STATUS[a.status] ?? a.status}
                        {!a.enabled && <span className="rmini2"> disabled</span>}
                      </td>
                      <td className="muted">
                        {a.createdAt ? fmtWhen(a.createdAt) : "—"}
                      </td>
                      <td>
                        {memberships.length ? (
                          memberships.map((m) => m.search.clientName).join(", ")
                        ) : (
                          <span className="rmini2">no search assigned</span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="btn ghost"
                            type="button"
                            onClick={() => prefillInvite(a)}
                          >
                            {memberships.length ? "Add to another search" : "Add to a search"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="note-line">
        "Listings for them" = visible to this client (brief matches + manual
        shares − hides) / total pool. Removing a
        client revokes access immediately; their Cognito account remains and can
        be re-invited. Activity counts the client's tracked interactions in the
        last 30 days.
      </p>
      {toastEl}
    </section>
  );
}
