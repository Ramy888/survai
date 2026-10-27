// Source guards that cannot run inside the Workers test runtime (it has no file system).
// Model and footage text must never be rendered as HTML: React escapes text, so only these APIs could break that.
import { readdirSync, readFileSync, statSync } from "node:fs";

const files = [];
const walk = (dir) => { for (const f of readdirSync(dir)) { const p = `${dir}/${f}`; if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|jsx?)$/.test(f)) files.push(p); } };
walk("src");
walk("worker");
const bad = files.filter((f) => {
  const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); // comments do not count
  return /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(code);
});
if (bad.length) {
  console.error(`guards: raw HTML rendering found in ${bad.join(", ")}`);
  process.exit(1);
}
console.log(`guards: ${files.length} source files, no raw HTML rendering`);
