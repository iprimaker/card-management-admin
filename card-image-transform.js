(() => {
  "use strict";

  const defaults = { x: 0, y: 0, zoom: 1, angle: 0 };
  const limits = { x: [-1000, 1000], y: [-1000, 1000], zoom: [0.25, 20], angle: [-180, 180] };
  const keys = Object.keys(defaults);
  function normalize(value) {
    if (!value || typeof value !== "object") return null;
    if (!keys.every((key) => {
      const [min, max] = limits[key];
      return Number.isFinite(value[key]) && value[key] >= min && value[key] <= max;
    })) return null;
    return Object.fromEntries(keys.map((key) => [key, value[key]]));
  }

  const css = ({ x, y, zoom, angle }) =>
    `translate(${x}%, ${y}%) scale(${zoom}) rotate(${angle}deg)`;
  function wrap(markup, transform) {
    const value = normalize(transform);
    return value
      ? `<span class="card-crop-frame" style="--card-crop:${css(value)}">${markup}</span>`
      : markup;
  }
  function apply(image, transform) {
    if (!image) return;
    const value = normalize(transform);
    let frame = image.parentElement;
    if (frame?.classList.contains("card-crop-frame")) {
      if (!value) {
        frame.replaceWith(image);
        return;
      }
    } else {
      if (!value) return;
      frame = document.createElement("span");
      frame.className = "card-crop-frame";
      image.before(frame);
      frame.append(image);
    }
    frame.style.setProperty("--card-crop", css(value));
  }

  const sheet = document.createElement("style");
  sheet.textContent = `
    .card-crop-frame {
      box-sizing: border-box;
      position: relative;
      display: block;
      width: 100%;
      aspect-ratio: 460 / 670;
      overflow: hidden;
      border-radius: 8px;
      background: #eeeaf2;
      line-height: 0;
    }
    .card-crop-frame:has(> img[hidden]) { display: none; }
    .card-crop-frame > img:not([hidden]) {
      position: absolute !important;
      inset: 0 !important;
      display: block !important;
      width: 100% !important;
      height: 100% !important;
      max-width: none !important;
      max-height: none !important;
      padding: 0 !important;
      border-radius: 0 !important;
      object-fit: contain !important;
      transform-origin: center !important;
      transform: var(--card-crop) !important;
    }
    .viewer .card-crop-frame { width: min(100%, 35vh); margin-inline: auto; }
    #edit-front-preview { min-width: 0; }
    #edit-front-preview .card-crop-frame { width: min(100%, 190px); margin-inline: auto; }
    .card-crop-editor { min-inline-size: 0; margin-top: 1rem; padding: 0.8rem; }
    .card-crop-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; }
    .card-crop-controls[hidden] { display: none; }
    .card-crop-controls label { display: grid; gap: 0.25rem; }
    .card-crop-controls input { width: 100%; box-sizing: border-box; min-width: 0; }
  `;
  document.head.append(sheet);
  window.CARD_IMAGE_TRANSFORM = Object.freeze({ defaults: Object.freeze(defaults), normalize, wrap, apply });
})();
