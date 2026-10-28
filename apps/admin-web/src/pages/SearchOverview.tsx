import { useState, type FormEvent } from "react";
import {
  DISTRICTS,
  MEMBER_ROLES,
  ORTSTEILE,
  type Brief,
  type MemberRole
} from "@jj/shared";
import { api, type SearchDetail } from "../api/client";
import { fmtWhen } from "../lib/format";
import { linesOf, parseNum, toLines } from "../lib/parse";
import { DangerButton, Field } from "../components/ui";

export function SearchOverview({
  detail,
  onChanged,
  toast
}: {
  detail: SearchDetail;
  onChanged: () => void;
  toast: (m: string) => void;
}) {
  const { search, brief, members } = detail;

  /* settings */
  const [clientName, setClientName] = useState(search.clientName);
  const [rate, setRate] = useState(String(search.settings.rate || ""));
  const [gre, setGre] = useState(String(search.settings.gre));
  const [notary, setNotary] = useState(String(search.settings.notary));
  const [provision, setProvision] = useState(String(search.settings.provision));

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    await api.updateSearch(search.id, {
      clientName: clientName.trim() || search.clientName,
      settings: {
        rate: parseNum(rate) ?? 0,
        gre: parseNum(gre) ?? 6,
        notary: parseNum(notary) ?? 2,
        provision: parseNum(provision) ?? 3.57
      }
    });
    toast("Settings saved");
    onChanged();
  }

  /* brief */
  const [b, setB] = useState({
    budget: String(brief.budget || ""),
    minSqm: String(brief.minSqm || ""),
    minBeds: String(brief.minBeds || ""),
    timeline: brief.timeline,
    must: toLines(brief.must),
    nice: toLines(brief.nice),
    no: toLines(brief.no),
    notes: brief.notes,
    districts: new Set(brief.districts),
    ortsteile: new Set(brief.ortsteile)
  });

  async function saveBrief(e: FormEvent) {
    e.preventDefault();
    const body: Brief = {
      budget: parseNum(b.budget) ?? 0,
      minSqm: parseNum(b.minSqm) ?? 0,
      minBeds: parseNum(b.minBeds) ?? 0,
      districts: [...b.districts] as Brief["districts"],
      ortsteile: [...b.ortsteile],
      timeline: b.timeline.trim(),
      must: linesOf(b.must),
      nice: linesOf(b.nice),
      no: linesOf(b.no),
      notes: b.notes
    };
    await api.putBrief(search.id, body);
    toast("Requirements saved");
    onChanged();
  }

  /* members */
  const [invEmail, setInvEmail] = useState("");
  const [invName, setInvName] = useState("");
  const [invRole, setInvRole] = useState<MemberRole>("client");
  const [invErr, setInvErr] = useState("");

  async function invite(e: FormEvent) {
    e.preventDefault();
    setInvErr("");
    try {
      await api.invite(search.id, {
        email: invEmail.trim(),
        displayName: invName.trim(),
        role: invRole
      });
      setInvEmail("");
      setInvName("");
      toast("Invitation sent — Cognito emails the temporary password");
      onChanged();
    } catch (err) {
      setInvErr(err instanceof Error ? err.message : "Invite failed");
    }
  }

  return (
    <div className="dash-grid">
      <form className="panel" onSubmit={saveSettings}>
        <h2>Settings</h2>
        <Field label="Buyer name">
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </Field>
        <div className="two">
          <Field label="Hourly rate €" hint="0 hides amounts">
            <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
          <Field label="Status">
            <select
              className="inline"
              value={search.status}
              onChange={(e) =>
                void api
                  .updateSearch(search.id, {
                    status: e.target.value as "active" | "archived"
                  })
                  .then(onChanged)
              }
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
        </div>
        <div className="three">
          <Field label="Property transfer tax %">
            <input inputMode="decimal" value={gre} onChange={(e) => setGre(e.target.value)} />
          </Field>
          <Field label="Notary + land registry %">
            <input inputMode="decimal" value={notary} onChange={(e) => setNotary(e.target.value)} />
          </Field>
          <Field label="Default commission %">
            <input
              inputMode="decimal"
              value={provision}
              onChange={(e) => setProvision(e.target.value)}
            />
          </Field>
        </div>
        <div className="sheet-f">
          {search.status === "archived" && (
            <DangerButton
              label="Delete search permanently"
              onConfirm={() =>
                void api.deleteSearch(search.id).then(() => {
                  toast("Search deleted");
                  onChanged();
                })
              }
            />
          )}
          <button className="btn primary" type="submit">
            Save settings
          </button>
        </div>
      </form>

      <form className="panel" onSubmit={saveBrief}>
        <h2>Search requirements</h2>
        <div className="three">
          <Field label="Max all-in budget €">
            <input
              inputMode="numeric"
              value={b.budget}
              onChange={(e) => setB({ ...b, budget: e.target.value })}
            />
          </Field>
          <Field label="Min living area m²">
            <input
              inputMode="decimal"
              value={b.minSqm}
              onChange={(e) => setB({ ...b, minSqm: e.target.value })}
            />
          </Field>
          <Field label="Min bedrooms">
            <input
              inputMode="numeric"
              value={b.minBeds}
              onChange={(e) => setB({ ...b, minBeds: e.target.value })}
            />
          </Field>
        </div>
        <Field
          label="Preferred areas"
          hint='Tick a whole district or just areas. Nothing ticked = "anywhere in Berlin".'
        >
          <div className="geo">
            {DISTRICTS.map(({ num, name }) => {
              const whole = b.districts.has(name);
              const anyOrt = ORTSTEILE[name].some((o) => b.ortsteile.has(o));
              return (
                <details
                  className="geod"
                  key={name}
                  style={{ ["--dc" as string]: `var(--d${num})` }}
                  open={whole || anyOrt}
                >
                  <summary>
                    <span className="gnum">{num}</span>
                    {name}
                    <span className="gcount">
                      {whole
                        ? "whole district"
                        : ORTSTEILE[name].filter((o) => b.ortsteile.has(o)).length ||
                          ""}
                    </span>
                  </summary>
                  <label className="gwhole">
                    <input
                      type="checkbox"
                      checked={whole}
                      onChange={(e) => {
                        const districts = new Set(b.districts);
                        const ortsteile = new Set(b.ortsteile);
                        if (e.target.checked) {
                          districts.add(name);
                          for (const o of ORTSTEILE[name]) ortsteile.delete(o);
                        } else districts.delete(name);
                        setB({ ...b, districts, ortsteile });
                      }}
                    />{" "}
                    Whole district
                  </label>
                  <div className="gareas">
                    {ORTSTEILE[name].map((o) => (
                      <label className="gchip" key={o}>
                        <input
                          type="checkbox"
                          disabled={whole}
                          checked={whole || b.ortsteile.has(o)}
                          onChange={(e) => {
                            const ortsteile = new Set(b.ortsteile);
                            if (e.target.checked) ortsteile.add(o);
                            else ortsteile.delete(o);
                            setB({ ...b, ortsteile });
                          }}
                        />{" "}
                        {o}
                      </label>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </Field>
        <Field label="Timeline">
          <input
            value={b.timeline}
            placeholder="Buy by spring 2027"
            onChange={(e) => setB({ ...b, timeline: e.target.value })}
          />
        </Field>
        <div className="two">
          <Field label="Must-haves, one per line">
            <textarea value={b.must} onChange={(e) => setB({ ...b, must: e.target.value })} />
          </Field>
          <Field label="Nice-to-haves, one per line">
            <textarea value={b.nice} onChange={(e) => setB({ ...b, nice: e.target.value })} />
          </Field>
        </div>
        <Field label="Deal-breakers, one per line">
          <textarea value={b.no} onChange={(e) => setB({ ...b, no: e.target.value })} />
        </Field>
        <Field label="Other notes">
          <textarea value={b.notes} onChange={(e) => setB({ ...b, notes: e.target.value })} />
        </Field>
        <div className="sheet-f">
          <button className="btn primary" type="submit">
            Save requirements
          </button>
        </div>
      </form>

      <section className="panel">
        <h2>Members</h2>
        <form onSubmit={invite} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="three">
            <Field label="Email">
              <input
                type="email"
                value={invEmail}
                onChange={(e) => setInvEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Name">
              <input value={invName} onChange={(e) => setInvName(e.target.value)} required />
            </Field>
            <Field label="Role" hint="Viewers comment but can't save star ratings">
              <select
                className="inline"
                value={invRole}
                onChange={(e) => setInvRole(e.target.value as MemberRole)}
              >
                {MEMBER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {invErr && <p className="err">{invErr}</p>}
          <div className="sheet-f">
            <button className="btn primary" type="submit">
              Invite
            </button>
          </div>
        </form>
        {members.length > 0 && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Last seen</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.userId}>
                    <td>{m.displayName}</td>
                    <td>{m.email}</td>
                    <td>{m.role}</td>
                    <td className="muted">
                      {m.lastSeenAt ? fmtWhen(m.lastSeenAt) : "never"}
                    </td>
                    <td>
                      <div className="row-actions">
                        <DangerButton
                          label="Remove"
                          onConfirm={() =>
                            void api
                              .removeMember(search.id, m.userId)
                              .then(() => {
                                toast("Member removed");
                                onChanged();
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
      </section>
    </div>
  );
}
