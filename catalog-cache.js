/* カードはテーブルから取得。公開カードのキャッシュだけを端末へ保存します。 */
(() => {
  const key = "card-table-catalog-v2:" + window.APP_CONFIG.supabaseUrl;
  let cache = null, pending = null, checkedAt = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && Number.isSafeInteger(saved.version) && Array.isArray(saved.cards) && Array.isArray(saved.overrides)) cache = saved;
  } catch (_) {}
  window.PUBLIC_CATALOG_CACHE = {
    peek: () => cache,
    invalidate: () => { checkedAt = 0; },
    load(db) {
      if (pending) return pending;
      if (cache && Date.now() - checkedAt < 300000) return Promise.resolve(cache);
      pending = request(db).finally(() => { pending = null; });
      return pending;
    }
  };
  async function revision(db) {
    const { data, error } = await db.from("card_catalog_revision").select("version,updated_at").eq("id", 1).single();
    if (error) throw Error("カード取得設定を確認してください。01-schema.sqlとカード移行を確認してください。");
    if (!data || !Number.isSafeInteger(Number(data.version))) throw Error("カードの版番号を確認できませんでした。");
    return { version: Number(data.version), updated_at: data.updated_at };
  }
  async function rows(db, table, columns, order) {
    const result = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.from(table).select(columns).order(order).range(offset, offset + 999);
      if (error) throw Error("カード情報を取得できませんでした。接続とテーブルの閲覧権限を確認してください。");
      result.push(...data);
      if (data.length < 1000) return result;
    }
  }
  async function request(db) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await revision(db);
      if (cache?.version === before.version) {
        checkedAt = Date.now();
        return cache;
      }
      const [cards, overrides] = await Promise.all([
        rows(db, "card_catalog", "card", "id"),
        rows(db, "card_catalog_overrides", "card_id,patch,updated_at", "card_id")
      ]);
      const after = await revision(db);
      if (before.version !== after.version) continue;
      cache = { version: after.version, cards: cards.map(r => r.card), overrides, state: { updated_at: after.updated_at, running: false } };
      checkedAt = Date.now();
      try { localStorage.setItem(key, JSON.stringify(cache)); } catch (_) {}
      return cache;
    }
    throw Error("カード情報の登録中です。少し待って再読み込みしてください。");
  }
})();
