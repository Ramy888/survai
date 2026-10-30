import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getLayout, listFiles, saveLayout, savePasscode, savedPasscode, type LayoutItem, type RoomLayout, type Survey, type UploadedFile } from "../api";
import { Shell } from "../components/Shell";
import { rackSpots } from "../../worker/calc";
import { FloorPlan } from "../report/FloorPlan";
import { turned } from "../report/plan";
import { Feeds } from "../components/Feeds";
import { feedRows } from "./feeds";
import { FrameGrid, ModelChip } from "../components/Footage";

type Breaker = { position: number | null; dc: boolean; rating_a: string; free: boolean };
const ROOM: Record<string, string> = { devices_hall: "Devices hall", connect_to: "Connect-to room" };
// What the engineer can add, at a typical size in tiles (600 mm). A cable path is drawn by the Survey Lead, not added.
const ADD: Record<string, { name: string; tag: string; w: number; d: number; props: Record<string, unknown>; facing?: string }> = {
  rack: { name: "Rack", tag: "R", w: 1, d: 1.7, props: { height_u: 42, free_blocks: [] }, facing: "south" }, // front on the short side, towards the door wall
  ac: { name: "A/C unit", tag: "AC", w: 1.5, d: 1, props: {} },
  panel: { name: "Power panel", tag: "P", w: 1, d: 0.3, props: {} },
  door: { name: "Door", tag: "D", w: 1.5, d: 0.2, props: { swing_m: 0.9 } },
  column: { name: "Column", tag: "C", w: 1, d: 1, props: {} },
  ladder: { name: "Cable ladder", tag: "L", w: 4, d: 0.5, props: {} },
  reserved: { name: "Reserved space", tag: "RES", w: 1, d: 1.7, props: {} },
};
const num = (v: string | undefined) => (!v?.trim() ? null : Number(v)); // facts load after the first render
/** The next name for an added item, in the draft's own style: RK1-RK4 give RK5; none yet gives the default tag. */
export function nextLabel(kind: string, items: Pick<LayoutItem, "kind" | "label">[]) {
  const named = items.filter((i) => i.kind === kind).map((i) => /^(.*?)(\d+)$/.exec(i.label ?? "")).filter((m) => m !== null);
  return `${named[0]?.[1] ?? ADD[kind].tag}${Math.max(0, ...named.map((m) => Number(m[2]))) + 1}`;
}
/** What Muse Spark read on the panel photos, said as a result rather than a list of blanks. */
export function panelLine(draft: { panel_file?: string; rating_a?: number | null }[]) {
  if (!draft.length) return "No breakers read from the panel photos. Add each breaker on site.";
  const n = draft.length, photos = new Set(draft.map((b) => b.panel_file)).size, read = draft.filter((b) => b.rating_a != null).length;
  const s = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  return `Counted ${s(n, "breaker")} on ${s(photos, "photo")}${read ? ` and read ${s(read, "rating")}` : "; no rating was readable"}. Confirm each breaker on site.`;
}
/** SAM 3.1's finds as frames with a rack or a tile: one rack seen in five frames is not five racks. */
export const samLine = (frames: Pick<UploadedFile, "masks">[]) =>
  `Racks in ${frames.filter((f) => f.masks?.racks.length).length} of ${frames.length} frames (up to ${Math.max(0, ...frames.map((f) => f.masks?.racks.length ?? 0))} in one)` +
  ` · floor tiles in ${frames.filter((f) => f.masks?.tiles.length).length}`;
const blocksText = (b: unknown) => ((b as { from_u: number; to_u: number }[] | undefined) ?? []).map((x) => (x.from_u === x.to_u ? `${x.from_u}` : `${x.from_u}-${x.to_u}`)).join(", ");
function parseBlocks(t: string): { from_u: number; to_u: number }[] | null {
  if (!t.trim()) return [];
  const out = [];
  for (const part of t.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) return null;
    out.push({ from_u: Number(m[1]), to_u: Number(m[2] ?? m[1]) });
  }
  return out;
}

export function LayoutStep({ survey, onSaved, onBack }: { survey: Survey; onSaved: () => void; onBack?: () => void }) {
  const roles = survey.rooms.slice().sort().reverse(); // devices_hall first
  const [role, setRole] = useState(roles[0]);
  const [data, setData] = useState<RoomLayout | null>(null);
  const [items, setItems] = useState<LayoutItem[]>([]);
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [facts, setFacts] = useState<Record<string, string>>({});
  const [breakers, setBreakers] = useState<Breaker[]>([]);
  const [drafted, setDrafted] = useState<{ breakers: string; ladderAssumed: boolean }>({ breakers: "", ladderAssumed: false });
  const [adding, setAdding] = useState({ kind: "rack", label: "" });
  const addDialog = useRef<HTMLDialogElement>(null);
  const autoLabel = nextLabel(adding.kind, items); // a blank label gets the next name
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passcode, setPasscode] = useState(savedPasscode);
  const [askPass] = useState(() => !savedPasscode()); // a new tab has no passcode yet; kept visible while typing

  async function load(r = role) {
    setError(""); setStale(false);
    const d = await getLayout(survey.id, r);
    const editable = d.items.filter((i) => i.source !== "lead").map((i, k) => ({ ...i, id: i.id ?? `new-${k}` }));
    setData(d);
    setItems(editable);
    setFreeText(Object.fromEntries(editable.filter((i) => i.kind === "rack").map((i) => [i.id!, blocksText(i.props.free_blocks)])));
    const f = d.facts;
    setFacts({
      w: f.size_tiles?.w != null ? String(f.size_tiles.w) : "", d: f.size_tiles?.d != null ? String(f.size_tiles.d) : "",
      spare_ac_btu: f.spare_ac_btu != null ? String(f.spare_ac_btu) : "", ac_count: f.ac_count != null ? String(f.ac_count) : "",
      // No ladder height in the footage: 2.7 m is assumed until the engineer confirms it (it only sets cable lengths).
      ladder_height_m: f.ladder_height_m != null ? String(f.ladder_height_m) : "2.7", inter_room_m: f.inter_room_m != null ? String(f.inter_room_m) : "",
    });
    const confirmed = f.breakers_confirmed as Breaker[] | null | undefined;
    const list = confirmed?.map((b) => ({ ...b, rating_a: b.rating_a == null ? "" : String(b.rating_a) })) ??
      ((f.breakers_draft as { position: number | null; dc?: boolean | null; rating_a?: number | null; looks_free?: boolean | null }[] | undefined) ?? [])
        // Numbered down the list: the reader's positions restart in every box and photo, so they repeat.
        .map((b, k) => ({ position: k + 1, dc: b.dc ?? true, rating_a: b.rating_a ? String(b.rating_a) : "", free: b.looks_free === true }));
    setBreakers(list);
    setDrafted({ breakers: JSON.stringify(list), ladderAssumed: f.ladder_height_m == null });
  }
  useEffect(() => { void load(role).catch((e: Error) => setError(e.message)); }, [role]);
  const [frames, setFrames] = useState<UploadedFile[]>([]);
  useEffect(() => { void listFiles(survey.id).then((r) => setFrames(r.rooms[role]?.files.filter((f) => f.kind === "key_frame") ?? []), () => setFrames([])); }, [survey.id, role]);

  const set = (id: string, patch: Partial<LayoutItem> | ((i: LayoutItem) => LayoutItem)) =>
    setItems((xs) => xs.map((i) => (i.id === id ? (typeof patch === "function" ? patch(i) : { ...i, ...patch }) : i)));
  const setProp = (id: string, k: string, v: unknown) => set(id, (i) => ({ ...i, props: { ...i.props, [k]: v } }));
  const racks = items.filter((i) => i.kind === "rack");
  const others = items.filter((i) => i.kind !== "rack");
  const badFree = racks.filter((r) => parseBlocks(freeText[r.id!] ?? "") === null).map((r) => r.label);
  const size = num(facts.w) && num(facts.d) ? { w: num(facts.w)!, d: num(facts.d)! } : null;
  const planItems = useMemo(() => {
    const shown = [...items, ...(data?.items.filter((i) => i.source === "lead") ?? [])]
      .map((i) => ({ id: i.id ?? "", kind: i.kind, label: i.label, x: i.x_tiles, y: i.y_tiles, w: i.w_tiles, d: i.d_tiles, facing: i.facing, props: i.props, source: i.source ?? "engineer" }));
    // Where a new 80 x 80 cm rack would fit without blocking a door or an aisle, recomputed as the engineer edits.
    const spots = size ? rackSpots({ room: size, items: shown.map((i) => ({ label: i.label ?? i.kind, kind: i.kind, x: i.x, y: i.y, w: i.w ?? 1, d: i.d ?? 1, facing: i.facing })) }) : [];
    return [...shown, ...spots.map((p, k) => ({ id: `spot-${k}`, kind: "spot", label: "fits", x: p.x, y: p.y, w: p.w, d: p.d, facing: p.facing, props: {}, source: "lead" }))];
  }, [items, data, size?.w, size?.d]);

  const loadedTarget = data?.items.find((i) => i.kind === "rack" && i.props.is_target);
  const target = racks.find((r) => r.props.is_target);
  const feeds = data && role === "devices_hall" ? feedRows({
    device: survey.device ? { ...survey.device, model: survey.device_model, quantity: survey.quantity } : null,
    request: data.request as { source?: string; route?: string; cables?: string[] } | null,
    target: target ? { label: target.label ?? "the target rack", free: parseBlocks(freeText[target.id!] ?? "") ?? [],
      samFrame: (target.props.free_estimate as { frame?: number } | null)?.frame ?? null,
      edited: target.id !== loadedTarget?.id || (freeText[target.id!] ?? "") !== blocksText(loadedTarget?.props.free_blocks) } : null,
    spots: planItems.filter((i) => i.kind === "spot").length,
    room: size ? { ...size, edited: size.w !== data.facts.size_tiles?.w || size.d !== data.facts.size_tiles?.d } : null,
    spareAcBtu: num(facts.spare_ac_btu),
    ladder: { m: num(facts.ladder_height_m), assumed: drafted.ladderAssumed && facts.ladder_height_m === "2.7" },
    breakers: { seen: breakers.length, free: breakers.filter((b) => b.free).length, rated: breakers.filter((b) => b.rating_a.trim()).length, edited: JSON.stringify(breakers) !== drafted.breakers },
    observations: ((data.facts.observations as { text: string }[] | undefined) ?? []).map((o) => o.text),
  }) : null;

  async function save() {
    if (!data) return;
    setBusy(true); setError(""); setStale(false);
    try {
      const body = {
        layout_version: data.layout_version,
        items: items.map(({ source: _s, ...i }) => ({
          ...i, id: i.id?.startsWith("new-") ? undefined : i.id,
          props: i.kind === "rack" ? { ...i.props, free_blocks: parseBlocks(freeText[i.id!] ?? "") ?? [] } : i.props,
        })),
        facts: {
          size_tiles: num(facts.w) && num(facts.d) ? { w: num(facts.w), d: num(facts.d) } : null,
          spare_ac_btu: num(facts.spare_ac_btu), ac_count: num(facts.ac_count), ladder_height_m: num(facts.ladder_height_m),
          ...(roles.length > 1 && role === "devices_hall" ? { inter_room_m: num(facts.inter_room_m) } : {}),
          breakers_confirmed: role === "devices_hall" && breakers.length
            ? breakers.map((b) => ({ position: b.position, dc: b.dc, rating_a: num(b.rating_a), free: b.free })) : null,
        },
      };
      const r = await saveLayout(survey.id, role, body, passcode);
      savePasscode(passcode);
      if (r.status === "deliberating" && (r.meeting_started || survey.status === "deliberating")) onSaved();
      else { const next = roles.find((x) => x !== role); if (next) setRole(next); else await load(); }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && /another tab/.test(e.message)) setStale(true);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const label = survey.status === "deliberating" ? "Save layout" : roles.length > 1 && role === roles[0] ? `Save ${ROOM[role].toLowerCase()}` : "Layout is right, start meeting";
  const req = data?.request;
  return (
    <Shell step={3} surveyCode={survey.site}
      actions={<>{onBack && <button className="btn btn-secondary" onClick={onBack}>Back to meeting</button>}
        <button className="btn btn-primary" disabled={!data || busy || badFree.length > 0 || !passcode} onClick={save}>{busy ? "Saving…" : label}</button></>}>
      <div className="stack layout-grid">
        <div className="full">
          <h1>Check the layout</h1>
          <p className="muted">Fix anything the models got wrong. The agents meet on this version.</p>
        </div>
        {feeds && <Feeds rows={feeds} foot="The agents get these values as text; they never see the photos. Anything wrong: edit it below." />}
        {roles.length > 1 && (
          <div className="seg full" role="group" aria-label="Room">
            {roles.map((r) => <button key={r} type="button" aria-pressed={r === role} onClick={() => setRole(r)}>{ROOM[r]}</button>)}
          </div>
        )}
        {req && (req.source || req.destination) && (
          <section className="panel req full" aria-label="Request">
            <div className="title-row"><h2>Request from the narration</h2><ModelChip model="muse-spark-1.3" what="transcribed and translated" /></div>
            {req.translation_en && <p>{req.translation_en}</p>}
            <p className="muted"><b>Goes in:</b> {req.source ?? "—"} · <b>Route:</b> {req.route ?? "—"} · <b>To:</b> {req.destination ?? "—"}</p>
          </section>
        )}
        {frames.some((f) => f.masks) && (
          <section className="panel full" aria-labelledby="sam-h">
            <div className="title-row"><h2 id="sam-h">What the models found in your frames</h2><ModelChip model="sam-3.1" what="racks and floor tiles" /></div>
            <p className="muted sam-key"><i className="k-rack" />Rack <i className="k-tile" />Floor tile <i className="k-device" />Device <i className="k-shelf" />Shelf · {samLine(frames)}</p>
            <FrameGrid surveyId={survey.id} files={frames} withMasks />
          </section>
        )}
        {!data && !error && <p className="muted">Loading layout…</p>}
        {data && (
          <>
            <section className="panel plan-panel" aria-label="Floor plan">
              <div className="plan-by"><ModelChip model={data.facts.inventory_model ?? "muse-spark-open"} what="drafted from the frames; correct it below" /></div>
              <FloorPlan size={size} items={planItems} lengths={{}} clearances={[]}
                onMove={(id, x, y) => set(id, { x_tiles: x, y_tiles: y })} onTurn={(id) => set(id, (i) => ({ ...i, ...turned(i) }))} />
              <div className="plan-actions">
                <p className="muted small">Drag an item to move it, or select it and use the arrow keys; R or Turn turns it a quarter.</p>
                <button className="btn btn-secondary" onClick={() => { setAdding({ kind: "rack", label: "" }); addDialog.current?.showModal(); }}>Add item</button>
              </div>
            </section>
            <div className="stack">
              <section className="panel" aria-labelledby="racks-h">
                <h2 id="racks-h">Racks</h2>
                {racks.length === 0 && <p className="muted">No racks found. Add them with Add item under the plan.</p>}
                {racks.map((r) => (
                  <div className="rack" key={r.id}>
                    <div className="rack-head">
                      <span className="tag">{r.label ?? "?"}</span>
                      <label className="toggle"><input type="radio" name="target" checked={!!r.props.is_target}
                        onChange={() => setItems((xs) => xs.map((i) => (i.kind === "rack" ? { ...i, props: { ...i.props, is_target: i.id === r.id } } : i)))} />Target</label>
                      <label className="toggle"><input type="checkbox" checked={!!r.props.off_limits} onChange={(e) => setProp(r.id!, "off_limits", e.target.checked)} />Off limits</label>
                      <span className="row-actions">
                        <button className="link-btn" onClick={() => set(r.id!, (i) => ({ ...i, ...turned(i) }))}>Turn<span className="sr-only"> {r.label}</span></button>
                        <button className="link-btn" onClick={() => setItems((xs) => xs.filter((i) => i.id !== r.id))}>Remove<span className="sr-only"> {r.label}</span></button>
                      </span>
                    </div>
                    <div className="two">
                      <div className="field"><label htmlFor={`h-${r.id}`}>Height (U)</label>
                        <input id={`h-${r.id}`} className="mono" inputMode="numeric" value={String(r.props.height_u ?? 42)} onChange={(e) => setProp(r.id!, "height_u", Number(e.target.value) || 42)} /></div>
                      <div className="field"><label htmlFor={`f-${r.id}`}>Free U</label>
                        <input id={`f-${r.id}`} className="mono" placeholder="10-30, 35-36" value={freeText[r.id!] ?? ""} aria-invalid={parseBlocks(freeText[r.id!] ?? "") === null || undefined}
                          onChange={(e) => setFreeText((f) => ({ ...f, [r.id!]: e.target.value }))} />
                        {(r.props.free_estimate as { frame?: number } | null)?.frame != null && <span className="sub">Estimated by Meta SAM 3.1 from frame {(r.props.free_estimate as { frame: number }).frame}: the gap below its devices. Check on site.</span>}</div>
                    </div>
                  </div>
                ))}
                {badFree.length > 0 && <p className="note error" role="alert">Write free U as ranges, e.g. 10-30, 35 ({badFree.join(", ")}).</p>}
              </section>
              {others.length > 0 && (
                <section className="panel" aria-labelledby="other-h">
                  <h2 id="other-h">Other items</h2>
                  <div className="rows">{others.map((i) => (
                    <div className="filerow" key={i.id}><span className="tag">{i.label ?? i.kind}</span><span className="name">{i.kind.replace("_", " ")}</span>
                      <button className="link-btn" onClick={() => set(i.id!, (x) => ({ ...x, ...turned(x) }))}>Turn<span className="sr-only"> {i.label}</span></button>
                      <button className="link-btn" onClick={() => setItems((xs) => xs.filter((x) => x.id !== i.id))}>Remove<span className="sr-only"> {i.label}</span></button></div>
                  ))}</div>
                </section>
              )}
            </div>
            <section className="panel fields" aria-labelledby="facts-h">
              <h2 id="facts-h">Room facts</h2>
              <div className="two">
                <div className="field"><label htmlFor="w">Width (tiles)</label><input id="w" className="mono" inputMode="numeric" value={facts.w} onChange={(e) => setFacts({ ...facts, w: e.target.value })} /></div>
                <div className="field"><label htmlFor="d">Depth (tiles)</label><input id="d" className="mono" inputMode="numeric" value={facts.d} onChange={(e) => setFacts({ ...facts, d: e.target.value })} /></div>
              </div>
              <div className="two">
                <div className="field"><label htmlFor="btu">Spare A/C (BTU/h), if known</label><input id="btu" className="mono" inputMode="numeric" placeholder="unknown" value={facts.spare_ac_btu} onChange={(e) => setFacts({ ...facts, spare_ac_btu: e.target.value })} /></div>
                <div className="field"><label htmlFor="ac">A/C units</label><input id="ac" className="mono" inputMode="numeric" value={facts.ac_count} onChange={(e) => setFacts({ ...facts, ac_count: e.target.value })} /></div>
              </div>
              <div className="two">
                <div className="field"><label htmlFor="lad">Ladder height (m)</label><input id="lad" className="mono" inputMode="decimal" value={facts.ladder_height_m} onChange={(e) => setFacts({ ...facts, ladder_height_m: e.target.value })} /></div>
                {roles.length > 1 && role === "devices_hall" && (
                  <div className="field"><label htmlFor="ir">To the other room (m)</label><input id="ir" className="mono" inputMode="decimal" value={facts.inter_room_m} onChange={(e) => setFacts({ ...facts, inter_room_m: e.target.value })} /></div>
                )}
              </div>
            </section>
            {role === "devices_hall" && (
              <section className="panel" aria-labelledby="brk-h">
                <h2 id="brk-h">Breakers</h2>
                <p className="muted" style={{ marginBottom: 8 }}><ModelChip model="muse-spark-1.3" what="read the panel photos" /> {panelLine(data.facts.breakers_draft ?? [])}</p>
                {breakers.map((b, k) => (
                  <div className="brk" key={k}>
                    <span className="tag">{b.position ?? k + 1}</span>
                    <div className="seg" role="group" aria-label={`Breaker ${k + 1} type`}>
                      {(["DC", "AC"] as const).map((t) => <button key={t} type="button" aria-pressed={b.dc === (t === "DC")} onClick={() => setBreakers((xs) => xs.map((x, j) => (j === k ? { ...x, dc: t === "DC" } : x)))}>{t}</button>)}
                    </div>
                    <input aria-label={`Breaker ${k + 1} rating (A)`} className="mono" inputMode="numeric" placeholder="A" value={b.rating_a} onChange={(e) => setBreakers((xs) => xs.map((x, j) => (j === k ? { ...x, rating_a: e.target.value } : x)))} />
                    <label className="toggle"><input type="checkbox" checked={b.free} onChange={(e) => setBreakers((xs) => xs.map((x, j) => (j === k ? { ...x, free: e.target.checked } : x)))} />Free</label>
                    <button type="button" className="icon-btn" aria-label={`Remove breaker ${b.position ?? k + 1}`} onClick={() => setBreakers((xs) => xs.filter((_, j) => j !== k))}>×</button>
                  </div>
                ))}
                <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => setBreakers((xs) => [...xs, { position: Math.max(0, ...xs.map((x) => x.position ?? 0)) + 1, dc: true, rating_a: "", free: true }])}>Add breaker</button>
              </section>
            )}
            {((data.facts.observations as { rule: string; text: string }[] | undefined)?.length || (data.facts.processing_notes as string[] | undefined)?.length) ? (
              <section className="panel fields full" aria-label="Notes from processing">
                {(data.facts.observations as { rule: string; text: string }[] | undefined)?.map((o, k) => <p className="note info" key={k}><span className="mono">{o.rule}</span> {o.text}</p>)}
                {(data.facts.processing_notes as string[] | undefined)?.map((n, k) => <p className="note warn" key={`n${k}`}>{n}</p>)}
              </section>
            ) : null}
          </>
        )}
        <dialog ref={addDialog} className="add-dialog" aria-labelledby="add-h">
          <form method="dialog" className="stack" onSubmit={() => {
            const a = ADD[adding.kind];
            const room = { w: num(facts.w) ?? 4, d: num(facts.d) ?? 4 };
            const id = `new-${Date.now()}`;
            // It lands in the middle of the room; the engineer drags it into place.
            setItems((xs) => [...xs, { id, kind: adding.kind, label: adding.label.trim() || autoLabel, x_tiles: Math.max(0, Math.round((room.w - a.w) * 5) / 10),
              y_tiles: Math.max(0, Math.round((room.d - a.d) * 5) / 10), w_tiles: a.w, d_tiles: a.d, facing: a.facing ?? null, props: { ...a.props } }]);
            if (adding.kind === "rack") setFreeText((f) => ({ ...f, [id]: "" }));
          }}>
            <h2 id="add-h">Add an item</h2>
            <div className="field"><label htmlFor="add-k">Type</label>
              <select id="add-k" value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })}>
                {Object.entries(ADD).map(([k, a]) => <option key={k} value={k}>{a.name}</option>)}
              </select></div>
            <div className="field"><label htmlFor="add-l">Label</label>
              <input id="add-l" placeholder={autoLabel} maxLength={20} value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} /></div>
            <p className="muted small">It appears in the middle of the plan. Drag it into place.</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => addDialog.current?.close()}>Cancel</button>
              <button className="btn btn-primary">Add</button>
            </div>
          </form>
        </dialog>
        {askPass && (
          <section className="panel fields full">
            <div className="field"><label htmlFor="pass">Team passcode</label>
              <input id="pass" type="password" autoComplete="off" value={passcode} onChange={(e) => setPasscode(e.target.value)} /></div>
          </section>
        )}
        {error && <p className="note error full" role="alert">{error}{stale && <> <button className="link-btn" onClick={() => void load()}>Reload</button></>}</p>}
      </div>
    </Shell>
  );
}
