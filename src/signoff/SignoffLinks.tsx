// The department links, shown once after they are issued (at approve, or reissued from the report).
import { useState, type ReactNode } from "react";

const TAG: Record<string, string> = { space: "SPC", power: "PWR", cooling: "CLG", execution: "EXE", transmission: "TRN", room_manager: "RMG" };
const NAME: Record<string, string> = { space: "Space", power: "Power", cooling: "Cooling", execution: "Execution", transmission: "Transmission", room_manager: "Room Manager" };

export type IssuedLink = { agent: string; token: string };
export const linkUrl = (token: string) => `${location.origin}/s#${token}`;
const copy = (text: string) => navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("no clipboard"));
const allText = (links: IssuedLink[]) => links.map((l) => `${NAME[l.agent] ?? l.agent}: ${linkUrl(l.token)}`).join("\n");
// The system share sheet (WhatsApp, mail…) only on phones and tablets: Chrome on a laptop opens an empty, spinning sheet.
const canShare = () => typeof navigator.share === "function" && typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const share = (data: ShareData) => navigator.share(data).catch(() => {}); // closing the sheet is not an error

/** A button that says "Copied" for a moment once its copy has landed. */
function Act({ run, label, done, children }: { run: () => Promise<unknown>; label?: string; done?: string; children: ReactNode }) {
  const [ok, setOk] = useState(false);
  const click = () => run().then(() => { if (!done) return; setOk(true); setTimeout(() => setOk(false), 1500); }, () => {});
  return <button className="btn btn-secondary" aria-label={label} onClick={click}>{ok ? done : children}</button>;
}

export function LinkActions({ links }: { links: IssuedLink[] }) {
  return <>
    <Act run={() => copy(allText(links))} done="Copied">Copy all links</Act>
    {canShare() && <Act run={() => share({ title: "SurvAI sign-off links", text: allText(links) })}>Share all</Act>}
  </>;
}

export function SignoffLinks({ links }: { links: IssuedLink[] }) {
  return (
    <section className="panel links" aria-label="Sign-off links">
      {links.map((l) => (
        <div className="r" key={l.agent}>
          <span className="tag">{TAG[l.agent] ?? l.agent}</span>
          <div className="grow">{NAME[l.agent] ?? l.agent}<span className="sub mono" style={{ overflowWrap: "anywhere" }}>{linkUrl(l.token)}</span></div>
          <Act run={() => copy(linkUrl(l.token))} label={`Copy the ${NAME[l.agent] ?? l.agent} link`} done="Copied">Copy</Act>
          {canShare() && <Act run={() => share({ title: `SurvAI sign-off: ${NAME[l.agent] ?? l.agent}`, url: linkUrl(l.token) })}
            label={`Share the ${NAME[l.agent] ?? l.agent} link`}>Share</Act>}
        </div>
      ))}
    </section>
  );
}
