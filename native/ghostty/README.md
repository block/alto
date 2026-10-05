# Ghostty native backend

This directory contains the macOS N-API bridge used by the Ghostty Terminal
Cordis plugin. The generated `GhosttyKit.xcframework`, resources, and `.node`
binary are local build artifacts and are intentionally ignored by Git.

Run `npm run build:ghostty` on macOS to download the pinned Ghostty 1.3.1
source release and Zig 0.15.2, build the framework, and compile the bridge.
The script includes the SDK overlay required by Zig 0.15.2 on macOS 26.5.

Ghostty calls the full surface API `libghostty-internal`. Upstream currently
uses that API for the macOS app and warns that it is not a stable external API.
The version pin keeps API changes deliberate. This backend should be treated as
macOS-only until Ghostty publishes a stable full-renderer embedding API on other
platforms.
