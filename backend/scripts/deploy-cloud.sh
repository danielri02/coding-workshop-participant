#!/usr/bin/env bash
# Application-owned cloud entry point; provided workshop scripts stay unchanged.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "${PYTHON:-python3.13}" "$SCRIPT_DIR/deploy_cloud.py" "$@"
