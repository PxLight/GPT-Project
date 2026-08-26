# Codex Task: Make Linkkf Web Fullscreen Reliable

Target:
https://linkkf.tckopke.com/watch/407636/a1/k1/

Goal:
Add a reliable web-fullscreen button to the Linkkf video player. Web-fullscreen means the player occupies the browser viewport while the browser chrome/address bar remains visible.

Acceptance criteria:
- Works after the player is dynamically created.
- Finds the actual playing `<video>` rather than an unrelated hidden video.
- Expands the correct ArtPlayer/player container to 100vw × 100vh.
- Keeps the video aspect ratio with contain.
- Existing player controls remain usable.
- Escape exits.
- Player replacement/episode changes do not leave stale fullscreen state.
- Does not use browser Fullscreen API unless needed as an optional future mode.
- Does not interfere with normal page behavior when inactive.

Please inspect the live page DOM in Chrome DevTools before making assumptions about class names.
