# How accurate is SurvAI? Measured on the sample room

Every number below comes from the files in this folder; the scripts that produced them are in `scripts/eval/`.
Counts "by eye" were made on overlay sheets of the frames shown in the replay (boxes drawn on each frame, then each box and frame checked).

| What | Result | How it was measured |
|---|---|---|
| Datasheet lookup (Meta Muse Spark 1.3, web search) | **8 of 8** fields match Juniper's MX104 hardware guide: 3.5 U, 800 W supply, 2 DC feeds, 40 A breaker, 24 cm depth, 14.5 kg, side-to-side airflow | Values the app proposed, compared with the official guide |
| Rack detection (Meta SAM 3.1) | **43 of 44** boxes land on a rack (98%); racks found in **21 of 28** frames that show one (75%) | `sam-racks.json`: every box and frame checked by eye. Misses are motion-blurred or close-up frames |
| Taped sheets to blur (Meta SAM 3.1) | **9 of 9** found with the word "paper", 0 wrong boxes; "label" alone found **0 of 9** | `sam-labels.json`. This test changed the app: the in-browser blur now asks for label, paper, sticker and person |
| Devices in the racks (Meta SAM 3.1, "electronic device") | Routers found in **6 of 15** frames that show them (40%), 1 wrong box | `sam-devices.json`. "router" and "network switch" found nothing; the best frame gives the free-U estimate |
| Free rack space estimate | SAM's estimate **U7–U21** (15U) vs **U1–U20** entered on site | From the gap below the devices in frame 13, with the rack's box as 42U. An estimate the engineer confirms |
| Meeting repeatability (Muse Spark Open agents, Muse Wonder Lead) | **5 of 5** runs place the device in the same rack; forced objections identical **5 of 5**; department verdicts agree **23 of 25** (92%) | `meeting-consistency.json`: round 1 run five times on a local test survey of this room (not the public sample) |
| Agent reliability | **0 of 25** department turns dropped after a second retry (2 of 15 before) | Model replies that break the rules (another department's rule, an unknown calculation) are sent back with the exact error |
| Rules | **5 of the 12 rules** are calculated in code, and a model cannot overturn a failed one | `npm test`: 264 tests |
