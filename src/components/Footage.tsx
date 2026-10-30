import { useEffect, useRef, useState } from "react";
import type { SamMasks, UploadedFile } from "../api";

const MODEL: Record<string, [name: string, about: string]> = {
  "muse-spark-open": ["Muse Spark Open", "Meta's open-weights Muse Spark"],
  "muse-spark-1.3": ["Muse Spark 1.3", "Meta's multimodal model on the Meta Model API"],
  "muse-wonder-1.0": ["Muse Wonder 1.0", "Meta's reasoning model on the Meta Model API"],
  "sam-3.1": ["SAM 3.1", "Meta's Segment Anything Model 3.1"],
};
export const modelName = (model: string) => MODEL[model]?.[0] ?? null;

/** Which Meta model produced this, by its id; nothing for an unknown or unavailable model. */
export function ModelChip({ model, what }: { model: string; what?: string }) {
  if (model === "unavailable") return <span className="model none">No model answered</span>;
  const m = MODEL[model];
  return m ? <span className="model" title={m[1]}>Meta {m[0]}{what && <span className="what"> · {what}</span>}</span> : null;
}

const src = (surveyId: string, f: UploadedFile) => `/api/surveys/${surveyId}/files/${f.id}`;

/** One key frame; with `masks`, SAM 3.1's boxes drawn over it (racks solid, floor tiles dashed). */
function Frame({ surveyId, f, n, masks }: { surveyId: string; f: UploadedFile; n: number; masks?: SamMasks }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <figure className="frame">
      <img src={src(surveyId, f)} alt={`Key frame ${n}`} loading="lazy" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      {masks && size && (
        <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" aria-hidden="true">
          {masks.tiles.map((b, k) => <rect key={`t${k}`} className="tile" x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} />)}
          {masks.racks.map((b, k) => <rect key={`r${k}`} className="rack" x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} />)}
          {masks.shelves?.map((b, k) => <rect key={`s${k}`} className="shelf" x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} />)}
          {masks.devices?.map((b, k) => <rect key={`d${k}`} className="device" x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} />)}
        </svg>
      )}
      <figcaption className="mono">{n}</figcaption>
    </figure>
  );
}

export function FrameGrid({ surveyId, files, withMasks = false }: { surveyId: string; files: UploadedFile[]; withMasks?: boolean }) {
  return <div className="frames">{files.map((f, k) => <Frame key={f.id} surveyId={surveyId} f={f} n={k + 1} masks={withMasks ? f.masks : undefined} />)}</div>;
}

/** The narrated clip: a dark holder with a spinner until its first frame is in (the server serves byte ranges, so
 * that is the first few hundred kB, not the whole file); "#t=0.1" makes that frame the poster. */
export function Clip({ surveyId, f }: { surveyId: string; f: UploadedFile }) {
  const [ready, setReady] = useState(false);
  return (
    <div className="clip-wrap">
      <video className="clip" src={`${src(surveyId, f)}#t=0.1`} controls muted playsInline preload="metadata" aria-label="Narrated video"
        onLoadedData={() => setReady(true)} onError={() => setReady(true)} />
      {!ready && <span className="clip-wait" aria-hidden="true"><span className="spin" /></span>}
    </div>
  );
}

/** Frames in one horizontal row; with `follow`, the row keeps the newest frame in view as frames arrive. */
type StripItem = { key: string; src: string; n: number; found?: { w: number; h: number; boxes: { x1: number; y1: number; x2: number; y2: number }[] } };
/** A row of frames; with `found`, the areas Meta SAM 3.1 found (and the browser blurred) are outlined on each one. */
export function FrameStrip({ items, follow = false }: { items: StripItem[]; follow?: boolean }) {
  const row = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = row.current;
    if (follow && el) el.scrollTo({ left: el.scrollWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [items.length, follow]);
  if (!items.length) return null;
  return (
    <ul className="strip" ref={row}>
      {items.map((it) => (
        <li key={it.key}>
          <img src={it.src} alt={`Frame ${it.n}`} loading="lazy" />
          {it.found && it.found.boxes.length > 0 && (
            // slice matches the image's object-fit: cover, so the outlines sit on what was blurred
            <svg viewBox={`0 0 ${it.found.w} ${it.found.h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
              {it.found.boxes.map((b, k) => <rect key={k} x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} />)}
            </svg>
          )}
          <span className="mono">{it.n}{it.found?.boxes.length ? ` · ${it.found.boxes.length}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

export const fileSrc = src;
