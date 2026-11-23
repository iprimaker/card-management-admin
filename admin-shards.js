/* Shared database context for users, contacts, invitations, QR and usage. */
(() => {
  "use strict";
  let mounted = false;
  function mount() {
    const host = window.CARD_VISIBILITY_ADMIN_HOST;
    const root = document.getElementById("admin-app");
    if (mounted || !host || !root) return;
    mounted = true;
    const box = document.createElement("section");
    box.className = "ops-connection";
    box.hidden = true;
    box.innerHTML = '<div class="ops-connection-top"><strong>運営用DBに接続しています</strong><label>管理する登録者DB<select aria-label="管理する登録者DB" disabled></select></label></div><p>登録者・お問い合わせ・招待・QR・使用状況は、選択したDBが対象です。DBの切り替え時に画面を読み直します。</p><p>カード・コーデ・お知らせ・閲覧設定・事前通知は全DB共通です。受付・人数上限・メンテナンス・QR上限は選択したDBに保存します。統計ページは全登録者DBを集計します。</p><p class="ops-connection-status" role="status"></p>';
    root.prepend(box);
    const select = box.querySelector("select");
    const status = box.querySelector("[role=status]");
    const syncNotice = document.createElement("p");
    syncNotice.setAttribute("role", "status");
    syncNotice.className = "ops-sync-notice";
    box.append(syncNotice);
    document.addEventListener("ops-catalog-sync-status", event => {
      if (host.authorized()) syncNotice.textContent = event.detail.message;
    });
    let registryEpoch = 0;
    async function activate() {
      if (!host.authorized()) return;
      box.hidden = false;
      const ticket = ++registryEpoch;
      try {
        const entries = await window.CARD_OPS_ADMIN.registry();
        if (ticket !== registryEpoch || !host.authorized()) return;
        select.replaceChildren(...entries.map((entry) => {
          const option = document.createElement("option");
          option.value = entry.key;
          option.textContent = entry.label;
          return option;
        }));
        select.value = window.CARD_OPS_ADMIN.database();
        select.disabled = window.CARD_OPS_ADMIN.busy();
        status.textContent = "操作対象：" + select.selectedOptions[0].textContent;
      } catch (error) {
        if (ticket === registryEpoch) status.textContent = host.errorText(error);
      }
    }
    select.onchange = () => {
      try {
        window.CARD_OPS_ADMIN.changeDatabase(select.value);
      } catch (error) {
        status.textContent = host.errorText(error);
      } finally {
        select.value = window.CARD_OPS_ADMIN.database();
      }
    };
    document.addEventListener("ops-admin-busy", (event) => {
      select.disabled = event.detail.busy || select.options.length === 0;
    });
    document.addEventListener("admin-page-changed", activate);
    document.addEventListener("admin-session-reset", () => {
      registryEpoch++;
      box.hidden = true;
      status.textContent = "";
      syncNotice.textContent = "";
      select.replaceChildren();
      select.disabled = true;
    });

    const users = document.getElementById("admin-users");
    const quota = document.createElement("section");
    quota.className = "shard-panel";
    quota.innerHTML = '<div class="shard-heading"><h3>登録者数の上限</h3><p>上部で選択した登録者DBの設定です。通常登録・招待制の設定とは別です。</p></div><div class="shard-stats"></div><form class="shard-config"><label>登録者数の上限<input name="max_users" type="number" min="1" max="2147483647" required></label><label class="shard-toggle"><input name="enabled" type="checkbox"><span class="shard-switch" aria-hidden="true"></span><span>人数上限を有効にする</span></label><button type="submit">上限を保存</button></form><p class="shard-note">予約で枠が埋まった場合も次のDBへ振り分けます。有効な発行済みIDは上限に達した後も元のDBで登録を完了できます。</p><p role="status"></p>';
    users.querySelector(".section-heading").after(quota);
    const form = quota.querySelector("form");
    const message = quota.querySelector("[role=status]");
    let config = null;
    let loading = false;
    let dirty = false;
    let epoch = 0;
    function locked(value) {
      form.querySelectorAll("input,button").forEach((control) => { control.disabled = value; });
    }
    locked(true);
    async function load(save = null) {
      if (!host.authorized() || loading || (!save && dirty)) return;
      const current = host.generation();
      const ticket = ++epoch;
      loading = true;
      locked(true);
      message.textContent = save ? "保存中…" : "確認中…";
      try {
        const result = await host.client().rpc(save ? "card_admin_shard_config_save_v1" : "card_admin_shard_config_v1", save || {});
        if (ticket !== epoch || current !== host.generation() || !host.authorized()) return;
        if (result.error) throw result.error;
        if (result.data?.prefix !== (window.CARD_OPS_ADMIN.database() === "main" ? "" : window.CARD_OPS_ADMIN.database())) {
          throw Error("登録者DBが一致しません。");
        }
        config = result.data;
        form.elements.max_users.value = config.max_users;
        form.elements.enabled.checked = config.enforcement_enabled === true;
        quota.querySelector(".shard-stats").textContent = "登録者 " + config.registered_users + "人 ／ 上限 " + config.max_users + "人 ／ 残り " + config.remaining + "人";
        dirty = false;
        message.textContent = save ? "人数上限を保存しました。" : "";
      } catch (error) {
        if (ticket === epoch) message.textContent = host.errorText(error);
      } finally {
        if (ticket === epoch) {
          loading = false;
          locked(!config);
        }
      }
    }
    form.oninput = () => { dirty = true; };
    form.onsubmit = (event) => {
      event.preventDefault();
      const max = Number(form.elements.max_users.value);
      if (!config || !Number.isInteger(max) || max < 1 || max > 2147483647) return;
      load({ p_max_users: max, p_enabled: form.elements.enabled.checked, p_revision: config.revision });
    };
    window.ADMIN_WORKFLOW.protect("users", () => dirty, () => loading, () => { dirty = false; });
    document.addEventListener("admin-page-changed", (event) => {
      if (event.detail.page === "users") load();
    });
    document.addEventListener("admin-session-reset", () => {
      epoch++;
      config = null;
      dirty = loading = false;
      message.textContent = "";
      quota.querySelector(".shard-stats").textContent = "";
      form.reset();
      locked(true);
    });
    if (host.authorized()) activate();
  }
  document.addEventListener("admin-host-ready", mount);
  if (window.CARD_VISIBILITY_ADMIN_HOST) mount();
})();
