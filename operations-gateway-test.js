(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const url = "https://dwhlljqfredkiijrimwe.supabase.co";
  const publicKey = "sb_publishable_DI0p9r9UnHDZXryphpWCxg_ZhO8Bc8u";
  if (!window.supabase?.createClient) {
    $("message").textContent = "認証の読み込みに失敗しました。vendor/supabase.jsの配置を確認してください。";
    $("check").disabled = true;
    return;
  }
  const db = window.supabase.createClient(url, publicKey, {
    auth: { storageKey: "card-album-admin-auth:dwhlljqfredkiijrimwe", persistSession: true,
      autoRefreshToken: true, detectSessionInUrl: false },
  });
  let busy = false, generation = 0;
  $("check").addEventListener("click", async () => {
    if (busy) return;
    const current = ++generation;
    busy = true; $("check").disabled = true;
    $("result-panel").hidden = true; $("report").value = "";
    $("message").textContent = "登録者DBへの管理接続を確認中…";
    try {
      const session = await db.auth.getSession();
      if (session.error) throw session.error;
      if (!session.data.session) throw Error("新DBの管理者でログイン・二段階認証を完了してください。");
      const response = await fetch(url + "/functions/v1/admin-databases", {
        method: "POST", headers: { "Content-Type": "application/json", apikey: publicKey,
          Authorization: "Bearer " + session.data.session.access_token },
        body: JSON.stringify({ action: "probe" }), signal: AbortSignal.timeout(90000),
      });
      const result = await response.json().catch(() => null);
      if (current !== generation) return;
      if (!result || typeof result !== "object") throw Error("管理APIの応答を確認できません。関数の配置を確認してください。");
      $("report").value = JSON.stringify(result, null, 2);
      $("result-panel").hidden = false;
      $("message").textContent = result.success === true
        ? "管理接続を確認できました。確認結果をコピーして送ってください。"
        : "確認を完了できませんでした。表示された確認結果を送ってください。";
    } catch (error) {
      if (current !== generation) return;
      $("message").textContent = error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "接続確認がタイムアウトしました。少し待って再度お試しください。"
        : error?.message || "接続を確認できませんでした。";
    } finally { if (current === generation) { busy = false; $("check").disabled = false; } }
  });
  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("report").value); $("message").textContent = "確認結果をコピーしました。"; }
    catch { $("report").select(); $("message").textContent = "確認結果を選択しました。端末のコピー操作を使用してください。"; }
  });
  db.auth.onAuthStateChange(event => {
    if (event === "SIGNED_OUT") {
      ++generation; busy = false; $("check").disabled = false;
      $("report").value = ""; $("result-panel").hidden = true;
      $("message").textContent = "ログアウトしました。管理者の認証を確認してください。";
    }
  });
})();
