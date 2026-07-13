// SHARED (Phase 0). Signals a Phase 0 contract whose implementation is still
// owned by the other track. Callers get a loud, greppable failure rather than a
// silently-wrong value (see dev rule: never bluff / no partial results).
export class NotImplementedError extends Error {
  constructor(feature: string, owner: "Track A" | "Track B") {
    super(`Not implemented yet (${owner} owns this): ${feature}`);
    this.name = "NotImplementedError";
  }
}
