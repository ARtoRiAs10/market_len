/**
 * OpenRouter model catalogue.
 *
 * Kept out of the route handler because Next.js route files may only export
 * HTTP verbs (GET/POST/…) — a shared module is the right home for data that
 * both the API and the UI need.
 */

export interface OpenRouterModel {
  id: string;
  label: string;
}

export const OPENROUTER_MODELS: OpenRouterModel[] = [
  { id: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6 (Anthropic)" },
  { id: "openai/gpt-4o", label: "GPT-4o (OpenAI)" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini (OpenAI)" },
  { id: "google/gemini-pro-1.5", label: "Gemini Pro 1.5 (Google)" },
  { id: "mistralai/mistral-large", label: "Mistral Large" },
  { id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B (Meta)" },
  { id: "deepseek/deepseek-r1", label: "DeepSeek R1" },
  { id: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B" },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", label: "nvidia/nemotron" },
  { id: "openrouter/free", label: "openrouter/free" },
];

/** The default model used when the caller does not pick one. */
export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-opus-4-6";
