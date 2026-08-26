(() => {
  "use strict";

  const REQUEST_EVENT = "lkf-quality-request";
  const RESPONSE_EVENT = "lkf-quality-response";
  const SET_EVENT = "lkf-quality-set";
  const ENABLE_EVENT = "lkf-quality-bridge-enable";
  let observedHls = null;
  let userSelectedQuality = false;
  let enabled = false;

  function findHls() {
    try {
      if (typeof art !== "undefined" && art?.hls) return art.hls;
    } catch (_) {
      // The site may keep its ArtPlayer instance inside a private scope.
    }

    try {
      if (typeof Artplayer !== "undefined" && Array.isArray(Artplayer.instances)) {
        return Artplayer.instances.find((instance) => instance?.hls)?.hls || null;
      }
    } catch (_) {
      // ArtPlayer is not ready yet.
    }
    return null;
  }

  function serializeLevels(hls) {
    const levels = Array.isArray(hls?.levels) ? hls.levels : [];
    const mediaWidth = Number(hls?.media?.videoWidth) || 0;
    const mediaHeight = Number(hls?.media?.videoHeight) || 0;
    const currentLevel = Number.isInteger(hls?.currentLevel)
      ? hls.currentLevel
      : -1;
    return levels.map((level, index) => {
      const useMediaDimensions = index === currentLevel || levels.length === 1;
      return {
        index,
        width: Number(level?.width) || (useMediaDimensions ? mediaWidth : 0),
        height: Number(level?.height) || (useMediaDimensions ? mediaHeight : 0),
        bitrate: Number(level?.bitrate) || 0,
        name: typeof level?.name === "string" ? level.name : ""
      };
    });
  }

  function findHighestLevelIndex(hls) {
    const levels = serializeLevels(hls);
    if (!levels.length) return -1;
    return levels.reduce((highest, level) => {
      const highestPixels = highest.width * highest.height;
      const levelPixels = level.width * level.height;
      if (levelPixels !== highestPixels) {
        return levelPixels > highestPixels ? level : highest;
      }
      return level.bitrate > highest.bitrate ? level : highest;
    }).index;
  }

  function prioritizeHighestQuality(hls) {
    if (!hls || userSelectedQuality) return;
    const highestLevel = findHighestLevelIndex(hls);
    if (highestLevel >= 0) hls.currentLevel = highestLevel;
  }

  function sendState() {
    const hls = findHls();
    observeHls(hls);
    const levels = serializeLevels(hls);
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      detail: JSON.stringify({
        available: Boolean(hls && levels.length),
        autoEnabled: hls ? hls.autoLevelEnabled !== false : true,
        currentLevel: Number.isInteger(hls?.currentLevel) ? hls.currentLevel : -1,
        levels
      })
    }));
  }

  function observeHls(hls) {
    if (!hls || hls === observedHls || typeof hls.on !== "function") return;
    observedHls = hls;
    userSelectedQuality = false;
    const events = typeof Hls !== "undefined" ? Hls.Events : null;
    if (events?.MANIFEST_PARSED) {
      hls.on(events.MANIFEST_PARSED, () => {
        prioritizeHighestQuality(hls);
        sendState();
      });
    }
    [events?.LEVEL_SWITCHED, events?.LEVEL_LOADED]
      .filter(Boolean)
      .forEach((eventName) => hls.on(eventName, sendState));
    prioritizeHighestQuality(hls);
  }

  function enableBridge() {
    if (enabled) return;
    enabled = true;
    document.addEventListener(REQUEST_EVENT, sendState);
    document.addEventListener(SET_EVENT, (event) => {
      let request;
      try {
        request = typeof event.detail === "string"
          ? JSON.parse(event.detail)
          : event.detail;
      } catch (_) {
        return;
      }

      const hls = findHls();
      const index = Number(request?.index);
      if (!hls || !Number.isInteger(index) ||
        index < -1 || index >= serializeLevels(hls).length) return;

      userSelectedQuality = true;
      hls.currentLevel = index;
      sendState();
      setTimeout(sendState, 250);
    });

    sendState();
    setTimeout(sendState, 250);
    setTimeout(sendState, 1000);
  }

  document.addEventListener(ENABLE_EVENT, enableBridge, { once: true });
  if (document.documentElement.classList.contains("lkf-extension-enabled")) {
    enableBridge();
  }
})();
