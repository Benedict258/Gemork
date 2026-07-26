const statusEl = document.getElementById("status");

chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
  if (response?.connected) {
    if (statusEl) statusEl.textContent = "Connected to Gemork";
  } else {
    if (statusEl) statusEl.textContent = "Disconnected — Open Gemork desktop app";
  }
});
