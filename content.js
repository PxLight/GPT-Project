(() => {
  "use strict";

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
  const BUTTON_ID = "lkf-web-fullscreen-control";
  const PIP_BUTTON_ID = "lkf-picture-in-picture-control";
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
  const CUSTOM_PLAYER_HOSTS = new Set(["play.sub3.top", "playv2.sub3.top"]);
  const LINKKF_ORIGIN = "https://linkkf.tckopke.com";
  const TRUSTED_MESSAGE_ORIGINS = new Set([
    LINKKF_ORIGIN,
    "https://play.sub3.top",
    "https://playv2.sub3.top"
  ]);
  const isTopFrame = window === window.top;
  let active = null;
  let controlsTimer = null;
  let controlsModeActive = false;
  let observedPipVideo = null;
  let pipSourceVideo = null;
  let pipProxyVideo = null;
  let pipCanvas = null;
  let pipCanvasContext = null;
  let pipCanvasStream = null;
  let pipCanvasTrack = null;
  let pipVideoEnhancer = null;
  let pipWindow = null;
  let pipRenderFrameId = null;
  let pipRenderTimer = null;
  let pipSubtitleObserver = null;
  let remoteFullscreenActive = false;
  const detachedFullscreenAds = new Map();

  const log = (...args) => console.debug("[Linkkf Web Fullscreen]", ...args);

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
    if (!subtitle.lines.length) return;

    const context = pipCanvasContext;
    const scale = pipCanvas.height / subtitle.scaleBaseHeight;
    const maxWidth = pipCanvas.width * 0.94;
    const renderedLines = [];
    for (const line of subtitle.lines) {
      const fontSize = Math.min(
        pipCanvas.height * 0.07,
        Math.max(18, line.fontSize * scale)
      );
      context.font = `${line.fontStyle} ${line.fontWeight} ${fontSize}px Arial, sans-serif`;
      for (const text of wrapCanvasText(context, line.text, maxWidth)) {
        renderedLines.push({ ...line, text, fontSize });
      }
    }

    if (!renderedLines.length) return;
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
      pipSubtitleObserver = new MutationObserver(drawPipFrame);
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

    pipSourceVideo?.removeEventListener("play", syncSourcePlaybackToProxy);
    pipSourceVideo?.removeEventListener("pause", syncSourcePlaybackToProxy);
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
  }

  function handleProxyPictureInPictureLeave() {
    cleanupPipProxy();
    updatePictureInPictureButton();
  }

  async function createPipProxy(video) {
    cleanupPipProxy();
    pipSourceVideo = video;
    const sourceWidth = video.videoWidth || 1280;
    const sourceHeight = video.videoHeight || 720;
    const scale = Math.min(1, PIP_MAX_WIDTH / sourceWidth);

    pipCanvas = document.createElement("canvas");
    pipCanvas.className = PIP_PROXY_CLASS;
    pipCanvas.width = Math.max(2, Math.round(sourceWidth * scale));
    pipCanvas.height = Math.max(2, Math.round(sourceHeight * scale));
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
    pipProxyVideo = document.createElement("video");
    pipProxyVideo.className = PIP_PROXY_CLASS;
    pipProxyVideo.muted = true;
    pipProxyVideo.autoplay = true;
    pipProxyVideo.playsInline = true;
    pipProxyVideo.srcObject = pipCanvasStream;
    document.body.append(pipCanvas, pipProxyVideo);
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
      void togglePictureInPicture();
    });
    referenceButton.parentElement.insertBefore(button, referenceButton);
    updatePictureInPictureButton();
    return button;
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

  function createPlayerButton() {
    if (isTopFrame) return;

    document.querySelectorAll(".art-control-screenshot").forEach((control) => control.remove());
    if (CUSTOM_PLAYER_HOSTS.has(location.hostname)) {
      document.querySelectorAll(
        ".art-control-subtitle-backdrop, .art-control-subtitle-color"
      ).forEach((control) => control.remove());
    }
    createPictureInPictureStatus();
    observePictureInPictureVideo(findBestVideo());

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
        requestToggle();
      });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopImmediatePropagation();
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

  function toggleVideoPlayback() {
    const video = document.querySelector(".art-video-player video");
    if (!(video instanceof HTMLVideoElement)) return;

    if (video.paused || video.ended) {
      video.play().catch((error) => log("playback could not start", error));
    } else {
      video.pause();
    }
  }

  function handlePlaybackHotkey(event) {
    if (!controlsModeActive ||
      !(event.code === "Space" || event.key === " " || event.key === "Spacebar")) return;

    const target = event.target;
    if (target instanceof HTMLElement && target.matches(
      "input, textarea, select, button, [contenteditable='true']"
    )) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    toggleVideoPlayback();
    showControlsForThreeSeconds();
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
    document.addEventListener("keydown", handlePlaybackHotkey, true);
  }

  if (isTopFrame) {
    window.addEventListener("message", (event) => {
      if (event.source === window || !TRUSTED_MESSAGE_ORIGINS.has(event.origin)) return;
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
      CUSTOM_PLAYER_HOSTS.has(location.hostname)
    );
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
