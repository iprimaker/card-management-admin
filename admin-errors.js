window.ADMIN_WORKFLOW.mount((host) => {
  "use strict";
  const root = document.getElementById("admin-errors");
  root.innerHTML = `<div class="section-heading"><div><h1>エラー記録</h1><p class="muted">全登録者DBの記録を運営DBで管理します。保存期限は最大7日です。</p></div><button type="button" data-refresh>更新</button></div>
 <form class="error-search"><label>エラーコード・確認コード・アルバムID<input name="query" maxlength="100" placeholder="E-… またはアルバムID" autocomplete="off"></label><label>登録者DB<select name="database"><option value="all">すべて</option><option value="operations">運営管理</option></select></label><button type="submit" class="primary">検索</button></form>
 <p role="status" data-status></p><p class="muted">ブラウザからの報告は、原因を確定した記録ではありません。認証ログなどと照合してください。本人IDはサーバーで認証できた場合だけ表示します。</p>
 <div data-records></div><div class="pagination"><button type="button" data-prev>前へ</button><span data-page></span><button type="button" data-next>次へ</button></div>
 <details class="error-dictionary"><summary>エラー分類と対処方法の一覧（管理者専用）</summary><div data-dictionary></div></details>`;
  const $ = (s) => root.querySelector(s),
    form = $("form");
  let offset = 0,
    epoch = 0,
    busy = false,
    query = "",
    database = "all";
  const text = (tag, value) => {
    const el = document.createElement(tag);
    el.textContent = value == null ? "—" : String(value);
    return el;
  };
  function line(list, label, value) {
    list.append(text("dt", label), text("dd", value));
  }
  async function load() {
    if (!host.authorized() || busy) return;
    busy = true;
    const ticket = ++epoch,
      current = window.ADMIN_WORKFLOW.checkpoint(host);
    root
      .querySelectorAll("button,input,select")
      .forEach((c) => (c.disabled = true));
    $("[data-status]").textContent = "エラー記録を取得中…";
    try {
      const r = await host
        .client()
        .rpc("card_admin_error_records_v180", {
          p_query: query,
          p_database: database,
          p_offset: offset,
        });
      if (!current() || ticket !== epoch) return;
      if (r.error) throw r.error;
      if (!Array.isArray(r.data?.records) || !Array.isArray(r.data.dictionary))
        throw Error("応答形式を確認できません。");
      $("[data-records]").replaceChildren();
      for (const row of r.data.records) {
        const details = document.createElement("details");
        details.className = "error-record";
        const summary = document.createElement("summary");
        summary.append(
          text("strong", row.title),
          text(
            "span",
            row.album_id ||
              (row.identity_status === "unverified"
                ? "本人確認未完了"
                : "ログイン前・IDなし"),
          ),
          text("time", host.timestamp(row.created_at)),
        );
        const list = document.createElement("dl");
        for (const [label, value] of [
          ["確認コード", row.receipt],
          ["分類コード", row.cause_code],
          ["内容", row.detail],
          ["対処", row.remedy],
          ["本人の登録先DB", row.identity_database],
          ["失敗した接続先", row.target_database],
          ["アルバムID", row.album_id],
          ["本人確認", row.identity_status],
          ["操作", row.operation],
          ["処理段階", row.stage],
          ["HTTP状態", row.http_status || "応答なし・端末内"],
          ["元のコード", row.upstream_code],
          ["例外の種類", row.exception_name],
          ["アプリ版", row.app_version],
          ["記録期限", host.timestamp(row.expires_at)],
        ])
          line(list, label, value);
        const copy = document.createElement("button");
        copy.type = "button";
        copy.textContent = "確認コードをコピー";
        copy.onclick = () =>
          navigator.clipboard.writeText(row.receipt).catch(() => {
            $("[data-status]").textContent =
              "コピーできませんでした。コードを選択してコピーしてください。";
          });
        details.append(summary, list, copy);
        $("[data-records]").append(details);
      }
      $("[data-dictionary]").replaceChildren();
      for (const item of r.data.dictionary) {
        const d = document.createElement("details"),
          s = text("summary", item.code + " · " + item.title);
        d.append(s, text("p", item.detail), text("p", "対処：" + item.remedy));
        $("[data-dictionary]").append(d);
      }
      $("[data-page]").textContent =
        `${Math.floor(offset / 50) + 1}ページ ／ ${r.data.total}件`;
      $("[data-status]").textContent = r.data.records.length
        ? ""
        : "該当する記録はありません。";
      $("[data-prev]").dataset.disabled = offset === 0 ? "true" : "false";
      $("[data-next]").dataset.disabled =
        offset + 50 >= r.data.total ? "true" : "false";
    } catch (e) {
      if (current()) $("[data-status]").textContent = host.errorText(e);
    } finally {
      if (current() && ticket === epoch) {
        busy = false;
        root
          .querySelectorAll("button,input,select")
          .forEach((c) => (c.disabled = c.dataset.disabled === "true"));
      }
    }
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    query = form.elements.query.value.trim();
    database = form.elements.database.value;
    offset = 0;
    load();
  };
  $("[data-refresh]").onclick = () => load();
  $("[data-prev]").onclick = () => {
    offset = Math.max(0, offset - 50);
    load();
  };
  $("[data-next]").onclick = () => {
    offset += 50;
    load();
  };
  document.addEventListener("admin-page-changed", async (e) => {
    if (e.detail.page !== "errors") return;
    try {
      const entries = await window.CARD_OPS_ADMIN.registry();
      if (!host.authorized()) return;
      const select = form.elements.database;
      for (const row of entries)
        if (![...select.options].some((o) => o.value === row.key)) {
          const option = text("option", row.label);
          option.value = row.key;
          select.append(option);
        }
    } catch {}
    load();
  });
  document.addEventListener("admin-session-reset", () => {
    epoch++;
    busy = false;
    offset = 0;
    query = "";
    database = "all";
    form.reset();
    $("[data-records]").replaceChildren();
    $("[data-dictionary]").replaceChildren();
    $("[data-status]").textContent = "";
    $("[data-page]").textContent = "";
  });
});
