# Ghostwrite v0.3.0 — Design Spec

**Date:** 2026-06-19
**Status:** Approved for implementation planning
**Owner:** Ray Han
**Repo (current):** `obsidian-ghost` → renaming to `obsidian-ghostwrite`
**Plugin id (current):** `ghost` → renaming to `ghostwrite`

---

## 1. Problem & positioning

The Obsidian inline-AI landscape splits sharply:

- **Chat / sidebar plugins** dominate installs but do not render inline ghost text: Logan's Copilot (~1.4M), Text Generator (~546k), Smart Composer (~159k), Smart Connections (5k+ stars).
- **Inline ghost-text plugins exist but are dead or invisible:** Companion (33k installs, last commit May 2024), j0rd1smit Auto-Completion (11k, last release March 2024), the active Auto-Completion Plus fork (2 stars), Daemon (pre-alpha, 0 stars).

Ghostwrite's defensible position:

> *The only Obsidian plugin that delivers Copilot-grade inline ghost text **with true fill-in-the-middle and vault-aware context**, for note-takers who want to write — not chat — with AI.*

The unkillable combo is **active maintenance + FIM + structural vault context + curated style presets + local-first**, simultaneously. No competitor has all five.

The three features that win:

1. **True FIM via Qwen2.5-Coder + Ollama `suffix` parameter.** Most "AI autocomplete" plugins prompt a chat model with the text before the cursor and ask it to continue. That works at end-of-paragraph; it breaks mid-paragraph. j0rd1smit/Plus simulate FIM via prompt engineering; Companion/Logan/Smart Composer skip it entirely. Ghostwrite calls Ollama's `/api/generate` with `prompt`+`suffix` and lets the model's registered FIM template do the work.
2. **Structural vault context (links + keyword search, no embeddings).** Smart Composer/Logan/Smart Connections do embedding RAG — heavyweight, slow to index, breaks on large vaults. Ghostwrite uses `metadataCache.resolvedLinks`, backlinks, and `prepareSimpleSearch` (Obsidian's BM25-ish). Zero indexing, instant on a 10k-note vault, runs offline. The honest answer for an inline product where you have ~200ms before users notice latency.
3. **Curated style presets.** Companion has manual save-current-settings bundles; Plus/j0rd1smit have only custom prompts; nobody ships a tuned persona library. Ghostwrite ships six well-tuned defaults — default / journal / meeting-notes / technical / fiction / academic — for a 5-minute install-to-magic experience.

This spec covers everything needed to ship v0.3.0 with all three plus mobile commands.

---

## 2. Scope

### In scope (v0.3.0)

- Rename plugin id, repo, manifest from `ghost` to `ghostwrite`.
- Fill-in-the-Middle for Ollama via allowlist of known-FIM models.
- Vault-aware context (structural: links + backlinks + keyword search).
- Six curated style presets with manual switcher.
- Three mobile commands (`mobileOnly: true`) for accept / accept-word / accept-line.
- Settings UI for all of the above.
- README rewrite with comparison table and "Why FIM matters" explainer.
- Vitest unit tests for the new pure-logic modules.

### Out of scope (explicit YAGNI; deferred to later cycles)

- Embedding-based vault search (Tier 2, future).
- Frontmatter / folder-based preset auto-detection.
- Inline accept-pill widget on mobile, floating `visualViewport` pill, swipe gestures.
- FIM auto-detection via `/api/show` probe.
- Anthropic / OpenAI FIM (those endpoints don't natively support `suffix`).
- Per-preset model / provider overrides (neither data shape nor UI in v0.3.0).
- Custom Modelfile `<|repo_name|>` / `<|file_sep|>` injection.
- Cross-vault context.
- Telemetry / analytics of any kind.

---

## 3. Architecture

The current architecture is three modules:

- `src/main.ts` — plugin entry, registers commands.
- `src/ghost.ts` — CodeMirror integration, request lifecycle, prompt building.
- `src/providers.ts` — HTTP calls per provider, returns text.
- `src/settings.ts` — UI + persisted settings.

v0.3.0 adds **three new modules** and modifies all four existing ones:

```
src/
  main.ts            ← register switcher + mobile commands; load presets;
                       gate vault-context on metadataCache 'resolved'
  ghost.ts           ← buildPrompt() consumes presets + suffix + vault context;
                       calls FIM-aware complete()
  providers.ts       ← add completeOllamaFIM(); CompletionRequest gains suffix;
                       supportsFim() allowlist
  settings.ts        ← presets list, activePresetId, vault context settings + UI
  presets.ts         ← NEW — built-in presets + resolution
  vault-context.ts   ← NEW — links/backlinks/keyword-search context block
  prompt-builder.ts  ← NEW — composeSystemPrompt(): canonical seam where preset +
                       length-hint + vault-context + title + heading meet
```

All three new files are pure logic (no Obsidian DOM, no CodeMirror). Easy to unit-test, easy to reason about.

---

## 4. Style presets

### 4.1 Data model (added to `settings.ts`)

```ts
export type CompletionLength = 'sentence' | 'line' | 'paragraph';

export interface StylePreset {
  id: string;                          // stable kebab-case
  name: string;                        // shown in UI
  systemPrompt: string;                // replaces global system prompt when active
  temperature?: number;                // optional override
  completionLength?: CompletionLength; // optional override
  useVaultContext?: boolean;           // optional override; if unset, falls through to settings.useVaultContext
  builtin?: boolean;                   // built-in presets are read-only in UI
}
```

`GhostSettings` adds:

```ts
activePresetId: string;       // default 'default'
userPresets: StylePreset[];   // user-added or user-edited (overrides for built-ins)
```

### 4.2 Built-in presets (live in `presets.ts`, not `data.json`)

| id | Name | Tuned for | `useVaultContext` |
|---|---|---|---|
| `default` | Default | General Markdown writing | (inherits global) |
| `journal` | Journal / Daily Notes | First-person reflection, casual, single sentence | (inherits global) |
| `meeting-notes` | Meeting Notes | Action items, decisions, terse bullet style | (inherits global) |
| `technical` | Technical Writing | Precise, structured, code-friendly | (inherits global) |
| `fiction` | Creative / Fiction | Narrative voice, descriptive, scene continuity | (inherits global) |
| `academic` | Academic | Formal, citation-aware tone | (inherits global) |

Built-ins live in code so plugin updates can ship prompt fixes. Persisting them to `data.json` would freeze them at install time.

None of the built-ins set `useVaultContext` at the preset level — they all fall through to the platform-aware global default (`!Platform.isMobile`, see §9). This keeps platform-specific behaviour out of preset definitions and preserves §6.7's mobile-opt-in intent regardless of the active preset. Per-preset opinions about vault context (e.g., off by default for `journal` / `fiction`) are surfaced as guidance text in the preset editor UI rather than baked-in field values. The `useVaultContext?: boolean` field on `StylePreset` remains available for user-authored presets that genuinely want to force the setting.

### 4.2.1 Built-in preset prompts

The full set of `BUILTIN_PRESETS` exported from `presets.ts`. The `systemPrompt` strings below are the v0.3.0 ship defaults; they are versioned with the plugin (not `data.json`) so we can revise them in subsequent releases without orphaning user data.

```ts
export const BUILTIN_PRESETS: StylePreset[] = [
  {
    id: 'default',
    name: 'Default',
    builtin: true,
    systemPrompt:
      'You are an inline writing assistant inside Obsidian. Continue the user\'s Markdown note in their voice. Output only the continuation — no preamble, no quotes, no explanation. Match the surrounding tone, vocabulary, and Markdown structure (lists stay lists, headings stay closed). Prefer concrete nouns and active verbs. Stop when the local thought is complete.',
    temperature: 0.4,
    completionLength: 'sentence',
  },
  {
    id: 'journal',
    name: 'Journal / Daily Notes',
    builtin: true,
    systemPrompt:
      'You are continuing a personal journal entry. Write in the first person, present or past tense as established. Casual, reflective, specific. Avoid generic affirmations ("It was a great day") and self-help platitudes. One concrete observation, feeling, or memory at a time.',
    temperature: 0.7,
    completionLength: 'sentence',
  },
  {
    id: 'meeting-notes',
    name: 'Meeting Notes',
    builtin: true,
    systemPrompt:
      'You are continuing meeting notes. Terse. Bullet-shaped where the surrounding text is bullets. Prefer action items ("- [ ] @owner: do X by date"), decisions ("Decided: …"), and open questions ("Q: …"). No prose paragraphs unless the surrounding text is already prose. Never invent attendees, dates, or numbers.',
    temperature: 0.3,
    completionLength: 'line',
  },
  {
    id: 'technical',
    name: 'Technical Writing',
    builtin: true,
    systemPrompt:
      'You are continuing technical documentation. Precise, structured, and code-aware. Preserve fenced code blocks, inline `code`, and Markdown tables exactly. Use the second person ("you") for instructions; declarative for reference. No marketing voice, no hedging adverbs ("simply", "just"). When extending a list of steps, keep the imperative parallel.',
    temperature: 0.3,
    completionLength: 'line',
  },
  {
    id: 'fiction',
    name: 'Creative / Fiction',
    builtin: true,
    systemPrompt:
      'You are continuing a work of fiction. Maintain the established narrator, tense, point of view, and scene. Show, don\'t tell — concrete sensory detail over abstraction. Preserve named characters, places, and continuity from the surrounding text. No meta-commentary, no chapter breaks unless one is clearly cued.',
    temperature: 0.85,
    completionLength: 'paragraph',
  },
  {
    id: 'academic',
    name: 'Academic',
    builtin: true,
    systemPrompt:
      'You are continuing academic prose. Formal register, hedged claims, citation-aware. Preserve `[@citekey]` / `[^footnote]` markers; do not fabricate citations. Avoid first-person where the surrounding text avoids it. Use precise discipline-appropriate vocabulary; do not paraphrase technical terms into colloquial ones.',
    temperature: 0.4,
    completionLength: 'sentence',
  },
];
```

`useVaultContext` is intentionally unset on every built-in (see §4.2). Tests in `presets.test.ts` assert on the exact `id` set, that all six are `builtin: true`, and that none of them carry a `useVaultContext` value.

### 4.3 Resolution

```
resolvePreset(settings) ->
  userPresets.find(id == activePresetId)
    ?? builtins.find(id == activePresetId)
    ?? builtins.find(id == 'default')   // last-resort fallback
```

Editing a built-in creates a `StylePreset` in `userPresets` with the same id. The user's override always wins.

### 4.4 Switcher UX

- Command **`Ghostwrite: Switch style`** opens a `FuzzySuggestModal` over all presets (built-ins + user). Selecting one writes `activePresetId` and saves settings.
- On preset switch (any platform), show a transient `new Notice('Preset: ${preset.name}')`. This is the only confirmation a mobile user gets that the switch took effect, and serves as the read-out of the active preset on mobile (since `addStatusBarItem()` is a no-op there).
- **Status bar item** on desktop shows the current preset name; clicking it opens the switcher. Wrap creation in a `Platform.isMobile` guard — `addStatusBarItem()`'s mobile behaviour is undocumented (the official type is non-nullable `HTMLElement`, but the docs only say "Not available on mobile"), and detached elements still receive `registerInterval` / `onclick` work. Concretely:

  ```ts
  if (!Platform.isMobile) {
    const el = this.addStatusBarItem();
    el.addClass('ghostwrite-status');
    el.setText(resolvePreset(this.settings).name);
    this.registerDomEvent(el, 'click', () => this.openSwitcher());
  }
  ```

  On mobile, users invoke the switcher via the command palette only.
- Settings tab has a "Presets" section listing all presets with a radio for active, an Edit button (built-ins open a "this creates an override" copy form), an Add Custom button, and a Delete (user presets only).

**Add Custom form fields:** **Name** (required, free text), **id** (auto-generated as kebab-case slug of Name on first blur; user-editable; must match `^[a-z0-9][a-z0-9-]*$`), **System prompt** (required, multiline), and optional **Temperature** / **Completion length** / **Use vault context** overrides matching the `StylePreset` shape from §4.1. Collision handling: if the entered id matches an existing entry in `userPresets`, reject with inline error "A preset with this id already exists"; if it matches a built-in id, treat the new preset as an override per §4.3 and warn inline ("This will override the built-in *Name* preset"). Save is disabled until Name, id (valid + non-colliding-or-confirmed-override), and System prompt are filled.

### 4.5 Prompt assembly

System-prompt assembly is the canonical seam where preset, length-hint, vault-context, note title, and current heading meet. It lives in `src/prompt-builder.ts` so both the chat path and the FIM path call exactly one function:

```ts
// src/prompt-builder.ts
export function composeSystemPrompt(args: {
  preset: StylePreset;
  length: CompletionLength;
  vaultBlock?: string;        // formatted Markdown from buildVaultContext, or empty
  noteTitle?: string;
  currentHeading?: string;
}): string {
  const { preset, length, vaultBlock, noteTitle, currentHeading } = args;
  let s = preset.systemPrompt + '\n\n' + SYSTEM_PROMPT_LENGTH_HINTS[length];
  if (vaultBlock && vaultBlock.length > 0) s += '\n\n' + vaultBlock;
  s += '\n\n' + `Note: "${noteTitle ?? ''}"`;
  if (currentHeading) s += '\n' + `Section: "${currentHeading}"`;
  return s;
}
```

Assembly order, fixed: `preset.systemPrompt` + `\n\n` + length-hint + (vault block, if any, with `\n\n` separator) + `\n\n` + `Note: "${title}"` + `\n` + `Section: "${heading}"`.

Double newline (paragraph break) is required between the preset prompt and the length hint so the hint reads as a separate instruction; a single `\n` would be a soft line break that concatenates onto the preset's last line. Note title and section heading sit at the tail because for FIM models, content closer to the prompt has more conditioning weight, and these are the lowest-priority steering signals — useful but not load-bearing.

```ts
// src/ghost.ts:buildPrompt (excerpt)
const preset = resolvePreset(settings);
const length = preset.completionLength ?? settings.completionLength;
const vault = useVaultCtx ? await buildVaultContext(...) : null;
const system = composeSystemPrompt({
  preset, length,
  vaultBlock: vault?.block,
  noteTitle: activeFile?.basename,
  currentHeading: detectCurrentHeading(editor),
});
```

`SYSTEM_PROMPT_LENGTH_HINTS` lives in `presets.ts` next to the built-in presets:

```ts
export const SYSTEM_PROMPT_LENGTH_HINTS: Record<CompletionLength, string> = {
  sentence:  '- Length: output exactly one sentence. Stop at sentence-final punctuation; do not start a second sentence.',
  line:      '- Length: complete the current line only. Do not insert a line break.',
  paragraph: '- Length: at most one short paragraph (2–4 sentences). Do not start a new paragraph after it.',
};
```

The hint strings are length-only by construction (no tone words like "concise", "terse", "brief") so re-appending them never bleeds voice guidance into voice-shaped presets such as `fiction`. The length hint is **always re-appended after** the preset prompt — this is the bug everyone in this product space ships: a `journal` preset replaces the system prompt and silently drops the "one sentence" constraint, so suddenly the model writes paragraphs. Re-appending in code (inside `composeSystemPrompt`) makes it impossible to lose. Verified by `prompt-builder.test.ts`.

`temperature` and `useVaultContext` resolve to `preset.<field> ?? settings.<field>`. Note: `settings.systemPrompt` is never consulted at runtime — see §9 Migration.

### 4.6 Persistence

`data.json` stores only `userPresets`. Built-ins resolve from code. Plugin upgrade ships new prompts automatically; user edits are preserved as overrides.

---

## 5. Fill-in-the-Middle

### 5.0 Tunable constants

Centralised in `providers.ts` (or a sibling `constants.ts`) so reviewers see them in one place:

```ts
export const STOP_TOKENS_BY_LENGTH: Record<CompletionLength, string[]> = {
  sentence:  ['\n'],
  line:      ['\n'],
  paragraph: ['\n\n'],
};
// Sentence and line use a single newline to prevent runaway; paragraph mode
// uses the paragraph break and otherwise relies on num_predict + EOS. We
// deliberately do NOT use ['. ', '? ', '! '] — too many false positives in
// technical/academic prose ("e.g.", decimals, ellipses), which two of the
// built-in presets target.

export const FIM_MIN_OLLAMA_VERSION = '0.1.27';   // first release with /api/generate `suffix`
```

### 5.1 Capability allowlist (in `providers.ts`)

```ts
const FIM_PATTERNS = [
  /^qwen2\.5-coder/,                   // base recommended; instruct accepted but worse
  /^codellama.*code/,
  /^codestral/,
  /^deepseek-coder/,
  /^starcoder2(?!.*instruct)/,         // exclude :*-instruct (chat-tuned, no FIM tokens)
];

export function supportsFim(model: string): boolean {
  return FIM_PATTERNS.some((p) => p.test(model));
}
```

Excluded by design: `qwen3-coder` (no published FIM template — Alibaba positioned it as agentic/instruct), `starcoder2:*-instruct` (chat-tuned, no FIM tokens registered), generic chat models.

Note on `qwen2.5-coder` variants: the regex matches both `:base` and `:instruct` tags. The instruct variant chats instead of completes (see §5.8 / Bavarian) but is technically FIM-capable, so we accept it without a runtime Notice — the settings placeholder and README quick-start steer users to `:base`, and we treat misselection as user choice rather than warning-worthy. Revisit if support requests indicate confusion.

### 5.2 Request type extended

```ts
export interface CompletionRequest {
  system: string;
  prompt: string;            // text BEFORE the cursor
  suffix?: string;           // text AFTER the cursor (FIM only)
  signal: AbortSignal;
  onToken?: (text: string) => void;
}
```

### 5.3 Routing in `complete()`

```
provider == 'ollama' && supportsFim(ollamaModel) && suffix && useFim
  -> completeOllamaFIM()
otherwise
  -> existing completeOllama() / completeOpenAI() / completeAnthropic()
     (suffix is silently discarded for non-FIM paths)
```

### 5.4 FIM call shape

```
POST {ollamaBaseUrl}/api/generate
{
  "model": <ollamaModel>,
  "prompt": <FIM-formatted before-cursor block — see §5.6>,
  "suffix": <after-cursor section text>,
  "stream": <streaming>,
  "options": {
    "temperature": <temperature>,
    "num_predict": <maxTokens>,
    "stop": STOP_TOKENS_BY_LENGTH[length]
  }
}
```

Stop tokens are length-coupled per §5.0; single-line modes use `\n` to prevent runaway, paragraph mode uses `\n\n` and otherwise relies on `num_predict` and the model's own EOS. The `system` field is intentionally omitted on the FIM path — see §5.6 for why.

Stream is NDJSON; each chunk has `{response, done, done_reason?}`. (Note: chunk field name is `response`, NOT `message.content` like `/api/chat` — needs its own NDJSON extractor.)

**Hard rules** (per the research):
- Always `/api/generate`. Never `/api/chat` for FIM — chat templates wrap the input in `<|im_start|>user`...`<|im_end|>` and break the FIM contract.
- Never set `raw: true`. Let Ollama's registered TEMPLATE inject `<|fim_*|>` tokens.
- Never hand-roll FIM tokens in the prompt string.

### 5.5 Suffix extraction (in `ghost.ts:buildPrompt`)

The suffix is the rest of the **current section** — text from the cursor down to the next heading at the same level or stronger, or end of file. The same algorithm derives the prefix (text from the section start to the cursor).

Algorithm:

- **Heading detection**: an ATX heading is a line matching `^(#{1,6}) ` that is NOT inside a fenced code block (``` or ~~~). Setext headings are ignored.
- **Current heading**: the nearest ATX heading at or before the cursor (scanning upward, fence-aware). If none exists, the section starts at the body start (after frontmatter).
- **"Same level or stronger"**: a heading with H-level ≤ the current heading's level. If there is no current heading, ANY heading terminates the suffix.
- **Frontmatter**: if the file begins with `---\n…\n---\n`, that block is excluded from both prefix and suffix. Cursor inside frontmatter ⇒ skip FIM (use chat path).
- **Fenced code blocks**: fence state is tracked while scanning; `#` lines inside an open fence do NOT count as headings.
- **Cap order**: compute the section-bounded suffix first, then truncate to `maxSuffixChars` from the start (keeping text closest to the cursor). Same for prefix from the end.
- Capped at `maxSuffixChars` (default 1000).
- For non-FIM models (or when `useFim` is off), suffix is simply not sent. Behavior unchanged.

The current `maxContextChars=2000` setting splits into:

- `maxPrefixChars` — default 2000 (text before cursor in current section).
- `maxSuffixChars` — default 1000 (text after cursor in current section).

Settings UI shows them separately; old `maxContextChars` migrates to `maxPrefixChars` on first load.

### 5.6 Prompt format change for FIM

For FIM, the model receives **raw** before-cursor text in `prompt` and **raw** after-cursor text in `suffix`. The "Continue the following Markdown..." preamble that the chat path uses is **not** added — preambles confuse FIM models.

System content (preset prompt + length hint + vault-context block + note title + section heading, all assembled by `composeSystemPrompt` per §4.5) cannot be reliably routed through Ollama's top-level `system` field on FIM models. The qwen2.5-coder registered template is roughly:

```
{{- if .Suffix }}<|fim_prefix|>{{ .Prompt }}<|fim_suffix|>{{ .Suffix }}<|fim_middle|>{{ else }}{{ .Prompt }}{{ end }}
```

It does not reference `.System`, so any `system` payload is silently dropped. The same holds for codestral, deepseek-coder, and starcoder2 base FIM templates — none of them have a system slot, because base FIM models were not instruction-tuned to honour one.

Therefore, on the FIM path, the system content is folded into the `prompt` field as a leading HTML comment block placed BEFORE the before-cursor text:

```
<!-- ghostwrite:context
Note: "<title>"
Section: "<current heading>"

<preset systemPrompt>

<length hint>

## Related notes from your vault
...
-->

<before-cursor text>
```

The HTML comment form is invisible to readers if the output is ever rendered, tokenises cleanly, and lands inside the `<|fim_prefix|>` region by the registered template — preserving the FIM contract. The `system` field on the FIM request body is left **unset**; it is documented as an OPTIONAL fallback only, in case a future FIM template gains a `.System` slot.

For non-FIM (chat) calls, the existing preamble and `system` field are preserved unchanged — the same `composeSystemPrompt` output is sent via the `system` field there.

**Validation step (must be done before merging FIM implementation):** send `/api/generate` to `qwen2.5-coder:7b-base` with (a) a non-empty `system` and identical `prompt`/`suffix` and (b) the comment-block-in-prompt form with `system` unset, and confirm only (b) actually conditions the completion. Record the result in `docs/superpowers/specs/notes/` and link from this section.

### 5.7 Settings UI additions ("Generation" section)

- **Use FIM when supported** toggle (default on). Kill switch if it misbehaves.
- **Suffix window (chars)** slider — default 1000, range 0–3000.

### 5.8 Default model recommendation

The Ollama placeholder string in settings + the README quick-start now suggest `qwen2.5-coder:7b-base` instead of `qwen2.5:7b`. Ghost-text quality is dramatically better with the base variant — the instruct variant chats instead of completes (per the research, Bavarian §8.2 and Continue.dev's own docs).

### 5.9 Failure modes

| Symptom | Action |
|---|---|
| `/api/generate` returns 404 (Ollama < 0.1.27, no `suffix` support) | Set in-memory flag `fimEndpointUnavailable = true` on the plugin instance (NOT persisted to `data.json`). Show `Notice` exactly once per `false → true` transition. While true, route FIM-eligible requests to `/api/chat`. Flag clears on plugin reload, or on any change to `settings.ollamaBaseUrl` or `settings.ollamaModel` (cleared in the settings-save handler). |
| `/api/generate` returns model-not-found | Show error `Notice`; user fixes settings. No fallback. |
| FIM response empty | Treat same as chat: show "no suggestion" Notice on manual trigger only. |
| Stream connection drops | Existing `streaming` error handling already handles this (silent on auto, "no suggestion" on manual). |

---

## 6. Vault-aware context (structural)

### 6.0 Tunable constants

Centralised at the top of `vault-context.ts`:

```ts
export const KEYWORD_QUERY_CHARS = 200;        // chars before cursor used as the search query
export const PER_NOTE_SNIPPET_CHARS = 400;     // body chars taken from each candidate
export const MAX_CANDIDATE_FILE_BYTES = 200_000; // skip files where stat.size exceeds this (decimal, not 204_800)
export const LINK_BACKLINK_CAP = 10;           // combined cap on links + backlinks
export const KEYWORD_TOP_N = 5;                // top-N unique-from-links keyword hits
export const VAULT_CONTEXT_DEADLINE_MS = 30;   // soft wall-clock budget for keyword phase
```

These are module-level constants, not user settings (the values are footguns to expose without observable benefit). The user-tunable budget remains `maxVaultContextChars` in settings.

### 6.1 New module `src/vault-context.ts`

```ts
export interface VaultContext {
  block: string;     // formatted Markdown ready to inject in the system prompt
  charCount: number; // for budget accounting; equals block.length
  noteCount: number; // for telemetry/UI; 0 means "no context added"
}

export function buildVaultContext(
  app: App,
  activeFile: TFile | null,
  query: string,            // last KEYWORD_QUERY_CHARS chars before cursor; keyword query
  budget: number,           // max chars (block.length, including headers)
  signal: AbortSignal,
): Promise<VaultContext>;
```

`buildVaultContext` is async (because `vault.cachedRead` is async). It checks `signal.aborted` between each `cachedRead` and short-circuits on abort by returning an empty `VaultContext` (`{ block: '', charCount: 0, noteCount: 0 }`); the caller swallows the empty result and proceeds without context. All `MetadataCache` access in this module is restricted to documented members (`resolvedLinks`, `getFileCache`, etc.).

### 6.2 Three signals, ranked, deduped

1. **Resolved links** — `metadataCache.resolvedLinks[activeFile.path]`. Notes the user explicitly linked TO from this note. Sort by link count.
2. **Backlinks** — derived by inverting `metadataCache.resolvedLinks`: iterate every entry; any source path whose value-map contains `activeFile.path` as a key is a backlink. This uses only the documented `MetadataCache` surface. We deliberately do NOT call `metadataCache.getBacklinksForFile()` — it exists at runtime (used by the core Backlinks plugin) but is absent from `obsidian.d.ts` and undocumented, so it would not type-check and could disappear in a future Obsidian release. Resolve each source path via `vault.getAbstractFileByPath(path)` and keep only `TFile` instances with `extension === 'md'` (skip canvas / non-markdown sources). Combined with (1), capped at `LINK_BACKLINK_CAP` (= 10).
3. **Keyword search** — `prepareSimpleSearch(query)(noteText)` over `vault.getMarkdownFiles()`. Top `KEYWORD_TOP_N` (= 5) unique-from-links results. Skip the active file. Skip files where `file.stat.size > MAX_CANDIDATE_FILE_BYTES` (= 200_000 bytes on disk, decimal — not 204_800), checked BEFORE `cachedRead` in §6.3 so oversized files never incur a read.

Dedup by path. Final order: links → backlinks → keyword.

### 6.3 Reading content

`vault.cachedRead(file)` only — never `vault.read()`. For each candidate:

- Skip the candidate entirely if `file.stat.size > MAX_CANDIDATE_FILE_BYTES` before calling `cachedRead`.
- Strip frontmatter using Obsidian's metadata cache when available: `metadataCache.getFileCache(file)?.frontmatterPosition?.end?.offset` — slice the body from that offset (+1 to skip the trailing newline). Fallback when the cache entry is missing: apply `/^---\r?\n[\s\S]*?\r?\n---\r?\n/` against the raw text; if it matches at index 0, drop the matched span; otherwise leave the body untouched (do NOT strip on malformed/unclosed frontmatter, and do NOT treat mid-document `---` horizontal rules as frontmatter). Frontmatter must begin at byte 0. CRLF is handled by the `\r?` in the regex.
- Take the first `PER_NOTE_SNIPPET_CHARS` chars of body. Default `400` — chosen so that with the default 1500-char budget, ~3 candidate notes fit (1500 / 400 ≈ 3.75), matching the "links → backlinks → keyword" priority order without burning the whole budget on a single long note. Not user-configurable in v0.3.0; revisit if telemetry shows the truncation is hurting recall.
- After appending each note's full section (header + body excerpt + trailing blank line) to `block`, stop if `block.length >= budget` (default 1500 chars). The budget covers the entire assembled string including `### [[Title]] (label)` headers and the `## Related notes from your vault` preamble — not just body excerpts. `charCount` in the returned `VaultContext` equals `block.length`.

Practical implication: the link/backlink cap of 10 (§6.2) and keyword top-5 are upper bounds on the candidate list; the budget × snippet-size product is the real cap on how many actually land in the prompt.

### 6.4 Format of the vault-context block (slot in the §4.5 / §5.6 system assembly)

The string after `keyword:` is the substring of the candidate note's body covered by the highest-scoring `SearchMatchPart` offset pair returned by `prepareSimpleSearch(query)(body)` — i.e. `body.slice(match[0][0], match[0][1])`, lower-cased and truncated to 40 chars. If no match offsets are returned (score-only result), omit the `(keyword: …)` parenthetical and label the heading `(keyword match)` instead. The query is the same `KEYWORD_QUERY_CHARS`-length prefix from §6.1.

```
## Related notes from your vault

### [[Q3 Planning]] (linked from this note)
First PER_NOTE_SNIPPET_CHARS chars of that note's body…

### [[Engineering review]] (backlink)
First PER_NOTE_SNIPPET_CHARS chars…

### [[Distributed locks deep-dive]] (keyword: "lock")
First PER_NOTE_SNIPPET_CHARS chars…
```

Empty block if no candidates — caller drops the section entirely.

### 6.5 When it runs

- Only if `useVaultContext` resolves to `true` (preset override → settings).
- Only if `activeFile` exists.
- **Startup gate**: `main.ts` registers `metadataCache.on('resolved')` once and sets a `vaultReady = true` flag in the handler (exposed as a `metadataReady: Promise<void>` on the plugin). While `vaultReady` is false, `buildVaultContext` returns immediately with an empty result (`{ block: '', charCount: 0, noteCount: 0 }`) and the caller drops the section per §6.4. Completion is never awaited on resolution and never aborted because of it; the first few keystrokes after Obsidian launch simply ship without vault context. Rationale: a 10k-note vault can take seconds to resolve at startup; we will not stall the user's first completion.
- **Per-request soft budget**: `buildVaultContext` must return within ~50ms on a 10k-note vault. `cachedRead` is async but served from Obsidian's in-memory cache after first read; `prepareSimpleSearch` scoring is O(n_files × avg_len). To stay within budget on cold vaults, the keyword-search phase short-circuits once `KEYWORD_TOP_N` candidates are found AND the wall-clock deadline (`Date.now() + VAULT_CONTEXT_DEADLINE_MS`) is passed; on deadline, return whatever links/backlinks were collected so far. The whole build is also raced against the request's `AbortSignal` so that a new keystroke cancels in-flight context work.
- The candidate-read loop is async: it awaits each `cachedRead` and checks `signal.aborted` between reads, short-circuiting on abort so we don't burn battery reading files for a request the user already cancelled. `prepareSimpleSearch` itself is sync.
- **No persistent cache.** One-shot per request. If profiling later shows it matters, easy to add.

### 6.6 Settings UI additions ("Behavior" section)

- **Use vault context** toggle (default on for desktop, off for mobile).
- **Vault context budget (chars)** slider — default 1500, range 0–4000.

### 6.7 Mobile behavior

`Platform.isMobile` gates the **fresh-install default** — vault context is opt-in on mobile to save battery. Users can re-enable it from settings.

`useVaultContext` is persisted as a single boolean in `data.json` and is therefore shared across desktop/mobile when the vault is on Obsidian Sync. We deliberately do NOT split it into a `{ desktop, mobile }` shape: the simpler boolean is worth more than the cross-device asymmetry it sacrifices. Mobile users on Obsidian Sync who do not want vault context (battery / latency) should toggle it off once on the mobile device — the toggle is sync-stable, so subsequent edits propagate. The platform-aware default only fires for fresh installs on each device class.

### 6.8 Failure modes

The whole vault-context build is wrapped in try/catch. On any error: log + proceed without context. Completion never blocks on vault-context build.

---

## 7. Mobile commands

Three new commands registered in `main.ts`:

```ts
this.addCommand({
  id: 'mobile-accept',
  name: 'Accept suggestion',
  mobileOnly: true,
  icon: 'check',
  editorCheckCallback: (checking, editor) => {
    const view = cmOf(editor);
    const ghost = view?.state.field(ghostField, false);
    if (!ghost) return false;
    if (!checking) acceptGhost(view!);
    return true;
  },
});
// 'mobile-accept-word'  — icon: 'arrow-right'
// 'mobile-accept-line'  — icon: 'arrow-down'
```

Existing desktop `accept` / `accept-word` / `accept-line` commands stay unchanged. The mobile-only variants exist purely so users can pin them to the **mobile toolbar** via *Settings → Mobile → Manage toolbar*.

`editorCheckCallback` greys out the command in the palette when no ghost is visible.

No custom DOM, no floating pills, no swipe gestures. All touch listeners (none currently planned) would go through `registerDomEvent` for auto-cleanup.

---

## 8. Rename `obsidian-ghost` → `ghostwrite`

| File | Change |
|---|---|
| `manifest.json` | `id: "ghost"` → `"ghostwrite"`; `name: "Ghost"` → `"Ghostwrite"`; description updated |
| `package.json` | `"name": "obsidian-ghost"` → `"obsidian-ghostwrite"` |
| `versions.json` | New entry for `0.3.0` |
| `README.md` | New title, tagline, comparison table, "Why FIM" explainer |
| `scripts/link-to-vault.sh` | Default plugin folder → `ghostwrite` |
| Repo on GitHub | Rename `obsidian-ghost` → `obsidian-ghostwrite` (GitHub auto-redirects old URL) |
| Vault symlink | Re-link from `…/.obsidian/plugins/ghost/` to `…/plugins/ghostwrite/` |

**`data.json` relocation (manual):** the plugin does NOT auto-read from the sibling `ghost/` folder — Obsidian plugins are sandboxed to their own folder and reading a sibling plugin's `data.json` is brittle and surprising. The README upgrade notes (new section "Upgrading from Ghost 0.2.x") instruct users to (1) disable Ghost, (2) copy `…/.obsidian/plugins/ghost/data.json` to `…/.obsidian/plugins/ghostwrite/data.json`, (3) enable Ghostwrite. Field-level migration (§9 Migration) then runs on first load. Settings shape doesn't change — same plugin under a new id.

**Tagline:** *"Copilot-style inline writing for Obsidian — fill-in-the-middle, vault-aware, local-first."*

---

## 9. Settings shape (full, post-v0.3.0)

`ProviderSettings` is unchanged in v0.3.0 and lives in `src/providers.ts` — `provider: 'openai' | 'anthropic' | 'ollama'`, plus per-provider `*BaseUrl` / `*ApiKey` / `*Model` triples for OpenAI, Anthropic, and Ollama, and the shared `streaming: boolean`, `maxTokens: number`, `temperature: number`. v0.3.0 adds no provider-layer fields; all changes below are on the `GhostSettings` side.

```ts
export interface GhostSettings extends ProviderSettings {
  // Master switch
  enabled: boolean;

  // Auto-trigger
  autoTrigger: boolean;
  debounceMs: number;
  minContextChars: number;

  // Context budget (was maxContextChars; migrated)
  maxPrefixChars: number;     // default 2000
  maxSuffixChars: number;     // default 1000  (NEW)

  // Vault context (NEW)
  useVaultContext: boolean;       // default !Platform.isMobile (fresh-install only; see §6.7)
  maxVaultContextChars: number;   // default 1500

  // Triggering gates (carried over from v0.2.x; semantics unchanged)
  // Evaluated in ghost.ts before any provider call (chat or FIM): if the cursor
  // is inside a fenced code block / math block and the corresponding gate is
  // false, no completion is requested. Defaults preserved from v0.2.x.
  triggerInCode: boolean;        // default false
  triggerInMath: boolean;        // default false

  // FIM (NEW)
  useFim: boolean;              // default true

  // Completion shaping
  completionLength: CompletionLength;

  // Presets (NEW)
  activePresetId: string;        // default 'default'
  userPresets: StylePreset[];    // empty by default
}
```

The legacy `systemPrompt` field is removed from the runtime shape — see Migration below.

### Migration

On first load with old `data.json`, migration is triggered by detecting the **absence of `activePresetId`** in the loaded payload (no explicit `settingsVersion` field is introduced; presence/absence of new fields is the version signal). On that first load:

- `maxContextChars` → `maxPrefixChars` (`maxSuffixChars` defaults to 1000).
- `activePresetId` defaults to `'default'`.
- `userPresets` defaults to `[]`.
- `useFim` defaults to `true`.
- `useVaultContext` defaults to `!Platform.isMobile`.
- `maxVaultContextChars` defaults to `1500`.
- `triggerInCode` and `triggerInMath` are preserved as-is (default `false`); v0.3.0 does not change their semantics, and FIM honours them the same way chat does.

**Legacy `systemPrompt` handling (eager):** the migration module embeds `PRE_V03_DEFAULT_SYSTEM` — an inline copy of the v0.2.x `DEFAULT_SYSTEM_PROMPT` string from `src/settings.ts` at v0.2.x (copied so future edits to the live default don't retroactively change migration behaviour).

```ts
if (
  data.systemPrompt &&
  data.systemPrompt.trim().length > 0 &&
  data.systemPrompt.trim() !== PRE_V03_DEFAULT_SYSTEM.trim()
) {
  // User had customised it — create a Default preset override.
  userPresets.push({
    id: 'default',
    name: 'Default',
    builtin: false,
    systemPrompt: data.systemPrompt,
  });
}
delete data.systemPrompt; // dropped on next save
```

`activePresetId` stays `'default'` — `resolvePreset` will find the user override first per §4.3. On subsequent loads `systemPrompt` is no longer present in `data.json`; `resolvePreset` is the sole source of the system prompt at runtime. Deleting the user's Default override falls back to the built-in Default preset from `presets.ts`, never to a legacy field.

---

## 10. Error handling

| Layer | Failure | Behavior |
|---|---|---|
| FIM | Endpoint 404 (Ollama < 0.1.27, no `suffix` support) | One-time `Notice`; in-memory `fimEndpointUnavailable` flag triggers session-wide fallback to chat. Flag clears on plugin reload or any change to `ollamaBaseUrl` / `ollamaModel`. |
| FIM | Model not found (e.g., user typed an uninstalled model) | Show error `Notice`; user fixes settings. No fallback. |
| FIM | Empty stream | Same as chat: silent on auto, "no suggestion" on manual. |
| FIM | Stream connection drops mid-completion | Handled by existing streaming error path (silent on auto, "no suggestion" on manual). |
| FIM | Template lacks `.System` slot (qwen2.5-coder etc.) | System content folded into `prompt` as Markdown comment block; `system` field left empty. See §5.6. |
| Vault context | Any error | Try/catch; log; proceed without context. Completion never blocks. |
| Vault context | Aborted via `signal` | Catch `AbortError`; return empty `VaultContext`; caller proceeds without context block. |
| Status bar | Plugin running on mobile | Status bar creation skipped via `Platform.isMobile` guard; switcher remains available via command palette. |
| Preset | Missing id | Silently fall back to `'default'`; log warning. |
| Length hint | Preset replaces system prompt | Length hint **always** re-appended in `composeSystemPrompt`. Verified by `prompt-builder.test.ts`. |
| Mobile command | No ghost visible | `editorCheckCallback` greys it out. No-op on press. |

---

## 11. Testing

Adding **Vitest** to the project (added to `devDependencies` in `package.json`). Four new test files:

- `src/presets.test.ts` — resolution precedence (user > builtin > default), edit-builtin-creates-override behavior, exact `BUILTIN_PRESETS` id set with `builtin: true`, none of the built-ins carry a `useVaultContext` value, and each `SYSTEM_PROMPT_LENGTH_HINTS` entry contains no tone adjectives (concise/terse/brief/short-form) — length wording only.
- `src/prompt-builder.test.ts` — length-hint-always-appended invariant across all six built-in presets and a user override; canonical assembly order (preset → length hint → vault block → note title → section heading); empty `vaultBlock` omitted; missing heading omitted; double-newline separator preserved.
- `src/vault-context.test.ts` — link/backlink/search ranking (with backlinks derived by inverting `resolvedLinks`, asserting the inversion path rather than mocking `getBacklinksForFile`), dedup, budget cap (covers headers + body, not just body), frontmatter stripping (cache path + regex fallback + malformed unclosed → no strip), `cachedRead` is the read path (mocked), file-size guard (`stat.size > MAX_CANDIDATE_FILE_BYTES` skipped before `cachedRead`), aborts mid-loop (`signal.abort()` between the 1st and 2nd `cachedRead` short-circuits), and skips when metadata not resolved (empty `VaultContext`).
- `src/providers.test.ts` — `supportsFim()` allowlist (positive + negative cases including `starcoder2:*-instruct` excluded, `qwen2.5-coder:7b-base` accepted), `completeOllamaFIM()` body shape and NDJSON `response` extractor, FIM body has `system` empty/absent and `prompt` begins with the `<!-- ghostwrite:context` block when context is non-empty, settings-change-clears-fallback-flag (changing `ollamaBaseUrl` or `ollamaModel` resets `fimEndpointUnavailable` and re-enables FIM probe), and length-coupled `STOP_TOKENS_BY_LENGTH` is wired into the request body.

CodeMirror editor integration stays manually tested in Obsidian. The new modules are pure — no Obsidian runtime needed for tests, no jsdom required.

`npm test` runs the suite. `npm run build` continues to do `tsc -noEmit` plus `esbuild`.

---

## 12. Telemetry

**Zero.** No analytics, no metrics, no error reporting service. The README explicitly states "with Ollama, zero bytes leave your machine." This is part of the local-first positioning.

---

## 13. README rewrite

The new `README.md` leads with:

1. Hero GIF (placeholder; recorded post-implementation): cursor mid-paragraph, chat model breaks the sentence, FIM completes it cleanly.
2. Tagline.
3. Install — BRAT command + community-store status.
4. **Why FIM matters** — the verbatim explainer below.
5. Three feature highlights — FIM / vault context / presets.
6. **Comparison table** — verbatim table below.
7. Provider quick-starts — Ollama (Qwen2.5-Coder), LM Studio, OpenAI, Anthropic, Groq.
8. Privacy section — explicit local-only guarantee.
9. **Upgrading from Ghost 0.2.x** — manual `data.json` relocation steps per §8.
10. Roadmap.

### "Why FIM matters" explainer (verbatim, ≤150 words)

> Most "AI autocomplete" plugins for Obsidian send the text *before* your cursor to a chat model and ask it to continue. That works at the end of a paragraph. It breaks the moment you go back to fix a sentence in the middle: the model can't see what comes *after* the cursor, so it either repeats what's already there or veers off into a new thought.
>
> **Fill-in-the-Middle (FIM)** is a different model contract. Code-trained models like Qwen2.5-Coder, Codestral, and DeepSeek-Coder were pre-trained on examples with a hole punched in the middle, learning to fill exactly that hole given both sides. Ollama exposes this through `/api/generate` with a `suffix` parameter; the model sees `<before>` *and* `<after>` and writes the bridge.
>
> Ghostwrite is the only Obsidian plugin that uses real FIM, not a chat model dressed up as autocomplete. Mid-paragraph edits work.

### Comparison table (verbatim, sourced)

| Capability | **Ghostwrite** | Companion | Auto-Completion Plus | Logan's Copilot | Smart Composer |
|---|---|---|---|---|---|
| Inline ghost text in editor | Yes | Yes | Yes | No (sidebar/chat) | No (chat) |
| True FIM (model `suffix`) | **Yes** (Ollama `/api/generate`) | No | No (prompt-engineered) | No | No |
| Mid-paragraph edits work | **Yes** | Degraded | Degraded | N/A | N/A |
| Vault-aware context | **Yes** (links + backlinks + keyword) | No | No | Yes (embeddings) | Yes (embeddings) |
| No indexing / no embeddings | **Yes** | Yes | Yes | No | No |
| Curated style presets | **Yes** (6 built-ins) | Manual bundles | No | No | No |
| Local-first (Ollama default) | **Yes** | Yes | Yes | Optional | Optional |
| Mobile commands | **Yes** (`mobileOnly`) | No | No | Partial | No |
| Active maintenance (2026) | **Yes** | Stale (May 2024) | Yes (small fork) | Yes | Yes |

Sources: each plugin's `manifest.json`, latest GitHub commit dates, and feature documentation as of 2026-06-19. "Degraded" means the plugin technically renders something at mid-paragraph cursors but cannot see suffix context, so suggestions ignore the after-text. Numbers (install counts, stars) are tracked in `docs/superpowers/specs/notes/competitive-snapshot.md` rather than inlined here so they don't go stale in the README.

---

## 14. Implementation ship order

Single v0.3.0 release. Internal milestones in this order:

1. **Rename + scaffolding** — manifest, package, README placeholder, new files (`presets.ts`, `vault-context.ts`).
2. **FIM** — `providers.ts` allowlist + `completeOllamaFIM`, `CompletionRequest.suffix`, `ghost.ts:buildPrompt` extracts suffix, settings UI gains "Use FIM" toggle and suffix slider.
3. **Vault context** — `vault-context.ts`, integration into `buildPrompt`, settings UI for `useVaultContext` + `maxVaultContextChars`.
4. **Style presets** — `presets.ts` with six built-ins, settings UI adds preset list + active radio + Add Custom form, `main.ts` adds switcher command + status bar, `buildPrompt` resolves preset.
5. **Mobile commands** — three `mobileOnly` commands.
6. **README** — comparison table, hero GIF placeholder, "Why FIM" explainer, BRAT install instructions.
7. **Vitest setup + 3 test files.**
8. **Manual smoke test in Obsidian** with both Qwen2.5-coder (FIM path) and Anthropic (chat path). Verify on iOS/Android that no status bar item is created and no console error is logged.
9. **Tag v0.3.0** + announce per the GTM plan.

---

## 15. Go-to-market (referenced; full plan in competitive-analysis output)

Submission to Obsidian community-plugin store: PR to `obsidianmd/obsidian-releases`, expect 2–8 week review. Ship via BRAT immediately for early users.

Announcement order: r/ObsidianMD → Obsidian Discord → r/LocalLLaMA → X/Twitter (tag @obsdmd, @ollama, @AlibabaQwen) → Show HN.

Hero asset: 15–30s GIF demonstrating mid-paragraph FIM vs chat-model failure. This is the single most important piece of marketing collateral; record it before announcing.

---

## 16. Risks (briefly)

1. **Logan adds inline mode to Copilot for Obsidian** — closes the distribution gap. Mitigation: ship FIM + vault + presets fast; FIM tuning is months for him.
2. **Auto-Completion Plus fork takes off** — already active with Anthropic. Mitigation: vault context + curated presets are the differentiator; Plus has neither.
3. **Daemon ships** — pre-alpha but their roadmap is closer to ours than anyone's. First-in-store wins the namespace.
4. **Prose-FIM is genuinely worse than code-FIM** (Bavarian §8.2). Mitigation: the curated presets are partly cover for this — well-tuned per-persona prompts reduce failure-mode rate. Frame as "best-in-class for note-taking," not "as good as Cursor for prose."
5. **Ollama / Qwen2.5-Coder deprecation.** Mitigation: FIM provider is allowlist-driven; swap in Codestral/DeepSeek-Coder/StarCoder2 by editing one regex array.

---

## Appendix A — File-by-file change manifest

| File | Touch | Notes |
|---|---|---|
| `manifest.json` | edit | id, name, description, version 0.3.0 |
| `package.json` | edit | name, scripts (test), devDependencies (vitest) |
| `versions.json` | edit | add 0.3.0 |
| `README.md` | rewrite | new title, comparison table, FIM explainer, "Upgrading from Ghost 0.2.x" section |
| `scripts/link-to-vault.sh` | edit | new plugin folder name |
| `src/main.ts` | edit | switcher command, status bar item (desktop only via `Platform.isMobile` guard), 3 mobile commands; await `metadataCache.on('resolved')` once at startup before enabling vault-context queries (see §6.5); clear `fimEndpointUnavailable` flag on settings save |
| `src/ghost.ts` | edit | buildPrompt: preset + vault context + suffix extraction; FIM-aware complete() routing; calls `composeSystemPrompt` |
| `src/providers.ts` | edit | supportsFim, completeOllamaFIM, NDJSON `response` extractor, suffix in CompletionRequest, STOP_TOKENS_BY_LENGTH |
| `src/settings.ts` | edit | new fields, migration (drops legacy `systemPrompt`), presets UI, FIM/vault toggles, PRE_V03_DEFAULT_SYSTEM constant |
| `src/presets.ts` | NEW | built-in presets, BUILTIN_PRESETS, SYSTEM_PROMPT_LENGTH_HINTS, resolvePreset() |
| `src/prompt-builder.ts` | NEW | composeSystemPrompt() — canonical system-prompt assembly seam |
| `src/vault-context.ts` | NEW | buildVaultContext(), tunable constants, resolvedLinks-inversion backlinks |
| `src/presets.test.ts` | NEW | unit tests |
| `src/prompt-builder.test.ts` | NEW | length-hint invariant + assembly order |
| `src/vault-context.test.ts` | NEW | unit tests |
| `src/providers.test.ts` | NEW | unit tests |
| `vitest.config.ts` | NEW | minimal config |

---

## Appendix B — Key technical decisions, locked

| Decision | Choice |
|---|---|
| Vault context tier | Structural-only (links + keyword), no embeddings |
| FIM detection | Hardcoded model-name allowlist |
| Preset selection | Manual only (command palette + status bar). No frontmatter, no folder map |
| Mobile UX | `mobileOnly` commands with icons. No custom DOM widget |
| FIM endpoint | `/api/generate` with `suffix`. Never `/api/chat` for FIM. Never `raw: true` |
| Default Ollama model | `qwen2.5-coder:7b-base` (was `qwen2.5:7b`) |
| Plugin name | `Ghostwrite` (was `Ghost`) |
| Release strategy | Single monolithic v0.3.0 |
| Telemetry | Zero |

---

## Changelog

Post-review revisions applied 2026-06-19 (43 verified findings, integrated rather than appended):

- **§2 Scope** — replaced the "Per-preset model overrides (data shape supports it)" YAGNI with the accurate "Per-preset model / provider overrides (neither data shape nor UI in v0.3.0)"; no dead `model?: string` field added.
- **§3 Architecture** — added `src/prompt-builder.ts` as the canonical system-prompt seam; updated `main.ts` notes to mention the metadataCache resolved gate.
- **§4.2** — removed the per-preset `useVaultContext` defaults from the table; built-ins inherit the platform-aware global setting so mobile-opt-in cannot be silently overridden by the active preset.
- **§4.2.1 (NEW)** — full `BUILTIN_PRESETS` definitions for all six ids (`default`, `journal`, `meeting-notes`, `technical`, `fiction`, `academic`) with verbatim `systemPrompt`, `temperature`, `completionLength`.
- **§4.4 Switcher UX** — `addStatusBarItem()` wrapped in `Platform.isMobile` guard with concrete code; transient `Notice('Preset: …')` on switch as the mobile read-out; Add Custom form fields, validation, and id-collision policy specified.
- **§4.5 Prompt assembly** — replaced inline concat with `composeSystemPrompt()`; added explicit `SYSTEM_PROMPT_LENGTH_HINTS` strings (length-only wording, no tone adjectives); fixed separator to `\n\n`; documented assembly order; clarified `settings.systemPrompt` is no longer consulted at runtime.
- **§5.0 (NEW) Tunable constants** — `STOP_TOKENS_BY_LENGTH`, `FIM_MIN_OLLAMA_VERSION` centralised.
- **§5.1** — narrowed `starcoder2` regex to exclude `:*-instruct`; added qwen2.5-coder variant disposition note (no runtime warning).
- **§5.4** — `stop` now reads from `STOP_TOKENS_BY_LENGTH[length]`; `system` field documented as omitted on FIM path.
- **§5.5** — explicit suffix-extraction algorithm (heading detection, fence-aware, frontmatter handling, cap order).
- **§5.6 (CRITICAL)** — FIM no longer routes system content through Ollama's `system` field. The qwen2.5-coder / codestral / deepseek-coder / starcoder2 base FIM templates do not reference `.System`. System content is folded into `prompt` as a leading `<!-- ghostwrite:context ... -->` comment block; `system` field is left unset (documented as OPTIONAL fallback only). Added pre-merge validation step.
- **§5.9 / §10** — flesh-out: 404 fallback uses an in-memory `fimEndpointUnavailable` flag (not persisted); flag clears on plugin reload or any change to `ollamaBaseUrl` / `ollamaModel`. Added rows for model-not-found, stream drops, FIM template lacks `.System`, vault-context aborts, mobile status bar.
- **§6.0 (NEW) Tunable constants** — `KEYWORD_QUERY_CHARS`, `PER_NOTE_SNIPPET_CHARS`, `MAX_CANDIDATE_FILE_BYTES`, `LINK_BACKLINK_CAP`, `KEYWORD_TOP_N`, `VAULT_CONTEXT_DEADLINE_MS`.
- **§6.1** — `buildVaultContext` is `Promise<VaultContext>` and takes `signal: AbortSignal`; documents that it returns empty on abort.
- **§6.2 (CRITICAL)** — backlinks derived by inverting the documented `metadataCache.resolvedLinks` rather than calling the undocumented `getBacklinksForFile()`. Type-safe and forward-compatible.
- **§6.3** — frontmatter regex pinned (`/^---\r?\n[\s\S]*?\r?\n---\r?\n/`) with metadataCache-first strategy; `PER_NOTE_SNIPPET_CHARS` constant; budget cap clarified to cover the entire assembled `block` string including headers; `stat.size > MAX_CANDIDATE_FILE_BYTES` (decimal, before `cachedRead`).
- **§6.4** — `(keyword: …)` derivation specified via `SearchMatchPart` offsets; section heading reframed as "slot in the §4.5 / §5.6 assembly".
- **§6.5** — explicit startup gate (`vaultReady` flag, first-keystroke skip rather than block); per-request soft budget; `cachedRead` is async; `signal.aborted` checked between reads.
- **§6.7** — kept the simple boolean shape; documented that it's shared across desktop/mobile via Sync, and that mobile users opt-out once. Explicitly REJECTED the device-aware `{ desktop, mobile }` shape (see "Superseded" below).
- **§8** — `data.json` relocation is a manual user step (README "Upgrading from Ghost 0.2.x" section); plugin does not auto-read sibling folder.
- **§9** — added `ProviderSettings` description; annotated `triggerInCode` / `triggerInMath` with semantics + defaults; **removed** the legacy `systemPrompt` field from the runtime shape; eager migration creates a Default preset override iff `data.systemPrompt !== PRE_V03_DEFAULT_SYSTEM`, then deletes the legacy field; version detection by absence of `activePresetId`.
- **§11** — four test files (added `prompt-builder.test.ts`); concrete assertions for each, including resolvedLinks-inversion path, abort behaviour, and tone-word-free length hints.
- **§13** — verbatim FIM explainer (≤150 words) and verbatim sourced comparison table inlined; added "Upgrading from Ghost 0.2.x" item; install counts moved to a sibling notes doc to avoid stale numbers in README.
- **Appendix A** — added `prompt-builder.ts` and `prompt-builder.test.ts`; updated `main.ts` notes (resolved gate, mobile guard, settings-save flag clear); `package.json` row mentions `vitest` devDep.
- **`src/prompt-builder.ts` (NEW)** — module file written; exports `composeSystemPrompt` and `ComposeArgs`.
