// Records the demo (docs/demo-script.md) in headless Chrome against LOCAL dev, live models, a drawn pointer.
// Start dev with a throwaway passcode (never the production one):
//   CLOUDFLARE_INCLUDE_PROCESS_ENV=true DEMO_PASSCODE=<test> npx vite dev --port 5173
// Then: DEMO_PASSCODE=<test> SAMPLE=<local survey id> SLUG=<local replay slug> node scripts/demo-video/record.mjs
// and in private/video/out: ffmpeg -f concat -safe 0 -i list.txt -vf "scale=1920:1200:force_original_aspect_ratio=decrease,
//   pad=1920:1200:(ow-iw)/2:(oh-ih)/2:color=0x101518,format=yuv420p" -r 30 -c:v libx264 -crf 18 demo-silent.mp4
// Uploads only the anonymised set in tools/prepare/out/demo-room-public. The public sample link closes the video.
import { pathToFileURL } from "node:url";
import { launch, sleep } from "./cdp.mjs";
import { fixLayout } from "./fix-layout.mjs";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const B = process.env.BASE ?? "http://localhost:5173"; // BASE=<live URL> runs the same flow as an end-to-end check
// The judges' link, as judges get it: the passcode rides in the link, so the video shows no passcode field to look for.
const { JUDGE_PASSCODE: JUDGE, SAMPLE, SLUG } = process.env;
if (!JUDGE || !SAMPLE || !SLUG) throw new Error("JUDGE_PASSCODE, SAMPLE and SLUG are required");
const MEDIA = resolve("tools/prepare/out/demo-room-public");
const DIR = resolve(process.env.OUT ?? "private/video/out") + "/";
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

// 1. Open on the impact: six people travel to every site today; SurvAI needs one
await b.goto(B + "/", 3000);
await js(() => document.querySelector(".impact").scrollIntoView({ block: "center" }));
await b.startRec();
cue("impact: today six people visit every site and the signed survey takes 3 to 5 days; with SurvAI one engineer films and the departments stay at their desks");
await sleep(2000); await hoverSel(".impact-cols > div:nth-child(1)"); await sleep(2500); await hoverSel(".impact-cols > div:nth-child(2)"); await sleep(2500);
await hoverSel(".impact-cols > div:nth-child(3)"); await sleep(2500);

// Then what the work produces: the app's own report sheet for an approved survey (never the company form)
b.pause();
await b.goto(`${B}/survey/${SAMPLE}/report`, 4000);
await b.resume();
cue("this is the report SurvAI produces, signed off from the departments' desks");
await sleep(1500); await hover(700, 300); await sleep(1000);
await scrollBy(700); await sleep(1000); await scrollBy(900); await sleep(1500);

// 2. New survey
b.pause();
await b.goto(`${B}/#judge=${encodeURIComponent(JUDGE)}`, 3000);
await js(() => window.scrollTo({ top: 0 }));
await b.resume();
cue("new survey from the judges' link: the passcode is in the link; site, project, device, and the departments that must agree");
await sleep(1500); // the one-line intro
await hoverSel(".judge-access"); await sleep(1500);
cue("the form: site, project, device");
await fill("#site", "Demo room", 25);
await fill("#project", "Router install", 25);
await fill("#model", "Juniper MX104", 25);
await scrollTo("#reps-h"); await sleep(300);
cue("the five department agents who will meet on this survey, each on a Meta model, and whose people sign off the report");
await hoverSel("#reps-h"); await sleep(1200);
for (const k of [1, 2, 3, 4, 5]) { await hoverSel(`.agents > :nth-child(${k})`); await sleep(650); }
await sleep(800);
await press("Create survey");

// 3. Device: the datasheet lookup (live), then confirm
cue("device: Muse Spark looks up the datasheet and cites it");
b.pause();
await waitFor(pageHas, 120_000, "web search ·");
await banner("Meta Muse Spark 1.3 · found and cited the datasheet");
await b.resume();
await sleep(1000); await hoverSel(".found .model"); await sleep(1500);
if (await js(() => !!document.querySelector("#connectors")?.value)) { await hoverSel("#connectors"); await sleep(1500); } // DC feeds, ports and fibre connectors, from the datasheet
await hoverSel(".sources"); await sleep(1200);
await banner(null);
await press("Confirm device");

// 4. The material first: the engineer's one video of the room, as filmed, played at 2x over the upload page (its
// vendor logos blurred for this demo; nothing else is changed). Then the same file goes in as the walk-through: the app
// picks the sharpest frames, Meta SAM 3.1 finds the labels to blur, frame by frame, and the narration is taken from
// the same video.
await waitFor(pageHas, 30_000, "Upload footage");
await js(() => { const i = document.createElement("input"); i.type = "file"; i.id = "rec-src"; i.hidden = true; document.body.append(i); });
await upload("rec-src", [`${MEDIA}/room-walkthrough.mp4`]);
await js(() => {
  const o = document.createElement("div"); o.id = "rec-film";
  o.style.cssText = "position:fixed;inset:0;z-index:9998;background:rgba(16,21,24,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#E7ECEE;font:400 18px/1.4 Barlow,sans-serif";
  o.innerHTML = `<div style="font:600 34px/1.1 'Barlow Condensed',sans-serif">The engineer's video, as filmed</div>
    <div style="color:#9AA8B0">1 min 22 s · narrated in Egyptian Arabic · playing at 2× · vendor logos blurred for this demo</div>
    <video muted playsinline style="height:72vh;border-radius:12px;background:#000"></video>`;
  document.body.append(o);
  const v = o.querySelector("video"); v.src = URL.createObjectURL(document.getElementById("rec-src").files[0]);
  v.defaultPlaybackRate = 2; v.playbackRate = 2; return v.play().then(() => true, () => false);
});
cue("the material: one video of the room as the engineer filmed it, narration and all, played at 2x");
await sleep(20_000); // 40 s of the walk: the rows of racks, the ladder, the panels
await js(() => document.getElementById("rec-film")?.remove());
cue("upload: the same video as is; SAM 3.1 finds what to blur, frame by frame");
await sleep(1200);
await hover(1150, 360); await sleep(500);
await upload("devices_hall-walkthrough", [`${MEDIA}/room-walkthrough.mp4`]);
await banner("Meta SAM 3.1 · finds the labels to blur, in the browser");
await waitFor(() => document.querySelectorAll(".strip li").length >= 8, 120_000); // film the strip filling in
await sleep(2500); await hoverSel(".strip li:nth-child(4)"); await sleep(2000);
b.pause(); await waitFor(() => !!document.querySelector(".narration .wave") && !/Taking the narration|Sending the narration|Uploading frame/.test(document.body.innerText), 300_000); await b.resume();
await banner("Narration taken from the same video · Muse Spark 1.3 reads it next");
cue("the narration, taken from the same video, under its frames");
await hoverSel(".narration .wave"); await sleep(3500);
await banner(null);
await upload("devices_hall-panel_photo", [`${MEDIA}/photos/PWR1.jpg`, `${MEDIA}/photos/PWR2.jpg`]);
await upload("devices_hall-photo", [`${MEDIA}/photos/RACK1.jpg`, `${MEDIA}/photos/RACK2.jpg`]);
b.pause(); await sleep(1000); await waitFor(() => !document.body.innerText.includes("Uploading"), 120_000); await b.resume();
cue("the footage that goes to the models: blurred key frames, the narration, the panel photos");
await hoverSel(".strip"); await sleep(2000);
await scrollBy(400); await sleep(1500);
await press("Process footage");
cue("processing: SAM 3.1 finds racks and floor tiles; Muse reads the panel and the narration; the video is then deleted");
await banner("Meta SAM 3.1 + Meta Muse Spark · processing the footage");
await sleep(4500);
b.pause();
await waitFor(pageHas, 300_000, "Check the layout");
await sleep(1500);
await b.resume();

// 5. Layout: what feeds the meeting, filled in from the footage (each value with its source); the engineer only confirms,
// and corrects the drafted plan where the models got it wrong.
await banner("The video fills in the plan · the engineer only confirms");
cue("what feeds the meeting: space in the rack and room size from the frames, the request and route from the narration, the device from its datasheet, breakers from the panel photos");
await sleep(1200);
for (const k of ["space", "where", "device", "power", "cooling", "route"]) {
  if (await js((key) => !!document.querySelector(`[data-feed="${key}"]`), k)) { await hoverSel(`[data-feed="${k}"]`); await sleep(1100); }
}
await banner("Meta SAM 3.1 · racks, devices and floor tiles in every frame");
cue("what SAM 3.1 found: racks, floor tiles, the devices in the racks and the empty shelves, on every key frame");
await scrollTo("#sam-h"); await sleep(600); await hoverSel(".frames .frame:nth-child(3)"); await sleep(1500);
await banner("Meta Muse Spark · drafted the room on the 600 mm tile grid");
cue("layout: the drafted room on the 600 mm tile grid");
await hoverSel(".plan-panel"); await sleep(2200);
// The engineer corrects the draft to the real room (room-target.json, from the builder's sketch), with the editor's
// own controls: R to turn an item, arrow keys to move it, inside the room size measured from the frames. All on camera.
await banner("The engineer fixes the draft: the real room, as walked in");
cue("the engineer corrects the draft: turn a rack and drag it into its row; the rest the same way");
await fixLayout(b, { js, press, fill, scrollTo, rect });
// The target rack is the one the narration named; if the draft could not tell, the engineer picks it.
const target = await js(() => {
  const rows = [...document.querySelectorAll(".rack")];
  const row = rows.find((r) => r.querySelector("input[type=radio]")?.checked) ?? rows.find((r) => r.querySelector(".tag")?.textContent.trim() === "R3") ?? rows[0];
  row?.setAttribute("data-rec-target-rack", "1");
  return row ? { label: row.querySelector(".tag").textContent.trim(), drafted: !!row.querySelector("input[type=radio]")?.checked } : null;
});
if (!target) throw new Error("no racks drafted");
if (!target.drafted) await clickSel('[data-rec-target-rack] input[type=radio]');
if (!(await js(() => document.querySelector('[data-rec-target-rack] input[id^="f-"]')?.value))) await fill('[data-rec-target-rack] input[id^="f-"]', "10-30");
await banner("The real room, as walked in");
await b.moveTo(await rect(".plan-panel")); await sleep(2200);
if (await js(() => !!document.querySelector(".plan-panel rect[stroke-dasharray]"))) {
  cue("dashed outlines: where a new 80 by 80 centimetre rack fits without blocking the door or an aisle");
  await b.moveTo(await rect(".plan-panel rect[stroke-dasharray]")); await sleep(2500);
}
// Back to what feeds the meeting: the same values, now on the corrected plan, go to the agents.
await banner("These values go to the agents");
await js(() => window.scrollTo({ top: 0, behavior: "smooth" })); await sleep(900);
cue(`the layout feeds the meeting: ${target.label} has the space, the room size checks the cooling; the engineer starts the meeting`);
await hoverSel('[data-feed="space"]'); await sleep(1500); await hoverSel('[data-feed="cooling"]'); await sleep(1500);
await banner(null);
await press("Layout is right, start meeting");

// 6. The meeting, told as a story: the agents at the table review live; then, round by round (the tabs), who objected and
// what code calculated, what they asked and the engineer answered, how verdicts changed, and the Lead's call.
await waitFor(pageHas, 30_000, "The meeting");
cue("meeting: five agents review the room in parallel, each on Meta Muse Spark Open; Muse Wonder 1.0 leads");
await sleep(1200); await hoverSel(".roster"); await sleep(3500); // seats reviewing, typing bubbles in the chat
let shownRounds = 0;
const showRound = async (n) => {
  if (await markButton(`Round ${n}`)) { await clickSel(button(`Round ${n}`)); await sleep(700); }
  await js(() => window.scrollTo({ top: 0 }));
  cue(`round ${n}: who objected and what code calculated; the placements weighed (rules, cooling, cost); the Survey Lead's call`);
  await hoverSel(".roster ul"); await sleep(1500);
  const forced = await js(() => { const s = document.querySelector(".seat.object .seat-btn"); s?.setAttribute("data-rec-btn", "seat"); return !!s; });
  if (forced) { await clickSel('[data-rec-btn="seat"]'); await sleep(900); if (await js(() => !!document.querySelector(".chat .calc-lines"))) { await b.moveTo(await rect(".chat .calc-lines")); await sleep(2200); } }
  if (await js(() => !!document.querySelector(".chat .turn-a"))) { await js(() => document.querySelector(".chat .turn-a").scrollIntoView({ block: "center" })); await b.moveTo(await rect(".chat .turn-a")); await sleep(2000); }
  // the placement weighed in the open: Space's view, Execution's frame evidence, then the Lead's "Resolved"
  for (const who of ["Space", "Execution", "Cooling"]) {
    const ok = await js((w) => { const m = [...document.querySelectorAll(".chat .msg")].find((x) => x.querySelector(".who")?.textContent === w);
      if (!m) return false; m.setAttribute("data-rec-who", w); m.scrollIntoView({ block: "center" }); return true; }, who);
    if (!ok) continue;
    const sel = who === "Execution" && (await js(() => !!document.querySelector('[data-rec-who="Execution"] .ev-frame'))) ? '[data-rec-who="Execution"] .ev-frame' : `[data-rec-who="${who}"] .bubble`;
    await b.moveTo(await rect(sel)); await sleep(1600);
  }
  if (n > 1) { await hoverSel(".roster .track"); await sleep(1500); } // verdicts across rounds
  await js(() => { const c = document.querySelector(".chat"); if (c) c.scrollTop = c.scrollHeight; });
  if (await js(() => !!document.querySelector(".chat .bubble.lead"))) { await b.moveTo(await rect(".chat .bubble.lead")); await sleep(2000); }
  if (await js(() => { const r = document.querySelector(".chat .resolved"); r?.scrollIntoView({ block: "center" }); return !!r; })) { await b.moveTo(await rect(".chat .resolved")); await sleep(2500); }
  await hoverSel(".seat.lead"); await sleep(1500);
};
for (;;) {
  b.pause();
  await waitFor(() => /The meeting is over|need your answers/.test(document.body.innerText), 300_000);
  await sleep(800);
  await b.resume();
  const rounds = await js(() => [...document.querySelectorAll('[aria-label="Round"] button')].length || 1);
  for (let n = shownRounds + 1; n <= rounds; n++) await showRound(n);
  shownRounds = rounds;
  if (await js(pageHas, "The meeting is over")) break;
  // the departments asked the site engineer: the answers appear typed in (the owner played this part; the replay says so)
  cue("the agents ask; the engineer answers, and the next round starts");
  await hoverSel(".ask"); await sleep(1800);
  const asks = await js(() => [...document.querySelectorAll(".ask")].map((a, k) => { a.setAttribute("data-rec-ask", String(k)); return { k, who: a.querySelector(".label")?.textContent ?? "", q: a.querySelector("p")?.textContent ?? "", yesNo: !!a.querySelector("button"), optional: /optional/i.test(a.textContent) }; }));
  for (const a of asks.filter((x) => !x.optional)) {
    const within = `[data-rec-ask="${a.k}"]`;
    if (a.yesNo) await press(/Power/.test(a.who) ? "No" : "Yes", within);
    // What the site engineer confirmed on the walk-through (the same facts the live sample used)
    else await fill(`${within} input`, (await js((s) => document.querySelector(s).inputMode, `${within} input`)) === "decimal" ? "2"
      : /breaker|power|feed|panel/i.test(a.q) ? "Only breakers 3 and 4 on the wall panel are free: 16 A DC each. No free 40 A breaker."
      : /fib|cable|route|ladder/i.test(a.q) ? "Two single-mode pairs, LC/LC, over the ladder to transmission rack 40."
      : /door|clear|swing/i.test(a.q) ? "The door opens inward; the aisle in front of it is clear." : "Checked on site: as shown in the layout.", 20);
  }
  await sleep(1200);
  await waitFor(() => [...document.querySelectorAll(".actions button")].some((e) => /^Send/.test(e.textContent) && !e.disabled), 10_000);
  await markButton(await js(() => [...document.querySelectorAll(".actions button")].find((e) => /^Send/.test(e.textContent)).textContent.trim()), ".actions");
  await clickSel("[data-rec-btn]");
  await waitFor(() => !document.body.innerText.includes("need your answers"), 30_000);
  await sleep(1500);
}
await banner(null);

// 7. Approve: objections need a written reason; sign-off links
await press("Continue to approve");
await waitFor(pageHas, 30_000, "Approve and report");
cue("approve: every objection the engineer overrides needs a written reason");
await sleep(1500);
const reasons = await js(() => [...document.querySelectorAll("textarea[id^=why-]")].map((e) => ({ id: e.id, who: e.labels?.[0]?.textContent ?? "" })));
for (const r of reasons) {
  const text = /Power/.test(r.who) ? "Pre-install work order: free DC breakers of the datasheet rating on the panel before installation."
    : /Room Manager/.test(r.who) ? "Door clearance and rack positions checked on site before installation; the draft position is approximate."
    : "Checked by the site engineer on site before installation.";
  await fill(`#${r.id}`, text, 12);
}
await banner(null);
await fill("#specs", "SM fibre LC/LC duplex to the transmission rack; DC 2 x 6 mm2 from the panel", 8);
await js(() => document.querySelector("textarea[id^=why-]")?.scrollIntoView({ block: "center" }));
await sleep(2000);
await press("Approve survey");
await waitFor(pageHas, 30_000, "Open the report");
cue("sign-off links: one per department, shown once");
await sleep(2000);
const link = await js(() => { const rows = [...document.querySelectorAll(".sub.mono")].map((e) => e.textContent); return rows.find((t) => t.includes("/s#")) ?? null; });
const linkAgent = await js(() => document.querySelector(".sub.mono")?.parentElement?.firstChild?.textContent ?? "");
await press("Open the report");

// 8. The report
await waitFor(pageHas, 30_000, "Site Survey Report");
cue("report: the survey form, with the device the Survey Lead placed and the cable paths it drew");
await sleep(1500);
if (await js(() => !!document.querySelector(".plan-fig"))) { await scrollTo(".plan-fig"); await sleep(2500); }

// 9. A department representative signs off from a phone
b.pause();
await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await b.goto(link, 3000);
await b.resume();
cue(`sign-off: the ${linkAgent} representative reads their agent's statement on a phone and approves`);
await sleep(2200); // the agent's statement and verdict
// the decision form at the bottom, on camera: name, Approve, Send, and the confirmation
await scrollTo("#rep"); await sleep(500);
await fill("#rep", "A. Hassan", 35);
await press("Approve", '[aria-label="Decision"]'); await sleep(400);
await press("Send approval");
await sleep(1800);
b.pause();
// Back to the laptop: clear the phone emulation (and any zoom into a focused field), then check it took.
const desktop = async () => {
  await b.send("Emulation.clearDeviceMetricsOverride");
  await b.send("Emulation.resetPageScaleFactor");
  await b.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 4 / 3, mobile: false });
};
await desktop();

// 10. The replay judges get, and the Meta models behind it
await b.goto(`${B}/replay/${SLUG}`, 4000);
for (let k = 0; k < 3 && (await js(() => innerWidth)) !== 1440; k++) { await desktop(); await b.goto(`${B}/replay/${SLUG}`, 3000); }
console.log("viewport after sign-off:", await js(() => [innerWidth, devicePixelRatio]));
await b.resume();
cue("public sample: the whole meeting, measured accuracy, and a live 'run the meeting again'");
await sleep(2000); await hoverSel(".accuracy"); await sleep(4500); // measured on this room
await hoverSel(".made"); await sleep(3000); // how this survey was made
await scrollTo(".roster"); await sleep(2500);
if (await markButton("Run the meeting again")) { await scrollTo(button("Run the meeting again")); await b.moveTo(await rect(button("Run the meeting again"))); await sleep(2500); }
b.pause();
// 11. How it works: the pipeline first, then the meeting loop and the rules code decides light up (architecture.html).
await b.goto(pathToFileURL(resolve("scripts/demo-video/architecture.html")).href, 2500);
await b.resume();
cue("how it works: one video in, Meta models as the eyes and the reasoning, code deciding five rules, departments signing");
await sleep(3500);
await js(() => document.body.classList.add("loop-on"));
cue("the meeting loop: calculations in code force objections; agents and the Survey Lead speak; up to three rounds");
await sleep(6500);
// 12. The last frame fades to the app's logo, centred
cue("end: the SurvAI logo");
await js(() => {
  document.getElementById("rec-cursor")?.style.setProperty("display", "none");
  const o = document.createElement("div");
  o.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#EEF1F1;display:grid;place-items:center;opacity:0;transition:opacity 1.4s ease";
  o.innerHTML = '<div style="font:600 136px/1 \'Barlow Condensed\',sans-serif;color:#14191C;letter-spacing:-1px">Surv<span style="color:#0B6770">AI</span></div>';
  document.body.append(o);
  requestAnimationFrame(() => requestAnimationFrame(() => { o.style.opacity = "1"; }));
});
await sleep(4000);

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
