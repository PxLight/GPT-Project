# Linkkf Player Tools Extension

Chrome/Edge Manifest V3 extension for adding web-fullscreen and Picture-in-Picture controls to Linkkf.

## What it does

- Adds **PIP** and web-fullscreen buttons inside ArtPlayer in this order: **Show Setting → PIP → Web Fullscreen → Fullscreen**.
- Toggles a PIP-optimized composite of the Linkkf video with the browser Picture-in-Picture API.
- Draws ArtPlayer's DOM-rendered subtitles directly into the PIP video frames because Edge does not include dynamically-added text tracks in its normal Video PIP window.
- Keeps play/pause synchronized between the composite PIP video and the real player.
- Preserves source resolution up to Full HD, enables high-quality canvas scaling, and applies lightweight adaptive GPU sharpening as the PIP window gets smaller. It automatically falls back to the standard 2D renderer when WebGL enhancement is unavailable.
- Visually hides and disables pointer input on the original video and subtitle layers while PIP is open, then restores both automatically when PIP closes. The source media continues decoding so it can supply the PIP picture and audio.
- Shows a non-interactive `PIP 실행 중` status badge at the original player's top-left while PIP is open.
- Finds the visible, playing `<video>` when the player exposes one in the page.
- Handles Linkkf's actual ArtPlayer shell iframe (`/static/player/artplayer/index.html`) when the media is hosted in a nested cross-origin iframe.
- Expands the ArtPlayer/player container itself, so its built-in controls remain available.
- Keeps the web-fullscreen control in the same ArtPlayer position while active; click it again or press `Esc` to exit.
- Expands that container to `100vw × 100vh` without browser/F11 fullscreen.
- Promotes the complete player ancestor path out of site stacking contexts, suppresses sibling/ad layers (including dynamically inserted ones), and places an isolated black backdrop directly below the player while web fullscreen is active.
- Temporarily detaches Google anchor ads (`adsbygoogle`, `aswift`, DoubleClick advertisement frames) and MediaGo placements (`mgcontainer-*`, `mediago-placement`) during web fullscreen, then restores them to their original DOM positions on exit. This defeats inline `!important`, maximum z-index, and closed shadow-root overlays.
- Press `Esc` to exit.
- Watches the DOM because the video player may be created/replaced dynamically.

## Important

The Linkkf test page currently renders ArtPlayer in an iframe and the embedded
source may render the actual `<video>` in a nested cross-origin iframe. The
extension therefore uses the ArtPlayer shell iframe as a safe fullscreen target
when a top-level video cannot be inspected. Test on:

https://linkkf.tckopke.com/watch/407636/a1/k1/

The alternate `play.sub3.top` player host is used by and should also be tested on:

https://linkkf.tckopke.com/watch/399032/a1/k2/

If the button appears but the player does not fill the viewport correctly, use Codex to inspect the live DOM and adjust `findContainer()` and the CSS selector.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this project folder.
5. Open/reload the Linkkf video page.
6. Move the pointer over the player controls and use the PIP or web-fullscreen button before **Fullscreen**.

## Codex handoff

Run Codex from this directory:

```bash
codex
```

Suggested first instruction:

> Read README.md and inspect the current extension. I want this to work reliably on https://linkkf.tckopke.com/watch/407636/a1/k1/. Analyze the live DOM/player structure, especially ArtPlayer elements and dynamically-created video elements. Improve the extension so the web-fullscreen button reliably expands only the video player to the viewport, preserves playback controls, exits with Escape, and survives player replacement/episode navigation. Do not use browser F11 fullscreen unless explicitly requested.

## Project notes

- Manifest V3 is used.
- No remote code or third-party libraries are included.
- The extension declares content scripts only for Linkkf and its current embedded video hosts (`play.sub3.top` and `playv2.sub3.top`).
- On both `play.sub3.top` and `playv2.sub3.top`, the transient 160×160 ArtPlayer play/pause state animation at the bottom-right is disabled without disabling click-to-toggle playback or the separate error indicator.
- On both supported player hosts, the `Subtitle-Background` and `Subtitle color` controls are removed while the `A-` and `A+` subtitle-size controls remain available.
- Picture-in-Picture behavior is based on GoogleChromeLabs' Apache-2.0-licensed Picture-in-Picture Chrome Extension; see `THIRD_PARTY_NOTICES.md`.
- PIP subtitles preserve ArtPlayer's visible text, approximate color, size, weight, line breaks, and vertical position. Complex HTML effects may be simplified.
