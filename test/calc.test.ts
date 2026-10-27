// protects: the calculated rules (heat load, R3, R6, R8, R10, R11), cable lengths and clearance arrows that force
// objections the models cannot overrule; fails_when: a formula, unit, rounding, merge or tolerance changes, or an
// unknown input is treated as a pass; no_claim: whether the engineer's layout is drawn correctly.
// Expected values are hand calculations (1 tile = 0.6 m, 1U = 44.45 mm, 1 W = 3.412 BTU/h).
import { describe, expect, it } from "vitest";
import {
  type Breaker, cableLength, clearances, contiguousFree, heatLoad, r3PowerSeparation, r6DoorSwing, r8FreeU, r10Cooling, r11Breakers,
} from "../worker/calc";

describe("heat load and R10", () => {
  it("is W x 3.412 x quantity", () => {
    expect(heatLoad(800, 1)).toBe(2729.6);
    expect(heatLoad(800, 3)).toBe(8188.8);
  });
  it("passes within spare capacity, fails over it, and is unknown without it", () => {
    expect(r10Cooling({ power_w: 800, quantity: 1, spare_ac_btu: 4800 })).toMatchObject({ rule: "R10", pass: true, result: { heat_btu: 2729.6 } });
    expect(r10Cooling({ power_w: 800, quantity: 1, spare_ac_btu: 2000 })).toMatchObject({ pass: false, result: { over_btu: 729.6 } });
    expect(r10Cooling({ power_w: 800, quantity: 1, spare_ac_btu: null })).toMatchObject({ pass: null, result: { missing: ["spare_ac_btu"] } });
  });
});

describe("R8 free rack space", () => {
  it("merges touching free blocks and finds the largest", () => {
    expect(contiguousFree([{ from_u: 18, to_u: 20 }, { from_u: 21, to_u: 24 }, { from_u: 30, to_u: 31 }])).toEqual({ from_u: 18, to_u: 24, units: 7 });
    expect(contiguousFree([])).toBeNull();
  });
  it("needs ceil(device U) x quantity + 2U in one block", () => {
    const rack = { label: "R3", free_blocks: [{ from_u: 18, to_u: 24 }] };
    expect(r8FreeU({ height_u: 3.5, quantity: 1, rack })).toMatchObject({ rule: "R8", pass: true, result: { needed_u: 6, block: { units: 7 } } });
    expect(r8FreeU({ height_u: 3.5, quantity: 2, rack })).toMatchObject({ pass: false, result: { needed_u: 10 } });
    expect(r8FreeU({ height_u: 3.5, quantity: 1, rack: { label: "R3", free_blocks: [{ from_u: 18, to_u: 22 }] } })).toMatchObject({ pass: false });
  });
  it("is unknown when no target rack is chosen", () => {
    expect(r8FreeU({ height_u: 3.5, quantity: 1, rack: null })).toMatchObject({ pass: null, result: { missing: ["target_rack"] } });
  });
});

describe("R11 breakers", () => {
  const breakers: Breaker[] = [
    { position: 1, dc: true, rating_a: 16, free: true },
    { position: 2, dc: true, rating_a: 10, free: true },
    { position: 3, dc: false, rating_a: 16, free: true },
    { position: 4, dc: true, rating_a: 16, free: false },
  ];
  it("counts free breakers of the device's type at or above its rating", () => {
    expect(r11Breakers({ feed_type: "DC", feed_count: 2, quantity: 1, breaker_rating_a: 16, breakers })).toMatchObject({ rule: "R11", pass: false, result: { needed: 2, matching: 1 } });
    expect(r11Breakers({ feed_type: "DC", feed_count: 2, quantity: 1, breaker_rating_a: null, breakers })).toMatchObject({ pass: true, result: { matching: 2 } });
    expect(r11Breakers({ feed_type: "AC", feed_count: 1, quantity: 1, breaker_rating_a: 16, breakers })).toMatchObject({ pass: true, result: { matching: 1 } });
  });
  it("is unknown until the engineer confirms the breakers", () => {
    expect(r11Breakers({ feed_type: "DC", feed_count: 2, quantity: 1, breaker_rating_a: 16, breakers: null })).toMatchObject({ pass: null, result: { missing: ["breakers_confirmed"] } });
  });
});

describe("cable length", () => {
  const points: [number, number][] = [[3, 2], [3, 0.5], [9, 0.5]]; // 1.5 + 6 = 7.5 tiles = 4.5 m
  it("adds the drops at both ends and 10% slack, rounded up to whole metres", () => {
    // overhead: (2.6 - 2.0) x 2 = 1.2 m -> 5.7 m x 1.1 = 6.27 -> 7 m
    expect(cableLength({ points, route: "overhead", ladder_height_m: 2.6, rack_top_m: 2.0 })).toMatchObject({ length_m: 7, run_m: 4.5, drops_m: 1.2 });
    // leaving the room adds the inter-room distance: (5.7 + 10) x 1.1 = 17.27 -> 18 m
    expect(cableLength({ points, route: "overhead", ladder_height_m: 2.6, rack_top_m: 2.0, inter_room_m: 10 }).length_m).toBe(18);
    // underfloor: 0.5 m drop at each end: (4.5 + 1.0) x 1.1 = 6.05 -> 7 m
    expect(cableLength({ points, route: "underfloor" }).length_m).toBe(7);
  });
  it("cannot be computed without the ladder height", () => {
    expect(cableLength({ points, route: "overhead", ladder_height_m: null, rack_top_m: 2.0 })).toMatchObject({ length_m: null, missing: ["ladder_height_m"] });
  });
});

describe("R6 door swing", () => {
  const door = { label: "D1", x: 1.5, y: 0, w: 1.5, d: 0.2, swing_m: 0.9, side: "south" as const }; // zone x 1.5-3, y 0.2-1.7
  it("fails when an item sits inside the swing zone", () => {
    const r = r6DoorSwing({ door, items: [{ label: "R1", kind: "rack", x: 2, y: 1, w: 1, d: 1.7 }] });
    expect(r).toMatchObject({ rule: "R6", pass: false, result: { blocking: ["R1"] } });
  });
  it("passes when items are clear, and ignores overhead ladders", () => {
    const r = r6DoorSwing({ door, items: [{ label: "R1", kind: "rack", x: 4, y: 1, w: 1, d: 1.7 }, { label: "L1", kind: "ladder", x: 1, y: 0.5, w: 8, d: 0.5 }] });
    expect(r).toMatchObject({ pass: true, result: { blocking: [] } });
  });
});

describe("R3 power and data separation", () => {
  const power = { label: "PWR", cable_type: "power" as const, route: "overhead" as const, points: [[0, 1], [5, 1]] as [number, number][] };
  it("fails when power runs alongside fibre on the same route", () => {
    const fibre = { label: "FIB", cable_type: "fibre" as const, route: "overhead" as const, points: [[2, 1.1], [8, 1.1]] as [number, number][] };
    expect(r3PowerSeparation([power, fibre])).toMatchObject({ rule: "R3", pass: false, result: { shared: [{ power: "PWR", other: "FIB", overlap_m: 1.8 }] } });
  });
  it("passes on different routes and when paths only cross", () => {
    const under = { label: "FIB", cable_type: "fibre" as const, route: "underfloor" as const, points: [[2, 1.1], [8, 1.1]] as [number, number][] };
    const crossing = { label: "DAT", cable_type: "data" as const, route: "overhead" as const, points: [[3, 0], [3, 5]] as [number, number][] };
    // Leaves diagonally from right beside the power run: close at one end, but not running alongside.
    const diagonal = { label: "DIA", cable_type: "data" as const, route: "overhead" as const, points: [[2, 1.05], [6, 4]] as [number, number][] };
    expect(r3PowerSeparation([power, under, crossing, diagonal])).toMatchObject({ pass: true, result: { shared: [] } });
  });
});

describe("clearance arrows", () => {
  it("measures the reserved area to the nearest rack, wall and door, edge to edge", () => {
    const reserved = { label: "NEW", x: 4, y: 4, w: 1, d: 1.7 };
    const arrows = clearances({
      reserved,
      room: { w: 9, d: 12 },
      racks: [{ label: "R2", x: 6, y: 4, w: 1, d: 1.7 }, { label: "R5", x: 0.5, y: 8, w: 1, d: 1.7 }],
      door: { label: "D1", x: 1.5, y: 0, w: 1.5, d: 0.2 },
    });
    expect(arrows).toEqual([
      { to: "rack R2", m: 0.6, from: [5, 4.85], at: [6, 4.85] },
      { to: "wall", m: 2.4, from: [4, 4.85], at: [0, 4.85] },
      { to: "door D1", m: 2.36, from: [4, 4], at: [3, 0.2] },
    ]);
  });
});

describe("door swing side", () => {
  it("opens away from the wall the door sits on", async () => {
    const { swingSide } = await import("../worker/meeting");
    const size = { w: 9, d: 12 };
    expect(swingSide({ label: "D", x: 1.5, y: 0, w: 1.5, d: 0.2 }, size)).toBe("south");
    expect(swingSide({ label: "D", x: 3, y: 11.8, w: 1.5, d: 0.2 }, size)).toBe("north");
    expect(swingSide({ label: "D", x: 0, y: 5, w: 0.2, d: 1.5 }, size)).toBe("east");
    expect(swingSide({ label: "D", x: 8.8, y: 5, w: 0.2, d: 1.5 }, size)).toBe("west");
    expect(swingSide({ label: "D", x: 4, y: 4, w: 1, d: 0.2 }, null)).toBe("south");
  });
});

describe("cable length leaving the room", () => {
  it("is unknown, not 0 m, when the distance to the other room is unknown", async () => {
    const { computeCalcs } = await import("../worker/meeting");
    const path = (leaves_room: boolean) => ({ id: "p", kind: "cable_path", label: "fibre-1", x: 1, y: 1, w: null, d: null, facing: null,
      props: { cable_type: "fibre", route: "overhead", points: [[1, 1], [4, 1]], leaves_room } });
    const input = (leaves: boolean, inter: number | null) => ({
      round: 1, quantity: 1, device: { model: "M", height_u: 1, power_w: 100, feed_type: "DC" as const, feed_count: 1, breaker_rating_a: null }, request: null,
      rooms: [{ role: "devices_hall", size_tiles: null, facts: { ladder_height_m: 2.6, inter_room_m: inter }, observations: [], items: [path(leaves)] }],
      frames: [], calcs: [], previous: [], lead: null, answers: [],
    });
    const len = (leaves: boolean, inter: number | null) => computeCalcs(input(leaves, inter)).find((c) => c.rule === "LEN")!;
    expect(len(true, null)).toMatchObject({ pass: null, result: { missing: ["inter_room_m"] } });
    expect(len(true, 10).result).toMatchObject({ length_m: 15 }); // (1.8 + 1.2 + 10) x 1.1 = 14.3 -> 15
    expect(len(false, null).result).toMatchObject({ length_m: 4 }); // (1.8 + 1.2) x 1.1 = 3.3 -> 4
  });
});
