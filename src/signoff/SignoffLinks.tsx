// The department links, shown once after they are issued (at approve, or reissued from the report).
const TAG: Record<string, string> = { space: "SPC", power: "PWR", cooling: "CLG", execution: "EXE", transmission: "TRN", room_manager: "RMG" };
const NAME: Record<string, string> = { space: "Space", power: "Power", cooling: "Cooling", execution: "Execution", transmission: "Transmission", room_manager: "Room Manager" };

export type IssuedLink = { agent: string; token: string };
export const linkUrl = (token: string) => `${location.origin}/s#${token}`;
const copy = (text: string) => void navigator.clipboard?.writeText(text);
const allText = (links: IssuedLink[]) => links.map((l) => `${NAME[l.agent] ?? l.agent}: ${linkUrl(l.token)}`).join("\n");
export const copyAll = (links: IssuedLink[]) => copy(allText(links));
// The phone's share sheet (WhatsApp, mail…) where there is one; a copy otherwise. Closing the sheet is not an error.
const share = (data: ShareData) => navigator.share ? navigator.share(data).catch(() => {}) : copy(data.url ?? data.text ?? "");
export const shareAll = (links: IssuedLink[]) => share({ title: "SurvAI sign-off links", text: allText(links) });

export function SignoffLinks({ links }: { links: IssuedLink[] }) {
  return (
    <section className="panel links" aria-label="Sign-off links">
      {links.map((l) => (
        <div className="r" key={l.agent}>
          <span className="tag">{TAG[l.agent] ?? l.agent}</span>
          <div className="grow">{NAME[l.agent] ?? l.agent}<span className="sub mono" style={{ overflowWrap: "anywhere" }}>{linkUrl(l.token)}</span></div>
          <button className="btn btn-secondary" onClick={() => copy(linkUrl(l.token))} aria-label={`Copy the ${NAME[l.agent] ?? l.agent} link`}>Copy</button>
          <button className="btn btn-secondary" onClick={() => share({ title: `SurvAI sign-off: ${NAME[l.agent] ?? l.agent}`, url: linkUrl(l.token) })}
            aria-label={`Share the ${NAME[l.agent] ?? l.agent} link`}>Share</button>
        </div>
      ))}
    </section>
  );
}
