// protects: the sign-off links offer a Share button only where the system share sheet works (phones and tablets);
// on a laptop Chrome's share sheet opens empty and spins, so there it is Copy only. fails_when: Share shows on a
// fine pointer, or disappears on a touch screen; no_claim: the share sheet itself or the clipboard.
// Type-checked with the app (browser) config, not the Worker one.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.edge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkActions, SignoffLinks } from "../src/signoff/SignoffLinks";

const links = [{ agent: "power", token: "t1" }, { agent: "space", token: "t2" }];
const render = () => renderToStaticMarkup(createElement("div", null, createElement(SignoffLinks, { links }), createElement(LinkActions, { links })));
const device = (coarse: boolean) => {
  vi.stubGlobal("location", { origin: "https://survai.test" });
  vi.stubGlobal("navigator", { share: () => Promise.resolve() });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(pointer: coarse)" && coarse }));
};

afterEach(() => vi.unstubAllGlobals());

describe("sign-off link buttons", () => {
  it("offer Copy only on a laptop, even when the browser has a share API", () => {
    device(false);
    const html = render();
    expect(html).toContain("Copy all links");
    expect(html.match(/>Copy</g)).toHaveLength(2);
    expect(html).not.toContain("Share");
  });

  it("offer Share and Share all on a touch screen", () => {
    device(true);
    const html = render();
    expect(html.match(/>Share</g)).toHaveLength(2);
    expect(html).toContain("Share all");
  });
});
