// Runs inside the Beautyworld page. Copies every exhibitor-search response the site receives.
(() => {
  const MATCH = "/exhibitor/search";

  const emit = (payload) => {
    try {
      const json = typeof payload === "string" ? JSON.parse(payload) : payload;
      if (json && json.result && Array.isArray(json.result.hits)) {
        window.postMessage({ type: "SHIPCUBE_EXHIBITOR_PAGE", result: json.result }, "*");
      }
    } catch (e) {}
  };

  // Catch XMLHttpRequest (what the site uses)
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__scUrl = String(url || "");
    return origOpen.apply(this, arguments);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this.__scUrl.includes(MATCH)) {
      this.addEventListener("load", function () {
        if (this.status !== 200) return;
        if (this.responseType === "" || this.responseType === "text") emit(this.responseText);
        else if (this.responseType === "json") emit(this.response);
      });
    }
    return origSend.apply(this, arguments);
  };

  // Catch fetch too, just in case
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const p = origFetch.apply(this, arguments);
    if (url.includes(MATCH)) {
      p.then((res) => { if (res.ok) res.clone().text().then(emit).catch(() => {}); }).catch(() => {});
    }
    return p;
  };
})();