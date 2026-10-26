(() => {
  const host = window.CARD_VISIBILITY_ADMIN_HOST,
    root = document.getElementById("admin-operations");
  if (!host || !root) return;
  const panel = document.createElement("section");
  panel.className = "usage-panel";
  panel.innerHTML =
    '<h2>QRコードの登録上限</h2><p>利用者1人あたりの合計です。カード・フルコーデ・パーツ・セーブコードのQRをそれぞれ1件と数えます。</p><form><label><input type="checkbox" name="unlimited"> 上限なし</label><label>登録上限数<input name="limit" type="number" min="0" max="100000" value="100" required></label><p>0は新規登録を停止します。上限を下げても登録済みのQRは削除されません。</p><button type="submit">上限を保存</button><p role="status"></p></form>';
  root.append(panel);
  const f = panel.querySelector("form"),
    msg = f.querySelector("[role=status]");
  f.unlimited.onchange = () => (f.limit.disabled = f.unlimited.checked);
  let who = null;
  async function load() {
    if (!host.authorized()) {
      who = null;
      return;
    }
    if (who === host.user()) return;
    const r = await host.client().rpc("card_qr_status");
    if (r.error) {
      msg.textContent =
        "QR設定を取得できませんでした。SQLの反映を確認してください。";
      return;
    }
    who = host.user();
    f.unlimited.checked = r.data.limit === null;
    f.limit.disabled = f.unlimited.checked;
    f.limit.value = r.data.limit ?? 100;
  }
  setInterval(() => load().catch(() => {}), 1500);
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!host.authorized()) return;
    const button = f.querySelector("button");
    button.disabled = true;
    try {
      const r = await host
        .client()
        .rpc("card_qr_admin_limit", {
          p_limit: f.unlimited.checked ? null : Number(f.limit.value),
        });
      if (r.error) throw r.error;
      msg.textContent = "登録上限を保存しました。";
    } catch {
      msg.textContent =
        "保存できませんでした。管理者認証と通信状態をご確認ください。";
    } finally {
      button.disabled = false;
    }
  };
})();
