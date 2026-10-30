// Cut a recorded take to length, beat by beat. Each beat runs from its cue to the next one (cues.json from record.mjs).
// Usage: node cut.mjs <silent.mp4> <cues.json> <plan.json> <out.mp4>
// plan.json: [{ "cue": "<start of the cue text>", "speed": 3 } | { "cue": "...", "keep": 6 } | { "cue": "...", "drop": true }]
// speed plays the beat faster; from skips its first seconds; keep keeps only the next seconds; beats not in the plan
// play as recorded.
// It writes <out>.cues.json: each beat's start in the cut, for timing the narration.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [video, cuesFile, planFile, out] = process.argv.slice(2);
const cues = JSON.parse(readFileSync(cuesFile, "utf8"));
const plan = JSON.parse(readFileSync(planFile, "utf8"));
const length = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).toString());

const parts = [], timeline = [];
let at = 0;
for (const [k, c] of cues.entries()) {
  const rule = plan.find((p) => c.text.startsWith(p.cue)) ?? {};
  const start = (k === 0 ? 0 : c.at) + (rule.from ?? 0), end = cues[k + 1]?.at ?? length;
  if (rule.drop || end - start < 0.05) continue;
  const to = rule.keep ? Math.min(end, start + rule.keep) : end;
  const speed = rule.speed ?? 1;
  parts.push({ start, to, speed });
  timeline.push({ at: Math.round(at * 10) / 10, seconds: Math.round(((to - start) / speed) * 10) / 10, text: c.text });
  at += (to - start) / speed;
}
const filter = parts.map((p, i) => `[0:v]trim=${p.start.toFixed(3)}:${p.to.toFixed(3)},setpts=(PTS-STARTPTS)/${p.speed}[v${i}]`).join(";")
  + `;${parts.map((_, i) => `[v${i}]`).join("")}concat=n=${parts.length}:v=1:a=0,fps=30,format=yuv420p[out]`;
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-filter_complex", filter, "-map", "[out]", "-c:v", "libx264", "-crf", "18", out], { stdio: "inherit" });
writeFileSync(`${out}.cues.json`, JSON.stringify(timeline, null, 1));
console.log(`cut: ${at.toFixed(1)} s from ${length.toFixed(1)} s`);
for (const t of timeline) console.log(String(t.at).padStart(6), String(t.seconds).padStart(5), t.text.slice(0, 70));
