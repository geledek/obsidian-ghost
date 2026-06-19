// src/prompt-builder.ts
//
// Canonical system-prompt assembly seam. This is the ONE place where preset,
// length-hint, vault-context, note title, and current heading meet. Both the
// chat path and the FIM path call composeSystemPrompt() so the load-bearing
// "length hint always re-appended" invariant cannot drift.
//
// See docs/superpowers/specs/2026-06-19-ghostwrite-v0.3.0-design.md §4.5.

import type { CompletionLength, StylePreset } from './settings';
import { SYSTEM_PROMPT_LENGTH_HINTS } from './presets';

export interface ComposeArgs {
  preset: StylePreset;
  length: CompletionLength;
  vaultBlock?: string;     // formatted Markdown from buildVaultContext, or empty
  noteTitle?: string;
  currentHeading?: string;
}

/**
 * Assemble the system prompt in the canonical order:
 *   preset.systemPrompt
 *   "\n\n" + SYSTEM_PROMPT_LENGTH_HINTS[length]
 *   ("\n\n" + vaultBlock)?           // omitted if empty
 *   "\n\n" + `Note: "${noteTitle}"`
 *   ("\n" + `Section: "${heading}"`)? // omitted if no heading
 *
 * Double newline between major sections is required so the length hint reads
 * as a separate instruction; single \n would soft-break onto the preset's
 * last line.
 *
 * The output of this function is what lands in the chat `system` field, AND
 * what is wrapped in the leading <!-- ghostwrite:context ... --> comment block
 * for the FIM `prompt` field (see §5.6 of the design spec).
 */
export function composeSystemPrompt(args: ComposeArgs): string {
  const { preset, length, vaultBlock, noteTitle, currentHeading } = args;

  let s = preset.systemPrompt + '\n\n' + SYSTEM_PROMPT_LENGTH_HINTS[length];

  if (vaultBlock && vaultBlock.length > 0) {
    s += '\n\n' + vaultBlock;
  }

  s += '\n\n' + `Note: "${noteTitle ?? ''}"`;
  if (currentHeading) {
    s += '\n' + `Section: "${currentHeading}"`;
  }

  return s;
}
