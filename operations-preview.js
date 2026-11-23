(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const url = "https://dwhlljqfredkiijrimwe.supabase.co";
  const publicKey = "sb_publishable_DI0p9r9UnHDZXryphpWCxg_ZhO8Bc8u";
  if (!window.supabase?.createClient) {
    $("message").textContent = "認証を読み込めません。vendor/supabase.jsの配置を確認してください。";
    $("connect").disabled = true;
    return;
  }
  const db = window.supabase.createClient(url, publicKey, {
    auth: {
      storageKey: "card-album-admin-auth:dwhlljqfredkiijrimwe",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  let databases = [];
  let view = "users";
  let offset = 0;
  const limit = 50;
  let total = 0;
  let generation = 0;
  let controller = null;
  const reports = new Map();

  function clearDisplay() {
    $("users").replaceChildren();
    $("metrics").replaceChildren();
    $("total").textContent = "";
    $("page").textContent = "";
    $("previous").disabled = true;
    $("next").disabled = true;
    total = 0;
  }

  function busy(value) {
    for (const id of ["connect", "apply", "refresh-usage"]) {
      $(id).disabled = value;
    }
    $("content").setAttribute("aria-busy", String(value));
    $("previous").disabled = value || offset === 0;
    $("next").disabled = value || offset + limit >= total;
  }

  function begin() {
    controller?.abort();
    controller = new AbortController();
    const current = ++generation;
    busy(true);
    return { current, signal: controller.signal };
  }

  async function api(body, signal) {
    const auth = await db.auth.getSession();
    if (auth.error) throw Error("管理者の認証を確認できません。再ログインしてください。");
    if (!auth.data.session) throw Error("運営用DBの管理者でログイン・二段階認証を完了してください。");
    const response = await fetch(url + "/functions/v1/admin-databases", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publicKey,
        Authorization: "Bearer " + auth.data.session.access_token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.success !== true) {
      const error = Error(result?.message || "管理APIに接続できません。v149の配置・管理者認証を確認してください。");
      error.code = result?.error_code || "CONNECTION_FAILED";
      throw error;
    }
    return result;
  }

  function writeReport() {
    $("report").value = JSON.stringify({
      version: "v149",
      read_only: true,
      databases: [...reports.values()],
    }, null, 2);
    $("report-panel").hidden = reports.size === 0;
  }

  function date(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime())
      ? parsed.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false })
      : "—";
  }

  function count(value) {
    return Number(value || 0).toLocaleString("ja-JP");
  }

  function paintUsers(data) {
    total = Number(data.total) || 0;
    $("users").replaceChildren();
    for (const user of data.users) {
      const tr = document.createElement("tr");
      const values = [
        ({ online: "利用中", offline: "ログアウト済", unknown: "未確認" })[user.presence_status] || "未確認",
        user.nickname || "未設定",
        date(user.created_at),
        date(user.last_sign_in_at),
        user.inactive_days == null ? "—" : count(user.inactive_days) + "日",
        "カード " + count(Number(user.aikatsu_count || 0) + Number(user.onegai_count || 0)
          + Number(user.himitsu_count || 0) + Number(user.other_count || 0)) + "枚",
      ];
      values.forEach((text, index) => {
        const td = document.createElement("td");
        td.textContent = text;
        if (index === 1 || index === 5) {
          const small = document.createElement("small");
          small.textContent = index === 1
            ? user.album_id || "未発行"
            : "バース " + count(Number(user.verse_onegai_coordinates || 0) + Number(user.verse_himitsu_coordinates || 0))
              + "コーデ ／ プリマジ " + count(user.primagi_coordinates) + "コーデ";
          td.append(small);
        }
        tr.append(td);
      });
      $("users").append(tr);
    }
    if (data.users.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.textContent = total ? "このページに登録者はいません。前のページを確認してください。" : "該当する登録者はいません。";
      tr.append(td);
      $("users").append(tr);
    }
    $("total").textContent = "該当 " + count(total) + "人 · 確認日時 " + date(data.checked_at);
    $("page").textContent = (Math.floor(offset / limit) + 1) + " / " + Math.max(1, Math.ceil(total / limit));
  }

  function bytes(value) {
    if (value == null) return "未取得";
    return (Number(value) / 1024 / 1024).toLocaleString("ja-JP", { maximumFractionDigits: 1 }) + " MiB";
  }

  function paintUsage(data) {
    const metrics = [
      ["登録者", count(data.accounts) + "人"],
      ["DB使用量", bytes(data.database_bytes)],
      ["画像などのストレージ", bytes(data.storage_bytes)],
      ["DB接続数", count(data.connections)],
      ["所持記録", count(data.ownership_records) + "件"],
      ["カードカタログ", count(data.cards) + "件"],
    ];
    for (const [label, value] of metrics) {
      const box = document.createElement("div");
      box.className = "metric";
      const title = document.createElement("span");
      const number = document.createElement("strong");
      title.textContent = label;
      number.textContent = value;
      box.append(title, number);
      $("metrics").append(box);
    }
  }

  async function load() {
    const key = $("database").value;
    if (!databases.some((entry) => entry.key === key)) return;
    const requestedView = view;
    const { current, signal } = begin();
    clearDisplay();
    $("message").textContent = "選択したDBの" + (view === "users" ? "登録者を" : "使用状況を") + "読み込み中…";
    try {
      const result = await api({
        action: "preview", database: key, view: requestedView,
        args: requestedView === "users"
          ? { offset, limit, query: $("query").value.trim(), sort: $("sort").value }
          : {},
      }, signal);
      if (current !== generation) return;
      if (result.database?.key !== key || result.read_only !== true || result.version !== "v149"
        || result.view !== requestedView || (requestedView === "users" && !Array.isArray(result.data?.users))) {
        throw Error("応答先DB・データの形式を確認できません。v149のEdge Functionを確認してください。");
      }
      if (requestedView === "users") paintUsers(result.data);
      else paintUsage(result.data);
      const report = reports.get(key) || { key, prefix: result.database.prefix };
      report.user_admin_gateway_enabled = result.user_admin_gateway_enabled === true;
      report[requestedView] = {
        displayed: true,
        ...(requestedView === "users"
          ? { matched_users: result.data.total, displayed_rows: result.data.users.length }
          : { accounts: result.data.accounts }),
        checked_at: result.data.checked_at || result.data.measured_at || null,
      };
      reports.set(key, report);
      writeReport();
      $("message").textContent = result.database.label + "の表示を確認しました。";
    } catch (error) {
      if (current !== generation) return;
      clearDisplay();
      $("message").textContent = error?.name === "TimeoutError"
        ? "読み込みがタイムアウトしました。再度お試しください。"
        : error?.message || "読み込みに失敗しました。";
    } finally {
      if (current === generation) busy(false);
    }
  }

  $("connect").addEventListener("click", async () => {
    const { current, signal } = begin();
    databases = [];
    reports.clear();
    writeReport();
    clearDisplay();
    $("content").hidden = true;
    $("database").disabled = true;
    $("database").replaceChildren();
    $("message").textContent = "接続先を取得中…";
    try {
      const result = await api({ action: "list" }, signal);
      if (current !== generation) return;
      if (result.version !== "v149" || !Array.isArray(result.databases) || !result.databases.length) {
        throw Error("新DBのadmin-databasesをv149に更新してください。");
      }
      databases = result.databases;
      for (const entry of databases) {
        const option = document.createElement("option");
        option.value = entry.key;
        option.textContent = entry.label;
        $("database").append(option);
      }
      $("database").disabled = false;
      $("content").hidden = false;
      offset = 0;
      await load();
    } catch (error) {
      if (current === generation) $("message").textContent = error?.message || "接続先を取得できませんでした。";
    } finally {
      if (current === generation) busy(false);
    }
  });

  $("database").addEventListener("change", () => {
    offset = 0;
    load();
  });
  $("filters").addEventListener("submit", (event) => {
    event.preventDefault();
    offset = 0;
    load();
  });
  $("previous").addEventListener("click", () => {
    offset = Math.max(0, offset - limit);
    load();
  });
  $("next").addEventListener("click", () => {
    offset += limit;
    load();
  });
  $("refresh-usage").addEventListener("click", load);
  for (const name of ["users", "usage"]) {
    $(name + "-tab").addEventListener("click", () => {
      view = name;
      for (const tab of ["users", "usage"]) {
        $(tab + "-tab").setAttribute("aria-pressed", String(tab === view));
        $(tab + "-tab").classList.toggle("secondary", tab !== view);
        $(tab + "-panel").hidden = tab !== view;
      }
      load();
    });
  }
  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("report").value);
      $("message").textContent = "確認結果をコピーしました。";
    } catch {
      $("report").select();
      $("message").textContent = "確認結果を選択しました。端末のコピー操作を使用してください。";
    }
  });
  db.auth.onAuthStateChange((event) => {
    if (event !== "SIGNED_OUT") return;
    ++generation;
    controller?.abort();
    databases = [];
    reports.clear();
    writeReport();
    clearDisplay();
    $("database").replaceChildren();
    $("database").disabled = true;
    $("content").hidden = true;
    busy(false);
    $("message").textContent = "ログアウトしました。管理者のログイン・二段階認証を完了してください。";
  });
})();
