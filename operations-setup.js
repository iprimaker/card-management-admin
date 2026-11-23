(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const message = text => { $("message").textContent = text; };
  if (!window.supabase?.createClient) {
    message("認証の読み込みに失敗しました。admin/vendor/supabase.jsの配置を確認してください。");
    return;
  }
  const db = window.supabase.createClient(
    "https://dwhlljqfredkiijrimwe.supabase.co",
    "sb_publishable_DI0p9r9UnHDZXryphpWCxg_ZhO8Bc8u",
    { auth: {
      storageKey: "card-album-admin-auth:dwhlljqfredkiijrimwe",
      persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
    } },
  );
  let busy = false, generation = 0, factorId = null, owner = null;
  function setBusy(value) {
    busy = value;
    document.querySelectorAll("button,input,select").forEach(node => { node.disabled = value; });
  }
  function clearSecret() {
    $("mfa-qr").removeAttribute("src");
    $("mfa-secret").value = "";
    $("enrollment").hidden = true;
    $("code").value = "";
  }
  function clearPanels() {
    owner = factorId = null;
    clearSecret();
    $("report").value = "";
    $("mfa-panel").hidden = $("result-panel").hidden = $("logout").hidden = true;
    $("login-panel").hidden = false;
  }
  async function ready(current) {
    const result = await db.rpc("card_ops_admin_runtime_status_v147");
    if (result.error) throw result.error;
    if (current !== generation) return;
    if (result.data?.administrator_verified !== true) throw Error("管理者確認に失敗しました。");
    clearSecret();
    $("mfa-panel").hidden = true;
    $("result-panel").hidden = false;
    $("report").value = JSON.stringify(result.data, null, 2);
    message("新しい運営用DBへの管理者接続を確認できました。");
  }
  async function inspect(session, current) {
    if (!session || current !== generation) return;
    $("logout").hidden = false;
    const identity = await db.rpc("card_admin_mfa_identity");
    if (identity.error) throw identity.error;
    if (identity.data !== true) throw Error("この新DBアカウントには管理者権限がありません。02の権限付与SQLを確認してください。");
    if (current !== generation) return;
    owner = session.user.id;
    $("login-panel").hidden = true;
    $("logout").hidden = false;
    const assurance = await db.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error) throw assurance.error;
    if (current !== generation) return;
    if (assurance.data.currentLevel === "aal2") return ready(current);
    const factors = await db.auth.mfa.listFactors();
    if (factors.error) throw factors.error;
    if (current !== generation) return;
    const verified = (factors.data.totp || []).filter(f => f.status === "verified");
    $("factor").replaceChildren();
    for (const factor of verified) {
      const option = document.createElement("option");
      option.value = factor.id;
      option.textContent = factor.friendly_name || "認証アプリ";
      $("factor").append(option);
    }
    factorId = verified[0]?.id || null;
    $("factor-label").hidden = verified.length < 2;
    $("mfa-help").textContent = verified.length
      ? "新DBに登録済みの認証アプリで、表示される6桁コードを入力してください。"
      : "新DB用に認証アプリを登録します。この画面で作った未完了の登録があれば作り直します。";
    $("enroll").hidden = verified.length > 0;
    $("mfa-form").hidden = verified.length === 0;
    $("mfa-panel").hidden = false;
    message("二段階認証を完了してください。");
  }
  $("factor").addEventListener("change", () => { factorId = $("factor").value; });
  $("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    const email = $("email").value.trim(), password = $("password").value;
    const current = ++generation;
    setBusy(true); message("ログインを確認中…");
    try {
      const result = await db.auth.signInWithPassword({ email, password });
      $("password").value = "";
      if (result.error) throw Error("ログインできませんでした。新DBに作成したアカウント・メール確認・パスワードを確認してください。");
      await inspect(result.data.session, current);
    } catch (error) { if (current === generation) message(error.message || "確認できませんでした。"); }
    finally { if (current === generation) setBusy(false); }
  });
  $("enroll").addEventListener("click", async () => {
    if (busy || !owner) return;
    const current = generation;
    setBusy(true); message("認証アプリの登録を準備中…");
    try {
      const factors = await db.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      for (const f of factors.data.all || []) {
        if (f.status === "unverified" && f.factor_type === "totp" && f.friendly_name === "カードアルバム運営DB") {
          const removed = await db.auth.mfa.unenroll({ factorId: f.id });
          if (removed.error) throw removed.error;
        }
      }
      const result = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: "カードアルバム運営DB", issuer: "カードアルバム" });
      if (result.error) throw result.error;
      if (current !== generation) return;
      factorId = result.data.id;
      const qr = result.data.totp?.qr_code;
      if (typeof qr !== "string" || !result.data.totp?.secret) throw Error("認証アプリの登録情報を取得できませんでした。");
      $("mfa-qr").src = qr.startsWith("data:image/svg+xml") ? qr : "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qr);
      $("mfa-secret").value = result.data.totp.secret;
      $("enrollment").hidden = $("mfa-form").hidden = false;
      $("enroll").hidden = true;
      message("ご自身の認証アプリでQRコードを読み取り、6桁コードを入力してください。");
    } catch { if (current === generation) message("登録を準備できませんでした。新DBのTOTP設定と接続を確認してください。"); }
    finally { if (current === generation) setBusy(false); }
  });
  $("mfa-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !owner || !factorId) return;
    const code = $("code").value.normalize("NFKC").trim();
    if (!/^\d{6}$/.test(code)) return message("6桁コードを入力してください。");
    const current = generation;
    setBusy(true); message("二段階認証を確認中…");
    try {
      const challenge = await db.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;
      const result = await db.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
      $("code").value = "";
      if (result.error) throw result.error;
      await ready(current);
    } catch { if (current === generation) message("確認できませんでした。認証アプリの新しいコードをお試しください。続く場合はログインし直してください。"); }
    finally { if (current === generation) setBusy(false); }
  });
  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("report").value); message("確認結果をコピーしました。"); }
    catch { $("report").select(); message("確認結果を選択しました。端末のコピー操作を使用してください。"); }
  });
  $("logout").addEventListener("click", async () => {
    if (busy) return;
    ++generation; clearPanels(); setBusy(true);
    try { const result = await db.auth.signOut({ scope: "local" }); if (result.error) throw result.error; message("ログアウトしました。"); }
    catch { message("ログアウトの完了を確認できませんでした。接続を確認し、再度ログアウトしてください。"); $("logout").hidden = false; }
    finally { setBusy(false); }
  });
  db.auth.onAuthStateChange(event => {
    if (event === "SIGNED_OUT") {
      ++generation;
      clearPanels();
      setBusy(false);
      message("ログアウトしました。必要に応じてログインしてください。");
    }
  });
  (async () => {
    const current = ++generation;
    setBusy(true);
    try {
      const result = await db.auth.getSession();
      if (result.error) throw result.error;
      if (result.data.session) await inspect(result.data.session, current);
    } catch { message("接続を確認できませんでした。新DBの設定・管理者権限を確認してログインし直してください。"); }
    finally { if (current === generation) setBusy(false); }
  })();
})();
