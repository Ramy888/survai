// Flag an approved survey as the replay sample. It copies nothing: the sample is a survey run and approved for real in
// that environment. The slug is random: the replay is unlisted and its link goes to the judges only, never in the repo,
// the video or the public submission text. Re-running gives the survey a new slug, so the old link stops working.
// Usage: node scripts/seed-sample.mjs [--remote] <survey-id>
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const id = args.find((a) => a !== "--remote");
if (!/^[0-9a-f-]{36}$/.test(id ?? "")) {
  console.error("Usage: node scripts/seed-sample.mjs [--remote] <survey-id>");
  process.exit(1);
}
const slug = `s-${randomBytes(12).toString("hex")}`; // 96 random bits; matches the app's /replay/:slug route
const sql = `UPDATE surveys SET is_sample = 0, replay_slug = NULL WHERE is_sample = 1 AND id <> '${id}';
UPDATE surveys SET is_sample = 1, replay_slug = '${slug}',
  approved_run = COALESCE(approved_run, (SELECT MAX(run) FROM lead_notes WHERE survey_id = '${id}'))
  WHERE id = '${id}' AND status = 'approved';
SELECT id, status, is_sample, replay_slug, approved_run FROM surveys WHERE id = '${id}';`;
const out = execFileSync("npx", ["wrangler", "d1", "execute", "survai", remote ? "--remote" : "--local", "--json", "--command", sql], { encoding: "utf8" });
const row = JSON.parse(out).at(-1)?.results?.[0];
if (!row) throw new Error(`survey ${id} not found`);
if (row.is_sample !== 1) throw new Error(`survey ${id} is ${row.status}; only an approved survey can be the sample`);
console.log(`${remote ? "remote" : "local"}: ${id} is the sample (approved run ${row.approved_run})`);
console.log(`Replay (judges only, do not publish): /replay/${slug}`);
