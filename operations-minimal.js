(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const url = "https://dwhlljqfredkiijrimwe.supabase.co";
  const key = "sb_publishable_DI0p9r9UnHDZXryphpWCxg_ZhO8Bc8u";
  if (!window.supabase?.createClient) {
    $("message").textContent = "認証を読み込めません。vendor/supabase.jsの配置を確認してください。";
    $("reload").disabled = true;
    return;
  }
  const db = window.supabase.createClient(url, key, {
    auth: {
      storageKey: "card-album-admin-auth:dwhlljqfredkiijrimwe",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  let busy = false;
  let epoch = 0;
  function updateButtons() {
    $("reload").disabled = busy;
    $("database").disabled = busy || !$("database").options.length;
    $("apply").disabled = busy || !$("database").value;
    $("all").disabled = busy || !$("database").options.length;
  }
  async function call(body) {
    const session = await db.auth.getSession();
    if (session.error || !session.data?.session) {
      throw Error("運営用DBの管理者でログイン・二段階認証を完了してください。");
    }
    const response = await fetch(url + "/functions/v1/sync-minimal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: "Bearer " + session.data.session.access_token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(110000),
      cache: "no-store",
    });
    const result = await response.json().catch(() => null);
    if (!result || result.version !== "v160") throw Error("最小同期APIの応答を確認できません。");
    return { response, result };
  }
  async function run(action) {
    if (busy) return;
    const ticket = ++epoch;
    const database = $("database").value;
    busy = true;
    updateButtons();
    $("result-panel").hidden = true;
    $("report").value = "";
    $("message").textContent = action === "list"
      ? "接続先を確認しています…" : action === "sync_all" ? "全DBの同期状態を確認しています…" : "選択したDBの同期状態を確認しています…";
    try {
      const { response, result } = await call(action === "sync" ? { action, database } : { action });
      if (ticket !== epoch) return;
      if (action === "list" && response.ok && result.success && Array.isArray(result.databases)) {
        $("database").replaceChildren();
        for (const row of result.databases) {
          const option = document.createElement("option");
          option.value = row.key;
          option.textContent = row.label;
          $("database").append(option);
        }
        if (result.databases.some((row) => row.key === database)) $("database").value = database;
        $("message").textContent = "全DBの同期状態を確認できます。変更がある場合だけ最小データを送信します。";
      } else {
        $("report").value = JSON.stringify(result, null, 2);
        $("result-panel").hidden = false;
        $("message").textContent = result.success === true
          ? "同期状態の確認が完了しました。結果をコピーして送ってください。"
          : "確認が必要です。下の結果をコピーして送ってください。";
      }
    } catch (error) {
      if (ticket !== epoch) return;
      $("message").textContent = ["TimeoutError", "AbortError"].includes(error?.name)
        ? "通信が中断されました。コピー済みの場合もあります。同じDBを再実行して確認できます。"
        : error?.message || "照合を確認できませんでした。";
    } finally {
      if (ticket === epoch) {
        busy = false;
        updateButtons();
      }
    }
  }
  $("reload").onclick = () => run("list");
  $("apply").onclick = () => run("sync");
  $("all").onclick = () => run("sync_all");
  $("copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("report").value);
      $("message").textContent = "結果をコピーしました。";
    } catch {
      $("report").select();
      $("message").textContent = "結果を選択しました。端末のコピー操作を使用してください。";
    }
  };
  db.auth.onAuthStateChange((event) => {
    if (event !== "SIGNED_OUT") return;
    ++epoch;
    busy = false;
    $("database").replaceChildren();
    $("result-panel").hidden = true;
    $("report").value = "";
    updateButtons();
    $("message").textContent = "ログアウトしました。送信済みのコピーは完了している場合があります。再ログイン後に確認してください。";
  });
  run("list");
})();
