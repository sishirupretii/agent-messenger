#!/usr/bin/env bash
# Publish every SIGNA Python package to PyPI in one shot.
#
# Setup (one time):
#   1. Make a PyPI account at https://pypi.org/account/register/
#   2. Create an API token at https://pypi.org/manage/account/token/
#      Scope it to "Entire account" the first run (we'll narrow per
#      project after the first upload creates the projects).
#   3. Export the token:
#        export TWINE_USERNAME=__token__
#        export TWINE_PASSWORD=pypi-<your_token_here>
#
# Run:
#   bash sdk/publish-pypi.sh
#
# Idempotent: PyPI rejects duplicate versions, so re-running after a
# version bump uploads only the new wheels.

set -euo pipefail

if [ -z "${TWINE_USERNAME:-}" ] || [ -z "${TWINE_PASSWORD:-}" ]; then
  echo "Error: set TWINE_USERNAME=__token__ and TWINE_PASSWORD=pypi-<token>"
  exit 1
fi

python -m pip install --quiet --upgrade build twine

cd "$(dirname "$0")"

# Order matters: signa-agent is a dependency of every adapter, so we
# upload it first. PyPI propagation is near-instant but doing this in
# order keeps the dependency resolver happy if anyone installs mid-batch.
for pkg in python crewai ag2 pydantic-ai openai-agents claude-agent; do
  echo "==> building + uploading signa-$pkg"
  (
    cd "$pkg"
    rm -rf dist
    python -m build --wheel --sdist > /tmp/signa-build-$pkg.log 2>&1 \
      || { tail -20 /tmp/signa-build-$pkg.log; exit 1; }
    python -m twine upload --skip-existing dist/*
  )
done

echo
echo "════════════════════════════════════════════════════════════"
echo " ✓ All 6 SIGNA Python packages live on PyPI:"
echo "     pip install signa-agent"
echo "     pip install signa-crewai"
echo "     pip install signa-ag2"
echo "     pip install signa-pydantic-ai"
echo "     pip install signa-openai-agents"
echo "     pip install signa-claude-agent"
echo "════════════════════════════════════════════════════════════"
