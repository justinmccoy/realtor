import { Fragment, useState } from "react";
import type { Comment } from "@jj/shared";
import { api } from "../api/client";
import { fmtWhen } from "../lib/format";

function CommentItem({ c, onReply }: { c: Comment; onReply: (c: Comment) => void }) {
  return (
    <li className={`cmt${c.parentId ? " reply" : ""}`}>
      <span className="who">
        {c.authorName}
        {c.authorRole === "admin" && <span className="role">JJ</span>}
        <span className="when">{fmtWhen(c.createdAt)}</span>
      </span>
      {c.deletedAt ? (
        <p className="deleted">Comment removed</p>
      ) : (
        <p>{c.body}</p>
      )}
      {!c.parentId && !c.deletedAt && (
        <button className="btn ghost" type="button" onClick={() => onReply(c)}>
          Reply
        </button>
      )}
    </li>
  );
}

/** Threaded comments: roots newest-first, replies oldest-first underneath. */
export function CommentThread({
  searchId,
  listingId,
  comments,
  onChanged,
  placeholder
}: {
  searchId: string;
  listingId: string | null;
  comments: Comment[];
  onChanged: () => void;
  placeholder: string;
}) {
  const scoped = comments.filter((c) => c.listingId === listingId);
  const roots = scoped.filter((c) => !c.parentId);
  const replies = (id: string) =>
    scoped
      .filter((c) => c.parentId === id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function post() {
    if (!body.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      await api.postComment(searchId, {
        listingId,
        parentId: replyTo?.id ?? null,
        body: body.trim()
      });
      setBody("");
      setReplyTo(null);
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't post the comment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cmt-form">
      {roots.length > 0 && (
        <ul className="cmt-list">
          {roots.map((root) => (
            <Fragment key={root.id}>
              <CommentItem c={root} onReply={setReplyTo} />
              {replies(root.id).map((r) => (
                <CommentItem key={r.id} c={r} onReply={setReplyTo} />
              ))}
            </Fragment>
          ))}
        </ul>
      )}
      {replyTo && (
        <span className="replying">
          Replying to {replyTo.authorName} ·{" "}
          <button className="btn ghost" type="button" onClick={() => setReplyTo(null)}>
            cancel
          </button>
        </span>
      )}
      <textarea
        value={body}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="cmt-actions">
        {msg && <span className="err">{msg}</span>}
        <button
          className="btn primary"
          type="button"
          disabled={busy || !body.trim()}
          onClick={() => void post()}
        >
          {replyTo ? "Post reply" : "Add a comment"}
        </button>
      </div>
    </div>
  );
}
