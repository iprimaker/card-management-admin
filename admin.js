(async () => {
  let startupTimer;
  try {
    const $ = (id) => document.getElementById(id);
    const esc = (value) =>
      String(value ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
    const config = window.APP_CONFIG;
    if (
      !config ||
      !/^https:\/\/[^/]+\.supabase\.co\/?$/.test(config.supabaseUrl || "") ||
      !config.supabaseKey
    ) {
      throw Error("config.js のSupabase URL・公開キーを確認してください。");
    }
    if (!window.supabase?.createClient) {
      throw Error(
        "vendor/supabase.js を読み込めません。vendorフォルダも公開先に配置してください。",
      );
    }
    let lastConnectionFailure = "";
    const errorText = (error) => {
      const detail = error?.message || String(error || "不明なエラー");
      if (/abort|timeout/i.test(detail))
        return "通信がタイムアウトしました。接続を確認して再試行してください。";
      if (/failed to fetch|network|load failed/i.test(detail))
        return (
          "Supabaseに接続できません。「接続診断」を実行してください。" +
          (lastConnectionFailure ? " 通信先：" + lastConnectionFailure : "")
        );
      if (/PGRST202|42883/.test(error?.code || "")) {
        const prerequisites = [
          [
            /card_admin_(users_detail|delete_account|restart_sync)/,
            "16-admin-management.sql",
          ],
          [
            /card_admin_(usage_details|sync_settings|set_auto_sync)/,
            "22-usage-details-sync-control.sql",
          ],
          [
            /card_admin_(usage|set_registration)/,
            "17-usage-registration-control.sql",
          ],
          [/card_admin_sync_progress/, "18-sync-progress.sql"],
          [/card_album_catalog_cached/, "19-efficient-catalog.sql"],
          [/card_admin_database_traffic/, "27-no-log-query-metrics.sql"],
        ];
        const file = prerequisites.find(([pattern]) =>
          pattern.test(detail),
        )?.[1];
        if (file)
          return "必要なSQL（" + file + "）を実行してください。詳細：" + detail;
      }
      if (
        /PGRST202|is_card_admin|card_admin_list_users/.test(
          detail + (error?.code || ""),
        )
      )
        return "管理者用SQL（05-admin.sql）を実行してください。詳細：" + detail;
      if (/42P01|PGRST205/.test(error?.code || ""))
        return (
          "必要なDBテーブルがありません。一般サイトのDB設定と05-admin.sqlを確認してください。詳細：" +
          detail
        );
      if (/email not confirmed/i.test(detail))
        return "一般サイトで届いた確認メールを開き、メール確認を完了してください。";
      return detail;
    };
    let persistSession = true;
    try {
      const key = "card-album-admin-storage-check";
      localStorage.setItem(key, "1");
      localStorage.removeItem(key);
    } catch {
      persistSession = false;
    }
    async function boundedFetch(input, init = {}) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, 20000);
      try {
        return await fetch(input, { ...init, signal: controller.signal });
      } catch (error) {
        try {
          lastConnectionFailure = new URL(
            typeof input === "string" || input instanceof URL
              ? input
              : input.url,
          ).pathname;
        } catch {
          lastConnectionFailure = "不明";
        }
        throw error;
      } finally {
        clearTimeout(timer);
        init.signal?.removeEventListener("abort", abort);
      }
    }
    if (config.publicSiteUrl) $("public-site-link").href = config.publicSiteUrl;
    else $("public-site-link").hidden = true;
    const db = window.supabase.createClient(
      config.supabaseUrl,
      config.supabaseKey,
      {
        auth: {
          storageKey: "card-album-admin-auth",
          detectSessionInUrl: false,
          persistSession,
        },
        global: { fetch: boundedFetch },
      },
    );
    let session = null,
      authorized = false,
      generation = 0,
      cardPage = 1,
      userPage = 1,
      editing = null;
    let contactPage = 1;
    let usageSnapshot = null,
      usageFetchedAt = 0,
      usageBusy = false,
      detailsBusy = false,
      detailsFetchedAt = 0;
    let syncProgressTimer = null,
      syncProgressBusy = false,
      syncRequestedUntil = 0;
    let notificationTimer = null,
      notificationBusy = false,
      userRows = new Map(),
      deletingUser = null;
    let usersRequest = 0,
      contactsRequest = 0,
      cardsRequest = 0;
    let catalogFetchedAt = 0;
    let catalogCache = null,
      catalogFlight = null,
      catalogRevision = 0;
    let accessFlight = null,
      accessUser = null;
    let notificationFetchedAt = 0;
    let baseCards = [],
      overrides = new Map();
    const pageSize = 24;
    const arrayFields = new Set([
      "series",
      "type",
      "category",
      "brand",
      "songs",
    ]);
    const labels = {
      name: "カード名",
      code: "カードコード",
      rarity: "レアリティ",
      character: "キャラクター",
      series: "弾数",
      type: "タイプ",
      category: "カテゴリ",
      brand: "ブランド",
      songs: "遊べる曲",
      family: "アイプリの種類",
      variant: "カードの種類",
      front: "表面画像URL",
      back: "裏面画像URL",
    };
    const timestamp = (value) =>
      value
        ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
        : "—";
    const message = (text) => {
      $("admin-message").textContent = text;
    };
    function hidePrivateData() {
      authorized = false;
      usersRequest++;
      contactsRequest++;
      cardsRequest++;
      catalogCache = null;
      catalogFetchedAt = 0;
      catalogFlight = null;
      catalogRevision++;
      notificationFetchedAt = 0;
      clearInterval(notificationTimer);
      clearInterval(syncProgressTimer);
      trafficLoadedAt = 0;
      syncRequestedUntil = 0;
      $("sync-progress-status").textContent = "";
      $("sync-progress-counts").replaceChildren();
      $("sync-progress-time").textContent = "";
      userRows.clear();
      usageSnapshot = null;
      usageFetchedAt = detailsFetchedAt = 0;
      for (const id of [
        "usage-detail-cards",
        "usage-detail-stats",
        "usage-detail-tables",
        "usage-detail-cron",
        "usage-detail-http",
      ])
        $(id).replaceChildren();
      $("usage-detail-period").textContent = "";
      $("usage-details-message").textContent =
        "必要なときだけ詳細を取得します。";
      $("auto-sync-enabled").disabled = true;
      deletingUser = null;
      $("contact-alert").hidden = true;
      baseCards = [];
      overrides.clear();
      editing = null;
      cardPage = userPage = contactPage = 1;
      $("admin-account").textContent = "";
      message("");
      $("admin-app").hidden = true;
      $("admin-nav").hidden = true;
      $("admin-auth").hidden = false;
      for (const id of [
        "user-list",
        "log-list",
        "admin-card-list",
        "contact-list",
        "usage-cards",
        "usage-tables",
        "traffic-totals",
        "traffic-chart",
      ])
        $(id).replaceChildren();
      for (const id of [
        "edit-dialog",
        "confirm-dialog",
        "delete-user-dialog",
        "sync-dialog",
      ])
        if ($(id).open) $(id).close();
    }
    function checkAccess(next) {
      const uid = next?.user?.id;
      if (authorized && uid && uid === session?.user?.id) {
        session = next;
        return Promise.resolve();
      }
      if (accessFlight && accessUser === uid) return accessFlight;
      accessUser = uid;
      const flight = checkAccessUnsafe(next);
      accessFlight = flight;
      flight
        .finally(() => {
          if (accessFlight === flight) {
            accessFlight = null;
            accessUser = null;
          }
        })
        .catch(() => {});
      return flight;
    }
    async function checkAccessUnsafe(next) {
      const current = ++generation;
      session = next;
      hidePrivateData();
      if (!session) return;
      $("admin-auth-message").textContent = "管理者権限を確認中…";
      let result;
      try {
        result = await db.rpc("is_card_admin");
      } catch (error) {
        if (current === generation)
          $("admin-auth-message").textContent = errorText(error);
        return;
      }
      const { data, error } = result;
      if (current !== generation) return;
      if (error || data !== true) {
        $("admin-auth-message").textContent = error
          ? "権限を確認できません。" + errorText(error)
          : "このアカウントには管理者権限がありません。管理者メールの確認完了と05-admin.sqlの実行を確認してください。";
        return;
      }
      $("admin-auth-message").textContent = "";
      authorized = true;
      $("admin-auth").hidden = true;
      $("admin-app").hidden = false;
      $("admin-nav").hidden = false;
      $("admin-account").textContent = session.user.email;
      cardPage = 1;
      showPage("users");
      refreshContactNotification();
      notificationTimer = setInterval(() => {
        if (!document.hidden) refreshContactNotification();
      }, 300000);
    }
    async function readAll(table, columns) {
      const rows = [];
      let offset = 0;
      while (true) {
        const { data, error } = await db
          .from(table)
          .select(columns)
          .order(table === "card_catalog" ? "id" : "card_id")
          .range(offset, offset + 499);
        if (error) throw error;
        if (!Array.isArray(data)) throw Error(table + " の応答が不正です。");
        rows.push(...data);
        if (data.length < 500) break;
        offset += 500;
      }
      return rows;
    }
    async function getCatalog(force = false) {
      if (catalogFlight) return catalogFlight;
      if (!force && catalogCache && Date.now() - catalogFetchedAt < 300000)
        return { result: catalogCache, revision: catalogRevision };
      const current = generation,
        revision = catalogRevision;
      const previous = catalogCache;
      const flight = (async () => {
        const { data, error } = await db.rpc("card_album_catalog_cached", {
          p_version: previous?.version ?? null,
        });
        let result;
        if (error) {
          if (!["PGRST202", "42883"].includes(error.code)) throw error;
          const [rows, patches] = await Promise.all([
            readAll("card_catalog", "card"),
            readAll("card_catalog_overrides", "card_id,patch,updated_at"),
          ]);
          result = {
            version: null,
            cards: rows.map((r) => r.card),
            overrides: patches,
          };
        } else {
          if (
            !data ||
            !Array.isArray(data.cards ?? previous?.cards) ||
            !Array.isArray(data.overrides ?? previous?.overrides)
          )
            throw Error(
              "カード取得APIの応答が不正です。19-efficient-catalog.sqlを確認してください。",
            );
          result = {
            version: data.version,
            cards: data.cards ?? previous.cards,
            overrides: data.overrides ?? previous.overrides,
          };
        }
        if (
          current === generation &&
          revision === catalogRevision &&
          authorized
        )
          { catalogCache = result; catalogFetchedAt = Date.now(); }
        return { result, revision };
      })();
      catalogFlight = flight;
      try {
        return await flight;
      } finally {
        if (catalogFlight === flight) catalogFlight = null;
      }
    }
    function invalidateCatalog() {
      catalogRevision++;
      catalogCache = null;
      catalogFetchedAt = 0;
      catalogFlight = null;
      cardsRequest++;
    }
    async function loadCards(force = false) {
      if (!authorized) return;
      const current = generation,
        request = ++cardsRequest;
      message("カード情報を読み込み中…");
      try {
        const { result, revision } = await getCatalog(force);
        if (
          current !== generation ||
          request !== cardsRequest ||
          revision !== catalogRevision ||
          !authorized
        )
          return;
        baseCards = result.cards.filter(
          (card) => card && typeof card.id === "string",
        );
        overrides = new Map(result.overrides.map((r) => [r.card_id, r.patch]));
        renderCards();
        message(
          baseCards.length
            ? ""
            : "カードが未登録です。公式カード情報の強制更新を実行してください。",
        );
      } catch (e) {
        if (current === generation && request === cardsRequest && authorized)
          message("読み込めませんでした。" + errorText(e));
      }
    }
    function combined(card) {
      return { ...card, ...(overrides.get(card.id) || {}) };
    }
    function cardResults() {
      const query = $("admin-query")
          .value.normalize("NFKC")
          .toLowerCase()
          .trim(),
        game = $("admin-game").value;
      return baseCards
        .map(combined)
        .filter(
          (c) =>
            (!game || c.game === game) &&
            (!query ||
              [c.id, c.code, c.name, c.character]
                .join(" ")
                .normalize("NFKC")
                .toLowerCase()
                .includes(query)),
        );
    }
    function renderCards() {
      const cards = cardResults();
      cardPage = Math.min(
        cardPage,
        Math.max(1, Math.ceil(cards.length / pageSize)),
      );
      $("admin-count").textContent = `${cards.length}件`;
      $("admin-card-list").innerHTML = cards
        .slice((cardPage - 1) * pageSize, cardPage * pageSize)
        .map(
          (c) =>
            `<article class="admin-card"><img src="${esc(c.front)}" alt="${esc(c.name || c.code)}" loading="lazy"><p class="muted">${esc(c.code)} · ${esc(c.rarity)}</p><p>${esc(c.name || "カード名未設定")}</p>${overrides.has(c.id) ? '<span class="override-badge">修正を適用中</span>' : ""}<button data-edit="${esc(c.id)}">情報を編集</button></article>`,
        )
        .join("");
      $("card-page").textContent =
        `${cardPage} / ${Math.max(1, Math.ceil(cards.length / pageSize))}`;
      $("card-prev").disabled = cardPage === 1;
      $("card-next").disabled = cardPage * pageSize >= cards.length;
    }
    function openEditor(id) {
      const base = baseCards.find((c) => c.id === id);
      if (!base || !authorized) return;
      editing = base;
      const card = combined(base);
      $("edit-title").textContent = card.name || card.code;
      $("edit-id").textContent = card.id;
      $("edit-image").src = card.front;
      $("edit-message").textContent = "";
      const keys =
        base.game === "aikatsu"
          ? [
              "name",
              "code",
              "rarity",
              "character",
              "series",
              "type",
              "category",
              "brand",
              "variant",
              "front",
              "back",
            ]
          : [
              "name",
              "code",
              "rarity",
              "character",
              "family",
              "series",
              "songs",
              "front",
              "back",
            ];
      $("edit-fields").innerHTML = keys
        .map((key) => {
          let value = card[key] ?? "";
          if (arrayFields.has(key))
            value = (Array.isArray(value) ? value : [value]).join("\n");
          if (key === "variant" && !value) value = "通常";
          if (key === "family" || key === "variant") {
            const choices =
              key === "family" ? ["おねがい", "ひみつ"] : ["通常", "パラレル"];
            return `<label>${labels[key]}<select data-field="${key}">${choices.map((v) => `<option ${value === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>`;
          }
          return `<label>${labels[key]}${arrayFields.has(key) ? `<textarea data-field="${key}" placeholder="1行に1項目">${esc(value)}</textarea>` : `<input data-field="${key}" value="${esc(value)}" ${["name", "code"].includes(key) ? "required" : ""} maxlength="2000">`}</label>`;
        })
        .join("");
      $("override-remove").disabled = !overrides.has(id);
      $("edit-dialog").showModal();
    }
    async function saveEditor(event) {
      event.preventDefault();
      if (!authorized || !editing) return;
      const current = generation,
        id = editing.id,
        patch = { ...(overrides.get(id) || {}) };
      $("edit-save").disabled = true;
      try {
        document.querySelectorAll("[data-field]").forEach((input) => {
          const key = input.dataset.field;
          const value = arrayFields.has(key)
            ? [
                ...new Set(
                  input.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                ),
              ]
            : input.value.trim();
          const original = arrayFields.has(key)
            ? editing[key] || []
            : editing[key] || (key === "variant" ? "通常" : "");
          if (JSON.stringify(value) === JSON.stringify(original))
            delete patch[key];
          else patch[key] = value;
        });
        const result = Object.keys(patch).length
          ? await db
              .from("card_catalog_overrides")
              .upsert({ card_id: id, patch }, { onConflict: "card_id" })
          : await db.from("card_catalog_overrides").delete().eq("card_id", id);
        if (result.error) throw result.error;
        if (current !== generation || !authorized) return;
        invalidateCatalog();
        Object.keys(patch).length
          ? overrides.set(id, patch)
          : overrides.delete(id);
        $("edit-dialog").close();
        renderCards();
        message(
          "カード情報を保存しました。一般サイトには次回更新時に反映されます。",
        );
      } catch (e) {
        if (current === generation)
          $("edit-message").textContent = "保存できませんでした。" + e.message;
      } finally {
        $("edit-save").disabled = false;
      }
    }
    async function loadUsersUnsafe() {
      if (!authorized) return;
      const current = generation,
        page = userPage,
        request = ++usersRequest;
      message("登録者を読み込み中…");
      const { data, error } = await db.rpc("card_admin_users_detail", {
        p_offset: (page - 1) * 100,
        p_limit: 100,
      });
      if (
        current !== generation ||
        request !== usersRequest ||
        page !== userPage ||
        !authorized
      )
        return;
      if (error) {
        message(errorText(error));
        return;
      }
      userRows = new Map((data || []).map((u) => [u.id, u]));
      $("user-list").innerHTML = (data || [])
        .map(
          (u) =>
            `<tr><td>${esc(u.nickname || "未設定")}</td><td class="album-id-cell">${esc(u.album_id || "未発行")}</td><td>${esc(timestamp(u.created_at))}</td><td>${esc(timestamp(u.last_sign_in_at))}</td><td class="ownership-detail"><strong>合計 ${[u.aikatsu_count, u.onegai_count, u.himitsu_count, u.other_count].reduce((n, v) => n + (Number(v) || 0), 0)}枚</strong><small>アイカツ ${Number(u.aikatsu_count) || 0}枚</small><small>おねがい ${Number(u.onegai_count) || 0}枚</small><small>ひみつ ${Number(u.himitsu_count) || 0}枚</small>${Number(u.other_count) ? `<small>その他 ${Number(u.other_count)}枚</small>` : ""}</td><td><button class="danger compact-button" data-delete-user="${esc(u.id)}" ${u.id === session?.user.id ? "disabled" : ""}>強制削除</button></td></tr>`,
        )
        .join("");
      $("user-page").textContent = `${userPage}ページ`;
      $("user-prev").disabled = userPage === 1;
      $("user-next").disabled = data.length < 100;
      message(data.length ? "" : "登録者はいません。");
    }
    async function loadLogsUnsafe() {
      if (!authorized) return;
      const current = generation;
      const { data, error } = await db
        .from("card_admin_log")
        .select("card_id,action,created_at,before_patch,after_patch")
        .order("id", { ascending: false })
        .limit(100);
      if (current !== generation || !authorized) return;
      if (error) {
        message(errorText(error));
        return;
      }
      $("log-list").innerHTML = (data || [])
        .map(
          (row) =>
            `<article class="log-row"><strong>${esc(row.card_id)}</strong><p>${row.action === "DELETE" ? "修正を解除" : row.action === "INSERT" ? "修正を追加" : "修正を更新"} · ${esc(timestamp(row.created_at))}</p><p class="muted">変更項目：${esc([...new Set([...Object.keys(row.before_patch || {}), ...Object.keys(row.after_patch || {})])].map((k) => labels[k] || k).join("、"))}</p></article>`,
        )
        .join("");
      message("最新100件を表示しています。");
    }
    async function guardedLoad(loader) {
      const current = generation,
        page = userPage,
        request = usersRequest + 1;
      try {
        await loader();
      } catch (error) {
        if (
          current === generation &&
          authorized &&
          (loader !== loadUsersUnsafe ||
            (request === usersRequest && page === userPage))
        )
          message(errorText(error));
      }
    }
    function loadUsers() {
      return guardedLoad(loadUsersUnsafe);
    }
    function loadLogs() {
      return guardedLoad(loadLogsUnsafe);
    }
    function showPage(page) {
      if (!authorized) return;
      for (const id of ["cards", "users", "logs", "contacts", "usage"])
        $("admin-" + id).hidden = id !== page;
      document
        .querySelectorAll("[data-page]")
        .forEach((b) => b.classList.toggle("active", b.dataset.page === page));
      message("");
      clearInterval(syncProgressTimer);
      if (page === "cards") {
        loadCards();
        refreshSyncProgress();
      }
      if (page === "users") loadUsers();
      if (page === "logs") loadLogs();
      if (page === "contacts") loadContacts();
      if (page === "usage") loadUsage();
    }
    $("connection-test").onclick = async () => {
      const button = $("connection-test"),
        report = $("connection-report");
      button.disabled = true;
      report.hidden = false;
      const lines = [
        "画面のURL：" + location.origin + location.pathname,
        "Supabase URL：" + config.supabaseUrl,
        "直前の通信失敗：" + (lastConnectionFailure || "記録なし"),
      ];
      if (location.protocol === "file:")
        lines.push(
          "ファイルを直接開いています。HTTP/HTTPSの公開URLで開いてください。",
        );
      report.textContent = lines.join("\n") + "\n接続確認中…";
      try {
        const checks = await Promise.all(
          [
            ["認証API", "/auth/v1/settings"],
            ["カードDB", "/rest/v1/card_catalog?select=id&limit=1"],
          ].map(async ([label, path]) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            try {
              const response = await fetch(config.supabaseUrl + path, {
                headers: { apikey: config.supabaseKey },
                signal: controller.signal,
                cache: "no-store",
              });
              const jsonType = (
                response.headers.get("content-type") || ""
              ).includes("application/json");
              return (
                label +
                "：HTTP " +
                response.status +
                (response.ok && jsonType
                  ? "（接続成功）"
                  : "（応答を確認してください）")
              );
            } catch (error) {
              return (
                label +
                "：" +
                (/abort/i.test(error?.name || "")
                  ? "8秒でタイムアウト"
                  : "通信失敗（" + (error?.message || "不明") + "）")
              );
            } finally {
              clearTimeout(timer);
            }
          }),
        );
        report.textContent = [
          ...lines,
          ...checks,
          "両方が接続成功なら、再ログインし、表示されるエラーとこの診断結果を確認してください。",
          "通信失敗の場合はF12 → Console / Networkのエラーを確認してください。別のブラウザや回線でも比較できます。",
        ].join("\n");
      } finally {
        button.disabled = false;
      }
    };
    $("admin-login").onsubmit = async (e) => {
      e.preventDefault();
      $("admin-submit").disabled = true;
      $("admin-auth-message").textContent = "";
      try {
        const { data, error } = await db.auth.signInWithPassword({
          email: $("admin-email").value.trim(),
          password: $("admin-password").value,
        });
        $("admin-password").value = "";
        if (error) throw error;
        await checkAccess(data.session);
      } catch (e) {
        $("admin-auth-message").textContent = /invalid login/i.test(e.message)
          ? "メールアドレスまたはパスワードが正しくありません。"
          : errorText(e);
      } finally {
        $("admin-submit").disabled = false;
      }
    };
    $("admin-logout").onclick = async () => {
      // Clear private DOM immediately, including when the server is unavailable.
      generation++;
      session = null;
      hidePrivateData();
      try {
        const { error } = await db.auth.signOut({ scope: "local" });
        if (error) {
          $("admin-auth-message").textContent = errorText(error);
        }
      } catch (error) {
        $("admin-auth-message").textContent = errorText(error);
      }
    };
    $("admin-query").oninput = () => {
      cardPage = 1;
      renderCards();
    };
    $("admin-game").onchange = () => {
      cardPage = 1;
      renderCards();
    };
    $("admin-card-list").onclick = (e) => {
      const b = e.target.closest("[data-edit]");
      if (b) openEditor(b.dataset.edit);
    };
    $("card-prev").onclick = () => {
      cardPage--;
      renderCards();
    };
    $("card-next").onclick = () => {
      cardPage++;
      renderCards();
    };
    $("user-prev").onclick = () => {
      userPage--;
      loadUsers();
    };
    $("user-next").onclick = () => {
      userPage++;
      loadUsers();
    };
    $("edit-form").onsubmit = saveEditor;
    $("edit-close").onclick = () => $("edit-dialog").close();
    $("override-remove").onclick = () => $("confirm-dialog").showModal();
    $("confirm-cancel").onclick = () => $("confirm-dialog").close();
    $("confirm-remove").onclick = async () => {
      if (!authorized || !editing) return;
      const current = generation,
        id = editing.id;
      $("confirm-remove").disabled = true;
      try {
        const { error } = await db
          .from("card_catalog_overrides")
          .delete()
          .eq("card_id", id);
        if (error) throw error;
        if (current !== generation || !authorized) return;
        invalidateCatalog();
        overrides.delete(id);
        $("confirm-dialog").close();
        $("edit-dialog").close();
        renderCards();
        message("修正を解除しました。");
      } catch (e) {
        if (current === generation) message(e.message);
      } finally {
        $("confirm-remove").disabled = false;
      }
    };
    $("reload-cards").onclick = () => loadCards(true);
    $("reload-users").onclick = loadUsers;
    $("reload-logs").onclick = loadLogs;
    document
      .querySelectorAll("[data-page]")
      .forEach((b) => (b.onclick = () => showPage(b.dataset.page)));
    db.auth.onAuthStateChange((event, next) => {
      if (event === "SIGNED_OUT") {
        generation++;
        session = null;
        hidePrivateData();
      } else if (["SIGNED_IN", "TOKEN_REFRESHED"].includes(event) && next) {
        if (next.user.id === session?.user?.id) {
          session = next;
        } else {
          generation++;
          session = next;
          hidePrivateData();
          setTimeout(() => {
            if (session?.user?.id === next.user.id)
              checkAccess(next).catch((e) => {
                $("admin-auth-message").textContent = errorText(e);
              });
          }, 0);
        }
      }
    });

    async function contactRequest(
      action,
      {
        method = "GET",
        body,
        page = contactPage,
        status = $("contact-status-filter").value,
      } = {},
    ) {
      const { data, error } = await db.auth.getSession();
      if (
        error ||
        !data.session ||
        !authorized ||
        data.session.user.id !== session?.user?.id
      )
        throw Error("ログインし直してください。");
      const url = new URL(
        config.supabaseUrl +
          "/functions/v1/" +
          (config.contactFunction || "contact-admin"),
      );
      url.searchParams.set("action", action);
      if (action === "list") {
        url.searchParams.set("offset", String((page - 1) * 50));
        url.searchParams.set("status", status);
      }
      const response = await boundedFetch(url, {
        method,
        headers: {
          apikey: config.supabaseKey,
          Authorization: "Bearer " + data.session.access_token,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw Error(
          `お問い合わせ関数の応答が不正です（HTTP ${response.status}）。contact-adminの配置を確認してください。`,
        );
      }
      if (response.status === 404)
        throw Error(
          "contact-adminが見つかりません。管理者ZIPのEdge Functionをデプロイしてください。",
        );
      if (response.status === 401)
        throw Error(
          "認証が必要です。ログインし直してください。Edge FunctionのVerify JWT設定も確認してください。",
        );
      if (!response.ok)
        throw Error(result.error || "お問い合わせを取得できませんでした。");
      return result;
    }
    async function loadContacts() {
      if (!authorized) return;
      const current = generation,
        page = contactPage,
        status = $("contact-status-filter").value,
        request = ++contactsRequest;
      message("お問い合わせを読み込み中…");
      try {
        const { messages } = await contactRequest("list", { page, status });
        if (
          current !== generation ||
          request !== contactsRequest ||
          page !== contactPage ||
          status !== $("contact-status-filter").value ||
          !authorized
        )
          return;
        const categories = {
          question: "使い方について",
          correction: "カード情報の修正",
          deletion: "削除申請",
          other: "その他",
        };
        if (!Array.isArray(messages))
          throw Error("お問い合わせ関数の応答形式を確認してください。");
        $("contact-list").innerHTML = messages
          .map(
            (row) =>
              `<article class="contact-message status-${["new", "working", "done"].includes(row.status) ? row.status : "new"}"><span class="status-label">${{ new: "未対応", working: "対応中", done: "対応済み" }[row.status] || "未対応"}</span><h2>${esc(categories[row.category] || "お問い合わせ")}</h2><p class="contact-meta">${esc(row.name || "お名前未記入")}<br>${esc(row.album_id ? "アルバムID：" + row.album_id : row.email)}<br>${esc(timestamp(row.created_at))}</p><p class="contact-id">受付番号：${esc(row.id)}</p><div class="message-body">${esc(row.message)}</div><div class="contact-actions"><select aria-label="対応状況" data-contact-status="${esc(row.id)}">${[
                ["new", "未対応"],
                ["working", "対応中"],
                ["done", "対応済み"],
              ]
                .map(
                  ([value, label]) =>
                    `<option value="${value}" ${row.status === value ? "selected" : ""}>${label}</option>`,
                )
                .join(
                  "",
                )}</select><button data-contact-save="${esc(row.id)}">状態を保存</button></div></article>`,
          )
          .join("");
        $("contact-page").textContent = contactPage + "ページ";
        $("contact-prev").disabled = contactPage === 1;
        $("contact-next").disabled = messages.length < 50;
        message(messages.length ? "" : "お問い合わせはありません。");
        refreshContactNotification();
      } catch (error) {
        if (current === generation && request === contactsRequest && authorized)
          message(errorText(error));
      }
    }
    $("reload-contacts").onclick = loadContacts;
    $("contact-status-filter").onchange = () => {
      contactPage = 1;
      loadContacts();
    };
    $("contact-prev").onclick = () => {
      contactPage--;
      loadContacts();
    };
    $("contact-next").onclick = () => {
      contactPage++;
      loadContacts();
    };
    $("contact-list").onclick = async (event) => {
      const button = event.target.closest("[data-contact-save]");
      if (!button || !authorized) return;
      const current = generation;
      button.disabled = true;
      try {
        const select = button
          .closest(".contact-message")
          .querySelector("[data-contact-status]");
        await contactRequest("status", {
          method: "POST",
          body: { id: button.dataset.contactSave, status: select.value },
        });
        if (current === generation && authorized) {
          message("対応状況を保存しました。");
          notificationFetchedAt = 0;
          await loadContacts();
        }
      } catch (error) {
        if (current === generation) message(errorText(error));
      } finally {
        button.disabled = false;
      }
    };

    async function refreshContactNotification(force = false) {
      if (
        !authorized ||
        notificationBusy ||
        (!force &&
          notificationFetchedAt &&
          Date.now() - notificationFetchedAt < 300000)
      )
        return;
      notificationBusy = true;
      const current = generation;
      try {
        const result = await contactRequest("summary");
        if (current !== generation || !authorized) return;
        notificationFetchedAt = Date.now();
        const count = Math.max(0, Number(result.new_count) || 0);
        $("contact-alert").hidden = count === 0;
        $("contact-alert").textContent = "● " + (count > 99 ? "99+" : count);
        $("contact-alert").setAttribute(
          "aria-label",
          "未対応のお問い合わせ " + count + "件",
        );
      } catch {
        /* 一覧では取得エラーを表示。通知だけの失敗で画面を遮りません。 */
      } finally {
        notificationBusy = false;
      }
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refreshContactNotification();
        if (!$("admin-cards").hidden) refreshSyncProgress();
      }
    });
    $("user-list").onclick = (event) => {
      const button = event.target.closest("[data-delete-user]");
      if (!button || !authorized || button.disabled) return;
      deletingUser = userRows.get(button.dataset.deleteUser);
      if (!deletingUser) return;
      $("delete-user-label").textContent =
        (deletingUser.nickname || "未設定") +
        " ／ " +
        (deletingUser.album_id || "ID未発行");
      $("delete-user-ack").checked = false;
      $("delete-user-confirm").disabled = true;
      $("delete-user-message").textContent = "";
      $("delete-user-dialog").showModal();
    };
    let deleteBusy = false;
    for (const id of ["delete-user-close", "delete-user-cancel"])
      $(id).onclick = () => {
        if (!deleteBusy) $("delete-user-dialog").close();
      };
    $("delete-user-dialog").addEventListener("cancel", (e) => {
      if (deleteBusy) e.preventDefault();
    });
    $("delete-user-ack").onchange = () => {
      $("delete-user-confirm").disabled =
        deleteBusy || !$("delete-user-ack").checked;
    };
    $("delete-user-confirm").onclick = async () => {
      if (
        !authorized ||
        !deletingUser ||
        !$("delete-user-ack").checked ||
        deleteBusy
      )
        return;
      deleteBusy = true;
      $("delete-user-confirm").disabled = true;
      $("delete-user-message").textContent = "削除中…";
      const current = generation;
      try {
        await contactRequest("delete-user", {
          method: "POST",
          body: { user_id: deletingUser.id, confirmation: "DELETE_ACCOUNT" },
        });
        if (current !== generation || !authorized) return;
        $("delete-user-dialog").close();
        deletingUser = null;
        await loadUsers();
        refreshContactNotification(true);
        message("アカウントと関連情報を削除しました。");
      } catch (error) {
        if (current === generation)
          $("delete-user-message").textContent = errorText(error);
      } finally {
        deleteBusy = false;
        $("delete-user-confirm").disabled = !$("delete-user-ack").checked;
      }
    };
    $("force-sync").onclick = () => {
      if (authorized) {
        $("sync-message").textContent = "";
        $("sync-dialog").showModal();
      }
    };
    $("sync-cancel").onclick = () => $("sync-dialog").close();
    $("sync-confirm").onclick = async () => {
      if (!authorized || $("sync-confirm").disabled) return;
      $("sync-confirm").disabled = true;
      $("sync-message").textContent = "更新を開始しています…";
      const current = generation;
      try {
        const result = await contactRequest("sync", {
          method: "POST",
          body: {},
        });
        if (current !== generation || !authorized) return;
        $("sync-dialog").close();
        syncRequestedUntil = Date.now() + 600000;
        await refreshSyncProgress();
        if (!syncProgressTimer)
          syncProgressTimer = setInterval(() => {
            if (!document.hidden && !$("admin-cards").hidden)
              refreshSyncProgress();
          }, 60000);
        message(
          result.triggered
            ? "公式情報の取得を開始しました。残りは順次更新されます。"
            : "強制更新を予約しました。最大5分後の自動処理で取得を開始します。",
        );
      } catch (error) {
        if (current === generation)
          $("sync-message").textContent = errorText(error);
      } finally {
        $("sync-confirm").disabled = false;
      }
    };
    async function refreshSyncProgress() {
      if (!authorized || syncProgressBusy || $("admin-cards").hidden) return;
      syncProgressBusy = true;
      const current = generation;
      try {
        const { data, error } = await db.rpc("card_admin_sync_progress");
        if (error) throw error;
        if (current !== generation || !authorized || $("admin-cards").hidden)
          return;
        const jobs = data.jobs,
          state = data.state;
        const total = Number(jobs.total) || 0,
          done = Number(jobs.done) || 0,
          failed = Number(jobs.failed) || 0,
          queued = Number(jobs.queued) || 0,
          running = Number(jobs.running) || 0;
        clearInterval(syncProgressTimer);
        syncProgressTimer = null;
        if (queued || running || state.active) syncRequestedUntil = 0;
        if (
          queued ||
          running ||
          state.active ||
          Date.now() < syncRequestedUntil
        ) {
          syncProgressTimer = setInterval(() => {
            if (!document.hidden && !$("admin-cards").hidden)
              refreshSyncProgress();
          }, 60000);
        }
        const percent = total
          ? Math.min(100, ((done + failed) / total) * 100)
          : 0;
        let label = "まだ更新されていません";
        if (total && (queued || running || state.active)) label = "更新中";
        else if (total)
          label = failed ? "取得処理が終了しました（一部失敗）" : "更新完了";
        else if (!state.started_at) label = "取得開始を待っています";
        $("sync-progress-status").textContent =
          label + (total ? " · " + percent.toFixed(1) + "%" : "");
        $("sync-progress-bar").setAttribute("aria-valuenow", String(percent));
        $("sync-progress-bar").querySelector("span").style.width =
          percent + "%";
        $("sync-progress-bar").classList.toggle("has-failures", failed > 0);
        $("sync-progress-counts").innerHTML = [
          ["取得ページ", total],
          ["取得済み", done],
          ["待機中", queued],
          ["処理中", running],
          ["失敗", failed],
        ]
          .map(
            ([label, value]) =>
              `<span>${label}<strong>${value}</strong></span>`,
          )
          .join("");
        $("sync-progress-time").textContent =
          "開始：" +
          timestamp(state.started_at) +
          " ／ 完了：" +
          timestamp(state.finished_at) +
          " ／ 確認：" +
          timestamp(data.measured_at);
      } catch (error) {
        clearInterval(syncProgressTimer);
        syncProgressTimer = null;
        if (current === generation && authorized && !$("admin-cards").hidden)
          $("sync-progress-status").textContent = errorText(error);
      } finally {
        syncProgressBusy = false;
      }
    }
    $("refresh-sync-progress").onclick = refreshSyncProgress;
    function formatBytes(value) {
      const bytes = Number(value);
      if (!Number.isFinite(bytes) || bytes < 0) return "未取得";
      return bytes < 1000000
        ? (bytes / 1000).toFixed(1) + " KB"
        : bytes < 1000000000
          ? (bytes / 1000000).toFixed(2) + " MB"
          : (bytes / 1000000000).toFixed(2) + " GB";
    }
    function metricCard(label, value, note = "") {
      return `<div class="usage-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note ? `<small>${esc(note)}</small>` : ""}</div>`;
    }
    function quotaCard(label, value, limit) {
      if (value === null)
        return metricCard(label, "未取得", "無料枠 " + formatBytes(limit));
      const percent = Math.max(0, (Number(value) / limit) * 100);
      const tone =
        percent >= 90 ? "quota-danger" : percent >= 80 ? "quota-warning" : "";
      return `<div class="usage-metric ${tone}"><span>${esc(label)}</span><strong>${esc(formatBytes(value))}</strong><small>無料枠 ${esc(formatBytes(limit))} ／ ${percent.toFixed(1)}%</small><div class="quota-bar"><i style="width:${Math.min(100, percent)}%"></i></div></div>`;
    }
    function showRegistrationStatus(status) {
      $("registration-state").textContent = status.allowed
        ? "受付中"
        : "新規登録を停止中";
      $("registration-state").classList.toggle("paused", !status.allowed);
    }
    async function loadUsage() {
      if (!authorized || usageBusy) return;
      usageBusy = true;
      const current = generation;
      $("reload-usage").disabled = true;
      message("使用状況を確認中…");
      try {
        const { data, error } =
          usageSnapshot && Date.now() - usageFetchedAt < 60000
            ? { data: usageSnapshot }
            : await db.rpc("card_admin_usage");
        if (error) throw error;
        if (current !== generation || !authorized) return;
        if (data !== usageSnapshot) usageFetchedAt = Date.now();
        usageSnapshot = data;
        const settings = data.settings;
        $("usage-cards").innerHTML =
          quotaCard("DB全体の容量", data.database_bytes, 500000000) +
          quotaCard("ストレージ", data.storage_bytes, 1000000000) +
          metricCard(
            "登録アカウント",
            Number(data.accounts).toLocaleString() + "件",
          ) +
          metricCard("登録カード", Number(data.cards).toLocaleString() + "枚") +
          metricCard(
            "所持記録",
            Number(data.ownership_records).toLocaleString() + "件",
          ) +
          metricCard(
            "DB接続",
            Number(data.connections).toLocaleString() + "件",
          );
        $("usage-measured").textContent =
          "確認日時：" + timestamp(data.measured_at);
        $("registration-enabled").checked = settings.registration_enabled;
        $("registration-message").value = settings.pause_message;
        $("registration-db-limit").value = settings.database_limit_bytes
          ? Math.round(Number(settings.database_limit_bytes) / 1000000)
          : "";
        showRegistrationStatus(data.registration);
        $("usage-tables").innerHTML = (data.tables || [])
          .map(
            (t) =>
              `<tr><td>${esc(t.schema)}.${esc(t.name)}</td><td>${esc(formatBytes(t.bytes))}</td><td>${Number(t.estimated_rows).toLocaleString()}</td></tr>`,
          )
          .join("");
        $("supabase-usage-link").href =
          "https://supabase.com/dashboard/project/" +
          new URL(config.supabaseUrl).hostname.split(".")[0] +
          "/reports";
        message("");
        await loadAutoSyncSettings(current);
        if (!$("traffic-message").textContent)
          $("traffic-message").textContent =
            "通信統計はボタンを押して確認できます。";
      } catch (error) {
        if (current === generation && authorized) message(errorText(error));
      } finally {
        usageBusy = false;
        $("reload-usage").disabled = false;
      }
    }

    function showAutoSyncSettings(data) {
      $("auto-sync-enabled").checked = data.automatic_enabled;
      $("auto-sync-enabled").disabled = false;
      $("auto-sync-message").textContent = data.automatic_enabled
        ? "自動更新は有効です。"
        : "新しい自動更新を停止しています。";
    }
    async function loadAutoSyncSettings(current = generation) {
      try {
        const { data, error } = await db.rpc("card_admin_sync_settings");
        if (error) throw error;
        if (authorized && current === generation) showAutoSyncSettings(data);
      } catch (error) {
        if (authorized && current === generation) {
          $("auto-sync-enabled").disabled = true;
          $("auto-sync-message").textContent = errorText(error);
        }
      }
    }
    $("auto-sync-enabled").onchange = async () => {
      if (!authorized) return;
      const current = generation,
        enabled = $("auto-sync-enabled").checked;
      $("auto-sync-enabled").disabled = true;
      try {
        const { data, error } = await db.rpc("card_admin_set_auto_sync", {
          p_enabled: enabled,
        });
        if (error) throw error;
        if (authorized && current === generation) showAutoSyncSettings(data);
      } catch (error) {
        if (authorized && current === generation) {
          $("auto-sync-enabled").checked = !enabled;
          $("auto-sync-enabled").disabled = false;
          $("auto-sync-message").textContent = errorText(error);
        }
      }
    };
    $("reload-usage-details").onclick = async () => {
      if (!authorized || detailsBusy) return;
      if (Date.now() - detailsFetchedAt < 60000) {
        $("usage-details-message").textContent =
          "直前の確認結果を表示しています。再確認は1分後にできます。";
        return;
      }
      detailsBusy = true;
      $("reload-usage-details").disabled = true;
      const current = generation;
      $("usage-details-message").textContent = "詳しい使用状況を確認中…";
      try {
        const { data, error } = await db.rpc("card_admin_usage_details");
        if (error) throw error;
        if (!authorized || current !== generation) return;
        detailsFetchedAt = Date.now();
        showAutoSyncSettings(data.sync);
        const a = data.accounts,
          o = data.ownership,
          d = data.db_stats || {};
        $("usage-detail-cards").innerHTML =
          metricCard("7日以内の新規登録", a.registered_7d + "件") +
          metricCard("7日以内のログイン", a.signed_in_7d + "人") +
          metricCard("30日以内のログイン", a.signed_in_30d + "人") +
          metricCard("所持カード合計", o.quantity + "枚") +
          metricCard("所持記録のある利用者", o.owners + "人") +
          metricCard(
            "DB接続状態",
            data.sessions.map((s) => s.state + "：" + s.count).join(" ／ "),
          );
        const total = Number(d.blocks_read) + Number(d.blocks_hit);
        $("usage-detail-stats").innerHTML =
          metricCard(
            "DBバッファのヒット率",
            total
              ? ((100 * Number(d.blocks_hit)) / total).toFixed(2) + "%"
              : "未計測",
          ) +
          metricCard(
            "確定トランザクション",
            Number(d.commits || 0).toLocaleString(),
          ) +
          metricCard(
            "ロールバック",
            Number(d.rollbacks || 0).toLocaleString(),
          ) +
          metricCard(
            "デッドロック",
            Number(d.deadlocks || 0).toLocaleString(),
          ) +
          metricCard("一時ファイル書き込み", formatBytes(d.temp_bytes || 0)) +
          metricCard(
            "挿入／更新／削除行",
            [d.rows_inserted, d.rows_updated, d.rows_deleted]
              .map((n) => Number(n || 0).toLocaleString())
              .join(" ／ "),
          );
        $("usage-detail-period").textContent =
          "DB統計はリセット以降の累計です（月間使用量ではありません）。リセット：" +
          timestamp(d.stats_reset);
        $("usage-detail-tables").innerHTML = data.tables
          .map(
            (t) =>
              `<tr><td>${esc(t.schema + "." + t.name)}</td><td>${esc(formatBytes(t.total_bytes))}</td><td>${esc(formatBytes(t.table_bytes))}</td><td>${esc(formatBytes(t.index_bytes))}</td><td>${Number(t.live_rows).toLocaleString()}</td><td>${Number(t.dead_rows).toLocaleString()}</td><td>${esc(timestamp(t.last_autovacuum))}</td></tr>`,
          )
          .join("");
        $("usage-detail-cron").innerHTML =
          (data.cron || [])
            .map(
              (j) =>
                `<p>${esc(j.jobname)} · ${j.active ? "有効" : "停止"} · 実行 ${Number(j.runs)}回 ／ 失敗 ${Number(j.failed)}回 · 最終 ${esc(timestamp(j.latest))}</p>`,
            )
            .join("") || "未取得";
        const h = data.http;
        $("usage-detail-http").innerHTML = h
          ? metricCard("保存済み結果", h.retained + "件") +
            metricCard("HTTP成功", h.success + "件") +
            metricCard("HTTP失敗・時間切れ", h.errors + "件") +
            metricCard(
              "集計期間",
              timestamp(h.oldest) + "〜" + timestamp(h.latest),
            )
          : metricCard("HTTP結果", "未取得");
        $("usage-details-message").textContent =
          "確認日時：" + timestamp(data.measured_at);
      } catch (error) {
        if (authorized && current === generation)
          $("usage-details-message").textContent = errorText(error);
      } finally {
        detailsBusy = false;
        $("reload-usage-details").disabled = false;
      }
    };

    let trafficLoadedAt = 0,
      trafficBusy = false;
    async function loadTraffic(current = generation) {
      if (!authorized || trafficBusy || Date.now() - trafficLoadedAt < 300000)
        return;
      trafficBusy = true;
      $("reload-traffic").disabled = true;
      $("traffic-message").textContent = "通信統計を確認中…";
      $("traffic-totals").replaceChildren();
      $("traffic-chart").replaceChildren();
      try {
        const { data: result, error } = await db.rpc(
          "card_admin_database_traffic",
        );
        if (error) throw error;
        if (current !== generation || !authorized) return;
        if (!result?.database) throw Error("DB統計の応答を確認してください。");
        trafficLoadedAt = Date.now();
        const stats = result.database;
        const number = (value) => (Number(value) || 0).toLocaleString();
        $("traffic-totals").innerHTML =
          metricCard(
            "DBコミット",
            number(stats.commits) + "回",
            "APIリクエスト数とは異なります",
          ) +
          metricCard("DBロールバック", number(stats.rollbacks) + "回") +
          metricCard("現在の接続", number(stats.connections) + "接続") +
          metricCard("更新した行", number(stats.rows_updated) + "行") +
          metricCard("追加した行", number(stats.rows_inserted) + "行") +
          metricCard("削除した行", number(stats.rows_deleted) + "行");
        const http = result.http;
        if (http) {
          $("traffic-totals").innerHTML +=
            metricCard(
              "DB発HTTP・成功",
              number(http.success) + "件",
              "保持されている応答のみ",
            ) +
            metricCard(
              "DB発HTTP・エラー",
              number(http.errors) + "件",
              "保持されている応答のみ",
            );
        }
        $("traffic-message").textContent =
          "取得日時：" +
          timestamp(result.measured_at) +
          (stats.stats_reset
            ? " ／ DB統計の集計開始：" + timestamp(stats.stats_reset)
            : " ／ DB統計の集計開始日時は未取得") +
          (http?.oldest
            ? " ／ HTTP記録：" +
              timestamp(http.oldest) +
              "〜" +
              timestamp(http.latest)
            : "");
        $("traffic-chart").innerHTML = (result.sessions || [])
          .map((row) =>
            metricCard(
              {
                active: "処理中",
                idle: "待機中",
                "idle in transaction": "トランザクション待機",
              }[row.state] || row.state,
              number(row.count) + "接続",
            ),
          )
          .join("");
      } catch (error) {
        if (current === generation && authorized)
          $("traffic-message").textContent = errorText(error);
      } finally {
        trafficBusy = false;
        $("reload-traffic").disabled = false;
      }
    }
    $("reload-traffic").onclick = () => loadTraffic();
    $("reload-usage").onclick = loadUsage;
    $("registration-free-preset").onclick = () => {
      $("registration-db-limit").value = "450";
      $("registration-save-message").textContent =
        "無料枠500MBの90％を停止基準に設定しました。保存すると反映されます。";
    };
    $("registration-controls").onsubmit = async (event) => {
      event.preventDefault();
      if (!authorized || $("registration-save").disabled) return;
      const enabled = $("registration-enabled").checked;
      const text = $("registration-message").value.trim();
      const value = $("registration-db-limit").value;
      const limit = value === "" ? null : Number(value) * 1000000;
      if (
        !text ||
        text.length > 200 ||
        (limit !== null &&
          (!Number.isSafeInteger(limit) ||
            limit < 1000000 ||
            limit > 1099511627776))
      ) {
        $("registration-save-message").textContent =
          "設定値を確認してください。";
        return;
      }
      $("registration-save").disabled = true;
      const current = generation;
      try {
        const { data, error } = await db.rpc("card_admin_set_registration", {
          p_enabled: enabled,
          p_message: text,
          p_database_limit_bytes: limit,
        });
        if (error) throw error;
        if (current !== generation || !authorized) return;
        showRegistrationStatus(data);
        $("registration-save-message").textContent = "設定を保存しました。";
      } catch (error) {
        if (current === generation && authorized)
          $("registration-save-message").textContent = errorText(error);
      } finally {
        $("registration-save").disabled = false;
      }
    };
    async function initializeSession() {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      await checkAccess(data?.session || null);
    }
    await Promise.race([
      initializeSession(),
      new Promise((_, reject) => {
        startupTimer = setTimeout(
          () =>
            reject(
              Error(
                "ログイン状態の復元がタイムアウトしました。「ログイン状態をリセット」で再試行してください。",
              ),
            ),
          25000,
        );
      }),
    ]);
    clearTimeout(startupTimer);
    window.ADMIN_STARTUP?.ready(persistSession);
  } catch (error) {
    clearTimeout(startupTimer);
    window.ADMIN_STARTUP?.fail(error?.message || String(error));
    if (!window.ADMIN_STARTUP)
      document.getElementById("admin-auth-message").textContent =
        "起動できませんでした。" + (error?.message || error);
  }
})();
