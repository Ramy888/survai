import { buildPlan, type PlanInput, type Shape } from "./plan";

const T = 40; // px per tile (600 mm)
const M = 30; // margin
const px = (n: number) => M + n * T;

function Rack({ s }: { s: Extract<Shape, { type: "rect" }> }) {
  const fill = s.hatched === "reserved" ? "url(#hatch-reserved)" : s.hatched === "off_limits" ? "url(#hatch-off)" : s.target ? "var(--primary-soft)" : "var(--surface)";
  const stroke = s.target || s.hatched === "reserved" ? "var(--primary)" : "var(--ink)";
  const cx = px(s.x + s.w / 2);
  const cy = px(s.y + s.d / 2);
  // A small triangle on the side the rack faces (its front).
  const front: Record<string, [number, number, number]> = {
    north: [cx, px(s.y) - 6, 180], south: [cx, px(s.y + s.d) + 6, 0], east: [px(s.x + s.w) + 6, cy, -90], west: [px(s.x) - 6, cy, 90],
  };
  const f = s.facing ? front[s.facing] : null;
  return (
    <g>
      <rect x={px(s.x)} y={px(s.y)} width={s.w * T} height={s.d * T} fill={fill} stroke={stroke} strokeWidth={s.target || s.hatched === "reserved" ? 2.5 : 1.5} />
      <text x={cx} y={cy + 5} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="15" fontWeight="600" fill={stroke} paintOrder="stroke" stroke="var(--surface)" strokeWidth="4">{s.label}</text>
      {f && <path d="M-4 -3 L4 -3 L0 4 Z" transform={`translate(${f[0]} ${f[1]}) rotate(${f[2]})`} fill="var(--muted)" />}
    </g>
  );
}

export function FloorPlan(props: PlanInput) {
  const plan = buildPlan(props);
  const W = plan.w * T + 2 * M;
  const H = plan.d * T + 2 * M + 30;
  return (
    <figure className="plan-fig">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Floor plan, ${plan.w} by ${plan.d} tiles`}>
        <defs>
          <pattern id="tile" width={T} height={T} patternUnits="userSpaceOnUse" x={M} y={M}><path d={`M${T} 0H0V${T}`} fill="none" stroke="var(--rule)" /></pattern>
          <pattern id="hatch-off" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line y2="6" stroke="var(--muted)" strokeWidth="1.2" /></pattern>
          <pattern id="hatch-reserved" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="7" height="7" fill="var(--primary-soft)" /><line y2="7" stroke="var(--primary)" strokeWidth="1.4" /></pattern>
          <marker id="cable-end" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--cable)" /></marker>
          <marker id="dim" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--ink)" /></marker>
        </defs>
        <rect x={M} y={M} width={plan.w * T} height={plan.d * T} fill="url(#tile)" />
        <rect x={M} y={M} width={plan.w * T} height={plan.d * T} fill="none" stroke="var(--ink)" strokeWidth="3" />
        {plan.shapes.map((s, k) => {
          if (s.type === "rect") return <Rack key={k} s={s} />;
          if (s.type === "ladder") {
            const horizontal = s.w >= s.d;
            return (
              <g key={k} stroke="var(--muted)" strokeDasharray="6 4" strokeWidth="1.4">
                {horizontal
                  ? <><line x1={px(s.x)} y1={px(s.y)} x2={px(s.x + s.w)} y2={px(s.y)} /><line x1={px(s.x)} y1={px(s.y) + 14} x2={px(s.x + s.w)} y2={px(s.y) + 14} /></>
                  : <><line x1={px(s.x)} y1={px(s.y)} x2={px(s.x)} y2={px(s.y + s.d)} /><line x1={px(s.x) + 14} y1={px(s.y)} x2={px(s.x) + 14} y2={px(s.y + s.d)} /></>}
              </g>
            );
          }
          if (s.type === "door") {
            const r = s.swing * T;
            const [x0, y0] = [px(s.x), px(s.y)];
            const arc = s.side === "north" ? `M${x0} ${y0} h${r} A${r} ${r} 0 0 0 ${x0} ${y0 - r}` : `M${x0} ${y0 + s.d * T} h${r} A${r} ${r} 0 0 1 ${x0} ${y0 + s.d * T + r}`;
            return (
              <g key={k}>
                <rect x={x0} y={y0} width={s.w * T} height={Math.max(4, s.d * T)} fill="var(--surface)" />
                <path d={arc} fill="none" stroke="var(--muted)" strokeWidth="1.2" />
                <text x={x0 + 4} y={y0 + s.d * T + r + 14} fontFamily="JetBrains Mono" fontSize="12" fill="var(--muted)">{s.label}</text>
              </g>
            );
          }
          if (s.type === "path") {
            const pts = s.points.map(([x, y]) => `${px(x)},${px(y)}`).join(" ");
            const [lx, ly] = s.points.at(-1) ?? [0, 0];
            return (
              <g key={k}>
                <polyline points={pts} fill="none" stroke="var(--cable)" strokeWidth="3" strokeDasharray={s.cable_type === "power" ? "8 5" : undefined} markerEnd="url(#cable-end)" />
                <text x={px(lx) + 6} y={px(ly) - 6} fontFamily="Barlow" fontWeight="600" fontSize="14" fill="var(--cable)" paintOrder="stroke" stroke="var(--surface)" strokeWidth="4">{s.label}</text>
              </g>
            );
          }
          const [fx, fy] = s.from;
          const [ax, ay] = s.at;
          return (
            <g key={k}>
              <line x1={px(fx)} y1={px(fy)} x2={px(ax)} y2={px(ay)} stroke="var(--ink)" strokeWidth="1" markerStart="url(#dim)" markerEnd="url(#dim)" />
              <text x={(px(fx) + px(ax)) / 2} y={(px(fy) + px(ay)) / 2 - 5} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="12" fill="var(--ink)" paintOrder="stroke" stroke="var(--surface)" strokeWidth="4">{s.label}</text>
            </g>
          );
        })}
        <g stroke="var(--muted)"><line x1={M} y1={H - 22} x2={M + plan.w * T} y2={H - 22} /><line x1={M} y1={H - 27} x2={M} y2={H - 17} /><line x1={M + plan.w * T} y1={H - 27} x2={M + plan.w * T} y2={H - 17} /></g>
        <text x={W / 2} y={H - 4} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="13" fill="var(--muted)">{(plan.w * 600).toLocaleString("en-US")} mm</text>
      </svg>
      <figcaption className="legend"><span><i className="lg-cable" />Cable path</span><span><i className="lg-power" />Power</span><span>▨ Off limits</span><span className="lg-reserved">▨ New rack</span><span>▾ Rack front</span><span>1 tile = 600 mm</span></figcaption>
    </figure>
  );
}
