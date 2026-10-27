// protects: model answers are accepted only in the expected shape; fails_when: prose, missing fields or out-of-range
// values slip through, or fenced JSON is rejected; no_claim: answer quality (see the recorded processing run).
import { describe, expect, it } from "vitest";
import { Inventory } from "../worker/agents/inventory";
import { BadModelAnswer, parseAnswer } from "../worker/agents/json";
import { Request } from "../worker/agents/reader";

const inventory = { room: { w_tiles: 12, d_tiles: 9, confidence: "low" }, items: [{ kind: "rack", label: "R1", x_tiles: 2, y_tiles: 3, w_tiles: 1, d_tiles: 1.7, facing: "north", frames: [4] }] };

describe("parseAnswer", () => {
  it("accepts fenced JSON and fills defaults", () => {
    const r = parseAnswer("```json\n" + JSON.stringify(inventory) + "\n```", Inventory, "inventory");
    expect(r.observations).toEqual([]);
    expect(r.items[0].label).toBe("R1");
  });

  it("rejects prose, wrong kinds and impossible sizes", () => {
    expect(() => parseAnswer("I cannot help with that.", Inventory, "inventory")).toThrow(BadModelAnswer);
    expect(() => parseAnswer(JSON.stringify({ ...inventory, items: [{ ...inventory.items[0], kind: "server" }] }), Inventory, "inventory")).toThrow(BadModelAnswer);
    expect(() => parseAnswer(JSON.stringify({ ...inventory, room: { w_tiles: 1, d_tiles: 9, confidence: "low" } }), Inventory, "inventory")).toThrow(BadModelAnswer);
  });

  it("requires the request reader's source, route and destination", () => {
    const req = { transcript_ar: "...", translation_en: "...", source: "rack R3", route: "overhead ladder", destination: "TX rack 40", questions: [{ text: "Does R4 hold access devices?", answer_kind: "yes_no" }] };
    expect(parseAnswer(JSON.stringify(req), Request, "reader").questions).toHaveLength(1);
    const { destination: _, ...noDest } = req;
    expect(() => parseAnswer(JSON.stringify(noDest), Request, "reader")).toThrow(/destination/);
  });
});

describe("askJson", () => {
  it("retries once with the error, then gives up", async () => {
    const { askJson } = await import("../worker/agents/json");
    const { Request } = await import("../worker/agents/reader");
    const good = { transcript_ar: "x", translation_en: "x", source: "a", route: "b", destination: "c" };
    const replies = ['{"transcript_ar": "cut o', JSON.stringify(good)];
    const prompts: string[] = [];
    const models = { run: async (_r: string, p: { text: string }) => { prompts.push(p.text); return { text: replies.shift()!, model: "muse-spark-1.3", fellBack: false, raw: null }; } };
    expect((await askJson(models as never, "reader", { text: "read" }, Request, "clip")).destination).toBe("c");
    expect(prompts[1]).toContain("could not be used (clip: the answer was not JSON)");
    replies.push("nope", "still nope");
    await expect(askJson(models as never, "reader", { text: "read" }, Request, "clip")).rejects.toThrow(BadModelAnswer);
  });
});
