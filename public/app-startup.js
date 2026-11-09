(() => {
  const ready = () => document.documentElement.dataset.appReady === "true";
  const showNotice = () => {
    const notice = document.getElementById("app-load-notice");
    if (notice && !ready()) notice.hidden = false;
  };
  const timer = setTimeout(showNotice, 15000);
  window.addEventListener("app-ready", () => {
    clearTimeout(timer);
    const notice = document.getElementById("app-load-notice");
    if (notice) notice.hidden = true;
  }, { once: true });
  window.addEventListener("error", (event) => {
    if (event.target instanceof HTMLScriptElement) showNotice();
  }, true);
})();
