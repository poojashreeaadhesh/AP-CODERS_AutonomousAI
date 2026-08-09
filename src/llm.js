import Anthropic from "@anthropic-ai/sdk";
import { jsonRepairPrompt } from "./prompts.js";

const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_MAX_TOKENS = 1200;
const DEFAULT_RETRY_BASE_MS = 400;

let testClient = null;

class ModelValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelValidationError";
  }
}

export function getLlmModel() {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

export function isLlmEnabled() {
  if (process.env.LLM_ENABLED === "false") return false;
  return Boolean(testClient || process.env.ANTHROPIC_API_KEY);
}

export function setLlmClientForTests(client) {
  testClient = client;
}

export function resetLlmClientForTests() {
  testClient = null;
}

function createClient() {
  if (testClient) return testClient;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt) {
  const base = Number(process.env.LLM_RETRY_BASE_MS ?? DEFAULT_RETRY_BASE_MS);
  const safeBase = Number.isFinite(base) && base >= 0 ? base : DEFAULT_RETRY_BASE_MS;
  return safeBase * 2 ** attempt;
}

function getTextFromResponse(response) {
  const content = response?.content || [];
  return content
    .map((part) => (part?.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractJsonObject(rawText) {
  const text = String(rawText || "").trim();
  if (!text) throw new Error("empty model response");

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("model response did not contain a JSON object");
    }
    return JSON.parse(text.slice(start, end + 1));
  }
}

function tokenUsage(response) {
  const input = response?.usage?.input_tokens || 0;
  const output = response?.usage?.output_tokens || 0;
  return input + output;
}

async function createMessage(prompt, { model, maxTokens }) {
  const client = createClient();
  return client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature: 0.4,
    system: "You are a careful autonomous editorial system. Return only valid JSON when asked.",
    messages: [{ role: "user", content: prompt }]
  });
}

function sanitizeError(error) {
  const status = error?.status ? `status ${error.status}` : "request failed";
  const keyPattern = new RegExp(`sk-${"ant"}-[a-zA-Z0-9_-]+`, "g");
  return `${status}: ${error?.message || "model call failed"}`.replace(keyPattern, "[redacted]");
}

export async function callClaudeJson({
  prompt,
  validate,
  model = getLlmModel(),
  maxTokens = DEFAULT_MAX_TOKENS,
  apiRetries = 2,
  validationRetries = 1
}) {
  if (!isLlmEnabled()) {
    throw new Error("LLM is disabled or ANTHROPIC_API_KEY is not set");
  }

  let lastError = null;
  let tokensUsed = 0;

  for (let attempt = 0; attempt <= apiRetries; attempt += 1) {
    try {
      const response = await createMessage(prompt, { model, maxTokens });
      tokensUsed += tokenUsage(response);
      const rawText = getTextFromResponse(response);

      try {
        const parsed = extractJsonObject(rawText);
        validate(parsed);
        return { value: parsed, model, tokensUsed, rawText };
      } catch (validationError) {
        lastError = validationError;

        let repairPrompt = prompt;
        let badOutput = rawText;
        for (let repairAttempt = 0; repairAttempt < validationRetries; repairAttempt += 1) {
          const responseAfterRepair = await createMessage(
            jsonRepairPrompt({
              originalPrompt: repairPrompt,
              badOutput,
              validationError: validationError.message
            }),
            { model, maxTokens }
          );
          tokensUsed += tokenUsage(responseAfterRepair);
          const repairedRaw = getTextFromResponse(responseAfterRepair);
          try {
            const repaired = extractJsonObject(repairedRaw);
            validate(repaired);
            return { value: repaired, model, tokensUsed, rawText: repairedRaw };
          } catch (repairError) {
            lastError = repairError;
            repairPrompt = prompt;
            badOutput = repairedRaw;
          }
        }

        throw new ModelValidationError(lastError.message);
      }
    } catch (error) {
      lastError = error;
      if (error instanceof ModelValidationError) break;
      if (attempt >= apiRetries) break;
      await sleep(retryDelayMs(attempt));
    }
  }

  throw new Error(sanitizeError(lastError));
}
