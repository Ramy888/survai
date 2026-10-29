// Frame picking for an uploaded walk-through video, ported from tools/prepare/prepare.py so the in-app path picks
// the same frames as the script: score sharpness, then the sharpest frame per equal time segment.

/** Variance of the Laplacian on grey pixels (OpenCV's default 3x3 kernel, reflect-101 borders), as in prepare.py.
 * Draw the frame 480 px wide first, as the script does, so scores compare across videos. */
export function sharpness(img: { data: Uint8ClampedArray; width: number; height: number }) {
  const { data, width: w, height: h } = img;
  const grey = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grey[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const at = (x: number, y: number) => {
    const rx = x < 0 ? -x : x >= w ? 2 * w - x - 2 : x;
    const ry = y < 0 ? -y : y >= h ? 2 * h - y - 2 : y;
    return grey[Math.min(Math.max(ry, 0), h - 1) * w + Math.min(Math.max(rx, 0), w - 1)];
  };
  let sum = 0;
  let sq = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * at(x, y);
      sum += v;
      sq += v * v;
    }
  }
  const n = w * h;
  return n ? sq / n - (sum / n) ** 2 : 0;
}

/** Sharpest frame per equal time segment, never two picks closer than minGap seconds (prepare.py pick_sharpest). */
export function pickSharpest(times: number[], scores: number[], n: number, minGap: number, exclude: Set<number> = new Set()) {
  if (!times.length) return [];
  const t0 = times[0];
  const span = Math.max(times.at(-1)! - t0, 1e-9);
  const segments: [number, number][][] = Array.from({ length: n }, () => []);
  times.forEach((t, k) => {
    if (!exclude.has(t)) segments[Math.min(Math.floor(((t - t0) / span) * n), n - 1)].push([scores[k], t]);
  });
  const picked: number[] = [];
  for (const seg of segments) {
    // Python sorts (score, time) tuples descending: on equal scores the later time wins.
    for (const [, t] of seg.sort((a, b) => b[0] - a[0] || b[1] - a[1])) {
      if (picked.every((p) => Math.abs(t - p) >= minGap)) { picked.push(t); break; }
    }
  }
  return picked.sort((a, b) => a - b);
}
