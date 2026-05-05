const api = typeof browser !== "undefined" ? browser : chrome;
const toolbarAction = api.browserAction || api.action;
const tabCounts = new Map();
const tabRunning = new Map();

function setBadge(tabId, count, running = false) {
  if (!tabId || !toolbarAction) {
    return;
  }

  const text = running ? "ON" : count > 0 ? String(count) : "";
  toolbarAction.setBadgeText({ tabId, text });
  toolbarAction.setBadgeBackgroundColor({ tabId, color: running ? "#4f46e5" : "#16a34a" });
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || (message.type !== "fish-again-count" && message.type !== "fish-again-state")) {
    if (message && message.type === "fish-again-popup-state") {
      const count = tabCounts.get(message.tabId) || 0;
      const running = tabRunning.get(message.tabId) || false;
      sendResponse({ count, running });
    }
    return false;
  }

  const tabId = sender.tab && sender.tab.id;
  if (!tabId) {
    return false;
  }

  tabCounts.set(tabId, message.count);
  tabRunning.set(tabId, Boolean(message.running));
  setBadge(tabId, message.count, Boolean(message.running));
  return false;
});

api.tabs.onRemoved.addListener((tabId) => {
  tabCounts.delete(tabId);
  tabRunning.delete(tabId);
});

api.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    tabCounts.delete(tabId);
    tabRunning.delete(tabId);
    setBadge(tabId, 0);
  }
});
