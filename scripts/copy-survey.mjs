// Copy one survey, as run, from the local dev database and media to production: its rows (survey, departments,
// rooms, files, layout, findings, questions, calculations, Lead notes, sign-offs, device) and its stored media (the
// blurred key frames and photos). Used to publish the survey recorded in the demo video as the public sample; it copies
// what the models and the engineer produced, it does not change it. Then run seed-sample.mjs --remote <id>.
// Usage: node scripts/copy-survey.mjs <survey-id>
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const id = process.argv[2];
if (!/^[0-9a-f-]{36}$/.test(id ?? "")) { console.error("Usage: node scripts/copy-survey.mjs <survey-id>"); process.exit(1); }

const wrangler = (args) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const rows = (sql) => JSON.parse(wrangler(["d1", "execute", "survai", "--local", "--json", "--command", sql])).at(-1).results;
const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);

const rooms = `(SELECT id FROM rooms WHERE survey_id = '${id}')`;
// Parents first, so every reference already exists when its child row arrives.
const tables = [
  ["surveys", `id = '${id}'`], ["survey_reps", `survey_id = '${id}'`], ["device_specs", `survey_id = '${id}'`],
  ["rooms", `survey_id = '${id}'`], ["files", `room_id IN ${rooms}`], ["layout_items", `room_id IN ${rooms}`],
  ["findings", `survey_id = '${id}'`], ["questions", `finding_id IN (SELECT id FROM findings WHERE survey_id = '${id}')`],
  ["calcs", `survey_id = '${id}'`], ["lead_notes", `survey_id = '${id}'`], ["signoffs", `survey_id = '${id}'`],
];
const statements = [];
let files = [];
for (const [table, where] of tables) {
  const found = rows(`SELECT * FROM ${table} WHERE ${where}`);
  if (table === "surveys" && found.length !== 1) throw new Error(`survey ${id} not found locally`);
  if (table === "files") files = found;
  for (const r of found) {
    // The sample flag and slug are set in production by seed-sample.mjs, never copied.
    const row = table === "surveys" ? { ...r, is_sample: 0, replay_slug: null } : r;
    statements.push(`INSERT OR REPLACE INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).map(q).join(", ")});`);
  }
  console.log(`${table}: ${found.length}`);
}
const dir = mkdtempSync(join(tmpdir(), "survai-copy-"));
writeFileSync(join(dir, "copy.sql"), statements.join("\n"));
wrangler(["d1", "execute", "survai", "--remote", "--file", join(dir, "copy.sql")]);
console.log(`rows written to production: ${statements.length}`);

let copied = 0;
for (const f of files) {
  const local = join(dir, f.id);
  wrangler(["r2", "object", "get", `survai-media/${f.r2_key}`, "--local", "--file", local]);
  const type = f.r2_key.endsWith(".png") ? "image/png" : f.r2_key.endsWith(".mp4") ? "video/mp4" : "image/jpeg";
  wrangler(["r2", "object", "put", `survai-media/${f.r2_key}`, "--file", local, "--content-type", type, "--remote"]);
  copied++;
}
console.log(`media copied to production: ${copied} of ${files.length}`);
