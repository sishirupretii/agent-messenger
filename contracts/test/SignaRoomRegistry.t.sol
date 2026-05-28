// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SignaRoomRegistry} from "../src/SignaRoomRegistry.sol";

contract SignaRoomRegistryTest is Test {
    SignaRoomRegistry reg;

    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);

    bytes32 constant HASH_ONE =
        keccak256("SIGNA room create v1\nts:1\naddress:0xA11CE\nname:alice room\nslug:alice-room\npublic:true");
    bytes32 constant HASH_TWO =
        keccak256("SIGNA room create v1\nts:2\naddress:0xA11CE\nname:alice room v2\nslug:alice-room\npublic:true");

    function setUp() public {
        reg = new SignaRoomRegistry();
    }

    // -------- happy paths --------

    function test_FirstAnchor_AddsToList_And_ActiveCount() public {
        vm.prank(ALICE);
        reg.anchor("alice-room", HASH_ONE);

        assertEq(reg.totalAnchored(), 1);
        assertEq(reg.activeCount(), 1);

        SignaRoomRegistry.RoomAnchor memory a = reg.getAnchor("alice-room");
        assertEq(a.creator, ALICE);
        assertEq(a.manifestHash, HASH_ONE);
        assertTrue(a.active);
        assertGt(a.anchoredAt, 0);
        assertEq(a.anchoredAt, a.updatedAt);
    }

    function test_Update_PreservesAnchoredAt_AndCount() public {
        vm.prank(ALICE);
        reg.anchor("alice-room", HASH_ONE);

        uint64 firstAnchored = reg.getAnchor("alice-room").anchoredAt;
        vm.warp(block.timestamp + 100);

        vm.prank(ALICE);
        reg.anchor("alice-room", HASH_TWO);

        SignaRoomRegistry.RoomAnchor memory a = reg.getAnchor("alice-room");
        assertEq(a.creator, ALICE);
        assertEq(a.manifestHash, HASH_TWO);
        assertEq(a.anchoredAt, firstAnchored);
        assertGt(a.updatedAt, firstAnchored);
        assertEq(reg.totalAnchored(), 1);
        assertEq(reg.activeCount(), 1);
    }

    function test_ReleaseAndReanchor_KeepsAnchoredAt() public {
        vm.prank(ALICE);
        reg.anchor("alice-room", HASH_ONE);
        uint64 firstAnchored = reg.getAnchor("alice-room").anchoredAt;

        vm.warp(block.timestamp + 50);
        vm.prank(ALICE);
        reg.release("alice-room");
        assertEq(reg.activeCount(), 0);
        assertFalse(reg.getAnchor("alice-room").active);

        vm.warp(block.timestamp + 50);
        vm.prank(ALICE);
        reg.anchor("alice-room", HASH_TWO);
        SignaRoomRegistry.RoomAnchor memory a = reg.getAnchor("alice-room");
        assertTrue(a.active);
        assertEq(a.anchoredAt, firstAnchored);
        assertEq(a.manifestHash, HASH_TWO);
        assertEq(reg.activeCount(), 1);
    }

    // -------- access control --------

    function test_Anchor_RevertsForNonCreator() public {
        vm.prank(ALICE);
        reg.anchor("alice-room", HASH_ONE);

        vm.prank(BOB);
        vm.expectRevert(SignaRoomRegistry.NotCreator.selector);
        reg.anchor("alice-room", HASH_TWO);
    }

    function test_Release_RevertsForNonCreator() public {
        vm.prank(ALICE);
        reg.anchor("alice-room", HASH_ONE);

        vm.prank(BOB);
        vm.expectRevert(SignaRoomRegistry.NotCreator.selector);
        reg.release("alice-room");
    }

    function test_Release_RevertsWhenInactive() public {
        vm.expectRevert(SignaRoomRegistry.NotActive.selector);
        vm.prank(ALICE);
        reg.release("never-anchored");
    }

    // -------- validation --------

    function test_Anchor_RevertsOnEmptySlug() public {
        vm.expectRevert(SignaRoomRegistry.EmptySlug.selector);
        vm.prank(ALICE);
        reg.anchor("", HASH_ONE);
    }

    function test_Anchor_RevertsOnZeroHash() public {
        vm.expectRevert(SignaRoomRegistry.ZeroHash.selector);
        vm.prank(ALICE);
        reg.anchor("alice-room", bytes32(0));
    }

    function test_Anchor_RevertsOnSlugTooLong() public {
        // 33 chars > MAX_SLUG_BYTES (32)
        string memory long = "abcdefghijklmnopqrstuvwxyz1234567";
        vm.expectRevert(SignaRoomRegistry.SlugTooLong.selector);
        vm.prank(ALICE);
        reg.anchor(long, HASH_ONE);
    }

    // -------- enumeration --------

    function test_ListAnchors_Pagination() public {
        vm.prank(ALICE);
        reg.anchor("alice-room", HASH_ONE);
        vm.prank(BOB);
        reg.anchor("bob-room", HASH_TWO);

        (string[] memory slugs, SignaRoomRegistry.RoomAnchor[] memory page) =
            reg.listAnchors(0, 10);

        assertEq(slugs.length, 2);
        assertEq(page.length, 2);
        assertEq(slugs[0], "alice-room");
        assertEq(slugs[1], "bob-room");
        assertEq(page[0].creator, ALICE);
        assertEq(page[1].creator, BOB);
    }

    function test_ListAnchors_StartBeyondEnd_ReturnsEmpty() public {
        vm.prank(ALICE);
        reg.anchor("alice-room", HASH_ONE);
        (string[] memory slugs, SignaRoomRegistry.RoomAnchor[] memory page) =
            reg.listAnchors(10, 5);
        assertEq(slugs.length, 0);
        assertEq(page.length, 0);
    }
}
