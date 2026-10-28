/* Only official public item images use the existing image conversion service.
   Private QR data, names, ownership and authentication are never sent. */
(() => {
  "use strict";
  const isOfficial = url => url.protocol === "https:" &&
    url.hostname === "www.takaratomy-arts.co.jp" && !url.username && !url.password &&
    url.pathname.startsWith("/specials/primagi/assets/images/item/") &&
    [...url.searchParams.keys()].every(key => ["p", "q", "v"].includes(key));
  function image(value, width = 420) {
    if (!value) return "";
    try {
      const source = new URL(value, location.href);
      if (!isOfficial(source)) return value;
      const proxy = new URL("https://wsrv.nl/");
      proxy.search = new URLSearchParams({url:source.href,w:String(width),fit:"inside",we:"",output:"webp",q:"82"});
      return proxy.href;
    } catch { return value; }
  }
  window.CARD_PRIMAGI = Object.freeze({ image });
  function fallback(img) {
    if (!(img instanceof HTMLImageElement) || img.dataset.primagiFallback) return;
    try {
      const proxy = new URL(img.src);
      if (proxy.origin !== "https://wsrv.nl") return;
      const source = new URL(proxy.searchParams.get("url"));
      if (!isOfficial(source)) return;
      img.dataset.primagiFallback = "true";
      img.src = source.href;
    } catch {}
  }
  document.addEventListener("error", event => fallback(event.target), true);
  document.querySelectorAll("img").forEach(img => { if (img.complete && !img.naturalWidth) fallback(img); });
})();
