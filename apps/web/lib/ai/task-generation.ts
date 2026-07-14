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
  maxSubUnits?: number;
  maxItemsPerSubUnit?: number;
};

function buildSystemPrompt(input: GenerateBreakdownInput): string {
  const modeGuidance =
    input.mode === WorkItemMode.atomic
      ? `Each ${input.workItemLabel} is an ATOMIC task. For each one, include a "taskPoints" integer (1-13, story-point style) estimating relative effort. Do NOT include "targetValue".`
      : `Each ${input.workItemLabel} is a METRIC goal measured by a number. For each one, include a "targetValue" positive number estimating a reasonable monthly target. Do NOT include "taskPoints".`;

  return [
    `You are a project-planning assistant for an internal HR/work-management system.`,
    `You break a ${input.workUnitLabel} down into a hierarchy: a ${input.workUnitLabel} contains several "${input.subUnitLabel}" groups, and each "${input.subUnitLabel}" contains several "${input.workItemLabel}" items.`,
    modeGuidance,
    `Constraints: at most ${input.maxSubUnits ?? MAX_SUB_UNITS} "${input.subUnitLabel}" groups, and at most ${input.maxItemsPerSubUnit ?? MAX_ITEMS_PER_SUB_UNIT} "${input.workItemLabel}" items per group. Keep names short and concrete. Do not invent scope not implied by the brief.`,
    `Respond with a single JSON object ONLY (no prose, no markdown) of the exact shape:`,
    `{ "subUnits": [ { "name": string, "workItems": [ { "title": string${input.mode === WorkItemMode.atomic ? `, "taskPoints": number` : `, "targetValue": number`} } ] } ] }`,
  ].join("\n\n");
}

function buildUserPrompt(input: GenerateBreakdownInput): string {
  return [
    `${input.workUnitLabel} name: ${input.projectName}`,
    `${input.workUnitLabel} description / brief:`,
    input.description,
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
