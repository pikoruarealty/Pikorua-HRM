import { describe, expect, test } from "bun:test";
import { dueDateFromOffset } from "./task-generation";

// Pillar 1 (2026-08-08). The LLM proposes a *relative* offset ("dueInDays")
// because it has no dependable notion of today; this helper is what turns that
// into the concrete YYYY-MM-DD the Lead confirms, so its clamping and
// month/year rollover are the parts worth pinning down.
const today = new Date("2026-08-08T09:30:00.000Z");

describe("dueDateFromOffset", () => {
  test("adds whole days to today, in UTC", () => {
    expect(dueDateFromOffset(3, today)).toBe("2026-08-11");
  });

  test("rolls over month and year boundaries", () => {
    expect(dueDateFromOffset(24, today)).toBe("2026-09-01");
    expect(dueDateFromOffset(146, today)).toBe("2027-01-01");
  });

  test("rounds fractional offsets", () => {
    expect(dueDateFromOffset(2.4, today)).toBe("2026-08-10");
    expect(dueDateFromOffset(2.6, today)).toBe("2026-08-11");
  });

  test("clamps a zero/negative offset to tomorrow — never a due date in the past", () => {
    expect(dueDateFromOffset(0, today)).toBe("2026-08-09");
    expect(dueDateFromOffset(-30, today)).toBe("2026-08-09");
  });

  test("clamps an absurd offset to one year out", () => {
    expect(dueDateFromOffset(99999, today)).toBe("2027-08-08");
  });

  test("ignores the time of day — the result is date-only", () => {
    const lateInDay = new Date("2026-08-08T23:59:59.000Z");
    expect(dueDateFromOffset(1, lateInDay)).toBe("2026-08-09");
  });
});
