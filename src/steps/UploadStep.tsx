import { useEffect, useRef, useState } from "react";
import {
  deleteFile, findToBlur, listFiles, savedPasscode, setFootage, startProcessing, uploadFile, type FileKind, type RoomFiles, type Survey, type UploadedFile,
} from "../api";
import { Clip, fileSrc, FrameStrip, ModelChip } from "../components/Footage";
import { blurredBlob, scaleBoxes } from "../footage/blur";
import { framesFromVideo, type Progress } from "../footage/extract";
import { narrationOf } from "../footage/narration";
import { Shell } from "../components/Shell";

const ROOM_NAME: Record<string, string> = { devices_hall: "Devices hall", connect_to: "Connect-to room" };
export const KINDS: { kind: FileKind; label: string; hint: string; limit: number; accept: string; rooms: string[]; optional?: boolean }[] = [
  { kind: "key_frame", label: "Key frames", hint: "Up to 30 sharp, blurred frames", limit: 30, accept: "image/jpeg,image/png", rooms: ["devices_hall", "connect_to"] },
  { kind: "path_clip", label: "Narrated video", hint: "MP4, the cable route, narrated; read once, then deleted", limit: 1, accept: "video/mp4", rooms: ["devices_hall"], optional: true },
  { kind: "panel_photo", label: "Power panel photos", hint: "Needed to read the breakers", limit: 3, accept: "image/jpeg,image/png", rooms: ["devices_hall"] },
  { kind: "photo", label: "Other photos", hint: "Optional", limit: 5, accept: "image/jpeg,image/png", rooms: ["devices_hall", "connect_to"], optional: true },
];
const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5L19 7" /></svg>;
const DASH = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M7 12h10" /></svg>;
const PLUS = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const MAX_UPLOAD = 20 * 1024 * 1024; // the server's per-file limit
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

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
            : "Film one slow walk-through of the room, saying where the device goes and how the cables run, and photograph the power panel. SurvAI takes the frames and the narration from the same video."}</p>
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
              ? <>Upload the walk-through as you filmed it. SurvAI picks the 30 sharpest frames and blurs labels in this browser <ModelChip model="sam-3.1" what="finds what to blur" />. The video goes once to Muse Spark 1.3 for the narration, then it is deleted: only the blurred frames are kept.</>
              : "Frames you already picked and blurred yourself, for example with tools/prepare, and the narrated video."}</p>
          </section>
        )}
        {rooms && survey.rooms.slice().sort().reverse().map((role) => (
          <section className="panel" key={role} aria-labelledby={`h-${role}`}>
            <h2 id={`h-${role}`}>{ROOM_NAME[role]}</h2>
            <div className="rows">
              {KINDS.filter((k) => k.rooms.includes(role) && (k.kind !== "path_clip" || (!locked && source === "prepared"))).map((k) => !locked && source === "video" && k.kind === "key_frame" ? (
                <VideoFrames key={k.kind} surveyId={survey.id} role={role} passcode={passcode} files={rooms[role].files.filter((f) => f.kind === "key_frame")}
                  narration={role === "devices_hall" ? rooms[role].files.find((f) => f.kind === "path_clip") : undefined}
                  disabled={!!progress || !passcode} onDone={refresh} onError={setError} />
              ) : (
                <Slot key={k.kind} surveyId={survey.id} role={role} k={k} files={rooms[role].files.filter((f) => f.kind === k.kind)}
                  missing={rooms[role].missing.includes(k.kind)} progress={progress?.slot === `${role}:${k.kind}` ? progress : null}
                  disabled={!!progress || !passcode} locked={locked} onAdd={(l) => add(role, k.kind, l)} onRemove={remove} />
              ))}
            </div>
          </section>
        ))}
        {error && <p className="note error" role="alert">{error}</p>}
      </div>
    </Shell>
  );
}

/** The walk-through video as filmed: SurvAI picks the frames in this browser, Meta SAM 3.1 finds the labels to blur,
 * the browser blurs them, and only the blurred frames are uploaded as key frames. The same video carries the
 * narration: it is uploaded once for Muse Spark 1.3 to read and deleted after. The engineer only films. */
function VideoFrames({ surveyId, role, passcode, files, narration, disabled, onDone, onError }: {
  surveyId: string; role: string; passcode: string; files: UploadedFile[]; narration?: UploadedFile; disabled: boolean;
  onDone: () => Promise<unknown>; onError: (m: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  type Work = Progress | { stage: "finding" | "uploading" | "listening" | "narration"; done: number; total: number };
  const [voice, setVoice] = useState<{ url: string; seconds: number; bars: number[] } | null>(null);
  const [voiceNote, setVoiceNote] = useState("");
  useEffect(() => () => { if (voice) URL.revokeObjectURL(voice.url); }, [voice]);
  const [work, setWork] = useState<Work | null>(null);
  const [picked, setPicked] = useState<{ name: string; seconds: number; frames: number; blurred: number } | null>(null);
  // Each frame appears here the moment it is blurred, so the engineer watches SAM 3.1 work.
  const [live, setLive] = useState<Parameters<typeof FrameStrip>[0]["items"]>([]);
  const urls = useRef<string[]>([]);
  const clearLive = () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current = []; setLive([]); };
  useEffect(() => clearLive, []);
  const total = files.reduce((s, f) => s + f.bytes, 0);

  async function run(file: File | undefined) {
    if (!file) return;
    onError("");
    clearLive();
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
          const shown = { key: `live-${k}`, src: URL.createObjectURL(blurred[k]), n: k + 1, found: { w: width, h: height, boxes } };
          urls.current.push(shown.src);
          setLive((l) => [...l, shown]);
          setWork({ stage: "finding", done: ++done, total: frames.length });
        }
      }));
      for (const f of files) await deleteFile(surveyId, f.id, passcode); // a new video replaces the last one's frames
      for (const [k, blob] of blurred.entries()) {
        setWork({ stage: "uploading", done: k, total: blurred.length });
        await uploadFile(surveyId, role, "key_frame", new File([blob], `walkthrough-${String(k + 1).padStart(2, "0")}.jpg`, { type: "image/jpeg" }), passcode, () => {});
      }
      setPicked({ name: file.name, seconds: Math.round(duration), frames: frames.length, blurred: areas });
      clearLive(); // the uploaded frames take over the row
      if (role === "devices_hall") await addNarration(file);
    } catch (e) {
      clearLive(); // the row shows what the server has, not frames that never uploaded
      onError((e as Error).message);
    } finally {
      setWork(null);
      await onDone();
    }
  }

  async function addNarration(file: File) {
    setVoiceNote("");
    setWork({ stage: "listening", done: 0, total: 1 });
    const heard = await narrationOf(file);
    if (!heard) { setVoice(null); setVoiceNote("No narration heard in this video: the meeting will ask for the request instead."); return; }
    setVoice({ url: URL.createObjectURL(file), ...heard });
    if (file.size > MAX_UPLOAD) { setVoiceNote(`The narration was not sent: the video is ${mb(file.size)}, over the 20 MB limit. Film at 720p to have it read.`); return; }
    setWork({ stage: "narration", done: 0, total: 100 });
    await uploadFile(surveyId, role, "path_clip", file, passcode, (frac) => setWork({ stage: "narration", done: Math.round(frac * 100), total: 100 }))
      .catch((e: Error) => setVoiceNote(`The narration was not sent: ${e.message}`));
  }

  const sub = work
    ? work.stage === "reading" ? "Reading the video…"
      : work.stage === "scoring" ? `Finding the sharpest frames: ${work.done} of ${work.total} checked`
        : work.stage === "capturing" ? `Saving frame ${work.done} of ${work.total}`
          : work.stage === "finding" ? `Blurring labels with Meta SAM 3.1: ${work.done} of ${work.total} frames`
            : work.stage === "listening" ? "Taking the narration from the same video…"
              : work.stage === "narration" ? `Sending the narration for Muse Spark 1.3: ${work.done}%`
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
      {live.length > 0 ? <FrameStrip items={live} follow />
        : <FrameStrip items={files.map((f, i) => ({ key: f.id, src: fileSrc(surveyId, f), n: i + 1 }))} />}
      {picked && picked.frames < 30 && !work && <p className="note warn small">Only {picked.frames} frames: the video is short or blurry in places. Film a longer, slower walk-through for more.</p>}
      {(voice || narration || voiceNote) && (
        <div className="narration" aria-labelledby={`${role}-narration`}>
          <div className="title-row"><h3 id={`${role}-narration`}>Narration</h3><ModelChip model="muse-spark-1.3" what="transcribes and translates it" /></div>
          {voice && <svg className="wave" viewBox={`0 0 ${voice.bars.length * 3} 40`} preserveAspectRatio="none" aria-hidden="true">
            {voice.bars.map((p, i) => <rect key={i} x={i * 3} y={20 - Math.max(1, p * 19)} width="2" height={Math.max(2, p * 38)} rx="1" />)}
          </svg>}
          {/* Sound only: the video itself shows the room unblurred. */}
          {(voice || narration) && <audio controls preload="metadata" src={voice?.url ?? fileSrc(surveyId, narration!)} aria-label="The engineer's narration" />}
          <p className="sub small muted">{voiceNote || `${voice ? `${clock(voice.seconds)} of speech, taken from the same video. ` : ""}Read when processing starts, then the video is deleted.`}</p>
        </div>
      )}
    </div>
  );
}

export function Slot({ surveyId, role, k, files, missing, progress, disabled, locked, onAdd, onRemove }: {
  surveyId: string; role: string; k: (typeof KINDS)[number]; files: UploadedFile[]; missing: boolean;
  progress: { done: number; total: number; frac: number } | null; disabled: boolean; locked: boolean;
  onAdd: (l: FileList | null) => void; onRemove: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const total = files.reduce((s, f) => s + f.bytes, 0);
  const full = files.length >= k.limit && k.kind !== "path_clip";
  const photos = k.kind === "panel_photo" || k.kind === "photo"; // shown as tiles: remove on the image, add beside them
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
        {!(photos && files.length) && <button className="btn btn-secondary" disabled={disabled || full} onClick={() => input.current?.click()}
          aria-label={`${files.length && k.kind === "path_clip" ? "Replace" : "Add"} ${k.label.toLowerCase()}`}>
          {files.length && k.kind === "path_clip" ? "Replace" : "Add"}
        </button>}</>}
      </div>
      {photos && files.length > 0 && (
        <ul className="tiles">
          {files.map((f) => (
            <li key={f.id}>
              <img src={fileSrc(surveyId, f)} alt="" loading="lazy" />
              {!locked && <button type="button" className="tile-x" onClick={() => onRemove(f.id)} disabled={disabled} aria-label={`Remove ${f.name}`}>×</button>}
              <span className="tile-name">{f.name}</span>
            </li>
          ))}
          {!locked && !full && <li><button type="button" className="tile-add" disabled={disabled} onClick={() => input.current?.click()}>+<span>Add more</span></button></li>}
        </ul>
      )}
      {!photos && k.kind !== "key_frame" && files.map((f) => (
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
      {/* Each item's media right under it: frames and photos in a row, the clip as a player. */}
      {k.kind === "path_clip" ? files[0] && <Clip surveyId={surveyId} f={files[0]} />
        : !photos && <FrameStrip items={files.map((f, i) => ({ key: f.id, src: fileSrc(surveyId, f), n: i + 1 }))} />}
    </div>
  );
}
