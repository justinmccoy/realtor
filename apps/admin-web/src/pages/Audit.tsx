import { useEffect, useState } from "react";
import { api, type AuditItem } from "../api/client";
import { fmtWhen } from "../lib/format";

export function Audit() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    void api.audit({ limit: 50 }).then((r) => {
      setItems(r.items);
      setCursor(r.nextCursor);
    });
  }, []);

  const visible = filter
    ? items.filter((i) =>
        `${i.adminName} ${i.action} ${i.entity} ${i.summary}`
          .toLowerCase()
          .includes(filter.toLowerCase())
      )
    : items;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="page-h">
        <h2>Audit log</h2>
        <div className="filters">
          <input
            type="search"
            placeholder="Filter by admin, action, entity…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>When</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((i) => (
              <tr key={`${i.at}-${i.id}`}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>
                  {fmtWhen(i.at)}
                </td>
                <td>{i.adminName}</td>
                <td>{i.action}</td>
                <td>{i.entity}</td>
                <td>
                  {i.summary}
                  {(i.before || i.after) && (
                    <details>
                      <summary className="muted">before / after</summary>
                      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, overflowWrap: "anywhere" }}>
                        {i.before ? `before: ${i.before}\n` : ""}
                        {i.after ? `after: ${i.after}` : ""}
                      </pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No audit entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button
          className="btn"
          type="button"
          onClick={() =>
            void api.audit({ limit: 50, cursor }).then((r) => {
              setItems((cur) => [...cur, ...r.items]);
              setCursor(r.nextCursor);
            })
          }
        >
          Load more
        </button>
      )}
    </section>
  );
}
