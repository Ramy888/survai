// Why SurvAI matters, in the builder's own team's numbers: who no longer travels, and how much sooner the report lands.
// Drawn as people, desks and calendars so the numbers read at a glance; the sentences are for screen readers too.

const Person = ({ on }: { on?: boolean }) => (
  <svg viewBox="0 0 24 32" className={`ic person${on ? " on" : ""}`} aria-hidden="true"><circle cx="12" cy="7" r="5" /><path d="M3 31v-8a9 9 0 0 1 18 0v8z" /></svg>
);
const Desk = () => (
  <svg viewBox="0 0 32 32" className="ic desk" aria-hidden="true"><rect x="5" y="5" width="22" height="15" rx="2" /><path d="M13 20v5h6v-5M9 27h14" fill="none" strokeWidth="2.4" /></svg>
);
const Calendar = () => (
  <svg viewBox="0 0 24 24" className="ic small" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" strokeWidth="2" /><path d="M3 10h18M8 3v4M16 3v4" fill="none" strokeWidth="2" /></svg>
);
const Clock = () => (
  <svg viewBox="0 0 24 24" className="ic small" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" strokeWidth="2" /><path d="M12 7v5l3 2" fill="none" strokeWidth="2" /></svg>
);
const Signed = () => (
  <svg viewBox="0 0 24 24" className="ic small" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" strokeWidth="2" /><path d="M8 12.5l2.8 2.8L16.5 9" fill="none" strokeWidth="2.2" /></svg>
);
const Car = () => (
  <svg viewBox="0 0 24 24" className="ic small" aria-hidden="true"><path d="M4 16v-4l2-5h12l2 5v4zM4 16v3M20 16v3" fill="none" strokeWidth="2" /><circle cx="8" cy="14" r="1.2" /><circle cx="16" cy="14" r="1.2" /></svg>
);

export function Impact() {
  return (
    <section className="panel impact" aria-labelledby="impact-h">
      <h2 id="impact-h">One engineer on site instead of six</h2>
      <div className="impact-cols">
        <div>
          <span className="label">Today</span>
          <div className="pics" role="img" aria-label="Six people on site">{Array.from({ length: 6 }, (_, k) => <Person key={k} on />)}</div>
          <p className="big"><b>6</b> people on site</p>
          <p className="fact"><Car /><span>each gives a working day to travel there</span></p>
          <p className="fact"><Calendar /><span><b>3–5 days</b> to a signed survey</span></p>
          <p className="sr-only">The engineer and five departments (Space/Acceptance, Power, Cooling, Execution, Room Manager) visit together.</p>
        </div>
        <div>
          <span className="label">With SurvAI</span>
          <div className="pics" role="img" aria-label="One person on site, five at their desks"><Person on />{Array.from({ length: 5 }, (_, k) => <Desk key={k} />)}</div>
          <p className="big"><b>1</b> on site, <b>5</b> at their desks</p>
          <p className="fact"><Clock /><span>the agents meet in <b>minutes</b></span></p>
          <p className="fact"><Signed /><span>each department signs from its desk; an objection reopens the meeting</span></p>
        </div>
        <div>
          <span className="label">At scale</span>
          <div className="pics" role="img" aria-label="Five of six site visits saved"><Person on />{Array.from({ length: 5 }, (_, k) => <Person key={k} />)}</div>
          <p className="big"><b>5 of 6</b> site visits saved</p>
          <p className="fact"><Calendar /><span>about <b>5,000</b> person-days a year back at work</span></p>
          <p className="fact"><span className="ic-num">1k+</span><span>surveys a year in one region</span></p>
        </div>
      </div>
      <p className="muted small">Figures from the builder's own team: six people, one site a day each, 1,000+ surveys a year.</p>
    </section>
  );
}
