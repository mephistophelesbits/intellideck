import { computeNumCtx } from '@/lib/ai/ollama-utils';
import { createCircuitBreaker } from '@/lib/ai/circuit-breaker';

// Backstop so a hung provider connection can never stall a route forever. Kept
// well above normal latency (a 12B summary on the M4 is ~40s) but low enough that
// a wedged runner fails fast instead of freezing the serialized enrichment queue
// for minutes per call (it used to be 300s).
const AI_REQUEST_TIMEOUT_MS = 120_000;

// Self-hosted Ollama can go unhealthy in ways that aren't a clean error: a hung
// runner, or a model that returns empty output via /api/generate (e.g. `gemma4`).
// The breaker trips after several consecutive failures and short-circuits further
// calls for a cooldown, so enrichment drains via deterministic fallbacks and
// recovers automatically once Ollama is healthy again.
export const ollamaBreaker = createCircuitBreaker({ failureThreshold: 4, cooldownMs: 30_000 });

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS) });
}

function requireText(text: unknown, provider: string): string {
    if (typeof text !== 'string') {
        throw new Error(`${provider} returned an unexpected response shape`);
    }
    return text;
}

export type AIProvider = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'minimax' | 'kimi' | 'nvidia';

export interface AIResponse {
    text: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export interface AIChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface AIRequestOptions {
    model: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
    /** Override the computed Ollama context window. Use for output-heavy calls
     *  (e.g. entity extraction) where the response is much larger than the prompt. */
    numCtx?: number;
}

export async function generateText(
    provider: AIProvider,
    prompt: string,
    options: AIRequestOptions
): Promise<AIResponse> {
    switch (provider) {
        case 'openai':
            return await generateOpenAI(prompt, options);
        case 'ollama':
            return await generateOllama(prompt, options);
        case 'anthropic':
            return await generateAnthropic(prompt, options);
        case 'gemini':
            return await generateGemini(prompt, options);
        case 'minimax':
            return await generateMinimax(prompt, options);
        case 'kimi':
            return await generateKimi(prompt, options);
        case 'nvidia':
            return await generateNvidia(prompt, options);
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}

async function generateOllama(prompt: string, options: AIRequestOptions): Promise<AIResponse> {
    const baseUrl = options.baseUrl || 'http://localhost:11434';
    const numCtx = options.numCtx ?? computeNumCtx(prompt);

    // Short-circuit while the breaker is open so a known-bad Ollama doesn't make
    // every queued call wait for the timeout.
    if (!ollamaBreaker.shouldAllow()) {
        throw new Error('Ollama unavailable (circuit breaker open after repeated failures)');
    }

    try {
        const response = await fetchWithTimeout(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: options.model,
                prompt: prompt,
                stream: false,
                options: {
                    temperature: options.temperature ?? 0.7,
                    num_predict: options.maxTokens,
                    num_ctx: numCtx,
                }
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Ollama error: ${error}`);
        }

        const data = await response.json();
        const text = requireText(data.response, 'Ollama');
        // Treat empty/whitespace output as a failure: some models (notably the
        // `gemma4` family) return "" via /api/generate on real prompts. Throwing
        // here lets callers fall back instead of persisting an empty result.
        if (!text.trim()) {
            throw new Error('Ollama returned an empty response (model may be incompatible with /api/generate)');
        }

        ollamaBreaker.recordSuccess();
        return { text };
    } catch (error) {
        ollamaBreaker.recordFailure();
        throw error;
    }
}

export async function embedText(
    provider: AIProvider,
    text: string,
    options: AIRequestOptions
): Promise<number[]> {
    switch (provider) {
        case 'ollama':
            return await embedOllama(text, options);
        default:
            throw new Error(`Embeddings not supported for provider: ${provider}`);
    }
}

/**
 * Embed many texts in ONE Ollama `/api/embed` round-trip (the endpoint accepts an `input`
 * array). Collapsing N serial requests into one is the big lever for draining an embedding
 * backlog — per-request + network overhead dominates, not the tiny embed model itself.
 *
 * Best-effort and robust: on a batch failure (e.g. one oversized input rejects the whole
 * call) it falls back to per-item `embedText` (which has shrink-and-retry), returning null
 * for any item that still fails so one bad article cannot sink the batch.
 */
export async function embedTextBatch(
    provider: AIProvider,
    texts: string[],
    options: AIRequestOptions,
): Promise<(number[] | null)[]> {
    if (provider !== 'ollama') throw new Error(`Embeddings not supported for provider: ${provider}`);
    if (texts.length === 0) return [];

    const baseUrl = options.baseUrl || 'http://localhost:11434';
    try {
        const response = await fetchWithTimeout(`${baseUrl}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: options.model, input: texts }),
        });
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        const embeddings = data.embeddings;
        if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
            throw new Error('Ollama batch embedding error: unexpected response shape');
        }
        return embeddings as number[][];
    } catch {
        // Per-item fallback: isolate failures so a single bad input doesn't fail the batch.
        return await Promise.all(
            texts.map((t) => embedText('ollama', t, options).catch(() => null)),
        );
    }
}

async function embedOllama(text: string, options: AIRequestOptions): Promise<number[]> {
    const baseUrl = options.baseUrl || 'http://localhost:11434';

    // Embedding models have a fixed, model-bound context (e.g. nomic-embed-text caps at
    // 2048 tokens; num_ctx cannot raise it). Token density varies with content and language,
    // so a fixed char cap is unreliable. Shrink-and-retry on the specific overflow error.
    let input = text;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await fetchWithTimeout(`${baseUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: options.model, prompt: input }),
        });

        if (response.ok) {
            const data = await response.json();
            const embedding = data.embedding;
            if (!Array.isArray(embedding) || embedding.some((n: unknown) => typeof n !== 'number')) {
                throw new Error('Ollama embedding error: unexpected response shape');
            }
            return embedding as number[];
        }

        const error = await response.text();
        if (error.includes('exceeds the context length') && input.length > 400) {
            input = input.slice(0, Math.floor(input.length * 0.6));
            continue;
        }
        throw new Error(`Ollama embedding error: ${error}`);
    }
    throw new Error('Ollama embedding error: input could not be reduced to fit the model context');
}

async function generateOpenAI(prompt: string, options: AIRequestOptions): Promise<AIResponse> {
    if (!options.apiKey) throw new Error('OpenAI API key is required');

    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
            model: options.model || 'gpt-4.1',
            messages: [{ role: 'user', content: prompt }],
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
        text: requireText(data.choices?.[0]?.message?.content, 'OpenAI'),
        usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
        }
    };
}

async function generateAnthropic(prompt: string, options: AIRequestOptions): Promise<AIResponse> {
    if (!options.apiKey) throw new Error('Anthropic API key is required');

    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: options.model || 'claude-sonnet-4-6',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: options.maxTokens || 1024,
            temperature: options.temperature ?? 0.7,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Anthropic error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
        text: requireText(data.content?.[0]?.text, 'Anthropic'),
        usage: {
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
            totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
        }
    };
}

async function generateGemini(prompt: string, options: AIRequestOptions): Promise<AIResponse> {
    if (!options.apiKey) throw new Error('Gemini API key is required');

    const model = options.model || 'gemini-3-pro-preview';
    const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': options.apiKey,
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: options.temperature ?? 0.7,
                maxOutputTokens: options.maxTokens,
            }
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Gemini error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
        text: requireText(data.candidates?.[0]?.content?.parts?.[0]?.text, 'Gemini'),
    };
}

async function generateMinimax(prompt: string, options: AIRequestOptions): Promise<AIResponse> {
    if (!options.apiKey) throw new Error('Minimax API key is required');

    const response = await fetchWithTimeout('https://api.minimax.io/v1/text/chatcompletion_v2', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
            model: options.model || 'MiniMax-M2.5',
            messages: [{ role: 'user', content: prompt }],
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Minimax error: ${error.base_resp?.status_msg || response.statusText}`);
    }

    const data = await response.json();
    return {
        text: requireText(data.choices?.[0]?.message?.content, 'AI provider'),
        usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
        }
    };
}

async function generateKimi(prompt: string, options: AIRequestOptions): Promise<AIResponse> {
    if (!options.apiKey) throw new Error('Kimi API key is required');

    const response = await fetchWithTimeout('https://api.moonshot.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
            model: options.model || 'kimi-k2.5',
            messages: [{ role: 'user', content: prompt }],
            temperature: options.temperature ?? 0.6,
            max_tokens: options.maxTokens,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Kimi error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
        text: requireText(data.choices?.[0]?.message?.content, 'AI provider'),
        usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
        }
    };
}

export async function generateChat(
    provider: AIProvider,
    messages: AIChatMessage[],
    options: AIRequestOptions
): Promise<AIResponse> {
    switch (provider) {
        case 'openai':
            return await generateChatOpenAI(messages, options);
        case 'ollama':
            // For Ollama, we'll convert messages to a prompt since its /api/generate takes a prompt
            // Alternatively, we could use /api/chat but let's keep it simple for now
            return await generateChatOllama(messages, options);
        case 'anthropic':
            return await generateChatAnthropic(messages, options);
        case 'gemini':
            return await generateChatGemini(messages, options);
        case 'minimax':
            return await generateChatMinimax(messages, options);
        case 'kimi':
            return await generateChatKimi(messages, options);
        case 'nvidia':
            return await generateChatNvidia(messages, options);
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}

async function generateChatOpenAI(messages: AIChatMessage[], options: AIRequestOptions): Promise<AIResponse> {
    if (!options.apiKey) throw new Error('OpenAI API key is required');

    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
            model: options.model || 'gpt-4.1',
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
        text: requireText(data.choices?.[0]?.message?.content, 'OpenAI'),
        usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
        }
    };
}

async function generateChatOllama(messages: AIChatMessage[], options: AIRequestOptions): Promise<AIResponse> {
    const baseUrl = options.baseUrl || 'http://localhost:11434';
    const promptEstimate = messages.map((m) => m.content).join('\n');
    const numCtx = computeNumCtx(promptEstimate);
    const response = await fetchWithTimeout(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: options.model,
            messages: messages,
            stream: false,
            options: {
                temperature: options.temperature ?? 0.7,
                num_ctx: numCtx,
            }
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama error: ${error}`);
    }

    const data = await response.json();
    return { text: requireText(data.message?.content, 'Ollama') };
}

async function generateChatAnthropic(messages: AIChatMessage[], options: AIRequestOptions): Promise<AIResponse> {
    if (!options.apiKey) throw new Error('Anthropic API key is required');

    const systemMessage = messages.find(m => m.role === 'system')?.content;
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: options.model || 'claude-sonnet-4-6',
            system: systemMessage,
            messages: chatMessages,
            max_tokens: options.maxTokens || 1024,
            temperature: options.temperature ?? 0.7,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Anthropic error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
        text: requireText(data.content?.[0]?.text, 'Anthropic'),
        usage: {
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
            totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
        }
    };
}

async function generateChatGemini(messages: AIChatMessage[], options: AIRequestOptions): Promise<AIResponse> {
    if (!options.apiKey) throw new Error('Gemini API key is required');

    const model = options.model || 'gemini-3-pro-preview';

    // Convert OpenAI-style messages to Gemini style
    const contents = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
    }));

    const systemInstruction = messages.find(m => m.role === 'system')?.content;

    const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': options.apiKey,
        },
        body: JSON.stringify({
            contents,
            system_instruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
            generationConfig: {
                temperature: options.temperature ?? 0.7,
                maxOutputTokens: options.maxTokens,
            }
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Gemini error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
        text: requireText(data.candidates?.[0]?.content?.parts?.[0]?.text, 'Gemini'),
    };
}

async function generateChatMinimax(messages: AIChatMessage[], options: AIRequestOptions): Promise<AIResponse> {
    if (!options.apiKey) throw new Error('Minimax API key is required');

    const response = await fetchWithTimeout('https://api.minimax.io/v1/text/chatcompletion_v2', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
            model: options.model || 'MiniMax-M2.5',
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Minimax error: ${error.base_resp?.status_msg || response.statusText}`);
    }

    const data = await response.json();
    return {
        text: requireText(data.choices?.[0]?.message?.content, 'AI provider'),
        usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
        }
    };
}

async function generateNvidia(prompt: string, options: AIRequestOptions): Promise<AIResponse> {
    return generateChatNvidia([{ role: 'user', content: prompt }], options);
}

async function generateChatNvidia(messages: AIChatMessage[], options: AIRequestOptions): Promise<AIResponse> {
    if (!options.apiKey) throw new Error('NVIDIA API key is required');

    const response = await fetchWithTimeout('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
            model: options.model || 'google/gemma-4-31b-it',
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens || 16384,
            top_p: 0.95,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`NVIDIA error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
        text: requireText(data.choices?.[0]?.message?.content, 'AI provider'),
        usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
        }
    };
}

async function generateChatKimi(messages: AIChatMessage[], options: AIRequestOptions): Promise<AIResponse> {
    if (!options.apiKey) throw new Error('Kimi API key is required');

    const response = await fetchWithTimeout('https://api.moonshot.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
            model: options.model || 'kimi-k2.5',
            messages,
            temperature: options.temperature ?? 0.6,
            max_tokens: options.maxTokens,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Kimi error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return {
        text: requireText(data.choices?.[0]?.message?.content, 'AI provider'),
        usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
        }
    };
}
