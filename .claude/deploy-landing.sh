#!/usr/bin/env bash
# Auto-deploy the HADES landing site to Vercel when its source has changed.
# Invoked by the Stop hook (see .claude/settings.local.json). Runs detached + non-interactive so
# it never blocks or hangs a Claude Code turn.
#
# Deploys from ui/ — that is where the linked Vercel project lives (ui/.vercel), where ui/vercel.json
# defines the build, and where `pnpm build:landing` runs. Deploying from the repo root instead would
# upload the whole 3.8GB tree (service/, datasets/, node_modules) — wrong and slow.
#
# Fires a deploy ONLY when the landing SOURCE content has changed since the last successful deploy
# (not merely "the working tree is dirty") — otherwise, with the project's no-commit rule, an
# uncommitted landing edit would re-deploy on every single turn forever. We fingerprint the source
# dir and short-circuit when the fingerprint matches the last deployed one.
set -uo pipefail

REPO="/Users/aarushjain/NCSSM/Projects/HADES"
UI="$REPO/ui"
SRC="$UI/src/landing"
STATE_DIR="$REPO/.claude/.deploy-state"
HASH_FILE="$STATE_DIR/landing.sha"
LOCK="$STATE_DIR/deploy.lock"
LOG="$STATE_DIR/deploy.log"

mkdir -p "$STATE_DIR"

# Fingerprint every landing source file (content-addressed, order-stable).
fingerprint() {
  find "$SRC" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -print0 \
    | sort -z \
    | xargs -0 shasum \
    | shasum | awk '{print $1}'
}

CUR="$(fingerprint)"
PREV="$(cat "$HASH_FILE" 2>/dev/null || echo none)"

# nothing changed in the landing source since the last deploy — do nothing.
[ "$CUR" = "$PREV" ] && exit 0

# single-flight: if a deploy is already running, skip (the running one covers the latest source).
if ! mkdir "$LOCK" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

{
  echo "=== deploy started $(date) (fp $CUR) ==="
  cd "$UI" || { echo "cd $UI failed"; exit 1; }
  # Vercel builds the landing site remotely via ui/vercel.json; --prod --yes is fully
  # non-interactive against the linked project (ui/.vercel/project.json).
  if vercel --prod --yes; then
    echo "$CUR" > "$HASH_FILE"
    echo "=== deploy OK $(date) ==="
  else
    echo "=== deploy FAILED $(date) — fingerprint NOT saved, will retry next turn ==="
  fi
} >> "$LOG" 2>&1
