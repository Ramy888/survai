# TODOS (SurvAI)

Deferred during the CEO plan review on Oct 27, 2026. Context: `docs/spec-survai.md`.

## P2
- **In-app camera capture with server-side blurring.** Why: v1 relies on offline preparation, so the
  phone flow uploads prepared files. Pros: real "film and go" field flow. Cons: needs a blur service
  (e.g. Modal) before any model sees footage. Effort: human L / CC M. Depends on: Modal credits.
- **Persistent rooms across surveys.** Why: the second survey of a room should start from its
  signed-off layout. Pros: near-instant repeat surveys, the start of a room digital twin. Cons: snapshot
  and write-back rules. Effort: human M / CC S.
- **Reviewer link and reopen loops.** Why: office audit and department objections that reopen the
  survey. Cons: state-machine complexity (round sets, link revocation). Effort: human M / CC S.
- **Voice answers to agent questions** (Muse Voice Transcribe). Effort: human S / CC S.
- **Muse Image placement illustration**, clearly labelled as an illustration. Effort: human M / CC S.
- **Arabic report export** matching the company form. Effort: human M / CC S.

## P3
- Survey auto-title from the narrated clip. Effort: S / S.
- Room capacity headroom view (space, power, cooling left). Depends on persistent rooms. Effort: M / S.
- Resumable uploads on weak connections. Effort: M / S.
- QR code on the PDF linking to the online evidence. Effort: S / S.
- Admin page (budget use, failures). Effort: S / S.
- Per-survey budgets in addition to the daily cap. Effort: S / S.
- (T18) A survey opened in a new tab has no passcode, so the Layout, Meeting and Approve buttons are greyed out with no reason given. Show a passcode field or a hint. Effort: S / S. Fixed by /design-review on main, 2026-10-28: the three steps show the passcode field when the tab has none.

## Design debt (from /design-review, 2026-10-29)
- (medium, spacing) Spacing values off the 4/8/16/24 scale (6/10/12/14/18/20 px) and inline style margins in 7 files; add spacing tokens. Effort: S / S.
- (medium, responsive) Breakpoints 420/479/960 vs DESIGN.md's 600/720; DESIGN's tablet and laptop ranges overlap. Effort: S / S.
- (medium, color) Two chip systems: "Unavailable" is grey in the meeting but red in the report; no lock icon on the sign-off page. Effort: S / S.
- (medium, typography) Secondary text (.sub, .rt, .small, .sources at 13.6 px; .ev at 12 px) is below DESIGN.md's 15 px phone minimum. Effort: S / S.
- (polish) Duplicate `.frames` rule (the sign-off evidence grid gets the 104 px version); bare `.label` outside `.field`/`.ask` renders as body text; department TAG/NAME maps copied in 5 files. Effort: S / S.
- (medium, replay) "Run the meeting again" sits below the intro, tabs, rounds and chat; consider a fixed action bar or a button under the intro so judges see it without scrolling. [muse] Effort: S / S.
- (medium, meeting) The chat's edge fade and scroll snap can tug a tall, expanded statement; snapping is kept on purpose (one review per scroll); revisit if users report it. [muse] Effort: S / S.
- (polish) One shared header for kept steps instead of one per step (Muse); the visible bugs it caused (focus, theme) are fixed. Effort: M / S.
