# Linkkf Player Tools Extension

Chrome/Edge Manifest V3 extension for adding web-fullscreen and Picture-in-Picture controls to Linkkf.

## What it does

- Adds a persistent global ON/OFF switch to the browser toolbar popup. Changing it reloads open supported top-level player pages so every extension-added control and style is either fully applied or fully removed.
- Adds **PIP** and web-fullscreen buttons inside ArtPlayer in this order: **Show Setting → PIP → Web Fullscreen → Fullscreen**.
- Keeps consistent **A↺**, **A-**, and **A+** subtitle-size controls fixed immediately before **Show Setting** on every supported ArtPlayer variant. It removes duplicate site-supplied A-/A+ controls that adjust a different subtitle property, resizes in 5px steps, restores the player's original subtitle style with A↺, and preserves the subtitle's visual center.
- Adds a **화질** button immediately before **A↺**. Its menu reads the active HLS stream's real levels and switches between automatic selection and the available resolutions without restarting playback.
- When an HLS level omits its name and resolution metadata, the quality menu falls back to the active video's decoded dimensions, so a single unnamed `1920×1080` level is shown as **1080p** instead of `화질 1`.
- The quality control's visible label and hover tooltip always show the current selection, such as **1080p** or **자동**, including during web-fullscreen and PIP playback.
- Removes the site's native subtitle-off control and duplicate HLS resolution selector on every supported player while retaining the extension-owned quality control.
- Prioritizes the highest available HLS resolution and bitrate when each player loads. A later manual quality choice remains respected, and normal, web-fullscreen, and composite PIP playback share the same selected source level.
- Toggles a PIP-optimized composite of the Linkkf video with the browser Picture-in-Picture API.
- Draws ArtPlayer's DOM-rendered subtitles directly into the PIP video frames because Edge does not include dynamically-added text tracks in its normal Video PIP window.
- Applies A-/A+ changes to the PIP canvas subtitle itself instead of letting the fixed PIP size cap turn those changes into apparent vertical movement.
- Suppresses ArtPlayer's short bottom-position transition while resizing or resetting subtitles, eliminating the bounce effect in both the original player and PIP output.
- Removes rectangular subtitle backgrounds on every supported player while preserving the text color and outline for readability. The same text-only appearance is used in normal playback, web-fullscreen, and composite PIP.
- Refreshes one short proxy-video frame after a subtitle change while playback is paused, so A-/A+/A↺ changes become visible in Edge PIP without resuming the source video.
- Uses the subtitle-size controls as the width baseline for the active Settings, PIP, Web Fullscreen, and native Fullscreen controls, with consistent 24px SVG icons across player variants.
- Applies the same width and 24px icon baseline to rewind, forward, play/pause, and volume. Compact players keep a 36px resting volume button while preserving the full horizontal slider on hover; `playhd2` keeps its native vertical volume panel.
- Keeps the native play/pause control at the far left of the controller and the volume control immediately after it, followed by the seek controls.
- Keeps **10- → 10+ → 90+** after play and volume. Existing 10-second controls retain their native handlers; player variants without them receive extension-provided 10-second controls, and **90+** works in both the normal player and composite PIP mode, including while paused.
- Keeps play/pause synchronized between the composite PIP video and the real player.
- Preserves source resolution up to Full HD, updates the PIP canvas when an HLS quality switch changes the source dimensions, requests detail-oriented stream encoding, and applies lightweight adaptive GPU sharpening as the PIP window gets smaller. It automatically falls back to the standard 2D renderer when WebGL enhancement is unavailable.
- Visually hides and disables pointer input on the original video and subtitle layers while PIP is open, then restores both automatically when PIP closes. The source media continues decoding so it can supply the PIP picture and audio.
- Shows a non-interactive `PIP 실행 중` status badge at the original player's top-left while PIP is open.
- Finds the visible, playing `<video>` when the player exposes one in the page.
- Handles Linkkf's actual ArtPlayer shell iframe (`/static/player/artplayer/index.html`) when the media is hosted in a nested cross-origin iframe.
- Expands the ArtPlayer/player container itself, so its built-in controls remain available.
- Keeps the web-fullscreen control in the same ArtPlayer position while active; click it again or press `Esc` to exit.
- Treats Space as play/pause exactly once in normal, web-fullscreen, and PIP playback, even after a player control was clicked. The extension suppresses player-specific keyup and synthesized-button duplicates, and its own PIP/web-fullscreen buttons release keyboard focus after activation.
- Hides the pointer together with the web-fullscreen controller after three idle seconds and restores both on the next pointer movement.
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

Alternate NR, NB, SR, and SB player hosts should also be tested on:

https://linkkf.tckopke.com/watch/399032/a1/k2/

If the button appears but the player does not fill the viewport correctly, use Codex to inspect the live DOM and adjust `findContainer()` and the CSS selector.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this project folder.
5. Open/reload the Linkkf video page.
6. Click the toolbar extension icon and leave **확장 기능** switched on.
7. Move the pointer over the player controls and use the PIP or web-fullscreen button before **Fullscreen**.

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
- The extension declares content scripts for Linkkf and the currently observed NR/NR-HD, NB, SR, and SB player families under `*.sub3.top`, `*.sub2.top`, and `*.myani.app`.
- On supported embedded ArtPlayer hosts, the transient 160×160 play/pause state animation at the bottom-right is disabled without disabling click-to-toggle playback or the separate error indicator.
- On supported player hosts, the `Subtitle-Background` and `Subtitle color` controls are removed while the extension's subtitle-size controls remain available.
- Picture-in-Picture behavior is based on GoogleChromeLabs' Apache-2.0-licensed Picture-in-Picture Chrome Extension; see `THIRD_PARTY_NOTICES.md`.
- PIP subtitles preserve ArtPlayer's visible text, approximate color, size, weight, line breaks, and vertical position. Complex HTML effects may be simplified.
