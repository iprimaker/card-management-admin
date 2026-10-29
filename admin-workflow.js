/* 管理画面のセッション境界・日時・フォーム保護。DB権限は各RPCで検証する。 */
(() => {
  "use strict";
  const mount = (callback) => {
    if (window.CARD_VISIBILITY_ADMIN_HOST)
      callback(window.CARD_VISIBILITY_ADMIN_HOST);
    else
      document.addEventListener(
        "admin-host-ready",
        () => callback(window.CARD_VISIBILITY_ADMIN_HOST),
        { once: true },
      );
  };
  const checkpoint = (host) => {
    const generation = host.generation(),
      user = host.user();
    return () =>
      host.authorized() &&
      host.generation() === generation &&
      host.user() === user;
  };
  const localDate = (value) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ""
      : new Date(date.getTime() + 32400000).toISOString().slice(0, 16);
  };
  const utcDate = (value) => {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
      throw Error("日時を確認してください。");
    const date = new Date(value + ":00+09:00");
    if (Number.isNaN(date.getTime()) || localDate(date) !== value)
      throw Error("日時を確認してください。");
    return date.toISOString();
  };
  const lock = (root) => {
    const controls = [...root.querySelectorAll("button,input,select,textarea")];
    const previous = controls.map((control) => control.disabled);
    controls.forEach((control) => {
      control.disabled = true;
    });
    return () =>
      controls.forEach((control, index) => {
        control.disabled = previous[index];
      });
  };
  const guards = [];
  function protect(page, dirty, saving, discard = () => {}) {
    guards.push({ page, dirty, saving, discard });
  }
  document.addEventListener("admin-page-before-change", (event) => {
    const leaving = guards.filter(
      (guard) =>
        event.detail.page !== guard.page &&
        !document.getElementById("admin-" + guard.page).hidden,
    );
    if (leaving.some((guard) => guard.saving())) {
      event.preventDefault();
      return;
    }
    const changed = leaving.filter((guard) => guard.dirty());
    if (changed.length) {
      if (!confirm("未保存の変更があります。変更を破棄して移動しますか？"))
        event.preventDefault();
      else changed.forEach((guard) => guard.discard());
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (guards.some((guard) => guard.dirty() || guard.saving())) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.ADMIN_WORKFLOW = Object.freeze({
    mount,
    checkpoint,
    localDate,
    utcDate,
    lock,
    protect,
  });
})();
