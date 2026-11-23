(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const url = "https://dwhlljqfredkiijrimwe.supabase.co";
  const key = "sb_publishable_DI0p9r9UnHDZXryphpWCxg_ZhO8Bc8u";
  if (!window.supabase?.createClient) {
    $("message").textContent = "認証を読み込めません。vendor/supabase.jsの配置を確認してください。";
    $("apply").disabled = true;
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
  $("apply").onclick = async () => {
    if (busy) return;
    const ticket = ++epoch;
    busy = true;
    $("apply").disabled = true;
    $("result-panel").hidden = true;
    $("report").value = "";
    $("message").textContent = "元DBの取得・運営用DBへの反映・内容の照合を行っています…";
    try {
      const session = await db.auth.getSession();
      if (session.error || !session.data?.session) {
        throw Error("運営用DBの管理者でログイン・二段階認証を完了してください。");
      }
      const response = await fetch(url + "/functions/v1/admin-databases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: "Bearer " + session.data.session.access_token,
        },
        body: JSON.stringify({ action: "common_delta" }),
        signal: AbortSignal.timeout(90000),
        cache: "no-store",
      });
      const result = await response.json().catch(() => null);
      if (ticket !== epoch) return;
      if (!result || typeof result !== "object") throw Error("管理APIの応答を確認できません。");
      $("report").value = JSON.stringify(result, null, 2);
      $("result-panel").hidden = false;
      if (!response.ok || result.success !== true || result.version !== "v153" || result.applied !== true) {
        $("message").textContent = "反映を完了できませんでした。下の確認結果をコピーして送ってください。";
      } else if (!result.verification_complete || !result.source_still_current) {
        $("message").textContent = "反映は完了しましたが、元DBの再確認が必要です。確認結果を送ってください。";
      } else {
        $("message").textContent = result.unchanged
          ? "2テーブルはすでに一致しています。確認結果をコピーして送ってください。"
          : "2テーブルの反映と照合が完了しました。確認結果をコピーして送ってください。";
      }
    } catch (error) {
      if (ticket !== epoch) return;
      $("message").textContent = error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "通信を完了できませんでした。反映済みの場合もあります。同じボタンで再確認できます。"
        : error?.message || "反映を確認できませんでした。";
    } finally {
      if (ticket === epoch) {
        busy = false;
        $("apply").disabled = false;
      }
    }
  };
  $("copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("report").value);
      $("message").textContent = "確認結果をコピーしました。";
    } catch {
      $("report").select();
      $("message").textContent = "結果を選択しました。端末のコピー操作を使用してください。";
    }
  };
  db.auth.onAuthStateChange((event) => {
    if (event !== "SIGNED_OUT") return;
    ++epoch;
    busy = false;
    $("apply").disabled = false;
    $("report").value = "";
    $("result-panel").hidden = true;
    $("message").textContent = "ログアウトしました。送信済みの反映処理は完了している場合があります。再ログイン後に確認してください。";
  });
})();
