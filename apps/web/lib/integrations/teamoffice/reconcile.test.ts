import { describe, expect, test } from "bun:test";
import { AttendanceApprovalStatus, AttendanceSource, WorkLocation } from "@prisma/client";
import { guardDecision, pairPunches } from "./reconcile";

const t = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 12, h, m));

describe("guardDecision", () => {
  test("no existing record: proceed", () => {
    expect(guardDecision(null)).toBe("proceed");
  });

  test("existing WFH day is never overwritten by a device punch", () => {
    expect(
      guardDecision({
        workLocation: WorkLocation.wfh,
        approvalStatus: AttendanceApprovalStatus.pending,
        source: AttendanceSource.manual,
      }),
    ).toBe("skip_wfh");
  });

  test("an approved manual day is not silently clobbered", () => {
    expect(
      guardDecision({
        workLocation: WorkLocation.office,
        approvalStatus: AttendanceApprovalStatus.approved,
        source: AttendanceSource.manual,
      }),
    ).toBe("skip_already_approved");
  });

  test("an already device-synced day proceeds even if approved (it's re-reconciling itself)", () => {
    expect(
      guardDecision({
        workLocation: WorkLocation.office,
        approvalStatus: AttendanceApprovalStatus.approved,
        source: AttendanceSource.device_sync,
      }),
    ).toBe("proceed");
  });

  test("a pending office day proceeds", () => {
    expect(
      guardDecision({
        workLocation: WorkLocation.office,
        approvalStatus: AttendanceApprovalStatus.pending,
        source: AttendanceSource.manual,
      }),
    ).toBe("proceed");
  });

  test("WFH takes priority over the approved guard when somehow both are true", () => {
    expect(
      guardDecision({
        workLocation: WorkLocation.wfh,
        approvalStatus: AttendanceApprovalStatus.approved,
        source: AttendanceSource.manual,
      }),
    ).toBe("skip_wfh");
  });
});

describe("pairPunches", () => {
  test("an even number of punches pairs into closed sessions", () => {
    const spans = pairPunches([{ punchTime: t(9) }, { punchTime: t(13) }, { punchTime: t(14) }, { punchTime: t(18) }]);
    expect(spans).toEqual([
      { clockIn: t(9), clockOut: t(13) },
      { clockIn: t(14), clockOut: t(18) },
    ]);
  });

  test("an odd number of punches leaves the last session open", () => {
    const spans = pairPunches([{ punchTime: t(9) }, { punchTime: t(13) }, { punchTime: t(15) }]);
    expect(spans).toEqual([
      { clockIn: t(9), clockOut: t(13) },
      { clockIn: t(15), clockOut: null },
    ]);
  });

  test("punches are sorted before pairing, regardless of input order", () => {
    const spans = pairPunches([{ punchTime: t(18) }, { punchTime: t(9) }, { punchTime: t(13) }, { punchTime: t(14) }]);
    expect(spans).toEqual([
      { clockIn: t(9), clockOut: t(13) },
      { clockIn: t(14), clockOut: t(18) },
    ]);
  });

  test("no punches produces no spans", () => {
    expect(pairPunches([])).toEqual([]);
  });
});
