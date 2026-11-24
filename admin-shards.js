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
    box.innerHTML =
      '<div class="ops-connection-top"><label>登録者DB<select aria-label="管理する登録者DB" disabled></select></label><span class="ops-connection-status" role="status"></span></div>';

    root.prepend(box);
    const select = box.querySelector("select");
    const status = box.querySelector("[role=status]");
    const syncNotice = document.createElement("p");
    syncNotice.setAttribute("role", "status");
    syncNotice.className = "ops-sync-notice";
    root.prepend(syncNotice);
    syncNotice.hidden = true;
    document.addEventListener("ops-catalog-sync-status", (event) => {
      if (host.authorized()) {
        syncNotice.textContent = event.detail.message;
        syncNotice.hidden = false;
      }
    });
    let registryEpoch = 0;
    let activePage = location.hash.slice(1);
    async function activate() {
      if (!host.authorized()) return;
      box.hidden = !["users", "usage"].includes(activePage);
      const ticket = ++registryEpoch;
      try {
        const entries = await window.CARD_OPS_ADMIN.registry();
        if (ticket !== registryEpoch || !host.authorized()) return;
        select.replaceChildren(
          ...entries.map((entry) => {
            const option = document.createElement("option");
            option.value = entry.key;
            option.textContent = entry.label;
            return option;
          }),
        );
        select.value = window.CARD_OPS_ADMIN.database();
        select.disabled = window.CARD_OPS_ADMIN.busy();
        status.textContent =
          "操作対象：" + select.selectedOptions[0].textContent;
      } catch (error) {
        if (ticket === registryEpoch)
          status.textContent = host.errorText(error);
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
    document.addEventListener("admin-page-changed", (event) => {
      activePage = event.detail.page;
      activate();
    });
    document.addEventListener("admin-session-reset", () => {
      registryEpoch++;
      box.hidden = true;
      status.textContent = "";
      syncNotice.textContent = "";
      syncNotice.hidden = true;
      select.replaceChildren();
      select.disabled = true;
    });

    const users = document.getElementById("admin-users");
    const quota = document.createElement("section");
    quota.className = "shard-panel";
    quota.innerHTML =
      '<div class="shard-heading"><h3>登録者数の上限</h3><p>上部で選択した登録者DBの設定です。通常登録・招待制の設定とは別です。</p></div><div class="shard-stats"></div><div class="shard-occupancy"><div><span>登録者数／設定上限</span><span data-quota-ratio></span></div><progress aria-label="登録者数と設定上限" value="0" max="100"></progress></div><form class="shard-config"><label>登録者数の上限<input name="max_users" type="number" min="1" max="2147483647" required></label><label class="shard-toggle"><input name="enabled" type="checkbox"><span class="shard-switch" aria-hidden="true"></span><span>人数上限を有効にする</span></label><button type="submit">上限を保存</button></form><p class="shard-note">予約で枠が埋まった場合も次のDBへ振り分けます。有効な発行済みIDは上限に達した後も元のDBで登録を完了できます。</p><p role="status"></p>';
    users.querySelector(".section-heading").after(quota);
    const form = quota.querySelector("form");
    const message = quota.querySelector("[role=status]");
    let config = null;
    let loading = false;
    let dirty = false;
    let epoch = 0;
    function locked(value) {
      form.querySelectorAll("input,button").forEach((control) => {
        control.disabled = value;
      });
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
        const result = await host
          .client()
          .rpc(
            save
              ? "card_admin_shard_config_save_v1"
              : "card_admin_shard_config_v1",
            save || {},
          );
        if (
          ticket !== epoch ||
          current !== host.generation() ||
          !host.authorized()
        )
          return;
        if (result.error) throw result.error;
        if (
          result.data?.prefix !==
          (window.CARD_OPS_ADMIN.database() === "main"
            ? ""
            : window.CARD_OPS_ADMIN.database())
        ) {
          throw Error("登録者DBが一致しません。");
        }
        config = result.data;
        form.elements.max_users.value = config.max_users;
        form.elements.enabled.checked = config.enforcement_enabled === true;
        const stats = quota.querySelector(".shard-stats");
        stats.replaceChildren();
        for (const [label, value] of [
          ["登録者", config.registered_users],
          ["設定上限", config.max_users],
          ["残り（登録済み基準）", config.remaining],
        ]) {
          const card = document.createElement("div");
          card.className = "shard-stat";
          const title = document.createElement("span"),
            number = document.createElement("strong");
          title.textContent = label;
          number.textContent = Number(value).toLocaleString("ja-JP") + "人";
          card.append(title, number);
          stats.append(card);
        }
        const ratio = Math.min(
          100,
          (config.registered_users / config.max_users) * 100,
        );
        quota.querySelector("progress").value = ratio;
        quota.querySelector("[data-quota-ratio]").textContent =
          ratio.toFixed(1) +
          "% · " +
          (config.enforcement_enabled ? "人数上限 ON" : "人数上限 OFF");
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
    form.oninput = () => {
      dirty = true;
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      const max = Number(form.elements.max_users.value);
      if (!config || !Number.isInteger(max) || max < 1 || max > 2147483647)
        return;
      load({
        p_max_users: max,
        p_enabled: form.elements.enabled.checked,
        p_revision: config.revision,
      });
    };
    window.ADMIN_WORKFLOW.protect(
      "users",
      () => dirty,
      () => loading,
      () => {
        dirty = false;
      },
    );
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
