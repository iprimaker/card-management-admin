/* One operations identity; explicit, fixed registrant database per page. */
(() => {
  "use strict";
  const config = window.APP_CONFIG;
  const opsURL = "https://dwhlljqfredkiijrimwe.supabase.co";
  const storageKey = "card-album-admin-database:dwhlljqfredkiijrimwe";
  if (config?.supabaseUrl !== opsURL || config.operationsAdmin !== true) {
    throw Error("運営用DBのconfig.jsを配置してください。");
  }
  let selected = "main";
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (/^(main|[A-Z])$/.test(saved || "")) selected = saved;
  } catch {}
  const personalNames = new Set([
    "card_admin_users_fast_v1",
    "card_admin_users_qr_filtered",
    "card_admin_users_shared_filtered",
    "card_admin_users_sorted",
    "card_admin_users_filtered",
    "card_admin_users_detail",
    "card_admin_users_presence",
    "card_admin_users_with_verse",
    "card_admin_primagi_user_counts",
    "card_admin_usage",
    "card_admin_usage_details",
    "card_admin_database_traffic",
    "card_admin_contact_list",
    "card_admin_contact_summary",
    "card_admin_contact_delete",
    "card_admin_contact_status",
    "card_admin_contact_reply_list",
    "card_admin_contact_reply_save",
    "card_admin_contact_reply_delete",
    "card_admin_invitation_create",
    "card_admin_invitation_list",
    "card_admin_invitation_revoke",
    "card_admin_set_registration",
    "card_admin_set_registration_mode",
    "card_admin_registration_capacity_get",
    "card_admin_registration_capacity_save",
    "card_admin_set_maintenance",
    "card_admin_shard_config_v1",
    "card_admin_shard_config_save_v1",
    "card_qr_admin_limit",
    "card_qr_admin_user_limit",
    "card_qr_admin_user_list",
    "card_qr_admin_user_settings",
    "card_admin_delete_account",
    "card_ops_registration_status_v150",
    "card_qr_admin_global_settings_v150",
  ]);
  let raw = null;
  let wrapped = null;
  let entries = [];
  let registryFlight = null;
  let epoch = 0;
  const requests = new Set();
  const listedUsers = new Map();
  const error = (message, code = "55000") => ({
    data: null,
    error: { message, code },
  });
  const pendingMessage = "この情報は対応する管理APIから変更してください。";

  function notifyBusy() {
    document.dispatchEvent(
      new CustomEvent("ops-admin-busy", {
        detail: { busy: requests.size > 0 },
      }),
    );
  }

  async function edge(body) {
    if (!raw) throw Error("管理者の接続を初期化できません。");
    const atEpoch = epoch;
    const controller = new AbortController();
    requests.add(controller);
    notifyBusy();
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      const session = await raw.auth.getSession();
      if (session.error || !session.data?.session?.access_token)
        throw Error("運営用DBの管理者としてログインしてください。");
      if (atEpoch !== epoch || controller.signal.aborted)
        throw Error("ログイン状態が変更されました。");
      const response = await fetch(opsURL + "/functions/v1/admin-databases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.supabaseKey,
          Authorization: "Bearer " + session.data.session.access_token,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
      const result = await response.json().catch(() => null);
      if (atEpoch !== epoch) throw Error("ログイン状態が変更されました。");
      if (!response.ok || result?.success !== true) {
        const failure = Error(
          result?.message || "選択した登録者DBとの管理接続を確認できません。",
        );
        failure.code = result?.error_code || "GATEWAY_FAILED";
        throw failure;
      }
      if (result.complete === false)
        window.CARD_DIAGNOSTICS?.report(null, {
          operation: "bulk_partial",
          stage: "response",
          status: 200,
          target: "operations",
        });
      if (result.version !== "v150")
        throw Error("運営用DBのadmin-databasesをv150に更新してください。");
      if (body.action === "rpc" && result.database !== body.database)
        throw Error("応答したDBが選択先と一致しません。");
      return result;
    } finally {
      clearTimeout(timer);
      requests.delete(controller);
      notifyBusy();
    }
  }

  async function registry() {
    if (entries.length) return entries;
    if (registryFlight) return registryFlight;
    const atEpoch = epoch;
    const flight = (async () => {
      const result = await edge({ action: "list" });
      if (result.enabled !== true)
        throw Error("運営用DBでv150の有効化SQLを実行してください。");
      if (
        !Array.isArray(result.databases) ||
        !result.databases.length ||
        !result.databases.every(
          (row) =>
            /^(main|[A-Z])$/.test(row.key) &&
            row.prefix === (row.key === "main" ? "" : row.key),
        )
      ) {
        throw Error("登録者DBの一覧の形式を確認してください。");
      }
      if (!result.databases.some((row) => row.key === selected)) {
        throw Error(
          "選択中のDBが現在の接続先にありません。DB設定を確認してください。",
        );
      }
      if (atEpoch !== epoch) throw Error("ログイン状態が変更されました。");
      entries = result.databases;
      return entries;
    })();
    registryFlight = flight;
    try {
      return await flight;
    } finally {
      if (registryFlight === flight) registryFlight = null;
    }
  }

  const contactCursors = new Map();
  async function contactsRPC(name, args) {
    const values = { ...args };
    if (name === "card_admin_contact_list") {
      const offset = args.p_offset || 0;
      const key = args.p_status + ":" + offset;
      if (!offset) contactCursors.clear();
      if (offset && !contactCursors.has(key))
        throw Error("お問い合わせの先頭ページから読み直してください。");
      const cursor = offset ? contactCursors.get(key) : null;
      const result = await edge({
        action: "contacts",
        name,
        args: { p_status: args.p_status, p_cursor: cursor },
      });
      if (result.data.next_cursor)
        contactCursors.set(
          args.p_status + ":" + (offset + 50),
          result.data.next_cursor,
        );
      return result.data;
    }
    return (await edge({ action: "contacts", name, args: values })).data;
  }
  async function personalRPC(name, args = {}) {
    const atEpoch = epoch;
    try {
      if (name.startsWith("card_admin_contact_")) {
        return { data: await contactsRPC(name, args), error: null };
      }
      await registry();
      if (atEpoch !== epoch) throw Error("ログイン状態が変更されました。");
      const values = { ...args };
      if (selected !== "main" && typeof values.p_query === "string") {
        const query = values.p_query.normalize("NFKC").trim().toUpperCase();
        if (new RegExp("^" + selected + "[A-HJ-NP-Z0-9]{12}$").test(query))
          values.p_query = query.slice(1);
      }
      const response = await edge({
        action: "rpc",
        database: selected,
        name,
        args: values,
        request_id: crypto.randomUUID(),
      });
      const data = response.data;
      if (name.startsWith("card_admin_users_") && Array.isArray(data?.users)) {
        for (const user of data.users) {
          user.database_prefix = selected === "main" ? "" : selected;
          if (user.album_id && user.database_prefix)
            user.album_id = user.database_prefix + user.album_id;
          listedUsers.set(user.id, user.album_id);
        }
      }
      if (name === "card_admin_contact_list" && selected !== "main") {
        for (const message of data?.messages || []) {
          if (/^[A-HJ-NP-Z0-9]{12}$/.test(message.album_id || ""))
            message.album_id = selected + message.album_id;
        }
      }
      return { data, error: null };
    } catch (failure) {
      return error(
        failure.name === "AbortError"
          ? "処理が中断されました。書き込みの結果が不明な場合は、一覧を更新して確認してください。"
          : failure.message || "管理操作を完了できませんでした。",
        failure.code || "GATEWAY_FAILED",
      );
    }
  }

  function blockedMutation() {
    const result = Promise.resolve(error(pendingMessage));
    let chain;
    chain = new Proxy(
      {},
      {
        get(target, key) {
          if (key === "then" || key === "catch" || key === "finally")
            return result[key].bind(result);
          return () => chain;
        },
      },
    );
    return chain;
  }

  const catalogWrites = new Set([
    "card_admin_publish_pending",
    "card_admin_verse_save",
    "card_admin_verse_create_v1",
    "card_admin_catalog_delete_v2",
    "card_admin_catalog_delete_v1",
  ]);
  async function afterCatalogWrite() {
    const ticket = epoch;
    const hold = new AbortController();
    requests.add(hold);
    notifyBusy();
    const show = (state, message) => {
      if (ticket === epoch && !hold.signal.aborted) {
        document.dispatchEvent(
          new CustomEvent("ops-catalog-sync-status", {
            detail: { state, message },
          }),
        );
      }
    };
    show("pending", "保存した情報を登録者DBへ反映しています…");
    try {
      const started = Date.now();
      do {
        if (ticket !== epoch || hold.signal.aborted) return;
        const state = await edge({ action: "sync_state" });
        if (state.synced === true) {
          show("complete", "必要な情報の同期を確認しました。");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
      } while (Date.now() - started < 12000);
      show(
        "warning",
        "保存は完了しています。登録者DBへの反映は確認中です。「最小同期の状態」で確認してください。",
      );
    } catch {
      show(
        "warning",
        "保存は完了していますが、同期の確認ができませんでした。「最小同期の状態」で確認してください。",
      );
    } finally {
      requests.delete(hold);
      notifyBusy();
    }
  }

  function catalogMutation(query) {
    let flight = null;
    const run = () =>
      (flight ||= Promise.resolve(query).then(async (result) => {
        if (!result.error) await afterCatalogWrite();
        return result;
      }));
    return new Proxy(query, {
      get(target, property) {
        if (property === "then")
          return (resolve, reject) => run().then(resolve, reject);
        if (property === "catch") return (callback) => run().catch(callback);
        if (property === "finally")
          return (callback) => run().finally(callback);
        const value = target[property];
        if (typeof value !== "function") return value;
        return (...args) => {
          const next = value.apply(target, args);
          return next && typeof next.then === "function"
            ? catalogMutation(next)
            : next;
        };
      },
    });
  }

  function wrap(client) {
    if (raw) throw Error("管理者の接続は一度だけ初期化してください。");
    raw = client;
    wrapped = new Proxy(client, {
      get(target, property) {
        if (property === "rpc")
          return (name, args = {}, options) => {
            if (name === "card_album_registration_status_v3")
              return personalRPC("card_ops_registration_status_v150", {});
            if (personalNames.has(name)) return personalRPC(name, args);
            const response = target.rpc(name, args, options);
            return catalogWrites.has(name)
              ? Promise.resolve(response).then(async (result) => {
                  if (!result.error) await afterCatalogWrite();
                  return result;
                })
              : response;
          };
        if (property === "from")
          return (table) =>
            new Proxy(target.from(table), {
              get(query, method) {
                if (["insert", "upsert", "update", "delete"].includes(method)) {
                  if (table === "card_catalog_overrides")
                    return (...args) => catalogMutation(query[method](...args));
                  if (table === "card_announcements")
                    return query[method].bind(query);
                  return blockedMutation;
                }
                const value = query[method];
                return typeof value === "function" ? value.bind(query) : value;
              },
            });
        const value = target[property];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    window.CARD_ADMIN_SHARDS = Object.freeze({
      usersDatabase: () => selected,
      usersRPC: (name, args) => wrapped.rpc(name, args),
      async deleteUser(body) {
        if (
          body.database !== selected ||
          !listedUsers.has(body.user_id) ||
          listedUsers.get(body.user_id) !== body.album_id ||
          body.confirmation !== "DELETE_ACCOUNT"
        ) {
          throw Error(
            "削除対象のDB・アルバムIDを確認し、一覧を更新してください。",
          );
        }
        const result = await personalRPC("card_admin_delete_account", {
          p_target: body.user_id,
          p_confirmation: "DELETE_ACCOUNT",
        });
        if (result.error) throw result.error;
        if (result.data !== true)
          throw Error("対象アカウントは削除済みです。一覧を更新してください。");
        listedUsers.delete(body.user_id);
        return { deleted: true };
      },
    });
    return wrapped;
  }

  function changeDatabase(key) {
    if (!entries.some((row) => row.key === key) || key === selected)
      return false;
    if (requests.size || document.querySelector("dialog[open]")) {
      throw Error(
        "処理やダイアログを閉じてから、登録者DBを切り替えてください。",
      );
    }
    if (
      !document.dispatchEvent(
        new CustomEvent("admin-page-before-change", {
          cancelable: true,
          detail: { page: "__database_switch__" },
        }),
      )
    )
      return false;
    // Reload clears all forms, modal targets, caches, and notifications across every feature.
    sessionStorage.setItem(storageKey, key);
    location.reload();
    return true;
  }

  document.addEventListener("admin-session-reset", () => {
    ++epoch;
    for (const request of requests) request.abort();
    requests.clear();
    entries = [];
    registryFlight = null;
    listedUsers.clear();
    contactCursors.clear();
    notifyBusy();
  });
  window.CARD_OPS_ADMIN = Object.freeze({
    wrap,
    registry,
    database: () => selected,
    changeDatabase,
    busy: () => requests.size > 0,
    settings: (database, name, args = {}, revisions, targets) =>
      edge({
        action: "settings",
        database,
        name,
        args,
        ...(revisions === undefined ? {} : { revisions }),
        ...(targets === undefined ? {} : { targets }),
      }),
    statistics: async () => (await edge({ action: "statistics" })).data,
  });
})();
