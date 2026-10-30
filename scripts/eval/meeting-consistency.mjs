// Accuracy check: does the meeting reach the same round-1 decision when it is run again on the same room?
// Starts N new runs one after another and records each run's round 1: every department's verdict, the rules the app
// forced, and the Survey Lead's placement. Results go to docs/eval/meeting-consistency.json.
// Usage: DEMO_PASSCODE=... node scripts/eval/meeting-consistency.mjs <base-url> <survey-id> [runs=3]
import { mkdirSync, writeFileSync } from "node:fs";

const [base, id, n = "3"] = process.argv.slice(2);
const headers = { "Content-Type": "application/json", "X-Passcode": process.env.DEMO_PASSCODE ?? "" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runs = [];
for (let k = 0; k < Number(n); k++) {
  const before = (await (await fetch(`${base}/api/surveys/${id}/timeline`)).json()).run ?? 0;
  const start = await fetch(`${base}/api/surveys/${id}/deliberate`, { method: "POST", headers, body: "{}" });
  if (!start.ok) throw new Error(`start failed: ${start.status} ${await start.text()}`);
  const t0 = Date.now();
  let r1;
  while (!r1?.lead) {
    await sleep(4000);
    const t = await (await fetch(`${base}/api/surveys/${id}/timeline`)).json();
    r1 = t.run > before && t.rounds.find((r) => r.round === 1); // the new run, not the one before it
    if (Date.now() - t0 > 600_000) throw new Error("round 1 took over 10 minutes");
  }
  runs.push({
    seconds: Math.round((Date.now() - t0) / 1000),
    placement: r1.lead.placement.target,
    verdicts: Object.fromEntries(r1.findings.map((f) => [f.agent, f.verdict])),
    forced: Object.fromEntries(r1.findings.map((f) => [f.agent, f.forced_rules])),
  });
  console.log(JSON.stringify(runs.at(-1)));
}
mkdirSync("docs/eval", { recursive: true });
writeFileSync("docs/eval/meeting-consistency.json", JSON.stringify({ survey: "local test room", runs }, null, 1) + "\n");
