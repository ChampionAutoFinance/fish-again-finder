(() => {
  if (window.__fishAgainFinderLoaded) {
    window.dispatchEvent(new CustomEvent("fish-again-finder-rescan"));
    return;
  }

  window.__fishAgainFinderLoaded = true;
  document.title = document.title.startsWith("FAF READY")
    ? document.title
    : `FAF READY - ${document.title}`;

  const api = typeof browser !== "undefined" ? browser : chrome;
  const MATCH_ATTRIBUTE = "data-fish-again-finder-match";
  const CONTROL_ATTRIBUTE = "data-fish-again-finder-control";
  const MATCH_STYLE_ATTRIBUTE = "data-fish-again-finder-inline-style";
  const MATCH_TEXT = /fish\s+again/i;
  const CAT_TRIGGER_TEXT = /cat\s+has\s+appeared!?\s+type\s+["'“”]?cat["'“”]?\s+to\s+catch\s+it!?/i;
  const VERIFY_COMMAND_TEXT = /\/verify\b/i;
  const VERIFY_COMMAND_WITH_CODE_TEXT = /\/verify\s+([A-Za-z0-9][A-Za-z0-9_-]{1,31})\b/gi;
  const VERIFY_CODE_LABEL_TEXT = /\bcode\s*(?::|：|-|=)\s*([A-Za-z0-9][A-Za-z0-9_-]{1,31})\b/i;
  const VERIFY_PLACEHOLDER_WORDS = new Set([
    "code",
    "command",
    "continue",
    "playing",
    "please",
    "regen",
    "result",
    "verify"
  ]);
  const CANDIDATE_SELECTOR = [
    "button",
    "a[href]",
    "input[type='button']",
    "input[type='submit']",
    "[role='button']",
    "[onclick]",
    "[tabindex]"
  ].join(",");
  const TEXTBOX_SELECTOR = [
    "div[role='textbox'][contenteditable='true']",
    "div[data-slate-editor='true']",
    "div[contenteditable='true']",
    "textarea",
    "input[type='text']"
  ].join(",");

  const DEFAULT_CLICK_INTERVAL_MS = 3000;
  const MIN_CLICK_INTERVAL_MS = 250;
  const MAX_CLICK_INTERVAL_MS = 60000;
  const VERIFY_IDLE_MS = 45000;
  const VERIFY_COMMAND_COOLDOWN_MS = 120000;
  const VERIFY_ANSWER_FIELD_TIMEOUT_MS = 6000;
  const VERIFY_ANSWER_FIELD_POLL_MS = 150;
  const POST_VERIFY_FISH_DELAY_MS = 1200;
  const SETTINGS_KEY = "fish-again-finder-settings-v1";
  const savedSettings = readSettings();

  let scanTimer = 0;
  let lastCount = -1;
  let clickTimer = 0;
  let clickIntervalMs = clampInterval(savedSettings.intervalMs);
  let isAutoClicking = false;
  let clickCount = 0;
  let lastClickAt = null;
  let lastClickAtMs = 0;
  let runStartedAtMs = 0;
  let lastVerifyAtMs = 0;
  let lastMessage = "Paused.";
  let matchOrderCounter = 0;
  let lastOnScreenCount = 0;
  let controlRoot = null;
  let controlHeader = null;
  let controlButton = null;
  let controlStatus = null;
  let controlCount = null;
  let controlIntervalInput = null;
  let controlPosition = savedSettings.position || null;
  let controlSize = savedSettings.size || { width: 260, height: 0 };
  const matchSeenOrder = new WeakMap();

  function readSettings() {
    try {
      return JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}");
    } catch (error) {
      return {};
    }
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          intervalMs: clickIntervalMs,
          position: controlPosition,
          size: controlSize
        })
      );
    } catch (error) {
      // Some pages block localStorage for extension scripts.
    }
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function clampInterval(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      return DEFAULT_CLICK_INTERVAL_MS;
    }

    return clamp(numberValue, MIN_CLICK_INTERVAL_MS, MAX_CLICK_INTERVAL_MS);
  }

  function formatSeconds(intervalMs) {
    return String(Math.round((intervalMs / 1000) * 100) / 100);
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function getPageText() {
    return normalizeText(document.body ? document.body.textContent : "");
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isOnScreen(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  function isClickable(element) {
    return !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true";
  }

  function getCandidateText(element) {
    const values = [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.textContent
    ];

    if (element instanceof HTMLInputElement) {
      values.push(element.value);
    }

    return values.map(normalizeText).filter(Boolean);
  }

  function matchesFishAgain(element) {
    return getCandidateText(element).some((text) => MATCH_TEXT.test(text));
  }

  function clearMarks() {
    document.querySelectorAll(`[${MATCH_ATTRIBUTE}]`).forEach((element) => {
      element.removeAttribute(MATCH_ATTRIBUTE);
      element.removeAttribute(MATCH_STYLE_ATTRIBUTE);
      element.style.removeProperty("outline");
      element.style.removeProperty("outline-offset");
      element.style.removeProperty("box-shadow");
    });
  }

  function findFishAgainButtons() {
    clearMarks();

    const rawMatches = Array.from(document.querySelectorAll(CANDIDATE_SELECTOR))
      .filter(isVisible)
      .filter(matchesFishAgain);

    const matches = rawMatches.filter((element) => {
      return !rawMatches.some((other) => other !== element && element.contains(other));
    });

    matches.forEach((element, index) => {
      if (!matchSeenOrder.has(element)) {
        matchOrderCounter += 1;
        matchSeenOrder.set(element, matchOrderCounter);
      }

      element.setAttribute(MATCH_ATTRIBUTE, String(index + 1));
      element.setAttribute(MATCH_STYLE_ATTRIBUTE, "");
      element.style.setProperty("outline", "3px solid #22c55e", "important");
      element.style.setProperty("outline-offset", "3px", "important");
      element.style.setProperty("box-shadow", "0 0 0 6px rgba(34, 197, 94, 0.22)", "important");
    });

    lastOnScreenCount = matches.filter(isOnScreen).length;
    const newestOnScreen = getNewestMatch(matches, true);

    if (newestOnScreen) {
      newestOnScreen.style.setProperty("outline", "3px solid #2563eb", "important");
      newestOnScreen.style.setProperty("box-shadow", "0 0 0 6px rgba(37, 99, 235, 0.26)", "important");
    }

    reportCount(matches.length);
    renderControl();
    return matches;
  }

  function getNewestMatch(matches, requireOnScreen) {
    return matches
      .filter(isClickable)
      .filter((element) => !requireOnScreen || isOnScreen(element))
      .reduce((newest, element) => {
        if (!newest) {
          return element;
        }

        const newestOrder = matchSeenOrder.get(newest) || 0;
        const elementOrder = matchSeenOrder.get(element) || 0;
        return elementOrder >= newestOrder ? element : newest;
      }, null);
  }

  function getNewestOnScreenMatch() {
    const matches = findFishAgainButtons();
    return getNewestMatch(matches, true);
  }

  function isExtensionControlElement(element) {
    return Boolean(controlRoot && (element === controlRoot || controlRoot.contains(element)));
  }

  function catTriggerVisibleOnPage() {
    return CAT_TRIGGER_TEXT.test(getPageText());
  }

  function shouldShowControl() {
    return isAutoClicking || (lastCount > 0 && !catTriggerVisibleOnPage());
  }

  function scrollElementToBottom(element) {
    if (!element || isExtensionControlElement(element)) {
      return;
    }

    try {
      element.scrollTop = element.scrollHeight;
    } catch (error) {
      // Some browser-managed elements reject scroll writes.
    }
  }

  function scrollPageToBottom() {
    try {
      const scrollingElement = document.scrollingElement || document.documentElement || document.body;
      scrollElementToBottom(scrollingElement);
      window.scrollTo({ top: scrollingElement.scrollHeight, behavior: "auto" });
    } catch (error) {
      // Some embedded pages block top-level scrolling.
    }

    Array.from(document.querySelectorAll("*")).forEach((element) => {
      if (!(element instanceof HTMLElement) || isExtensionControlElement(element)) {
        return;
      }

      const style = window.getComputedStyle(element);
      const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY);

      if (canScrollY && element.scrollHeight > element.clientHeight + 8 && isVisible(element)) {
        scrollElementToBottom(element);
      }
    });
  }

  function scrollPageToBottomAfterClick() {
    window.requestAnimationFrame(scrollPageToBottom);
    window.setTimeout(scrollPageToBottom, 250);
    window.setTimeout(scrollPageToBottom, 900);
  }

  function findTextboxes() {
    return Array.from(document.querySelectorAll(TEXTBOX_SELECTOR))
      .filter(isVisible)
      .filter((element) => {
        if (isExtensionControlElement(element)) {
          return false;
        }

        if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
          return !element.disabled && !element.readOnly;
        }

        return element.isContentEditable || element.getAttribute("role") === "textbox";
      });
  }

  function findTextbox() {
    const boxes = findTextboxes().filter(isOnScreen);
    const candidates = boxes.length ? boxes : findTextboxes();
    const sorted = candidates.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return bRect.bottom - aRect.bottom;
    });

    return sorted[0] || null;
  }

  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function dispatchInput(element, data) {
    try {
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data
        })
      );
    } catch (error) {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function replaceEditableText(element, text) {
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    element.focus();
    element.click();

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      setNativeValue(element, text);
      try {
        element.setSelectionRange(text.length, text.length);
      } catch (error) {
        // Some inputs do not support selection ranges.
      }
      dispatchInput(element, text);
      return;
    }

    let inserted = false;
    try {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      inserted = document.execCommand("insertText", false, text);
    } catch (error) {
      inserted = false;
    }

    if (!inserted || normalizeText(element.textContent) !== text) {
      element.textContent = text;
    }

    dispatchInput(element, text);
  }

  function insertEditableText(element, text) {
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    element.focus();
    element.click();

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const nextValue = `${element.value || ""}${text}`;
      setNativeValue(element, nextValue);
      try {
        element.setSelectionRange(nextValue.length, nextValue.length);
      } catch (error) {
        // Some inputs do not support selection ranges.
      }
      dispatchInput(element, text);
      return;
    }

    let inserted = false;
    try {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      inserted = document.execCommand("insertText", false, text);
    } catch (error) {
      inserted = false;
    }

    if (!inserted) {
      element.textContent = `${element.textContent || ""}${text}`;
    }

    dispatchInput(element, text);
  }

  function dispatchEnter(element) {
    dispatchKey(element, "Enter", "Enter", 13);
  }

  function dispatchTab(element) {
    dispatchKey(element, "Tab", "Tab", 9);
  }

  function dispatchSpace(element) {
    dispatchKey(element, " ", "Space", 32);
  }

  function dispatchKey(element, key, code, keyCode) {
    ["keydown", "keypress", "keyup"].forEach((type) => {
      element.dispatchEvent(
        new KeyboardEvent(type, {
          key,
          code,
          keyCode,
          which: keyCode,
          bubbles: true,
          cancelable: true
        })
      );
    });
  }

  function getChatTextbox() {
    const textbox = findTextbox();
    if (!textbox) {
      throw new Error("message box not found");
    }

    return textbox;
  }

  function sendChatCommand(command) {
    const textbox = getChatTextbox();
    replaceEditableText(textbox, command);
    dispatchEnter(textbox);
    window.setTimeout(() => dispatchEnter(textbox), 350);
  }

  function sendVerifyCode(code) {
    const textbox = getChatTextbox();
    replaceEditableText(textbox, "/verify ");

    waitForVerifyAnswerField(() => {
      const nextTextbox = findTextbox() || textbox;
      insertEditableText(nextTextbox, code);
      dispatchEnter(nextTextbox);
      scheduleFishCommand();
    });
  }

  function scheduleFishCommand() {
    window.setTimeout(() => {
      try {
        sendChatCommand("/fish");
      } catch (error) {
        lastMessage = `Running. Verify sent, but /fish failed: ${error.message}`;
        reportState();
      }
    }, POST_VERIFY_FISH_DELAY_MS);
  }

  function waitForVerifyAnswerField(onReady, startedAt = Date.now()) {
    if (verifyAnswerFieldVisible()) {
      onReady();
      return;
    }

    if (Date.now() - startedAt >= VERIFY_ANSWER_FIELD_TIMEOUT_MS) {
      lastMessage = "Running. /verify opened, but the answer field did not appear.";
      reportState();
      return;
    }

    window.setTimeout(() => {
      waitForVerifyAnswerField(onReady, startedAt);
    }, VERIFY_ANSWER_FIELD_POLL_MS);
  }

  function verifyAnswerFieldVisible() {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && !isExtensionControlElement(activeElement)) {
      const activeText = normalizeText(
        [
          activeElement.getAttribute("aria-label"),
          activeElement.getAttribute("placeholder"),
          activeElement.getAttribute("title"),
          activeElement.textContent
        ].filter(Boolean).join(" ")
      );

      if (activeText.length <= 80 && /\banswer\b/i.test(activeText)) {
        return true;
      }
    }

    const fieldIsVisible = Array.from(
      document.querySelectorAll("[aria-label], [placeholder], [title], span, div")
    )
      .filter(isVisible)
      .some((element) => {
        const text = normalizeText(
          [
            element.getAttribute("aria-label"),
            element.getAttribute("placeholder"),
            element.getAttribute("title"),
            element.textContent
          ].filter(Boolean).join(" ")
        );

        return text.length <= 80 && /\banswer\b/i.test(text);
      });

    if (fieldIsVisible && /\/verify\b/i.test(getPageText())) {
      return true;
    }

    return /\/verify\b[\s\S]{0,120}\banswer\b/i.test(getPageText());
  }

  function idleMsSinceLastClick(now) {
    const base = lastClickAtMs || runStartedAtMs || now;
    return now - base;
  }

  function getVerifyCode(pageText) {
    const codeMatch = pageText.match(VERIFY_CODE_LABEL_TEXT);
    const codeFromLabel = codeMatch && codeMatch[1];
    if (isValidVerifyCode(codeFromLabel)) {
      return codeFromLabel;
    }

    const commandMatches = Array.from(pageText.matchAll(VERIFY_COMMAND_WITH_CODE_TEXT));
    for (let index = commandMatches.length - 1; index >= 0; index -= 1) {
      const codeFromCommand = commandMatches[index] && commandMatches[index][1];
      if (isValidVerifyCode(codeFromCommand)) {
        return codeFromCommand;
      }
    }

    return "";
  }

  function isValidVerifyCode(value) {
    const code = String(value || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/.test(code)) {
      return false;
    }

    return !VERIFY_PLACEHOLDER_WORDS.has(code.toLowerCase());
  }

  function maybeSendVerifyCommand(now) {
    if (!isAutoClicking || idleMsSinceLastClick(now) < VERIFY_IDLE_MS) {
      return false;
    }

    const pageText = getPageText();
    if (!VERIFY_COMMAND_TEXT.test(pageText)) {
      return false;
    }

    const code = getVerifyCode(pageText);
    if (!code) {
      lastMessage = "Running. Saw /verify, but no verify code was found yet.";
      reportState();
      return false;
    }

    if (lastVerifyAtMs > 0 && now - lastVerifyAtMs < VERIFY_COMMAND_COOLDOWN_MS) {
      return false;
    }

    try {
      sendVerifyCode(code);
      lastVerifyAtMs = now;
      lastMessage = `Running. No clicks lately; sent /verify with code ${code}.`;
      reportState();
      return true;
    } catch (error) {
      lastMessage = `Running. Saw /verify, but could not send command: ${error.message}`;
      reportState();
      return false;
    }
  }

  function reportState() {
    renderControl();

    try {
      api.runtime.sendMessage({
        type: "fish-again-state",
        count: lastCount < 0 ? 0 : lastCount,
        running: isAutoClicking,
        clicks: clickCount,
        message: lastMessage,
        title: document.title,
        url: window.location.href
      });
    } catch (error) {
      // The extension context can disappear during hot reloads or navigation.
    }
  }

  function reportCount(count) {
    if (count === lastCount) {
      return;
    }

    lastCount = count;
    renderControl();

    try {
      api.runtime.sendMessage({
        type: "fish-again-count",
        count,
        running: isAutoClicking,
        title: document.title,
        url: window.location.href
      });
    } catch (error) {
      // The extension context can disappear during hot reloads or navigation.
    }
  }

  function getState() {
    const count = findFishAgainButtons().length;
    return {
      count,
      running: isAutoClicking,
      clicks: clickCount,
      lastClickAt,
      message: lastMessage,
      intervalMs: clickIntervalMs,
      url: window.location.href
    };
  }

  function clickFishAgain() {
    if (!isAutoClicking) {
      return getState();
    }

    const target = getNewestOnScreenMatch();

    if (!target) {
      if (!maybeSendVerifyCommand(Date.now())) {
        lastMessage = "Running. No on-screen Fish Again button found yet.";
      }
      reportState();
      return getState();
    }

    target.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    target.click();
    scrollPageToBottomAfterClick();
    clickCount += 1;
    lastClickAtMs = Date.now();
    lastClickAt = new Date(lastClickAtMs).toISOString();
    lastVerifyAtMs = 0;
    lastMessage = `Running. Clicked newest on-screen button ${clickCount} time${clickCount === 1 ? "" : "s"}.`;
    reportState();
    return getState();
  }

  function startAutoClicking() {
    if (isAutoClicking) {
      return getState();
    }

    isAutoClicking = true;
    runStartedAtMs = Date.now();
    lastVerifyAtMs = 0;
    lastMessage = `Running. Clicking every ${formatSeconds(clickIntervalMs)} seconds.`;
    window.clearInterval(clickTimer);
    clickFishAgain();
    clickTimer = window.setInterval(clickFishAgain, clickIntervalMs);
    reportState();
    return getState();
  }

  function pauseAutoClicking() {
    isAutoClicking = false;
    try {
      window.clearInterval(clickTimer);
    } catch (error) {
      // The document can be tearing down during navigation.
    }
    clickTimer = 0;
    runStartedAtMs = 0;
    lastVerifyAtMs = 0;
    lastMessage = "Paused.";
    reportState();
    return getState();
  }

  function setClickIntervalMs(nextIntervalMs) {
    const next = clampInterval(nextIntervalMs);
    clickIntervalMs = next;
    saveSettings();

    if (isAutoClicking) {
      window.clearInterval(clickTimer);
      clickTimer = window.setInterval(clickFishAgain, clickIntervalMs);
      lastMessage = `Running. Clicking every ${formatSeconds(clickIntervalMs)} seconds.`;
      reportState();
    } else {
      renderControl();
    }
  }

  function getControlWidth() {
    const maxWidth = Math.max(220, window.innerWidth - 24);
    return clamp(Number(controlSize.width) || 260, 220, maxWidth);
  }

  function getControlHeight() {
    if (!controlSize.height) {
      return 0;
    }

    const maxHeight = Math.max(150, window.innerHeight - 24);
    return clamp(Number(controlSize.height) || 0, 150, maxHeight);
  }

  function applyControlGeometry() {
    if (!controlRoot) {
      return;
    }

    const width = getControlWidth();
    const height = getControlHeight();
    controlRoot.style.setProperty("width", `${width}px`, "important");

    if (height > 0) {
      controlRoot.style.setProperty("height", `${height}px`, "important");
    } else {
      controlRoot.style.removeProperty("height");
    }

    if (controlPosition) {
      const rect = controlRoot.getBoundingClientRect();
      const nextX = clamp(Number(controlPosition.x) || 0, 0, Math.max(0, window.innerWidth - rect.width));
      const nextY = clamp(Number(controlPosition.y) || 0, 0, Math.max(0, window.innerHeight - rect.height));
      controlPosition = { x: nextX, y: nextY };
      controlRoot.style.setProperty("left", `${nextX}px`, "important");
      controlRoot.style.setProperty("top", `${nextY}px`, "important");
      controlRoot.style.setProperty("right", "auto", "important");
      controlRoot.style.setProperty("bottom", "auto", "important");
    } else {
      controlRoot.style.setProperty("right", "16px", "important");
      controlRoot.style.setProperty("bottom", "16px", "important");
      controlRoot.style.setProperty("left", "auto", "important");
      controlRoot.style.setProperty("top", "auto", "important");
    }
  }

  function startControlDrag(event) {
    if (!controlRoot || event.button !== 0) {
      return;
    }

    event.preventDefault();
    const rect = controlRoot.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    function onPointerMove(moveEvent) {
      controlPosition = {
        x: moveEvent.clientX - offsetX,
        y: moveEvent.clientY - offsetY
      };
      applyControlGeometry();
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      saveSettings();
    }

    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
  }

  function startControlResize(event) {
    if (!controlRoot || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = controlRoot.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    controlPosition = { x: rect.left, y: rect.top };
    applyControlGeometry();

    function onPointerMove(moveEvent) {
      controlSize = {
        width: clamp(startWidth + moveEvent.clientX - startX, 220, Math.max(220, window.innerWidth - controlPosition.x)),
        height: clamp(startHeight + moveEvent.clientY - startY, 150, Math.max(150, window.innerHeight - controlPosition.y))
      };
      applyControlGeometry();
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      saveSettings();
    }

    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
  }

  function createControl() {
    if (controlRoot || !document.body) {
      return;
    }

    controlRoot = document.createElement("div");
    controlRoot.setAttribute(CONTROL_ATTRIBUTE, "");
    controlRoot.className = "fish-again-finder-control";
    controlRoot.style.cssText = [
      "position: fixed !important",
      "right: 16px !important",
      "bottom: 16px !important",
      "z-index: 2147483647 !important",
      "display: grid !important",
      "grid-template-columns: 1fr !important",
      "gap: 8px !important",
      "min-width: 220px !important",
      "min-height: 150px !important",
      "max-width: calc(100vw - 24px) !important",
      "max-height: calc(100vh - 24px) !important",
      "box-sizing: border-box !important",
      "border: 1px solid rgba(15, 23, 42, 0.16) !important",
      "border-radius: 8px !important",
      "background: #ffffff !important",
      "color: #0f172a !important",
      "box-shadow: 0 18px 46px rgba(15, 23, 42, 0.22) !important",
      "font: 13px/1.25 Arial, Helvetica, sans-serif !important",
      "overflow: hidden !important",
      "padding: 10px !important",
      "position: fixed !important"
    ].join("; ");

    controlHeader = document.createElement("div");
    controlHeader.style.cssText = [
      "align-items: center !important",
      "cursor: move !important",
      "display: grid !important",
      "grid-template-columns: 1fr auto !important",
      "gap: 10px !important",
      "user-select: none !important"
    ].join("; ");
    controlHeader.title = "Drag to move";
    controlHeader.addEventListener("pointerdown", startControlDrag);

    const title = document.createElement("strong");
    title.textContent = "Fish Again";
    title.style.cssText = [
      "color: #0f172a !important",
      "font: 800 14px/1.2 Arial, Helvetica, sans-serif !important"
    ].join("; ");

    controlCount = document.createElement("span");
    controlCount.className = "fish-again-finder-control-count";
    controlCount.style.cssText = [
      "justify-self: end !important",
      "color: #16a34a !important",
      "font: 800 12px/1.2 Arial, Helvetica, sans-serif !important"
    ].join("; ");

    const intervalLabel = document.createElement("label");
    intervalLabel.style.cssText = [
      "align-items: center !important",
      "color: #334155 !important",
      "display: grid !important",
      "font: 800 12px/1.2 Arial, Helvetica, sans-serif !important",
      "gap: 6px !important",
      "grid-template-columns: auto minmax(70px, 1fr) auto !important"
    ].join("; ");

    const intervalPrefix = document.createElement("span");
    intervalPrefix.textContent = "Every";

    controlIntervalInput = document.createElement("input");
    controlIntervalInput.type = "number";
    controlIntervalInput.min = String(MIN_CLICK_INTERVAL_MS / 1000);
    controlIntervalInput.max = String(MAX_CLICK_INTERVAL_MS / 1000);
    controlIntervalInput.step = "0.25";
    controlIntervalInput.value = formatSeconds(clickIntervalMs);
    controlIntervalInput.style.cssText = [
      "appearance: textfield !important",
      "border: 1px solid #cbd5e1 !important",
      "border-radius: 6px !important",
      "box-sizing: border-box !important",
      "color: #0f172a !important",
      "font: 800 13px/1 Arial, Helvetica, sans-serif !important",
      "min-width: 0 !important",
      "padding: 7px 8px !important",
      "width: 100% !important"
    ].join("; ");
    controlIntervalInput.addEventListener("change", () => {
      setClickIntervalMs(Number(controlIntervalInput.value) * 1000);
    });
    controlIntervalInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });

    const intervalSuffix = document.createElement("span");
    intervalSuffix.textContent = "sec";

    controlStatus = document.createElement("span");
    controlStatus.className = "fish-again-finder-control-status";
    controlStatus.style.cssText = [
      "grid-column: 1 / -1 !important",
      "color: #475569 !important",
      "display: block !important",
      "font: 700 12px/1.25 Arial, Helvetica, sans-serif !important"
    ].join("; ");

    controlButton = document.createElement("button");
    controlButton.type = "button";
    controlButton.style.cssText = [
      "grid-column: 1 / -1 !important",
      "width: 100% !important",
      "border: 0 !important",
      "border-radius: 7px !important",
      "background: #4f46e5 !important",
      "color: #ffffff !important",
      "cursor: pointer !important",
      "display: block !important",
      "font: 800 14px/1 Arial, Helvetica, sans-serif !important",
      "padding: 10px 12px !important",
      "text-align: center !important"
    ].join("; ");
    controlButton.addEventListener("click", () => {
      if (isAutoClicking) {
        pauseAutoClicking();
      } else {
        startAutoClicking();
      }
    });

    const resizeHandle = document.createElement("span");
    resizeHandle.title = "Drag to resize";
    resizeHandle.style.cssText = [
      "border-bottom: 3px solid #94a3b8 !important",
      "border-right: 3px solid #94a3b8 !important",
      "bottom: 5px !important",
      "cursor: se-resize !important",
      "height: 14px !important",
      "position: absolute !important",
      "right: 5px !important",
      "width: 14px !important"
    ].join("; ");
    resizeHandle.addEventListener("pointerdown", startControlResize);

    controlHeader.append(title, controlCount);
    intervalLabel.append(intervalPrefix, controlIntervalInput, intervalSuffix);
    controlRoot.append(controlHeader, intervalLabel, controlButton, controlStatus, resizeHandle);
    document.body.appendChild(controlRoot);
    applyControlGeometry();
    renderControl();
  }

  function renderControl() {
    const shouldShow = shouldShowControl();
    if (!controlRoot && !shouldShow) {
      return;
    }

    createControl();

    if (!controlRoot || !controlButton || !controlStatus || !controlCount) {
      return;
    }

    controlRoot.style.setProperty("display", shouldShow ? "grid" : "none", "important");
    if (!shouldShow) {
      return;
    }

    controlCount.textContent = `${lastOnScreenCount} on screen`;
    controlButton.textContent = isAutoClicking ? "Pause" : "Start";
    controlButton.classList.toggle("is-running", isAutoClicking);
    controlButton.style.setProperty("background", isAutoClicking ? "#dc2626" : "#4f46e5", "important");
    if (document.activeElement !== controlIntervalInput) {
      controlIntervalInput.value = formatSeconds(clickIntervalMs);
    }
    controlStatus.textContent = lastMessage;
  }

  function scheduleScan() {
    try {
      window.clearTimeout(scanTimer);
      scanTimer = window.setTimeout(() => {
        try {
          findFishAgainButtons();
          renderControl();
          if (isAutoClicking) {
            reportState();
          }
        } catch (error) {
          // Ignore scans during navigation teardown.
        }
      }, 150);
    } catch (error) {
      // Ignore scans during navigation teardown.
    }
  }

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) {
      return false;
    }

    if (message.type === "fish-again-scan-now" || message.type === "fish-again-get-state") {
      sendResponse(getState());
      return false;
    }

    if (message.type === "fish-again-start") {
      sendResponse(startAutoClicking());
      return false;
    }

    if (message.type === "fish-again-pause") {
      sendResponse(pauseAutoClicking());
      return false;
    }

    if (message.type === "fish-again-toggle") {
      sendResponse(isAutoClicking ? pauseAutoClicking() : startAutoClicking());
      return false;
    }

    return false;
  });

  const observer = new MutationObserver(scheduleScan);

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "class", "style", "title", "value"]
    });
  }

  window.addEventListener("pageshow", scheduleScan);
  window.addEventListener("focus", scheduleScan);
  window.addEventListener("fish-again-finder-rescan", scheduleScan);
  scheduleScan();
})();
