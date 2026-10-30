# SurvAI

Telecom equipment-room site surveys, from anonymised footage to a signed report. Meta SAM 3.1 outlines racks and
floor tiles, Muse Spark drafts the room and reads the engineer's narration, one Muse Spark agent per department
reviews the plan over up to three rounds, and Muse Wonder leads as Survey Lead. The engineer approves.

- **Try it, no passcode:** https://survai.ramy-comm.workers.dev/sample (a real survey's meeting and report, with a
  "Run the meeting again, live" button). In it the departments agree on rack R4 and find the blocker before anyone
  travels: the room has none of the two free 40 A DC feeds the router needs, so power is arranged before the install.
- **Live app:** https://survai.ramy-comm.workers.dev (creating a survey needs a team passcode, because it runs paid models)
- **Demo video (3 min):** https://youtu.be/7Olt652K2Ag. The narration is synthetic: a clone of the builder's own voice
  (Cartesia). Footage in the video is blurred.
- **Track:** Indie developer · Build for Your World. Built solo by a field network engineer who does these surveys.

## Impact: one engineer on site instead of six

Figures from the builder's own team:

| | Today | With SurvAI |
|---|---|---|
| Who goes to the site | The engineer and 5 departments (Space/Acceptance, Power, Cooling, Execution, Room Manager); each can do one site a day | One engineer, who films the room |
| Where the departments work | On site, together, on a day everyone is free | At their desks: each gets the report and its sign-off link; a representative's objection goes into the next meeting run |
| Request to signed survey | 3–5 days | The same day: processing about a minute, the meeting 2–3 minutes |
| Per year (1,000+ surveys in one region) | about 6,000 person-days on site | about 1,000: **5 of 6 site visits saved, about 5,000 person-days a year** |

## Measured accuracy

From [`docs/eval/accuracy.md`](docs/eval/accuracy.md); the scripts are in `scripts/eval/`.

| What | Result |
|---|---|
| Datasheet lookup (Muse Spark 1.3, web search) | **8 of 8** fields match Juniper's MX104 hardware guide |
| Rack detection (SAM 3.1) | **43 of 44** boxes on a rack (98%); racks found in **21 of 28** frames (75%) |
| Taped sheets to blur (SAM 3.1) | **9 of 9** found; "label" alone found 0 of 9, so the blur now also asks for "paper" and "sticker" |
| Devices in racks (SAM 3.1) | Routers found in **6 of 15** frames that show them; the free-U estimate (U7–U21) is close to what was measured on site (U1–U20) |
| Meeting repeatability | Same rack in **5 of 5** runs; forced objections identical; verdicts agree **23 of 25** (round 1 run five times on a local test survey of this room, not the public sample) |
| Rules | **5 of the 12 rules** are calculated in code, and a model cannot overturn them; 264 automated tests |

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
2. **Upload.** Two ways in. **The video as is**: the engineer uploads the walk-through as filmed; SurvAI picks the
   30 sharpest frames in the browser (one per time slice, the same rule as `tools/prepare`), sends each picked frame to
   Meta SAM 3.1 once to find labels to blur (nothing is kept on the server), blurs them in the browser, and uploads only
   the blurred frames. Privacy is SurvAI's job, not the engineer's. **Prepared frames**: frames already picked and
   blurred elsewhere (for example on a Mac with `tools/prepare`, where nothing unblurred leaves the computer). The same
   walk-through carries the engineer's narration of where the device goes and how the cables run: the browser shows it
   as a waveform under the frames and uploads the video once for Muse Spark 1.3 to read; processing deletes it right
   after, so only blurred frames are kept. Then photos of the power panel.
3. **Processing** (a Cloudflare Workflow, about a minute):
   - SAM 3.1 outlines every rack and floor tile in every frame. The tile grid gives the room size; the outlines are
     kept as evidence the engineer can see.
   - Muse Spark drafts the room: racks, door, A/C, ladder, columns, wall panels, each linked to the frames it was
     seen in.
   - Muse Spark 1.3 turns the Egyptian Arabic narration into the request (what goes where, the route, the
     destination) and the questions it leaves open, and reads the breakers on the panel photo.
4. **Layout.** The engineer corrects the drafted plan on a 600 mm tile grid and fills in what the footage can't
   show: free breakers, spare cooling, ladder height. The target rack comes marked from the narration, and its free
   rack units come pre-filled from SAM's boxes (the gap below its devices, the rack counted as 42U) for the engineer
   to confirm. Dashed outlines show where a new 80 × 80 cm rack would fit in line with the others without blocking a
   door or an aisle (1.2 m kept clear in front of every rack); the Survey Lead places a new rack only on one of them.
5. **Meeting.** Up to 3 rounds. Each department agent sees the room facts, the rules it owns, the calculations, and
   every other agent's statement from the round before. The Survey Lead resolves conflicts, proposes the reserved
   area and cable paths (cables may cross racks, never a door or its swing; a path through one is sent back), and
   decides whether another round is needed; in the last round it closes the meeting with a verdict. Agents ask the
   engineer questions; the answers change the facts for the next round. A reply that breaks the rules (another
   department's rule, an unknown frame or calculation) goes back to the agent with the exact error, up to twice.
6. **Approve and report.** Approving over an objection needs a written reason. The report mirrors a real company
   survey form: approved items, every statement with its rule and evidence, the floor plan to scale with cable
   lengths (from the plan, else from the narration or Execution's measurement, labelled), overrides and reasons. It
   prints to A4. Each department gets its own sign-off link; a representative's decision and comment go into the
   next run of the meeting, so a department can change the outcome without travelling.

## Meta models

| Task | Model | Notes |
|---|---|---|
| Labels, taped sheets, stickers and people to blur, in the browser | **SAM 3.1** (Meta Model API) | Boxes only; the browser blurs and uploads the blurred frame, the server keeps nothing |
| Racks, floor tiles, devices in the racks and empty shelves in every key frame | **SAM 3.1** (Meta Model API) | Image mode on the sharpest frames; video mode stopped tracking after 16 instances on a long walk-through |
| Department agents: Space, Power, Cooling, Execution, Room Manager, Transmission | **Muse Spark Open** (open weights, on Baseten) | Fall back to Muse Spark 1.3 if Baseten fails |
| Room layout from the frames, with the target rack named in the narration | **Muse Spark Open** | Same fallback; the plan names the model that drew it |
| Survey Lead | **Muse Wonder 1.0** | 20 s limit, falls back to Muse Spark 1.3; the app shows which model answered |
| Request from the narration in the walk-through (video and audio, Egyptian Arabic) | **Muse Spark 1.3** | Video goes to Meta-hosted models only, sent with `store: false`, deleted after reading |
| Breakers on the panel photo | **Muse Spark 1.3** | Spark Open refused panel photos in day-1 tests |
| Device datasheet, with citations | **Muse Spark 1.3** + web search | Cached per device model (one lookup cost about $0.45) |

Every statement in the meeting and every step on the processing screen carries a tag naming the model that wrote
it. Day-1 model tests are in `docs/day1.md`.

**Open-weight models:** every department agent and the room layout run on **Muse Spark Open**
(`meta-models/muse-spark-open-1026`), served through Baseten partner inference. Spark Open does the department work: each
agent's verdict and objections under the rules it owns, the placement options it raises, and Cooling's comparison of
them. Muse Wonder 1.0 leads because one reasoning model has to weigh those opinions against the calculations,
resolve conflicts and pick the placement, or say why none passes yet.

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

- In the app, each picked frame goes to SAM 3.1 once to find what to blur; the browser blurs it and uploads only the
  blurred copy. With `tools/prepare`, footage is blurred on the engineer's computer before anything leaves it.
- The public sample's footage had equipment logos blurred before upload; in the app, SAM 3.1 found the labels,
  taped sheets, stickers and people, and the browser blurred them before storing the frames.
- Creating surveys and uploading need a passcode: 5 wrong tries per IP per 10 minutes, compared in constant time.
- Daily caps on SAM and model calls are taken atomically before each call, so a refused call never reaches a paid
  API. A public "run the meeting again" is limited to one per visitor per 10 minutes and 20 a day, from its own
  allowance.
- Model output is rendered as text only; a guard in `npm test` fails the build on raw HTML rendering.
- No secrets in the repo: keys live in Worker secrets and a gitignored env file.

## Live run (Oct 27, 2026, deployed app)

One survey from upload to signed report on the deployed app, for one Juniper MX104 router. The footage came from a
real equipment room. Before upload, it was anonymised: faces, logos, wall and panel text, and papers on the doors are
blurred; that is what the models saw. (The public sample is a later survey of the same room, made in the app from one
narrated video, with logos blurred in the footage and labels, papers and people blurred in the browser.) The engineer's answers in this run were given by the builder. Timings come from the Cloudflare Workflows
instance records and the database timestamps.

| Stage | Time | Target |
|---|---|---|
| Upload (30 key frames, 1 narrated path clip, 2 panel photos, 2 photos; the prepared-frames flow) | 1 min 52 s from creating the survey to the last file (includes the device step) | none |
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
Chrome driver used only to record the demo video; it is not part of the app. The room footage is the builder's own,
filmed in a room the builder surveys for work.

Built on Cloudflare Workers, D1, R2 and Workflows, with Vite and React. MIT licensed.
