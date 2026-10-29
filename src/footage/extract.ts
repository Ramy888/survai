// Key frames from a walk-through video, in the browser: nothing is uploaded until the picks are made.
// Same steps as tools/prepare's `frames` command: score sharpness at a few frames per second on a 480 px copy,
// pick the sharpest per time segment (1 s apart), then capture the picks at up to 1280 px.
import { pickSharpest, sharpness } from "./pick";

const MAX_SIDE = 1280; // prepare.py MAX_SIDE
const SCORE_WIDTH = 480; // prepare.py scores a 480 px wide copy

export type Progress = { stage: "reading" | "scoring" | "capturing"; done: number; total: number };
export type PickedFrame = { t: number; blob: Blob };

export class UnreadableVideo extends Error {}

function seek(video: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve, reject) => {
    const done = () => { clearTimeout(timer); video.removeEventListener("seeked", done); resolve(); };
    const timer = setTimeout(() => { video.removeEventListener("seeked", done); reject(new UnreadableVideo("The video stopped responding while reading frames.")); }, 8000);
    video.addEventListener("seeked", done);
    video.currentTime = t;
  });
}

export async function framesFromVideo(file: File, count: number, onProgress: (p: Progress) => void): Promise<{ frames: PickedFrame[]; duration: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    onProgress({ stage: "reading", done: 0, total: 1 });
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new UnreadableVideo("This browser can't read this video. Export it as MP4 (H.264), or open SurvAI in Safari."));
      video.src = url;
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth) throw new UnreadableVideo("This video has no frames this browser can read.");

    // Score: 3 frames a second (2 for long videos keeps a phone under a minute).
    const fps = duration > 120 ? 2 : 3;
    const times = Array.from({ length: Math.floor(duration * fps) }, (_, k) => k / fps);
    const small = document.createElement("canvas");
    small.width = SCORE_WIDTH;
    small.height = Math.round((SCORE_WIDTH * video.videoHeight) / video.videoWidth);
    const sctx = small.getContext("2d", { willReadFrequently: true })!;
    const scores: number[] = [];
    for (const [k, t] of times.entries()) {
      await seek(video, t);
      sctx.drawImage(video, 0, 0, small.width, small.height);
      scores.push(sharpness(sctx.getImageData(0, 0, small.width, small.height)));
      onProgress({ stage: "scoring", done: k + 1, total: times.length });
    }

    // Capture the picks at full size, capped like the script.
    const picks = pickSharpest(times, scores, count, 1.0);
    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const big = document.createElement("canvas");
    big.width = Math.round(video.videoWidth * scale);
    big.height = Math.round(video.videoHeight * scale);
    const bctx = big.getContext("2d")!;
    const frames: PickedFrame[] = [];
    for (const [k, t] of picks.entries()) {
      await seek(video, t);
      bctx.drawImage(video, 0, 0, big.width, big.height);
      const blob = await new Promise<Blob | null>((r) => big.toBlob(r, "image/jpeg", 0.88));
      if (!blob) throw new UnreadableVideo("Could not save a frame from this video.");
      frames.push({ t, blob });
      onProgress({ stage: "capturing", done: k + 1, total: picks.length });
    }
    return { frames, duration };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
