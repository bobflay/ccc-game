#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploy the static game to GitHub Pages.
#
# It simply commits any changes and pushes to `main`, which triggers the
# workflow in .github/workflows/deploy.yml (Actions → Pages). No build step
# is needed — the game is plain HTML/JS/CSS plus the bundled GLB assets.
#
# Usage:
#   ./deploy.sh                 # commit + push with an auto message
#   ./deploy.sh "my message"    # commit + push with your message
#
# One-time setup on GitHub: repo Settings › Pages › Source = "GitHub Actions".
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

# Must be a git repo with an 'origin' remote.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "✗ Not a git repository." >&2; exit 1
fi
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "✗ No 'origin' remote. Add one:" >&2
  echo "    git remote add origin git@github.com:<owner>/<repo>.git" >&2
  exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "⚠  You are on '$branch', not 'main' (Pages deploys from main)."
  read -r -p "   Push '$branch' → origin/main anyway? [y/N] " ans
  [ "${ans:-}" = "y" ] || [ "${ans:-}" = "Y" ] || { echo "Aborted."; exit 1; }
fi

# Commit any pending changes.
msg=${1:-"Deploy site $(date -u +%Y-%m-%dT%H:%MZ)"}
git add -A
if git diff --cached --quiet; then
  echo "· No changes to commit — pushing current HEAD."
else
  git commit -m "$msg"
fi

echo "· Pushing to origin/main…"
git push origin HEAD:main

# Derive owner/repo from the remote to print the live URL.
url=$(git remote get-url origin)
slug=$(printf '%s' "$url" | sed -E 's#(git@[^:]+:|https?://[^/]+/)##; s#\.git$##')
owner=${slug%%/*}
repo=${slug##*/}

cat <<EOF

✔ Pushed. GitHub Actions is building & deploying.
  Actions : https://github.com/${slug}/actions
  Live URL: https://${owner}.github.io/${repo}/

If this is the first deploy, enable Pages once:
  repo Settings › Pages › Source = "GitHub Actions".
EOF
