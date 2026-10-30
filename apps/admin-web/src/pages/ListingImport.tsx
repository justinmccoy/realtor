import { useEffect, useRef, useState } from "react";
import {
  MAX_PHOTO_IMPORT_BATCH,
  type ImportRequest,
  type ImportResult
} from "@jj/shared";
import { api, ApiClientError } from "../api/client";
import { Field, Modal } from "../components/ui";
import type { EditorTarget, ImportSummary } from "./ListingEditor";

/** Photos pulled per import; anything beyond this the admin adds by hand. */
export const MAX_IMPORT_PHOTOS = 15;

export interface ImportStart {
  url?: string;
  sourceId?: string;
  /** Open on the paste form instead of fetching the link. */
  paste?: boolean;
}

type Phase =
  | { kind: "paste"; url: string; content: string; reason?: string }
  | { kind: "fetching"; label: string }
  | { kind: "photos"; done: number; total: number }
  | { kind: "error"; message: string; canPaste: boolean };

/**
 * Drives one import: link (or pasted text) → draft listing → photos in
 * batches → hands the draft to the editor. Lives in a modal so the admin
 * sees progress; a blocked portal flips it to the paste fallback.
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
      : { kind: "fetching", label: "Fetching the page and extracting details…" }
  );
  const started = useRef(false);

  async function run(req: ImportRequest) {
    const fail = (e: unknown, pasted: boolean) => {
      const blocked = e instanceof ApiClientError && e.code === "upstream_blocked";
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : "Import failed",
        canPaste: blocked || !pasted
      });
    };

    // Step 1 (link only): fetch the page in its own request. A proxied,
    // JS-rendered fetch can take 20 s, so it must not share the window with
    // the AI call.
    let extractReq: ImportRequest = req;
    if (req.url && req.content === undefined) {
      setPhase({ kind: "fetching", label: "Fetching the page…" });
      try {
        const page = await api.fetchImportPage(req.url, req.sourceId);
        extractReq = {
          url: page.finalUrl,
          sourceId: req.sourceId,
          content: page.html,
          fetchedVia: page.via
        };
      } catch (e) {
        fail(e, false);
        return;
      }
    }

    // Step 2: extract fields (markup + AI) and create the draft.
    setPhase({
      kind: "fetching",
      label: extractReq.fetchedVia
        ? "Page loaded. Extracting details…"
        : "Reading the pasted text…"
    });
    let result: ImportResult;
    try {
      result = await api.importListing(extractReq);
    } catch (e) {
      fail(e, extractReq.fetchedVia === undefined);
      return;
    }

    const urls = result.photoUrls.slice(0, MAX_IMPORT_PHOTOS);
    let added = 0;
    let failed = 0;
    for (let i = 0; i < urls.length; i += MAX_PHOTO_IMPORT_BATCH) {
      const batch = urls.slice(i, i + MAX_PHOTO_IMPORT_BATCH);
      setPhase({ kind: "photos", done: i, total: urls.length });
      try {
        const r = await api.importPhotos(result.listing.id, "photo", batch);
        added += r.items.filter((x) => x.ok).length;
        failed += r.items.filter((x) => !x.ok).length;
      } catch {
        failed += batch.length;
      }
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
      {phase.kind === "fetching" && (
        <p className="note-line" style={{ margin: 0 }}>
          {phase.label} This takes a few seconds.
        </p>
      )}

      {phase.kind === "photos" && (
        <p className="note-line" style={{ margin: 0 }}>
          Draft created. Importing photos {Math.min(phase.done + MAX_PHOTO_IMPORT_BATCH, phase.total)}{" "}
          / {phase.total}…
        </p>
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
