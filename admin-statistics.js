window.ADMIN_WORKFLOW.mount((host) => {
  "use strict";
  const root = document.getElementById("admin-statistics");
  root.innerHTML = `
    <div class="section-heading"><div><h1>統計</h1><p>アルバム全体の広がりと、集めた記録をひと目で。</p></div><button type="button" class="primary" data-refresh>更新する</button></div>
    <p class="muted">登録者の数値は元・Aなど全登録者DBの合計です。カード・コーデの種類数は運営DBを1回だけ集計します。</p>
    <p data-status role="status" aria-live="polite"></p>
    <div data-content hidden>
      <div class="stats-hero-grid" data-heroes></div>
      <div class="stats-grid">
        <article class="stats-panel"><h2>集めた記録</h2><p class="stats-help">カード枚数は通常カードとアイカツALLの所持数の合計です。</p><dl class="stats-detail-grid" data-records></dl></article>
        <article class="stats-panel"><h2>最近の登録とログイン</h2><dl class="stats-detail-grid" data-recent></dl><p class="stats-help">登録者数はアカウント数です。同じ方が複数DBに登録した場合も別々に数えます。</p></article>
        <article class="stats-panel stats-wide"><h2>日別の新規登録</h2><p class="stats-help">直近30日・日本時間の日付で集計しています。</p><div class="stats-chart" data-chart></div></article>
        <article class="stats-panel"><h2>作品別のカード</h2><dl class="stats-breakdown" data-families></dl></article>
        <article class="stats-panel"><h2>コーデとパーツ構成</h2><dl class="stats-breakdown" data-coordinates></dl><h3>構成パーツ数ごとのコーデ数</h3><dl class="stats-breakdown" data-part-sizes></dl></article>
        <article class="stats-panel"><h2>レアリティの内訳</h2><p class="stats-help">アイカツALLを除く通常のカードカタログが対象です。</p><dl class="stats-breakdown" data-rarities></dl></article>
        <article class="stats-panel"><h2>画像と登録データ</h2><dl class="stats-detail-grid" data-catalog></dl><p class="stats-help">画像登録率は表面URLの登録状況です。画像の取得成功率ではありません。</p></article>
        <article class="stats-panel stats-wide"><h2>登録者DBごとの記録</h2><div class="stats-table-wrap"><table><thead><tr><th>登録者DB</th><th>アカウント</th><th>カード枚数</th><th>パーツ枚数</th><th>フルコーデ登録数</th><th>30日以内のログイン</th></tr></thead><tbody data-databases></tbody></table></div></article>
      </div>
      <p class="stats-footnote" data-timestamp></p>
      <p class="stats-footnote">フルコーデ登録数は一式で記録された所持数です。パーツをそろえた分は加算していません。DBごとの取得時刻には差があります。</p>
    </div>`;
  const $ = selector => root.querySelector(selector);
  const fields = ["registered_accounts", "new_7d", "new_30d", "login_30d", "owned_card_copies",
    "owned_part_copies", "owned_coordinate_copies", "favorites", "qr_records", "trade_offers", "trade_wants"];
  const format = new Intl.NumberFormat("ja-JP");
  const labels = {
    aikatsu: "アイカツ！アンコール", onegai: "おねがいアイプリ", himitsu: "ひみつのアイプリ", other: "その他",
    "all-cardlist": "アイカツ！", "all-stars": "アイカツスターズ！", "all-friends": "アイカツフレンズ！",
    "all-onparade": "アイカツオンパレード！", "all-planet": "アイカツプラネット！", "all-academy": "アイカツアカデミー！",
    primagi: "ワッチャプリマジ！",
  };
  let busy = false, epoch = 0, cache = null, cachedAt = 0;
  const number = value => value === null || value === undefined || value === ""
    ? null : Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const count = value => number(value) === null ? "—" : format.format(Number(value));
  function item(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function details(target, rows) {
    target.replaceChildren();
    for (const [label, value] of rows) {
      const box = item("div");
      box.append(item("dt", null, label), item("dd", null, value));
      target.append(box);
    }
  }
  function chart(data, complete) {
    const target = $("[data-chart]");
    target.replaceChildren();
    if (!complete) { target.append(item("p", "muted", "全DBの取得が完了すると表示します。")); return; }
    const totals = new Map();
    for (const db of data.databases) {
      for (const row of db.data.daily_registrations || []) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(row.day) && number(row.n) !== null) {
          totals.set(row.day, (totals.get(row.day) || 0) + Number(row.n));
        }
      }
    }
    const end = new Date(Date.parse(data.checked_at) + 9 * 3600000).toISOString().slice(0, 10);
    const days = Array.from({ length: 30 }, (_, i) => {
      const day = new Date(Date.parse(end + "T00:00:00Z") - (29 - i) * 86400000).toISOString().slice(0, 10);
      return { day, n: totals.get(day) || 0 };
    });
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 720 180");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "直近30日の日別登録数。最大は" + count(Math.max(...days.map(d => d.n))) + "件");
    const max = Math.max(1, ...days.map(d => d.n));
    days.forEach((day, i) => {
      const rect = document.createElementNS(ns, "rect");
      const height = Math.max(2, day.n / max * 132);
      rect.setAttribute("x", String(12 + i * 23.3)); rect.setAttribute("y", String(145 - height));
      rect.setAttribute("width", "15"); rect.setAttribute("height", String(height)); rect.setAttribute("rx", "4");
      rect.setAttribute("class", day.n ? "stats-bar" : "stats-bar-empty");
      const title = document.createElementNS(ns, "title"); title.textContent = day.day + "：" + count(day.n) + "件";
      rect.append(title); svg.append(rect);
      if ([0, 14, 29].includes(i)) {
        const text = document.createElementNS(ns, "text");
        text.setAttribute("x", String(12 + i * 23.3)); text.setAttribute("y", "171");
        text.setAttribute("text-anchor", i === 29 ? "end" : "start"); text.textContent = day.day.slice(5).replace("-", "/");
        svg.append(text);
      }
    });
    target.append(svg);
  }
  function render(data) {
    const catalog = data.catalog;
    if (!catalog || !Array.isArray(data.databases) || ["card_kinds", "coordinate_kinds", "part_kinds"].some(k => number(catalog[k]) === null)) {
      throw Error("統計の形式を確認できません。");
    }
    const complete = data.complete === true && data.databases.length > 0 && data.databases.every(db => db.connected
      && db.data && fields.every(k => number(db.data[k]) !== null));
    const total = Object.fromEntries(fields.map(k => [k, complete ? data.databases.reduce((n, db) => n + Number(db.data[k]), 0) : null]));
    const heroes = $("[data-heroes]"); heroes.replaceChildren();
    for (const [name, value, unit, note] of [
      ["登録アカウント", total.registered_accounts, "件", "全登録者DBの合計"],
      ["カードの種類", catalog.card_kinds, "種類", "アイカツALLを含む"],
      ["コーデの種類", catalog.coordinate_kinds, "コーデ", "バース・プリマジ"],
      ["記録されたカード", total.owned_card_copies, "枚", "所持数の合計"],
    ]) {
      const tile = item("article", "stats-hero");
      const valueNode = item("strong", null, count(value)); valueNode.append(item("small", null, unit));
      tile.append(item("h2", null, name), valueNode, item("p", null, note)); heroes.append(tile);
    }
    const average = complete && total.registered_accounts > 0
      ? (total.owned_card_copies / total.registered_accounts).toLocaleString("ja-JP", { maximumFractionDigits: 1 }) + "枚" : "—";
    details($("[data-records]"), [
      ["パーツの所持数", count(total.owned_part_copies) + "枚"], ["フルコーデ登録数", count(total.owned_coordinate_copies)],
      ["お気に入り", count(total.favorites) + "件"], ["QR・セーブ等の登録", count(total.qr_records) + "件"],
      ["譲る登録", count(total.trade_offers) + "件"], ["求める登録", count(total.trade_wants) + "件"],
      ["1アカウントあたりのカード記録", average],
    ]);
    details($("[data-recent]"), [["直近7日の新規登録", count(total.new_7d) + "件"],
      ["直近30日の新規登録", count(total.new_30d) + "件"], ["30日以内にログイン", count(total.login_30d) + "件"]]);
    details($("[data-families]"), (catalog.families || []).map(r => [labels[r.name] || r.name, count(r.n) + "種類"]));
    details($("[data-coordinates]"), (catalog.coordinate_families || []).map(r => [labels[r.name] || r.name, count(r.n) + "コーデ"]));
    details($("[data-part-sizes]"), (catalog.coordinate_part_sizes || []).map(r => [count(r.parts) + "パーツ構成", count(r.n) + "コーデ"]));
    details($("[data-rarities]"), (catalog.rarities || []).map(r => [r.name, count(r.n) + "種類"]));
    const coverage = catalog.regular_card_kinds > 0
      ? (catalog.cards_with_front / catalog.regular_card_kinds * 100).toFixed(1) + "%" : "—";
    details($("[data-catalog]"), [["登録パーツ", count(catalog.part_kinds) + "種類"],
      ["通常カードの表面画像登録率", coverage], ["アイカツALL", count(catalog.all_card_kinds) + "種類"]]);
    const tbody = $("[data-databases]"); tbody.replaceChildren();
    for (const db of data.databases) {
      const row = item("tr"); row.append(item("th", null, db.label));
      if (!db.connected || !db.data) { const cell = item("td", "stats-unavailable", "取得できませんでした"); cell.colSpan = 5; row.append(cell); }
      else for (const key of ["registered_accounts", "owned_card_copies", "owned_part_copies", "owned_coordinate_copies", "login_30d"]) row.append(item("td", null, count(db.data[key])));
      tbody.append(row);
    }
    chart(data, complete);
    $("[data-timestamp]").textContent = "取得日時：" + new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short",
    }).format(new Date(data.checked_at));
    $("[data-content]").hidden = false;
    $("[data-status]").textContent = complete ? "" : "一部DBの取得が完了していないため、全体合計は表示していません。更新して再確認してください。";
  }
  async function load(force = false) {
    if (!host.authorized() || busy) return;
    if (!force && cache && Date.now() - cachedAt < 60000) { render(cache); return; }
    const ticket = ++epoch, generation = host.generation();
    busy = true; $("[data-refresh]").disabled = true; $("[data-status]").textContent = "全体の記録を集計しています…";
    try {
      const data = await window.CARD_OPS_ADMIN.statistics();
      if (ticket !== epoch || generation !== host.generation() || !host.authorized()) return;
      render(data); cache = data; cachedAt = Date.now();
    } catch (error) {
      if (ticket === epoch && host.authorized()) $("[data-status]").textContent = "統計を取得できませんでした。" + host.errorText(error);
    } finally {
      if (ticket === epoch) { busy = false; $("[data-refresh]").disabled = false; }
    }
  }
  $("[data-refresh]").onclick = () => load(true);
  document.addEventListener("admin-page-changed", event => { if (event.detail.page === "statistics") load(); });
  document.addEventListener("admin-session-reset", () => {
    ++epoch; cache = null; busy = false; cachedAt = 0;
    $("[data-content]").hidden = true; $("[data-status]").textContent = "";
    $("[data-refresh]").disabled = true;
  });
});
