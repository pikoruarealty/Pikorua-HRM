import { describe, expect, test } from "bun:test";
import { WFH_MAX_SESSION_HOURS, wfhSessionDeadline } from "./wfh-autoclose";

describe("wfhSessionDeadline", () => {
  test("a session is closed 8 hours after it started", () => {
    expect(WFH_MAX_SESSION_HOURS).toBe(8);
    const d = wfhSessionDeadline(new Date("2026-10-23T16:30:00.000Z"));
    expect(d.toISOString()).toBe("2026-10-24T00:30:00.000Z");
  });

  test("a night session's deadline falls on the next calendar day", () => {
    // 22:30 IST on the 23rd -> 06:30 IST on the 24th. The hours still belong to the
    // record the session was opened on (see closeSessionAndRecompute).
    const started = new Date("2026-10-23T17:00:00.000Z");
    const d = wfhSessionDeadline(started);
    expect(d.getTime() - started.getTime()).toBe(8 * 3_600_000);
    expect(d.toISOString().slice(0, 10)).toBe("2026-10-24");
  });
});
