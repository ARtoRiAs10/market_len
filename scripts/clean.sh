#!/usr/bin/env bash
# Reclaim disk space used by regenerable artefacts.
#
#   bash scripts/clean.sh            # remove caches + build output
#   bash scripts/clean.sh --all      # also remove node_modules and the venv
#
# The git-tracked repository is ~1 MB; everything removed here is either
# re-downloadable (npm/pip) or re-derivable (HTTP cache, build output).

set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ cleaning build output and caches"
rm -rf project/web/.next project/web/out project/web/node_modules/.cache 2>/dev/null || true
find . -type d -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true
find . -type d -name ".pytest_cache" -prune -exec rm -rf {} + 2>/dev/null || true
find . -type d -name ".ipynb_checkpoints" -prune -exec rm -rf {} + 2>/dev/null || true
rm -rf project/ml/.cache 2>/dev/null || true

if [[ "${1:-}" == "--all" ]]; then
  echo "→ removing node_modules and Python environments (reinstall to restore)"
  rm -rf project/web/node_modules 2>/dev/null || true
  rm -rf .venv venv project/ml/.venv 2>/dev/null || true
fi

echo "→ done. Current sizes:"
du -sh . 2>/dev/null || true
du -sh project/ml 2>/dev/null || true
