import { useEffect, useRef, useState } from "react";
import {
  deleteFile, listFiles, savedPasscode, startProcessing, uploadFile, type FileKind, type RoomFiles, type Survey,
} from "../api";
import { Shell } from "../components/Shell";

const ROOM_NAME: Record<string, string> = { devices_hall: "Devices hall", connect_to: "Connect-to room" };
const KINDS: { kind: FileKind; label: string; hint: string; limit: number; accept: string; rooms: string[]; optional?: boolean }[] = [
  { kind: "key_frame", label: "Key frames", hint: "Up to 30 sharp, blurred frames", limit: 30, accept: "image/jpeg,image/png", rooms: ["devices_hall", "connect_to"] },
  { kind: "path_clip", label: "Narrated path clip", hint: "MP4, 20-30 s, the cable route", limit: 1, accept: "video/mp4", rooms: ["devices_hall"] },
  { kind: "panel_photo", label: "Power panel photos", hint: "Needed to read the breakers", limit: 3, accept: "image/jpeg,image/png", rooms: ["devices_hall"] },
  { kind: "photo", label: "Other photos", hint: "Optional", limit: 5, accept: "image/jpeg,image/png", rooms: ["devices_hall", "connect_to"], optional: true },
];
const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5L19 7" /></svg>;
const PLUS = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

export function UploadStep({ survey, onStarted }: { survey: Survey; onStarted: () => void }) {
  const [rooms, setRooms] = useState<Record<string, RoomFiles> | null>(null);
  const [passcode, setPasscode] = useState(savedPasscode);
  const [progress, setProgress] = useState<{ slot: string; done: number; total: number; frac: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => listFiles(survey.id).then((r) => setRooms(r.rooms), (e: Error) => setError(e.message));
  useEffect(() => { void refresh(); }, [survey.id]);

  async function add(role: string, kind: FileKind, list: FileList | null) {
    if (!list?.length) return;
    setError("");
    const chosen = [...list];
    for (let i = 0; i < chosen.length; i++) {
      setProgress({ slot: `${role}:${kind}`, done: i, total: chosen.length, frac: 0 });
      try {
        await uploadFile(survey.id, role, kind, chosen[i], passcode, (frac) => setProgress({ slot: `${role}:${kind}`, done: i, total: chosen.length, frac }));
      } catch (e) {
        setError(`${chosen[i].name}: ${(e as Error).message}`);
        break;
      }
    }
    setProgress(null);
    await refresh();
  }

  async function remove(fileId: string) {
    setError("");
    try { await deleteFile(survey.id, fileId, passcode); } catch (e) { setError((e as Error).message); }
    await refresh();
  }

  async function process() {
    setBusy(true);
    setError("");
    try { await startProcessing(survey.id, passcode); onStarted(); } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  const complete = rooms && Object.values(rooms).every((r) => r.missing.length === 0);
  return (
    <Shell step={2} surveyCode={survey.site}
      actions={<button className="btn btn-primary" disabled={!complete || !!progress || busy || !passcode} onClick={process}>{busy ? "Starting…" : "Process footage"}</button>}>
      <div className="stack narrow">
        <div>
          <h1>Upload footage</h1>
          <p className="muted">Prepare the files on your computer first. Faces, labels and logos are blurred before anything leaves it.</p>
        </div>
        {survey.processing_error && <p className="note error" role="alert">{survey.processing_error}</p>}
        {!rooms && !error && <p className="muted">Loading files…</p>}
        {/* First, because adding files needs it. */}
        {!savedPasscode() && (
          <section className="panel fields">
            <div className="field"><label htmlFor="pass">Team passcode</label>
              <input id="pass" type="password" autoComplete="off" value={passcode} onChange={(e) => setPasscode(e.target.value)} /></div>
          </section>
        )}
        {rooms && survey.rooms.slice().sort().reverse().map((role) => (
          <section className="panel" key={role} aria-labelledby={`h-${role}`}>
            <h2 id={`h-${role}`}>{ROOM_NAME[role]}</h2>
            <div className="rows">
              {KINDS.filter((k) => k.rooms.includes(role)).map((k) => (
                <Slot key={k.kind} role={role} k={k} files={rooms[role].files.filter((f) => f.kind === k.kind)}
                  missing={rooms[role].missing.includes(k.kind)} progress={progress?.slot === `${role}:${k.kind}` ? progress : null}
                  disabled={!!progress || !passcode} onAdd={(l) => add(role, k.kind, l)} onRemove={remove} />
              ))}
            </div>
          </section>
        ))}
        {error && <p className="note error" role="alert">{error}</p>}
      </div>
    </Shell>
  );
}

function Slot({ role, k, files, missing, progress, disabled, onAdd, onRemove }: {
  role: string; k: (typeof KINDS)[number]; files: { id: string; name: string; bytes: number }[]; missing: boolean;
  progress: { done: number; total: number; frac: number } | null; disabled: boolean;
  onAdd: (l: FileList | null) => void; onRemove: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const total = files.reduce((s, f) => s + f.bytes, 0);
  const full = files.length >= k.limit && k.kind !== "path_clip";
  const sub = progress
    ? `Uploading ${progress.done + 1} of ${progress.total}`
    : files.length ? `${files.length}${k.limit > 1 ? ` of ${k.limit}` : ""} · ${mb(total)}` : k.hint;
  return (
    <div className="fileslot">
      <div className="r nohover">
        <span className={`state ${files.length ? "ok" : "todo"}`}>{files.length ? CHECK : PLUS}</span>
        <div className="grow">
          {k.label}{missing && <span className="sr-only"> (required)</span>}
          <span className={`sub${files.length || progress ? " mono" : ""}`}>{sub}</span>
          {progress && <div className="prog"><i style={{ width: `${Math.round(((progress.done + progress.frac) / progress.total) * 100)}%` }} /></div>}
        </div>
        <input ref={input} type="file" hidden accept={k.accept} multiple={k.limit > 1} id={`${role}-${k.kind}`}
          onChange={(e) => { onAdd(e.target.files); e.target.value = ""; }} />
        <button className="btn btn-secondary" disabled={disabled || full} onClick={() => input.current?.click()}
          aria-label={`${files.length && k.kind === "path_clip" ? "Replace" : "Add"} ${k.label.toLowerCase()}`}>
          {files.length && k.kind === "path_clip" ? "Replace" : "Add"}
        </button>
      </div>
      {k.kind !== "key_frame" && files.map((f) => (
        <div className="filerow" key={f.id}>
          <span className="name">{f.name}</span><span className="mono">{mb(f.bytes)}</span>
          <button className="link-btn" onClick={() => onRemove(f.id)} disabled={disabled}>Remove<span className="sr-only"> {f.name}</span></button>
        </div>
      ))}
      {k.kind === "key_frame" && files.length > 0 && (
        <div className="filerow">
          <span className="name">{files[0].name} … {files.at(-1)!.name}</span>
          <button className="link-btn" onClick={() => onRemove(files.at(-1)!.id)} disabled={disabled}>Remove last</button>
        </div>
      )}
    </div>
  );
}
