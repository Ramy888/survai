import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";

export const STEPS = ["Survey", "Upload", "Layout", "Meeting", "Report"] as const;

const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5L19 7" /></svg>
);

/** How far the survey has got, and how to show another step; absent on the new-survey page. */
export const StepNav = createContext<{ reached: number; go: (n: number) => void } | null>(null);

/** The five steps; every step already reached is a button, so the engineer can go back and forth. */
export function Stepper({ step }: { step: number }) {
  const nav = useContext(StepNav);
  const reached = Math.max(nav?.reached ?? step, step);
  return (
    <ol className="stepper" aria-label="Survey progress">
      {STEPS.map((name, i) => {
        const n = i + 1;
        const state = n === step ? "now" : n < reached ? "done" : n === reached ? "open" : "";
        const inner = (
          <span className="step">
            <span className="dot">{n < reached && n !== step ? CHECK : n}</span>
            <span className="sname">{name}</span>
          </span>
        );
        return (
          <li key={name} className={`${state}${n <= reached ? " reached" : ""}`} aria-current={n === step ? "step" : undefined}>
            {nav && n !== step && n <= reached ? <button type="button" className="step-btn" onClick={() => nav.go(n)} aria-label={`Go to ${name}`}>{inner}</button> : inner}
          </li>
        );
      })}
    </ol>
  );
}

function ThemeButton() {
  // Read from the page on every render: steps kept mounted while hidden each have a button, and a stale copy
  // would show the wrong label and flip the theme the wrong way when its step comes back.
  const [, redraw] = useState(0);
  const root = document.documentElement;
  const dark = root.dataset.theme === "dark" || (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const flip = () => {
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch { /* storage may be blocked */ }
    redraw((n) => n + 1);
  };
  return (
    <button className="icon-btn" onClick={flip} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}

export function Shell({ step, surveyCode, actions, children }: { step: number; surveyCode?: string; actions: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="bar">
            <a className="brand" href="/">Surv<b>AI</b></a>
            {surveyCode && <span className="mono muted">{surveyCode}</span>}
            <ThemeButton />
          </div>
          <Stepper step={step} />
        </div>
      </header>
      <main className="wrap">{children}</main>
      <nav className="actions" aria-label="Step actions"><div className="inner">{actions}</div></nav>
    </>
  );
}
