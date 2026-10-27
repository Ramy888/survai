// Thin fetch wrappers for the Worker API. Errors carry the server's message for the inline error note.
export interface Survey {
  id: string; site: string; project: string; device_model: string; quantity: number;
  connects_to: "same_room" | "other_room"; status: string; reps: string[]; rooms: string[];
}
export type NewSurvey = Omit<Survey, "id" | "status" | "rooms">;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const createSurvey = (s: NewSurvey, passcode: string) =>
  call<{ id: string }>("/api/surveys", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Passcode": passcode },
    body: JSON.stringify(s),
  });

export const getSurvey = (id: string) => call<Survey>(`/api/surveys/${id}`);
