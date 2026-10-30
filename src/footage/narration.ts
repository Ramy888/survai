// The narration in a walk-through video, in the browser: its sound decoded for a waveform, so the engineer sees it
// was found before the video goes to Muse Spark 1.3 to be transcribed.

/** Loudest sample per bucket, 0..1, for a bar waveform. */
export function peaks(samples: Float32Array, buckets: number): number[] {
  const size = Math.max(1, Math.floor(samples.length / buckets));
  const out: number[] = [];
  for (let b = 0; b < buckets && b * size < samples.length; b++) {
    let max = 0;
    for (let i = b * size; i < Math.min(samples.length, (b + 1) * size); i++) max = Math.max(max, Math.abs(samples[i]));
    out.push(Math.min(1, max));
  }
  return out;
}

/** The video's sound as waveform bars, or null when it has no sound track the browser can decode. */
export async function narrationOf(file: File, buckets = 120): Promise<{ seconds: number; bars: number[] } | null> {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    const bars = peaks(audio.getChannelData(0), buckets);
    return bars.some((p) => p > 0.02) ? { seconds: audio.duration, bars } : null; // silence is no narration
  } catch {
    return null;
  } finally {
    void ctx.close();
  }
}
