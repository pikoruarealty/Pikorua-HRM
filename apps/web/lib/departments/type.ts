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
export function isMetricDepartment(typeKey: string | null | undefined): boolean {
  return typeKey === "sales" || typeKey === "bd";
}
