// Records the demo (docs/demo-script.md) in headless Chrome against LOCAL dev, live models, a drawn pointer.
// Start dev with a throwaway passcode (never the production one):
//   CLOUDFLARE_INCLUDE_PROCESS_ENV=true DEMO_PASSCODE=<test> npx vite dev --port 5173
// Then: DEMO_PASSCODE=<test> SAMPLE=<local survey id> SLUG=<local replay slug> node scripts/demo-video/record.mjs
// and in private/video/out: ffmpeg -f concat -safe 0 -i list.txt -vf "scale=1920:1200:force_original_aspect_ratio=decrease,
//   pad=1920:1200:(ow-iw)/2:(oh-ih)/2:color=0x101518,format=yuv420p" -r 30 -c:v libx264 -crf 18 demo-silent.mp4
// Uploads only the anonymised set in tools/prepare/out/demo-room-public. The judges' replay link never appears here.
import { launch, sleep } from "./cdp.mjs";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const B = "http://localhost:5173";
const { DEMO_PASSCODE: PASS, SAMPLE, SLUG } = process.env;
if (!PASS || !SAMPLE || !SLUG) throw new Error("DEMO_PASSCODE, SAMPLE and SLUG are required");
const MEDIA = resolve("tools/prepare/out/demo-room-public");
const DIR = resolve("private/video/out") + "/";
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR + "frames", { recursive: true });

const b = await launch({ scale: 4 / 3 });
const cues = [];
const cue = (text) => { cues.push({ at: b.mark(), text }); console.log(b.mark().toFixed(1), text); };
const hover = (x, y) => b.moveTo({ x, y });
// An on-screen label naming the Meta model at work in this beat (the app's own chips say it too, smaller)
const banner = (text) => b.evaluate(`(() => { document.getElementById("rec-banner")?.remove(); const t = ${JSON.stringify(text ?? "")}; if (!t) return;
  const d = document.createElement("div"); d.id = "rec-banner"; d.textContent = t;
  Object.assign(d.style, { position: "fixed", top: "14px", left: "50%", transform: "translateX(-50%)", zIndex: 2147483645, background: "#0B6770", color: "#fff",
    font: "600 17px/1.3 'JetBrains Mono', monospace", padding: "9px 16px", borderRadius: "8px", boxShadow: "0 4px 14px rgba(20,25,28,.25)", pointerEvents: "none", whiteSpace: "nowrap" });
  document.documentElement.appendChild(d); })()`);
const hoverSel = async (sel) => { await scrollTo(sel); await b.moveTo(await rect(sel)); };
const js = (fn, ...args) => b.evaluate(`(${fn})(...${JSON.stringify(args)})`);
const rect = async (sel) => {
  for (let i = 0; i < 40; i++) {
    const r = await js((s) => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: "nearest" }); const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; }, sel);
    if (r) return r;
    await sleep(250);
  }
  await b.shot(DIR + "fail.png"); throw new Error("missing " + sel);
};
const waitFor = async (cond, ms = 240_000, ...args) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) if (await js(cond, ...args)) return;
  await b.shot(DIR + "fail.png"); throw new Error("timed out: " + cond);
};
const pageHas = (t) => document.body.innerText.includes(t);
const scrollTo = async (sel) => { await js((s) => document.querySelector(s)?.scrollIntoView({ behavior: "smooth", block: "center" }), sel); await sleep(900); };
const scrollBy = async (dy) => { await js((d) => window.scrollBy({ top: d, behavior: "smooth" }), dy); await sleep(900); };
// type into a React input the way a person would: focus, clear, then characters
const fill = async (sel, text, perChar = 45) => {
  await scrollTo(sel); await b.moveTo(await rect(sel));
  await js((s) => { const e = document.querySelector(s); e.focus(); e.select?.(); }, sel);
  for (const ch of text) { await b.type(ch); await sleep(perChar); }
  await sleep(250);
};
// The pointer moves on camera, then the element itself is clicked: CDP mouse presses land at coordinates divided by
// the 4/3 screen scale, so they would hit whatever sits a quarter higher up the page.
const clickSel = async (sel) => {
  await scrollTo(sel); await b.moveTo(await rect(sel));
  await js((s) => { const r = document.getElementById("rec-ripple"), q = document.querySelector(s).getBoundingClientRect();
    if (r) { r.style.transition = "none"; r.style.left = q.x + q.width / 2 + "px"; r.style.top = q.y + q.height / 2 + "px"; r.style.opacity = 1; r.style.transform = "scale(.4)"; r.offsetWidth; r.style.transition = "opacity .5s, transform .5s"; r.style.opacity = 0; r.style.transform = "scale(1.6)"; }
    document.querySelector(s).click(); }, sel);
  await sleep(400);
};
const button = (text) => `[data-rec-btn="${text}"]`;
// marks the first visible button whose text is exactly `text` (optionally inside `within`) so clickSel can use it
const markButton = (text, within = "body") => js((t, w) => {
  document.querySelectorAll("[data-rec-btn]").forEach((e) => e.removeAttribute("data-rec-btn"));
  const el = [...document.querySelectorAll(`${w} button`)].find((e) => e.textContent.trim() === t && e.getBoundingClientRect().width > 0);
  if (el) el.setAttribute("data-rec-btn", t); return !!el;
}, text, within);
const press = async (text, within) => { await waitFor((t, w) => [...document.querySelectorAll(`${w} button`)].some((e) => e.textContent.trim() === t && !e.disabled), 240_000, text, within ?? "body"); await markButton(text, within); await clickSel(button(text)); };
const upload = async (inputId, files) => {
  const { result } = await b.send("Runtime.evaluate", { expression: `document.getElementById(${JSON.stringify(inputId)})` });
  await b.send("DOM.setFileInputFiles", { objectId: result.result.objectId, files });
};

// 1. Open on what the work produces: the app's own report sheet for an approved survey (never the company form)
await b.goto(`${B}/survey/${SAMPLE}/report`, 4000);
await b.startRec();
cue("problem: six departments, one equipment room, days of back-and-forth; this is the report SurvAI produces");
await sleep(1500); await hover(700, 300); await sleep(1000);
await scrollBy(700); await sleep(1000); await scrollBy(900); await sleep(1500);

// 2. New survey
b.pause();
await b.goto(B + "/", 3000);
await b.resume();
cue("new survey: site, project, device, and the departments that must agree");
await sleep(1500); // the one-line intro
await fill("#pass", PASS, 20);
await fill("#site", "Demo room", 30);
await fill("#project", "Router install", 30);
await fill("#model", "Juniper MX104", 30);
await scrollTo("#reps-h"); await hover(700, 400); await sleep(1200);
await press("Create survey");

// 3. Device: the datasheet lookup (live), then confirm
cue("device: Muse Spark looks up the datasheet and cites it");
b.pause();
await waitFor(pageHas, 120_000, "found the datasheet");
await banner("Meta Muse Spark 1.3 · found and cited the datasheet");
await b.resume();
await sleep(1000); await hoverSel(".found .model"); await sleep(2000); await hoverSel(".sources"); await sleep(1500);
await banner(null);
await press("Confirm device");

// 4. Upload the prepared, anonymised footage
await waitFor(pageHas, 30_000, "Upload footage");
cue("upload: 30 blurred key frames, a narrated path clip, panel photos");
await sleep(1500);
const frames = readdirSync(`${MEDIA}/frames`).filter((f) => /^frame-\d+\.jpg$/.test(f)).sort().map((f) => `${MEDIA}/frames/${f}`);
await hover(1150, 360); await sleep(500);
await upload("devices_hall-key_frame", frames);
b.pause(); await waitFor(() => !document.body.innerText.includes("Uploading"), 120_000); await b.resume();
await sleep(1200);
await upload("devices_hall-path_clip", [`${MEDIA}/path-clip.mp4`]);
b.pause(); await sleep(1000); await waitFor(() => !document.body.innerText.includes("Uploading"), 120_000); await b.resume();
await upload("devices_hall-panel_photo", [`${MEDIA}/photos/PWR1.jpg`, `${MEDIA}/photos/PWR2.jpg`]);
await upload("devices_hall-photo", [`${MEDIA}/photos/RACK1.jpg`, `${MEDIA}/photos/RACK2.jpg`]);
b.pause(); await sleep(1000); await waitFor(() => !document.body.innerText.includes("Uploading"), 120_000); await b.resume();
cue("the footage that goes to the models: blurred key frames, the narrated path clip, the photos");
await hoverSel(".preview .frames"); await sleep(2500);
await scrollTo(".clip"); await b.moveTo(await rect(".clip"));
await b.evaluate(`(() => { const v = document.querySelector(".clip"); v.currentTime = 3; return v.play().then(() => true, () => false); })()`);
await sleep(6500);
await b.evaluate(`document.querySelector(".clip").pause()`);
await scrollBy(400); await sleep(1500);
await press("Process footage");
cue("processing: SAM 3.1 finds racks and floor tiles; Muse reads the panel and the narrated clip");
await banner("Meta SAM 3.1 + Meta Muse Spark · processing the footage");
await sleep(4500);
b.pause();
await waitFor(pageHas, 300_000, "Check the layout");
await sleep(1500);
await b.resume();

// 5. Layout: what the models found, then the engineer corrects the draft
await banner("Meta Muse Spark 1.3 · read the Arabic narration");
cue("layout: the request read from the narrated clip");
await sleep(2000); await hoverSel(".req p"); await sleep(1500);
await banner("Meta SAM 3.1 · racks and floor tiles in every frame");
cue("what SAM 3.1 found: racks and floor tiles outlined on every key frame");
await scrollTo("#sam-h"); await sleep(800); await hoverSel(".frames .frame:nth-child(3)"); await sleep(1800); await hoverSel(".frames .frame:nth-child(7)"); await sleep(1800);
await banner("Meta Muse Spark · drafted the room on the 600 mm tile grid");
cue("layout: the drafted room on the 600 mm tile grid");
await hoverSel(".plan-panel"); await sleep(3000);
await banner(null);
const target = await js(() => { const tags = [...document.querySelectorAll(".rack .tag")]; const t = tags.find((e) => e.textContent.trim() === "R3") ?? tags[0]; const row = t?.closest(".rack"); row?.setAttribute("data-rec-target-rack", "1"); return t?.textContent.trim() ?? null; });
if (!target) throw new Error("no racks drafted");
cue(`fix: ${target} is the target rack, free from U10 to U30`);
await clickSel('[data-rec-target-rack] input[type=radio]');
await fill('[data-rec-target-rack] input[id^="f-"]', "10-30");
cue("fix: the breakers the panel photo could not read, confirmed on site; A/C and ladder");
for (const n of [3, 4]) {
  if (!(await js((k) => { const r = document.querySelectorAll(".brk")[k]; r?.setAttribute("data-rec-brk", String(k)); return !!r; }, n - 1))) break;
  const row = `[data-rec-brk="${n - 1}"]`;
  await fill(`${row} input[inputmode=numeric]`, "16", 60);
  await clickSel(`${row} .toggle input`);
}
if (!(await js(() => document.querySelector("#btu").value))) await fill("#btu", "6000");
if (!(await js(() => document.querySelector("#ac").value))) await fill("#ac", "2");
if (!(await js(() => document.querySelector("#lad").value))) await fill("#lad", "2.6");
await sleep(800);
await press("Layout is right, start meeting");

// 6. The meeting: rounds run live; the recording waits off camera and cuts to each round's result
await waitFor(pageHas, 30_000, "The meeting");
cue("meeting: the department agents review the room in parallel");
await banner("Meta Muse Spark Open · one agent per department · Meta Muse Wonder 1.0 leads");
await sleep(3000);
for (let round = 1; round <= 3; round++) {
  b.pause();
  await waitFor(() => /The meeting is over|need your answers/.test(document.body.innerText), 300_000);
  await sleep(800);
  await js(() => window.scrollTo({ top: 0 }));
  await b.resume();
  cue(`round ${round}: statements with rule ids, calculations and evidence frames; the Survey Lead sums up`);
  if (round > 1) await banner(null);
  await sleep(1500);
  await hoverSel(".tally"); await sleep(2000); // who approved, objected or asked
  const objector = await js(() => { const b = [...document.querySelectorAll(".tally-btn")].find((x) => x.querySelector(".chip.no")) ?? document.querySelector(".tally-btn"); b?.setAttribute("data-rec-btn", "tally"); return !!b; });
  if (objector) { await clickSel('[data-rec-btn="tally"]'); await sleep(2500); }
  await js(() => document.querySelector(".chat")?.scrollBy({ top: 420, behavior: "smooth" })); await sleep(2500);
  await scrollBy(500); await sleep(2000);
  if (await js(pageHas, "The meeting is over")) break;
  // answer the departments' questions as the site engineer (the owner played this part; the replay says so)
  cue("the engineer answers the departments' questions");
  const asks = await js(() => [...document.querySelectorAll(".ask")].map((a, k) => { a.setAttribute("data-rec-ask", String(k)); return { k, who: a.querySelector(".label")?.textContent ?? "", q: a.querySelector("p")?.textContent ?? "", yesNo: !!a.querySelector("button"), optional: /optional/i.test(a.textContent) }; }));
  for (const a of asks.filter((x) => !x.optional)) {
    const within = `[data-rec-ask="${a.k}"]`;
    if (a.yesNo) await press(/Power/.test(a.who) ? "No" : "Yes", within);
    // What the site engineer confirmed on the walk-through (the same facts the live sample used)
    else await fill(`${within} input`, (await js((s) => document.querySelector(s).inputMode, `${within} input`)) === "decimal" ? "2"
      : /breaker|power|feed|panel/i.test(a.q) ? "Only breakers 3 and 4 on the wall panel are free: 16 A DC each. No free 40 A breaker."
      : /fib|cable|route|ladder/i.test(a.q) ? "Two single-mode pairs, LC/LC, over the ladder to transmission rack 40."
      : /door|clear|swing/i.test(a.q) ? "The door opens inward; the aisle in front of it is clear." : "Checked on site: as shown in the layout.", 25);
  }
  await waitFor(() => [...document.querySelectorAll(".actions button")].some((e) => /^Send/.test(e.textContent) && !e.disabled), 10_000);
  await markButton(await js(() => [...document.querySelectorAll(".actions button")].find((e) => /^Send/.test(e.textContent)).textContent.trim()), ".actions");
  await clickSel("[data-rec-btn]");
  await waitFor(() => !document.body.innerText.includes("need your answers"), 30_000);
  await sleep(2500);
}

// 7. Approve: objections need a written reason; sign-off links
await press("Continue to approve");
await waitFor(pageHas, 30_000, "Approve and report");
cue("approve: every objection the engineer overrides needs a written reason");
await sleep(2000);
const reasons = await js(() => [...document.querySelectorAll("textarea[id^=why-]")].map((e) => ({ id: e.id, who: e.labels?.[0]?.textContent ?? "" })));
for (const r of reasons) {
  const text = /Power/.test(r.who) ? "Pre-install work order: free DC breakers of the datasheet rating on the panel before installation."
    : /Room Manager/.test(r.who) ? "Door clearance and rack positions checked on site before installation; the draft position is approximate."
    : "Checked by the site engineer on site before installation.";
  await fill(`#${r.id}`, text, 7);
}
await banner(null);
await fill("#specs", "SM fibre LC/LC duplex to the transmission rack; DC 2 x 6 mm2 from the panel", 8);
await press("Approve survey");
await waitFor(pageHas, 30_000, "Open the report");
cue("sign-off links: one per department, shown once");
await sleep(3500);
const link = await js(() => { const rows = [...document.querySelectorAll(".sub.mono")].map((e) => e.textContent); return rows.find((t) => t.includes("/s#")) ?? null; });
const linkAgent = await js(() => document.querySelector(".sub.mono")?.parentElement?.firstChild?.textContent ?? "");
await press("Open the report");

// 8. The report
await waitFor(pageHas, 30_000, "Site Survey Report");
cue("report: the survey form mirrored, approved items, rules, the floor plan with cable lengths, A4 print");
await sleep(2000); await scrollBy(800); await sleep(2000); await scrollBy(900); await sleep(2500); await scrollBy(900); await sleep(2000);
await js(() => window.scrollTo({ top: 0, behavior: "smooth" })); await sleep(1200);
if (await markButton("Print or save as PDF")) { await b.moveTo(await rect(button("Print or save as PDF"))); await sleep(1500); }

// 9. A department representative signs off from a phone
b.pause();
await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await b.goto(link, 3000);
await b.resume();
cue(`sign-off: the ${linkAgent} representative reviews their statement on a phone and approves`);
await sleep(2500); await scrollBy(500); await sleep(1500);
await fill("#rep", "A. Hassan", 60);
await press("Approve", '[aria-label="Decision"]');
await press("Send approval");
await sleep(3500);
b.pause();
await b.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 4 / 3, mobile: false });

// 10. The replay judges get, and the Meta models behind it
await b.goto(`${B}/replay/${SLUG}`, 4000);
await b.resume();
cue("replay: the whole meeting, with a live 'run the meeting again'");
await sleep(2000); await hoverSel(".made"); await sleep(3000); // how this survey was made
await scrollTo(".tally"); await sleep(2500);
if (await markButton("Run the meeting again")) { await scrollTo(button("Run the meeting again")); await b.moveTo(await rect(button("Run the meeting again"))); await sleep(2500); }
b.pause();
const card = `<!doctype html><meta charset=utf-8><body style="margin:0;height:100vh;display:grid;place-content:center;background:#EEF1F1;color:#14191C;font:20px/1.5 Barlow,system-ui,sans-serif">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600&family=Barlow:wght@400;500&family=JetBrains+Mono&display=swap" rel="stylesheet">
<div style="max-width:900px"><div style="font:600 64px/1.05 'Barlow Condensed'">Surv<span style="color:#0B6770">AI</span> runs on Meta models</div>
<table style="margin-top:28px;border-collapse:collapse;font-size:22px">${[
  ["SAM 3.1", "finds racks and floor tiles in every key frame"],
  ["Muse Spark Open (Baseten)", "drafts the room, speaks for each department"],
  ["Muse Spark 1.3", "reads the narrated clip, the power panel and the datasheet"],
  ["Muse Wonder 1.0", "the Survey Lead: places the device and resolves conflicts"],
].map(([m, r]) => `<tr><td style="padding:10px 28px 10px 0;font-family:'JetBrains Mono';white-space:nowrap">${m}</td><td style="padding:10px 0;border-top:1px solid #D9E0E2">${r}</td></tr>`).join("")}</table></div>`;
await b.goto("data:text/html;charset=utf-8," + encodeURIComponent(card), 2500);
await b.resume();
cue("Meta models used");
await sleep(6000);

const { frames: shots, end } = await b.stopRec();
b.close();

// frames -> constant 30 fps: each output slot shows the newest frame captured by then
const FPS = 30, start = shots[0].t, slots = Math.ceil((end - start) * FPS);
const list = []; let j = 0; const written = new Map();
for (let s = 0; s < slots; s++) {
  const t = start + s / FPS;
  while (j + 1 < shots.length && shots[j + 1].t <= t) j++;
  if (!written.has(j)) { const name = `frames/${String(j).padStart(5, "0")}.jpg`; writeFileSync(DIR + name, Buffer.from(shots[j].data, "base64")); written.set(j, name); }
  list.push(`file '${written.get(j)}'`, `duration ${(1 / FPS).toFixed(6)}`);
}
list.push(list[list.length - 2]);
writeFileSync(DIR + "list.txt", list.join("\n") + "\n");
writeFileSync(DIR + "cues.json", JSON.stringify(cues.map((c) => ({ at: Math.max(0, c.at - start), text: c.text })), null, 1));
console.log(`frames ${shots.length}, length ${(end - start).toFixed(1)} s`);
