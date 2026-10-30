import { useEffect, useRef, useState } from "react";
import {
  IMPORT_JOB_WAIT_MS,
  MAX_PHOTO_IMPORT_BATCH,
  type ImportJob,
  type ImportRequest
} from "@jj/shared";
import { api, ApiClientError } from "../api/client";
import { HouseLoader } from "../components/HouseLoader";
import { Field, Modal } from "../components/ui";
import { progressCopy, progressOfJob, type ImportProgress } from "../lib/importProgress";
import type { EditorTarget, ImportSummary } from "./ListingEditor";

/** Photos pulled per import; anything beyond this the admin adds by hand. */
export const MAX_IMPORT_PHOTOS = 15;

/** How often the modal asks after a queued link import. */
const POLL_MS = 1_500;
/** Polling failures tolerated in a row before the import is given up on. */
const MAX_POLL_MISSES = 4;

export interface ImportStart {
  url?: string;
  sourceId?: string;
  /** Open on the paste form instead of fetching the link. */
  paste?: boolean;
}

type Phase =
  | { kind: "paste"; url: string; content: string; reason?: string }
  | { kind: "working"; progress: ImportProgress; startedAt: number; link: boolean }
  | { kind: "error"; message: string; canPaste: boolean };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Drives one import: link (or pasted text) → draft listing → photos in
 * batches → hands the draft to the editor. A link import runs as a job on
 * the server (it can take a couple of minutes behind a proxy), so this polls
 * it; pasted text comes back finished in one go. Lives in a modal so the
 * admin sees progress; a blocked portal flips it to the paste fallback.
 */
export function ImportRunner({
  start,
  onDone,
  onClose,
  toast
}: {
  start: ImportStart;
  onDone: (t: EditorTarget) => void;
  onClose: () => void;
  toast: (m: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>(() =>
    start.paste
      ? { kind: "paste", url: start.url ?? "", content: "" }
      : { kind: "working", progress: { kind: "queued" }, startedAt: Date.now(), link: true }
  );
  const started = useRef(false);
  const closed = useRef(false);
  // Ticks once a second while working so the hint can change its tone.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (phase.kind !== "working") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase.kind]);

  useEffect(
    () => () => {
      closed.current = true;
    },
    []
  );

  async function waitForJob(
    first: ImportJob,
    show: (p: ImportProgress) => void
  ): Promise<ImportJob> {
    const deadline = Date.now() + IMPORT_JOB_WAIT_MS;
    let job = first;
    let misses = 0;
    while (job.status === "queued" || job.status === "running") {
      show(progressOfJob(job));
      if (Date.now() > deadline) {
        throw new ApiClientError(
          504,
          "timeout",
          "The import is taking longer than expected. If it does finish, the draft will still appear in your listings; otherwise try again or paste the page text instead."
        );
      }
      await sleep(POLL_MS);
      if (closed.current) return job;
      try {
        job = await api.importJob(job.id);
        misses = 0;
      } catch (e) {
        const fatal = e instanceof ApiClientError && (e.status === 401 || e.status === 404);
        if (fatal || ++misses >= MAX_POLL_MISSES) throw e;
      }
    }
    return job;
  }

  async function run(req: ImportRequest) {
    const link = req.content === undefined;
    const startedAt = Date.now();
    const show = (progress: ImportProgress) => {
      if (!closed.current) setPhase({ kind: "working", progress, startedAt, link });
    };
    show(link ? { kind: "queued" } : { kind: "reading" });

    const fail = (code: string, message: string) =>
      setPhase({
        kind: "error",
        message,
        canPaste: code === "upstream_blocked" || link
      });

    let job: ImportJob;
    try {
      job = await waitForJob(await api.startImport(req), show);
    } catch (e) {
      if (closed.current) return;
      fail(
        e instanceof ApiClientError ? e.code : "internal",
        e instanceof Error ? e.message : "Import failed"
      );
      return;
    }
    if (closed.current) return;
    if (job.status !== "done" || !job.result) {
      const err = job.error ?? { code: "internal", message: "Import failed" };
      fail(err.code, err.message);
      return;
    }
    const result = job.result;

    const urls = result.photoUrls.slice(0, MAX_IMPORT_PHOTOS);
    let added = 0;
    let failed = 0;
    for (let i = 0; i < urls.length; i += MAX_PHOTO_IMPORT_BATCH) {
      const batch = urls.slice(i, i + MAX_PHOTO_IMPORT_BATCH);
      show({
        kind: "photos",
        current: Math.min(i + MAX_PHOTO_IMPORT_BATCH, urls.length),
        total: urls.length
      });
      try {
        const r = await api.importPhotos(result.listing.id, "photo", batch);
        added += r.items.filter((x) => x.ok).length;
        failed += r.items.filter((x) => !x.ok).length;
      } catch {
        failed += batch.length;
      }
      if (closed.current) return;
    }

    const summary: ImportSummary = {
      provenance: result.provenance,
      warnings: result.warnings,
      portal: result.portal,
      fetchedVia: result.fetchedVia,
      aiUsed: result.aiUsed,
      photosAdded: added,
      photosFailed: failed,
      photoCandidates: result.photoUrls.length,
      sourceId: req.sourceId
    };
    const fields = Object.keys(result.provenance).length;
    toast(`Draft created · ${fields} fields · ${added} photo${added === 1 ? "" : "s"}`);
    onDone({ listing: result.listing, imported: summary });
  }

  useEffect(() => {
    if (started.current || start.paste) return;
    started.current = true;
    void run({ url: start.url, sourceId: start.sourceId });
  }, []);

  const toPaste = (reason?: string) =>
    setPhase({ kind: "paste", url: start.url ?? "", content: "", reason });

  return (
    <Modal title="Import listing" onClose={onClose}>
      {phase.kind === "working" && (
        <>
          <HouseLoader {...progressCopy(phase.progress, now - phase.startedAt)} />
          {phase.link && phase.progress.kind !== "photos" && (
            <p className="note-line" style={{ margin: "10px 0 0", textAlign: "center" }}>
              Closing this window won't stop the import; the draft will still appear in
              your listings, just without photos.
            </p>
          )}
        </>
      )}

      {phase.kind === "error" && (
        <>
          <p className="err">{phase.message}</p>
          <div className="sheet-f">
            <button className="btn" type="button" onClick={onClose}>
              Close
            </button>
            {phase.canPaste && (
              <button className="btn primary" type="button" onClick={() => toPaste()}>
                Paste the page text instead
              </button>
            )}
          </div>
        </>
      )}

      {phase.kind === "paste" && (
        <form
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            const content = phase.content.trim();
            if (content.length < 40) return;
            void run({
              content,
              url: phase.url.trim() || undefined,
              sourceId: start.sourceId
            });
          }}
        >
          <p className="note-line" style={{ margin: 0 }}>
            {phase.reason ??
              "Open the listing in your browser, select all (⌘A), copy, and paste it here. Photos can't travel this way — add them afterwards."}
          </p>
          <Field label="Listing link (optional)">
            <input
              value={phase.url}
              placeholder="https://www.immobilienscout24.de/expose/…"
              onChange={(e) => setPhase({ ...phase, url: e.target.value })}
            />
          </Field>
          <Field label="Page text">
            <textarea
              value={phase.content}
              rows={10}
              placeholder="Kaufpreis 489.000 € · Wohnfläche 78 m² · 3 Zimmer · …"
              onChange={(e) => setPhase({ ...phase, content: e.target.value })}
            />
          </Field>
          <div className="sheet-f">
            <button className="btn" type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn primary"
              type="submit"
              disabled={phase.content.trim().length < 40}
            >
              Import from text
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
