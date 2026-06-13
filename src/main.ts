import { Editor, Notice, Plugin } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { DEFAULT_SETTINGS, GhostSettings, GhostSettingTab } from './settings';
import {
	acceptGhost,
	acceptGhostLine,
	acceptGhostWord,
	dismissGhost,
	getManager,
	ghostExtension,
} from './ghost';

export default class GhostPlugin extends Plugin {
	settings!: GhostSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerEditorExtension(ghostExtension(this));
		this.addSettingTab(new GhostSettingTab(this.app, this));

		this.addCommand({
			id: 'trigger',
			name: 'Trigger suggestion',
			editorCallback: (editor) => {
				const view = cmOf(editor);
				if (view) void getManager(view)?.request(true);
			},
		});

		this.addCommand({
			id: 'accept',
			name: 'Accept suggestion',
			editorCallback: (editor) => withView(editor, acceptGhost),
		});

		this.addCommand({
			id: 'accept-word',
			name: 'Accept next word',
			editorCallback: (editor) => withView(editor, acceptGhostWord),
		});

		this.addCommand({
			id: 'accept-line',
			name: 'Accept next line',
			editorCallback: (editor) => withView(editor, acceptGhostLine),
		});

		this.addCommand({
			id: 'dismiss',
			name: 'Dismiss suggestion',
			editorCallback: (editor) => withView(editor, dismissGhost),
		});

		this.addCommand({
			id: 'regenerate',
			name: 'Regenerate suggestion',
			editorCallback: (editor) => {
				const view = cmOf(editor);
				if (!view) return;
				dismissGhost(view);
				void getManager(view)?.request(true);
			},
		});

		this.addCommand({
			id: 'toggle',
			name: 'Toggle Ghost on/off',
			callback: async () => {
				this.settings.enabled = !this.settings.enabled;
				await this.saveSettings();
				new Notice(`Ghost ${this.settings.enabled ? 'enabled' : 'disabled'}`);
			},
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

/** Obsidian's `Editor` wraps a CodeMirror 6 `EditorView` on `.cm`. */
function cmOf(editor: Editor): EditorView | null {
	return (editor as unknown as { cm?: EditorView }).cm ?? null;
}

/** Run a ghost action against the editor's underlying CodeMirror view. */
function withView(editor: Editor, action: (view: EditorView) => boolean): void {
	const view = cmOf(editor);
	if (view) action(view);
}
