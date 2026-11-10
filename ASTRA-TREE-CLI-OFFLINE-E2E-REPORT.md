# Tree CLI offline integration verification

Date: 2026-11-07. Runtime: Node v24.22.1.

## Result

Added `astra-tree-cli-offline-e2e-test.js`: 9 tests passed. Combined with the existing 14 read-only connection/CLI tests and 27 treeio tests: 50 passed, 0 failed, 0 skipped. Syntax check passed.

Commands:

- `node --check astra-tree-cli-offline-e2e-test.js`
- `node --test astra-tree-cli-offline-e2e-test.js`
- `node --test astra-readonly-tree-cli-test.js astra-takeover-treeio-test.js astra-tree-cli-offline-e2e-test.js`

## Added coverage

The existing import tests already exercised real treeio functions under VM CLI execution. This addition targets a different boundary: isolated Node child processes execute the actual CLI modules with actual filesystem enumeration, JSON parsing, treeio, kbtree and treepick. Only the database connection is substituted with a synthetic, in-memory SQLite adapter. A strict module-load allowlist blocks production database/configuration, driver and network dependencies.

- Migration CLI: existing branch, grade, unit and point reuse; overlapping legacy units and points; absent target tree; empty grade fallback; absent legacy data; repeated previews with identical output.
- Migration CLI: each missing required table (`bank_trees`, `bank_tree_nodes`, `kb_units`, `kb_points`) fails without initializing schema or reporting a successful summary.
- Import CLI: actual nested directory traversal, UTF-8 BOM, uppercase JSON extension, ignoring non-JSON files, cross-file virtual-node sharing and equivalent `-n` / `--dry-run` results.
- Import CLI: malformed JSON and overlong node names fail before connection loading; missing target table fails without schema initialization.
- Every child run verifies all synthetic table rows and schema are unchanged. SQLite `PRAGMA query_only=ON`, SELECT-only SQL interception and a forbidden transaction boundary provide independent write guards. Existing question links are part of the full snapshot.

## Boundaries

No production source, package scripts, CI or docs were changed. The only additions are the standalone test and this standalone report. No database configuration was loaded, no real MySQL or HTTP was contacted, and no dependencies were installed. The fixtures contain no real student or account information. This is SQLite-backed offline integration coverage, not proof of real MySQL behavior, permissions, collation, deployment or migration safety. The new standalone test requires Node with built-in `node:sqlite` (validated on Node 24); it was deliberately not added to Node 20 CI/package commands.

No new production defect was demonstrated by these cases. Existing live-MySQL `kbtree-test.js` was inspected but not run. The checkout has no Git metadata, and the taskbook referenced by AGENTS.md is absent; existing code and available test contracts were used without altering task scope.
