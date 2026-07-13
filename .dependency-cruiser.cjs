/**
 * dependency-cruiser config for Pikorua HRM.
 *
 * Purpose: make file/import tracking easy and keep the two-track architecture
 * honest — surface circular deps, unresolved imports, and (forward-looking)
 * accidental cross-track coupling so a change in one track can't quietly break
 * the other.
 *
 * Usage (after `npm install`):
 *   npm run depgraph:validate   # rule check (exit non-zero on errors)
 *   npm run depgraph:text       # dependencies as text
 *   npm run depgraph:svg        # visual graph (requires GraphViz `dot`)
 *   npm run depgraph:json       # raw graph for tooling
 *
 * Track boundaries: the cross-track rules below intentionally target only
 * feature folders under app/ and components/. The sanctioned Phase 0 bridge —
 * Track A's payroll importing lib/requests + lib/recognition (Track B-owned) —
 * lives under lib/ and is therefore allowed. See docs/IMPLEMENTATION_PLAN §5.
 */

// Feature folders each track owns (regex fragments, joined below).
const TRACK_A = "(employees|departments|teams|attendance|payroll)";
const TRACK_B =
  "(work-units|sub-units|work-items|daily-selections|requests|recognition|announcements|notifications|events|documents|assets)";

// Match a track's feature folder under app/(dashboard), app/api/v1, or components.
const featurePath = (track) =>
  `apps/web/(app/\\(dashboard\\)/${track}|app/api/v1/${track}|components/${track})`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Circular dependencies make code hard to reason about and break the cascading-update rule. Refactor to a DAG.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment:
        "Orphan modules (imported by nothing) are usually dead code. Route/page/config/type files are exempt below.",
      from: {
        orphan: true,
        pathNot: [
          "\\.(d|config|test|spec)\\.(js|mjs|cjs|ts|tsx)$",
          "apps/web/app/.*/(page|layout|route|loading|error|not-found)\\.tsx?$",
          "apps/web/app/globals\\.css$",
        ],
      },
      to: {},
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "Importing something that can't be resolved is a broken build.",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-dev-dep-in-src",
      severity: "error",
      comment: "Don't import devDependencies from shipped source.",
      from: {
        path: "^apps/web/(app|lib|components)",
        pathNot: "\\.(test|spec)\\.(js|mjs|cjs|ts|tsx)$",
      },
      to: { dependencyTypes: ["npm-dev"] },
    },
    // ---- Two-track boundary guards (warn; fire only once feature folders exist) ----
    {
      name: "track-a-not-into-track-b",
      severity: "warn",
      comment:
        "Track A feature code should not import Track B feature folders directly. Use the sanctioned lib/ bridge (lib/requests, lib/recognition) instead — IMPLEMENTATION_PLAN §5.",
      from: { path: featurePath(TRACK_A) },
      to: { path: featurePath(TRACK_B) },
    },
    {
      name: "track-b-not-into-track-a",
      severity: "warn",
      comment:
        "Track B feature code should not import Track A feature folders directly. Both tracks read employees/departments via shared lib + Prisma, not each other's feature modules.",
      from: { path: featurePath(TRACK_B) },
      to: { path: featurePath(TRACK_A) },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "apps/web/tsconfig.json" },
    tsPreCompilationDeps: true, // count type-only imports too
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
    reporterOptions: {
      dot: { collapsePattern: "node_modules/(@[^/]+/[^/]+|[^/]+)" },
      text: { highlightFocused: true },
    },
  },
};
