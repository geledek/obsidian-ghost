#!/bin/zsh
#
# Helper script to create symlinks from the built plugin files
# into your Obsidian vault's plugins folder.
#
# This way you never have to manually copy main.js, manifest.json, styles.css again.
#
# Usage:
#   1. Edit the VAULT_PATH below to point to your actual vault.
#   2. Make the script executable: chmod +x scripts/link-to-vault.sh
#   3. Run it: ./scripts/link-to-vault.sh
#
# After running, you can keep `npm run dev` running in another terminal.
# Every time esbuild rebuilds main.js, the change will instantly appear in Obsidian.
#
# Recommended: Also install the community plugin "Hot Reload" so Obsidian
# automatically reloads the plugin when the files change.

set -e

# ============================================
# EDIT THIS LINE to point to your vault root
# ============================================
# Common examples:
#   iCloud vault:   "$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/My Vault"
#   Local vault:    "$HOME/Documents/Obsidian/My Vault"
#   Or run this in Obsidian: Settings → About → "Vault path"
VAULT_PATH="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/YourVaultNameHere"

PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/ghost"
DEV_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Linking Ghost plugin from:"
echo "  $DEV_DIR"
echo "to:"
echo "  $PLUGIN_DIR"
echo ""

if [[ ! -d "$VAULT_PATH" ]]; then
  echo "❌ Error: Vault path does not exist: $VAULT_PATH"
  echo "Please edit this script and set the correct VAULT_PATH."
  exit 1
fi

mkdir -p "$PLUGIN_DIR"

# Create symlinks (force update if they already exist)
ln -sf "$DEV_DIR/main.js"      "$PLUGIN_DIR/main.js"
ln -sf "$DEV_DIR/manifest.json" "$PLUGIN_DIR/manifest.json"
ln -sf "$DEV_DIR/styles.css"   "$PLUGIN_DIR/styles.css"

echo "✅ Symlinks created successfully."
echo ""
echo "Files linked:"
ls -l "$PLUGIN_DIR/main.js" "$PLUGIN_DIR/manifest.json" "$PLUGIN_DIR/styles.css"
echo ""
echo "Next steps:"
echo "  1. Make sure 'npm run dev' is running in another terminal in the obsidian-ghost folder"
echo "  2. (Strongly recommended) Install the community plugin 'Hot Reload' in Obsidian"
echo "  3. Your changes will now appear automatically on every rebuild."
echo ""
echo "You only need to run this script once (unless you change vault locations)."
