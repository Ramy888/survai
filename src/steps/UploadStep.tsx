import { useEffect, useRef, useState } from "react";
import {
  deleteFile, findToBlur, listFiles, savedPasscode, setFootage, startProcessing, uploadFile, type FileKind, type RoomFiles, type Survey, type UploadedFile,
} from "../api";
import { Clip, FrameGrid, ModelChip } from "../components/Footage";
import { blurredBlob, scaleBoxes } from "../footage/blur";
import { framesFromVideo, type Progress } from "../footage/extract";
import { Shell } from "../components/Shell";

const ROOM_NAME: Record<string, string> = { devices_hall: "Devices hall", connect_to: "Connect-to room" };
export const KINDS: { kind: FileKind; label: string; hint: string; limit: number; accept: string; rooms: string[]; optional?: boolean }[] = [
  { kind: "key_frame", label: "Key frames", hint: "Up to 30 sharp, blurred frames", limit: 30, accept: "image/jpeg,image/png", rooms: ["devices_hall", "connect_to"] },
  { kind: "path_clip", label: "Narrated path clip", hint: "MP4, 20-30 s, the cable route", limit: 1, accept: "video/mp4", rooms: ["devices_hall"] },
  { kind: "panel_photo", label: "Power panel photos", hint: "Needed to read the breakers", limit: 3, accept: "image/jpeg,image/png", rooms: ["devices_hall"] },
  { kind: "photo", label: "Other photos", hint: "Optional", limit: 5, accept: "image/jpeg,image/png", rooms: ["devices_hall", "connect_to"], optional: true },
];
const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5L19 7" /></svg>;
const DASH = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M7 12h10" /></svg>;
const PLUS = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

export function UploadStep({ survey, onStarted, back }: { survey: Survey; onStarted: () => void; back?: { label: string; go: () => void } }) {
  // Once processing starts the footage is what the models saw: shown as uploaded, no longer changed here.
  const locked = survey.status !== "uploading";
  const [rooms, setRooms] = useState<Record<string, RoomFiles> | null>(null);
  const [passcode, setPasscode] = useState(savedPasscode);
  const [progress, setProgress] = useState<{ slot: string; done: number; total: number; frac: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // How the room's key frames arrive: picked here from the walk-through video, or prepared with tools/prepare.
  const [source, setSource] = useState<"video" | "prepared">("video");
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
    try {
      // Say how this survey's frames were made, so the replay and report tell the truth about blurring.
      for (const role of survey.rooms) await setFootage(survey.id, role, { source, blurred: true }, passcode);
      await startProcessing(survey.id, passcode); onStarted();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  const complete = rooms && Object.values(rooms).every((r) => r.missing.length === 0);
  return (
    <Shell step={2} surveyCode={survey.site}
      actions={locked ? back && <button className="btn btn-primary" onClick={back.go}>{back.label}</button>
        : <button className="btn btn-primary" disabled={!complete || !!progress || busy || !passcode} onClick={process}>{busy ? "Starting…" : "Process footage"}</button>}>
      <div className="stack narrow">
        <div>
          <h1>{locked ? "Uploaded footage" : "Upload footage"}</h1>
          <p className="muted">{locked ? "What the models worked from, as uploaded."
            : "Film a slow walk-through of the room, a narrated clip of the cable route, and the power panel. SurvAI picks the frames from the walk-through."}</p>
        </div>
        {locked && <p className="note info">Locked once processing started: the layout and the meeting are built on these files. To use different footage, start a new survey.</p>}
        {survey.processing_error && <p className="note error" role="alert">{survey.processing_error}</p>}
        {!rooms && !error && <p className="muted">Loading files…</p>}
        {/* First, because adding files needs it. */}
        {!locked && !savedPasscode() && (
          <section className="panel fields">
            <div className="field"><label htmlFor="pass">Team passcode</label>
              <input id="pass" type="password" autoComplete="off" value={passcode} onChange={(e) => setPasscode(e.target.value)} /></div>
          </section>
        )}
        {!locked && rooms && (
          <section className="panel" aria-labelledby="h-source">
            <h2 id="h-source">What will you upload?</h2>
            <div className="seg" role="group" aria-labelledby="h-source">
              <button type="button" aria-pressed={source === "video"} onClick={() => setSource("video")}>The video as is</button>
              <button type="button" aria-pressed={source === "prepared"} onClick={() => setSource("prepared")}>Prepared frames</button>
            </div>
            <p className="muted small" style={{ marginTop: 10 }}>{source === "video"
              ? <>Upload the walk-through as you filmed it. SurvAI picks the 30 sharpest frames and blurs labels before anything is stored <ModelChip model="sam-3.1" what="finds what to blur" /></>
              : "Frames you already picked and blurred yourself, for example with tools/prepare."}</p>
          </section>
        )}
        {rooms && survey.rooms.slice().sort().reverse().map((role) => (
          <section className="panel" key={role} aria-labelledby={`h-${role}`}>
            <h2 id={`h-${role}`}>{ROOM_NAME[role]}</h2>
            <div className="rows">
              {KINDS.filter((k) => k.rooms.includes(role)).map((k) => !locked && source === "video" && k.kind === "key_frame" ? (
                <VideoFrames key={k.kind} surveyId={survey.id} role={role} passcode={passcode} files={rooms[role].files.filter((f) => f.kind === "key_frame")}
                  disabled={!!progress || !passcode} onDone={refresh} onError={setError} />
              ) : (
                <Slot key={k.kind} role={role} k={k} files={rooms[role].files.filter((f) => f.kind === k.kind)}
                  missing={rooms[role].missing.includes(k.kind)} progress={progress?.slot === `${role}:${k.kind}` ? progress : null}
                  disabled={!!progress || !passcode} locked={locked} onAdd={(l) => add(role, k.kind, l)} onRemove={remove} />
              ))}
            </div>
            <Preview surveyId={survey.id} files={rooms[role].files} />
          </section>
        ))}
        {error && <p className="note error" role="alert">{error}</p>}
      </div>
    </Shell>
  );
}

/** The walk-through video as filmed: SurvAI picks the frames in this browser, Meta SAM 3.1 finds the labels to blur,
 * the browser blurs them, and only the blurred frames are uploaded as key frames. The engineer only films. */
function VideoFrames({ surveyId, role, passcode, files, disabled, onDone, onError }: {
  surveyId: string; role: string; passcode: string; files: UploadedFile[]; disabled: boolean;
  onDone: () => Promise<unknown>; onError: (m: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  type Work = Progress | { stage: "finding" | "uploading"; done: number; total: number };
  const [work, setWork] = useState<Work | null>(null);
  const [picked, setPicked] = useState<{ name: string; seconds: number; frames: number; blurred: number } | null>(null);
  const total = files.reduce((s, f) => s + f.bytes, 0);

  async function run(file: File | undefined) {
    if (!file) return;
    onError("");
    try {
      const { frames, duration } = await framesFromVideo(file, 30, setWork);
      // Three frames at a time: SAM 3.1 answers with boxes only, the server keeps nothing; the browser blurs.
      const blurred: Blob[] = new Array(frames.length);
      let next = 0;
      let done = 0;
      let areas = 0;
      setWork({ stage: "finding", done: 0, total: frames.length });
      await Promise.all(Array.from({ length: 3 }, async () => {
        while (next < frames.length) {
          const k = next++;
          const bitmap = await createImageBitmap(frames[k].blob);
          const { width, height } = bitmap;
          bitmap.close();
          const found = await findToBlur(surveyId, frames[k].blob, passcode);
          const boxes = scaleBoxes(found.boxes, found.width, found.height, width, height);
          areas += boxes.length;
          blurred[k] = await blurredBlob(frames[k].blob, width, height, boxes);
          setWork({ stage: "finding", done: ++done, total: frames.length });
        }
      }));
      for (const f of files) await deleteFile(surveyId, f.id, passcode); // a new video replaces the last one's frames
      for (const [k, blob] of blurred.entries()) {
        setWork({ stage: "uploading", done: k, total: blurred.length });
        await uploadFile(surveyId, role, "key_frame", new File([blob], `walkthrough-${String(k + 1).padStart(2, "0")}.jpg`, { type: "image/jpeg" }), passcode, () => {});
      }
      setPicked({ name: file.name, seconds: Math.round(duration), frames: frames.length, blurred: areas });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setWork(null);
      await onDone();
    }
  }

  const sub = work
    ? work.stage === "reading" ? "Reading the video…"
      : work.stage === "scoring" ? `Finding the sharpest frames: ${work.done} of ${work.total} checked`
        : work.stage === "capturing" ? `Saving frame ${work.done} of ${work.total}`
          : work.stage === "finding" ? `Blurring labels with Meta SAM 3.1: ${work.done} of ${work.total} frames`
            : `Uploading frame ${work.done + 1} of ${work.total}`
    : files.length ? `${files.length} key frames${picked ? ` from ${picked.name} (${picked.seconds} s), ${picked.blurred} areas blurred` : ""} · ${mb(total)}`
      : "MP4 or MOV, filmed slowly around the room";
  return (
    <div className="fileslot">
      <div className="r nohover">
        <span className={`state ${files.length ? "ok" : "todo"}`}>{files.length ? CHECK : PLUS}</span>
        <div className="grow">
          Walk-through video
          <span className="sub" aria-live="polite">{sub}</span>
          {work && <div className="prog"><i style={{ width: `${Math.round((work.done / Math.max(work.total, 1)) * 100)}%` }} /></div>}
        </div>
        <input ref={input} type="file" hidden accept="video/*" id={`${role}-walkthrough`} onChange={(e) => { void run(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="btn btn-secondary" disabled={disabled || !!work} onClick={() => input.current?.click()}>{files.length ? "Replace video" : "Choose video"}</button>
      </div>
      {picked && picked.frames < 30 && !work && <p className="note warn small">Only {picked.frames} frames: the video is short or blurry in places. Film a longer, slower walk-through for more.</p>}
    </div>
  );
}

export function Slot({ role, k, files, missing, progress, disabled, locked, onAdd, onRemove }: {
  role: string; k: (typeof KINDS)[number]; files: { id: string; name: string; bytes: number }[]; missing: boolean;
  progress: { done: number; total: number; frac: number } | null; disabled: boolean; locked: boolean;
  onAdd: (l: FileList | null) => void; onRemove: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const total = files.reduce((s, f) => s + f.bytes, 0);
  const full = files.length >= k.limit && k.kind !== "path_clip";
  const sub = progress
    ? `Uploading ${progress.done + 1} of ${progress.total}`
    : files.length ? `${files.length}${k.limit > 1 ? ` of ${k.limit}` : ""} · ${mb(total)}` : locked ? "Not uploaded" : k.hint;
  return (
    <div className="fileslot">
      <div className="r nohover">
        <span className={`state ${files.length ? "ok" : "todo"}`}>{files.length ? CHECK : locked ? DASH : PLUS}</span>
        <div className="grow">
          {k.label}{missing && <span className="sr-only"> (required)</span>}
          <span className={`sub${files.length || progress ? " mono" : ""}`}>{sub}</span>
          {progress && <div className="prog"><i style={{ width: `${Math.round(((progress.done + progress.frac) / progress.total) * 100)}%` }} /></div>}
        </div>
        {!locked && <><input ref={input} type="file" hidden accept={k.accept} multiple={k.limit > 1} id={`${role}-${k.kind}`}
          onChange={(e) => { onAdd(e.target.files); e.target.value = ""; }} />
        <button className="btn btn-secondary" disabled={disabled || full} onClick={() => input.current?.click()}
          aria-label={`${files.length && k.kind === "path_clip" ? "Replace" : "Add"} ${k.label.toLowerCase()}`}>
          {files.length && k.kind === "path_clip" ? "Replace" : "Add"}
        </button></>}
      </div>
      {k.kind !== "key_frame" && files.map((f) => (
        <div className="filerow" key={f.id}>
          <span className="name">{f.name}</span><span className="mono">{mb(f.bytes)}</span>
          {!locked && <button className="link-btn" onClick={() => onRemove(f.id)} disabled={disabled}>Remove<span className="sr-only"> {f.name}</span></button>}
        </div>
      ))}
      {k.kind === "key_frame" && files.length > 0 && (
        <div className="filerow">
          <span className="name">{files[0].name} … {files.at(-1)!.name}</span>
          {!locked && <button className="link-btn" onClick={() => onRemove(files.at(-1)!.id)} disabled={disabled}>Remove last</button>}
        </div>
      )}
    </div>
  );
}

/** What is about to go to the models: the frames, the narrated clip and the photos, as uploaded. */
function Preview({ surveyId, files }: { surveyId: string; files: UploadedFile[] }) {
  const of = (kind: FileKind) => files.filter((f) => f.kind === kind);
  const clip = of("path_clip")[0];
  const photos = [...of("panel_photo"), ...of("photo")];
  if (!files.length) return null;
  return (
    <div className="preview">
      {of("key_frame").length > 0 && <><span className="label">Key frames</span><FrameGrid surveyId={surveyId} files={of("key_frame")} /></>}
      {clip && <><span className="label">Narrated path clip</span><Clip surveyId={surveyId} f={clip} /></>}
      {photos.length > 0 && <><span className="label">Photos</span><FrameGrid surveyId={surveyId} files={photos} /></>}
    </div>
  );
}
