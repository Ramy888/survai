// The department links, shown once after they are issued (at approve, or reissued from the report).
const TAG: Record<string, string> = { space: "SPC", power: "PWR", cooling: "CLG", execution: "EXE", transmission: "TRN", room_manager: "RMG" };
const NAME: Record<string, string> = { space: "Space", power: "Power", cooling: "Cooling", execution: "Execution", transmission: "Transmission", room_manager: "Room Manager" };

export type IssuedLink = { agent: string; token: string };
export const linkUrl = (token: string) => `${location.origin}/s#${token}`;
const copy = (text: string) => void navigator.clipboard?.writeText(text);
export const copyAll = (links: IssuedLink[]) => copy(links.map((l) => `${NAME[l.agent] ?? l.agent}: ${linkUrl(l.token)}`).join("\n"));

export function SignoffLinks({ links }: { links: IssuedLink[] }) {
  return (
    <section className="panel links" aria-label="Sign-off links">
      {links.map((l) => (
        <div className="r" key={l.agent}>
          <span className="tag">{TAG[l.agent] ?? l.agent}</span>
          <div className="grow">{NAME[l.agent] ?? l.agent}<span className="sub mono" style={{ overflowWrap: "anywhere" }}>{linkUrl(l.token)}</span></div>
          <button className="btn btn-secondary" onClick={() => copy(linkUrl(l.token))} aria-label={`Copy the ${NAME[l.agent] ?? l.agent} link`}>Copy</button>
        </div>
      ))}
    </section>
  );
}
