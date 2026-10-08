# Ghostty native backend

This directory contains the macOS N-API bridge used by the Ghostty Terminal
Cordis plugin. The generated `GhosttyKit.xcframework`, resources, and `.node`
binary are local build artifacts and are intentionally ignored by Git.

Run `npm run build:ghostty` on macOS to download the pinned Ghostty 1.3.1
source release and Zig 0.15.2, build the framework, and compile the bridge.
The script uses a temporary SDK overlay for Zig 0.15.2: a compatible libSystem
stub for macOS 26.5 and later, and math definitions needed by Xcode 27's headers.
It does not modify the installed Xcode SDK. The math compatibility follows
[Ghostty's upstream approach](https://github.com/ghostty-org/ghostty/blob/main/pkg/apple-sdk/include/math.h).
Zig's static archives are also repacked with Xcode's `ar` and `libtool` before
linking, so their object alignment satisfies the current Apple linker.

Ghostty calls the full surface API `libghostty-internal`. Upstream currently
uses that API for the macOS app and warns that it is not a stable external API.
The version pin keeps API changes deliberate. This backend should be treated as
macOS-only until Ghostty publishes a stable full-renderer embedding API on other
platforms.
