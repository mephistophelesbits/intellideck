import 'server-only';

import { generateText, type AIProvider } from '@/lib/ai/providers';
import { computeNumCtx } from '@/lib/ai/ollama-utils';

const OLLAMA_CTX_CAP = 8192;

/** Remove <think>...</think> reasoning blocks some models emit, and trim. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** The subset of AI settings every LLM call site needs. */
export interface LLMSettings {
  provider: AIProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface RunLLMOptions {
  temperature?: number;
  /**
   * When set, num_ctx = min(8192, computeNumCtx(prompt) + outputBudget) — sizes the
   * Ollama context to fit the prompt plus room for the response. Omit to let the model
   * use its default context window.
   */
  outputBudget?: number;
  /**
   * Hard cap on generated tokens (Ollama `num_predict`). Without this the model can
   * generate until it emits a stop token — a chatty model turns a one-word answer into
   * a multi-second ramble. Set this on high-volume calls with a bounded response shape
   * (e.g. a YES/NO or a small JSON array). Omit on open-ended generation (summaries,
   * synthesis, drafts).
   */
  maxTokens?: number;
  /** Strip <think>...</think> blocks from the response before returning. */
  stripThink?: boolean;
}

/**
 * Single entry point for one-shot LLM calls: unpacks settings, sizes num_ctx, and
 * optionally strips reasoning. Returns the response text.
 */
export async function runLLM(
  settings: LLMSettings,
  prompt: string,
  options: RunLLMOptions = {},
): Promise<string> {
  const { text } = await generateText(settings.provider, prompt, {
    model: settings.model,
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    numCtx:
      options.outputBudget === undefined
        ? undefined
        : Math.min(OLLAMA_CTX_CAP, computeNumCtx(prompt) + options.outputBudget),
  });
  return options.stripThink ? stripThinking(text) : text;
}
