// protects: the top stepper lets the engineer go back to any step already reached (and forward again), and a locked
// step shows what was saved there; fails_when: a reached step is not a button, an unreached one is, or the device
// summary drops a saved value or offers an input; no_claim: keeping unsaved inputs across switches (checked in a
// browser) and the server's own state rules (covered by the route tests).
// Type-checked with the app (browser) config, not the Worker one.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.edge";
import { describe, expect, it } from "vitest";
import { Stepper, StepNav } from "../src/components/Shell";
import { DeviceSummary } from "../src/steps/DeviceStep";

const buttons = (html: string) => [...html.matchAll(/<button[^>]*>.*?<\/button>/g)].map((m) => m[0]);

describe("the top stepper", () => {
  it("makes every reached step a button except the one shown", () => {
    const html = renderToStaticMarkup(createElement(StepNav.Provider, { value: { reached: 4, go: () => {} } }, createElement(Stepper, { step: 2 })));
    const b = buttons(html);
    expect(b.map((x) => x.match(/Survey|Upload|Layout|Meeting|Report/)?.[0])).toEqual(["Survey", "Layout", "Meeting"]);
    expect(html).toMatch(/aria-current="step"[^>]*>(?:(?!<\/li>).)*Upload/);
    expect(b.join("")).not.toContain("Report");
  });

  it("is plain text where there is nothing to go back to (a new survey)", () => {
    const html = renderToStaticMarkup(createElement(Stepper, { step: 1 }));
    expect(buttons(html)).toEqual([]);
  });
});

describe("the locked survey step", () => {
  it("shows the saved survey and device, read-only", () => {
    const survey = {
      id: "s", site: "Demo room", project: "Core upgrade", device_model: "Juniper MX104", quantity: 1, connects_to: "same_room", status: "layout_review",
      reps: ["space", "power"], rooms: ["devices_hall"], processing_error: null,
      device: { confirmed: true, height_u: 3.5, depth_mm: 240, power_w: 800, feed_type: "DC", feed_count: 2, breaker_rating_a: 40, airflow: "side to side", weight_kg: 14.5,
        sources: [{ url: "https://example.com/mx104", title: "MX104 datasheet" }] },
    } as const;
    const html = renderToStaticMarkup(createElement(DeviceSummary, { survey: survey as never }));
    for (const v of ["Demo room", "Core upgrade", "Juniper MX104", "Space", "Power", "3.5", "800", "DC", "40", "240", "14.5", "side to side", "MX104 datasheet"]) expect(html).toContain(v);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
  });
});
