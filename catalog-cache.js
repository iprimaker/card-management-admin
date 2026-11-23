/* Administrator-only, memory-only catalog cache for the operations connection. */
(() => {
  "use strict";
  let snapshot = null;
  let flight = null;
  let epoch = 0;
  async function rows(db, table, columns, key) {
    const result = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from(table).select(columns).order(key).range(offset, offset + 499);
      if (error) throw error;
      if (!Array.isArray(data)) throw Error("カタログの応答を確認できません。");
      result.push(...data);
      if (data.length < 500) return result;
    }
  }
  function invalidate() {
    epoch++;
    snapshot = null;
    flight = null;
  }
  async function load(db) {
    if (snapshot) return snapshot;
    if (flight) return flight;
    const atEpoch = epoch;
    const work = (async () => {
      const values = await Promise.all([
        rows(db, "card_catalog", "id,card", "id"),
        rows(db, "card_catalog_overrides", "card_id,patch", "card_id"),
        db.from("card_catalog_revision").select("version,updated_at").eq("id", 1).single(),
      ]);
      if (values[2].error) throw values[2].error;
      if (atEpoch !== epoch) throw Error("カタログの状態が変更されました。更新してください。");
      snapshot = { cards: values[0].map((row) => ({ ...row.card, id: row.id })), overrides: values[1], state: values[2].data };
      return snapshot;
    })();
    flight = work;
    try {
      return await work;
    } finally {
      if (flight === work) flight = null;
    }
  }
  document.addEventListener("admin-session-reset", invalidate);
  window.PUBLIC_CATALOG_CACHE = Object.freeze({ load, invalidate, peek: () => snapshot });
})();
