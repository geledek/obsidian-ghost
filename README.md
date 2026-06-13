# Ghost — Inline AI for Obsidian

**Copilot-style ghost text completions for Markdown notes.**  
Type naturally. Pause for a moment. Get faded inline suggestions powered by *your* models (API keys or fully local).

Inspired by VS Code Copilot inline suggestions, built specifically for Obsidian's Markdown + CodeMirror 6 editor.

## Features

- True **ghost text** (faded text right after your cursor) — feels like VS Code Copilot but for your notes
- **Tab** → accept full suggestion
- **Cmd/Ctrl + Right** or command "Accept next word" → accept one word at a time
- "Accept next line / sentence" command
- **Escape** to dismiss
- **Magic prefix consumption** — start typing matching text and the ghost shrinks live
- **Markdown-intelligent** (what makes it "even better"):
  - Uses Obsidian's CodeMirror `syntaxTree` to detect headings, lists, callouts, code blocks, frontmatter, math, etc.
  - Sends the **full current section** (text from the nearest heading down to your cursor) so the model has real coherent context, not just a blind window.
  - Sends current note filename + active heading
  - Smartly avoids auto-triggering in code/math blocks (fully configurable)
- Works with **any OpenAI-compatible endpoint** (OpenAI, Groq, xAI, Together, Fireworks, LM Studio, Ollama `/v1`, etc.)
- First-class native **Ollama** + **Anthropic Claude**
- Streaming (watch the ghost text appear token-by-token)
- Prompting heavily tuned for personal knowledge work and Markdown writing
- "Regenerate suggestion" command (dismiss + immediately ask again)
- Manual trigger command + full settings UI

This syntax awareness + rich note context + writing-focused prompting is the secret sauce that makes Ghost feel native in Obsidian.

## Why this instead of other Copilot plugins?

- Focused exclusively on **inline ghost text** (no big chat pane required for writing flow)
- You control the models completely (bring your own keys or run local)
- Lightweight and fast
- Designed for Markdown writing / thinking, not just code

Existing great plugins like "Copilot" (logancyang), "Text Generator", "AI Autocomplete", and "Companion" do many things well. Ghost aims to be the best pure inline writing companion.

## Installation (for users)

### Quick start with built files

1. Copy these three files into your vault's plugin folder:
   ```
   YourVault/.obsidian/plugins/ghost/
     ├── main.js
     ├── manifest.json
     └── styles.css
   ```
2. In Obsidian: **Settings → Community plugins → Reload** (or restart Obsidian).
3. Enable the **Ghost** plugin.
4. Go to **Settings → Ghost** and configure a provider.

### Recommended quick setups

- **Fast & cheap (cloud)**: Provider = OpenAI Compatible → use the "Groq (very fast, free tier)" preset. Get a key at groq.com (very generous limits).
- **Best writing quality**: Provider = Anthropic → Claude 3.5 Sonnet or newer.
- **Fully local & private**: Provider = Ollama. Run `ollama serve` + `ollama pull qwen2.5:14b` (or llama3.2, phi4, etc.). Use the Ollama section in settings.

You can also use LM Studio, anything with an OpenAI-compatible `/v1` endpoint, Together.ai, Fireworks, xAI, etc.

### Test your setup

In Ghost settings there is a **"Test Connection"** button. Click it after filling your credentials — it will send a tiny test prompt and show you latency + a sample response (or a clear error). Very handy for debugging Ollama/LM Studio or bad keys.

### Development (recommended workflow with symlinks)

This is the best way to develop so you never have to manually copy files again.

1. **One-time setup** — create symlinks:

   ```bash
   cd obsidian-ghost
   ./scripts/link-to-vault.sh
   ```

   - First, **edit the script** `scripts/link-to-vault.sh` and set your correct `VAULT_PATH`.
   - Common paths:
     - iCloud: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Your Vault Name`
     - Local: `~/Documents/Your Vault Name`
   - You can find the exact path in Obsidian → **Settings → About → Vault path**.

2. Start the dev server:

   ```bash
   npm install
   npm run dev
   ```

   esbuild will now watch your code and automatically rebuild `main.js` on every change.

3. Because of the symlinks, the updated `main.js`, `manifest.json`, and `styles.css` instantly appear in your vault.

4. **Strongly recommended**: Install the community plugin **"Hot Reload"**.
   - It will automatically reload the Ghost plugin whenever the files change.
   - No more manual Cmd+Shift+R or restarting Obsidian.

After the initial `link-to-vault.sh`, your workflow becomes:
- Edit code in `src/`
- Save → esbuild rebuilds automatically
- (With Hot Reload) Obsidian instantly picks up the change

Note: Your plugin settings (`data.json`) live in the vault's plugin folder (correct behavior). The source folder stays clean.

### Alternative: Manual copy (if you prefer)

If you don't want symlinks, just copy the three files after every build:

```bash
cp main.js manifest.json styles.css "/path/to/your/vault/.obsidian/plugins/ghost/"
```

## Configuration

### Recommended quick starts

**Fast & cheap (cloud)**
- Provider: OpenAI Compatible
- Base URL: `https://api.groq.com/openai/v1`
- Model: `llama-3.3-70b-versatile` or `mixtral-8x7b-32768`
- Get a free Groq key at groq.com

**Best quality writing**
- Provider: Anthropic
- Model: `claude-3-5-sonnet-20241022` or newer
- Excellent at long coherent Markdown continuations.

**Fully local & private (Ollama)**
- Run `ollama serve`
- Pull a model: `ollama pull qwen2.5:14b` or `phi4` or `llama3.2`
- Provider: Ollama
- Base: `http://localhost:11434`
- Model: the tag you pulled

LM Studio / anything with an OpenAI `/v1` server also works great with the OpenAI Compatible provider.

## How it feels (the UX goal)

You are writing:

```
## Project update

Today I made good progress on the new feature. The main challenge was
```

Pause ~700ms → Ghost appears:

```
## Project update

Today I made good progress on the new feature. The main challenge was
 handling state synchronization across the distributed workers. I decided to
```

You can:
- Hit **Tab** → whole suggestion committed
- Keep typing → ghost disappears (or prefix matches are consumed automatically)
- Hit **Esc** → dismiss

## Privacy & Security

- Your notes never leave your machine except when you explicitly call an API you configured.
- API keys are stored in plaintext inside your vault's plugin data folder (`data.json`). This is the standard for almost all Obsidian AI plugins.
- For maximum privacy use local models (Ollama, LM Studio, etc).

## Roadmap / Ideas for "even better"

- [ ] Vault-aware context (pull relevant notes via simple search or embeddings you already have)
- [ ] Fill-in-the-middle (FIM) for models that support it (better mid-sentence suggestions)
- [ ] Per-style system prompts (journal, meeting notes, technical writing, fiction...)
- [x] Accept word / accept line hotkeys (like real Copilot)
- [ ] Citation of where an idea came from (if using RAG)
- [ ] Mobile toolbar support for accept

Contributions and feedback welcome.

## License

MIT
