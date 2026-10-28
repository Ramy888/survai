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
