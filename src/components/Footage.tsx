import { useState } from "react";
import type { SamMasks, UploadedFile } from "../api";

const MODEL: Record<string, string> = { "muse-spark-open": "Muse Spark Open", "muse-spark-1.3": "Muse Spark 1.3", "muse-wonder-1.0": "Muse Wonder 1.0", "sam-3.1": "SAM 3.1" };

/** Which Meta model produced this; nothing for an unknown or unavailable model. */
export function ModelChip({ model, what }: { model: string; what?: string }) {
  const name = MODEL[model] ?? (model.startsWith("Muse") || model.startsWith("SAM") ? model : null);
  return name ? <span className="model">Meta {name}{what && <span className="what"> · {what}</span>}</span> : null;
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
        </svg>
      )}
      <figcaption className="mono">{n}</figcaption>
    </figure>
  );
}

export function FrameGrid({ surveyId, files, withMasks = false }: { surveyId: string; files: UploadedFile[]; withMasks?: boolean }) {
  return <div className="frames">{files.map((f, k) => <Frame key={f.id} surveyId={surveyId} f={f} n={k + 1} masks={withMasks ? f.masks : undefined} />)}</div>;
}

export function Clip({ surveyId, f }: { surveyId: string; f: UploadedFile }) {
  return <video className="clip" src={src(surveyId, f)} controls muted playsInline preload="metadata" aria-label="Narrated path clip" />;
}
