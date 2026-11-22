/* Use the original users table and confirmation dialog for every registered DB. */
(() => {
  "use strict";
  let mounted = false;
  function mount() {
    const host = window.CARD_VISIBILITY_ADMIN_HOST;
    const section = document.getElementById("admin-users");
    const usageSection = document.getElementById("admin-usage");
    if (mounted || !host || !section || !usageSection) return;
    mounted = true;
    let databases = [{ key: "main", prefix: "", label: "本体" }];
    let usersDB = "main",
      usageDB = "main",
      config = null;
    let configTicket = 0,
      usageTicket = 0,
      registryFlight = null;
    let configBusy = false,
      usageBusy = false;
    const rows = new Map();
    const panel = document.createElement("div");
    panel.className = "shard-panel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="shard-toolbar"><div class="shard-heading"><span class="shard-eyebrow">登録者の管理</span><h3>登録先DBと人数上限</h3><p>下の一覧・検索条件・操作は、選択した登録先に適用されます。</p></div><div class="shard-toolbar-actions"><label>登録先DB<select data-shard="database"><option value="main">本体</option></select></label><button type="button" data-shard="reload">状態を更新</button></div></div>
      <div class="shard-stats" data-shard="stats"></div>
      <form class="shard-config" data-shard="form"><label class="shard-limit-label">登録者数の上限<span class="shard-input-unit"><input data-shard="limit" type="number" min="1" max="2147483647" step="1" required><span>人</span></span></label><label class="shard-toggle"><input data-shard="enabled" type="checkbox"><span class="shard-switch" aria-hidden="true"></span><span>人数上限を有効にする<small>予約で枠が埋まった場合も、次のDBへ振り分けます</small></span></label><button type="submit" class="shard-primary" data-shard="save">上限を保存</button></form>
      <p class="shard-note">人数上限と通常登録・招待制の受付方法は別の設定です。有効な発行済みIDは、人数上限に到達した後も元のDBで登録を完了できます。</p>
      <p class="shard-status" role="status" data-shard="status"></p>`;
    section.querySelector(".section-heading")?.after(panel);
    const el = (name) => panel.querySelector(`[data-shard="${name}"]`);
    const usage = document.createElement("div");
    usage.className = "shard-usage-panel";
    usage.innerHTML = `
      <div class="shard-usage-toolbar"><label>確認する登録先DB<select data-usage="database"><option value="main">本体</option></select></label><span data-usage="measured"></span></div>
      <p class="shard-usage-message" role="status" data-usage="message"></p>
      <div class="shard-usage-metrics" data-usage="metrics"></div>
      <div class="shard-usage-sync" data-usage="sync"></div>
      <p class="shard-usage-note">選択したDBの現在の実測値です。月間の課金対象使用量や転送量とは異なります。追加DBの容量には、同期した共通カタログも含まれます。</p>
      <div class="section-heading"><h2>テーブル別の使用状況</h2><a data-usage="dashboard" target="_blank" rel="noopener noreferrer">Supabaseで確認 ↗</a></div>
      <div class="table-wrap"><table><thead><tr><th scope="col">テーブル</th><th scope="col">容量</th><th scope="col">推定行数</th></tr></thead><tbody data-usage="tables"></tbody></table></div>
      <details class="shard-usage-details"><summary>詳しいDB統計</summary><button type="button" data-usage="details">詳細を取得</button><p data-usage="detail-message" role="status"></p><div class="shard-usage-metrics" data-usage="detail-metrics"></div><p class="shard-usage-note">DB統計は統計リセット以降の累計です。サイト全体の通信件数・転送量ではありません。</p></details>`;
    usageSection.querySelector(".section-heading")?.after(usage);
    usageSection.classList.add("shard-usage-active");
    const ue = (name) => usage.querySelector(`[data-usage="${name}"]`);
    const format = (n) => Number(n ?? 0).toLocaleString("ja-JP");
    function bytes(raw) {
      if (raw == null) return "取得できません";
      const n = Number(raw);
      return n >= 1e9
        ? (n / 1e9).toFixed(2) + " GB"
        : n >= 1e6
          ? (n / 1e6).toFixed(1) + " MB"
          : format(n) + " B";
    }
    function date(raw) {
      if (!raw || !Number.isFinite(Date.parse(raw))) return "—";
      return new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(raw));
    }
    async function edge(body) {
      if (!host.authorized()) throw Error("ログインし直してください。");
      const generation = host.generation();
      const session = await host.client().auth.getSession();
      if (session.error || !session.data?.session?.access_token)
        throw Error("ログインし直してください。");
      const response = await fetch(
        host.config.supabaseUrl.replace(/\/$/, "") +
          "/functions/v1/admin-shards",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: host.config.supabaseKey,
            Authorization: "Bearer " + session.data.session.access_token,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(35000),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!host.authorized() || generation !== host.generation())
        throw Error("ログイン状態が変更されました。");
      if (!response.ok)
        throw Error(data.error || "選択したDBの設定・接続を確認してください。");
      return data;
    }
    async function registry() {
      if (registryFlight) return registryFlight;
      registryFlight = (async () => {
        const data = await edge({ action: "registry" });
        if (!Array.isArray(data.databases))
          throw Error("DBの一覧を取得できませんでした。");
        databases = data.databases.filter(
          (item) =>
            /^(main|[A-Z])$/.test(item.key) && typeof item.label === "string",
        );
        for (const select of [el("database"), ue("database")]) {
          const selected = select === el("database") ? usersDB : usageDB;
          select.replaceChildren(
            ...databases.map((item) => {
              const option = document.createElement("option");
              option.value = item.key;
              option.textContent = item.label;
              return option;
            }),
          );
          select.value = databases.some((d) => d.key === selected)
            ? selected
            : "main";
        }
      })().finally(() => {
        registryFlight = null;
      });
      return registryFlight;
    }
    function renderConfig(data) {
      config = data;
      el("limit").value = data.max_users;
      el("enabled").checked = data.enforcement_enabled === true;
      el("stats").replaceChildren();
      for (const [label, amount] of [
        ["登録者数", data.registered_users],
        ["設定上限", data.max_users],
        ["残り人数", data.remaining],
        ["人数上限", data.enforcement_enabled ? "有効" : "無効"],
      ]) {
        const box = document.createElement("div");
        box.className = "shard-stat";
        const title = document.createElement("span");
        title.textContent = label;
        const value = document.createElement("strong");
        value.textContent =
          typeof amount === "number" ? format(amount) + "人" : String(amount);
        box.append(title, value);
        el("stats").append(box);
      }
    }
    async function loadConfig(save) {
      if (!host.authorized() || configBusy) return;
      const ticket = ++configTicket,
        database = usersDB;
      configBusy = true;
      panel.querySelectorAll("input,select,button").forEach((c) => {
        c.disabled = true;
      });
      el("status").textContent = save ? "保存しています…" : "確認しています…";
      try {
        let data;
        if (database === "main") {
          const result = await host
            .client()
            .rpc(
              save
                ? "card_admin_shard_config_save_v1"
                : "card_admin_shard_config_v1",
              save
                ? {
                    p_max_users: save.maxUsers,
                    p_enabled: save.enabled,
                    p_revision: save.revision,
                  }
                : {},
            );
          if (result.error) throw result.error;
          data = result.data;
        } else {
          data = (
            await edge({
              action: save ? "save" : "status",
              database,
              ...(save || {}),
            })
          ).config;
        }
        if (
          ticket !== configTicket ||
          !host.authorized() ||
          usersDB !== database
        )
          return;
        if (data?.prefix !== (database === "main" ? "" : database))
          throw Error("登録先DBが一致しません。");
        if (
          save &&
          (data.max_users !== save.maxUsers ||
            data.enforcement_enabled !== save.enabled)
        )
          throw Error("人数上限の保存結果が一致しません。");
        renderConfig(data);
        el("status").textContent = save ? "上限設定を保存しました。" : "";
      } catch (error) {
        if (ticket === configTicket)
          el("status").textContent = host.errorText(error);
      } finally {
        if (ticket === configTicket) {
          configBusy = false;
          panel.querySelectorAll("input,select,button").forEach((c) => {
            c.disabled = false;
          });
          el("save").disabled = !config;
        }
      }
    }
    function metric(label, amount, note) {
      const box = document.createElement("div");
      box.className = "usage-metric";
      const title = document.createElement("span");
      title.textContent = label;
      const value = document.createElement("strong");
      value.textContent = amount;
      box.append(title, value);
      if (note) {
        const small = document.createElement("small");
        small.textContent = note;
        box.append(small);
      }
      return box;
    }
    async function loadUsage(details = false) {
      if (!host.authorized() || usageBusy) return;
      const ticket = ++usageTicket,
        database = usageDB;
      usageBusy = true;
      ue("database").disabled = true;
      ue("details").disabled = true;
      document.getElementById("reload-usage").disabled = true;
      const message = details ? ue("detail-message") : ue("message");
      message.textContent = "使用状況を確認しています…";
      try {
        const data = await edge({
          action: details ? "usage_details" : "usage",
          database,
        });
        if (ticket !== usageTicket || database !== usageDB) return;
        if (data.database_prefix !== (database === "main" ? "" : database))
          throw Error("登録先DBが一致しません。");
        if (details) {
          const stats = data.db_stats || {};
          ue("detail-metrics").replaceChildren(
            metric("コミット", format(stats.commits)),
            metric("ロールバック", format(stats.rollbacks)),
            metric("ディスク読み込み", format(stats.blocks_read)),
            metric("キャッシュ読み込み", format(stats.blocks_hit)),
            metric("デッドロック", format(stats.deadlocks)),
            metric("一時ファイル", bytes(stats.temp_bytes)),
          );
          message.textContent = "確認日時：" + date(data.measured_at);
          return;
        }
        ue("measured").textContent =
          `${data.label} · 確認日時：${date(data.measured_at)}`;
        const quota = data.quota || {};
        ue("metrics").replaceChildren(
          metric(
            "DB全体の容量",
            bytes(data.database_bytes),
            "カタログ・個人記録・索引等の合計",
          ),
          metric(
            "Storage保存容量",
            bytes(data.storage_bytes),
            "保存オブジェクトのサイズ合計",
          ),
          metric(
            "登録者数",
            format(quota.registered_users) + "人",
            "設定上限 " + format(quota.max_users) + "人",
          ),
          metric(
            "発行済みIDの予約",
            format(quota.reservations) + "件",
            "登録完了前の有効なID",
          ),
          metric(
            "所持記録",
            format(data.ownership_records) + "件",
            "カードの所持記録行数",
          ),
          metric(
            database === "main"
              ? "共通カードカタログ"
              : "同期したカードカタログ",
            format(data.cards) + "件",
          ),
          metric("DB接続", format(data.connections) + "件", "測定時点の接続数"),
        );
        const sync = data.catalog_sync;
        ue("sync").textContent =
          database === "main"
            ? "共通カタログの原本DBです。"
            : data.sync_running
              ? "共通カタログを同期しています。"
              : sync
                ? `共通カタログ：${sync.ready ? "有効" : "有効化前"} ／ 最終確認 ${date(sync.checked_at)}`
                : "カタログの同期状態を確認できません。";
        ue("tables").replaceChildren(
          ...(data.tables || []).map((t) => {
            const row = document.createElement("tr");
            for (const text of [
              t.schema + "." + t.name,
              bytes(t.bytes),
              format(t.estimated_rows),
            ]) {
              const cell = document.createElement("td");
              cell.textContent = text;
              row.append(cell);
            }
            return row;
          }),
        );
        if (/^[a-z0-9-]+$/.test(data.project_ref || ""))
          ue("dashboard").href =
            "https://supabase.com/dashboard/project/" +
            data.project_ref +
            "/settings/usage";
        message.textContent = "";
      } catch (error) {
        if (ticket === usageTicket) message.textContent = host.errorText(error);
      } finally {
        if (ticket === usageTicket) {
          usageBusy = false;
          ue("database").disabled = false;
          ue("details").disabled = false;
          document.getElementById("reload-usage").disabled = false;
        }
      }
    }
    window.CARD_ADMIN_SHARDS = Object.freeze({
      usersDatabase: () => usersDB,
      loadUsage: () => loadUsage(),
      async usersRPC(name, args) {
        const database = usersDB;
        try {
          const action =
            name === "card_admin_users_fast_v1"
              ? "users_v2"
              : name === "card_admin_primagi_user_counts"
                ? "primagi"
                : null;
          if (!action) throw Error("操作を確認してください。");
          const data = await edge({ action, database, args });
          if (data.database_prefix !== database)
            throw Error("登録先DBが一致しません。");
          if (action === "users_v2")
            for (const user of data.users || [])
              rows.set(database + ":" + user.id, user);
          return {
            data: action === "primagi" ? data.counts : data,
            error: null,
          };
        } catch (error) {
          return { data: null, error };
        }
      },
      async deleteUser(body) {
        if (
          body.database === "main" ||
          !databases.some((d) => d.key === body.database)
        )
          throw Error("削除先DBを確認してください。");
        const saved = rows.get(body.database + ":" + body.user_id);
        if (!saved || saved.album_id !== body.album_id)
          throw Error("削除対象の一覧を更新して確認してください。");
        const data = await edge({
          action: "delete",
          database: body.database,
          args: {
            user_id: body.user_id,
            album_id: body.album_id,
            confirmation: body.confirmation,
          },
        });
        if (data.database_prefix !== body.database || data.deleted !== true)
          throw Error("削除対象の状態を確認してください。");
        rows.delete(body.database + ":" + body.user_id);
        if (usersDB === body.database) await loadConfig();
        return { deleted: true };
      },
    });
    el("database").addEventListener("change", async () => {
      usersDB = el("database").value;
      config = null;
      const loading = host.reloadUsers();
      await loadConfig();
      await loading;
    });
    el("reload").onclick = () => loadConfig();
    el("form").onsubmit = (event) => {
      event.preventDefault();
      const maxUsers = Number(el("limit").value);
      if (
        !config ||
        !Number.isSafeInteger(maxUsers) ||
        maxUsers < 1 ||
        maxUsers > 2147483647
      )
        return;
      void loadConfig({
        maxUsers,
        enabled: el("enabled").checked,
        revision: config.revision,
      });
    };
    ue("database").onchange = () => {
      usageDB = ue("database").value;
      ue("metrics").replaceChildren();
      ue("tables").replaceChildren();
      ue("detail-metrics").replaceChildren();
      ue("measured").textContent = "";
      ue("sync").textContent = "";
      ue("detail-message").textContent = "";
      ue("dashboard").removeAttribute("href");
      void loadUsage();
    };
    ue("details").onclick = () => loadUsage(true);
    async function activate() {
      if (!host.authorized()) return;
      panel.hidden = false;
      try {
        await registry();
      } catch (error) {
        el("status").textContent = host.errorText(error);
      }
      await loadConfig();
      if (!usageSection.hidden) await loadUsage();
    }
    document.addEventListener("admin-page-changed", (event) => {
      if (
        ["users", "admin-users", "usage", "admin-usage"].includes(
          event.detail?.page,
        )
      )
        void activate();
    });
    document.addEventListener("admin-session-reset", () => {
      configTicket++;
      usageTicket++;
      configBusy = usageBusy = false;
      config = null;
      usersDB = usageDB = "main";
      rows.clear();
      panel.hidden = true;
      el("stats").replaceChildren();
      el("status").textContent = "";
      el("limit").value = "";
      el("enabled").checked = false;
      for (const name of ["metrics", "tables", "detail-metrics"])
        ue(name).replaceChildren();
      for (const name of ["message", "measured", "sync", "detail-message"])
        ue(name).textContent = "";
      el("database").value = ue("database").value = "main";
      ue("dashboard").removeAttribute("href");
      document.getElementById("reload-usage").disabled = false;
    });
    if (host.authorized()) void activate();
  }
  document.addEventListener("admin-host-ready", mount);
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
