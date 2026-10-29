// Blurring a picked frame in the browser, the way tools/prepare does: pad each box by 15%, pixelate it, then blur
// it, so the content cannot be sharpened back. The boxes come from Meta SAM 3.1 (labels, people) or the engineer.

export type Box = { x1: number; y1: number; x2: number; y2: number };

const PAD = 0.15; // prepare.py PAD

/** Grow a box by 15% of its size on every side, clamped to the image (prepare.py to_pixels). */
export function padBox(b: Box, width: number, height: number, pad = PAD): Box {
  const w = b.x2 - b.x1;
  const h = b.y2 - b.y1;
  return {
    x1: Math.max(0, Math.floor(b.x1 - pad * w)), y1: Math.max(0, Math.floor(b.y1 - pad * h)),
    x2: Math.min(width, Math.ceil(b.x2 + pad * w)), y2: Math.min(height, Math.ceil(b.y2 + pad * h)),
  };
}

/** Share of the frame the boxes cover, overlaps counted once (prepare.py coverage). */
export function coverage(boxes: Box[], width: number, height: number) {
  const mask = new Uint8Array(width * height);
  for (const b of boxes) {
    for (let y = Math.max(0, b.y1); y < Math.min(height, b.y2); y++) mask.fill(1, y * width + Math.max(0, b.x1), y * width + Math.min(width, b.x2));
  }
  let n = 0;
  for (const v of mask) n += v;
  return width * height ? n / (width * height) : 0;
}

/** SAM answers in the pixels of the image it saw; map its boxes onto the frame being blurred. */
export function scaleBoxes(boxes: Box[], fromW: number, fromH: number, toW: number, toH: number): Box[] {
  const sx = toW / (fromW || toW);
  const sy = toH / (fromH || toH);
  return boxes.map((b) => ({ x1: Math.round(b.x1 * sx), y1: Math.round(b.y1 * sy), x2: Math.round(b.x2 * sx), y2: Math.round(b.y2 * sy) }));
}

/** Pixelate then blur each (padded) box on the canvas, in place (prepare.py blur_boxes). */
export function blurOnCanvas(ctx: CanvasRenderingContext2D, boxes: Box[]) {
  const { width, height } = ctx.canvas;
  for (const raw of boxes) {
    const b = padBox(raw, width, height);
    const w = b.x2 - b.x1;
    const h = b.y2 - b.y1;
    if (w < 2 || h < 2) continue;
    const cell = Math.max(6, Math.floor(Math.min(w, h) / 8)); // blocks grow with the box, as in the script
    const tiny = document.createElement("canvas");
    tiny.width = Math.max(1, Math.floor(w / cell));
    tiny.height = Math.max(1, Math.floor(h / cell));
    tiny.getContext("2d")!.drawImage(ctx.canvas, b.x1, b.y1, w, h, 0, 0, tiny.width, tiny.height);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, b.x1, b.y1, w, h);
    ctx.restore();
    // A soft blur over the blocks where the browser supports canvas filters; the blocks alone are already unreadable.
    if ("filter" in ctx) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x1, b.y1, w, h);
      ctx.clip();
      ctx.filter = `blur(${Math.max(2, Math.floor(Math.min(w, h) / 12))}px)`;
      ctx.drawImage(ctx.canvas, b.x1, b.y1, w, h, b.x1, b.y1, w, h);
      ctx.restore();
    }
  }
}

/** The frame with its boxes blurred, as the JPEG that gets uploaded. */
export async function blurredBlob(frame: Blob, width: number, height: number, boxes: Box[]): Promise<Blob> {
  const bitmap = await createImageBitmap(frame);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  blurOnCanvas(ctx, boxes);
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
  if (!out) throw new Error("Could not blur a frame");
  return out;
}
