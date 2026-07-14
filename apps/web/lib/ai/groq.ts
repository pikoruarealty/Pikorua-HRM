// Track B — LLM infrastructure (added 2026-07-14, feature: AI task generation).
//
// Thin wrapper over Groq's OpenAI-compatible Chat Completions API. Uses the
// global `fetch` (Node 18+ / Next.js runtime) so no SDK dependency is added —
// keeps `apps/web/package.json` (a shared file) untouched.
//
// Config via env (see .env.example):
//   GROQ_API_KEY  — required; the Groq API key.
//   GROQ_MODEL    — optional; defaults to a current Groq-hosted model below.

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_TIMEOUT_MS = 30_000;

/** Thrown on any Groq call failure (missing key, HTTP error, empty/invalid body). */
export class GroqError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GroqError";
  }
}

export type GroqChatOptions = {
  system: string;
  user: string;
  /** Overrides GROQ_MODEL / the built-in default. */
  model?: string;
  temperature?: number;
  /** When true, ask Groq to constrain output to a single JSON object. */
  json?: boolean;
  timeoutMs?: number;
};

/**
 * Run a single-turn chat completion and return the raw assistant message
 * content string. Callers are responsible for parsing/validating the content
 * (see `json: true` to request JSON-object mode).
 */
export async function groqChat(opts: GroqChatOptions): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new GroqError("GROQ_API_KEY is not configured on the server.");
  }
  const model = opts.model ?? process.env.GROQ_MODEL ?? DEFAULT_MODEL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.4,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GroqError("Groq request timed out.");
    }
    throw new GroqError(`Groq request failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GroqError(`Groq API error ${res.status}: ${detail.slice(0, 500)}`, res.status);
  }

  const payload = (await res.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: unknown } }> }
    | null;
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new GroqError("Groq returned an empty response.");
  }
  return content;
}
