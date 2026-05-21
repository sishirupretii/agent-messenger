// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SignaNodeRegistry} from "../src/SignaNodeRegistry.sol";

contract SignaNodeRegistryTest is Test {
    SignaNodeRegistry reg;

    address constant ALICE = address(0xA11CE);
    address constant BOB   = address(0xB0B);
    address constant CAROL = address(0xCA401);

    function setUp() public {
        reg = new SignaNodeRegistry();
    }

    // -------- happy paths --------

    function test_FirstRegister_AddsToOperators_And_ActiveCount() public {
        vm.prank(ALICE);
        reg.register("alice-node", "https://alice.example", "0.13.0");

        assertEq(reg.totalOperators(), 1);
        assertEq(reg.activeCount(), 1);

        SignaNodeRegistry.NodeRecord memory rec = _readNode(ALICE);
        assertEq(rec.operator, ALICE);
        assertEq(rec.name, "alice-node");
        assertEq(rec.url, "https://alice.example");
        assertEq(rec.version, "0.13.0");
        assertTrue(rec.active);
        assertEq(rec.registeredAt, uint64(block.timestamp));
        assertEq(rec.updatedAt, uint64(block.timestamp));
    }

    function test_SecondRegister_UpdatesInPlace_DoesNotDuplicate() public {
        vm.startPrank(ALICE);
        reg.register("alice-node", "https://alice.v1", "0.13.0");
        uint64 t0 = uint64(block.timestamp);

        vm.warp(block.timestamp + 1000);
        reg.register("alice-node-v2", "https://alice.v2", "0.14.0");
        vm.stopPrank();

        assertEq(reg.totalOperators(), 1, "no duplicate operator entry");
        assertEq(reg.activeCount(), 1);

        SignaNodeRegistry.NodeRecord memory rec = _readNode(ALICE);
        assertEq(rec.name, "alice-node-v2");
        assertEq(rec.url, "https://alice.v2");
        assertEq(rec.version, "0.14.0");
        assertEq(rec.registeredAt, t0, "registeredAt preserved");
        assertEq(rec.updatedAt, t0 + 1000, "updatedAt advanced");
    }

    function test_MultipleOperators_AllListed() public {
        vm.prank(ALICE);
        reg.register("alice", "https://alice.example", "0.13.0");
        vm.prank(BOB);
        reg.register("bob", "https://bob.example", "0.13.0");
        vm.prank(CAROL);
        reg.register("carol", "https://carol.example", "0.13.0");

        assertEq(reg.totalOperators(), 3);
        assertEq(reg.activeCount(), 3);

        SignaNodeRegistry.NodeRecord[] memory page = reg.listNodes(0, 10);
        assertEq(page.length, 3);
        assertEq(page[0].operator, ALICE);
        assertEq(page[1].operator, BOB);
        assertEq(page[2].operator, CAROL);
    }

    // -------- deregister --------

    function test_Deregister_FlipsActive_DecrementsCount() public {
        vm.startPrank(ALICE);
        reg.register("alice", "https://a.example", "0.13.0");
        reg.deregister();
        vm.stopPrank();

        SignaNodeRegistry.NodeRecord memory rec = _readNode(ALICE);
        assertFalse(rec.active);
        assertEq(reg.activeCount(), 0);
        // record persists (audit)
        assertEq(reg.totalOperators(), 1);
        assertEq(rec.name, "alice");
    }

    function test_Deregister_WhenNotActive_Reverts() public {
        vm.expectRevert(SignaNodeRegistry.NotActive.selector);
        vm.prank(ALICE);
        reg.deregister();
    }

    function test_ReRegister_AfterDeregister_PreservesRegisteredAt() public {
        vm.startPrank(ALICE);
        reg.register("alice", "https://a.example", "0.13.0");
        uint64 originalRegisteredAt = uint64(block.timestamp);

        vm.warp(block.timestamp + 500);
        reg.deregister();

        vm.warp(block.timestamp + 1000);
        reg.register("alice", "https://a.example", "0.13.0");
        vm.stopPrank();

        SignaNodeRegistry.NodeRecord memory rec = _readNode(ALICE);
        assertTrue(rec.active);
        assertEq(rec.registeredAt, originalRegisteredAt, "registeredAt preserved across deregister/re-register");
        assertEq(reg.activeCount(), 1);
        assertEq(reg.totalOperators(), 1);
    }

    // -------- validation --------

    function test_EmptyName_Reverts() public {
        vm.expectRevert(SignaNodeRegistry.EmptyName.selector);
        vm.prank(ALICE);
        reg.register("", "https://a.example", "0.13.0");
    }

    function test_EmptyUrl_Reverts() public {
        vm.expectRevert(SignaNodeRegistry.EmptyUrl.selector);
        vm.prank(ALICE);
        reg.register("alice", "", "0.13.0");
    }

    function test_UrlTooLong_Reverts() public {
        string memory longUrl = _stringOfLength(257);
        vm.expectRevert(SignaNodeRegistry.UrlTooLong.selector);
        vm.prank(ALICE);
        reg.register("alice", longUrl, "0.13.0");
    }

    function test_NameTooLong_Reverts() public {
        string memory longName = _stringOfLength(65);
        vm.expectRevert(SignaNodeRegistry.UrlTooLong.selector);
        vm.prank(ALICE);
        reg.register(longName, "https://a.example", "0.13.0");
    }

    // -------- isolation --------

    function test_Alice_CannotModify_BobsRecord() public {
        vm.prank(ALICE);
        reg.register("alice", "https://alice.example", "0.13.0");
        vm.prank(BOB);
        reg.register("bob", "https://bob.example", "0.13.0");

        // Alice "updates" — only touches alice's record
        vm.prank(ALICE);
        reg.register("alice-v2", "https://alice.v2", "0.14.0");

        SignaNodeRegistry.NodeRecord memory bobRec = _readNode(BOB);
        assertEq(bobRec.name, "bob", "bob untouched");
        assertEq(bobRec.url, "https://bob.example");

        SignaNodeRegistry.NodeRecord memory aliceRec = _readNode(ALICE);
        assertEq(aliceRec.name, "alice-v2");
    }

    // -------- pagination --------

    function test_ListNodes_Pagination() public {
        // register 5 operators
        for (uint256 i = 0; i < 5; i++) {
            address op = address(uint160(0x1000 + i));
            vm.prank(op);
            reg.register(
                string.concat("node-", _toString(i)),
                string.concat("https://node-", _toString(i), ".example"),
                "0.13.0"
            );
        }
        assertEq(reg.totalOperators(), 5);

        // first page
        SignaNodeRegistry.NodeRecord[] memory p0 = reg.listNodes(0, 2);
        assertEq(p0.length, 2);
        assertEq(p0[0].name, "node-0");
        assertEq(p0[1].name, "node-1");

        // mid page
        SignaNodeRegistry.NodeRecord[] memory p1 = reg.listNodes(2, 2);
        assertEq(p1.length, 2);
        assertEq(p1[0].name, "node-2");
        assertEq(p1[1].name, "node-3");

        // tail (overshoots)
        SignaNodeRegistry.NodeRecord[] memory p2 = reg.listNodes(4, 10);
        assertEq(p2.length, 1);
        assertEq(p2[0].name, "node-4");

        // past end
        SignaNodeRegistry.NodeRecord[] memory p3 = reg.listNodes(99, 10);
        assertEq(p3.length, 0);
    }

    function test_ListActiveNodes_FiltersInactive() public {
        for (uint256 i = 0; i < 5; i++) {
            address op = address(uint160(0x2000 + i));
            vm.prank(op);
            reg.register(
                string.concat("n", _toString(i)),
                string.concat("https://n", _toString(i), ".example"),
                "0.13.0"
            );
        }
        // deregister the middle one
        vm.prank(address(uint160(0x2002)));
        reg.deregister();

        SignaNodeRegistry.NodeRecord[] memory active = reg.listActiveNodes(0, 10);
        assertEq(active.length, 4);
        // verify the deregistered one is missing
        for (uint256 i = 0; i < active.length; i++) {
            assertTrue(active[i].operator != address(uint160(0x2002)));
        }
    }

    // -------- events --------

    function test_NodeRegistered_Event() public {
        vm.expectEmit(true, false, false, true);
        emit SignaNodeRegistry.NodeRegistered(
            ALICE,
            "alice",
            "https://alice.example",
            "0.13.0",
            uint64(block.timestamp)
        );
        vm.prank(ALICE);
        reg.register("alice", "https://alice.example", "0.13.0");
    }

    function test_NodeUpdated_Event_OnSecondRegister() public {
        vm.startPrank(ALICE);
        reg.register("alice", "https://v1", "0.13.0");

        vm.warp(block.timestamp + 100);
        vm.expectEmit(true, false, false, true);
        emit SignaNodeRegistry.NodeUpdated(
            ALICE,
            "alice-v2",
            "https://v2",
            "0.14.0",
            uint64(block.timestamp)
        );
        reg.register("alice-v2", "https://v2", "0.14.0");
        vm.stopPrank();
    }

    function test_NodeDeregistered_Event() public {
        vm.prank(ALICE);
        reg.register("alice", "https://alice.example", "0.13.0");

        vm.warp(block.timestamp + 100);
        vm.expectEmit(true, false, false, true);
        emit SignaNodeRegistry.NodeDeregistered(ALICE, uint64(block.timestamp));
        vm.prank(ALICE);
        reg.deregister();
    }

    // -------- helpers --------

    function _readNode(address op)
        internal
        view
        returns (SignaNodeRegistry.NodeRecord memory r)
    {
        (
            address operator,
            string memory name,
            string memory url,
            string memory version,
            uint64 registeredAt,
            uint64 updatedAt,
            bool active
        ) = reg.nodes(op);
        r.operator = operator;
        r.name = name;
        r.url = url;
        r.version = version;
        r.registeredAt = registeredAt;
        r.updatedAt = updatedAt;
        r.active = active;
    }

    function _stringOfLength(uint256 n) internal pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 i = 0; i < n; i++) b[i] = "x";
        return string(b);
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 tmp = v;
        uint256 digits;
        while (tmp != 0) {
            digits++;
            tmp /= 10;
        }
        bytes memory buf = new bytes(digits);
        while (v != 0) {
            digits -= 1;
            buf[digits] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(buf);
    }
}
