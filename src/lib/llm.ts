import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";

export type Provider = "groq" | "anthropic" | "none";

export interface LlmConfig {
  provider: Provider;
  model: string;
  maxInputTokens: number;
}

export function llmConfig(): LlmConfig {
  const pref = (process.env.LLM_PROVIDER || "").toLowerCase();
  const groqKey = process.env.GROQ_API_KEY?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const pick: Provider =
    pref === "anthropic" && anthropicKey ? "anthropic"
    : pref === "groq" && groqKey ? "groq"
    : groqKey ? "groq"
    : anthropicKey && anthropicKey !== "sk-ant-..." ? "anthropic"
    : "none";
  if (pick === "groq") {
    // Groq free tier allows ~8,000 tokens per request-minute (prompt + max output), so keep prompts small and chunk.
    return { provider: "groq", model: process.env.GROQ_MODEL || "openai/gpt-oss-120b", maxInputTokens: Number(process.env.LLM_MAX_INPUT_TOKENS) || 4300 };
  }
  if (pick === "anthropic") {
    return { provider: "anthropic", model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", maxInputTokens: Number(process.env.LLM_MAX_INPUT_TOKENS) || 60000 };
  }
  return { provider: "none", model: "none", maxInputTokens: 0 };
}

export class LlmError extends Error {
  constructor(
    public kind: "too_large" | "rate_limit" | "auth" | "invalid_json" | "network" | "not_configured" | "other",
    message: string,
  ) {
    super(message);
  }
}

export const estimateTokens = (s: string) => Math.ceil(s.length / 3.6);

/**
 * Wall-clock budget for the AI step. On Vercel's free plan a function may only run ~60s, so live reviews
 * stop the AI layer in time and report "partial" instead of being killed mid-way. 0 = no budget (local / scripts).
 */
export function aiTimeBudgetMs(): number {
  if (process.env.LLM_TIME_BUDGET_MS) return Number(process.env.LLM_TIME_BUDGET_MS);
  return process.env.VERCEL ? 48_000 : 0;
}
let deadline = 0;
export function setLlmDeadline(epochMs: number) {
  deadline = epochMs;
}
const remainingMs = () => (deadline ? deadline - Date.now() : Infinity);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function groqChat(cfg: LlmConfig, system: string, user: string, maxTokens: number): Promise<string> {
  const key = process.env.GROQ_API_KEY!.trim();
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.1,
          max_tokens: maxTokens,
          ...(/gpt-oss|qwen3/.test(cfg.model) ? { reasoning_effort: process.env.LLM_REASONING_EFFORT || "medium" } : {}),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
    } catch (e) {
      throw new LlmError("network", `Could not reach Groq: ${(e as Error).message}`);
    }
    if (res.ok) {
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? "";
    }
    const body = await res.text();
    if (res.status === 401 || res.status === 403) throw new LlmError("auth", "Groq rejected the API key (check GROQ_API_KEY in .env.local).");
    if (res.status === 413 || /context_length|too large|reduce the length|Request too large/i.test(body)) throw new LlmError("too_large", "Prompt too large for the model's limits.");
    if (res.status === 429) {
      const mins = body.match(/try again in (\d+)m([\d.]+)s/);
      const ra = Number(res.headers.get("retry-after")) || (mins ? +mins[1] * 60 + +mins[2] : Number(body.match(/try again in ([\d.]+)s/)?.[1])) || 8;
      if (/tokens per day|TPD/i.test(body)) throw new LlmError("rate_limit", "Groq daily token limit reached — try again later or use a paid tier.");
      if (attempt < 3 && ra <= 65 && ra * 1000 + 5000 < remainingMs()) {
        await sleep(Math.ceil(ra * 1000) + 500);
        continue;
      }
      throw new LlmError("rate_limit", `Groq rate limit reached (retry after ${ra}s).`);
    }
    if (res.status >= 500 && attempt < 2) {
      await sleep(2000);
      continue;
    }
    throw new LlmError("other", `Groq error ${res.status}: ${body.slice(0, 200)}`);
  }
  throw new LlmError("rate_limit", "Groq rate limit — retries exhausted.");
}

async function anthropicChat(cfg: LlmConfig, system: string, user: string, maxTokens: number): Promise<string> {
  // Explicit base URL so a shell-level ANTHROPIC_BASE_URL (e.g. a developer tool proxy) is never picked up.
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.APP_ANTHROPIC_BASE_URL || "https://api.anthropic.com" });
  try {
    const msg = await client.messages.create({
      model: cfg.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 401) throw new LlmError("auth", "Anthropic rejected the API key.");
    if (err.status === 429) throw new LlmError("rate_limit", "Anthropic rate limit.");
    if (err.status === 413) throw new LlmError("too_large", "Prompt too large.");
    throw new LlmError("other", `Anthropic error: ${err.message ?? e}`);
  }
}

function extractJson(s: string): unknown {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object");
  return JSON.parse(s.slice(start, end + 1));
}

/** One structured call: JSON out, zod-validated, retried once on invalid output, then fails visibly. */
export async function completeJson<T>(system: string, user: string, schema: ZodType<T>, maxTokens = 3000): Promise<{ data: T; model: string; provider: Provider }> {
  const cfg = llmConfig();
  if (cfg.provider === "none") throw new LlmError("not_configured", "No LLM API key configured.");
  const call = (u: string) => (cfg.provider === "groq" ? groqChat(cfg, system, u, maxTokens) : anthropicChat(cfg, system, u, maxTokens));
  let raw = await call(user);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = schema.safeParse(extractJson(raw));
      if (parsed.success) return { data: parsed.data, model: cfg.model, provider: cfg.provider };
      if (attempt === 1) throw new LlmError("invalid_json", `Model output failed validation: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      raw = await call(`${user}\n\nYour previous reply did not match the required JSON schema (${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}). Reply again with ONLY the corrected JSON object.`);
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (attempt === 1) throw new LlmError("invalid_json", "Model did not return valid JSON.");
      raw = await call(`${user}\n\nYour previous reply was not valid JSON. Reply with ONLY one JSON object.`);
    }
  }
  throw new LlmError("invalid_json", "Model did not return valid JSON.");
}
