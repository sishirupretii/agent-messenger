#!/usr/bin/env bash
# Deploy SignaRoomRegistry to Base mainnet + wire it into Vercel env.
#
# Usage:
#   PRIVATE_KEY=0x<deployer_key> bash contracts/scripts/deploy-room-registry.sh
#
# Requires:
#   - foundry installed (forge in PATH)
#   - Vercel CLI installed (npx vercel)
#   - Vercel CLI logged in + linked to the agent-messenger project
#   - Deployer wallet has > 0.0002 ETH on Base
#
# Produces:
#   1. Deploys SignaRoomRegistry to Base mainnet
#   2. Extracts the deployed contract address
#   3. Sets SIGNA_ROOM_REGISTRY_ADDRESS in Vercel env (production)
#   4. Triggers a Vercel production redeploy
#   5. Prints the basescan URL of the deployed contract

set -euo pipefail

if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "Error: set PRIVATE_KEY env var (0x-prefixed deployer private key)"
  exit 1
fi

echo "→ running forge tests first…"
cd "$(dirname "$0")/.."
forge test --match-contract SignaRoomRegistryTest > /dev/null

echo "→ deploying SignaRoomRegistry to Base mainnet…"
forge script script/DeployRoomRegistry.s.sol \
  --rpc-url base \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  --slow \
  --verify 2>&1 | tee /tmp/signa-room-deploy.log

# Extract the deployed address from the broadcast log
DEPLOYED=$(jq -r '.transactions[0].contractAddress' \
  broadcast/DeployRoomRegistry.s.sol/8453/run-latest.json)

if [ -z "$DEPLOYED" ] || [ "$DEPLOYED" = "null" ]; then
  echo "Error: could not extract deployed address"
  exit 1
fi

echo
echo "✓ deployed: $DEPLOYED"
echo "  basescan: https://basescan.org/address/$DEPLOYED"
echo

echo "→ setting SIGNA_ROOM_REGISTRY_ADDRESS in Vercel env…"
# Remove any prior value, then set fresh (printf avoids trailing newline)
cd ../web
npx vercel env rm SIGNA_ROOM_REGISTRY_ADDRESS production --yes 2>/dev/null || true
printf '%s' "$DEPLOYED" | npx vercel env add SIGNA_ROOM_REGISTRY_ADDRESS production

echo
echo "→ triggering Vercel production redeploy…"
cd ..
git commit --allow-empty -m "chore: redeploy with SIGNA_ROOM_REGISTRY_ADDRESS"
git push origin main

echo
echo "════════════════════════════════════════════════════════════"
echo " ✓ SignaRoomRegistry live on Base mainnet"
echo "   contract: $DEPLOYED"
echo "   chain:    base (8453)"
echo
echo " Once Vercel finishes deploying:"
echo "   • /api/anchor-config returns deployed:true"
echo "   • CreateRoomDialog shows the anchor CTA after sign+create"
echo "   • /api/rooms/[slug]/anchor returns real on-chain data"
echo "   • Anchored rooms show ANCHORED ON BASE in their header"
echo "════════════════════════════════════════════════════════════"
