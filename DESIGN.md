---
# gstack: design-md-format=spec
name: SurvAI
description: Light, ruled and exact, like an equipment-room survey form and its layout drawing; colour is reserved for verdicts and the cable path.
colors:
  ground: "#EEF1F1"
  surface: "#FFFFFF"
  text: "#14191C"
  text-muted: "#56636B"
  rule: "#D9E0E2"
  primary-soft: "#E2F0F1"
  primary: "#0B6770"
  primary-hover: "#08525A"
  on-primary: "#FFFFFF"
  cable: "#12A9B4"
  mark: "#FFD000"
  success: "#1C7A3E"
  success-bg: "#E3F2E7"
  error: "#B8261B"
  error-bg: "#FBE6E3"
  warning: "#9A5B00"
  warning-bg: "#FCEFD8"
  paper-rule: "#9AA6AC"
  dark-ground: "#101518"
  dark-surface: "#182025"
  dark-text: "#E7ECEE"
  dark-text-muted: "#9AA8B0"
  dark-rule: "#2B363C"
  dark-primary: "#3FB7C1"
  dark-on-primary: "#071518"
  dark-primary-soft: "#123238"
  dark-cable: "#3CCFD9"
  dark-success: "#5CC27E"
  dark-success-bg: "#16301F"
  dark-error: "#F07468"
  dark-error-bg: "#3A1A17"
  dark-warning: "#E7A94A"
  dark-warning-bg: "#33260F"
typography:
  display:
    fontFamily: Barlow Condensed
    fontWeight: 600
    fontSize: clamp(2.5rem, 7vw, 4.25rem)
    lineHeight: 1.05
    letterSpacing: -0.005em
  heading:
    fontFamily: Barlow Condensed
    fontWeight: 600
    fontSize: 1.3rem
    lineHeight: 1.2
  body:
    fontFamily: Barlow
    fontWeight: 400
    fontSize: 1rem
    lineHeight: 1.5
  label:
    fontFamily: Barlow Condensed
    fontWeight: 500
    fontSize: 0.875rem
    letterSpacing: 0.05em
  mono:
    fontFamily: JetBrains Mono
    fontWeight: 400
    fontFeature: tnum
rounded:
  xs: 4px
  sm: 6px
  md: 10px
  lg: 14px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    height: 48px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    borderColor: "{colors.rule}"
    rounded: "{rounded.md}"
  input:
    borderColor: "{colors.rule}"
    rounded: "{rounded.md}"
    height: 48px
  stepper-dot:
    size: 32px
    rounded: "{rounded.full}"
    doneBackground: "{colors.primary}"
    currentBorder: "{colors.primary}"
    currentRing: "{colors.primary-soft}"
    upcomingBorder: "{colors.rule}"
  action-bar:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.rule}"
  dept-tag:
    fontFamily: JetBrains Mono
    borderColor: "{colors.text}"
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xs}"
  verdict-approve:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success}"
    rounded: "{rounded.sm}"
  verdict-object:
    backgroundColor: "{colors.error-bg}"
    textColor: "{colors.error}"
    rounded: "{rounded.sm}"
  verdict-question:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
    rounded: "{rounded.sm}"
  panel:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.rule}"
    rounded: "{rounded.lg}"
---

# SurvAI

## Overview

**Creative North Star:** the survey form and the layout drawing, made live. Ruled cells, a real tile grid,
label-tape tags, and colour that only ever means approve, object, ask, or "the cable goes here".

**Product context:** SurvAI digitises the telecom equipment-room site survey. A field engineer uploads prepared
footage from a phone, corrects the room layout, and watches six department agents (Space, Power, Cooling,
Execution, Transmission, Room Manager) and a Survey Lead meet in rounds. The output is a printable survey report
and floor plan that mirror the company form. An office reviewer audits it later; judges see the replay (unlisted link, shared with them only).

**Mode per surface:**
- Capture, layout correction, meeting (phone): Operate.
- Report and floor plan (A4 print, laptop audit): Read.
- Replay `/replay/:slug` (unlisted, random slug): Read, with one Operate button ("Run the meeting again").

**Reference sites:** none; built from design knowledge and the real company form and layout (not reproduced).

**Key characteristics:**
- The first thing a viewer sees in a meeting is which agents approved, objected or asked.
- Every statement carries a rule id with its text and a link to the frame that proves it.
- The floor plan looks like an engineering drawing, to scale, not a diagram.
- The report reads as the form a telecom reviewer already signs.

**Memorable thing:** "Six departments surveyed this room, and every line points at its proof."

## Colors

**Strategy:** Restrained. Neutrals plus one action colour (fibre teal), with colour otherwise reserved for
meaning: green approve, red object, amber question, aqua cable path, yellow SAM marks on photos.

**Light or dark:** light by default. The engineer works in a brightly lit equipment room on a phone, and the
report is paper. Dark tokens exist for the reviewer's evening laptop and follow `prefers-color-scheme`, with a
manual toggle. The report sheet stays paper white in both themes.

- `primary` is for actions only (buttons, links, focus rings, the current-round bar). Never for decoration.
- Departments carry **no colour**. They are named by `dept-tag` (SPC, PWR, CLG, EXE, TRN, RMG, LEAD).
  Colour-coding six departments would compete with the verdict colours.
- A forced objection (a rule the calculator flagged: R3, R6, R8, R10, R11) uses `error` plus a lock icon and the
  label "Forced · R<n>", so it is never confused with a model objection.
- `mark` (#FFD000) is only for SAM outlines over video frames, where it stays visible on dark photos. Never on
  light surfaces.
- In dark mode, surfaces step up in lightness (`dark-ground` → `dark-surface`), and status backgrounds become deep
  tints so foreground colours keep at least 4.5:1 contrast.

## Typography

Barlow is a grotesk drawn from road and highway signs: plain, firm and readable at arm's length. That suits a
phone held in a server room. Barlow Condensed fits headings and rack names on a 360 px screen. JetBrains Mono
carries everything an engineer checks digit by digit: U positions, watts, BTU/h, breaker ratings, cable lengths,
rule ids, frame timestamps, survey ids. Always use tabular numbers.

- Load from Google Fonts in one request:
  `https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500;600&display=swap`
  (verified HTTP 200 on 2026-10-27; open licence).
- Scale: display clamp(2.5–4.25rem) / h2 clamp(1.75–2.25rem) / h3 1.3rem / body 1rem / small 0.875rem.
  Each level differs by size, not only weight.
- Labels are Barlow Condensed 500, uppercase, 0.05em tracking. Use them for form captions and table headers,
  never as a kicker above a heading.
- Body text never goes below 15px on a phone.

## Layout

**The app is a five-step flow** (owner, Oct 27): Survey → Upload → Layout → Meeting → Report. These map to the
spec's states (`draft` → `uploading`/`processing` → `layout_review` → `deliberating` → `approved`).
- **Top:** a sticky app bar (brand, mono survey id, 44 px theme button), with the stepper below it: five
  numbered dots joined by lines, a short label under each. Done = filled primary with a check (tappable to go
  back), current = primary outline with a soft ring, upcoming = rule outline. The current step has
  `aria-current="step"`.
- **Bottom:** a fixed action bar: Back (secondary) plus one primary button that names the step's outcome
  ("Continue to upload", "Process footage", "Layout is right, start meeting", "Send answer, start round 3",
  "Approve survey"). Keep one primary action per step.
- **Each step:** a short h1, one muted line saying what to do, then one to three panels. Simple: no step shows
  more than the work for that step.
- **Phone (base, 360–599 px):** one column with 16 px gutters; the floor plan panel uses 10 px padding so the
  drawing stays legible. Every tap target is at least 44 px (inputs and buttons 48 px).
- **Tablet (600–999 px):** one column, max 720 px; the floor plan goes full width above the meeting.
- **Laptop (≥960 px):** max width 1040 px. Survey, Upload and Report stay in a centred 640 px column; Layout
  and Meeting split into two columns (plan or statements left, racks or question right).
- **Report:** an A4 sheet (`@page { size: A4; margin: 14mm }`) built from bordered tables (`paper-rule`), in this
  order: header block, approved items, specs and rules, cable passage drawing, cable lengths, engineer's tech
  specs, sign-off table. Wide tables scroll horizontally on a phone, never the page.
- **Floor plan:** an SVG drawn to scale. One raised-floor tile = 600 × 600 mm is the grid unit; the grid is
  measurement, not decoration. Draw the walls 3 px in ink, racks as plan rectangles with mono ids, a triangle
  marking each rack front, a door swing arc, hatched off-limits racks, the overhead ladder as a dashed double
  line, and dimension lines in mm. The cable passage is a 3 px `cable` line from the rack top along the
  ladder to the exit, with an arrowhead and the label "cable passage → <destination>".

## Elevation & Depth

Flat by default. Panels use a 1 px `rule` border. The sticky app bar and the action bar use a border, not a
shadow. Only the selected segment of a segmented control gets a shadow. Shadow: `0 1px 2px rgba(20,25,28,.06), 0 4px 12px
rgba(20,25,28,.06)`. No glows, no blur panels.

## Shapes

Soft but not bubbly: 4 px tags, 6 px chips, 10 px buttons, inputs and the segmented control, 14 px panels,
round stepper dots. The report sheet stays at 6 px, like paper. Nested radius = outer − gap. No pill buttons.

## Components

- **dept-tag:** mono 12 px, 1 px ink border, surface background, 44 px minimum width, top-aligned in its row.
  The LEAD tag is inverted (ink background).
- **verdict:** uppercase body-font label on a tint (approve / object / question). Forced objections add the lock
  icon. Never colour the whole row.
- **agent statement (chat turn):** tag as avatar | name, verdict chip and model chip | the statement in a neutral
  bubble (4 lines, "Show all") | evidence links (mono, underlined, primary) and the rule id with its text in muted
  small type below the bubble. The Survey Lead's bubble uses `primary-soft`.
- **question block:** amber tint across the full width, the asking department in the label, the answer input, and
  a primary button that names the outcome ("Send answer, start round 3").
- **round bar:** one segment per round; done = ink, current = primary, pending = rule.
- **buttons:** primary, secondary and ghost. Hover darkens; `:focus-visible` shows a 2 px primary outline at
  2 px offset; disabled is 45% opacity with a `not-allowed` cursor. Button labels name the result ("Approve
  survey", "Run the meeting again"), never "Submit" or "Get started".
- **states:** every list has empty, loading (agents "thinking" shown as a muted line per pending department, not
  a spinner wall), error (an `error` note with the retry action inline) and long-content (truncate statements
  at 4 lines with "Show all").

## Do's and Don'ts

- Do: put a rule id with its text and an evidence link next to every agent claim.
- Do: draw the plan on the 600 mm tile grid and label dimensions in mm.
- Do: keep all numbers in JetBrains Mono with tabular figures.
- Do: give every step exactly one primary action, in the bottom bar, in thumb reach.
- Do: test every step at 360 and 390 px (light and dark) with mobile emulation; no horizontal scroll.
- Do: keep the report printable to A4 with the same content as the audit view.
- Don't: colour-code departments, or use a coloured left border on statements.
- Don't: nest cards. The meeting is a chat log in one panel (see the 2026-10-29 decision); no department colours on bubbles.
- Don't: use gradients, glows, blobs, emoji or icon tiles above headings.
- Don't: show placeholder grey boxes where evidence frames belong; show the frame or the timestamp link.
- Don't: use `mark` yellow anywhere except over photos.

## Motion

- **Approach:** minimal-functional.
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out).
- **Duration:** micro(50-100ms) short(150-250ms) medium(250-400ms) long(400-700ms).
- Step change: the new step fades up 4 px (200 ms ease-out); the stepper dot fills (200 ms).
- **The one authored moment:** when the survey is approved, the cable passage draws itself along its route on
  the floor plan (stroke-dashoffset, 600 ms, ease-in-out), then each department's sign-off cell fills in order
  (80 ms apart). Respect `prefers-reduced-motion`: show the final state at once.
- New agent statements fade in (150 ms) as each department returns. No bounce, no overshoot.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-27 | Initial design system created | /design-consultation from spec v3 and design knowledge; options auto-accepted by the owner ("accept everything recommended"); preview in `docs/design-preview.html` |
| 2026-10-27 | Colour means a verdict; departments get mono tags, not colours | Six department colours would compete with approve/object/question, which is what a reviewer scans for |
| 2026-10-27 | Floor plan drawn to scale on the 600 mm tile grid | Engineers read Visio-style layouts; the SAM tile count already gives the grid |
| 2026-10-27 | Report rendered as a ruled form, paper white in both themes | Mirrors the company survey form the reviewer signs; prints to A4 |
| 2026-10-27 | Five-step flow with a top stepper and bottom action bar; softer radii | The owner asked for steps with a top indicator, simple and modern; tested at 360/390 px |
| 2026-10-27 | Light by default | Phone in a lit equipment room; report is paper |
| 2026-10-29 | Meeting statements as a chat log: tag as avatar, name + verdict + model above a neutral bubble, evidence and rules below; one scroll box per round sized for about one review, scroll snaps to each turn; typing bubbles while agents work | The owner asked for a chat list that keeps the page short; same component in the judges' replay |
| 2026-10-29 | Stepper steps already reached are buttons; earlier steps open with their saved data (Survey and Upload read-only once locked, Layout editable); opened steps stay mounted so unsaved inputs survive switching | The owner asked to move between steps without losing work |
| 2026-10-29 | Upload takes the walk-through video: frames picked in the browser; optional blur (Meta SAM 3.1 finds labels, the engineer reviews a grid of blurred frames, drags to add or taps × to remove a box) before upload; prepared frames stay an option | The owner asked that the engineer only films and uploads, with privacy optional but the full story shown |
