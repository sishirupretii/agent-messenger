// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  SignaNodeRegistry
 * @notice Permissionless on-chain registry of SIGNA federated nodes.
 *
 * Each operator (msg.sender) controls EXACTLY ONE record at a time.
 * Registering, updating, and deregistering are all permissionless and
 * gated only by msg.sender == operator. No admin, no owner, no upgrade
 * authority — the contract is immutable once deployed.
 *
 * Discovery is fully on-chain: any client can read the node list with
 * no signa-server cooperation. CLI consumers cross-verify each URL by
 * hitting <url>/api/node/info and confirming the operator address in
 * the JSON matches the on-chain record — that prevents URL squatting
 * (Alice can register "signa.xyz" but the CLI will detect the
 * mismatch and reject her record).
 *
 * Storage layout is deliberately flat — one struct per operator, plus
 * an enumerable operator list. listNodes(start, count) is the read
 * pagination primitive for clients that don't want to enumerate the
 * full set in one call once the registry grows.
 *
 * Deployed first on Base mainnet (chain id 8453). The CLI will
 * hard-code the deployed address. Same bytecode can be re-deployed
 * verbatim on any other EVM chain to seed federation on that chain.
 */
contract SignaNodeRegistry {
    // ---------- types ----------

    struct NodeRecord {
        address operator;          // owner — equals msg.sender at register time
        string  name;              // human-readable node name
        string  url;               // https://… — base url where /api/node/info lives
        string  version;           // SIGNA protocol version the node implements (e.g. "0.13.0")
        uint64  registeredAt;      // unix seconds at first register()
        uint64  updatedAt;         // unix seconds at most recent update
        bool    active;            // false after deregister() — record retained for audit
    }

    // ---------- storage ----------

    /// @notice Records by operator. Each address controls one record.
    mapping(address => NodeRecord) public nodes;

    /// @notice Enumerable list of operators ever registered (active OR
    ///         deregistered). Used by listNodes() for pagination.
    address[] public operators;

    /// @notice operator => 1-based index into operators[]. Zero means
    ///         "never registered". Lets us cheaply detect first-time
    ///         registrations vs updates.
    mapping(address => uint256) public operatorIndexPlusOne;

    /// @notice Number of currently-active nodes. Decreases on deregister.
    uint256 public activeCount;

    // ---------- events ----------

    event NodeRegistered(
        address indexed operator,
        string name,
        string url,
        string version,
        uint64 registeredAt
    );
    event NodeUpdated(
        address indexed operator,
        string name,
        string url,
        string version,
        uint64 updatedAt
    );
    event NodeDeregistered(address indexed operator, uint64 deregisteredAt);

    // ---------- errors ----------

    error EmptyName();
    error EmptyUrl();
    error UrlTooLong();
    error NotActive();

    // ---------- limits ----------

    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MAX_URL_BYTES = 256;
    uint256 public constant MAX_VERSION_BYTES = 32;

    // ---------- write API ----------

    /**
     * @notice Register the caller as a SIGNA node operator, or update
     *         the existing record if one already exists.
     *
     * Validation:
     *   - name and url must be non-empty
     *   - url must be ≤ 256 bytes (defensive — keep storage bounded)
     *   - name must be ≤ 64 bytes
     *   - version must be ≤ 32 bytes
     *
     * Re-registering after a deregister flips active back to true and
     * preserves the original registeredAt (for "longest-running node"
     * leaderboards).
     */
    function register(
        string calldata name,
        string calldata url,
        string calldata version
    ) external {
        bytes memory nameBytes = bytes(name);
        bytes memory urlBytes = bytes(url);
        bytes memory versionBytes = bytes(version);
        if (nameBytes.length == 0) revert EmptyName();
        if (urlBytes.length == 0) revert EmptyUrl();
        if (nameBytes.length > MAX_NAME_BYTES) revert UrlTooLong();
        if (urlBytes.length > MAX_URL_BYTES) revert UrlTooLong();
        if (versionBytes.length > MAX_VERSION_BYTES) revert UrlTooLong();

        NodeRecord storage rec = nodes[msg.sender];
        uint64 nowTs = uint64(block.timestamp);

        if (operatorIndexPlusOne[msg.sender] == 0) {
            // first-time registration
            operators.push(msg.sender);
            operatorIndexPlusOne[msg.sender] = operators.length;
            rec.operator = msg.sender;
            rec.registeredAt = nowTs;
            rec.active = true;
            activeCount += 1;
            rec.name = name;
            rec.url = url;
            rec.version = version;
            rec.updatedAt = nowTs;
            emit NodeRegistered(msg.sender, name, url, version, nowTs);
        } else {
            // update existing
            bool wasActive = rec.active;
            rec.name = name;
            rec.url = url;
            rec.version = version;
            rec.updatedAt = nowTs;
            if (!wasActive) {
                rec.active = true;
                activeCount += 1;
                emit NodeRegistered(msg.sender, name, url, version, nowTs);
            } else {
                emit NodeUpdated(msg.sender, name, url, version, nowTs);
            }
        }
    }

    /**
     * @notice Deregister the caller's node. The record persists for
     *         audit but `active` flips to false and the node won't be
     *         returned by listActiveNodes(). Caller can re-register
     *         later — registeredAt is preserved.
     */
    function deregister() external {
        NodeRecord storage rec = nodes[msg.sender];
        if (!rec.active) revert NotActive();
        rec.active = false;
        rec.updatedAt = uint64(block.timestamp);
        activeCount -= 1;
        emit NodeDeregistered(msg.sender, uint64(block.timestamp));
    }

    // ---------- read API ----------

    /// @notice Number of operators ever registered (active + deregistered).
    function totalOperators() external view returns (uint256) {
        return operators.length;
    }

    /**
     * @notice Page through ALL operator records (active + inactive),
     *         starting at `start`, up to `count` entries.
     *
     * Returns the records in the order operators first registered.
     * Callers that only want active nodes can filter on rec.active.
     */
    function listNodes(uint256 start, uint256 count)
        external
        view
        returns (NodeRecord[] memory page)
    {
        uint256 total = operators.length;
        if (start >= total) return new NodeRecord[](0);
        uint256 end = start + count;
        if (end > total) end = total;
        uint256 len = end - start;
        page = new NodeRecord[](len);
        for (uint256 i = 0; i < len; i++) {
            page[i] = nodes[operators[start + i]];
        }
    }

    /**
     * @notice Page through ACTIVE operator records only.
     *
     * Filters out deregistered nodes in a single pass. The returned
     * array length equals the number of active records found in the
     * range [start, start+count) of the operators array — may be less
     * than `count`.
     */
    function listActiveNodes(uint256 start, uint256 count)
        external
        view
        returns (NodeRecord[] memory page)
    {
        uint256 total = operators.length;
        if (start >= total) return new NodeRecord[](0);
        uint256 end = start + count;
        if (end > total) end = total;
        // first pass to size
        uint256 activeInRange = 0;
        for (uint256 i = start; i < end; i++) {
            if (nodes[operators[i]].active) activeInRange += 1;
        }
        page = new NodeRecord[](activeInRange);
        uint256 w = 0;
        for (uint256 i = start; i < end; i++) {
            NodeRecord storage r = nodes[operators[i]];
            if (r.active) {
                page[w++] = r;
            }
        }
    }

    /// @notice Convenience: return the caller's own record.
    function myNode() external view returns (NodeRecord memory) {
        return nodes[msg.sender];
    }
}
