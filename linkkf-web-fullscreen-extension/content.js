(async () => {
  "use strict";

  const EXTENSION_ENABLED_KEY = "lkfExtensionEnabled";
  const EXTENSION_ENABLED_CLASS = "lkf-extension-enabled";
  const QUALITY_BRIDGE_ENABLE_EVENT = "lkf-quality-bridge-enable";

  if (window === window.top) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[EXTENSION_ENABLED_KEY] ||
        changes[EXTENSION_ENABLED_KEY].oldValue ===
          changes[EXTENSION_ENABLED_KEY].newValue) return;
      location.reload();
    });
  }

  let extensionEnabled = true;
  try {
    const stored = await chrome.storage.local.get({
      [EXTENSION_ENABLED_KEY]: true
    });
    extensionEnabled = stored[EXTENSION_ENABLED_KEY] !== false;
  } catch (error) {
    console.warn("[Linkkf Player Tools] enabled state could not be read", error);
    return;
  }

  if (!extensionEnabled) return;
  document.documentElement.classList.add(EXTENSION_ENABLED_CLASS);
  document.dispatchEvent(new CustomEvent(QUALITY_BRIDGE_ENABLE_EVENT));

  const TARGET_CLASS = "lkf-web-fullscreen-target";
  const LOCK_CLASS = "lkf-web-fullscreen-lock";
  const LAYER_PATH_CLASS = "lkf-web-fullscreen-layer-path";
  const SUPPRESSED_CLASS = "lkf-web-fullscreen-suppressed";
  const BACKDROP_ID = "lkf-web-fullscreen-backdrop";
  const FULLSCREEN_AD_SELECTOR = [
    "ins.adsbygoogle",
    ".adsbygoogle-noablate",
    "[data-anchor-status='displayed']",
    "[data-anchor-shown='true']",
    "iframe[title='Advertisement']",
    "iframe[aria-label='Advertisement']",
    "iframe[src*='googleads.g.doubleclick.net']",
    "[id^='aswift_'][id$='_host']",
    "[id^='mgcontainer-']",
    ".mediago-placement",
    "[class*='mediago-placement_']"
  ].join(",");
  const FULLSCREEN_AD_ROOT_SELECTOR = [
    "ins.adsbygoogle",
    "[data-anchor-status='displayed']",
    "[data-anchor-shown='true']",
    "[id^='mgcontainer-']",
    ".mediago-placement",
    "[id^='aswift_'][id$='_host']"
  ].join(",");
  const DISABLED_NATIVE_CONTROL_SELECTOR = [
    ".art-controls-right > .art-control-control10[aria-label='자막 끄기']",
    ".art-controls-right > [aria-label='Subtitle Off']",
    ".art-controls-right > .art-control-hls-quality:not(.lkf-quality-control)"
  ].join(",");
  const BUTTON_ID = "lkf-web-fullscreen-control";
  const PIP_BUTTON_ID = "lkf-picture-in-picture-control";
  const FORWARD_90_BUTTON_CLASS = "lkf-forward-90-control";
  const FORWARD_90_SECONDS = 90;
  const BACKWARD_10_BUTTON_CLASS = "lkf-backward-10-control";
  const FORWARD_10_BUTTON_CLASS = "lkf-forward-10-control";
  const QUALITY_CONTROL_CLASS = "lkf-quality-control";
  const QUALITY_REQUEST_EVENT = "lkf-quality-request";
  const QUALITY_RESPONSE_EVENT = "lkf-quality-response";
  const QUALITY_SET_EVENT = "lkf-quality-set";
  const SUBTITLE_SIZE_STEP = 5;
  const SUBTITLE_SIZE_MIN = 10;
  const SUBTITLE_SIZE_MAX = 120;
  const SUBTITLE_RESIZE_INSTANT_CLASS = "lkf-subtitle-resize-instant";
  const PIP_STATUS_ID = "lkf-picture-in-picture-status";
  const PIP_PROXY_CLASS = "lkf-picture-in-picture-proxy";
  const PIP_MAX_WIDTH = 1920;
  const ESCAPE_MESSAGE = "lkf-web-fullscreen-escape";
  const TOGGLE_MESSAGE = "lkf-web-fullscreen-toggle";
  const STATE_MESSAGE = "lkf-web-fullscreen-state";
  const READY_MESSAGE = "lkf-web-fullscreen-ready";
  const CONTROLS_MESSAGE = "lkf-web-fullscreen-controls";
  const CONTROLS_MODE_CLASS = "lkf-web-fullscreen-controls-mode";
  const CONTROLS_VISIBLE_CLASS = "lkf-web-fullscreen-controls-visible";
  const PLAYER_ACTIVE_CLASS = "lkf-web-fullscreen-player-active";
  const PIP_ACTIVE_CLASS = "lkf-picture-in-picture-active";
  const CUSTOM_PLAYER_CLASS = "lkf-sub3-player-customized";
  const COMPACT_CONTROLS_CLASS = "lkf-compact-player-controls";
  const PLAYER_HOST_SUFFIXES = ["sub2.top", "sub3.top", "myani.app"];
  const LINKKF_ORIGIN = "https://linkkf.tckopke.com";
  const isTopFrame = window === window.top;
  let active = null;
  let controlsTimer = null;
  let controlsModeActive = false;
  let subtitleFontSizeOverride = null;
  let subtitleOriginalStyles = new WeakMap();
  let subtitleTransitionFrameId = null;
  let qualityAvailable = false;
  let qualityAutoEnabled = true;
  let qualityCurrentLevel = -1;
  let qualityLevels = [];
  let observedPipVideo = null;
  let pipSourceVideo = null;
  let pipProxyVideo = null;
  let pipCanvas = null;
  let pipCanvasContext = null;
  let pipCanvasStream = null;
  let pipCanvasTrack = null;
  let pipVideoEnhancer = null;
  let pipWindow = null;
  let pipSubtitleBaseFontSize = null;
  let pipRenderFrameId = null;
  let pipRenderTimer = null;
  let pipPausedFrameRefreshTimer = null;
  let pipPausedFrameRefreshActive = false;
  let pipSubtitleObserver = null;
  let remoteFullscreenActive = false;
  const detachedFullscreenAds = new Map();

  const log = (...args) => console.debug("[Linkkf Web Fullscreen]", ...args);

  function isPlayerHost(hostname = location.hostname) {
    return PLAYER_HOST_SUFFIXES.some((suffix) =>
      hostname === suffix || hostname.endsWith(`.${suffix}`)
    );
  }

  function isTrustedMessageOrigin(origin) {
    if (origin === LINKKF_ORIGIN) return true;
    try {
      const url = new URL(origin);
      return url.protocol === "https:" && isPlayerHost(url.hostname);
    } catch (_) {
      return false;
    }
  }

  function isVisible(video) {
    if (!(video instanceof HTMLVideoElement) || !video.isConnected) return false;
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    return rect.width > 160 && rect.height > 90 &&
      style.display !== "none" && style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 && video.getClientRects().length > 0;
  }

  function isVisibleElement(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 160 && rect.height > 90 &&
      style.display !== "none" && style.visibility !== "hidden" &&
      Number(style.opacity) !== 0;
  }

  // A Linkkf page can keep preload/ad videos around. Prefer a video that is
  // actually playing, then one that belongs to an ArtPlayer instance.
  function findBestVideo() {
    const videos = [...document.querySelectorAll("video")].filter(isVisible);
    if (!videos.length) return null;

    const score = (candidate) => {
      const rect = candidate.getBoundingClientRect();
      const inArtPlayer = candidate.closest(
        ".art-video-player, .artplayer-app, [class*='artplayer']"
      );
      return (candidate.paused || candidate.ended ? 0 : 1e12) +
        (candidate.currentTime > 0 ? 1e9 : 0) +
        (inArtPlayer ? 1e7 : 0) + rect.width * rect.height;
    };
    return videos.reduce((best, video) => score(video) > score(best) ? video : best);
  }

  function findContainer(video) {
    if (!video) return null;

    // ArtPlayer's controls are inside .art-video-player. Selecting this
    // element keeps those controls with the video while avoiding the page's
    // surrounding layout wrappers.
    const artPlayer = video.closest(".art-video-player");
    if (artPlayer) return artPlayer;

    const knownPlayer = video.closest(
      ".artplayer-app, .art-player, [data-artplayer], [data-art-player], [class*='artplayer']"
    );
    if (knownPlayer) return knownPlayer;

    // Use a small, visible wrapper as a conservative fallback. Never promote
    // the player to main/body: that would fullscreen the rest of the page.
    let candidate = video.parentElement;
    for (let depth = 0; candidate && candidate !== document.body && depth < 5;
      candidate = candidate.parentElement, depth += 1) {
      const rect = candidate.getBoundingClientRect();
      if (rect.width >= 200 && rect.height >= 120) return candidate;
    }
    return video.parentElement;
  }

  // Linkkf places ArtPlayer in a same-origin shell iframe. Some sources put
  // the actual media in one more cross-origin iframe, where a content script
  // cannot inspect the video element. Expanding the ArtPlayer shell preserves
  // its controls and is the correct web-fullscreen target in that case.
  function findArtPlayerFrame() {
    return [...document.querySelectorAll("iframe")]
      .filter(isVisibleElement)
      .find((frame) => /\/static\/player\/artplayer\/index\.html(?:[?#]|$)/.test(frame.src)) || null;
  }

  function findTarget() {
    const video = findBestVideo();
    if (video) return { container: findContainer(video), video };

    const playerFrame = findArtPlayerFrame();
    return playerFrame ? { container: playerFrame, video: null } : null;
  }

  function postToChildFrames(message) {
    for (let index = 0; index < window.frames.length; index += 1) {
      window.frames[index].postMessage(message, "*");
    }
  }

  function updatePlayerButtonState(isActive) {
    document.documentElement.classList.toggle(PLAYER_ACTIVE_CLASS, isActive);
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.setAttribute("aria-pressed", String(isActive));
    button.setAttribute("aria-label", isActive ? "웹 전체화면 해제" : "웹 전체화면");
    button.title = isActive ? "웹 전체화면 해제 (Esc)" : "웹 전체화면";
  }

  function requestToggle() {
    window.top.postMessage({ type: TOGGLE_MESSAGE }, LINKKF_ORIGIN);
  }

  function updatePictureInPictureButton() {
    const isActive = Boolean(document.pictureInPictureElement);
    document.documentElement.classList.toggle(PIP_ACTIVE_CLASS, isActive);
    const button = document.getElementById(PIP_BUTTON_ID);
    if (!button) return;
    button.setAttribute("aria-pressed", String(isActive));
    button.setAttribute("aria-label", isActive ? "PIP 해제" : "PIP 모드");
    button.title = isActive ? "PIP 해제" : "PIP 모드";
  }

  function readArtPlayerSubtitle() {
    const subtitle = document.querySelector(".art-subtitle");
    if (!(subtitle instanceof HTMLElement)) return { source: null, lines: [] };

    const style = getComputedStyle(subtitle);
    const hiddenByPip = document.documentElement.classList.contains(PIP_ACTIVE_CLASS);
    if (style.display === "none" || (!hiddenByPip &&
      (style.visibility === "hidden" || Number(style.opacity) === 0))) {
      return { source: subtitle, lines: [] };
    }

    let lines = [...subtitle.querySelectorAll(".art-subtitle-line")]
      .filter((line) => {
        const lineStyle = getComputedStyle(line);
        return lineStyle.display !== "none" && (hiddenByPip ||
          (lineStyle.visibility !== "hidden" && Number(lineStyle.opacity) !== 0));
      })
      .map((line) => {
        const lineStyle = getComputedStyle(line);
        return {
          text: line.textContent.replace(/\s+/g, " ").trim(),
          color: lineStyle.color || "#fff",
          fontSize: Number.parseFloat(lineStyle.fontSize) || 28,
          fontWeight: lineStyle.fontWeight || "700",
          fontStyle: lineStyle.fontStyle || "normal",
          lineHeight: Number.parseFloat(lineStyle.lineHeight) || 36
        };
      })
      .filter((line) => line.text);
    if (!lines.length) {
      lines = subtitle.innerText.split(/\n+/)
        .map((text) => text.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .map((text) => ({
          text,
          color: style.color || "#fff",
          fontSize: Number.parseFloat(style.fontSize) || 28,
          fontWeight: style.fontWeight || "700",
          fontStyle: style.fontStyle || "normal",
          lineHeight: Number.parseFloat(style.lineHeight) || 36
        }));
    }

    const subtitleRect = subtitle.getBoundingClientRect();
    const videoRect = pipSourceVideo?.getBoundingClientRect();
    const centerRatio = videoRect?.height
      ? (subtitleRect.top + subtitleRect.height / 2 - videoRect.top) / videoRect.height
      : 0.88;
    return {
      source: subtitle,
      lines,
      centerRatio: Math.min(0.96, Math.max(0.04, centerRatio)),
      scaleBaseHeight: videoRect?.height || pipCanvas?.height || 720
    };
  }

  function wrapCanvasText(context, text, maxWidth) {
    const rows = [];
    let row = "";
    for (const character of text) {
      const candidate = row + character;
      if (row && context.measureText(candidate).width > maxWidth) {
        rows.push(row.trim());
        row = character;
      } else {
        row = candidate;
      }
    }
    if (row.trim()) rows.push(row.trim());
    return rows;
  }

  function drawPipSubtitle() {
    if (!pipCanvasContext || !pipCanvas) return;
    const subtitle = readArtPlayerSubtitle();
    if (!subtitle.lines.length) {
      delete pipCanvas.dataset.lkfSubtitleFontSize;
      return;
    }

    const context = pipCanvasContext;
    const scale = pipCanvas.height / subtitle.scaleBaseHeight;
    const maxWidth = pipCanvas.width * 0.94;
    const renderedLines = [];
    for (const line of subtitle.lines) {
      if (!Number.isFinite(pipSubtitleBaseFontSize)) {
        pipSubtitleBaseFontSize = line.fontSize;
      }
      const sizeRatio = Number.isFinite(pipSubtitleBaseFontSize) &&
        pipSubtitleBaseFontSize > 0
        ? line.fontSize / pipSubtitleBaseFontSize
        : 1;
      const initialFontSize = Math.min(
        pipCanvas.height * 0.07,
        Math.max(18, pipSubtitleBaseFontSize * scale)
      );
      const fontSize = Math.min(
        pipCanvas.height * 0.16,
        Math.max(12, initialFontSize * sizeRatio)
      );
      context.font = `${line.fontStyle} ${line.fontWeight} ${fontSize}px Arial, sans-serif`;
      for (const text of wrapCanvasText(context, line.text, maxWidth)) {
        renderedLines.push({ ...line, text, fontSize });
      }
    }

    if (!renderedLines.length) {
      delete pipCanvas.dataset.lkfSubtitleFontSize;
      return;
    }
    pipCanvas.dataset.lkfSubtitleFontSize = renderedLines
      .map((line) => line.fontSize.toFixed(2))
      .join(",");
    const lineHeight = Math.max(...renderedLines.map((line) =>
      Math.max(line.fontSize * 1.25, line.lineHeight * scale)
    ));
    const blockHeight = lineHeight * renderedLines.length;
    const desiredCenter = pipCanvas.height * subtitle.centerRatio;
    const center = Math.min(
      pipCanvas.height - blockHeight / 2 - pipCanvas.height * 0.02,
      Math.max(blockHeight / 2 + pipCanvas.height * 0.02, desiredCenter)
    );
    let baseline = center - blockHeight / 2 + lineHeight * 0.8;

    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.lineJoin = "round";
    for (const line of renderedLines) {
      context.font = `${line.fontStyle} ${line.fontWeight} ${line.fontSize}px Arial, sans-serif`;
      context.lineWidth = Math.max(3, line.fontSize * 0.13);
      context.strokeStyle = "rgba(0, 0, 0, 0.92)";
      context.fillStyle = line.color;
      context.strokeText(line.text, pipCanvas.width / 2, baseline, maxWidth);
      context.fillText(line.text, pipCanvas.width / 2, baseline, maxWidth);
      baseline += lineHeight;
    }
  }

  function compilePipShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      log("PIP enhancement shader failed", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createPipVideoEnhancer(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance"
    });
    if (!gl) return null;

    const vertexShader = compilePipShader(gl, gl.VERTEX_SHADER, `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `);
    const fragmentShader = compilePipShader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D u_image;
      uniform vec2 u_texel;
      uniform float u_strength;
      varying vec2 v_texCoord;
      void main() {
        vec4 center = texture2D(u_image, v_texCoord);
        vec3 neighbours =
          texture2D(u_image, v_texCoord + vec2(u_texel.x, 0.0)).rgb +
          texture2D(u_image, v_texCoord - vec2(u_texel.x, 0.0)).rgb +
          texture2D(u_image, v_texCoord + vec2(0.0, u_texel.y)).rgb +
          texture2D(u_image, v_texCoord - vec2(0.0, u_texel.y)).rgb;
        vec3 sharpened = center.rgb + u_strength * (4.0 * center.rgb - neighbours);
        gl_FragColor = vec4(clamp(sharpened, 0.0, 1.0), center.a);
      }
    `);
    if (!vertexShader || !fragmentShader) return null;

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      log("PIP enhancement program failed", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 0,
      1, -1, 1, 0,
      -1, 1, 0, 1,
      1, 1, 1, 1
    ]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    const textureCoordinate = gl.getAttribLocation(program, "a_texCoord");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(textureCoordinate);
    gl.vertexAttribPointer(textureCoordinate, 2, gl.FLOAT, false, 16, 8);

    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.uniform1i(gl.getUniformLocation(program, "u_image"), 0);
    gl.uniform2f(gl.getUniformLocation(program, "u_texel"), 1 / width, 1 / height);

    return {
      canvas,
      gl,
      program,
      texture,
      strengthLocation: gl.getUniformLocation(program, "u_strength")
    };
  }

  function getAdaptivePipSharpness() {
    const visibleWidth = Math.max(1, pipWindow?.width || 640);
    const shrinkRatio = (pipCanvas?.width || PIP_MAX_WIDTH) / visibleWidth;
    return Math.min(0.24, Math.max(0.04, (shrinkRatio - 1) * 0.055));
  }

  function renderEnhancedPipVideo() {
    if (!pipVideoEnhancer || !pipSourceVideo) return false;
    const { gl, texture, strengthLocation } = pipVideoEnhancer;
    try {
      gl.viewport(0, 0, pipVideoEnhancer.canvas.width, pipVideoEnhancer.canvas.height);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pipSourceVideo
      );
      gl.uniform1f(strengthLocation, getAdaptivePipSharpness());
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    } catch (error) {
      log("PIP GPU enhancement is unavailable; using 2D fallback", error);
      pipVideoEnhancer = null;
      return false;
    }
  }

  function drawPipFrame() {
    if (!pipSourceVideo || !pipCanvasContext || !pipCanvas) return;
    const context = pipCanvasContext;
    context.fillStyle = "#000";
    context.fillRect(0, 0, pipCanvas.width, pipCanvas.height);
    if (pipSourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const videoSource = renderEnhancedPipVideo()
        ? pipVideoEnhancer.canvas
        : pipSourceVideo;
      context.drawImage(videoSource, 0, 0, pipCanvas.width, pipCanvas.height);
    }
    drawPipSubtitle();
    pipCanvasTrack?.requestFrame?.();
  }

  function getPipCanvasDimensions(video) {
    const sourceWidth = video.videoWidth || 1280;
    const sourceHeight = video.videoHeight || 720;
    const scale = Math.min(1, PIP_MAX_WIDTH / sourceWidth);
    return {
      width: Math.max(2, Math.round(sourceWidth * scale)),
      height: Math.max(2, Math.round(sourceHeight * scale))
    };
  }

  function handlePipSourceResize() {
    if (!pipSourceVideo || !pipCanvas || !pipCanvasContext) return;
    const { width, height } = getPipCanvasDimensions(pipSourceVideo);
    if (pipCanvas.width === width && pipCanvas.height === height) return;

    pipCanvas.width = width;
    pipCanvas.height = height;
    pipCanvasContext.imageSmoothingEnabled = true;
    pipCanvasContext.imageSmoothingQuality = "high";
    pipVideoEnhancer?.gl.getExtension("WEBGL_lose_context")?.loseContext();
    pipVideoEnhancer = createPipVideoEnhancer(width, height);
    redrawPipSubtitleNow();
  }

  function refreshPausedPipFrame() {
    if (!pipProxyVideo?.paused || !pipSourceVideo?.paused) return;

    clearTimeout(pipPausedFrameRefreshTimer);
    pipPausedFrameRefreshActive = true;
    pipProxyVideo.play().then(() => {
      pipPausedFrameRefreshTimer = setTimeout(() => {
        pipPausedFrameRefreshTimer = null;
        if (pipProxyVideo && pipSourceVideo?.paused) pipProxyVideo.pause();
        pipPausedFrameRefreshActive = false;
      }, 80);
    }).catch((error) => {
      pipPausedFrameRefreshActive = false;
      log("paused PIP frame refresh failed", error);
    });
  }

  function redrawPipSubtitleNow() {
    if (!pipCanvas || !pipProxyVideo) return;
    drawPipFrame();
    refreshPausedPipFrame();
  }

  function schedulePipRendering() {
    drawPipFrame();
    if (typeof pipSourceVideo.requestVideoFrameCallback === "function") {
      const renderFrame = () => {
        drawPipFrame();
        pipRenderFrameId = pipSourceVideo?.requestVideoFrameCallback(renderFrame) ?? null;
      };
      pipRenderFrameId = pipSourceVideo.requestVideoFrameCallback(renderFrame);
    } else {
      pipRenderTimer = setInterval(drawPipFrame, 1000 / 30);
    }

    const { source } = readArtPlayerSubtitle();
    if (source) {
      pipSubtitleObserver = new MutationObserver(redrawPipSubtitleNow);
      pipSubtitleObserver.observe(source, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true
      });
    }
  }

  function syncSourcePlaybackToProxy() {
    if (!pipSourceVideo || !pipProxyVideo) return;
    if (pipSourceVideo.paused && !pipProxyVideo.paused) pipProxyVideo.pause();
    if (!pipSourceVideo.paused && pipProxyVideo.paused) {
      pipProxyVideo.play().catch((error) => log("PIP proxy could not resume", error));
    }
  }

  function syncProxyPlaybackToSource() {
    if (!pipSourceVideo || !pipProxyVideo) return;
    if (pipPausedFrameRefreshActive) return;
    if (pipProxyVideo.paused && !pipSourceVideo.paused) pipSourceVideo.pause();
    if (!pipProxyVideo.paused && pipSourceVideo.paused) {
      pipSourceVideo.play().catch((error) => log("source video could not resume", error));
    }
  }

  function cleanupPipProxy() {
    pipSubtitleObserver?.disconnect();
    pipSubtitleObserver = null;
    if (pipRenderFrameId !== null && pipSourceVideo &&
      typeof pipSourceVideo.cancelVideoFrameCallback === "function") {
      pipSourceVideo.cancelVideoFrameCallback(pipRenderFrameId);
    }
    pipRenderFrameId = null;
    clearInterval(pipRenderTimer);
    pipRenderTimer = null;
    clearTimeout(pipPausedFrameRefreshTimer);
    pipPausedFrameRefreshTimer = null;
    pipPausedFrameRefreshActive = false;

    pipSourceVideo?.removeEventListener("play", syncSourcePlaybackToProxy);
    pipSourceVideo?.removeEventListener("pause", syncSourcePlaybackToProxy);
    pipSourceVideo?.removeEventListener("resize", handlePipSourceResize);
    pipProxyVideo?.removeEventListener("play", syncProxyPlaybackToSource);
    pipProxyVideo?.removeEventListener("pause", syncProxyPlaybackToSource);
    pipProxyVideo?.removeEventListener("enterpictureinpicture", updatePictureInPictureButton);
    pipProxyVideo?.removeEventListener("leavepictureinpicture", handleProxyPictureInPictureLeave);

    if (pipProxyVideo) {
      pipProxyVideo.pause();
      pipProxyVideo.srcObject = null;
      pipProxyVideo.remove();
    }
    pipCanvasStream?.getTracks().forEach((track) => track.stop());
    pipVideoEnhancer?.gl.getExtension("WEBGL_lose_context")?.loseContext();
    pipCanvas?.remove();
    pipSourceVideo = null;
    pipProxyVideo = null;
    pipCanvas = null;
    pipCanvasContext = null;
    pipCanvasStream = null;
    pipCanvasTrack = null;
    pipVideoEnhancer = null;
    pipWindow = null;
    pipSubtitleBaseFontSize = null;
  }

  function handleProxyPictureInPictureLeave() {
    cleanupPipProxy();
    updatePictureInPictureButton();
  }

  async function createPipProxy(video) {
    cleanupPipProxy();
    pipSourceVideo = video;
    const currentSubtitle = getSubtitleElements()[0];
    const currentSubtitleSize = currentSubtitle
      ? Number.parseFloat(getComputedStyle(currentSubtitle).fontSize)
      : Number.NaN;
    pipSubtitleBaseFontSize = Number.isFinite(currentSubtitleSize)
      ? currentSubtitleSize
      : null;
    const { width, height } = getPipCanvasDimensions(video);

    pipCanvas = document.createElement("canvas");
    pipCanvas.className = PIP_PROXY_CLASS;
    pipCanvas.width = width;
    pipCanvas.height = height;
    pipCanvas.setAttribute("aria-hidden", "true");
    pipCanvasContext = pipCanvas.getContext("2d", { alpha: false });
    if (!pipCanvasContext || typeof pipCanvas.captureStream !== "function") {
      throw new Error("canvas captureStream is unavailable");
    }
    pipCanvasContext.imageSmoothingEnabled = true;
    pipCanvasContext.imageSmoothingQuality = "high";
    pipVideoEnhancer = createPipVideoEnhancer(pipCanvas.width, pipCanvas.height);

    drawPipFrame();
    pipCanvasStream = pipCanvas.captureStream(30);
    pipCanvasTrack = pipCanvasStream.getVideoTracks()[0] || null;
    if (pipCanvasTrack && "contentHint" in pipCanvasTrack) {
      pipCanvasTrack.contentHint = "detail";
    }
    pipProxyVideo = document.createElement("video");
    pipProxyVideo.className = PIP_PROXY_CLASS;
    pipProxyVideo.muted = true;
    pipProxyVideo.autoplay = true;
    pipProxyVideo.playsInline = true;
    pipProxyVideo.srcObject = pipCanvasStream;
    document.body.append(pipCanvas, pipProxyVideo);
    video.addEventListener("resize", handlePipSourceResize);
    schedulePipRendering();
    await pipProxyVideo.play();
    return pipProxyVideo;
  }

  function handlePictureInPictureEnter() {
    updatePictureInPictureButton();
  }

  function handlePictureInPictureLeave(event) {
    if (event.currentTarget === pipProxyVideo) cleanupPipProxy();
    updatePictureInPictureButton();
  }

  function observePictureInPictureVideo(video) {
    if (!(video instanceof HTMLVideoElement) || observedPipVideo === video) return;
    if (observedPipVideo) {
      observedPipVideo.removeEventListener("enterpictureinpicture", handlePictureInPictureEnter);
      observedPipVideo.removeEventListener("leavepictureinpicture", handlePictureInPictureLeave);
    }
    observedPipVideo = video;
    video.addEventListener("enterpictureinpicture", handlePictureInPictureEnter);
    video.addEventListener("leavepictureinpicture", handlePictureInPictureLeave);
    updatePictureInPictureButton();
  }

  async function togglePictureInPicture() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }

      const video = findBestVideo();
      if (!video || video.disablePictureInPicture ||
        typeof video.requestPictureInPicture !== "function") {
        log("picture-in-picture video is unavailable");
        return;
      }

      observePictureInPictureVideo(video);
      const proxy = await createPipProxy(video);
      proxy.addEventListener("enterpictureinpicture", updatePictureInPictureButton);
      proxy.addEventListener("leavepictureinpicture", handleProxyPictureInPictureLeave);
      pipWindow = await proxy.requestPictureInPicture();
      if (video.paused) proxy.pause();
      video.addEventListener("play", syncSourcePlaybackToProxy);
      video.addEventListener("pause", syncSourcePlaybackToProxy);
      proxy.addEventListener("play", syncProxyPlaybackToSource);
      proxy.addEventListener("pause", syncProxyPlaybackToSource);
    } catch (error) {
      if (!document.pictureInPictureElement) cleanupPipProxy();
      log("picture-in-picture request failed", error);
    } finally {
      updatePictureInPictureButton();
    }
  }

  function createPictureInPictureButton(referenceButton) {
    if (document.getElementById(PIP_BUTTON_ID) || !document.pictureInPictureEnabled) return null;

    const button = document.createElement("button");
    button.id = PIP_BUTTON_ID;
    button.type = "button";
    button.className = "art-control art-control-lkf-picture-in-picture hint--rounded hint--top";
    button.setAttribute("aria-label", "PIP 모드");
    button.setAttribute("aria-pressed", "false");
    button.title = "PIP 모드";
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M19 7h-8v6h8V7Zm2-4c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2H3c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h18Zm0 2H3v14h18V5Z" />
      </svg>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      button.blur();
      void togglePictureInPicture();
    });
    referenceButton.parentElement.insertBefore(button, referenceButton);
    updatePictureInPictureButton();
    return button;
  }

  function getSubtitleElements() {
    return [...document.querySelectorAll(".art-video-player .art-subtitle")]
      .filter((subtitle) => subtitle instanceof HTMLElement);
  }

  function beginInstantSubtitleResize(subtitles) {
    if (subtitleTransitionFrameId !== null) {
      cancelAnimationFrame(subtitleTransitionFrameId);
      subtitleTransitionFrameId = null;
    }
    document.documentElement.classList.add(SUBTITLE_RESIZE_INSTANT_CLASS);
    for (const subtitle of subtitles) void subtitle.offsetHeight;
  }

  function finishInstantSubtitleResize(subtitles) {
    for (const subtitle of subtitles) void subtitle.offsetHeight;
    subtitleTransitionFrameId = requestAnimationFrame(() => {
      document.documentElement.classList.remove(SUBTITLE_RESIZE_INSTANT_CLASS);
      subtitleTransitionFrameId = null;
    });
  }

  function applySubtitleFontSizeOverride(preserveCenter = false) {
    if (!Number.isFinite(subtitleFontSizeOverride)) return;
    const subtitles = getSubtitleElements();
    const originalCenters = preserveCenter
      ? new Map(subtitles.map((subtitle) => {
        const rect = subtitle.getBoundingClientRect();
        return [subtitle, rect.top + rect.height / 2];
      }))
      : null;
    beginInstantSubtitleResize(subtitles);

    for (const subtitle of subtitles) {
      if (!subtitleOriginalStyles.has(subtitle)) {
        subtitleOriginalStyles.set(subtitle, {
          fontSize: subtitle.style.getPropertyValue("font-size"),
          fontSizePriority: subtitle.style.getPropertyPriority("font-size"),
          bottom: subtitle.style.getPropertyValue("bottom"),
          bottomPriority: subtitle.style.getPropertyPriority("bottom")
        });
      }
      subtitle.style.setProperty(
        "font-size",
        `${subtitleFontSizeOverride}px`,
        "important"
      );
    }

    if (originalCenters) {
      for (const subtitle of subtitles) {
        const originalCenter = originalCenters.get(subtitle);
        const rect = subtitle.getBoundingClientRect();
        const computedBottom = getComputedStyle(subtitle).bottom;
        const bottom = Number.parseFloat(computedBottom);
        if (!Number.isFinite(originalCenter) || rect.height <= 0 ||
          !computedBottom.endsWith("px") || !Number.isFinite(bottom)) continue;

        const currentCenter = rect.top + rect.height / 2;
        subtitle.style.setProperty(
          "bottom",
          `${bottom + currentCenter - originalCenter}px`,
          "important"
        );
      }
    }
    finishInstantSubtitleResize(subtitles);
  }

  function restoreStyleProperty(element, property, value, priority) {
    if (value) element.style.setProperty(property, value, priority);
    else element.style.removeProperty(property);
  }

  function resetSubtitleFontSize() {
    subtitleFontSizeOverride = null;
    const subtitles = getSubtitleElements();
    beginInstantSubtitleResize(subtitles);
    for (const subtitle of subtitles) {
      const original = subtitleOriginalStyles.get(subtitle);
      if (!original) continue;
      restoreStyleProperty(
        subtitle,
        "font-size",
        original.fontSize,
        original.fontSizePriority
      );
      restoreStyleProperty(
        subtitle,
        "bottom",
        original.bottom,
        original.bottomPriority
      );
    }
    subtitleOriginalStyles = new WeakMap();
    finishInstantSubtitleResize(subtitles);
    redrawPipSubtitleNow();
  }

  function adjustSubtitleFontSize(delta) {
    const subtitles = getSubtitleElements();
    const currentSize = Number.isFinite(subtitleFontSizeOverride)
      ? subtitleFontSizeOverride
      : Number.parseFloat(subtitles[0] ? getComputedStyle(subtitles[0]).fontSize : "");

    if (!Number.isFinite(currentSize)) {
      log("subtitle size is unavailable");
      return;
    }

    subtitleFontSizeOverride = Math.min(
      SUBTITLE_SIZE_MAX,
      Math.max(SUBTITLE_SIZE_MIN, currentSize + delta)
    );
    applySubtitleFontSizeOverride(true);
    redrawPipSubtitleNow();
  }

  function createSubtitleSizeButton({ className, label, text, delta, reset = false }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `art-control ${className} lkf-subtitle-size-control hint--rounded hint--top`;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = text;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (reset) resetSubtitleFontSize();
      else adjustSubtitleFontSize(delta);
    });
    return button;
  }

  function ensureSubtitleSizeControls(controls) {
    if (!(controls instanceof HTMLElement)) return;

    for (const control of [...controls.children]) {
      if (!(control instanceof HTMLElement) ||
        control.classList.contains("lkf-subtitle-size-control")) continue;

      const text = control.textContent
        .replace(/\u2212/g, "-")
        .replace(/\s+/g, "")
        .toUpperCase();
      const isLegacySubtitleSizeControl =
        control.classList.contains("art-control-subtitle-decrease") ||
        control.classList.contains("art-control-subtitle-increase") ||
        text === "A-" || text === "A+";
      if (isLegacySubtitleSizeControl) control.remove();
    }

    let reset = controls.querySelector(
      ".art-control-subtitle-reset.lkf-subtitle-size-control"
    );
    if (!reset) {
      reset = createSubtitleSizeButton({
        className: "art-control-subtitle-reset",
        label: "자막 크기 원래대로",
        text: "A↺",
        delta: 0,
        reset: true
      });
    }

    let decrease = controls.querySelector(
      ".art-control-subtitle-decrease.lkf-subtitle-size-control"
    );
    if (!decrease) {
      const nativeDecrease = controls.querySelector(".art-control-subtitle-decrease");
      decrease = createSubtitleSizeButton({
        className: "art-control-subtitle-decrease",
        label: "자막 크기 줄이기",
        text: "A-",
        delta: -SUBTITLE_SIZE_STEP
      });
      nativeDecrease?.replaceWith(decrease);
    }

    let increase = controls.querySelector(
      ".art-control-subtitle-increase.lkf-subtitle-size-control"
    );
    if (!increase) {
      const nativeIncrease = controls.querySelector(".art-control-subtitle-increase");
      increase = createSubtitleSizeButton({
        className: "art-control-subtitle-increase",
        label: "자막 크기 키우기",
        text: "A+",
        delta: SUBTITLE_SIZE_STEP
      });
      nativeIncrease?.replaceWith(increase);
    }

    controls.querySelectorAll(".art-control-subtitle-decrease")
      .forEach((control) => {
        if (control !== decrease) control.remove();
      });
    controls.querySelectorAll(".art-control-subtitle-increase")
      .forEach((control) => {
        if (control !== increase) control.remove();
      });

    const reference = controls.querySelector(".art-control-setting") ||
      controls.querySelector(".art-control-fullscreen");
    const correctlyPlaced = reset.parentElement === controls &&
      decrease.parentElement === controls &&
      increase.parentElement === controls &&
      reset.nextElementSibling === decrease &&
      decrease.nextElementSibling === increase &&
      (!reference || increase.nextElementSibling === reference);

    if (!correctlyPlaced) {
      if (reference) {
        controls.insertBefore(reset, reference);
        controls.insertBefore(decrease, reference);
        controls.insertBefore(increase, reference);
      } else {
        controls.append(reset, decrease, increase);
      }
    }

    applySubtitleFontSizeOverride();
  }

  function requestQualityState() {
    document.dispatchEvent(new CustomEvent(QUALITY_REQUEST_EVENT));
  }

  function formatQualityLevel(level) {
    if (level.name) return level.name;
    if (level.height > 0) return `${level.height}p`;
    if (level.width > 0) return `${level.width}px`;
    if (level.bitrate > 0) {
      return `${(level.bitrate / 1000000).toFixed(1)} Mbps`;
    }
    return `화질 ${level.index + 1}`;
  }

  function renderQualityControl(control) {
    if (!(control instanceof HTMLElement)) return;
    const trigger = control.querySelector(".lkf-quality-trigger");
    const menu = control.querySelector(".lkf-quality-menu");
    if (!(trigger instanceof HTMLButtonElement) || !(menu instanceof HTMLElement)) return;

    const selectedLevel = qualityLevels.find((level) =>
      level.index === qualityCurrentLevel
    );
    const selectedLabel = qualityAutoEnabled
      ? "자동"
      : selectedLevel ? formatQualityLevel(selectedLevel) : "고정";
    trigger.disabled = !qualityAvailable;
    const triggerLabel = qualityAvailable ? selectedLabel : "화질";
    if (trigger.textContent !== triggerLabel) trigger.textContent = triggerLabel;
    trigger.setAttribute("aria-label", qualityAvailable
      ? selectedLabel
      : "화질 정보를 불러오는 중");
    trigger.title = trigger.getAttribute("aria-label");

    const renderKey = JSON.stringify({
      available: qualityAvailable,
      autoEnabled: qualityAutoEnabled,
      currentLevel: qualityCurrentLevel,
      levels: qualityLevels.map((level) => [
        level.index,
        level.name,
        level.width,
        level.height,
        level.bitrate
      ])
    });
    if (menu.dataset.renderKey === renderKey) return;
    menu.dataset.renderKey = renderKey;
    menu.replaceChildren();
    if (!qualityAvailable) {
      const message = document.createElement("div");
      message.className = "lkf-quality-message";
      message.textContent = "화질 정보를 불러오는 중";
      menu.append(message);
      return;
    }

    const options = [
      { index: -1, label: "자동" },
      ...qualityLevels.map((level) => ({
        index: level.index,
        label: formatQualityLevel(level)
      }))
    ];

    for (const option of options) {
      const selected = option.index === -1
        ? qualityAutoEnabled
        : !qualityAutoEnabled && option.index === qualityCurrentLevel;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "lkf-quality-option";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(selected));
      item.dataset.levelIndex = String(option.index);
      item.textContent = `${selected ? "✓ " : ""}${option.label}`;
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        qualityAutoEnabled = option.index === -1;
        qualityCurrentLevel = option.index;
        document.dispatchEvent(new CustomEvent(QUALITY_SET_EVENT, {
          detail: JSON.stringify({ index: option.index })
        }));
        control.classList.remove("lkf-quality-open");
        trigger.setAttribute("aria-expanded", "false");
        document.querySelectorAll(`.${QUALITY_CONTROL_CLASS}`)
          .forEach((qualityControl) => renderQualityControl(qualityControl));
        if (controlsModeActive) showControlsForThreeSeconds();
      });
      menu.append(item);
    }
  }

  function handleQualityResponse(event) {
    let data;
    try {
      data = typeof event.detail === "string"
        ? JSON.parse(event.detail)
        : event.detail;
    } catch (error) {
      log("quality response could not be parsed", error);
      return;
    }
    if (!data || typeof data !== "object") return;

    qualityAvailable = Boolean(data.available);
    qualityAutoEnabled = data.autoEnabled !== false;
    qualityCurrentLevel = Number.isInteger(data.currentLevel)
      ? data.currentLevel
      : -1;
    qualityLevels = Array.isArray(data.levels)
      ? data.levels.filter((level) => level && Number.isInteger(level.index))
      : [];
    document.querySelectorAll(`.${QUALITY_CONTROL_CLASS}`)
      .forEach((control) => renderQualityControl(control));
  }

  function ensureQualityControl(controls) {
    if (!(controls instanceof HTMLElement)) return;

    let control = controls.querySelector(`:scope > .${QUALITY_CONTROL_CLASS}`);
    if (!control) {
      control = document.createElement("div");
      control.className = `art-control ${QUALITY_CONTROL_CLASS}`;

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "lkf-quality-trigger hint--rounded hint--top";
      trigger.textContent = "화질";
      trigger.setAttribute("aria-haspopup", "menu");
      trigger.setAttribute("aria-expanded", "false");
      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const opening = !control.classList.contains("lkf-quality-open");
        document.querySelectorAll(`.${QUALITY_CONTROL_CLASS}`)
          .forEach((qualityControl) => {
            qualityControl.classList.remove("lkf-quality-open");
            qualityControl.querySelector(".lkf-quality-trigger")
              ?.setAttribute("aria-expanded", "false");
          });
        control.classList.toggle("lkf-quality-open", opening);
        trigger.setAttribute("aria-expanded", String(opening));
        if (opening) requestQualityState();
      });

      const menu = document.createElement("div");
      menu.className = "lkf-quality-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "화질 선택");
      control.append(trigger, menu);
    }

    const reset = controls.querySelector(
      ".art-control-subtitle-reset.lkf-subtitle-size-control"
    );
    if (reset && control.nextElementSibling !== reset) {
      controls.insertBefore(control, reset);
    }
    renderQualityControl(control);
    requestQualityState();
  }

  function createPictureInPictureStatus() {
    const player = document.querySelector(".art-video-player");
    if (!player) return null;

    let status = document.getElementById(PIP_STATUS_ID);
    if (status && status.parentElement !== player) {
      status.remove();
      status = null;
    }
    if (!status) {
      status = document.createElement("div");
      status.id = PIP_STATUS_ID;
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.textContent = "PIP 실행 중";
      player.append(status);
    }
    return status;
  }

  function findForwardTenControl(controls) {
    return [...controls.children].find((control) => {
      if (!(control instanceof HTMLElement)) return false;
      if (control.classList.contains("art-control-control9")) return true;

      const accessibleNames = [
        control.getAttribute("aria-label"),
        control.getAttribute("title"),
        control.textContent
      ].filter(Boolean).map((value) => value.replace(/\s+/g, "").toLowerCase());
      return accessibleNames.some((name) => name === "10+" ||
        name.includes("10초앞으로") || name.includes("forward10"));
    }) || null;
  }

  function findBackwardTenControl(controls) {
    return [...controls.children].find((control) => {
      if (!(control instanceof HTMLElement)) return false;
      if (control.classList.contains("art-control-control8")) return true;

      const accessibleNames = [
        control.getAttribute("aria-label"),
        control.getAttribute("title"),
        control.textContent
      ].filter(Boolean).map((value) => value.replace(/\s+/g, "").toLowerCase());
      return accessibleNames.some((name) => name === "10-" ||
        name.includes("10초뒤로") || name.includes("backward10") ||
        name.includes("rewind10"));
    }) || null;
  }

  function createSeekControl({ className, artClassName, text, label, seconds }) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = `art-control ${artClassName} ${className} ` +
      "lkf-ten-second-seek-control hint--rounded hint--top";
    control.setAttribute("aria-label", label);
    control.title = label;
    control.textContent = text;
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      seekPlaybackBySeconds(seconds);
    });
    return control;
  }

  function ensureTenSecondSeekControls(controls) {
    let backward = findBackwardTenControl(controls);
    if (!backward) {
      backward = createSeekControl({
        className: BACKWARD_10_BUTTON_CLASS,
        artClassName: "art-control-control8",
        text: "10-",
        label: "10초 뒤로",
        seconds: -10
      });
    }

    let forward = findForwardTenControl(controls);
    if (!forward) {
      forward = createSeekControl({
        className: FORWARD_10_BUTTON_CLASS,
        artClassName: "art-control-control9",
        text: "10+",
        label: "10초 앞으로",
        seconds: 10
      });
    }

    const seekControls = [
      { control: backward, text: "10-", label: "10초 뒤로" },
      { control: forward, text: "10+", label: "10초 앞으로" }
    ];

    for (const { control, text, label } of seekControls) {
      if (!(control instanceof HTMLElement)) continue;
      control.classList.add("lkf-ten-second-seek-control");
      control.setAttribute("aria-label", label);
      control.setAttribute("title", label);
      if (control.children.length || control.textContent.trim() !== text) {
        control.replaceChildren(document.createTextNode(text));
      }
    }

    const volume = controls.querySelector(":scope > .art-control-volume");
    const play = controls.querySelector(":scope > .art-control-playAndPause");
    const anchor = volume || play;
    if (anchor && anchor.nextElementSibling !== backward) {
      controls.insertBefore(backward, anchor.nextElementSibling);
    } else if (!anchor && controls.firstElementChild !== backward) {
      controls.prepend(backward);
    }
    if (backward.nextElementSibling !== forward) {
      controls.insertBefore(forward, backward.nextElementSibling);
    }
  }

  function ensurePrimaryControlsFirst(controls) {
    if (!(controls instanceof HTMLElement)) return;

    const play = controls.querySelector(":scope > .art-control-playAndPause");
    const volume = controls.querySelector(":scope > .art-control-volume");
    if (!(play instanceof HTMLElement) || !(volume instanceof HTMLElement)) return;

    if (controls.firstElementChild !== play || play.nextElementSibling !== volume) {
      controls.prepend(play, volume);
    }
  }

  function seekPlaybackBySeconds(seconds) {
    // PIP mode intentionally makes the original ArtPlayer video transparent,
    // so findBestVideo() no longer treats it as visible. Keep seeking the
    // source media that feeds the composite PIP stream in that state.
    const video = pipSourceVideo?.isConnected ? pipSourceVideo : findBestVideo();
    if (!(video instanceof HTMLVideoElement)) {
      log("seek video is unavailable", seconds);
      return;
    }

    const targetTime = Math.max(0, video.currentTime + seconds);
    const refreshPipAfterSeek = video === pipSourceVideo && pipProxyVideo
      ? () => redrawPipSubtitleNow()
      : null;
    refreshPipAfterSeek && video.addEventListener(
      "seeked",
      refreshPipAfterSeek,
      { once: true }
    );
    video.currentTime = Number.isFinite(video.duration)
      ? Math.min(targetTime, video.duration)
      : targetTime;
    if (refreshPipAfterSeek) redrawPipSubtitleNow();
    if (controlsModeActive) showControlsForThreeSeconds();
  }

  function ensureForwardNinetyControl(controls) {
    if (!(controls instanceof HTMLElement)) return;

    const forwardTen = findForwardTenControl(controls);
    if (!forwardTen) return;

    const duplicates = [...controls.querySelectorAll(`.${FORWARD_90_BUTTON_CLASS}`)];
    let button = duplicates.shift() || null;
    duplicates.forEach((control) => control.remove());

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = `art-control ${FORWARD_90_BUTTON_CLASS} hint--rounded hint--top`;
      button.setAttribute("aria-label", "90초 앞으로");
      button.title = "90초 앞으로";
      button.textContent = "90+";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        seekPlaybackBySeconds(FORWARD_90_SECONDS);
      });
    }

    if (forwardTen.nextElementSibling !== button) {
      controls.insertBefore(button, forwardTen.nextElementSibling);
    }
  }

  function createPlayerButton() {
    if (isTopFrame) return;

    document.querySelectorAll(".art-control-screenshot").forEach((control) => control.remove());
    document.querySelectorAll(DISABLED_NATIVE_CONTROL_SELECTOR)
      .forEach((control) => control.remove());
    if (isPlayerHost()) {
      document.querySelectorAll(
        ".art-control-subtitle-backdrop, .art-control-subtitle-color"
      ).forEach((control) => control.remove());
    }
    createPictureInPictureStatus();
    observePictureInPictureVideo(findBestVideo());

    document.querySelectorAll(".art-video-player .art-controls-right")
      .forEach((controls) => {
        ensureSubtitleSizeControls(controls);
        ensureQualityControl(controls);
      });
    document.querySelectorAll(".art-video-player .art-controls-left")
      .forEach((controls) => {
        ensurePrimaryControlsFirst(controls);
        ensureTenSecondSeekControls(controls);
        ensureForwardNinetyControl(controls);
      });

    const setting = document.querySelector(".art-controls-right .art-control-setting");
    const fullscreen = document.querySelector(".art-controls-right .art-control-fullscreen");
    if (!setting || !fullscreen || setting.parentElement !== fullscreen.parentElement) return;

    let button = document.getElementById(BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.className = "art-control art-control-lkf-web-fullscreen hint--rounded hint--top";
      button.setAttribute("aria-label", "웹 전체화면");
      button.setAttribute("aria-pressed", "false");
      button.title = "웹 전체화면";
      button.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 9V4h5v2H6v3H4Zm11-3V4h5v5h-2V6h-3ZM6 15v3h3v2H4v-5h2Zm12 3v-3h2v5h-5v-2h3Z" />
        </svg>`;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        button.blur();
        requestToggle();
      });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        button.blur();
        requestToggle();
      });
      fullscreen.parentElement.insertBefore(button, fullscreen);
      window.top.postMessage({ type: READY_MESSAGE }, LINKKF_ORIGIN);
      log("web-fullscreen control inserted");
    }

    createPictureInPictureButton(button);
  }

  function showControlsForThreeSeconds() {
    const player = document.querySelector(".art-video-player");
    if (!player) return;

    controlsModeActive = true;
    clearTimeout(controlsTimer);
    document.documentElement.classList.add(CONTROLS_MODE_CLASS);
    document.documentElement.classList.add(CONTROLS_VISIBLE_CLASS);
    player.classList.add("art-control-show");
    controlsTimer = setTimeout(() => {
      document.documentElement.classList.remove(CONTROLS_VISIBLE_CLASS);
      player.classList.remove("art-control-show");
      controlsTimer = null;
    }, 3000);
  }

  function clearControlsVisibility() {
    clearTimeout(controlsTimer);
    controlsTimer = null;
    controlsModeActive = false;
    document.documentElement.classList.remove(CONTROLS_MODE_CLASS);
    document.documentElement.classList.remove(CONTROLS_VISIBLE_CLASS);
  }

  function handlePlayerActivity(event) {
    if (!controlsModeActive || event.key === "Escape") return;
    if (!document.querySelector(".art-video-player")) return;
    showControlsForThreeSeconds();
  }

  function getPlaybackVideo() {
    return pipSourceVideo?.isConnected ? pipSourceVideo : findBestVideo();
  }

  function toggleVideoPlayback(video = getPlaybackVideo()) {
    if (!(video instanceof HTMLVideoElement)) return false;

    if (video.paused || video.ended) {
      video.play().catch((error) => log("playback could not start", error));
    } else {
      video.pause();
    }
    return true;
  }

  function handlePlaybackHotkey(event) {
    const isSpace = event.code === "Space" ||
      event.key === " " || event.key === "Spacebar";
    if (!isSpace) return;

    const target = event.target;
    if (target instanceof HTMLElement && target.matches(
      "input, textarea, select, [contenteditable='true']"
    )) return;

    const video = getPlaybackVideo();
    if (!(video instanceof HTMLVideoElement)) return;

    // Own Space for every supported player. Some ArtPlayer variants handle
    // keydown while others also react on keyup or synthesize a focused-button
    // click, which can otherwise pause and immediately resume the video.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== "keydown" || event.repeat) return;

    toggleVideoPlayback(video);
    if (controlsModeActive) showControlsForThreeSeconds();
  }

  function createFullscreenBackdrop() {
    let backdrop = document.getElementById(BACKDROP_ID);
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = BACKDROP_ID;
      backdrop.setAttribute("aria-hidden", "true");
      document.body.append(backdrop);
    }
    return backdrop;
  }

  function disableFullscreenAds() {
    const candidates = [...document.querySelectorAll(FULLSCREEN_AD_SELECTOR)];
    const roots = new Set();
    for (const candidate of candidates) {
      const root = candidate.closest(FULLSCREEN_AD_ROOT_SELECTOR) || candidate;
      if (!(root instanceof HTMLElement) || !root.isConnected) continue;
      const activeContainer = active?.container;
      if (root.id === BACKDROP_ID || (activeContainer &&
        (root === activeContainer || root.contains(activeContainer) ||
          activeContainer.contains(root)))) continue;
      roots.add(root);
    }

    for (const root of roots) {
      if ([...roots].some((other) => other !== root && other.contains(root))) continue;
      if (detachedFullscreenAds.has(root) || !root.parentNode) continue;
      const marker = document.createComment("Linkkf fullscreen ad placeholder");
      const parent = root.parentNode;
      const nextSibling = root.nextSibling;
      parent.insertBefore(marker, root);
      detachedFullscreenAds.set(root, { marker, parent, nextSibling });
      root.remove();
      log("temporarily disabled fullscreen ad", root);
    }
  }

  function restoreFullscreenAds() {
    for (const [element, record] of detachedFullscreenAds) {
      if (record.marker.isConnected && record.marker.parentNode) {
        record.marker.parentNode.insertBefore(element, record.marker);
        record.marker.remove();
      } else if (record.parent.isConnected) {
        const reference = record.nextSibling?.parentNode === record.parent
          ? record.nextSibling
          : null;
        record.parent.insertBefore(element, reference);
      }
    }
    detachedFullscreenAds.clear();
  }

  function refreshFullscreenLayerIsolation() {
    if (!active?.container?.isConnected) return;
    disableFullscreenAds();

    const path = [];
    let node = active.container;
    while (node && node !== document.body) {
      path.push(node);
      node = node.parentElement;
    }
    if (node !== document.body) return;
    path.push(document.body);

    for (const element of active.layerPathElements) {
      if (!path.includes(element)) element.classList.remove(LAYER_PATH_CLASS);
    }
    for (const element of active.suppressedElements) {
      element.classList.remove(SUPPRESSED_CLASS);
    }
    active.layerPathElements.clear();
    active.suppressedElements.clear();

    const backdrop = createFullscreenBackdrop();
    for (let index = 1; index < path.length - 1; index += 1) {
      const element = path[index];
      element.classList.add(LAYER_PATH_CLASS);
      active.layerPathElements.add(element);
    }

    // At every ancestor level, retain only the branch that leads to the
    // player. This also suppresses fixed ads injected into an intermediate
    // wrapper instead of directly under body.
    for (let index = path.length - 1; index > 0; index -= 1) {
      const parent = path[index];
      const playerBranch = path[index - 1];
      for (const sibling of parent.children) {
        if (sibling === playerBranch || sibling === backdrop) continue;
        sibling.classList.add(SUPPRESSED_CLASS);
        active.suppressedElements.add(sibling);
      }
    }
  }

  function clearFullscreenLayerIsolation() {
    if (!active) return;
    for (const element of active.layerPathElements) {
      element.classList.remove(LAYER_PATH_CLASS);
    }
    for (const element of active.suppressedElements) {
      element.classList.remove(SUPPRESSED_CLASS);
    }
    active.layerPathElements.clear();
    active.suppressedElements.clear();
    document.getElementById(BACKDROP_ID)?.remove();
  }

  function enterFullscreen(target) {
    const { container, video } = target;
    if (!container) return;
    if (active) exitFullscreen();

    active = {
      container,
      video,
      layerPathElements: new Set(),
      suppressedElements: new Set()
    };
    container.classList.add(TARGET_CLASS);
    document.documentElement.classList.add(LOCK_CLASS);
    document.body.classList.add(LOCK_CLASS);
    refreshFullscreenLayerIsolation();
    postToChildFrames({ type: CONTROLS_MESSAGE, action: "show" });
    postToChildFrames({ type: STATE_MESSAGE, active: true });
    log("entered", { container, video });
  }

  function exitFullscreen() {
    if (!active) return;

    postToChildFrames({ type: CONTROLS_MESSAGE, action: "hide" });
    postToChildFrames({ type: STATE_MESSAGE, active: false });
    active.container.classList.remove(TARGET_CLASS);
    clearFullscreenLayerIsolation();
    document.documentElement.classList.remove(LOCK_CLASS);
    document.body.classList.remove(LOCK_CLASS);
    restoreFullscreenAds();
    active = null;
    log("exited");
  }

  function toggle() {
    if (active) return exitFullscreen();
    const target = findTarget();
    if (!target) return showToast("플레이어를 찾을 수 없습니다.");
    enterFullscreen(target);
  }

  function showToast(message) {
    let toast = document.getElementById("lkf-web-fullscreen-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "lkf-web-fullscreen-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!isTopFrame) {
      // Keyboard events do not bubble out of a focused iframe. Forward Esc
      // from the ArtPlayer and its current embedded source to the top frame.
      window.top.postMessage({ type: ESCAPE_MESSAGE }, LINKKF_ORIGIN);
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    exitFullscreen();
  }, true);

  if (!isTopFrame) {
    document.addEventListener("pointermove", handlePlayerActivity, true);
    document.addEventListener("pointerdown", handlePlayerActivity, true);
    document.addEventListener("touchstart", handlePlayerActivity, true);
    document.addEventListener("keydown", handlePlayerActivity, true);
    // Capture at Window before ArtPlayer's document/player shortcuts.
    window.addEventListener("keydown", handlePlaybackHotkey, true);
    window.addEventListener("keyup", handlePlaybackHotkey, true);
  }

  if (isTopFrame) {
    window.addEventListener("message", (event) => {
      if (event.source === window || !isTrustedMessageOrigin(event.origin)) return;
      if (event.data?.type === ESCAPE_MESSAGE && active) exitFullscreen();
      if (event.data?.type === TOGGLE_MESSAGE) toggle();
      if (event.data?.type === READY_MESSAGE) {
        postToChildFrames({ type: STATE_MESSAGE, active: Boolean(active) });
      }
    });
  } else {
    window.addEventListener("message", (event) => {
      if (event.origin !== LINKKF_ORIGIN) return;
      if (event.data?.type === CONTROLS_MESSAGE) {
        if (event.data.action === "show") showControlsForThreeSeconds();
        if (event.data.action === "hide") clearControlsVisibility();
        postToChildFrames(event.data);
      }
      if (event.data?.type === STATE_MESSAGE) {
        remoteFullscreenActive = Boolean(event.data.active);
        updatePlayerButtonState(remoteFullscreenActive);
        if (remoteFullscreenActive) disableFullscreenAds();
        else restoreFullscreenAds();
        postToChildFrames(event.data);
      }
    });
  }

  const observer = new MutationObserver(() => {
    // Episode navigation can replace either the complete ArtPlayer tree or
    // only its video node. In both cases release the lock instead of retaining
    // a stale fullscreen overlay.
    if (active && (!active.container.isConnected ||
      (active.video && !active.video.isConnected))) {
      exitFullscreen();
      return;
    }
    if (active) refreshFullscreenLayerIsolation();
  });

  const playerObserver = new MutationObserver(() => createPlayerButton());
  const adObserver = new MutationObserver(() => {
    if ((isTopFrame && active) || (!isTopFrame && remoteFullscreenActive)) {
      disableFullscreenAds();
    }
  });

  function init() {
    document.documentElement.classList.toggle(
      CUSTOM_PLAYER_CLASS,
      isPlayerHost()
    );
    document.documentElement.classList.toggle(
      COMPACT_CONTROLS_CLASS,
      /\/(?:r2|b2)\/(?:play|nss2|n2)\.php$/i.test(location.pathname)
    );
    if (!isTopFrame && isPlayerHost()) {
      document.addEventListener(QUALITY_RESPONSE_EVENT, handleQualityResponse);
      document.addEventListener("pointerdown", (event) => {
        if (event.target instanceof Element &&
          event.target.closest(`.${QUALITY_CONTROL_CLASS}`)) return;
        document.querySelectorAll(`.${QUALITY_CONTROL_CLASS}.lkf-quality-open`)
          .forEach((control) => {
            control.classList.remove("lkf-quality-open");
            control.querySelector(".lkf-quality-trigger")
              ?.setAttribute("aria-expanded", "false");
          });
      }, true);
    }
    if (isTopFrame) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } else {
      createPlayerButton();
      playerObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    adObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-anchor-status", "data-anchor-shown"],
      childList: true,
      subtree: true
    });
    log("initialized");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
