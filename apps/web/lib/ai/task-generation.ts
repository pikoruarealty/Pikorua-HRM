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

export type GeneratedWorkItem = {
  title: string;
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
    `Quality bar: every item must be specific, actionable, and independently ownable. No vague items ("misc", "other", "improve things"). No two items should overlap. Group related items under a coherent "${input.subUnitLabel}". Order sub-units in a sensible sequence of work. Collectively the items must fully achieve the expected outcome — nothing essential missing, no scope invented beyond what the brief and outcome imply.`,
    `Constraints: at most ${input.maxSubUnits ?? MAX_SUB_UNITS} "${input.subUnitLabel}" groups, and at most ${input.maxItemsPerSubUnit ?? MAX_ITEMS_PER_SUB_UNIT} "${input.workItemLabel}" items per group. Keep titles short (a few words), concrete, and starting with a verb where natural.`,
    `Respond with a single JSON object ONLY (no prose, no markdown, no reasoning in the output) of the exact shape:`,
    `{ "subUnits": [ { "name": string, "workItems": [ { "title": string${input.mode === WorkItemMode.atomic ? `, "taskPoints": number` : `, "targetValue": number`} } ] } ] }`,
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

  const subUnits: GeneratedSubUnit[] = result.data.subUnits
    .slice(0, maxSub)
    .map((su) => ({
      name: su.name.trim(),
      workItems: su.workItems
        .slice(0, maxItems)
        .map((wi) => {
          const item: GeneratedWorkItem = { title: wi.title.trim() };
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
  description?: string | null;
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
    input.mode === WorkItemMode.metric
      ? `This is a metric task — progress is measured by a number reaching a target, so frame it around hitting that goal.`
      : `This is an atomic task — it is done when the concrete deliverable is finished.`,
    `Write 2-4 short sentences. No markdown headings, no preamble like "Here is" — address the employee directly ("You'll…").`,
  ].join("\n\n");
  const user = [
    `Project: ${input.workUnitName}`,
    `Group: ${input.subUnitName}`,
    `Task: ${input.workItemTitle}`,
    ...(input.description ? [`Project context: ${input.description}`] : []),
  ].join("\n");

  const raw = await groqChat({ system, user, temperature: 0.5 });
  const explanation = raw.trim().slice(0, MAX_EXPLANATION_CHARS);
  if (!explanation) throw new GroqError("Groq returned an empty explanation.");
  return { explanation };
}
