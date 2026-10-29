// Thin fetch wrappers for the Worker API. Errors carry the server's message for the inline error note.
export interface DeviceSpec {
  height_u: number; depth_mm: number | null; power_w: number; feed_type: "AC" | "DC"; feed_types?: ("AC" | "DC")[];
  feed_count: number; breaker_rating_a: number | null; airflow: string | null; weight_kg: number | null;
  sources: { url: string; title?: string | null }[];
}
export interface Survey {
  id: string; site: string; project: string; device_model: string; quantity: number;
  connects_to: "same_room" | "other_room"; status: string; reps: string[]; rooms: string[];
  device: (DeviceSpec & { confirmed: boolean }) | null; processing_error: string | null;
}
export type NewSurvey = Omit<Survey, "id" | "status" | "rooms" | "device" | "processing_error">;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly manual = false, readonly problems?: string[]) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string; manual?: boolean; problems?: string[] };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.manual, body.problems);
  return body as T;
}

const withPasscode = (passcode: string, method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json", "X-Passcode": passcode },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const createSurvey = (s: NewSurvey, passcode: string) => call<{ id: string }>("/api/surveys", withPasscode(passcode, "POST", s));
export const lookupDevice = (id: string, passcode: string) =>
  call<{ cached: boolean; spec: DeviceSpec }>(`/api/surveys/${id}/device/lookup`, withPasscode(passcode, "POST"));
export const confirmDevice = (id: string, spec: Omit<DeviceSpec, "feed_types">, passcode: string) =>
  call<{ status: string }>(`/api/surveys/${id}/device`, withPasscode(passcode, "PUT", spec));

export function savedPasscode() {
  try { return sessionStorage.getItem("passcode") ?? ""; } catch { return ""; }
}
export function savePasscode(p: string) {
  try { sessionStorage.setItem("passcode", p); } catch { /* per-tab convenience only */ }
}

export const getSurvey = (id: string) => call<Survey>(`/api/surveys/${id}`);

export type FileKind = "key_frame" | "path_clip" | "panel_photo" | "photo";
export interface SamBox { x1: number; y1: number; x2: number; y2: number }
export interface SamMasks { tiles: SamBox[]; racks: SamBox[] }
export interface UploadedFile { id: string; kind: FileKind; name: string; bytes: number; masks?: SamMasks }
export interface RoomFiles { files: UploadedFile[]; missing: FileKind[] }

export const listFiles = (id: string) => call<{ rooms: Record<string, RoomFiles> }>(`/api/surveys/${id}/files`);
export const deleteFile = (id: string, fileId: string, passcode: string) =>
  call<{ deleted: string }>(`/api/surveys/${id}/files/${fileId}`, withPasscode(passcode, "DELETE"));
/** One picked frame to Meta SAM 3.1 to find labels and people to blur; the server stores nothing. */
export const findToBlur = (id: string, frame: Blob, passcode: string) =>
  call<{ width: number; height: number; boxes: (SamBox & { concept: string })[] }>(`/api/surveys/${id}/redact`,
    { method: "POST", headers: { "Content-Type": "image/jpeg", "X-Passcode": passcode }, body: frame });
export const setFootage = (id: string, role: string, footage: { source: "video" | "prepared"; blurred: boolean }, passcode: string) =>
  call<{ footage: unknown }>(`/api/surveys/${id}/rooms/${role}/footage`, withPasscode(passcode, "POST", footage));
export const startProcessing = (id: string, passcode: string) =>
  call<{ status: string }>(`/api/surveys/${id}/process`, withPasscode(passcode, "POST"));

/** XHR instead of fetch: fetch cannot report upload progress. */
export function uploadFile(id: string, role: string, kind: FileKind, file: File, passcode: string, onProgress: (f: number) => void) {
  return new Promise<UploadedFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/surveys/${id}/rooms/${role}/files?kind=${kind}&name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("X-Passcode", passcode);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(body.error ?? `Upload failed (${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("The upload did not reach the server. Check the connection and try again.", 0));
    xhr.send(file);
  });
}

export interface LayoutItem {
  id?: string; kind: string; label: string | null; x_tiles: number; y_tiles: number; w_tiles: number | null; d_tiles: number | null;
  facing: string | null; props: Record<string, unknown>; source?: string;
}
export interface RoomLayout {
  role: string; name: string; status: string; layout_version: number; items: LayoutItem[];
  facts: Record<string, any>; request: { source?: string; route?: string; destination?: string; translation_en?: string } | null;
}
export const getLayout = (id: string, role: string) => call<RoomLayout>(`/api/surveys/${id}/rooms/${role}/layout`);
export const saveLayout = (id: string, role: string, body: { layout_version: number; items: LayoutItem[]; facts: Record<string, unknown> }, passcode: string) =>
  call<{ layout_version: number; status: string; meeting_started: boolean }>(`/api/surveys/${id}/rooms/${role}/layout`, withPasscode(passcode, "PUT", body));

export interface Question { id: string; text: string; answer_kind: "yes_no" | "number" | "text"; answer: string | null }
export interface Finding {
  id: string; agent: string; verdict: "approve" | "object" | "question" | "unavailable"; statement: string; model: string | null;
  forced_rules: string[]; rules: { id: string; text: string | null }[];
  evidence: ({ frame: number | null; file_id?: string } | { calc_id: string })[]; question: Question | null;
}
export interface Round {
  round: number; findings: Finding[]; calcs: { id: string; rule: string; pass: boolean | null; result: Record<string, unknown> }[];
  lead: { summary: string; placement: { target: string; reason: string }; conflicts: { agents: string[]; resolution: string }[]; model: string; fell_back: boolean; outcome: "next" | "waiting" | "done" } | null;
}
export interface Timeline {
  status: string; layout_version: number; deliberated_layout_version: number | null; run: number | null;
  reps: string[]; request_questions: Question[]; rounds: Round[];
}
export const getTimeline = (id: string) => call<Timeline>(`/api/surveys/${id}/timeline`);
export const answerQuestion = (qid: string, answer: string, passcode: string) =>
  call<{ answered: string; next_round: number | null }>(`/api/questions/${qid}/answer`, withPasscode(passcode, "POST", { answer }));
export const startMeeting = (id: string, passcode: string) => call<{ run: number }>(`/api/surveys/${id}/deliberate`, withPasscode(passcode, "POST"));
export const approveSurvey = (id: string, body: { tech_specs: string; overrides: Record<string, string>; issue_links: boolean }, passcode: string) =>
  call<{ status: string; links: { agent: string; token: string }[] }>(`/api/surveys/${id}/approve`, withPasscode(passcode, "POST", body));

export interface SignoffPage {
  agent: string; site: string; project: string; device: string; status: string; verdict: string; statement: string;
  override_reason: string | null; forced_rules: string[]; rules: { id: string; text: string | null }[];
  items: { kind?: string; text: string; quantity?: number | null; unit?: string | null }[]; frames: number;
  decision: { rep_name: string; decision: "approve" | "object"; comment: string | null; decided_at: string } | null;
}
const withToken = (token: string, method = "GET", body?: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json", "X-Signoff-Token": token }, body: body === undefined ? undefined : JSON.stringify(body),
});
export const getSignoff = (token: string) => call<SignoffPage>("/api/signoff", withToken(token));
export const sendSignoff = (token: string, body: { rep_name: string; decision: "approve" | "object"; comment: string }) =>
  call<{ decision: string }>("/api/signoff", withToken(token, "POST", body));
/** Evidence images need the token header, so they load as blob URLs. */
export async function signoffFrame(token: string, n: number) {
  const res = await fetch(`/api/signoff/frames/${n}`, withToken(token));
  if (!res.ok) throw new ApiError("Frame unavailable", res.status);
  return URL.createObjectURL(await res.blob());
}
export const reissueLinks = (id: string, passcode: string) =>
  call<{ links: { agent: string; token: string }[]; decided: string[] }>(`/api/surveys/${id}/signoff-links`, withPasscode(passcode, "POST"));
