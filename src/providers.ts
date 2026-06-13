import { requestUrl } from 'obsidian';

export type ProviderType = 'openai' | 'anthropic' | 'ollama';

/**
 * The subset of plugin settings the provider layer needs in order to talk to a
 * model. `settings.ts` owns the full settings object and passes this through.
 */
export interface ProviderSettings {
	provider: ProviderType;

	// OpenAI-compatible (OpenAI, Groq, xAI, Together, Fireworks, LM Studio, etc.)
	openaiBaseUrl: string;
	openaiApiKey: string;
	openaiModel: string;

	// Anthropic Claude
	anthropicBaseUrl: string;
	anthropicApiKey: string;
	anthropicModel: string;

	// Ollama (local)
	ollamaBaseUrl: string;
	ollamaModel: string;

	streaming: boolean;
	maxTokens: number;
	temperature: number;
}

export interface CompletionRequest {
	/** System prompt describing the task. */
	system: string;
	/** The user prompt (note context + the text to continue). */
	prompt: string;
	/** Lets the caller cancel an in-flight request when the user keeps typing. */
	signal: AbortSignal;
	/** Called with each streamed text chunk. Only used when streaming is on. */
	onToken?: (text: string) => void;
}

/** Strip a trailing slash so we can safely concatenate paths. */
function trimSlash(url: string): string {
	return url.replace(/\/+$/, '');
}

/**
 * Run a completion against the configured provider and return the full text.
 * When `settings.streaming` is true and `req.onToken` is provided, chunks are
 * delivered incrementally as they arrive (and the full text is still returned).
 */
export async function complete(
	settings: ProviderSettings,
	req: CompletionRequest,
): Promise<string> {
	switch (settings.provider) {
		case 'anthropic':
			return completeAnthropic(settings, req);
		case 'ollama':
			return completeOllama(settings, req);
		case 'openai':
		default:
			return completeOpenAI(settings, req);
	}
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (/chat/completions)
// ---------------------------------------------------------------------------

async function completeOpenAI(
	s: ProviderSettings,
	req: CompletionRequest,
): Promise<string> {
	const url = `${trimSlash(s.openaiBaseUrl)}/chat/completions`;
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (s.openaiApiKey) headers['Authorization'] = `Bearer ${s.openaiApiKey}`;

	const body = {
		model: s.openaiModel,
		messages: [
			{ role: 'system', content: req.system },
			{ role: 'user', content: req.prompt },
		],
		max_tokens: s.maxTokens,
		temperature: s.temperature,
		stream: s.streaming,
	};

	if (s.streaming) {
		return streamSSE(url, headers, body, req, (json) => {
			const choice = json?.choices?.[0];
			return choice?.delta?.content ?? '';
		});
	}

	const json = await postJson(url, headers, body);
	return json?.choices?.[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// Anthropic (/v1/messages)
// ---------------------------------------------------------------------------

async function completeAnthropic(
	s: ProviderSettings,
	req: CompletionRequest,
): Promise<string> {
	const url = `${trimSlash(s.anthropicBaseUrl)}/v1/messages`;
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'x-api-key': s.anthropicApiKey,
		'anthropic-version': '2023-06-01',
		// Required for Anthropic to accept requests from a browser/Electron origin.
		'anthropic-dangerous-direct-browser-access': 'true',
	};

	const body = {
		model: s.anthropicModel,
		max_tokens: s.maxTokens,
		temperature: s.temperature,
		system: req.system,
		messages: [{ role: 'user', content: req.prompt }],
		stream: s.streaming,
	};

	if (s.streaming) {
		return streamSSE(url, headers, body, req, (json) => {
			if (json?.type === 'content_block_delta') {
				return json?.delta?.text ?? '';
			}
			return '';
		});
	}

	const json = await postJson(url, headers, body);
	if (Array.isArray(json?.content)) {
		return json.content
			.map((block: { text?: string }) => block?.text ?? '')
			.join('');
	}
	return '';
}

// ---------------------------------------------------------------------------
// Ollama (/api/chat, newline-delimited JSON stream)
// ---------------------------------------------------------------------------

async function completeOllama(
	s: ProviderSettings,
	req: CompletionRequest,
): Promise<string> {
	const url = `${trimSlash(s.ollamaBaseUrl)}/api/chat`;
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};

	const body = {
		model: s.ollamaModel,
		messages: [
			{ role: 'system', content: req.system },
			{ role: 'user', content: req.prompt },
		],
		stream: s.streaming,
		options: {
			temperature: s.temperature,
			num_predict: s.maxTokens,
		},
	};

	if (s.streaming) {
		return streamNDJSON(url, headers, body, req, (json) => {
			return json?.message?.content ?? '';
		});
	}

	const json = await postJson(url, headers, body);
	return json?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

/**
 * Non-streaming POST via Obsidian's `requestUrl`, which bypasses CORS. Used
 * when streaming is disabled (the most reliable path across providers).
 */
async function postJson(
	url: string,
	headers: Record<string, string>,
	body: unknown,
): Promise<any> {
	const res = await requestUrl({
		url,
		method: 'POST',
		headers,
		body: JSON.stringify(body),
		throw: false,
	});
	if (res.status >= 400) {
		throw new Error(`HTTP ${res.status}: ${truncate(res.text)}`);
	}
	return res.json;
}

/** Read a Server-Sent-Events (`data: {...}`) stream from an OpenAI/Anthropic endpoint. */
async function streamSSE(
	url: string,
	headers: Record<string, string>,
	body: unknown,
	req: CompletionRequest,
	extract: (json: any) => string,
): Promise<string> {
	const reader = await openStream(url, headers, body, req.signal);
	const decoder = new TextDecoder();
	let buffer = '';
	let full = '';

	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		// SSE events are separated by blank lines; process complete lines.
		let nl: number;
		while ((nl = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (!line.startsWith('data:')) continue;
			const data = line.slice(5).trim();
			if (data === '' || data === '[DONE]') continue;
			let json: any;
			try {
				json = JSON.parse(data);
			} catch {
				continue;
			}
			const chunk = extract(json);
			if (chunk) {
				full += chunk;
				req.onToken?.(chunk);
			}
		}
	}
	return full;
}

/** Read a newline-delimited JSON stream (Ollama's native format). */
async function streamNDJSON(
	url: string,
	headers: Record<string, string>,
	body: unknown,
	req: CompletionRequest,
	extract: (json: any) => string,
): Promise<string> {
	const reader = await openStream(url, headers, body, req.signal);
	const decoder = new TextDecoder();
	let buffer = '';
	let full = '';

	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		let nl: number;
		while ((nl = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (!line) continue;
			let json: any;
			try {
				json = JSON.parse(line);
			} catch {
				continue;
			}
			const chunk = extract(json);
			if (chunk) {
				full += chunk;
				req.onToken?.(chunk);
			}
		}
	}
	return full;
}

/** Open a streaming `fetch` and return its body reader, with error surfacing. */
async function openStream(
	url: string,
	headers: Record<string, string>,
	body: unknown,
	signal: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
	const res = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
		signal,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`HTTP ${res.status}: ${truncate(text)}`);
	}
	if (!res.body) {
		throw new Error('Streaming not supported by this endpoint (empty body).');
	}
	return res.body.getReader();
}

function truncate(text: string, max = 300): string {
	if (!text) return '(no response body)';
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Send a tiny prompt to verify credentials/connectivity. Returns latency and a
 * short sample of the model's reply, or throws with a readable error. Always
 * uses the non-streaming path so it works regardless of the streaming setting.
 */
export async function testConnection(
	settings: ProviderSettings,
): Promise<{ latencyMs: number; sample: string }> {
	const controller = new AbortController();
	const start = Date.now();
	const text = await complete(
		{ ...settings, streaming: false, maxTokens: 32, temperature: 0 },
		{
			system: 'You are a helpful assistant. Reply with a very short greeting.',
			prompt: 'Say hello in five words or fewer.',
			signal: controller.signal,
		},
	);
	return { latencyMs: Date.now() - start, sample: text.trim() };
}
