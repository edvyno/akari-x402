#!/bin/bash
# Publish akari-x402 to npm, then repoint the MCP registry entry at the npm package.
#
# Why this is a script and not a cron: the first step needs a human. npm requires an
# authenticated session (browser login + 2FA/OTP) and this desk has no npm credentials —
# bypassing that is not an option, so the publish stays a deliberate, attended action.
#
# Usage:
#   scripts/publish-npm.sh            # dry run: show what would be published
#   scripts/publish-npm.sh --publish  # npm login (interactive) -> npm publish -> registry
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"

BEFORE="$(node -p "require('./package.json').version")"
echo "package: $(node -p "require('./package.json').name")@$BEFORE"

if ! npm whoami >/dev/null 2>&1; then
  echo "not logged in to npm — run: npm login   (browser + 2FA; then re-run this script)"
  if [ "${1:-}" != "--publish" ]; then
    npm pack --dry-run 2>&1 | tail -20
    exit 1
  fi
  npm login
fi
echo "npm user: $(npm whoami)"

if [ "${1:-}" != "--publish" ]; then
  npm pack --dry-run 2>&1 | tail -20
  echo "dry run only — pass --publish to publish $BEFORE"
  exit 0
fi

npm publish --access public
echo "published $(node -p "require('./package.json').name")@$BEFORE"

# The registry refuses an npm package that does not exist yet, which is why the entry that
# is live today is the remotes-only one. Now that the package exists, publish the npm variant.
if [ -f server.npm-pending.json ]; then
  cp server.json "server.remote.$(date -u +%Y%m%dT%H%M%SZ).json"
  cp server.npm-pending.json server.json
fi
npm version "$(node -p "require('./package.json').version")" --no-git-tag-version >/dev/null 2>&1 || true
mcp-publisher publish

echo "verify:"
echo "  curl -s https://registry.npmjs.org/$(node -p "require('./package.json').name") | head -c 200"
echo "  npx -y $(node -p "require('./package.json').name")   # then: AKARI_TEST_CMD=\"npx -y $(node -p "require('./package.json').name")\" node test/mcp_stdio_test.mjs"
