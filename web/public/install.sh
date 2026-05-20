#!/usr/bin/env bash
# signa CLI installer.
# Usage: curl -fsSL https://www.signaagent.xyz/install.sh | bash
#
# Installs the CLI to ~/.signa/bin/signa and prints PATH instructions.
# Idempotent — safe to re-run.

set -euo pipefail

BASE_URL="${SIGNA_BASE_URL:-https://www.signaagent.xyz}"
INSTALL_DIR="$HOME/.signa/bin"
INSTALL_PATH="$INSTALL_DIR/signa"
SOURCE_URL="$BASE_URL/signa.mjs"

# ---------- prereqs ----------

if ! command -v node >/dev/null 2>&1; then
  cat <<EOF >&2

signa needs Node.js (18 or newer). install it first:

  macOS / Linux:  curl -fsSL https://fnm.vercel.app/install | bash && fnm install 20
  or:             https://nodejs.org/en/download

then re-run this installer.

EOF
  exit 1
fi

NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo >&2 "signa needs Node 18 or newer. you have $(node -v)."
  echo >&2 "upgrade Node and re-run this installer."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo >&2 "curl is required. install it and re-run."
  exit 1
fi

# ---------- download ----------

echo "↓ downloading signa.mjs from $SOURCE_URL"
mkdir -p "$INSTALL_DIR"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
curl -fsSL -o "$TMP" "$SOURCE_URL"

# ---------- atomic install ----------

mv "$TMP" "$INSTALL_PATH"
chmod +x "$INSTALL_PATH"

# ---------- verify ----------

if ! node "$INSTALL_PATH" version >/dev/null 2>&1; then
  echo >&2 "✗ installed binary failed self-check. try re-running the installer."
  exit 1
fi

VERSION="$(node "$INSTALL_PATH" version 2>/dev/null || echo "v?")"

# ---------- PATH guidance ----------

cat <<EOF

✓ signa installed at $INSTALL_PATH
✓ $VERSION

add ~/.signa/bin to your PATH so you can run \`signa\` from anywhere.

  bash / zsh:
    echo 'export PATH="\$HOME/.signa/bin:\$PATH"' >> ~/.zshrc
    source ~/.zshrc

  fish:
    fish_add_path ~/.signa/bin

then try:
  signa --help
  signa ask "what is the price of \\\$USDC on base"
  signa live

EOF
