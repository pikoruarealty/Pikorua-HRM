import { describe, expect, test } from "bun:test";
import { photoApiPath, withPhotoPath } from "./photo";

const ID = "3f6c1c2e-0000-4000-8000-000000000001";

describe("photoApiPath", () => {
  test("null when there is no photo", () => {
    expect(photoApiPath({ id: ID, photoUrl: null })).toBeNull();
  });
  test("serving route + per-upload version, never the raw storage key", () => {
    const path = photoApiPath({ id: ID, photoUrl: `photos/${ID}/abc-123.jpg` });
    expect(path).toBe(`/api/v1/employees/${ID}/photo?v=abc-123`);
    expect(path).not.toContain("photos/");
  });
  test("a replaced photo (new key) is a different URL, so a cached old one isn't reused", () => {
    const a = photoApiPath({ id: ID, photoUrl: `photos/${ID}/aaa.png` });
    const b = photoApiPath({ id: ID, photoUrl: `photos/${ID}/bbb.png` });
    expect(a).not.toBe(b);
  });
  test("withPhotoPath swaps the key for the path and keeps other fields", () => {
    const out = withPhotoPath({ id: ID, fullName: "A", photoUrl: `photos/${ID}/x.webp` });
    expect(out.fullName).toBe("A");
    expect(out.photoUrl).toBe(`/api/v1/employees/${ID}/photo?v=x`);
  });
});
