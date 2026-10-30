import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { buildPlan, dragTo, type PlanInput, type Shape } from "./plan";

const T = 40; // px per tile (600 mm)
const M = 30; // margin
const px = (n: number) => M + n * T;

function Rack({ s, labelOnly = false }: { s: Extract<Shape, { type: "rect" }>; labelOnly?: boolean }) {
  const fill = s.hatched === "reserved" ? "url(#hatch-reserved)" : s.hatched === "off_limits" ? "url(#hatch-off)" : s.hatched === "spot" ? "none" : s.target ? "var(--primary-soft)" : "var(--surface)";
  const stroke = s.target || s.hatched === "reserved" || s.hatched === "spot" ? "var(--primary)" : "var(--ink)";
  const cx = px(s.x + s.w / 2);
  const cy = px(s.y + s.d / 2);
  // A small triangle on the side the rack faces (its front).
  const front: Record<string, [number, number, number]> = {
    north: [cx, px(s.y) - 6, 180], south: [cx, px(s.y + s.d) + 6, 0], east: [px(s.x + s.w) + 6, cy, -90], west: [px(s.x) - 6, cy, 90],
  };
  const f = s.facing ? front[s.facing] : null;
  const thin = s.d * T < 20 || s.w * T < 20; // a wall panel: its label goes beside it, into the room, not across the wall
  const label = <text pointerEvents="none" x={cx} y={thin ? (s.y < 1 ? px(s.y + s.d) + 17 : px(s.y) - 7) : cy + 5} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="15" fontWeight="600" fill={stroke} paintOrder="stroke" stroke="var(--surface)" strokeWidth="4">{s.label}</text>;
  if (labelOnly) return label;
  return (
    <g>
      <rect x={px(s.x)} y={px(s.y)} width={s.w * T} height={s.d * T} fill={fill} stroke={stroke} strokeWidth={s.target || s.hatched === "reserved" ? 2.5 : 1.5}
        strokeDasharray={s.hatched === "spot" ? "6 4" : undefined} />
      {f && <path d="M-4 -3 L4 -3 L0 4 Z" transform={`translate(${f[0]} ${f[1]}) rotate(${f[2]})`} fill="var(--muted)" />}
    </g>
  );
}

type Movable = Extract<Shape, { type: "rect" | "door" | "ladder" }>;
const STEP: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** The plan; with onMove, the engineer's items can be dragged (or moved with the arrow keys) into place. */
export function FloorPlan({ onMove, onTurn, ...props }: PlanInput & { onMove?: (id: string, x: number, y: number) => void; onTurn?: (id: string) => void }) {
  const plan = buildPlan(props);
  const W = plan.w * T + 2 * M;
  const H = plan.d * T + 2 * M + 30;
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ s: Movable; x: number; y: number } | null>(null);
  // A finger on an item drags it instead of scrolling the page. Browsers ignore touch-action on SVG shapes, and
  // React's touch listeners are passive, so this one is added by hand.
  useEffect(() => {
    const el = svg.current;
    if (!el || !onMove) return;
    const hold = (e: TouchEvent) => { if ((e.target as Element).closest(".movable")) e.preventDefault(); };
    el.addEventListener("touchstart", hold, { passive: false });
    return () => el.removeEventListener("touchstart", hold);
  }, [!onMove]);
  const at = (e: PointerEvent) => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
  const move = (s: Movable, dx: number, dy: number) => { const p = dragTo(s, { dx, dy }, s, plan); onMove!(s.id, p.x, p.y); };
  const handle = (s: Movable) => !onMove || s.fixed ? {} : {
    className: "movable", tabIndex: 0, role: "button", "aria-label": `Move ${s.label}: drag it, or use the arrow keys${onTurn ? "; R turns it" : ""}`,
    onPointerDown: (e: PointerEvent<SVGGElement>) => { const p = at(e); drag.current = { s, x: p.x, y: p.y }; e.currentTarget.setPointerCapture(e.pointerId); },
    onPointerMove: (e: PointerEvent) => { const d = drag.current; if (!d) return; const p = at(e); move(d.s, (p.x - d.x) / T, (p.y - d.y) / T); },
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
    onKeyDown: (e: KeyboardEvent) => {
      if ((e.key === "r" || e.key === "R") && onTurn) { e.preventDefault(); onTurn(s.id); return; }
      const k = STEP[e.key]; if (!k) return; e.preventDefault(); const n = e.shiftKey ? 0.1 : 0.5; move(s, k[0] * n, k[1] * n);
    },
  };
  return (
    <figure className="plan-fig">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Floor plan, ${plan.w} by ${plan.d} tiles`}>
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
          if (s.type === "rect") return <g key={k} {...handle(s)}><Rack s={s} /></g>;
          if (s.type === "ladder") {
            const horizontal = s.w >= s.d;
            return (
              <g key={k} stroke="var(--muted)" strokeDasharray="6 4" strokeWidth="1.4" {...handle(s)}>
                <rect x={px(s.x)} y={px(s.y)} width={Math.max(14, s.w * T)} height={Math.max(14, s.d * T)} fill="transparent" stroke="none" />
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
              <g key={k} {...handle(s)}>
                <rect x={x0} y={y0} width={s.w * T} height={Math.max(4, s.d * T)} fill="var(--surface)" />
                <path d={arc} fill="none" stroke="var(--muted)" strokeWidth="1.2" />
                <text x={x0 + 4} y={y0 + s.d * T + r + 14} fontFamily="JetBrains Mono" fontSize="12" fill="var(--muted)">{s.label}</text>
              </g>
            );
          }
          if (s.type === "path") {
            const pts = s.points.map(([x, y]) => `${px(x)},${px(y)}`).join(" ");
            // Label beside a segment's middle, never at the ends (they sit on racks and panels): the longest segment
            // first, on the first side where the text covers no rack, column or wall.
            const tw = s.label.length * 7.5;
            const clear = (x0: number, y: number) => x0 > M && x0 + tw < M + plan.w * T && !plan.shapes.some((r) => r.type === "rect"
              && x0 < px(r.x + r.w) && x0 + tw > px(r.x) && y - 14 < px(r.y + r.d) && y > px(r.y));
            const spots = s.points.slice(1).map((b, j) => [s.points[j], b] as const)
              .sort((g, h) => Math.hypot(h[1][0] - h[0][0], h[1][1] - h[0][1]) - Math.hypot(g[1][0] - g[0][0], g[1][1] - g[0][1]))
              .flatMap(([a, b]) => { const [mx, y] = [px((a[0] + b[0]) / 2), px((a[1] + b[1]) / 2) - 6]; return [{ x: mx + 8, y, end: false }, { x: mx - 8, y, end: true }]; });
            const spot = spots.find((p) => clear(p.end ? p.x - tw : p.x, p.y)) ?? spots[0] ?? { x: 0, y: 0, end: false };
            return (
              <g key={k}>
                <polyline points={pts} fill="none" stroke="var(--cable)" strokeWidth="3" strokeDasharray={s.cable_type === "power" ? "8 5" : undefined} markerEnd="url(#cable-end)" />
                <text x={spot.x} y={spot.y} textAnchor={spot.end ? "end" : "start"} fontFamily="Barlow" fontWeight="600" fontSize="14" fill="var(--cable)" paintOrder="stroke" stroke="var(--surface)" strokeWidth="4">{s.label}</text>
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
        {/* Rack ids go on top: a cable arrow ends inside its rack and would cover the id. */}
        {plan.shapes.map((s, k) => s.type === "rect" && <Rack key={`l${k}`} s={s} labelOnly />)}
        <g stroke="var(--muted)"><line x1={M} y1={H - 22} x2={M + plan.w * T} y2={H - 22} /><line x1={M} y1={H - 27} x2={M} y2={H - 17} /><line x1={M + plan.w * T} y1={H - 27} x2={M + plan.w * T} y2={H - 17} /></g>
        <text x={W / 2} y={H - 4} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="13" fill="var(--muted)">{(plan.w * 600).toLocaleString("en-US")} mm</text>
      </svg>
      <figcaption className="legend"><span><i className="lg-cable" />Cable path</span><span><i className="lg-power" />Power</span><span>▨ Off limits</span><span className="lg-reserved">▨ New rack</span><span className="lg-reserved">⬚ Free spot, 80 × 80 cm</span><span>▾ Rack front</span><span>1 tile = 600 mm</span></figcaption>
    </figure>
  );
}
