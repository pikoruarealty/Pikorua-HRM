import { describe, expect, test } from "bun:test";
import { RequestStatus } from "@prisma/client";
import { isUuid, uuidFilter, dateFilter, intFilter, enumFilter } from "./params";

const UUID = "870f5ac0-c82e-429c-b1e2-4550d89d57ba";

describe("isUuid", () => {
  test("accepts a real seeded id", () => {
    expect(isUuid(UUID)).toBe(true);
  });

  test("accepts uppercase — Postgres does", () => {
    expect(isUuid(UUID.toUpperCase())).toBe(true);
  });

  test.each([
    ["the string that caused the 500s", "not-a-uuid"],
    ["empty", ""],
    ["right length, wrong shape", "870f5ac0c82e429cb1e24550d89d57ba"],
    ["non-hex character", "870f5ac0-c82e-429c-b1e2-4550d89d57bz"],
    ["trailing junk", `${UUID}x`],
    ["leading whitespace", ` ${UUID}`],
    ["SQL-ish", "1 OR 1=1"],
  ])("rejects %s", (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });

  test("rejects null/undefined without throwing", () => {
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("uuidFilter — three-way contract", () => {
  test("absent means no filter, not a rejection", () => {
    expect(uuidFilter(null)).toBeUndefined();
    expect(uuidFilter("")).toBeUndefined();
  });

  test("valid passes through", () => {
    expect(uuidFilter(UUID)).toBe(UUID);
  });

  // null is the signal to 422. Returning undefined here would drop the filter
  // and answer 200 with EVERY row the viewer may see — a failed narrow search
  // that looks like a successful broad one.
  test("malformed is null, distinct from absent", () => {
    expect(uuidFilter("not-a-uuid")).toBeNull();
  });
});

describe("dateFilter", () => {
  test("absent", () => {
    expect(dateFilter(null)).toBeUndefined();
  });

  test("parses an ISO date", () => {
    expect(dateFilter("2026-08-11")?.toISOString()).toBe("2026-08-11T00:00:00.000Z");
  });

  // `new Date("notadate")` is an Invalid Date, which Prisma throws on rather
  // than ignoring — this is the exact input that 500'd GET /attendance.
  test("malformed is null, never an Invalid Date", () => {
    expect(dateFilter("notadate")).toBeNull();
    expect(dateFilter("2026-13-45")).toBeNull();
  });
});

describe("intFilter", () => {
  test("absent", () => {
    expect(intFilter(null, 1, 12)).toBeUndefined();
  });

  test("in range", () => {
    expect(intFilter("8", 1, 12)).toBe(8);
  });

  test("non-numeric is null", () => {
    expect(intFilter("abc", 1, 12)).toBeNull();
    expect(intFilter("8.5", 1, 12)).toBeNull();
  });

  // ?month=99 used to answer 200 with an empty list — "you have no payslips"
  // rather than "that isn't a month".
  test("out of range is null, not clamped", () => {
    expect(intFilter("99", 1, 12)).toBeNull();
    expect(intFilter("0", 1, 12)).toBeNull();
    expect(intFilter("-5", 1, 12)).toBeNull();
  });
});

describe("enumFilter", () => {
  test("absent", () => {
    expect(enumFilter(null, RequestStatus)).toBeUndefined();
  });

  test("valid member", () => {
    expect(enumFilter("approved", RequestStatus)).toBe(RequestStatus.approved);
  });

  test("unknown member is null", () => {
    expect(enumFilter("bogus", RequestStatus)).toBeNull();
  });
});
