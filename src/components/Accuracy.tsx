// Measured accuracy on the sample room (docs/eval/accuracy.md), so a reader sees numbers, not claims.
const ROWS: [what: string, result: string, how: string][] = [
  ["Datasheet lookup · Meta Muse Spark 1.3", "8 of 8 fields match Juniper's MX104 hardware guide", "Compared with the official guide"],
  ["Rack detection · Meta SAM 3.1", "43 of 44 boxes on a rack (98%); racks found in 21 of 28 frames (75%)", "Every box and frame checked by eye"],
  ["Taped sheets to blur · Meta SAM 3.1", "9 of 9 found, 0 wrong boxes", "\"label\" alone found 0 of 9, so the app now also asks for paper and sticker"],
  ["Devices in the racks · Meta SAM 3.1", "Routers found in 6 of 15 frames; free-U estimate U7-U21 vs U1-U20 on site", "Weakest number here: the estimate is for the engineer to confirm"],
  ["Meeting repeatability · Muse Spark Open agents, Muse Wonder Lead", "Same rack in 5 of 5 runs; verdicts agree 23 of 25", "Round 1 run five times on a local test survey of this room (not this sample)"],
  ["Rules", "5 of the 12 rules calculated in code; a model cannot overturn a failed one", "263 automated tests"],
];

export function Accuracy() {
  return (
    <section className="panel accuracy" aria-labelledby="acc-h">
      <h2 id="acc-h">Measured on this room's footage</h2>
      <table>
        <thead><tr><th>What</th><th>Result</th><th>How</th></tr></thead>
        <tbody>{ROWS.map(([what, result, how]) => <tr key={what}><td>{what}</td><td><b>{result}</b></td><td className="muted">{how}</td></tr>)}</tbody>
      </table>
    </section>
  );
}
