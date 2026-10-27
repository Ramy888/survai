// Breaker count from blurred power-panel photos (Spark 1.3). Ratings are rarely legible: the engineer confirms.
import { z } from "zod";

export const PanelReading = z.object({
  boxes: z.array(z.object({
    breakers: z.array(z.object({
      position: z.number().int().nullish(),
      kind: z.string().max(20).nullish(),
      poles: z.number().int().nullish(),
      rating_a: z.number().nullish(),
      dc: z.boolean().nullish(),
      looks_free: z.boolean().nullish(),
    })).max(60),
  })).max(6),
  free_breakers: z.number().int().nullish(),
  readable: z.enum(["all", "some", "none"]).nullish(),
  notes: z.string().max(400).nullish(),
});
export type PanelReading = z.infer<typeof PanelReading>;

export const PANEL_PROMPT =
  "Photo of a power distribution box in a telecom equipment room. Count every breaker module you can see, even when " +
  "its rating is unreadable (text and labels are blurred on purpose; that is expected). Give each one a position from " +
  "left to right per row, and set rating_a to null when you cannot read it. Reply with only JSON: {\"boxes\": " +
  "[{\"breakers\": [{\"position\": number, \"kind\": \"MCB|MCCB|RCD|isolator|unknown\", \"poles\": number|null, " +
  "\"rating_a\": number|null, \"dc\": true|false|null, \"looks_free\": true|false|null}]}], \"free_breakers\": " +
  "number|null, \"readable\": \"all|some|none\", \"notes\": \"one sentence\"}.";
