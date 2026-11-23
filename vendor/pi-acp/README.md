---
read_when:
  - Updating Alto's bundled Pi adapter or debugging missing Pi tools
---

# Alto's Pi adapter patch

Alto pins the MIT-licensed `pi-acp@0.0.35` npm package as a build dependency.
Upstream: https://github.com/svkozak/pi-acp (release commit `41fb17a`).
No separate checkout, fork publication, or upstream contribution is required.

`npm run build:pi-adapter` verifies the package version and SHA-256 of its
published entry point, applies `mcp.patch` in memory, and bundles the adapter,
its dependencies, and `mcp-extension.ts` into `dist/node/adapters/pi-acp`.
The original dependency stays untouched. Full builds and development startup
run this step; portable packaging includes the result and license notices.
The runtime does not download or resolve the adapter through npm.

The patch forwards ACP MCP descriptors for new and resumed sessions, advertises
HTTP MCP support, and loads an extension through Pi's existing API. The
extension registers each session's stdio or streamable HTTP servers with direct
tool exposure. Headers and subprocess environment values remain literal and
process-local; no user or project MCP configuration is written. Pi 1.6.0+ with
built-in MCP enabled is required. Legacy SSE is unsupported.

To upgrade, review the new upstream implementation first. If it supports this
behavior, remove the patch and extension. Otherwise update the exact npm pin,
lockfile, patch, and `upstream.json` together. Never update the hash just to
silence a failure. Run the bundled-adapter tests and a live Cordis tool call.
