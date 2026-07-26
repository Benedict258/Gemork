console.log("[Gemork] Content script loaded on:", window.location.href);

// Content script runs in the context of web pages
// It can read/modify DOM, communicate with background script

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "getPageContent") {
    const content = document.body?.innerText || "";
    sendResponse({ content: content.substring(0, 10000) });
  }

  if (message.type === "fillForm") {
    // TODO: Implement form filling based on agent instructions
    sendResponse({ success: false, error: "Form filling not yet implemented" });
  }

  if (message.type === "clickElement") {
    // TODO: Implement element clicking based on agent instructions
    sendResponse({ success: false, error: "Element clicking not yet implemented" });
  }

  return true; // Keep message channel open for async response
});

// Notify background script that content script is ready
chrome.runtime.sendMessage({ type: "contentScriptReady" });
