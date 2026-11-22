/* Additive admin panel. Existing main-DB user controls remain in place. */
(() => {
  "use strict";
  let mounted = false;
  function mount() {
    const host = window.CARD_VISIBILITY_ADMIN_HOST;
    const section = document.getElementById("admin-users");
    if (mounted || !host || !section) return;
    mounted = true;
    const panel = document.createElement("div");
    panel.className = "shard-panel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="shard-toolbar">
        <label>登録先DB<select data-shard="database"><option value="main">本体</option><option value="A">DB A</option></select></label>
        <button type="button" data-shard="reload">DB情報を更新</button>
      </div>
      <div class="shard-stats" data-shard="stats"></div>
      <form class="shard-config" data-shard="form">
        <label>登録者数の上限<input data-shard="limit" type="number" min="1" max="2147483647" step="1" required></label>
        <label class="shard-toggle"><input data-shard="enabled" type="checkbox">人数上限を有効にする</label>
        <button type="submit" data-shard="save">上限を保存</button>
      </form>
      <p class="shard-note">上限を現在人数より少なくしても、登録済みのアカウントは維持されます。Aの準備が完了するまでは上限制御を有効にしないでください。</p>
      <p class="shard-status" role="status" data-shard="status"></p>
      <div data-shard="remote" hidden>
        <form class="shard-search" data-shard="search-form"><label>アルバムID・ニックネーム<input data-shard="search" maxlength="100"></label><button type="submit">検索</button></form>
        <p class="shard-note">所持数は記録された数量の合計です。コーデとパーツは分けて表示します。</p>
        <div class="shard-table-wrap"><table><thead><tr><th>アルバムID</th><th>ニックネーム</th><th>カード</th><th>旧アイカツ</th><th>コーデ</th><th>パーツ</th><th>QR</th><th>登録日</th></tr></thead><tbody data-shard="users"></tbody></table></div>
        <div class="shard-pages"><button type="button" data-shard="previous">前へ</button><span data-shard="page"></span><button type="button" data-shard="next">次へ</button></div>
      </div>`;
    const heading = section.querySelector(".section-heading");
    if (heading) heading.after(panel);
    else section.prepend(panel);
    const element = (name) => panel.querySelector(`[data-shard="${name}"]`);
    const format = (value) => Number(value).toLocaleString("ja-JP");
    let config = null,
      controller = null,
      ticket = 0,
      offset = 0,
      total = 0,
      search = "";
    function reset() {
      ticket++;
      controller?.abort();
      config = null;
      panel.hidden = true;
      section.classList.remove("shard-remote-selected");
      element("users").replaceChildren();
      element("stats").replaceChildren();
      element("status").textContent = "";
      element("limit").value = "";
      element("enabled").checked = false;
    }
    function busy(value) {
      for (const item of panel.querySelectorAll("button,input,select"))
        item.disabled = value;
      if (!value) {
        element("save").disabled = !config;
        element("previous").disabled = offset === 0;
        element("next").disabled = offset + 100 >= total;
      }
      panel.setAttribute("aria-busy", String(value));
    }
    function render(value) {
      config = value;
      element("limit").value = value.max_users;
      element("enabled").checked = value.enforcement_enabled;
      const stats = element("stats");
      stats.replaceChildren();
      for (const [label, number] of [
        ["登録者", value.registered_users],
        ["上限", value.max_users],
        ["残り枠", value.remaining],
      ]) {
        const item = document.createElement("span");
        item.textContent = `${label} ${format(number)}人`;
        stats.append(item);
      }
      const state = document.createElement("span");
      state.textContent = value.enforcement_enabled
        ? "人数制限：有効"
        : "人数制限：無効";
      stats.append(state);
    }
    async function edge(body, signal) {
      const session = await host.client().auth.getSession();
      if (session.error || !session.data?.session?.access_token)
        throw Error("ログインし直してください。");
      const response = await fetch(
        `${host.config.supabaseUrl.replace(/\/$/, "")}/functions/v1/admin-shards`,
        {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
            apikey: host.config.supabaseKey,
            Authorization: "Bearer " + session.data.session.access_token,
          },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Error(result.error || "管理者用DB接続を確認してください。");
      return result;
    }
    async function operation(action, extra = {}) {
      if (!host.authorized()) return reset();
      const current = ++ticket,
        generation = host.generation(),
        database = element("database").value;
      controller?.abort();
      controller = new AbortController();
      const activeController = controller;
      const signal = activeController.signal;
      const timer = setTimeout(() => activeController.abort(), 20000);
      const currentSession = () =>
        current === ticket &&
        generation === host.generation() &&
        host.authorized();
      panel.hidden = false;
      config = action === "save" ? config : null;
      busy(true);
      element("status").textContent = "確認中…";
      element("users").replaceChildren();
      try {
        if (database === "main") {
          const name =
            action === "save"
              ? "card_admin_shard_config_save_v1"
              : "card_admin_shard_config_v1";
          const args =
            action === "save"
              ? {
                  p_max_users: extra.maxUsers,
                  p_enabled: extra.enabled,
                  p_revision: extra.revision,
                }
              : {};
          const result = await host
            .client()
            .rpc(name, args)
            .abortSignal(signal);
          if (result.error) throw result.error;
          if (!currentSession()) return;
          if (result.data?.prefix !== "")
            throw Error("本体DBの接頭辞設定を確認してください。");
          render(result.data);
        } else {
          const result = await edge(
            {
              action: action === "save" ? "save" : "users",
              database,
              search,
              offset,
              ...extra,
            },
            signal,
          );
          if (!currentSession()) return;
          if (result.config?.prefix !== database)
            throw Error("DBの接頭辞設定を確認してください。");
          render(result.config);
          if (action === "save") {
            busy(false);
            return operation("load");
          }
          total = result.total;
          for (const user of result.users) {
            const row = document.createElement("tr");
            for (const value of [
              user.album_id,
              user.nickname,
              user.card_quantity,
              user.archive_quantity,
              user.coordinate_quantity,
              user.part_quantity,
              user.qr_count,
              user.created_at
                ? new Date(user.created_at).toLocaleDateString("ja-JP")
                : "—",
            ]) {
              const cell = document.createElement("td");
              cell.textContent = String(value ?? "—");
              row.append(cell);
            }
            element("users").append(row);
          }
          if (!result.users.length) {
            const row = document.createElement("tr"),
              cell = document.createElement("td");
            cell.colSpan = 8;
            cell.textContent = "該当する登録者はいません。";
            row.append(cell);
            element("users").append(row);
          }
          element("page").textContent =
            `${format(total)}人・${Math.floor(offset / 100) + 1}ページ`;
        }
        if (currentSession())
          element("status").textContent =
            action === "save" ? "上限設定を保存しました。" : "";
      } catch (error) {
        if (currentSession())
          element("status").textContent =
            error.name === "AbortError"
              ? "通信を完了できませんでした。再度お試しください。"
              : host.errorText(error);
      } finally {
        clearTimeout(timer);
        if (currentSession()) busy(false);
      }
    }
    element("database").addEventListener("change", () => {
      offset = 0;
      search = "";
      element("search").value = "";
      const remote = element("database").value !== "main";
      section.classList.toggle("shard-remote-selected", remote);
      element("remote").hidden = !remote;
      operation("load");
    });
    element("reload").addEventListener("click", () => operation("load"));
    element("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const maxUsers = Number(element("limit").value);
      if (
        !config ||
        !Number.isSafeInteger(maxUsers) ||
        maxUsers < 1 ||
        maxUsers > 2147483647
      )
        return;
      operation("save", {
        maxUsers,
        enabled: element("enabled").checked,
        revision: config.revision,
      });
    });
    element("search-form").addEventListener("submit", (event) => {
      event.preventDefault();
      search = element("search").value.trim();
      offset = 0;
      operation("load");
    });
    element("previous").addEventListener("click", () => {
      offset = Math.max(0, offset - 100);
      operation("load");
    });
    element("next").addEventListener("click", () => {
      if (offset + 100 < total) {
        offset += 100;
        operation("load");
      }
    });
    let registryLoaded = false;
    async function activate() {
      if (!host.authorized()) return;
      panel.hidden = false;
      if (!registryLoaded) {
        const generation = host.generation();
        try {
          const result = await edge(
            { action: "registry" },
            AbortSignal.timeout(10000),
          );
          if (generation !== host.generation() || !host.authorized()) return;
          const selected = element("database").value;
          const options = [];
          for (const item of result.databases) {
            if (!/^(main|[A-Z])$/.test(item.key)) continue;
            const option = document.createElement("option");
            option.value = item.key;
            option.textContent = item.label;
            options.push(option);
          }
          element("database").replaceChildren(...options);
          element("database").value = options.some(
            (item) => item.value === selected,
          )
            ? selected
            : "main";
          registryLoaded = true;
        } catch {
          /* The main-DB panel remains usable before Edge deployment. */
        }
      }
      const remote = element("database").value !== "main";
      section.classList.toggle("shard-remote-selected", remote);
      element("remote").hidden = !remote;
      operation("load");
    }
    document.addEventListener("admin-page-changed", (event) => {
      if (
        event.detail?.page === "users" ||
        event.detail?.page === "admin-users"
      )
        activate();
    });
    document.addEventListener("admin-session-reset", () => {
      registryLoaded = false;
      reset();
    });
    if (host.authorized()) activate();
  }
  document.addEventListener("admin-host-ready", mount);
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
