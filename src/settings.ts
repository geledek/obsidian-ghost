import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type GhostPlugin from './main';
import { ProviderSettings, ProviderType, testConnection } from './providers';

/** Full persisted plugin settings (provider config + ghost-text behavior). */
export interface GhostSettings extends ProviderSettings {
	/** Master on/off for the plugin. */
	enabled: boolean;
	/** Auto-suggest after the user pauses typing. */
	autoTrigger: boolean;
	/** Idle time before an auto suggestion fires. */
	debounceMs: number;
	/** Minimum characters in the current section before auto-triggering. */
	minContextChars: number;
	/** How much section context (chars before the cursor) to send. */
	maxContextChars: number;
	/** Allow auto-triggering inside fenced code blocks. */
	triggerInCode: boolean;
	/** Allow auto-triggering inside math (`$...$` / `$$...$$`). */
	triggerInMath: boolean;
	/** System prompt steering the model's writing style. */
	systemPrompt: string;
}

export const DEFAULT_SYSTEM_PROMPT = [
	'You are an inline writing assistant embedded in the Obsidian Markdown editor.',
	"Continue the user's note naturally from exactly where their cursor is.",
	'Rules:',
	'- Output ONLY the continuation text. Do not repeat text that comes before the cursor.',
	'- Do not add explanations, quotes, or code fences around your answer.',
	'- Match the existing tone, voice, formatting, and Markdown style.',
	'- Keep it concise: a phrase, sentence, or at most a short paragraph.',
	'- If the cursor is mid-word or mid-sentence, continue seamlessly.',
].join('\n');

export const DEFAULT_SETTINGS: GhostSettings = {
	provider: 'openai',

	openaiBaseUrl: 'https://api.openai.com/v1',
	openaiApiKey: '',
	openaiModel: 'gpt-4o-mini',

	anthropicBaseUrl: 'https://api.anthropic.com',
	anthropicApiKey: '',
	anthropicModel: 'claude-3-5-haiku-20241022',

	ollamaBaseUrl: 'http://localhost:11434',
	ollamaModel: 'qwen2.5:7b',

	streaming: true,
	maxTokens: 160,
	temperature: 0.4,

	enabled: true,
	autoTrigger: true,
	debounceMs: 600,
	minContextChars: 2,
	maxContextChars: 2000,
	triggerInCode: false,
	triggerInMath: false,
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

/** Preset endpoints for popular OpenAI-compatible providers. */
const OPENAI_PRESETS: Record<string, { baseUrl: string; model: string }> = {
	OpenAI: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
	'Groq (fast, free tier)': {
		baseUrl: 'https://api.groq.com/openai/v1',
		model: 'llama-3.3-70b-versatile',
	},
	'xAI (Grok)': { baseUrl: 'https://api.x.ai/v1', model: 'grok-2-latest' },
	'Together.ai': {
		baseUrl: 'https://api.together.xyz/v1',
		model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
	},
	'LM Studio (local)': {
		baseUrl: 'http://localhost:1234/v1',
		model: 'local-model',
	},
};

export class GhostSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: GhostPlugin) {
		super(app, plugin);
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;

		new Setting(containerEl)
			.setName('Enable Ghost')
			.setDesc('Master switch for inline suggestions.')
			.addToggle((t) =>
				t.setValue(s.enabled).onChange(async (v) => {
					s.enabled = v;
					await this.save();
				}),
			);

		new Setting(containerEl).setName('Provider').setHeading();

		new Setting(containerEl)
			.setName('Model provider')
			.setDesc('Where completions come from.')
			.addDropdown((d) =>
				d
					.addOption('openai', 'OpenAI compatible')
					.addOption('anthropic', 'Anthropic (Claude)')
					.addOption('ollama', 'Ollama (local)')
					.setValue(s.provider)
					.onChange(async (v) => {
						s.provider = v as ProviderType;
						await this.save();
						this.display(); // re-render provider-specific section
					}),
			);

		switch (s.provider) {
			case 'anthropic':
				this.renderAnthropic(containerEl);
				break;
			case 'ollama':
				this.renderOllama(containerEl);
				break;
			default:
				this.renderOpenAI(containerEl);
		}

		this.renderTestConnection(containerEl);
		this.renderGeneration(containerEl);
		this.renderBehavior(containerEl);
		this.renderPrompt(containerEl);
	}

	private renderOpenAI(c: HTMLElement): void {
		const s = this.plugin.settings;

		new Setting(c)
			.setName('Preset')
			.setDesc('Fill in a known endpoint, then add your key.')
			.addDropdown((d) => {
				d.addOption('', 'Choose a preset…');
				for (const name of Object.keys(OPENAI_PRESETS)) d.addOption(name, name);
				d.setValue('').onChange(async (name) => {
					const preset = OPENAI_PRESETS[name];
					if (!preset) return;
					s.openaiBaseUrl = preset.baseUrl;
					s.openaiModel = preset.model;
					await this.save();
					this.display();
				});
			});

		new Setting(c).setName('Base URL').addText((t) =>
			t
				.setPlaceholder('https://api.openai.com/v1')
				.setValue(s.openaiBaseUrl)
				.onChange(async (v) => {
					s.openaiBaseUrl = v.trim();
					await this.save();
				}),
		);

		new Setting(c).setName('API key').addText((t) => {
			t.setPlaceholder('sk-…')
				.setValue(s.openaiApiKey)
				.onChange(async (v) => {
					s.openaiApiKey = v.trim();
					await this.save();
				});
			t.inputEl.type = 'password';
		});

		new Setting(c).setName('Model').addText((t) =>
			t
				.setPlaceholder('gpt-4o-mini')
				.setValue(s.openaiModel)
				.onChange(async (v) => {
					s.openaiModel = v.trim();
					await this.save();
				}),
		);
	}

	private renderAnthropic(c: HTMLElement): void {
		const s = this.plugin.settings;

		new Setting(c).setName('Base URL').addText((t) =>
			t
				.setPlaceholder('https://api.anthropic.com')
				.setValue(s.anthropicBaseUrl)
				.onChange(async (v) => {
					s.anthropicBaseUrl = v.trim();
					await this.save();
				}),
		);

		new Setting(c).setName('API key').addText((t) => {
			t.setPlaceholder('sk-ant-…')
				.setValue(s.anthropicApiKey)
				.onChange(async (v) => {
					s.anthropicApiKey = v.trim();
					await this.save();
				});
			t.inputEl.type = 'password';
		});

		new Setting(c)
			.setName('Model')
			.setDesc('e.g. claude-3-5-haiku-20241022 or claude-3-5-sonnet-20241022')
			.addText((t) =>
				t
					.setPlaceholder('claude-3-5-haiku-20241022')
					.setValue(s.anthropicModel)
					.onChange(async (v) => {
						s.anthropicModel = v.trim();
						await this.save();
					}),
			);
	}

	private renderOllama(c: HTMLElement): void {
		const s = this.plugin.settings;

		new Setting(c)
			.setName('Base URL')
			.setDesc('Default Ollama server address.')
			.addText((t) =>
				t
					.setPlaceholder('http://localhost:11434')
					.setValue(s.ollamaBaseUrl)
					.onChange(async (v) => {
						s.ollamaBaseUrl = v.trim();
						await this.save();
					}),
			);

		new Setting(c)
			.setName('Model')
			.setDesc('A model you have pulled, e.g. qwen2.5:7b, llama3.2, phi4.')
			.addText((t) =>
				t
					.setPlaceholder('qwen2.5:7b')
					.setValue(s.ollamaModel)
					.onChange(async (v) => {
						s.ollamaModel = v.trim();
						await this.save();
					}),
			);
	}

	private renderTestConnection(c: HTMLElement): void {
		const setting = new Setting(c)
			.setName('Test connection')
			.setDesc('Send a tiny prompt and report latency + a sample reply.');

		const result = setting.descEl.createDiv({ cls: 'ghost-status' });

		setting.addButton((b) =>
			b
				.setButtonText('Test')
				.setCta()
				.onClick(async () => {
					b.setDisabled(true).setButtonText('Testing…');
					result.setText('');
					try {
						const { latencyMs, sample } = await testConnection(
							this.plugin.settings,
						);
						result.setText(
							`✅ ${latencyMs} ms — “${sample.slice(0, 80)}”`,
						);
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						result.setText(`❌ ${msg}`);
						new Notice(`Ghost: connection failed — ${msg}`);
					} finally {
						b.setDisabled(false).setButtonText('Test');
					}
				}),
		);
	}

	private renderGeneration(c: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(c).setName('Generation').setHeading();

		new Setting(c)
			.setName('Stream tokens')
			.setDesc('Show the suggestion appearing token-by-token. Disable for the most CORS-proof path.')
			.addToggle((t) =>
				t.setValue(s.streaming).onChange(async (v) => {
					s.streaming = v;
					await this.save();
				}),
			);

		new Setting(c)
			.setName('Max tokens')
			.setDesc('Upper bound on suggestion length.')
			.addSlider((sl) =>
				sl
					.setLimits(32, 512, 16)
					.setValue(s.maxTokens)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.maxTokens = v;
						await this.save();
					}),
			);

		new Setting(c)
			.setName('Temperature')
			.setDesc('Higher = more creative, lower = more predictable.')
			.addSlider((sl) =>
				sl
					.setLimits(0, 1, 0.05)
					.setValue(s.temperature)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.temperature = v;
						await this.save();
					}),
			);
	}

	private renderBehavior(c: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(c).setName('Behavior').setHeading();

		new Setting(c)
			.setName('Auto-trigger on pause')
			.setDesc('Suggest automatically after you stop typing. If off, use the "Trigger suggestion" command/hotkey.')
			.addToggle((t) =>
				t.setValue(s.autoTrigger).onChange(async (v) => {
					s.autoTrigger = v;
					await this.save();
				}),
			);

		new Setting(c)
			.setName('Idle delay (ms)')
			.setDesc('How long to wait after typing stops before suggesting.')
			.addSlider((sl) =>
				sl
					.setLimits(200, 2000, 50)
					.setValue(s.debounceMs)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.debounceMs = v;
						await this.save();
					}),
			);

		new Setting(c)
			.setName('Context window (chars)')
			.setDesc('How much text before the cursor (from the current section) to send.')
			.addSlider((sl) =>
				sl
					.setLimits(500, 6000, 250)
					.setValue(s.maxContextChars)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.maxContextChars = v;
						await this.save();
					}),
			);

		new Setting(c)
			.setName('Suggest inside code blocks')
			.addToggle((t) =>
				t.setValue(s.triggerInCode).onChange(async (v) => {
					s.triggerInCode = v;
					await this.save();
				}),
			);

		new Setting(c).setName('Suggest inside math').addToggle((t) =>
			t.setValue(s.triggerInMath).onChange(async (v) => {
				s.triggerInMath = v;
				await this.save();
			}),
		);
	}

	private renderPrompt(c: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(c).setName('Prompt').setHeading();

		new Setting(c)
			.setName('System prompt')
			.setDesc('Steers the writing style. Leave blank to restore the default.')
			.addTextArea((t) => {
				t.setValue(s.systemPrompt)
					.setPlaceholder(DEFAULT_SYSTEM_PROMPT)
					.onChange(async (v) => {
						s.systemPrompt = v.trim() === '' ? DEFAULT_SYSTEM_PROMPT : v;
						await this.save();
					});
				t.inputEl.rows = 8;
				t.inputEl.style.width = '100%';
			});
	}
}
