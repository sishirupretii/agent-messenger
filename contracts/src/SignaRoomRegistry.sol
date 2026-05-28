// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  SignaRoomRegistry
 * @notice Permissionless on-chain anchor for SIGNA rooms.
 *
 * A room creator wallet calls `anchor(slug, manifestHash)` to claim the
 * slug globally. First-write wins: once anchored, only the original
 * creator can update or release it. This lets any SIGNA node verify a
 * room's identity without trusting any other node:
 *
 *   1. Fetch the room from /api/rooms/[slug] on any node
 *   2. Re-compute manifestHash = keccak256(signed_message)
 *   3. Look up anchor on this contract → confirm creator + hash match
 *
 * If a node serves a different `signed_message` for that slug, its
 * manifestHash won't match the on-chain anchor and the consumer can
 * reject the federation source. This is the trust-minimization layer
 * for SIGNA Rooms — same model as the SignaNodeRegistry but for the
 * room-level identity.
 *
 * Storage is intentionally minimal — no name, description, or gate
 * info on-chain. The signed_message preimage off-chain already covers
 * all that data, and we anchor a hash of it. Saves gas, keeps the
 * contract bytecode tight.
 *
 * Designed for Base mainnet (chain id 8453). Identical bytecode can
 * be redeployed verbatim on any EVM chain to seed federation there.
 */
contract SignaRoomRegistry {
    // ---------- types ----------

    struct RoomAnchor {
        address creator;       // wallet that first anchored the slug (msg.sender)
        bytes32 manifestHash;  // keccak256 of the canonical signed_message
        uint64  anchoredAt;    // unix seconds at first anchor()
        uint64  updatedAt;     // unix seconds at most recent update
        bool    active;        // false after release() — record retained for audit
    }

    // ---------- storage ----------

    /// @notice slugHash → anchor. slugHash = keccak256(bytes(slug)). We
    ///         key by hash instead of string to bound storage cost.
    mapping(bytes32 => RoomAnchor) public roomsByHash;

    /// @notice slugHash → string slug, for forward lookup at read time.
    mapping(bytes32 => string) public slugByHash;

    /// @notice Enumerable list of slugHashes ever anchored. Read-side
    ///         pagination primitive — listAnchors(start, count).
    bytes32[] public anchoredSlugs;

    /// @notice slugHash → 1-based index into anchoredSlugs[]. Zero means
    ///         "never anchored", lets the contract distinguish anchor
    ///         from update without an extra storage slot.
    mapping(bytes32 => uint256) public anchoredIndexPlusOne;

    /// @notice Active anchor count. Decreases on release().
    uint256 public activeCount;

    // ---------- events ----------

    event RoomAnchored(
        bytes32 indexed slugHash,
        address indexed creator,
        string  slug,
        bytes32 manifestHash,
        uint64  anchoredAt
    );
    event RoomUpdated(
        bytes32 indexed slugHash,
        address indexed creator,
        bytes32 manifestHash,
        uint64  updatedAt
    );
    event RoomReleased(
        bytes32 indexed slugHash,
        address indexed creator,
        uint64  releasedAt
    );

    // ---------- errors ----------

    error EmptySlug();
    error SlugTooLong();
    error ZeroHash();
    error NotCreator();
    error NotActive();

    // ---------- limits ----------

    /// @dev keep slugs reasonably short to bound calldata gas — the
    ///      web-side ROOM_SLUG_REGEX caps at 32 chars already.
    uint256 public constant MAX_SLUG_BYTES = 32;

    // ---------- write API ----------

    /**
     * @notice Anchor a room slug on-chain. First wallet to call wins;
     *         subsequent callers attempting the same slug get
     *         NotCreator(). The original creator can call again to
     *         update `manifestHash` (e.g. after a description change
     *         that produces a new signed_message preimage).
     *
     * @param slug         The canonical lowercase room slug (1..32 bytes).
     * @param manifestHash keccak256 of the canonical signed_message
     *                     committed by the creator's wallet off-chain.
     */
    function anchor(string calldata slug, bytes32 manifestHash) external {
        bytes memory slugBytes = bytes(slug);
        if (slugBytes.length == 0) revert EmptySlug();
        if (slugBytes.length > MAX_SLUG_BYTES) revert SlugTooLong();
        if (manifestHash == bytes32(0)) revert ZeroHash();

        bytes32 slugHash = keccak256(slugBytes);
        RoomAnchor storage a = roomsByHash[slugHash];
        uint64 nowTs = uint64(block.timestamp);

        if (anchoredIndexPlusOne[slugHash] == 0) {
            // first-time anchor
            anchoredSlugs.push(slugHash);
            anchoredIndexPlusOne[slugHash] = anchoredSlugs.length;
            slugByHash[slugHash] = slug;
            a.creator = msg.sender;
            a.manifestHash = manifestHash;
            a.anchoredAt = nowTs;
            a.updatedAt = nowTs;
            a.active = true;
            activeCount += 1;
            emit RoomAnchored(slugHash, msg.sender, slug, manifestHash, nowTs);
        } else {
            // update existing — only the original creator may update
            if (a.creator != msg.sender) revert NotCreator();
            bool wasActive = a.active;
            a.manifestHash = manifestHash;
            a.updatedAt = nowTs;
            if (!wasActive) {
                a.active = true;
                activeCount += 1;
                emit RoomAnchored(slugHash, msg.sender, slug, manifestHash, nowTs);
            } else {
                emit RoomUpdated(slugHash, msg.sender, manifestHash, nowTs);
            }
        }
    }

    /**
     * @notice Release an anchor. Slug is freed for future re-anchoring
     *         by any wallet. Only the original creator can release.
     *         The historical record stays in storage for audit.
     */
    function release(string calldata slug) external {
        bytes32 slugHash = keccak256(bytes(slug));
        RoomAnchor storage a = roomsByHash[slugHash];
        if (!a.active) revert NotActive();
        if (a.creator != msg.sender) revert NotCreator();
        a.active = false;
        a.updatedAt = uint64(block.timestamp);
        activeCount -= 1;
        emit RoomReleased(slugHash, msg.sender, uint64(block.timestamp));
    }

    // ---------- read API ----------

    /// @notice Total slugs ever anchored (active + released).
    function totalAnchored() external view returns (uint256) {
        return anchoredSlugs.length;
    }

    /// @notice Look up the anchor for a slug. Returns zero-valued
    ///         struct if never anchored.
    function getAnchor(string calldata slug)
        external
        view
        returns (RoomAnchor memory)
    {
        return roomsByHash[keccak256(bytes(slug))];
    }

    /**
     * @notice Page through anchor records in registration order.
     *         Returns up to `count` entries starting at `start`.
     *         Callers wanting only active anchors filter on `active`.
     */
    function listAnchors(uint256 start, uint256 count)
        external
        view
        returns (string[] memory slugs, RoomAnchor[] memory page)
    {
        uint256 total = anchoredSlugs.length;
        if (start >= total) {
            return (new string[](0), new RoomAnchor[](0));
        }
        uint256 end = start + count;
        if (end > total) end = total;
        uint256 len = end - start;
        slugs = new string[](len);
        page = new RoomAnchor[](len);
        for (uint256 i = 0; i < len; i++) {
            bytes32 h = anchoredSlugs[start + i];
            slugs[i] = slugByHash[h];
            page[i] = roomsByHash[h];
        }
    }
}
