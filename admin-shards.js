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
        <div class="shard-heading"><span class="shard-eyebrow">登録者の管理</span><h3>登録先DBと人数上限</h3><p>登録先ごとに、人数と受付の上限を確認できます。</p></div>
        <div class="shard-toolbar-actions"><label>登録先DB<select data-shard="database"><option value="main">本体</option><option value="A">DB A</option></select></label><button type="button" class="shard-secondary" data-shard="reload">状態を更新</button></div>
      </div>
      <div class="shard-stats" data-shard="stats"></div>
      <div class="shard-occupancy"><div><span>登録人数の使用状況</span><span data-shard="usage-text">—</span></div><progress data-shard="usage" max="100" value="0" aria-label="登録人数の使用状況"></progress></div>
      <form class="shard-config" data-shard="form">
        <label class="shard-limit-label">登録者数の上限<span class="shard-input-unit"><input data-shard="limit" type="number" min="1" max="2147483647" step="1" required><span>人</span></span></label>
        <label class="shard-toggle"><input data-shard="enabled" type="checkbox"><span class="shard-switch" aria-hidden="true"></span><span>人数上限を有効にする<small>上限に達した登録先への新規登録を停止</small></span></label>
        <button type="submit" class="shard-primary" data-shard="save">上限を保存</button>
      </form>
      <p class="shard-note">人数上限と、通常登録・招待制の受付方法は別の設定です。上限を変更しても、登録済みのアカウントや受付方法は変更しません。</p>
      <details class="shard-help"><summary>残り人数と予約について</summary><p>残り人数は、登録済みの人数を基準に表示しています。発行済みIDで手続き中の方がいる場合、残り人数があっても新しいIDの発行を一時停止することがあります。</p></details>
      <p class="shard-status" role="status" data-shard="status"></p>
      <div class="shard-remote" data-shard="remote" hidden>
        <div class="shard-list-heading"><div><h3>登録者一覧</h3><p>アルバムID・ニックネームから検索できます。</p></div><span class="shard-list-count" data-shard="list-count">—</span></div>
        <form class="shard-search" data-shard="search-form"><label><span>アカウントを検索</span><input data-shard="search" type="search" maxlength="100" placeholder="アルバムID・ニックネーム" autocomplete="off"></label><button type="submit" class="shard-secondary">検索</button></form>
        <div class="shard-table-wrap"><table class="shard-user-table"><caption class="shard-visually-hidden">選択したDBの登録者一覧</caption><thead><tr><th scope="col">アカウント</th><th scope="col">登録日時</th><th scope="col">最終ログイン</th><th scope="col">所持数</th><th scope="col">QR登録数</th></tr></thead><tbody data-shard="users"></tbody></table></div>
        <div class="shard-pages"><span data-shard="page" aria-live="polite"></span><div><button type="button" data-shard="previous" aria-label="前のページ">前へ</button><button type="button" data-shard="next" aria-label="次のページ">次へ</button></div></div>
        <p class="shard-note shard-count-note">所持数は記録された数量の合計です。フルコーデとパーツは別々に表示し、パーツからのコンプ判定は含みません。最終ログインは認証時刻で、現在のオンライン状態を示すものではありません。</p>
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
      element("enabled").checked = value.enforcement_enabled === true;
      const stats = element("stats");
      stats.replaceChildren();
      for (const [label, number] of [
        ["登録者数", value.registered_users],
        ["設定上限", value.max_users],
        ["残り人数", value.remaining],
      ]) {
        const item = document.createElement("div");
        item.className = "shard-stat";
        const title = document.createElement("span");
        title.textContent = label;
        const amount = document.createElement("strong");
        amount.textContent = format(number);
        const unit = document.createElement("small");
        unit.textContent = "人";
        amount.append(unit);
        item.append(title, amount);
        stats.append(item);
      }
      const state = document.createElement("div");
      state.className = "shard-stat shard-limit-state";
      state.dataset.enabled = String(value.enforcement_enabled === true);
      const label = document.createElement("span");
      label.textContent = "人数上限";
      const text = document.createElement("strong");
      text.textContent = value.enforcement_enabled ? "有効" : "無効";
      state.append(label, text);
      stats.append(state);
      const used = Number(value.registered_users), maximum = Number(value.max_users);
      element("usage").value = maximum > 0 ? Math.min(100, used / maximum * 100) : 0;
      element("usage-text").textContent = `${format(used)} / ${format(maximum)}人`;
    }
    function dateLabel(raw) {
      if (!raw) return ["—", ""];
      const date = new Date(raw);
      if (!Number.isFinite(date.getTime())) return ["—", ""];
      return [
        new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date),
        new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(date),
      ];
    }
    function renderUser(user) {
      const row = document.createElement("tr");
      function cell(label) {
        const node = document.createElement("td");
        node.dataset.label = label;
        row.append(node);
        return node;
      }
      const account = cell("アカウント");
      account.className = "shard-account-cell";
      const name = document.createElement("strong");
      name.className = "shard-account-name";
      name.textContent = user.nickname || "ニックネーム未設定";
      const id = document.createElement("code");
      id.className = "shard-account-id";
      id.textContent = user.album_id;
      account.append(name, id);
      for (const [label, raw] of [["登録日時", user.created_at], ["最終ログイン", user.last_sign_in_at]]) {
        const node = cell(label);
        node.className = "shard-date-cell";
        const [date, time] = dateLabel(raw);
        const main = document.createElement("span");
        main.textContent = date;
        const detail = document.createElement("small");
        detail.textContent = time;
        node.append(main, detail);
      }
      const holdings = cell("所持数");
      const counts = document.createElement("div");
      counts.className = "shard-user-counts";
      for (const [label, quantity] of [["カード", user.card_quantity], ["アイカツALL", user.archive_quantity], ["フルコーデ", user.coordinate_quantity], ["パーツ", user.part_quantity]]) {
        const item = document.createElement("span");
        const title = document.createElement("span");
        title.textContent = label;
        const number = document.createElement("b");
        number.textContent = format(quantity ?? 0);
        item.append(title, number);
        counts.append(item);
      }
      holdings.append(counts);
      const qr = cell("QR登録数");
      const badge = document.createElement("span");
      badge.className = "shard-qr-count";
      badge.textContent = format(user.qr_count ?? 0) + "件";
      qr.append(badge);
      return row;
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
          if (action === "save" && (result.data.max_users !== extra.maxUsers || result.data.enforcement_enabled !== extra.enabled))
            throw Error("人数上限の保存結果が一致しません。状態を更新して確認してください。");
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
          if (action === "save" && (result.config.max_users !== extra.maxUsers || result.config.enforcement_enabled !== extra.enabled))
            throw Error("人数上限の保存結果が一致しません。状態を更新して確認してください。");
          render(result.config);
          if (action === "save") {
            busy(false);
            return operation("load");
          }
          total = result.total;
          element("list-count").textContent = format(total) + "人";
          for (const user of result.users) element("users").append(renderUser(user));
          if (!result.users.length) {
            const row = document.createElement("tr"), cell = document.createElement("td");
            row.className = "shard-empty-row";
            cell.colSpan = 5;
            const title = document.createElement("strong");
            title.textContent = search ? "該当する登録者がいません" : "登録者はまだいません";
            const description = document.createElement("span");
            description.textContent = search ? "検索するIDやニックネームを変えてお試しください。" : "この登録先でアカウントが作成されると、ここに表示されます。";
            cell.append(title, description);
            row.append(cell);
            element("users").append(row);
          }
          element("page").textContent = total
            ? `${format(offset + 1)}〜${format(Math.min(offset + result.users.length, total))}人 / ${format(total)}人 · ${Math.floor(offset / 100) + 1}ページ`
            : "0人";
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
