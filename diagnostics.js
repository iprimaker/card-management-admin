const CARD_ERROR_OPERATIONS_V180 = [
  "admin_gateway",
  "auth_logout",
  "auth_refresh",
  "auth_signup",
  "auth_token",
  "bulk_partial",
  "camera",
  "card_account_presence_touch",
  "card_admin_catalog_delete_v1",
  "card_admin_catalog_delete_v2",
  "card_admin_cleanup_save_v179",
  "card_admin_contact_",
  "card_admin_contact_delete",
  "card_admin_contact_list",
  "card_admin_contact_reply_delete",
  "card_admin_contact_reply_list",
  "card_admin_contact_reply_save",
  "card_admin_contact_status",
  "card_admin_contact_summary",
  "card_admin_database_traffic",
  "card_admin_delete_account",
  "card_admin_error_records_v180",
  "card_admin_guest_browse_save",
  "card_admin_import_cards",
  "card_admin_import_history",
  "card_admin_invitation_create",
  "card_admin_invitation_list",
  "card_admin_invitation_revoke",
  "card_admin_log",
  "card_admin_mfa_identity",
  "card_admin_pending_cards",
  "card_admin_primagi_user_counts",
  "card_admin_publish_pending",
  "card_admin_registration_capacity_get",
  "card_admin_registration_capacity_save",
  "card_admin_save_pending",
  "card_admin_set_maintenance",
  "card_admin_set_registration",
  "card_admin_set_registration_mode",
  "card_admin_shard_config_save_v1",
  "card_admin_shard_config_v1",
  "card_admin_usage",
  "card_admin_usage_details",
  "card_admin_users_",
  "card_admin_users_detail",
  "card_admin_users_fast_v1",
  "card_admin_users_filtered",
  "card_admin_users_presence",
  "card_admin_users_qr_filtered",
  "card_admin_users_shared_filtered",
  "card_admin_users_sorted",
  "card_admin_users_with_verse",
  "card_admin_verse_create_v1",
  "card_admin_verse_history",
  "card_admin_verse_list",
  "card_admin_verse_save",
  "card_album_change_quantity",
  "card_album_clear_quantity",
  "card_album_command_execute",
  "card_album_command_prepare",
  "card_album_delete_self",
  "card_album_display_load",
  "card_album_display_save",
  "card_album_ids",
  "card_album_invitation_claim",
  "card_album_list_text_preferences",
  "card_album_login_identifier",
  "card_album_maintenance_warning_schedule",
  "card_album_my_id",
  "card_album_ownership_image_settings",
  "card_album_registration_feed",
  "card_album_registration_status_v3",
  "card_album_reservation_v1",
  "card_album_reset_records",
  "card_album_set_favorite",
  "card_album_set_records",
  "card_album_set_trade_priority",
  "card_album_shard_status_v1",
  "card_album_share_delete",
  "card_album_share_issue",
  "card_album_share_notify",
  "card_album_share_read",
  "card_album_share_restore",
  "card_album_share_set_scope",
  "card_album_share_set_series",
  "card_album_share_settings",
  "card_album_shares",
  "card_album_touch_activity",
  "card_all_change_quantity",
  "card_all_favorites",
  "card_all_ownership",
  "card_all_set_favorite",
  "card_announcements",
  "card_catalog",
  "card_catalog_overrides",
  "card_catalog_revision",
  "card_contact_replies",
  "card_contact_submit",
  "card_contacts",
  "card_favorites",
  "card_guest_browse_status",
  "card_id",
  "card_metadata_notes",
  "card_ops_registration_status_v150",
  "card_ownership",
  "card_personal_metadata",
  "card_primagi_catalog_counts",
  "card_private_qr",
  "card_qr_admin_global_settings_v150",
  "card_qr_admin_limit",
  "card_qr_admin_user_limit",
  "card_qr_admin_user_list",
  "card_qr_admin_user_settings",
  "card_qr_delete",
  "card_qr_delete_all",
  "card_qr_limit_notices",
  "card_qr_list",
  "card_qr_registered_list",
  "card_qr_save",
  "card_qr_status",
  "card_save_code_add",
  "card_save_code_birthday",
  "card_save_code_delete",
  "card_save_code_list",
  "card_save_codes",
  "card_trade_requests",
  "card_verse_catalog_cached",
  "card_verse_catalog_family_cached",
  "card_verse_catalog_related_count",
  "card_verse_change_quantity",
  "card_verse_coordinate_ownership",
  "card_verse_coordinates",
  "card_verse_favorites",
  "card_verse_my_inventory",
  "card_verse_ownership",
  "card_verse_parts",
  "card_verse_set_favorite",
  "card_visibility_display_catalog",
  "card_visibility_public_status",
  "file_load",
  "image_export",
  "other",
  "runtime",
  "share",
  "storage",
];
/* Failure receipts only. No error messages, request bodies, URLs or credentials are stored. */
(() => {
  "use strict";
  if (window.CARD_DIAGNOSTICS) return;
  const operations = new Set(CARD_ERROR_OPERATIONS_V180);
  const OPS = "https://dwhlljqfredkiijrimwe.supabase.co";
  const KEY = "sb_publishable_DI0p9r9UnHDZXryphpWCxg_ZhO8Bc8u";
  const nativeFetch = window.fetch.bind(window),
    seen = new Map(),
    recent = [];
  const names = new Set([
    "Error",
    "TypeError",
    "SyntaxError",
    "AbortError",
    "TimeoutError",
    "NotAllowedError",
    "NotFoundError",
    "QuotaExceededError",
    "SecurityError",
    "AuthApiError",
    "AuthRetryableFetchError",
  ]);
  const upstreams = new Set([
    "invalid_credentials",
    "user_banned",
    "email_not_confirmed",
    "unexpected_failure",
    "over_request_rate_limit",
    "over_email_send_rate_limit",
    "session_expired",
    "refresh_token_not_found",
    "refresh_token_already_used",
    "PGRST301",
    "PGRST302",
    "PGRST303",
    "PGRST202",
    "PGRST204",
    "PGRST000",
    "PGRST001",
    "PGRST002",
    "42501",
    "40001",
    "23505",
    "23503",
    "22023",
    "42P01",
    "42703",
    "57014",
    "53300",
    "57P01",
  ]);
  let perMinute = 0,
    minute = 0;
  const receiptPattern = /\bE-[A-F0-9]{24}\b/;
  function credentials(error) {
    return (
      error?.code === "invalid_credentials" ||
      /Invalid login credentials|ID(?:または|か)パスワードが(?:異なります|正しくありません)/i.test(
        typeof error === "string" ? error : error?.message || "",
      )
    );
  }
  function identity() {
    const cfg = window.APP_CONFIG || {};
    const host = window.CARD_SHARE_HOST || window.CARD_CONTACT_HOST;
    const session = host?.session?.();
    return {
      database: cfg.operationsAdmin
        ? "operations"
        : window.CARD_DB?.key || "main",
      token: session?.access_token || "",
      scope: session?.user?.id || "anonymous",
    };
  }
  function target(url) {
    if (url.origin === OPS) return "operations";
    if (url.origin === "https://lwbzwxoilpwouwnjgsed.supabase.co")
      return "main";
    if (url.origin === window.APP_CONFIG?.supabaseUrl)
      return window.CARD_DB?.key || "main";
    if (url.origin === "https://jalviddujtkkjniawytl.supabase.co") return "A";
    return "unknown";
  }
  function getReceipt() {
    const b = new Uint8Array(12);
    crypto.getRandomValues(b);
    return (
      "E-" +
      Array.from(b, (n) => n.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
    );
  }
  const assetPattern =
    /^asset_(app|album|db_shards|common|public|contact|account_tools|image_export|image_share|qr_tools|qr_encoder|list|login|archive|qr|admin|admin_errors|admin_operations|admin_shards|operations_connection|private_qr_admin)_(js|css)_l[0-9]{1,7}_c[0-9]{1,7}$/;
  const allowedOperation = (value) =>
    operations.has(value) || assetPattern.test(value || "");
  function assetOperation(path, line = 0, column = 0) {
    try {
      const name = new URL(path, location.href).pathname
        .split("/")
        .at(-1)
        .replace(/[-.]/g, "_");
      const value =
        "asset_" +
        name +
        "_l" +
        Math.max(0, Math.min(9999999, Number(line) || 0)) +
        "_c" +
        Math.max(0, Math.min(9999999, Number(column) || 0));
      return assetPattern.test(value) ? value : "runtime";
    } catch {
      return "runtime";
    }
  }
  function report(error, context = {}) {
    try {
      if (
        credentials(error) ||
        window.CARD_ERROR?.isExpected?.(error) ||
        error?.message === "CARD_ALBUM_MAINTENANCE"
      )
        return null;
      const existing = receiptPattern.exec(
        typeof error === "string" ? error : error?.message || "",
      );
      if (existing) return existing[0];
      const who = identity();
      // Scope deduplication to the request's user during authentication transitions.
      // This local value is never accepted as a server identity or written to a report.
      try {
        const token = (context.bearer || "").replace(/^Bearer /, "");
        const payload = JSON.parse(
          atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
        );
        if (/^[0-9a-f-]{36}$/i.test(payload.sub || "")) who.scope = payload.sub;
      } catch {}
      const up = upstreams.has(error?.code) ? error.code : "",
        status = Number(
          error?.status || error?.statusCode || context.status || 0,
        );
      const exception = names.has(error?.name)
        ? error.name
        : error?.name
          ? "other"
          : "";
      const candidates = [
        ...new Set(
          recent
            .filter(
              (r) =>
                Date.now() - r.time < 10000 &&
                r.scope === who.scope &&
                r.database === who.database &&
                (!up || r.upstream === up) &&
                (!status || r.status === status),
            )
            .map((r) => r.receipt),
        ),
      ];
      if (!context.operation && candidates.length === 1 && (up || status)) {
        return candidates[0];
      }
      const operation = allowedOperation(context.operation)
        ? context.operation
        : "other";
      const stage = [
        "request",
        "response",
        "feedback",
        "runtime",
        "resource",
        "share",
        "camera",
        "image",
        "storage",
      ].includes(context.stage)
        ? context.stage
        : "feedback";
      const record = {
        operation,
        stage,
        status:
          Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0,
        upstream: up,
        exception,
        version: "v180",
        target_database: context.target || "unknown",
      };
      const dedup = JSON.stringify([who.database, who.scope, record]);
      const previous = seen.get(dedup);
      if (previous && Date.now() - previous.time < 60000)
        return previous.receipt;
      const receipt = getReceipt();
      record.receipt = receipt;
      seen.set(dedup, { receipt, time: Date.now() });
      if (seen.size > 100) seen.delete(seen.keys().next().value);
      recent.push({
        ...record,
        scope: who.scope,
        database: who.database,
        time: Date.now(),
      });
      if (recent.length > 30) recent.shift();
      const currentMinute = Math.floor(Date.now() / 60000);
      if (currentMinute !== minute) {
        minute = currentMinute;
        perMinute = 0;
      }
      if (++perMinute <= 10) {
        const candidate =
          context.bearer || (who.token ? "Bearer " + who.token : "");
        const bearer = /^Bearer eyJ[A-Za-z0-9_.-]+$/.test(candidate)
          ? candidate
          : "";
        const headers = {
          "Content-Type": "application/json",
          apikey: KEY,
          ...(bearer ? { Authorization: bearer } : {}),
        };
        const controller = new AbortController(),
          timer = setTimeout(() => controller.abort(), 20000);
        void nativeFetch(OPS + "/functions/v1/error-report", {
          method: "POST",
          headers,
          body: JSON.stringify({ database: who.database, report: record }),
          signal: controller.signal,
          credentials: "omit",
          cache: "no-store",
          keepalive: true,
          redirect: "error",
        })
          .then((response) => {
            response.body?.cancel().catch(() => {});
          })
          .catch(() => {})
          .finally(() => clearTimeout(timer));
      }
      return receipt;
    } catch {
      return null;
    }
  }
  function feedback(error) {
    if (credentials(error) || window.CARD_ERROR?.isExpected?.(error))
      return null;
    const text = typeof error === "string" ? error : error?.message || "";
    if (receiptPattern.test(text)) return receiptPattern.exec(text)[0];
    if (
      typeof error === "string" &&
      (!/できません|失敗|エラー|error|failed/i.test(text) ||
        /入力してください|同意|入力内容|上限|期限切れ|メンテナンス中は|ログインしてください|再ログインしてください/.test(
          text,
        ))
    )
      return null;
    const stage = /画像|image|canvas|blob/i.test(text)
      ? "image"
      : /カメラ|camera/i.test(text)
        ? "camera"
        : /localStorage|sessionStorage|保存機能/.test(text)
          ? "storage"
          : "feedback";
    return report(error, { stage });
  }
  async function smallError(response) {
    const clone = response.clone(),
      reader = clone.body?.getReader();
    if (!reader) return null;
    let text = "",
      size = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 8192) {
          void reader.cancel();
          return null;
        }
        text += decoder.decode(value, { stream: true });
      }
      const data = JSON.parse(text);
      return data && typeof data === "object" && !Array.isArray(data)
        ? data
        : null;
    } catch {
      return null;
    }
  }
  window.fetch = async function (input, options = {}) {
    let url,
      operation = "",
      bearer = "";
    try {
      url = new URL(
        typeof input === "string" ? input : input.url,
        location.href,
      );
      if (
        url.protocol !== "https:" ||
        !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
        url.pathname.endsWith("/error-report")
      )
        return nativeFetch(input, options);
      const last = url.pathname.split("/").at(-1);
      if (url.pathname.startsWith("/auth/v1/"))
        operation =
          last === "token"
            ? url.searchParams.get("grant_type") === "refresh_token"
              ? "auth_refresh"
              : "auth_token"
            : last === "signup"
              ? "auth_signup"
              : last === "logout"
                ? "auth_logout"
                : "other";
      else if (url.pathname.includes("/functions/v1/"))
        operation = last === "admin-databases" ? "admin_gateway" : "other";
      else if (url.pathname.startsWith("/rest/v1/"))
        operation = operations.has(last) ? last : "other";
      else return nativeFetch(input, options);
      bearer =
        new Headers(
          options.headers ||
            (typeof input === "object" ? input.headers : undefined),
        ).get("Authorization") || "";
    } catch {
      return nativeFetch(input, options);
    }
    try {
      const response = await nativeFetch(input, options);
      try {
        if (!response.ok) {
          const data = await smallError(response);
          const rawCode = data?.code || data?.error_code || data?.error;
          const code = upstreams.has(rawCode) ? rawCode : "";
          if (
            code === "invalid_credentials" ||
            data?.message === "Invalid login credentials" ||
            data?.error_description === "Invalid login credentials" ||
            data?.message === "CARD_ALBUM_MAINTENANCE" ||
            window.CARD_ERROR?.isExpected?.(data)
          )
            return response;
          const receipt = report(
            { code, status: response.status },
            { operation, stage: "response", target: target(url), bearer },
          );
          if (data && receipt) {
            const headers = new Headers(response.headers);
            headers.delete("Content-Length");
            headers.delete("Content-Encoding");
            headers.set("Content-Type", "application/json");
            const message =
              "操作を完了できませんでした。 エラーコード：" + receipt;
            return new Response(
              JSON.stringify({
                code: code || "other",
                error_code: code || "other",
                error: code || "other",
                message,
                msg: message,
                error_description: message,
                details: null,
                hint: null,
                card_receipt: receipt,
              }),
              {
                status: response.status,
                statusText: response.statusText,
                headers,
              },
            );
          }
        }
      } catch {
        /* Reporting must never replace a valid fetch response with an exception. */
      }
      return response;
    } catch (error) {
      if (error?.name !== "AbortError")
        report(error, {
          operation,
          stage: "request",
          target: target(url),
          bearer,
        });
      throw error;
    }
  };
  window.addEventListener("unhandledrejection", (e) => {
    if (e.reason?.name !== "AbortError")
      report(e.reason, { operation: "runtime", stage: "runtime" });
  });
  window.addEventListener(
    "error",
    (e) => {
      if (e.target && ["SCRIPT", "LINK"].includes(e.target.tagName))
        report(null, {
          operation: assetOperation(e.target.src || e.target.href),
          stage: "resource",
        });
      else if (e.error)
        report(e.error, {
          operation: assetOperation(e.filename, e.lineno, e.colno),
          stage: "runtime",
        });
    },
    true,
  );
  const clients = new WeakMap(),
    queries = new WeakMap();
  function wrapQuery(query, operation, origin) {
    if (!query || typeof query.then !== "function") return query;
    if (queries.has(query)) return queries.get(query);
    let flight;
    const run = () =>
      (flight ||= Promise.resolve(query).then((result) => {
        if (
          !result?.error ||
          credentials(result.error) ||
          result.error.message === "CARD_ALBUM_MAINTENANCE"
        )
          return result;
        const receipt = report(result.error, {
          operation,
          stage: "response",
          target: target(new URL(origin)),
        });
        if (!receipt) return result;
        return {
          ...result,
          error: {
            ...result.error,
            message: "操作を完了できませんでした。 エラーコード：" + receipt,
            details: null,
            hint: null,
            card_receipt: receipt,
          },
        };
      }));
    const proxy = new Proxy(query, {
      get(object, key) {
        if (key === "then") return (yes, no) => run().then(yes, no);
        if (key === "catch") return (no) => run().catch(no);
        if (key === "finally") return (done) => run().finally(done);
        const value = object[key];
        return typeof value === "function"
          ? (...args) => wrapQuery(value.apply(object, args), operation, origin)
          : value;
      },
    });
    queries.set(query, proxy);
    return proxy;
  }
  function wrapClient(client, origin) {
    if (clients.has(client)) return clients.get(client);
    const proxy = new Proxy(client, {
      get(object, key) {
        if (key === "rpc")
          return (name, ...args) =>
            wrapQuery(
              object.rpc(name, ...args),
              operations.has(name) ? name : "other",
              origin,
            );
        if (key === "from")
          return (name) => {
            const builder = object.from(name);
            return new Proxy(builder, {
              get(table, method) {
                const value = table[method];
                return typeof value === "function"
                  ? (...args) =>
                      wrapQuery(
                        value.apply(table, args),
                        operations.has(name) ? name : "other",
                        origin,
                      )
                  : value;
              },
            });
          };
        const value = object[key];
        return typeof value === "function" ? value.bind(object) : value;
      },
    });
    clients.set(client, proxy);
    return proxy;
  }
  window.CARD_DIAGNOSTICS = Object.freeze({ report, feedback, wrapClient });
})();
