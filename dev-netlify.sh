#!/usr/bin/env bash
# Runs the site locally through the Netlify CLI's dev server, so clean URLs,
# _redirects, and _headers all behave exactly like production. Builds the
# same staging directory as deploy-netlify.sh (only the public site files —
# never index.js, node_modules, or .netlify.env) and serves it with
# `netlify dev`, which does understand _redirects/_headers (unlike a plain
# static server such as VS Code's Live Server).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGING_DIR"' EXIT

cp -r Teachers admins depHead images shared supervisors "$STAGING_DIR/"
cp index.html manifest.webmanifest name-glow.js _headers _redirects "$STAGING_DIR/"

echo "Serving from a staging copy at $STAGING_DIR (edits there won't be picked up —"
echo "edit files in the repo and re-run this script to see changes)."
netlify dev --dir="$STAGING_DIR"
