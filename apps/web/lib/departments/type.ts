// Departments are self-service (Admin can create one with any type_key via
// POST /api/v1/departments) but only three type_keys carry special meaning:
// "tech" (atomic task scoring), "sales" and "bd" (call/site-visit/booking
// metric scoring — the "sales" targets everywhere in this codebase). Several
// call sites used to test `typeKey !== "tech"` as a stand-in for "is a
// sales/BD department," which was fine back when tech/sales/bd were the only
// three departments that could ever exist. Now that Admin can create an
// arbitrary department (e.g. "AI Tech"), any typeKey that isn't literally
// "tech" was wrongly treated as sales/BD. Use this explicit allowlist check
// instead everywhere that distinction matters.
//
// Matched case-insensitively (2026-09-30): type_key is free text an Admin
// types, and production's Sales department was created as "Sales". The old
// exact-match `=== "sales"` therefore classed the whole sales team as a
// points (Tech) department everywhere — so they were scored on task points
// they can't earn, and every recognition score read 0.
export function isMetricDepartment(typeKey: string | null | undefined): boolean {
  const key = typeKey?.trim().toLowerCase();
  return key === "sales" || key === "bd";
}
