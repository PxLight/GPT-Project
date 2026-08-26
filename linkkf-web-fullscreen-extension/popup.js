(() => {
  "use strict";

  const ENABLED_KEY = "lkfExtensionEnabled";
  const toggle = document.getElementById("enabled");
  const status = document.getElementById("status");

  function render(enabled) {
    toggle.checked = enabled;
    status.textContent = enabled ? "활성화됨" : "비활성화됨";
    status.classList.toggle("enabled", enabled);
  }

  async function initialize() {
    try {
      const stored = await chrome.storage.local.get({ [ENABLED_KEY]: true });
      render(stored[ENABLED_KEY] !== false);
      toggle.disabled = false;
    } catch (error) {
      status.textContent = "설정을 불러올 수 없습니다";
      console.error("Linkkf Player Tools popup initialization failed", error);
    }
  }

  toggle.addEventListener("change", async () => {
    const enabled = toggle.checked;
    toggle.disabled = true;
    status.textContent = "적용 중…";
    status.classList.remove("enabled");
    try {
      await chrome.storage.local.set({ [ENABLED_KEY]: enabled });
      render(enabled);
    } catch (error) {
      render(!enabled);
      status.textContent = "설정을 저장할 수 없습니다";
      console.error("Linkkf Player Tools enabled state update failed", error);
    } finally {
      toggle.disabled = false;
    }
  });

  void initialize();
})();
