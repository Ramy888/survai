// Departments, the rulebook (text printed next to every rule ID) and who owns which rule.
export const AGENTS = ["space", "power", "cooling", "execution", "transmission", "room_manager"] as const;
export type Agent = (typeof AGENTS)[number];

export const RULES: Record<string, { owner: Agent; text: string }> = {
  R1: { owner: "room_manager", text: "No leftover materials in the room" },
  R2: { owner: "room_manager", text: "No untidy cables" },
  R3: { owner: "power", text: "Power cables never share a path with data or fibre; never stretched" },
  R4: { owner: "space", text: "A new rack is aligned with the existing racks" },
  R5: { owner: "space", text: "A new rack faces the same way as the other racks" },
  R6: { owner: "room_manager", text: "The room door is never blocked" },
  R7: { owner: "room_manager", text: "Off-limits racks (customer / access-device) are not used; ask when unsure" },
  R8: { owner: "execution", text: "Leave 2U above an installed active device" },
  R9: { owner: "execution", text: "New cables leave from the top of the rack" },
  R10: { owner: "cooling", text: "Added heat load stays within spare A/C capacity" },
  R11: { owner: "power", text: "Every required feed has a free breaker of the required type and rating" },
  R12: { owner: "transmission", text: "The interconnect ladder has spare capacity" },
};

const byNumber = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1));
export const OWNED_RULES = Object.fromEntries(
  AGENTS.map((a) => [a, Object.keys(RULES).filter((r) => RULES[r].owner === a).sort(byNumber)]),
) as Record<Agent, string[]>;

export const DEPARTMENT: Record<Agent, string> = {
  space: "Space (installations): free rack units, empty floor positions, aisle clearance, rack alignment and facing",
  power: "Power (electricity): breakers, feeds, the power cable route",
  cooling: "Cooling (A/C): heat load against spare capacity, A/C positions, airflow",
  execution: "Execution (installation team): device fit, materials, patch cords, ladder and duct metres, cable exit",
  transmission: "Transmission: the interconnect path to the other room and ladder capacity",
  room_manager: "Room Manager (site manager): housekeeping, the door, off-limits racks",
};

/** The question an agent must ask when one of its calculations is missing an input. */
export const MISSING_QUESTIONS: Record<string, { text: string; answer_kind: "yes_no" | "number" | "text"; target_fact: string }> = {
  spare_ac_btu: { text: "What is the spare A/C capacity in BTU/h?", answer_kind: "number", target_fact: "spare_ac_btu" },
  breakers_confirmed: { text: "Which breakers on the panel are free, and what are their type and rating?", answer_kind: "text", target_fact: "breakers_confirmed" },
  target_rack: { text: "Which rack is the target for the new device, or should it go in a new rack?", answer_kind: "text", target_fact: "target_rack" },
  ladder_height_m: { text: "How high is the overhead ladder above the floor, in metres?", answer_kind: "number", target_fact: "ladder_height_m" },
};
