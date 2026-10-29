import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getLayout, listFiles, saveLayout, savePasscode, savedPasscode, type LayoutItem, type RoomLayout, type Survey, type UploadedFile } from "../api";
import { Shell } from "../components/Shell";
import { FloorPlan } from "../report/FloorPlan";
import { FrameGrid, ModelChip } from "../components/Footage";

type Breaker = { position: number | null; dc: boolean; rating_a: string; free: boolean };
const ROOM: Record<string, string> = { devices_hall: "Devices hall", connect_to: "Connect-to room" };
// What the engineer can add, at a typical size in tiles (600 mm). A cable path is drawn by the Survey Lead, not added.
const ADD: Record<string, { name: string; tag: string; w: number; d: number; props: Record<string, unknown>; facing?: string }> = {
  rack: { name: "Rack", tag: "R", w: 1, d: 1.7, props: { height_u: 42, free_blocks: [] }, facing: "east" },
  ac: { name: "A/C unit", tag: "AC", w: 1.5, d: 1, props: {} },
  panel: { name: "Power panel", tag: "P", w: 1, d: 0.3, props: {} },
  door: { name: "Door", tag: "D", w: 1.5, d: 0.2, props: { swing_m: 0.9 } },
  column: { name: "Column", tag: "C", w: 1, d: 1, props: {} },
  ladder: { name: "Cable ladder", tag: "L", w: 4, d: 0.5, props: {} },
  reserved: { name: "Reserved space", tag: "RES", w: 1, d: 1.7, props: {} },
};
const num = (v: string) => (v.trim() === "" ? null : Number(v));
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
  const [adding, setAdding] = useState({ kind: "rack", label: "" });
  const addDialog = useRef<HTMLDialogElement>(null);
  const autoLabel = `${ADD[adding.kind].tag}${items.filter((i) => i.kind === adding.kind).length + 1}`; // a blank label gets the next name, e.g. AC2
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
      ladder_height_m: f.ladder_height_m != null ? String(f.ladder_height_m) : "", inter_room_m: f.inter_room_m != null ? String(f.inter_room_m) : "",
    });
    const confirmed = f.breakers_confirmed as Breaker[] | null | undefined;
    setBreakers(confirmed?.map((b) => ({ ...b, rating_a: b.rating_a == null ? "" : String(b.rating_a) })) ??
      ((f.breakers_draft as { position: number | null; dc?: boolean | null; rating_a?: number | null }[] | undefined) ?? [])
        // Numbered down the list: the reader's positions restart in every box and photo, so they repeat.
        .map((b, k) => ({ position: k + 1, dc: b.dc ?? true, rating_a: b.rating_a ? String(b.rating_a) : "", free: false })));
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
  const planItems = useMemo(() => [...items, ...(data?.items.filter((i) => i.source === "lead") ?? [])]
    .map((i) => ({ id: i.id ?? "", kind: i.kind, label: i.label, x: i.x_tiles, y: i.y_tiles, w: i.w_tiles, d: i.d_tiles, facing: i.facing, props: i.props, source: i.source ?? "engineer" })), [items, data]);

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
        {roles.length > 1 && (
          <div className="seg full" role="group" aria-label="Room">
            {roles.map((r) => <button key={r} type="button" aria-pressed={r === role} onClick={() => setRole(r)}>{ROOM[r]}</button>)}
          </div>
        )}
        {req && (req.source || req.destination) && (
          <section className="panel req full" aria-label="Request">
            <div className="title-row"><h2>Request from the narrated clip</h2><ModelChip model="muse-spark-1.3" what="transcribed and translated" /></div>
            {req.translation_en && <p>{req.translation_en}</p>}
            <p className="muted"><b>Goes in:</b> {req.source ?? "—"} · <b>Route:</b> {req.route ?? "—"} · <b>To:</b> {req.destination ?? "—"}</p>
          </section>
        )}
        {frames.some((f) => f.masks) && (
          <section className="panel full" aria-labelledby="sam-h">
            <div className="title-row"><h2 id="sam-h">What the models found in your frames</h2><ModelChip model="sam-3.1" what="racks and floor tiles" /></div>
            <p className="muted sam-key"><i className="k-rack" />Rack <i className="k-tile" />Floor tile · {frames.reduce((n, f) => n + (f.masks?.racks.length ?? 0), 0)} racks and {frames.reduce((n, f) => n + (f.masks?.tiles.length ?? 0), 0)} tiles found in {frames.length} frames</p>
            <FrameGrid surveyId={survey.id} files={frames} withMasks />
          </section>
        )}
        {!data && !error && <p className="muted">Loading layout…</p>}
        {data && (
          <>
            <section className="panel plan-panel" aria-label="Floor plan">
              <div className="plan-by"><ModelChip model="Muse Spark" what="drafted from the frames; correct it below" /></div>
              <FloorPlan size={num(facts.w) && num(facts.d) ? { w: num(facts.w)!, d: num(facts.d)! } : null} items={planItems} lengths={{}} clearances={[]}
                onMove={(id, x, y) => set(id, { x_tiles: x, y_tiles: y })} />
              <div className="plan-actions">
                <p className="muted small">Drag an item to move it, or select it and use the arrow keys.</p>
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
                      <button className="link-btn row-actions" onClick={() => setItems((xs) => xs.filter((i) => i.id !== r.id))}>Remove<span className="sr-only"> {r.label}</span></button>
                    </div>
                    <div className="two">
                      <div className="field"><label htmlFor={`h-${r.id}`}>Height (U)</label>
                        <input id={`h-${r.id}`} className="mono" inputMode="numeric" value={String(r.props.height_u ?? 42)} onChange={(e) => setProp(r.id!, "height_u", Number(e.target.value) || 42)} /></div>
                      <div className="field"><label htmlFor={`f-${r.id}`}>Free U</label>
                        <input id={`f-${r.id}`} className="mono" placeholder="10-30, 35-36" value={freeText[r.id!] ?? ""} aria-invalid={parseBlocks(freeText[r.id!] ?? "") === null || undefined}
                          onChange={(e) => setFreeText((f) => ({ ...f, [r.id!]: e.target.value }))} /></div>
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
                <div className="field"><label htmlFor="btu">Spare A/C (BTU/h)</label><input id="btu" className="mono" inputMode="numeric" placeholder="unknown" value={facts.spare_ac_btu} onChange={(e) => setFacts({ ...facts, spare_ac_btu: e.target.value })} /></div>
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
                <p className="muted" style={{ marginBottom: 8 }}><ModelChip model="muse-spark-1.3" what="read the panel photo" /> Ratings it could not read (the photo is blurred) are blank. Confirm each breaker on site.</p>
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
