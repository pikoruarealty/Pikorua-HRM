// Track B — AI task generation (feature: break a WorkUnit brief into a
// SubUnit + WorkItem draft via the LLM). Sits on top of `groqChat`.
//
// The LLM proposes a hierarchy only; it never decides assignees, points,
// targets that get persisted blindly, or writes to the DB. The route layer
// validates counts/RBAC and (optionally) persists.

import { z } from "zod";
import { WorkItemMode } from "@prisma/client";
import { groqChat, GroqError } from "./groq";

export { GroqError };

export const MAX_SUB_UNITS = 12;
export const MAX_ITEMS_PER_SUB_UNIT = 15;
/** Cap on a single item's acceptance-criteria text (Pillar 1). */
export const MAX_ITEM_DESCRIPTION_CHARS = 1000;
/** Clamp for the LLM's relative due-date offset — 1 day .. ~1 year out. */
const MIN_DUE_IN_DAYS = 1;
const MAX_DUE_IN_DAYS = 365;

/** `YYYY-MM-DD` for `today + days`, computed in UTC (matches how WorkItem
 *  periods are derived elsewhere in the codebase). */
export function dueDateFromOffset(days: number, today = new Date()): string {
  const clamped = Math.min(MAX_DUE_IN_DAYS, Math.max(MIN_DUE_IN_DAYS, Math.round(days)));
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + clamped);
  return d.toISOString().slice(0, 10);
}

export type GeneratedWorkItem = {
  title: string;
  /** Concrete acceptance criteria / definition of done for this one item. */
  description?: string;
  /**
   * Suggested due date as `YYYY-MM-DD`. Derived server-side from the LLM's
   * relative `dueInDays` offset — asking for an absolute date is unreliable
   * (the model has no dependable notion of "today"). The Lead confirms/edits
   * it before anything is persisted.
   */
  dueDate?: string;
  /** Suggested effort/story points — atomic mode only. */
  taskPoints?: number;
  /** Suggested numeric goal for the period — metric mode only. */
  targetValue?: number;
};

export type GeneratedSubUnit = {
  name: string;
  workItems: GeneratedWorkItem[];
};

export type GeneratedBreakdown = {
  subUnits: GeneratedSubUnit[];
};

// Shape we ask the LLM to return. Kept permissive (points/target optional) so a
// slightly-off response still parses; the route clamps/defaults on persist.
const llmBreakdownSchema = z.object({
  subUnits: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        workItems: z
          .array(
            z.object({
              title: z.string().min(1).max(300),
              description: z.string().max(MAX_ITEM_DESCRIPTION_CHARS).optional(),
              dueInDays: z.number().optional(),
              taskPoints: z.number().positive().optional(),
              targetValue: z.number().positive().optional(),
            }),
          )
          .default([]),
      }),
    )
    .min(1),
});

export type GenerateBreakdownInput = {
  projectName: string;
  description: string;
  mode: WorkItemMode;
  /** Domain vocabulary from DepartmentLabel, e.g. Project/Feature/Task or Campaign/Segment/Call. */
  workUnitLabel: string;
  subUnitLabel: string;
  workItemLabel: string;
  /** Approved "definition of done" from the outcome step — grounds the breakdown. */
  expectedOutcome?: string;
  maxSubUnits?: number;
  maxItemsPerSubUnit?: number;
};

function buildSystemPrompt(input: GenerateBreakdownInput): string {
  const modeGuidance =
    input.mode === WorkItemMode.atomic
      ? `Each ${input.workItemLabel} is an ATOMIC task — a single concrete deliverable one person can own end-to-end and mark done. For each one, include a "taskPoints" integer (1-13, story-point style) estimating relative effort. Do NOT include "targetValue".`
      : `Each ${input.workItemLabel} is a METRIC goal measured by a number. For each one, include a "targetValue" positive number estimating a reasonable monthly target. Do NOT include "taskPoints".`;

  return [
    `You are a senior project-planning assistant for an internal HR/work-management system. Think carefully and reason step by step before answering, then output ONLY the final JSON.`,
    `You break a ${input.workUnitLabel} down into a hierarchy: a ${input.workUnitLabel} contains several "${input.subUnitLabel}" groups, and each "${input.subUnitLabel}" contains several "${input.workItemLabel}" items.`,
    modeGuidance,
    `Every item ALSO needs a "description": the acceptance criteria — what specifically must be true for this item to count as done. Name the concrete artefacts, states, or numbers involved (files/screens/endpoints/data, the checks that must pass, the edge cases that must be handled). 1-3 sentences or up to 4 short "- " bullet lines. It must be checkable by someone else: never restate the title, never write filler like "complete the task properly" or "as required".`,
    `Every item ALSO needs "dueInDays": a whole number of days from TODAY by which the item should realistically be finished, sized to its effort and to its position in the sequence (items in later ${input.subUnitLabel} groups, or that depend on earlier ones, must be due later). Use a relative offset only — never an absolute date.`,
    `Quality bar: every item must be specific, actionable, and independently ownable. No vague items ("misc", "other", "improve things"). No two items should overlap. Group related items under a coherent "${input.subUnitLabel}". Order sub-units in a sensible sequence of work. Collectively the items must fully achieve the expected outcome — nothing essential missing, no scope invented beyond what the brief and outcome imply.`,
    `Constraints: at most ${input.maxSubUnits ?? MAX_SUB_UNITS} "${input.subUnitLabel}" groups, and at most ${input.maxItemsPerSubUnit ?? MAX_ITEMS_PER_SUB_UNIT} "${input.workItemLabel}" items per group. Keep titles short (a few words), concrete, and starting with a verb where natural. Keep each description under ${MAX_ITEM_DESCRIPTION_CHARS} characters.`,
    `Respond with a single JSON object ONLY (no prose, no markdown, no reasoning in the output) of the exact shape:`,
    `{ "subUnits": [ { "name": string, "workItems": [ { "title": string, "description": string, "dueInDays": number${input.mode === WorkItemMode.atomic ? `, "taskPoints": number` : `, "targetValue": number`} } ] } ] }`,
  ].join("\n\n");
}

function buildUserPrompt(input: GenerateBreakdownInput): string {
  return [
    `${input.workUnitLabel} name: ${input.projectName}`,
    `${input.workUnitLabel} description / brief:`,
    input.description,
    ...(input.expectedOutcome
      ? [
          ``,
          `Approved expected outcome (definition of done) — the breakdown MUST collectively deliver exactly this, no more, no less:`,
          input.expectedOutcome,
        ]
      : []),
  ].join("\n");
}

/**
 * Ask the LLM to propose a breakdown, validate it, and clamp it to the
 * configured limits. Throws GroqError on API failure or an unparseable/invalid
 * response. Never touches the database.
 */
export async function generateTaskBreakdown(
  input: GenerateBreakdownInput,
): Promise<GeneratedBreakdown> {
  const raw = await groqChat({
    system: buildSystemPrompt(input),
    user: buildUserPrompt(input),
    json: true,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new GroqError("Groq returned a non-JSON response.");
  }

  const result = llmBreakdownSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new GroqError("Groq returned JSON that did not match the expected breakdown shape.");
  }

  const maxSub = input.maxSubUnits ?? MAX_SUB_UNITS;
  const maxItems = input.maxItemsPerSubUnit ?? MAX_ITEMS_PER_SUB_UNIT;
  // One "today" for the whole breakdown so every relative due date resolves
  // against the same day, even if the mapping straddles midnight.
  const today = new Date();

  const subUnits: GeneratedSubUnit[] = result.data.subUnits
    .slice(0, maxSub)
    .map((su) => ({
      name: su.name.trim(),
      workItems: su.workItems
        .slice(0, maxItems)
        .map((wi) => {
          const item: GeneratedWorkItem = { title: wi.title.trim() };
          const description = wi.description?.trim().slice(0, MAX_ITEM_DESCRIPTION_CHARS);
          if (description) item.description = description;
          if (wi.dueInDays !== undefined && Number.isFinite(wi.dueInDays)) {
            item.dueDate = dueDateFromOffset(wi.dueInDays, today);
          }
          if (input.mode === WorkItemMode.atomic) {
            if (wi.taskPoints !== undefined) {
              item.taskPoints = Math.max(1, Math.round(wi.taskPoints));
            }
          } else if (wi.targetValue !== undefined) {
            item.targetValue = wi.targetValue;
          }
          return item;
        })
        .filter((wi) => wi.title.length > 0),
    }))
    .filter((su) => su.name.length > 0);

  if (subUnits.length === 0) {
    throw new GroqError("Groq produced no usable sub-units for this brief.");
  }

  return { subUnits };
}

const selfLoggedEffortSchema = z.object({
  hours: z.number().positive(),
  overlap: z.boolean().optional(),
  reason: z.string().optional(),
});

export type EstimateSelfLoggedInput = {
  title: string;
  description: string;
};

/** What the employee has already logged today — the model sees it so that a
 *  migration, a test pass or a UI for something already logged reads as part of
 *  that work rather than a fresh job. */
export type SelfLogDayContext = { earlierToday: { title: string; points: number }[] };

export type SelfLoggedEffort = { hours: number; overlap: boolean; reason: string };

const MAX_EFFORT_HOURS = 8;

/**
 * Effort sizing for a free-text self-logged task. Rewritten 2026-09-30 after
 * production showed the previous prompt ("story points 1-13, be skeptical, vague
 * scores low") rewarding dense technical wording and multiplying one feature's
 * score across slices: 69 tasks / 409 points from one employee, 25 entries and
 * 149 points in one day, while a plain "I will redesign the whole UI today" got
 * 2. The model (gpt-oss-120b) was not the limit — the prompt asked it to reward
 * specificity of *language* and gave it no anchor for size or sight of the rest
 * of the day. So it now estimates HOURS (points are derived in code,
 * lib/work/self-log-scoring.ts), is told outright that wording and length are
 * not effort, and is shown the day's earlier entries.
 */
export function buildSelfLogEffortPrompt(
  input: EstimateSelfLoggedInput,
  ctx: SelfLogDayContext,
): { system: string; user: string } {
  const system = [
    `You estimate how many HOURS of focused work one competent person needs for a task an employee logged themselves. The number is used for scoring, so be accurate — neither generous nor stingy.`,
    [
      `How to estimate:`,
      `- Judge the amount of WORK, not the writing. Length, buzzwords, acronyms and lists of technical nouns add nothing: "updated DTOs, controllers, services, routes and schema" is still one modest change unless the description shows it was large. A plain sentence about a big job ("redesign the whole dashboard UI") counts at its real scope.`,
      `- Work described as planned and work described as done are sized the same way: what one person could realistically do. Never more than ${MAX_EFFORT_HOURS} hours for one entry — a longer job is logged a day at a time.`,
      `- If the description doesn't say what was actually produced, assume a modest amount (1-2h) unless the scope is obviously large, in which case size the scope.`,
      `- Earlier entries from today are listed below. If this entry is a part, layer, step or follow-up of the same feature as one of them (its migration, its tests, its UI after its API, a fix to it), it is NOT separate work: size only what it adds — usually 0.5-1h — and set "overlap": true.`,
    ].join("\n"),
    [
      `Calibration:`,
      `- typo, copy, rename, config value, one-line fix: 0.25-0.5h`,
      `- small bug fix, one small UI tweak, one query or endpoint change: 0.5-1.5h`,
      `- refactor, typing, cleanup, lint or renaming with no new behaviour: 0.5-2h, unless the description gives a large, concrete scope (how many modules/files/screens)`,
      `- a self-contained feature, screen, report or integration: 3-6h`,
      `- a full working day of effort: 8h`,
    ].join("\n"),
    [
      `Examples:`,
      `- "Fixed button alignment on the settings page" -> 0.5h.`,
      `- "Added site-visit migration: created the migration persisting parent-visit relationships and the schema for multi-project visit tracking" when "Updated site-visit APIs and schema" is already logged today -> 0.5h, overlap true.`,
      `- "Redesign the whole dashboard UI" -> 8h (one day is the most an entry can claim).`,
      `- "Built CSV export with filters for the leads table, with tests" -> 3h.`,
    ].join("\n"),
    `Respond with a single JSON object ONLY (no prose, no markdown): { "hours": number, "overlap": boolean, "reason": "at most 12 words" }`,
  ].join("\n\n");

  const earlier =
    ctx.earlierToday.length === 0
      ? "none"
      : ctx.earlierToday.map((e) => `- ${e.title}`).join("\n");
  const user = [
    `Earlier entries logged today:\n${earlier}`,
    `New entry:`,
    `Title: ${input.title}`,
    `Description: ${input.description}`,
  ].join("\n");
  return { system, user };
}

/** Parses the model's reply; throws GroqError if it isn't a usable estimate. */
export function parseSelfLogEffort(raw: string): SelfLoggedEffort {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new GroqError("Groq returned a non-JSON response.");
  }
  const result = selfLoggedEffortSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new GroqError("Groq returned an unusable effort estimate.");
  }
  return {
    hours: Math.min(MAX_EFFORT_HOURS, Math.max(0.25, result.data.hours)),
    overlap: result.data.overlap ?? false,
    reason: (result.data.reason ?? "").slice(0, 160),
  };
}

export async function estimateSelfLoggedEffort(
  input: EstimateSelfLoggedInput,
  ctx: SelfLogDayContext,
): Promise<SelfLoggedEffort> {
  const { system, user } = buildSelfLogEffortPrompt(input, ctx);
  const raw = await groqChat({ system, user, json: true, temperature: 0.1 });
  return parseSelfLogEffort(raw);
}

const MAX_OUTCOME_CHARS = 1500;
const MAX_EXPLANATION_CHARS = 1200;

export type GenerateOutcomeInput = {
  projectName: string;
  description: string;
  workUnitLabel: string;
};

/**
 * Step 1 of the AI planning flow: propose a concise "definition of done" for the
 * whole project, for the creator (Lead/HR/Admin) to review and approve before
 * any tasks are generated or assigned. Plain text, no DB writes.
 */
export async function generateProjectOutcome(
  input: GenerateOutcomeInput,
): Promise<{ expectedOutcome: string }> {
  const system = [
    `You are a senior delivery lead for an internal work-management system.`,
    `Given a ${input.workUnitLabel} brief, write a clear, concrete "expected outcome" — the definition of done for the whole ${input.workUnitLabel}.`,
    `State what will exist / be true when the work is complete: the concrete deliverables and the standard they must meet. Be specific to THIS brief; do not restate the brief verbatim and do not invent scope it doesn't imply.`,
    `Write 3-6 sentences of plain prose (or a few short bullet lines). No markdown headings, no preamble like "Here is" — just the outcome itself.`,
  ].join("\n\n");
  const user = [
    `${input.workUnitLabel} name: ${input.projectName}`,
    `${input.workUnitLabel} brief:`,
    input.description,
  ].join("\n");

  const raw = await groqChat({ system, user, temperature: 0.4 });
  const outcome = raw.trim().slice(0, MAX_OUTCOME_CHARS);
  if (!outcome) throw new GroqError("Groq returned an empty expected outcome.");
  return { expectedOutcome: outcome };
}

export type ExplainWorkItemInput = {
  workItemTitle: string;
  subUnitName: string;
  workUnitName: string;
  /** The parent WorkUnit's brief — wider context, not this item's own spec. */
  projectDescription?: string | null;
  /** This item's own acceptance criteria, when the Lead/AI set one. */
  itemDescription?: string | null;
  /** `YYYY-MM-DD`, when set. */
  dueDate?: string | null;
  mode: WorkItemMode;
};

/**
 * On-demand explanation for an assigned employee: what is expected of them for
 * this specific task and how it fits the wider project. Plain text, ephemeral.
 */
export async function explainWorkItem(
  input: ExplainWorkItemInput,
): Promise<{ explanation: string }> {
  const system = [
    `You are a helpful team lead explaining a task to the employee assigned to it.`,
    `Explain, in plain, encouraging language, what is expected of them to complete this task well, and how it contributes to the wider project. If useful, mention a couple of concrete things "done" looks like.`,
    ...(input.itemDescription
      ? [`The task's acceptance criteria are given below — stay faithful to them; don't invent extra requirements or contradict them.`]
      : []),
    input.mode === WorkItemMode.metric
      ? `This is a metric task — progress is measured by a number reaching a target, so frame it around hitting that goal.`
      : `This is an atomic task — it is done when the concrete deliverable is finished.`,
    `Write 2-4 short sentences. No markdown headings, no preamble like "Here is" — address the employee directly ("You'll…").`,
  ].join("\n\n");
  const user = [
    `Project: ${input.workUnitName}`,
    `Group: ${input.subUnitName}`,
    `Task: ${input.workItemTitle}`,
    ...(input.itemDescription ? [`Acceptance criteria: ${input.itemDescription}`] : []),
    ...(input.dueDate ? [`Due by: ${input.dueDate}`] : []),
    ...(input.projectDescription ? [`Project context: ${input.projectDescription}`] : []),
  ].join("\n");

  const raw = await groqChat({ system, user, temperature: 0.5 });
  const explanation = raw.trim().slice(0, MAX_EXPLANATION_CHARS);
  if (!explanation) throw new GroqError("Groq returned an empty explanation.");
  return { explanation };
}
