# SurvAI

Telecom equipment-room site surveys, from anonymised footage to a signed report. Meta SAM 3.1 outlines racks and
floor tiles, Muse Spark drafts the room and reads the engineer's narration, one Muse Spark agent per department
reviews the plan over up to three rounds, and Muse Wonder leads as Survey Lead. The engineer approves.

**Demo video (2:59):** https://youtu.be/e7pMw10oSwg. The narration is synthetic: a clone of the builder's own voice
(Cartesia). All footage in it is blurred.

## The problem

Before a new router or rack goes into a telecom equipment room, a field engineer brings one representative from
each department to the room: space, power, cooling, installation, the site manager, and transmission when the
device connects to another room. They agree on where the device goes, how it is powered and cooled, and how its
cables run. The result is a hand-written survey form and a hand-drawn floor plan. Getting everyone to the site,
reconciling what each one said and redrawing the plan takes days per request.

SurvAI does that meeting with one AI agent per department. The engineer films the room once; the agents review the
evidence, meet in rounds, object when a rule is broken, ask the engineer what the footage can't show, and agree on a
placement. The engineer approves, and the real representatives sign off from a link on their phone.

## How it works

1. **Survey.** The engineer names the site, the device (for example a Juniper MX104) and the departments that must
   agree. Muse Spark 1.3 looks up the device's datasheet on the web and cites it: height, depth, power, feeds,
   breaker rating, airflow.
2. **Upload.** 30 key frames of the room, a narrated clip walking the cable route, and photos of the power panel.
   Everything is blurred on the engineer's computer first (`tools/prepare`): no faces, labels or logos leave it.
3. **Processing** (a Cloudflare Workflow, about a minute):
   - SAM 3.1 outlines every rack and floor tile in every frame. The tile grid gives the room size; the outlines are
     kept as evidence the engineer can see.
   - Muse Spark drafts the room: racks, door, A/C, ladder, columns, wall panels, each linked to the frames it was
     seen in.
   - Muse Spark 1.3 turns the Egyptian Arabic narration into the request (what goes where, the route, the
     destination) and the questions it leaves open, and reads the breakers on the panel photo.
4. **Layout.** The engineer corrects the drafted plan on a 600 mm tile grid and fills in what the footage can't
   show: free breakers, spare cooling, ladder height, the target rack.
5. **Meeting.** Up to 3 rounds. Each department agent sees the room facts, the rules it owns, the calculations, and
   every other agent's statement from the round before. The Survey Lead resolves conflicts, proposes the reserved
   area and cable paths, and decides whether another round is needed. Agents ask the engineer questions; the
   answers change the facts for the next round.
6. **Approve and report.** Approving over an objection needs a written reason. The report mirrors a real company
   survey form: approved items, every statement with its rule and evidence, the floor plan to scale with cable
   lengths, overrides and reasons. It prints to A4. Each department gets its own sign-off link, shown once.

## Meta models

| Task | Model | Notes |
|---|---|---|
| Racks and floor tiles in every key frame | **SAM 3.1** (Meta Model API) | Image mode on the sharpest frames; video mode stopped tracking after 16 instances on a long walk-through |
| Department agents: Space, Power, Cooling, Execution, Room Manager, Transmission | **Muse Spark Open** (open weights, on Baseten) | Fall back to Muse Spark 1.3 if Baseten fails |
| Room inventory from the frames | **Muse Spark Open** | Same fallback |
| Survey Lead | **Muse Wonder 1.0** | 20 s limit, falls back to Muse Spark 1.3; the app shows which model answered |
| Request from the narrated clip (video and audio, Egyptian Arabic) | **Muse Spark 1.3** | Video goes to Meta-hosted models only |
| Breakers on the panel photo | **Muse Spark 1.3** | Spark Open refused panel photos in day-1 tests |
| Device datasheet, with citations | **Muse Spark 1.3** + web search | Cached per device model (one lookup cost about $0.45) |

Every statement in the meeting and every step on the processing screen carries a tag naming the model that wrote
it. Day-1 model tests are in `docs/day1.md`.

## Rules the agents enforce

Twelve room rules, each owned by one department; only a rule's owner may object with it. Five are calculated in
code before any model runs (`worker/calc`), and a failing calculation forces that agent's objection: the model
writes the statement but cannot downgrade the verdict.

| Calculated rule | Check |
|---|---|
| R3 Power and data never share a path | Overlapping power and data/fibre segments on the same route |
| R6 The door is never blocked | Nothing inside the door swing |
| R8 Leave 2U above an active device | One free block of device U × quantity + 2U in the target rack |
| R10 Heat stays within spare cooling | W × 3.412 × quantity ≤ spare BTU/h; unknown becomes a question |
| R11 Every feed has a free breaker | Feeds × quantity against confirmed free breakers of the right type and rating |

The rest (leftover materials, untidy cables, rack alignment and facing, off-limits customer racks, cables leaving
from the top, ladder capacity) are judged by the agents from the frames, with the frames cited.

## Privacy and limits

- Footage is blurred locally before upload, and only blurred files reach any model.
- Creating surveys and uploading need a passcode: 5 wrong tries per IP per 10 minutes, compared in constant time.
- Daily caps on SAM and model calls are taken atomically before each call, so a refused call never reaches a paid
  API. A public "run the meeting again" is limited to one per visitor per 10 minutes and 60 a day, from its own
  allowance.
- Model output is rendered as text only; a guard in `npm test` fails the build on raw HTML rendering.
- No secrets in the repo: keys live in Worker secrets and a gitignored env file.

## Live run (Oct 27, 2026, deployed app)

One survey from upload to signed report on the deployed app, for one Juniper MX104 router. The footage came from a
real equipment room. Before upload, it was anonymised: faces, logos, wall and panel text, and papers on the doors are
blurred. The engineer's answers in this run were given by the builder. Timings come from the Cloudflare Workflows
instance records and the database timestamps.

| Stage | Time | Target |
|---|---|---|
| Upload (30 key frames, 1 narrated path clip, 2 panel photos, 2 photos) | 1 min 52 s from creating the survey to the last file (includes the device step) | none |
| Processing: SAM 3.1 on 30 frames (5 batches), room inventory, panel photos, request reader | **67 s** | ≤ 2 min ✅ |
| Meeting: 3 rounds, 5 department agents plus the Survey Lead | **90 s** of agent time (34 s, 31 s, 25 s); 1 min 55 s end to end, including 22 s for the engineer to answer 2 questions | ≤ 3 min ✅ |

Where the processing time went: room inventory 34 s, request reader 12 s, SAM 11 s, panel photos 6 s.
The Survey Lead ran on Muse Wonder in all 3 rounds, with no fallback to Spark.

### What the draft got right
- 6 racks in two rows, the door, the overhead ladder, a column and 2 wall panels, each linked to the frames it was
  seen in. The engineer kept all of them.
- Room size 6 × 9 tiles. The draft marks it low confidence.
- The request reader got the device, the place in the target rack ("under the two devices"), the route over the
  ladder to rack 40 in the transmission room, the single-mode fibre and the DC power. Its 3 questions match the
  narration's open points: is the next rack the customer's, which wall box feeds DC, is rack 40 confirmed.
- Three housekeeping observations, each with its frames: a stepladder left in the aisle, loose fibre outside the
  racks, and undressed cables on the tray.

### Misses, and how the layout step fixed them
| Miss | Fixed in the layout step by |
|---|---|
| Panel photos: none of the 11 breaker slots read had a rating or free/used state, because panel text is blurred by design | The engineer entered breakers 3 and 4: 16 A DC, free |
| Cooling units are not drawn as layout items | The engineer entered 2 units and 6,000 BTU/h spare |
| Ladder height is not visible in the footage | The engineer entered 2.6 m |
| No free rack space was found on the target rack | The engineer marked R3 as the target, free from U10 to U30 |
| The customer's rack was not known | Answered in round 1: Room Manager asked, the engineer said yes, and R4 became off limits for the next round |

### Gaps the run left open (soft checks, AC 2)
- **The tile grid was found on 6 of 30 key frames (20%, target ≥ 80%).** The footage mostly faces the racks and
  the ceiling, so SAM sees little floor. Room size therefore comes from rack footprints and is marked low
  confidence. A slower floor-level pass at capture time would fix this; the app does not ask for one yet.
- **R1 is drafted inside the door swing.** The Room Manager objected (R6) in every round. The engineer approved with
  an override reason: check the door clearance on site. The footage cannot tell whether this is a drafting error
  or a real clearance problem.
- **The power objection (R11) stands.** The datasheet lists a 40 A breaker, but only 16 A breakers are confirmed
  free. The engineer approved with a pre-install work order for the breakers as the override reason.

## Run it locally

Needs Node 22 or newer, a Meta Model API key and a Baseten key (for Muse Spark Open).

```sh
npm install
cat > .env <<'VARS'
META_MODEL_API_KEY=...
BASETEN_API_KEY=...
DEMO_PASSCODE=pick-a-local-passcode
VARS
npx wrangler d1 migrations apply survai --local
npm run dev        # http://localhost:5173
npm test           # the Vitest suite (in the Workers runtime) plus the source guards
```

Prepare footage with `tools/prepare` first (macOS: it uses Apple Vision for faces and text); see
`tools/prepare/README.md`. Model calls in tests are mocked or replayed from `fixtures/recorded/`.

To deploy your own copy: create a D1 database and an R2 bucket named in `wrangler.jsonc`, set the three keys with
`npx wrangler secret put`, apply the migrations with `--remote`, then `npm run deploy`.

## Code map

| Path | What |
|---|---|
| `src/` | React app: the five steps, report, replay, sign-off |
| `worker/routes/` | Hono API: surveys, device lookup, files, layout, meeting, answers, approve, sign-off, replay |
| `worker/agents/` | Prompts, schemas and merging for each agent and the Survey Lead |
| `worker/calc/` | Calculated rules, cable lengths, heat load |
| `worker/clients/` | Meta Model API and Baseten client with timeouts, retries, fallback and daily caps |
| `worker/workflows/` | `ProcessSurvey` and `MeetingRound` Cloudflare Workflows |
| `migrations/` | D1 schema |
| `tools/prepare/` | Local anonymiser: blur, key-frame picking, metadata stripping |
| `test/` | Vitest suites |

## Built during the hackathon

Everything in this repository was written during the build window (first commit Oct 27, 2026; the history shows
each step). One file is reused from the builder's earlier project: `scripts/demo-video/cdp.mjs`, a small headless
Chrome driver used only to record the demo video; it is not part of the app.

Built on Cloudflare Workers, D1, R2 and Workflows, with Vite and React. MIT licensed.
