#!/usr/bin/env bash
# Deploys the static site to Netlify (abrabsence.netlify.app) via the
# Netlify CLI. Copies only the actual public site files into a throwaway
# staging directory first, so backend/tooling files (index.js, node_modules,
# package.json, credentials, etc.) never get uploaded as public assets.
#
# Requires .netlify.env (gitignored) in the repo root with:
#   NETLIFY_AUTH_TOKEN=...
#   NETLIFY_SITE_ID=...
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -f .netlify.env ]; then
  echo "Missing .netlify.env with NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID." >&2
  exit 1
fi
set -a
source .netlify.env
set +a

STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGING_DIR"' EXIT

cp -r Teachers admins depHead images shared supervisors "$STAGING_DIR/"
cp index.html manifest.webmanifest name-glow.js _headers _redirects "$STAGING_DIR/"

netlify deploy --prod --dir="$STAGING_DIR" --site="$NETLIFY_SITE_ID"
