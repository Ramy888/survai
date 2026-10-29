// Review before upload: every picked frame shown blurred, with the boxes Meta SAM 3.1 found. The engineer can remove
// a box (tap ×) or draw one over anything still readable (drag). Nothing is uploaded until they confirm.
import { useEffect, useRef, useState } from "react";
import { blurOnCanvas, coverage, padBox, type Box } from "./blur";

export type ReviewFrame = { t: number; blob: Blob; width: number; height: number; boxes: Box[] };

const MAX_COVER = 0.4; // tools/prepare: a frame blurred over more than this shows little that is useful

/** The frame with its boxes blurred, as a JPEG: what gets uploaded. */
export async function blurredBlob(f: ReviewFrame): Promise<Blob> {
  const bitmap = await createImageBitmap(f.blob);
  const canvas = document.createElement("canvas");
  canvas.width = f.width;
  canvas.height = f.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, f.width, f.height);
  bitmap.close();
  blurOnCanvas(ctx, f.boxes);
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
  if (!out) throw new Error("Could not blur a frame");
  return out;
}

const covered = (f: ReviewFrame) => coverage(f.boxes.map((b) => padBox(b, f.width, f.height)), f.width, f.height);

export function Review({ frames, onChange, onUpload, onCancel, busy }: {
  frames: ReviewFrame[]; onChange: (k: number, boxes: Box[]) => void; onUpload: () => void; onCancel: () => void; busy: boolean;
}) {
  const [urls, setUrls] = useState<string[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  // Re-render the blurred previews whenever boxes change.
  useEffect(() => {
    let live = true;
    const made: string[] = [];
    void Promise.all(frames.map(async (f) => URL.createObjectURL(await blurredBlob(f)))).then((u) => {
      made.push(...u);
      if (live) setUrls(u); else u.forEach((x) => URL.revokeObjectURL(x));
    });
    return () => { live = false; made.forEach((x) => URL.revokeObjectURL(x)); };
  }, [frames]);

  const total = frames.reduce((n, f) => n + f.boxes.length, 0);
  const heavy = frames.filter((f) => covered(f) > MAX_COVER).length;
  return (
    <div className="review">
      <p className="review-sum"><b>{total} areas blurred</b> across {frames.length} frames{heavy ? ` · ${heavy} mostly blurred` : ""}.
        {" "}Tap a frame to check it: remove a box with ×, or drag over anything still readable.</p>
      <ul className="review-grid">
        {frames.map((f, k) => (
          <li key={f.t}>
            <button type="button" className={`review-tile${open === k ? " on" : ""}`} onClick={() => setOpen(open === k ? null : k)} aria-label={`Frame ${k + 1}: ${f.boxes.length} blurred areas`}>
              {urls[k] ? <img src={urls[k]} alt="" /> : <span className="review-wait" />}
              <span className="review-n mono">{k + 1}</span>
              {f.boxes.length > 0 && <span className={`review-count mono${covered(f) > MAX_COVER ? " heavy" : ""}`}>{f.boxes.length}</span>}
            </button>
          </li>
        ))}
      </ul>
      {open !== null && frames[open] && urls[open] && (
        <Editor k={open} f={frames[open]} url={urls[open]} onChange={(b) => onChange(open, b)} onClose={() => setOpen(null)} />
      )}
      <div className="review-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Choose another video</button>
        <button type="button" className="btn btn-primary" onClick={onUpload} disabled={busy}>{busy ? "Uploading…" : `Upload ${frames.length} blurred frames`}</button>
      </div>
    </div>
  );
}

function Editor({ k, f, url, onChange, onClose }: { k: number; f: ReviewFrame; url: string; onChange: (b: Box[]) => void; onClose: () => void }) {
  const area = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const at = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const pct = (b: Box) => ({ left: `${(b.x1 / f.width) * 100}%`, top: `${(b.y1 / f.height) * 100}%`, width: `${((b.x2 - b.x1) / f.width) * 100}%`, height: `${((b.y2 - b.y1) / f.height) * 100}%` });
  const live = drag && { x1: Math.min(drag.x, drag.x2) * f.width, y1: Math.min(drag.y, drag.y2) * f.height, x2: Math.max(drag.x, drag.x2) * f.width, y2: Math.max(drag.y, drag.y2) * f.height };
  return (
    <div className="review-editor">
      <div className="title-row"><b>Frame {k + 1}</b><button type="button" className="link-btn" onClick={onClose}>Done</button></div>
      <div ref={area} className="review-canvas" style={{ aspectRatio: `${f.width} / ${f.height}` }}
        onPointerDown={(e) => { if ((e.target as HTMLElement).closest("button")) return; const p = at(e); area.current!.setPointerCapture(e.pointerId); setDrag({ x: p.x, y: p.y, x2: p.x, y2: p.y }); }}
        onPointerMove={(e) => { if (drag) { const p = at(e); setDrag({ ...drag, x2: p.x, y2: p.y }); } }}
        onPointerUp={() => {
          if (live && live.x2 - live.x1 > 8 && live.y2 - live.y1 > 8) onChange([...f.boxes, { x1: Math.round(live.x1), y1: Math.round(live.y1), x2: Math.round(live.x2), y2: Math.round(live.y2) }]);
          setDrag(null);
        }}>
        <img src={url} alt={`Frame ${k + 1}, blurred`} draggable={false} />
        {f.boxes.map((b, i) => (
          <span key={i} className="review-box" style={pct(b)}>
            <button type="button" aria-label={`Remove blurred area ${i + 1}`} onClick={() => onChange(f.boxes.filter((_, j) => j !== i))}>×</button>
          </span>
        ))}
        {live && <span className="review-box drawing" style={pct(live)} />}
      </div>
      <p className="muted small">Drag over a face, label or logo that is still readable. Each box is blurred with a 15% margin.</p>
    </div>
  );
}
