// The values the department agents start from, each with its source (DESIGN.md: show which model did what).
import type { ReactElement } from "react";
import type { FeedRow, FeedSource } from "../steps/feeds";
import { ModelChip } from "./Footage";

const SOURCE: Record<FeedSource, () => ReactElement | null> = {
  sam: () => <ModelChip model="sam-3.1" what="from the frames" />,
  frames: () => <ModelChip model="muse-spark-open" what="from the frames" />,
  narration: () => <ModelChip model="muse-spark-1.3" what="from the narration" />,
  datasheet: () => <ModelChip model="muse-spark-1.3" what="from the datasheet" />,
  panel: () => <ModelChip model="muse-spark-1.3" what="from the panel photos" />,
  engineer: () => <span className="chip neutral">edited by the engineer</span>,
  assumed: () => <span className="chip q">assumed · confirm</span>,
  missing: () => <span className="chip no">needs the engineer</span>,
};

export function Feeds({ rows, title = "What feeds the meeting", foot }: { rows: FeedRow[]; title?: string; foot?: string }) {
  return (
    <section className="panel feeds full" aria-labelledby="feeds-h">
      <h2 id="feeds-h">{title}</h2>
      <ul>
        {rows.map((r) => (
          <li key={r.key} data-feed={r.key}>
            <span className="feed-label">{r.label}</span>
            <span className="feed-value">{r.value}{r.note && <span className="muted small"> · {r.note}</span>}</span>
            <span className="feed-src">{SOURCE[r.source]()}</span>
          </li>
        ))}
      </ul>
      {foot && <p className="muted small">{foot}</p>}
    </section>
  );
}
