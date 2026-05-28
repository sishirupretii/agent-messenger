// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SignaRoomRegistry} from "../src/SignaRoomRegistry.sol";

/**
 * Deploy script for SignaRoomRegistry.
 *
 * Usage:
 *   forge script script/DeployRoomRegistry.s.sol \
 *     --rpc-url base \
 *     --private-key 0x<deployer_key> \
 *     --broadcast \
 *     --verify
 *
 * Deployer wallet needs ~0.0002 ETH on Base mainnet for gas.
 *
 * After deploy:
 *   1. Copy the address printed below
 *   2. Set SIGNA_ROOM_REGISTRY_ADDRESS in Vercel env (production)
 *   3. The web app's /api/rooms/[slug]/anchor route picks it up
 *      automatically on the next deploy
 */
contract DeployRoomRegistry is Script {
    function run() external returns (SignaRoomRegistry reg) {
        uint256 pk = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        vm.startBroadcast(pk);
        reg = new SignaRoomRegistry();
        vm.stopBroadcast();
        console.log("SignaRoomRegistry deployed at:", address(reg));
        console.log("Chain id:", block.chainid);
    }
}
