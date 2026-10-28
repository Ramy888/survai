# SurvAI

<!-- T21 adds the problem, architecture, Meta models used and how to run. -->

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
