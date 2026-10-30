// The engineer's correction of the drafted plan, for the demo video: the real room from room-target.json, reached with
// the layout editor's own keyboard controls (select an item, R turns it, arrow keys move it by 0.5 tile, Shift by 0.1).
// Works from any draft: it adds or removes racks, panels and ladders to match, then turns and moves each into place.
import { readFileSync } from "node:fs";
import { sleep } from "./cdp.mjs";

const ROOM = JSON.parse(readFileSync(new URL("./room-target.json", import.meta.url), "utf8"));
const KEYS = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, r: 82 };

/** Items on the plan as the editor draws them: label, kind, position and size in tiles, front. */
const readPlan = (js) => js(() => {
  const svg = document.querySelector(".plan-panel svg");
  const racks = new Set([...document.querySelectorAll(".rack .tag")].map((t) => t.textContent.trim()));
  const target = [...document.querySelectorAll(".rack")].find((r) => r.querySelector("input[type=radio]")?.checked)?.querySelector(".tag")?.textContent.trim();
  const kinds = Object.fromEntries([...document.querySelectorAll("section[aria-labelledby=other-h] .filerow")].map((r) => [r.querySelector(".tag").textContent.trim(), r.querySelector(".name").textContent.trim()]));
  return [...svg.querySelectorAll("g.movable")].map((g) => {
    const label = g.getAttribute("aria-label").match(/^Move (.*?): /)[1];
    const [x, y, w, h] = ["x", "y", "width", "height"].map((a) => +g.querySelector("rect").getAttribute(a));
    const rot = g.querySelector("path[transform]")?.getAttribute("transform").match(/rotate\((-?\d+)\)/)?.[1];
    const box = g.querySelector("rect").getBoundingClientRect();
    return { label, kind: racks.has(label) ? "rack" : kinds[label] ?? "?", x: (x - 30) / 40, y: (y - 30) / 40, w: w / 40, d: h / 40,
      facing: rot == null ? null : { 0: "south", 180: "north", "-90": "east", 90: "west" }[rot], target: label === target,
      at: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
  });
});

/** onFirst runs after the first rack the engineer had to fix (a recorder can mark the moment). */
export async function fixLayout(b, { js, press, fill, scrollTo }, { onFirst = async () => {} } = {}) {
  const key = async (k, shift = false) => {
    const code = k === "r" ? "KeyR" : k;
    await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: KEYS[k], modifiers: shift ? 8 : 0, ...(k === "r" ? { text: "r" } : {}) });
    await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: KEYS[k], modifiers: shift ? 8 : 0 });
    await sleep(45);
  };
  const plan = () => readPlan(js);
  const one = async (label) => (await plan()).find((i) => i.label === label);
  const select = async (label) => {
    const it = await one(label);
    if (it) await b.moveTo(it.at); // the pointer shows which item the engineer is on
    await js((l) => [...document.querySelectorAll(".plan-panel g.movable")].find((g) => g.getAttribute("aria-label").startsWith(`Move ${l}:`))?.focus({ preventScroll: true }), label);
  };
  // Turn until the long side runs the wanted way and, when asked, the front faces the wanted wall.
  const orient = async (label, tall, facing = null) => {
    for (let k = 0; k < 4; k++) {
      const it = await one(label);
      if (!it || ((it.d > it.w) === tall && (!facing || it.facing === facing))) return;
      await select(label); await key("r"); await sleep(150);
    }
  };
  const moveTo = async (label, tx, ty) => {
    await select(label);
    for (const [axis, plus, minus] of [["x", "ArrowRight", "ArrowLeft"], ["y", "ArrowDown", "ArrowUp"]]) {
      const it = await one(label);
      const delta = (axis === "x" ? tx : ty) - it[axis];
      const halves = Math.trunc(delta / 0.5), tenths = Math.round((delta - halves * 0.5) / 0.1);
      for (let k = 0; k < Math.abs(halves); k++) await key(halves > 0 ? plus : minus);
      for (let k = 0; k < Math.abs(tenths); k++) await key(tenths > 0 ? plus : minus, true);
    }
    await sleep(150);
  };
  const add = async (kind) => {
    await press("Add item");
    await js((k) => { const s = document.getElementById("add-k"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, k); s.dispatchEvent(new Event("change", { bubbles: true })); }, kind);
    await press("Add", "dialog"); await sleep(300);
  };
  const removeAll = async (labels) => { for (const l of labels) await press(`Remove ${l}`); if (labels.length) await scrollTo(".plan-panel"); };

  // The room keeps the size measured from the frames: positions are fitted inside it, the walls never move.
  const W = Number(await js(() => document.querySelector("#w")?.value)) || 8, D = Number(await js(() => document.querySelector("#d")?.value)) || 9;
  const fit = (x, y, w, d) => [Math.max(0, Math.min(x, Math.round((W - w) * 10) / 10)), Math.max(0, Math.min(y, Math.round((D - d) * 10) / 10))];
  const slots = [ROOM.racks[ROOM.target_slot], ...ROOM.racks.filter((_, k) => k !== ROOM.target_slot)].map(([x, y]) => fit(x, y, 1, 1.7));
  const panelAt = (k) => fit(0, Math.min(ROOM.panels[k][1], D - 2.8 + k * 1.4), 0.3, 1);
  let items = await plan();
  const of = (kind) => items.filter((i) => i.kind === kind);
  // The drafted racks into their rows first, the target in its slot: the first one that needs it is the edit on camera.
  const drafted = of("rack"), first = drafted.find((r) => r.target) ?? drafted[0];
  const placed = [first, ...drafted.filter((x) => x !== first)].filter(Boolean).slice(0, slots.length);
  let shown = false;
  for (const [k, r] of placed.entries()) {
    const before = await one(r.label);
    await orient(r.label, true, ROOM.rack_facing); await moveTo(r.label, ...slots[k]);
    const after = await one(r.label);
    if (!shown && (before.x !== after.x || before.y !== after.y || before.facing !== after.facing)) { shown = true; await sleep(800); await onFirst(); }
  }
  if (!shown) await onFirst();

  await scrollTo(".plan-panel"); await sleep(300);
  items = await plan();
  // the right number of each: six racks, two panels, two ladders
  await removeAll(of("rack").filter((r) => !placed.some((p) => p.label === r.label)).map((r) => r.label));
  await removeAll(of("panel").slice(ROOM.panels.length).map((p) => p.label));
  await removeAll(of("ladder").slice(2).map((l) => l.label));
  items = await plan();
  for (let k = of("rack").length; k < ROOM.racks.length; k++) await add("rack");
  for (let k = of("panel").length; k < ROOM.panels.length; k++) await add("panel");
  for (let k = of("ladder").length; k < 2; k++) await add("ladder");
  await scrollTo(".plan-panel"); await sleep(300);
  items = await plan();
  for (const [k, r] of of("rack").filter((r) => !placed.some((p) => p.label === r.label)).entries()) {
    await orient(r.label, true, ROOM.rack_facing); await moveTo(r.label, ...slots[placed.length + k]);
  }
  const [across, down] = of("ladder").sort((a, c) => (c.w - c.d) - (a.w - a.d));
  await orient(across.label, false); await moveTo(across.label, ...fit(...ROOM.ladder_across, across.w, across.d));
  // the ladder turns down where the one across ends (the editor keeps each ladder's drafted length)
  await orient(down.label, true);
  const a = await one(across.label), dn = await one(down.label);
  await moveTo(down.label, ...fit(Math.round((a.x + a.w - dn.w) * 10) / 10, a.y, dn.w, dn.d));
  for (const door of of("door").slice(0, 1)) {
    await orient(door.label, false);
    const d = await one(door.label);
    await moveTo(door.label, Math.round(((W - d.w) / 2) * 10) / 10, Math.round((D - d.d) * 10) / 10);
  }
  for (const [k, p] of of("panel").entries()) { await orient(p.label, true); await moveTo(p.label, ...panelAt(k)); }
  await js(() => document.activeElement?.blur());
  return plan();
}
