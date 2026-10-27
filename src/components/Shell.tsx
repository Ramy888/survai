import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export const STEPS = ["Survey", "Upload", "Layout", "Meeting", "Report"] as const;

const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5L19 7" /></svg>
);

function ThemeButton() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches));
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* storage may be blocked */ }
  }, [dark]);
  return (
    <button className="icon-btn" onClick={() => setDark(!dark)} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
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
          <ol className="stepper" aria-label="Survey progress">
            {STEPS.map((name, i) => {
              const n = i + 1;
              const state = n < step ? "done" : n === step ? "now" : "";
              return (
                <li key={name} className={state} aria-current={n === step ? "step" : undefined}>
                  <span className="step">
                    <span className="dot">{n < step ? CHECK : n}</span>
                    <span className="sname">{name}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </header>
      <main className="wrap">{children}</main>
      <nav className="actions" aria-label="Step actions"><div className="inner">{actions}</div></nav>
    </>
  );
}
