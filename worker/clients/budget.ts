// Daily caps: one atomic upsert per call attempt, so a refused call never reaches a paid API.
export class BudgetExceeded extends Error {
  constructor(readonly kind: "sam" | "model") {
    super("Processing budget reached");
  }
}

export async function takeBudget(db: D1Database, kind: "sam" | "model", cap: number, now = new Date()): Promise<void> {
  const row = await db
    .prepare(
      `INSERT INTO usage_counters (day, kind, count) VALUES (?1, ?2, 1)
       ON CONFLICT (day, kind) DO UPDATE SET count = count + 1 WHERE count < ?3
       RETURNING count`,
    )
    .bind(now.toISOString().slice(0, 10), kind, cap)
    .first();
  if (!row) throw new BudgetExceeded(kind);
}
