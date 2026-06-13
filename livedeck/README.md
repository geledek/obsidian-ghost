# LiveDeck

**A WYSIWYG editor for plain HTML slide decks.** Click any text to edit it — like
PowerPoint — but the deck stays a single, self-contained HTML file that Claude
Code (or any tool) can read and rewrite.

This is an experimental prototype that closes the loop on AI-generated slides:
today you generate a deck and then have to either re-prompt the model or hand-edit
raw HTML. LiveDeck lets you nudge a word, fix a title, or restyle a line *directly
on the rendered slide*, while keeping the source as plain HTML.

## Why this exists

| Workflow | Generate HTML | Click-to-edit the rendered slide | Saves back to plain HTML |
| --- | :---: | :---: | :---: |
| Claude Code / Artifacts | ✅ | ❌ | ✅ |
| PowerPoint / Keynote | ❌ | ✅ | ❌ (proprietary) |
| **LiveDeck** | ✅ (bring your own) | ✅ | ✅ |

## Quick start

```bash
cd livedeck
npm start            # → http://localhost:4321
```

Then open the URL and click any heading, bullet, or paragraph to edit it.
Changes autosave back to `deck.html`.

To edit **your own** deck instead of the bundled sample:

```bash
DECK=/path/to/your/deck.html npm start
# or change the port:
PORT=8080 DECK=./mydeck.html npm start
```

## The core idea (how it works)

- The deck is rendered in a same-origin `<iframe>`, so its own CSS/JS displays
  exactly as it will when presented. **What you see is the real slide.**
- Because the iframe is same-origin, the editor reaches into the live document and
  makes clicked text elements `contenteditable`. **The thing you edit *is* the
  thing that gets saved** — a true round-trip, no lossy import/export.
- On save, the live document is cloned, the editor's own affordances (hover
  outlines, `contenteditable` flags) are stripped, and the clean HTML is written
  back to disk.
- A file watcher pushes a live-reload event over Server-Sent Events, so when
  Claude Code rewrites the deck, this view updates instantly — **two-way sync**.

Zero runtime dependencies — just Node's standard library.

## Roadmap / next experiments

- Select-an-element + inline AI editing ("make this punchier", "restyle this")
- Direct manipulation beyond text: drag/resize/recolor (à la Onlook, for plain HTML)
- Per-slide navigation, thumbnails, and reorder
- Export to PDF / PowerPoint
- Support for framework decks (reveal.js, Slidev) alongside freeform HTML

## Status

Prototype. Built to validate the editing loop, not yet a polished product.
