import { syntaxTree } from '@codemirror/language';
import {
	EditorState,
	Prec,
	StateEffect,
	StateField,
	Text,
} from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	keymap,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import { Notice } from 'obsidian';
import type GhostPlugin from './main';
import { complete } from './providers';

/** The current inline suggestion: faded `text` shown starting at doc offset `from`. */
interface GhostState {
	from: number;
	text: string;
}

/** Sets (or clears, with `null`) the active suggestion. */
const setGhostEffect = StateEffect.define<GhostState | null>();

/**
 * Holds the current suggestion and reconciles it against edits:
 * - explicit effects win,
 * - typing text that matches the start of the ghost shrinks it live,
 * - any other edit or cursor move dismisses it.
 */
const ghostField = StateField.define<GhostState | null>({
	create: () => null,
	update(value, tr) {
		for (const e of tr.effects) {
			if (e.is(setGhostEffect)) return e.value;
		}
		if (!value) return null;

		let candidate: GhostState | null = value;

		if (tr.docChanged) {
			let consumed = '';
			let bail = false;
			tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted: Text) => {
				if (bail) return;
				// Only a pure insertion exactly at the ghost anchor can be consumed.
				if (fromA !== toA || fromA !== value.from) {
					bail = true;
					return;
				}
				consumed += inserted.toString();
			});
			if (bail) return null;

			if (consumed.length === 0) {
				candidate = { from: tr.changes.mapPos(value.from, 1), text: value.text };
			} else if (value.text.startsWith(consumed)) {
				const remaining = value.text.slice(consumed.length);
				candidate = remaining.length
					? { from: value.from + consumed.length, text: remaining }
					: null;
			} else {
				return null; // typed something the ghost didn't predict
			}
		}

		// A cursor move away from the anchor (e.g. click/arrow) dismisses it.
		if (candidate && tr.selection) {
			const head = tr.selection.main;
			if (!head.empty || head.head !== candidate.from) return null;
		}
		return candidate;
	},
	provide: (field) =>
		EditorView.decorations.from(field, (value) => {
			if (!value || !value.text) return Decoration.none;
			const deco = Decoration.widget({
				widget: new GhostWidget(value.text),
				side: 1,
			});
			return Decoration.set([deco.range(value.from)]);
		}),
});

class GhostWidget extends WidgetType {
	constructor(readonly text: string) {
		super();
	}
	eq(other: GhostWidget): boolean {
		return other.text === this.text;
	}
	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className = 'cm-ghost-text';
		if (this.text.includes('\n')) span.classList.add('cm-ghost-text-multiline');
		span.textContent = this.text;
		return span;
	}
	ignoreEvent(): boolean {
		return true;
	}
}

// ---------------------------------------------------------------------------
// Per-editor request lifecycle (debounce, abort, streaming)
// ---------------------------------------------------------------------------

const managers = new WeakMap<EditorView, GhostManager>();

/** Look up the manager driving suggestions for a given editor view. */
export function getManager(view: EditorView): GhostManager | undefined {
	return managers.get(view);
}

class GhostManager {
	private timer: number | null = null;
	private controller: AbortController | null = null;

	constructor(
		private readonly view: EditorView,
		private readonly plugin: GhostPlugin,
	) {
		managers.set(view, this);
	}

	update(u: ViewUpdate): void {
		const s = this.plugin.settings;
		const userTyped = u.transactions.some(
			(tr) => tr.isUserEvent('input') || tr.isUserEvent('delete'),
		);
		if (userTyped) {
			// Any in-flight suggestion is now stale; restart the idle timer.
			this.abortRequest();
			if (s.enabled && s.autoTrigger) this.schedule();
			return;
		}
		// Cursor moved by click/arrow (no edit): cancel pending/in-flight work.
		if (u.selectionSet && !u.docChanged) {
			this.cancelTimer();
			this.abortRequest();
		}
	}

	destroy(): void {
		this.cancelTimer();
		this.abortRequest();
		managers.delete(this.view);
	}

	private schedule(): void {
		this.cancelTimer();
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.request(false);
		}, this.plugin.settings.debounceMs);
	}

	private cancelTimer(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private abortRequest(): void {
		if (this.controller) {
			this.controller.abort();
			this.controller = null;
		}
	}

	/** Request a suggestion. `manual` bypasses the idle/code-block gating. */
	async request(manual: boolean): Promise<void> {
		const view = this.view;
		const s = this.plugin.settings;
		if (!s.enabled) return;

		const sel = view.state.selection.main;
		if (!sel.empty) return;
		const pos = sel.head;

		if (!manual && !isEligible(view.state, s)) return;

		const { prompt, contextText } = buildPrompt(view.state, this.plugin, pos);
		if (!manual && contextText.trim().length < s.minContextChars) return;

		this.cancelTimer();
		this.abortRequest();
		const controller = new AbortController();
		this.controller = controller;

		let acc = '';
		try {
			const result = await complete(s, {
				system: s.systemPrompt,
				prompt,
				signal: controller.signal,
				onToken: s.streaming
					? (chunk) => {
							if (controller.signal.aborted) return;
							acc += chunk;
							const clean = cleanCompletion(acc);
							if (clean) this.setGhost(pos, clean);
						}
					: undefined,
			});
			if (controller.signal.aborted) return;
			const clean = cleanCompletion(result);
			if (clean) this.setGhost(pos, clean);
			else {
				this.clearGhost();
				if (manual) new Notice('Ghost: model returned no suggestion.');
			}
		} catch (e) {
			if (controller.signal.aborted) return;
			const msg = e instanceof Error ? e.message : String(e);
			console.error('Ghost request failed:', e);
			if (manual) new Notice(`Ghost: ${msg}`);
		} finally {
			if (this.controller === controller) this.controller = null;
		}
	}

	private setGhost(pos: number, text: string): void {
		// Only show if the cursor is still exactly where we asked from.
		const sel = this.view.state.selection.main;
		if (!sel.empty || sel.head !== pos) return;
		this.view.dispatch({ effects: setGhostEffect.of({ from: pos, text }) });
	}

	private clearGhost(): void {
		if (this.view.state.field(ghostField, false)) {
			this.view.dispatch({ effects: setGhostEffect.of(null) });
		}
	}
}

// ---------------------------------------------------------------------------
// Accept / dismiss actions (called from keymap and commands)
// ---------------------------------------------------------------------------

function currentGhost(view: EditorView): GhostState | null {
	return view.state.field(ghostField, false) ?? null;
}

/** Insert a leading portion of the ghost and keep the remainder showing. */
function insertPortion(view: EditorView, g: GhostState, take: number): boolean {
	const part = g.text.slice(0, take);
	const rest = g.text.slice(take);
	view.dispatch({
		changes: { from: g.from, insert: part },
		selection: { anchor: g.from + part.length },
		effects: setGhostEffect.of(
			rest ? { from: g.from + part.length, text: rest } : null,
		),
		scrollIntoView: true,
	});
	return true;
}

/** Accept the whole suggestion. */
export function acceptGhost(view: EditorView): boolean {
	const g = currentGhost(view);
	if (!g) return false;
	return insertPortion(view, g, g.text.length);
}

/** Accept the next word (leading whitespace + one token). */
export function acceptGhostWord(view: EditorView): boolean {
	const g = currentGhost(view);
	if (!g) return false;
	const m = /^\s*\S+/.exec(g.text);
	const take = m ? m[0].length : g.text.length;
	return insertPortion(view, g, take);
}

/** Accept up to and including the next line break (or the rest if none). */
export function acceptGhostLine(view: EditorView): boolean {
	const g = currentGhost(view);
	if (!g) return false;
	const nl = g.text.indexOf('\n');
	const take = nl === -1 ? g.text.length : nl + 1;
	return insertPortion(view, g, take);
}

/** Dismiss the current suggestion without inserting anything. */
export function dismissGhost(view: EditorView): boolean {
	if (!currentGhost(view)) return false;
	view.dispatch({ effects: setGhostEffect.of(null) });
	return true;
}

// ---------------------------------------------------------------------------
// Context building & eligibility
// ---------------------------------------------------------------------------

/** Decide whether auto-suggesting is appropriate at the cursor. */
function isEligible(state: EditorState, s: GhostPlugin['settings']): boolean {
	const pos = state.selection.main.head;
	const { inCode, inMath } = contextKind(state, pos);
	if (inCode && !s.triggerInCode) return false;
	if (inMath && !s.triggerInMath) return false;
	return true;
}

/** Inspect the syntax tree around the cursor for code/math/frontmatter context. */
function contextKind(
	state: EditorState,
	pos: number,
): { inCode: boolean; inMath: boolean } {
	let inCode = false;
	let inMath = false;
	const tree = syntaxTree(state);
	let node = tree.resolveInner(pos, -1) as ReturnType<
		typeof tree.resolveInner
	> | null;
	while (node) {
		const name = node.type.name.toLowerCase();
		if (name.includes('code') || name.includes('frontmatter')) inCode = true;
		if (name.includes('math')) inMath = true;
		node = node.parent;
	}
	return { inCode, inMath };
}

/**
 * Build the model prompt from the current section: text from the nearest
 * heading above the cursor down to the cursor, plus note title and heading.
 */
function buildPrompt(
	state: EditorState,
	plugin: GhostPlugin,
	pos: number,
): { prompt: string; contextText: string } {
	const { heading, text } = currentSection(
		state,
		pos,
		plugin.settings.maxContextChars,
	);
	const file = plugin.app.workspace.getActiveFile();
	const title = file ? file.basename : 'Untitled';

	const lines: string[] = [`Note title: "${title}".`];
	if (heading) lines.push(`Current section: "${heading}".`);
	lines.push('');
	lines.push(
		'Continue the following Markdown text from exactly where it ends. Do not repeat any of it.',
	);
	lines.push('');
	lines.push(text);

	return { prompt: lines.join('\n'), contextText: text };
}

/** Section = from the nearest heading at/above the cursor down to the cursor. */
function currentSection(
	state: EditorState,
	pos: number,
	maxChars: number,
): { heading: string; text: string } {
	const doc = state.doc;
	const curLine = doc.lineAt(pos);
	let heading = '';
	let sectionStart = 0;
	for (let n = curLine.number; n >= 1; n--) {
		const line = doc.line(n);
		const m = /^#{1,6}\s+(.*)$/.exec(line.text);
		if (m) {
			heading = (m[1] ?? '').trim();
			sectionStart = line.from;
			break;
		}
	}
	let text = doc.sliceString(sectionStart, pos);
	if (text.length > maxChars) text = text.slice(text.length - maxChars);
	return { heading, text };
}

/** Strip a code fence the model may have wrapped the completion in. */
function cleanCompletion(text: string): string {
	const trimmed = text.trim();
	const fence = /^```[a-zA-Z0-9]*\n([\s\S]*?)\n?```$/.exec(trimmed);
	if (fence) return fence[1] ?? '';
	return text;
}

// ---------------------------------------------------------------------------
// Extension assembly
// ---------------------------------------------------------------------------

const ghostKeymap = Prec.highest(
	keymap.of([
		{ key: 'Tab', run: acceptGhost },
		{ key: 'Escape', run: dismissGhost },
		{ key: 'Mod-ArrowRight', run: acceptGhostWord },
	]),
);

/** The full CodeMirror extension to register from the plugin. */
export function ghostExtension(plugin: GhostPlugin): [
	StateField<GhostState | null>,
	typeof ghostKeymap,
	ViewPlugin<GhostManager>,
] {
	const trigger = ViewPlugin.define(
		(view) => new GhostManager(view, plugin),
	);
	return [ghostField, ghostKeymap, trigger];
}
