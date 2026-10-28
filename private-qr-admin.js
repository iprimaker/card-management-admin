(() => {
  const host = window.CARD_VISIBILITY_ADMIN_HOST,
    root = document.getElementById("admin-operations");
  if (!host || !root) return;
  const panel = document.createElement("section");
  panel.className = "usage-panel";
  panel.innerHTML =
    '<h2>QRコードの登録上限</h2><p>利用者1人あたりの合計です。カード・フルコーデ・パーツ・セーブコード・フレンドカードのQRをそれぞれ1件と数えます。</p><form><label><input type="checkbox" name="unlimited"> 上限なし</label><label>登録上限数<input name="limit" type="number" min="0" max="100000" value="100" required></label><p>0は新規登録を停止します。上限を下げても登録済みのQRは削除されません。</p><button type="submit">上限を保存</button><p role="status"></p></form>';
  root.append(panel);
  const f = panel.querySelector("form"),
    msg = f.querySelector("[role=status]");
  f.unlimited.onchange = () => (f.limit.disabled = f.unlimited.checked);
  let who = null;
  async function load() {
    if (!host.authorized()) {
      who = null;
      return;
    }
    if (who === host.user()) return;
    const r = await host
      .client()
      .rpc("card_qr_admin_user_settings", { p_user: host.user() });
    if (r.error) {
      msg.textContent =
        "QR設定を取得できませんでした。SQLの反映を確認してください。";
      return;
    }
    who = host.user();
    f.unlimited.checked = r.data.global_limit === null;
    f.limit.disabled = f.unlimited.checked;
    f.limit.value = r.data.global_limit ?? 100;
  }
  setInterval(() => load().catch(() => {}), 1500);
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!host.authorized()) return;
    const button = f.querySelector("button");
    button.disabled = true;
    try {
      const r = await host.client().rpc("card_qr_admin_limit", {
        p_limit: f.unlimited.checked ? null : Number(f.limit.value),
      });
      if (r.error) throw r.error;
      msg.textContent = "登録上限を保存しました。";
    } catch {
      msg.textContent =
        "保存できませんでした。管理者認証と通信状態をご確認ください。";
    } finally {
      button.disabled = false;
    }
  };
})();

(() => {
  "use strict";
  const host = () => window.CARD_VISIBILITY_ADMIN_HOST;
  const root = document.getElementById("admin-users");
  if (!root) return;
  const style = document.createElement("style");
  style.textContent =
    ".qr-user-limit-button{margin-right:6px;white-space:nowrap;font-size:11px;padding:5px 8px}.qr-user-limit-dialog{box-sizing:border-box;width:min(420px,calc(100vw - 28px));max-height:85dvh;overflow:auto;border:1px solid #e7dfec;border-radius:16px;padding:22px;color:#51465b;background:#fff}.qr-user-limit-dialog::backdrop{background:#30213c88}.qr-user-limit-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.qr-user-limit-heading h2{font-size:18px;margin:0}.qr-user-limit-heading button{border:0;background:transparent;font-size:22px;color:#95859f;padding:0}.qr-user-limit-dialog form{display:grid;gap:14px;margin-top:18px}.qr-user-limit-dialog label{display:grid;gap:6px;font-size:12px}.qr-user-limit-dialog input,.qr-user-limit-dialog select{box-sizing:border-box;width:100%;padding:10px;border:1px solid #e7dfec;border-radius:8px;font-size:16px}.qr-user-limit-dialog p{font-size:12px;line-height:1.8;overflow-wrap:anywhere}.qr-user-limit-dialog small{font-size:11px;color:#8b7c97;line-height:1.8}.qr-user-limit-dialog [hidden]{display:none!important}.qr-user-entries{margin:12px 0;font-size:12px}.qr-user-entries summary{cursor:pointer}.qr-user-entries [data-list]{max-height:220px;overflow:auto}.qr-user-entry{display:flex;gap:7px;align-items:baseline;padding:7px 0;border-bottom:1px solid #eee7f2}.qr-user-entry small{flex:none;background:#f3edf8;border-radius:4px;padding:2px 5px;font-size:10px}.qr-user-entry span{min-width:0;overflow-wrap:anywhere}";
  document.head.append(style);
  const modal = document.createElement("dialog");
  modal.className = "qr-user-limit-dialog";
  modal.setAttribute("aria-labelledby", "qr-user-limit-title");
  modal.innerHTML =
    '<div class="qr-user-limit-heading"><h2 id="qr-user-limit-title">QRコードの個別上限</h2><button type="button" data-close aria-label="閉じる">×</button></div><p data-person></p><p data-current></p><details class="qr-user-entries"><summary>登録済みQR一覧</summary><p data-list-status role="status"></p><div data-list></div></details><form><label>適用する上限<select name="mode"><option value="default">共通設定を使う</option><option value="limited">件数を指定する</option><option value="unlimited">この登録者だけ上限なし</option></select></label><label data-number hidden>登録上限数<input name="limit" type="number" min="0" max="100000" step="1" value="100"></label><small>カード・コーデ・パーツ・セーブコードの合計です。0件は新規登録を停止します。上限を下げても登録済みのQRは削除されません。</small><button type="submit" class="primary">保存</button></form><p data-status role="status" aria-live="polite"></p>';
  document.body.append(modal);
  const form = modal.querySelector("form"),
    fields = form.elements,
    status = modal.querySelector("[data-status]");
  let target = null,
    admin = null,
    generation = 0,
    busy = false;
  const count = (n) =>
    n === null ? "上限なし" : Number(n).toLocaleString("ja-JP") + "件";
  const validAdmin = (user) => host()?.authorized() && host()?.user() === user;
  function modeChanged() {
    const yes = fields.mode.value === "limited";
    modal.querySelector("[data-number]").hidden = !yes;
    fields.limit.disabled = !yes;
    fields.limit.required = yes;
  }
  fields.mode.onchange = modeChanged;
  modal.querySelector("[data-close]").onclick = () => modal.close();
  modal.addEventListener("close", () => {
    generation++;
    target = null;
    admin = null;
    status.textContent = "";
    form.reset();
    modal.querySelector("[data-list]").replaceChildren();
    modal.querySelector(".qr-user-entries").open = false;
  });
  function mount() {
    for (const del of root.querySelectorAll("[data-delete-user]")) {
      const cell = del.parentElement;
      if (cell.querySelector("[data-qr-user-limit]")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "compact-button qr-user-limit-button";
      button.dataset.qrUserLimit = del.dataset.deleteUser;
      button.textContent = "QR上限";
      button.onclick = () => open(button);
      cell.insertBefore(button, del);
    }
  }
  async function open(button) {
    const user = host()?.user();
    if (!validAdmin(user) || busy) return;
    const request = ++generation,
      id = button.dataset.qrUserLimit;
    target = id;
    admin = user;
    modal.querySelector("[data-list]").replaceChildren();
    modal.querySelector("[data-list-status]").textContent = "";
    modal.querySelector(".qr-user-entries").open = false;
    modal.querySelector("[data-person]").textContent =
      button.closest("tr")?.querySelector(".user-identity")?.textContent ||
      "登録者";
    modal.querySelector("[data-current]").textContent = "";
    status.textContent = "確認しています…";
    form.hidden = true;
    modal.showModal();
    try {
      const r = await host()
        .client()
        .rpc("card_qr_admin_user_settings", { p_user: id });
      if (!validAdmin(user) || request !== generation || !modal.open) return;
      if (r.error || !r.data) throw Error();
      const data = r.data;
      fields.mode.value = data.override_present
        ? data.override_limit === null
          ? "unlimited"
          : "limited"
        : "default";
      fields.limit.value = data.override_limit ?? data.global_limit ?? 100;
      modeChanged();
      modal.querySelector("[data-current]").textContent =
        "共通：" +
        count(data.global_limit) +
        " ／ 適用中：" +
        count(data.effective_limit) +
        "（" +
        data.count +
        "件登録中・セーブコード" +
        data.save_count +
        "件・フレカ" +
        (data.friend_count || 0) +
        "件）";
      modal.querySelector("summary").textContent =
        "登録済みQR一覧（" +
        data.count +
        "件・フレカ" +
        (data.friend_count || 0) +
        "件）";
      form.hidden = false;
      status.textContent = "";
    } catch {
      if (request === generation)
        status.textContent =
          "設定を取得できませんでした。管理者認証と通信状態をご確認ください。";
    }
  }
  let listRequest = 0;
  modal
    .querySelector(".qr-user-entries")
    .addEventListener("toggle", async () => {
      if (
        !modal.querySelector(".qr-user-entries").open ||
        !target ||
        !validAdmin(admin)
      )
        return;
      const user = admin,
        id = target,
        request = generation,
        version = ++listRequest;
      const list = modal.querySelector("[data-list]"),
        msg = modal.querySelector("[data-list-status]");
      list.replaceChildren();
      msg.textContent = "読み込んでいます…";
      try {
        const all = [];
        for (let offset = 0; ; offset += 500) {
          const r = await host()
            .client()
            .rpc("card_qr_admin_user_list", { p_user: id, p_offset: offset });
          if (
            !validAdmin(user) ||
            request !== generation ||
            version !== listRequest ||
            !modal.open
          )
            return;
          if (r.error || !Array.isArray(r.data)) throw Error();
          all.push(...r.data);
          if (r.data.length < 500) break;
        }
        const labels = {
          aikatsu: "アイカツ",
          onegai: "おねがい",
          himitsu: "ひみつ",
          おねがい: "おねがい",
          ひみつ: "ひみつ",
          aipri: "アイプリ",
          primagi: "プリマジ",
          save: "セーブコード",
          friend: "フレカ",
          "aikatsu-save": "アイカツセーブ",
          "aipri-save": "アイプリセーブ",
          "primagi-save": "プリマジセーブ",
        };
        const kinds = {
          card: "カード",
          coordinate: "フルコーデ",
          part: "パーツ",
          save: "セーブコード",
          friend: "フレカ",
          "aikatsu-save": "アイカツセーブ",
          "aipri-save": "アイプリセーブ",
          "primagi-save": "プリマジセーブ",
        };
        for (const row of all) {
          const item = document.createElement("div");
          item.className = "qr-user-entry";
          const tag = document.createElement("small"),
            name = document.createElement("span");
          tag.textContent = labels[row.series] || "シリーズ未取得";
          name.textContent =
            row.name +
            (row.kind === "save" ? "" : " ／ " + (kinds[row.kind] || ""));
          item.append(tag, name);
          list.append(item);
        }
        msg.textContent = all.length ? "" : "登録済みQRコードはありません。";
      } catch {
        if (
          validAdmin(user) &&
          request === generation &&
          version === listRequest
        )
          msg.textContent =
            "一覧を取得できませんでした。通信状態を確認して開き直してください。";
      }
    });
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy || !target || !validAdmin(admin) || !form.reportValidity()) return;
    const user = admin,
      id = target,
      request = generation,
      mode = fields.mode.value;
    const limit = mode === "limited" ? Number(fields.limit.value) : null;
    if (
      mode === "limited" &&
      (!Number.isInteger(limit) || limit < 0 || limit > 100000)
    )
      return;
    busy = true;
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    status.textContent = "保存しています…";
    try {
      const r = await host()
        .client()
        .rpc("card_qr_admin_user_limit", {
          p_user: id,
          p_mode: mode,
          p_limit: limit,
        });
      if (!validAdmin(user) || request !== generation) return;
      if (r.error) throw r.error;
      for (const b of root.querySelectorAll("[data-qr-user-limit]"))
        if (b.dataset.qrUserLimit === id)
          b.textContent =
            mode === "default" ? "QR上限" : "QR上限：" + count(limit);
      modal.close();
    } catch {
      if (validAdmin(user) && request === generation)
        status.textContent =
          "保存できませんでした。管理者認証と通信状態をご確認ください。";
    } finally {
      busy = false;
      button.disabled = false;
    }
  };
  new MutationObserver(mount).observe(root, { childList: true, subtree: true });
  mount();
  setInterval(() => {
    if (modal.open && !validAdmin(admin)) modal.close();
  }, 500);
})();
