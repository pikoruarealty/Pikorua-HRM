import { describe, expect, test } from "bun:test";
import { AttendanceApprovalStatus, WorkLocation } from "@prisma/client";
import { buildAttendanceCalendar, splitHoursByLocation, type CalendarRecord } from "./calendar";

const at = (iso: string) => new Date(iso);

describe("splitHoursByLocation", () => {
  test("a day with no sessions is wholly the record's own location", () => {
    expect(splitHoursByLocation(8, [], WorkLocation.office)).toEqual({ office: 8, wfh: 0 });
    expect(splitHoursByLocation(8, [], WorkLocation.wfh)).toEqual({ office: 0, wfh: 8 });
  });

  test("a single wfh session is all wfh", () => {
    const s = [
      { clockIn: at("2026-08-10T04:00:00Z"), clockOut: at("2026-08-10T12:00:00Z"), workLocation: WorkLocation.wfh },
    ];
    expect(splitHoursByLocation(8, s, WorkLocation.office)).toEqual({ office: 0, wfh: 8 });
  });

  test("a mixed day splits by session time and adds back to the total", () => {
    const s = [
      { clockIn: at("2026-08-10T04:00:00Z"), clockOut: at("2026-08-10T07:00:00Z"), workLocation: WorkLocation.wfh }, // 3h
      { clockIn: at("2026-08-10T09:00:00Z"), clockOut: at("2026-08-10T14:00:00Z"), workLocation: WorkLocation.office }, // 5h
    ];
    const r = splitHoursByLocation(8, s, WorkLocation.wfh);
    expect(r).toEqual({ office: 5, wfh: 3 });
    expect(r.office + r.wfh).toBe(8);
  });

  test("scales to totalHours when approved times were edited by hand", () => {
    const s = [
      { clockIn: at("2026-08-10T04:00:00Z"), clockOut: at("2026-08-10T06:00:00Z"), workLocation: WorkLocation.wfh },
      { clockIn: at("2026-08-10T08:00:00Z"), clockOut: at("2026-08-10T10:00:00Z"), workLocation: WorkLocation.office },
    ];
    // Sessions sum to 4h but Admin set the day to 8h: still an even split.
    expect(splitHoursByLocation(8, s, WorkLocation.office)).toEqual({ office: 4, wfh: 4 });
  });

  test("an open session contributes nothing and a day without hours has no split", () => {
    const open = [{ clockIn: at("2026-08-10T04:00:00Z"), clockOut: null, workLocation: WorkLocation.wfh }];
    expect(splitHoursByLocation(null, open, WorkLocation.wfh)).toEqual({ office: 0, wfh: 0 });
    expect(splitHoursByLocation(0, [], WorkLocation.office)).toEqual({ office: 0, wfh: 0 });
  });
});

function record(date: string, over: Partial<CalendarRecord> = {}): CalendarRecord {
  return {
    date: at(`${date}T00:00:00Z`),
    workLocation: WorkLocation.office,
    approvalStatus: AttendanceApprovalStatus.approved,
    clockInRaw: at(`${date}T05:30:00Z`),
    clockOutRaw: at(`${date}T13:30:00Z`),
    clockInApproved: null,
    clockOutApproved: null,
    totalHours: 8,
    isHalfDay: false,
    isCompensation: false,
    sessions: [],
    ...over,
  };
}

describe("buildAttendanceCalendar", () => {
  const classified = [
    { date: "2026-08-03", status: "present" as const },
    { date: "2026-08-04", status: "present" as const },
    { date: "2026-08-05", status: "absent" as const },
    { date: "2026-08-06", status: "absent" as const },
    { date: "2026-08-09", status: "compensation" as const },
  ];

  test("lists every calendar day and totals hours by location from approved days", () => {
    const cal = buildAttendanceCalendar({
      month: 8,
      year: 2026,
      classified,
      records: [
        record("2026-08-03"),
        record("2026-08-04", { workLocation: WorkLocation.wfh, totalHours: 6 }),
        record("2026-08-09", { totalHours: 4, isCompensation: true }),
      ],
    });
    expect(cal.days).toHaveLength(31);
    expect(cal.hours).toEqual({ office: 12, wfh: 6, total: 18 });
    expect(cal.workedDays).toEqual({ office: 2, wfh: 1 });
    expect(cal.byStatus.present).toEqual({ office: 1, wfh: 1 });
    expect(cal.byStatus.compensation).toEqual({ office: 1, wfh: 0 });
    expect(cal.days.find((d) => d.date === "2026-08-03")?.location).toBe("office");
    expect(cal.days.find((d) => d.date === "2026-08-04")?.location).toBe("wfh");
    // Not evaluated (outside the classified window) keeps a null status.
    expect(cal.days.find((d) => d.date === "2026-08-20")?.status).toBeNull();
  });

  test("a pending record shows as pending, is not in the totals, and is tallied separately", () => {
    const cal = buildAttendanceCalendar({
      month: 8,
      year: 2026,
      classified,
      records: [record("2026-08-05", { approvalStatus: AttendanceApprovalStatus.pending, totalHours: 7 })],
    });
    const d = cal.days.find((x) => x.date === "2026-08-05")!;
    expect(d.status).toBe("pending");
    expect(d.pending).toBe(true);
    expect(cal.hours.total).toBe(0);
    expect(cal.pending).toEqual({ days: 1, hours: 7 });
  });

  test("a mixed day is labelled mixed and counted under the place with more hours", () => {
    const cal = buildAttendanceCalendar({
      month: 8,
      year: 2026,
      classified,
      records: [
        record("2026-08-03", {
          sessions: [
            { clockIn: at("2026-08-03T04:00:00Z"), clockOut: at("2026-08-03T07:00:00Z"), workLocation: WorkLocation.wfh },
            { clockIn: at("2026-08-03T09:00:00Z"), clockOut: at("2026-08-03T14:00:00Z"), workLocation: WorkLocation.office },
          ],
        }),
      ],
    });
    const d = cal.days.find((x) => x.date === "2026-08-03")!;
    expect(d.location).toBe("mixed");
    expect(d.officeHours).toBe(5);
    expect(d.wfhHours).toBe(3);
    expect(cal.workedDays).toEqual({ office: 1, wfh: 0 });
    expect(cal.hours).toEqual({ office: 5, wfh: 3, total: 8 });
  });
});
