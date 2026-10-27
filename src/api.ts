// Thin fetch wrappers for the Worker API. Errors carry the server's message for the inline error note.
export interface DeviceSpec {
  height_u: number; depth_mm: number | null; power_w: number; feed_type: "AC" | "DC"; feed_types?: ("AC" | "DC")[];
  feed_count: number; breaker_rating_a: number | null; airflow: string | null; weight_kg: number | null;
  sources: { url: string; title?: string | null }[];
}
export interface Survey {
  id: string; site: string; project: string; device_model: string; quantity: number;
  connects_to: "same_room" | "other_room"; status: string; reps: string[]; rooms: string[];
  device: (DeviceSpec & { confirmed: boolean }) | null;
}
export type NewSurvey = Omit<Survey, "id" | "status" | "rooms" | "device">;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly manual = false) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string; manual?: boolean };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.manual);
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
