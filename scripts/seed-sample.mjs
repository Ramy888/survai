// Flag an approved survey as the public replay sample (/replay/sample). It copies nothing: the sample is a survey run
// and approved for real in that environment. Only one survey holds the slug at a time.
// Usage: node scripts/seed-sample.mjs [--remote] <survey-id>
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const id = args.find((a) => a !== "--remote");
if (!/^[0-9a-f-]{36}$/.test(id ?? "")) {
  console.error("Usage: node scripts/seed-sample.mjs [--remote] <survey-id>");
  process.exit(1);
}
const sql = `UPDATE surveys SET is_sample = 0, replay_slug = NULL WHERE replay_slug = 'sample' AND id <> '${id}';
UPDATE surveys SET is_sample = 1, replay_slug = 'sample',
  approved_run = COALESCE(approved_run, (SELECT MAX(run) FROM lead_notes WHERE survey_id = '${id}'))
  WHERE id = '${id}' AND status = 'approved';
SELECT id, status, is_sample, replay_slug, approved_run FROM surveys WHERE id = '${id}';`;
const out = execFileSync("npx", ["wrangler", "d1", "execute", "survai", remote ? "--remote" : "--local", "--json", "--command", sql], { encoding: "utf8" });
const row = JSON.parse(out).at(-1)?.results?.[0];
if (!row) throw new Error(`survey ${id} not found`);
if (row.is_sample !== 1) throw new Error(`survey ${id} is ${row.status}; only an approved survey can be the sample`);
console.log(`${remote ? "remote" : "local"}: ${id} is the sample (approved run ${row.approved_run}); open /replay/sample`);
