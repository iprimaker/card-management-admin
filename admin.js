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
        return "01-schema.sqlの設定を確認してください。詳細：" + detail;
      }
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
    let forceAdminLogin = () => {};
    async function boundedFetch(input, init = {}) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, 20000);
      try {
        const response = await fetch(input, {
          ...init,
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403)
          queueMicrotask(() => forceAdminLogin());
        else if (!response.ok) {
          try {
            const detail = await response.clone().json();
            if (
              detail.code === "42501" ||
              /管理者権限が必要|ログインが必要|認証が必要/.test(
                detail.message || "",
              )
            )
              queueMicrotask(() => forceAdminLogin());
          } catch {}
        }
        return response;
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
          storageKey:
            "card-album-admin-auth:" +
            new URL(config.supabaseUrl).hostname.split(".")[0],
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
      usersRefreshBusy = false;
      clearTimeout(userSearchTimer);
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

      deletingUser = null;
      $("contact-alert").hidden = true;
      baseCards = [];
      pendingEpoch++;
      pendingRows = [];
      pendingLoaded = false;
      pendingFlight = null;
      editingPending = publishingPending = null;
      $("pending-fields").replaceChildren();
      $("pending-note").value = "";
      $("pending-evidence-url").value = "";
      $("pending-evidence-note").value = "";
      $("pending-reason").textContent = "";
      $("pending-target").textContent = "";
      $("pending-message").textContent = "";
      $("pending-confirm-name").textContent = "";
      $("pending-confirm-message").textContent = "";
      announcementRequest++;
      announcementRows.clear();
      announcementEditing = announcementDeleting = null;
      announcementPage = 0;
      $("announcement-list").replaceChildren();
      $("announcement-form").reset();
      $("announcement-delete-name").textContent = "";
      $("announcement-save-message").textContent = "";
      overrides.clear();
      editing = null;
      verseRequest++;
      verseHistoryRequest++;
      verseRows.clear();
      contactRows.clear();
      verseEditing = contactDeleting = null;
      $("verse-admin-list").replaceChildren();
      $("verse-history-list").replaceChildren();
      $("verse-editor-fields").replaceChildren();
      for (const id of ["verse-editor-dialog", "contact-delete-dialog"])
        if ($(id).open) $(id).close();
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
        "pending-dialog",
        "announcement-dialog",
        "announcement-delete-dialog",
        "pending-confirm-dialog",
        "confirm-dialog",
        "delete-user-dialog",
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
      if (!session) {
        requireAdminAction();
        return;
      }
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
          : "このアカウントには管理者権限がありません。管理者権限の移行・設定を確認してください。";
        return;
      }
      $("admin-auth-message").textContent = "";
      authorized = true;
      adminPresenceLoggingOut = false;
      adminPresenceSent = 0;
      recordAdminPresence();
      $("admin-auth").hidden = true;
      $("admin-app").hidden = false;
      $("admin-nav").hidden = false;
      $("admin-account").textContent =
        (session.user.user_metadata?.nickname || "管理者") + "の管理画面";
      cardPage = 1;
      showPage("users");
      refreshContactNotification();
      notificationTimer = null;
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
      if (force) window.PUBLIC_CATALOG_CACHE.invalidate();
      const result = await window.PUBLIC_CATALOG_CACHE.load(db);
      catalogCache = result;
      catalogFetchedAt = Date.now();
      return { result, revision: catalogRevision };
    }
    function invalidateCatalog() {
      window.PUBLIC_CATALOG_CACHE.invalidate();
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
        await refreshSyncProgress();
        message(
          baseCards.length
            ? ""
            : "カードが未登録です。移行またはカード追加SQLを実行してください。",
        );
      } catch (e) {
        if (current === generation && request === cardsRequest && authorized)
          message("読み込めませんでした。" + errorText(e));
      }
    }
    function combined(card) {
      return { ...card, ...(overrides.get(card.id) || {}) };
    }
    function missingCardText(value) {
      const text =
        typeof value === "string" ? value.normalize("NFKC").trim() : "";
      return (
        !text ||
        /^(?:記載なし|未(?:取得|登録|設定|確認)|(?:カード名|キャラクター|曲名|カードコード|コード|AP)(?:未(?:取得|登録|設定|確認)|なし))$/.test(
          text,
        )
      );
    }
    function missingCardFields(card, includeBack = false) {
      const fields = [];
      if (missingCardText(card.name)) fields.push(["name", "カード名"]);
      if (missingCardText(card.code)) fields.push(["code", "カードコード"]);
      if (missingCardText(card.character))
        fields.push(["character", "キャラクター"]);
      if (missingCardText(card.rarity)) fields.push(["rarity", "レアリティ"]);
      if (missingCardText(card.front)) fields.push(["front", "表面画像"]);
      if (
        card.game === "aipri" &&
        (!Array.isArray(card.songs) ||
          !card.songs.some((song) => !missingCardText(song)))
      )
        fields.push(["songs", "曲名"]);
      if (
        card.game === "aikatsu" &&
        !(
          typeof card.ap === "number" &&
          Number.isInteger(card.ap) &&
          card.ap >= 0
        )
      )
        fields.push(["ap", "AP"]);
      if (includeBack && missingCardText(card.back))
        fields.push(["back", "裏面画像"]);
      return fields;
    }
    function matchesMissingCardFilter(card, mode) {
      if (!mode || mode === "all") return true;
      const missing = missingCardFields(card, mode === "back");
      return mode === "missing"
        ? missing.length > 0
        : missing.some(([key]) => key === mode);
    }
    function missingCardBadge(card) {
      const missing = missingCardFields(
        card,
        $("admin-missing")?.value === "back",
      );
      return missing.length
        ? `<span class="missing-fields-badge">未登録：${esc(missing.map(([, label]) => label).join("・"))}</span>`
        : "";
    }

    function cardResults() {
      const query = $("admin-query")
          .value.normalize("NFKC")
          .toLowerCase()
          .trim(),
        game = $("admin-game").value,
        missingMode = $("admin-missing").value;
      const state = $("admin-state").value;
      const registered = state === "pending" ? [] : baseCards.map(combined);
      const drafts =
        state === "registered"
          ? []
          : pendingRows
              .filter((row) => isUnregisteredCandidate(row.card))
              .map((row) => ({ ...row.card, _pendingId: row.id }));
      return [...registered, ...drafts].filter(
        (c) =>
          (!game || c.game === game) &&
          matchesMissingCardFilter(c, missingMode) &&
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
            `<article class="admin-card">${c.front ? `<img src="${esc(c.front)}" alt="${esc(c.name || c.code)}" loading="lazy">` : '<div class="pending-no-image">画像未登録</div>'}<p class="muted">${esc(c.code)} · ${esc(c.rarity)}</p><p>${esc(c.name || "カード名未設定")}</p>${overrides.has(c.id) ? '<span class="override-badge">修正を適用中</span>' : ""}${missingCardBadge(c)}${c._pendingId ? `<span class="pending-badge">SQL保留・根拠確認待ち</span><button data-pending-edit="${esc(c._pendingId)}">編集・正式登録</button>` : `<button data-edit="${esc(c.id)}">情報を編集</button>`}</article>`,
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
    let adminPresenceLoggingOut = false,
      adminPresencePending = Promise.resolve(),
      adminPresenceSent = 0;
    function recordAdminPresence(logout = false) {
      if (
        !session ||
        (!logout &&
          (document.hidden ||
            adminPresenceLoggingOut ||
            Date.now() - adminPresenceSent < 40000))
      )
        return Promise.resolve();
      const uid = session.user.id;
      adminPresenceSent = Date.now();
      adminPresencePending = adminPresencePending
        .catch(() => {})
        .then(async () => {
          if (
            (session && session.user.id !== uid) ||
            (!logout && (!session || adminPresenceLoggingOut))
          )
            return;
          const controller = new AbortController(),
            timer = setTimeout(() => controller.abort(), 4000);
          try {
            let request = db.rpc("card_account_presence_touch", {
              p_logout: logout,
              p_all: false,
            });
            if (typeof request.abortSignal === "function")
              request = request.abortSignal(controller.signal);
            const r = await request;
            if (r.error) adminPresenceSent = 0;
          } catch {
            adminPresenceSent = 0;
          } finally {
            clearTimeout(timer);
          }
        });
      return adminPresencePending;
    }
    setInterval(() => {
      if (authorized) recordAdminPresence();
    }, 45000);
    document.addEventListener("visibilitychange", () => {
      if (authorized && !document.hidden) recordAdminPresence();
    });
    async function recordAdminConfirmedLogout(previous) {
      if (!previous?.access_token) return;
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 3000);
      try {
        await boundedFetch(
          new URL(
            "/rest/v1/rpc/card_account_presence_touch",
            config.supabaseUrl,
          ).href,
          {
            method: "POST",
            headers: {
              apikey: config.supabaseKey,
              Authorization: "Bearer " + previous.access_token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ p_logout: true, p_all: false }),
            signal: controller.signal,
            cache: "no-store",
          },
        );
      } catch {
      } finally {
        clearTimeout(timer);
      }
    }
    let userState = "all",
      userShare = "all",
      userQuery = "",
      userSort = "newest",
      usersTotal = 0,
      usersRefreshBusy = false,
      userSearchTimer,
      usersCheckedAt = null;
    const stateLabels = {
      online: "ログイン中",
      offline: "ログアウト中",
      unknown: "状態不明",
    };
    function accountStatusDot(status) {
      const state = status in stateLabels ? status : "unknown";
      return (
        '<span class="account-status-dot is-' +
        state +
        '" aria-hidden="true"></span>'
      );
    }
    function userArgs(include = true) {
      return {
        p_offset: (userPage - 1) * 100,
        p_limit: 100,
        p_status: userState,
        p_share: userShare,
        p_query: userQuery,
        p_sort: userSort,
        p_include_ownership: include,
      };
    }
    function userKey() {
      return [
        generation,
        userPage,
        userState,
        userQuery,
        userSort,
        userShare,
      ].join("|");
    }
    function dateCell(value) {
      if (!value || !Number.isFinite(Date.parse(value))) return "—";
      const date = new Date(value);
      return (
        "<span>" +
        esc(date.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })) +
        "</span><small>" +
        esc(
          date.toLocaleTimeString("ja-JP", {
            timeZone: "Asia/Tokyo",
            hour: "2-digit",
            minute: "2-digit",
          }),
        ) +
        "</small>"
      );
    }
    function userShareCell(u) {
      if (!u.has_share_link)
        return '<span class="user-share-state is-none">未発行</span>';
      const scopes = Array.isArray(u.share_scopes) ? u.share_scopes : [];
      const labels = {
        aikatsu: "アイカツ",
        onegai: "おねがい",
        himitsu: "ひみつ",
        "verse-onegai": "おねがいバース",
        "verse-himitsu": "ひみつバース",
      };
      const status = scopes.length
        ? "公開 " + scopes.length + "種類"
        : "全て非公開";
      const badge =
        '<span class="user-share-state ' +
        (scopes.length ? "is-public" : "is-private") +
        '" title="' +
        esc(scopes.map((s) => labels[s] || s).join("・")) +
        '">発行済み · ' +
        status +
        "</span>";
      if (!/^[0-9a-f]{64}$/.test(u.share_token || ""))
        return (
          badge +
          '<small class="user-share-note">以前のURLは再表示できません</small>'
        );
      const url = new URL(
        "share/",
        "https://iprimaker.github.io/card-management/",
      );
      url.hash = u.share_token;
      return (
        badge +
        '<a class="user-share-link" href="' +
        esc(url.href) +
        '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" title="' +
        esc(url.href) +
        '">共有アルバムを開く ↗</a>'
      );
    }
    function paintUsers() {
      const opened = new Set(
        [...$("user-list").querySelectorAll("details[open]")].map(
          (d) => d.dataset.userDetail,
        ),
      );
      $("user-list").innerHTML =
        [...userRows.values()]
          .map((u) => {
            const state =
                u.presence_status in stateLabels
                  ? u.presence_status
                  : "unknown",
              n = (k) => Number(u[k]) || 0,
              cardTotal = [
                "aikatsu_count",
                "onegai_count",
                "himitsu_count",
                "other_count",
              ].reduce((a, k) => a + n(k), 0),
              verseTotal =
                n("verse_onegai_coordinates") + n("verse_himitsu_coordinates");
            return `<tr><td class="account-status-cell"><span class="account-state is-${state}" title="${esc("直近の画面通信：" + timestamp(u.presence_seen_at) + " ／ 明示的ログアウト：" + timestamp(u.presence_logout_at))}">${accountStatusDot(state)}${stateLabels[state]}</span></td><td class="user-identity"><strong>${esc(u.nickname || "未設定")}</strong><span class="album-id-cell">${esc(u.album_id || "未発行")}</span></td><td class="user-date">${dateCell(u.created_at)}</td><td class="user-date">${dateCell(u.last_sign_in_at)}</td><td class="inactive-days">${u.inactive_days != null && Number.isFinite(Number(u.inactive_days)) ? Math.max(0, Number(u.inactive_days)) + "日" : "—"}</td><td class="ownership-detail ownership-compact"><div class="user-owned-summary"><strong>カード ${cardTotal.toLocaleString()}枚</strong><span>バース ${verseTotal.toLocaleString()}コーデ</span></div><details data-user-detail="${esc(u.id)}" ${opened.has(u.id) ? "open" : ""}><summary>所持数の内訳</summary><div class="user-owned-breakdown"><span>アイカツ <b>${n("aikatsu_count")}枚</b></span><span>おねがい <b>${n("onegai_count")}枚</b></span><span>ひみつ <b>${n("himitsu_count")}枚</b></span>${n("other_count") ? "<span>その他 <b>" + n("other_count") + "枚</b></span>" : ""}<span>おねがいバース <b>${n("verse_onegai_coordinates")}コーデ ／ ${n("verse_onegai_parts")}枚（パーツ）</b></span><span>ひみつバース <b>${n("verse_himitsu_coordinates")}コーデ ／ ${n("verse_himitsu_parts")}枚（パーツ）</b></span></div></details></td><td class="user-share-cell">${userShareCell(u)}</td><td><button class="danger compact-button" data-delete-user="${esc(u.id)}" ${u.id === session?.user.id ? "disabled" : ""}>強制削除</button></td></tr>`;
          })
          .join("") ||
        '<tr><td colspan="8" class="user-empty">条件に一致する登録者はいません。</td></tr>';
      $("user-page").textContent = usersTotal
        ? (userPage - 1) * 100 +
          1 +
          "〜" +
          Math.min(userPage * 100, usersTotal) +
          " / " +
          usersTotal +
          "人"
        : "0人";
      $("user-prev").disabled = userPage <= 1;
      $("user-next").disabled = userPage * 100 >= usersTotal;
      $("user-result-count").textContent =
        "該当 " + usersTotal.toLocaleString() + "人";
    }
    function applyUserMeta(data) {
      usersTotal = Number(data.total) || 0;
      for (const button of document.querySelectorAll("[data-user-state]")) {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.userState === userState),
        );
        button.querySelector("b").textContent = Number(
          data.counts?.[button.dataset.userState] || 0,
        ).toLocaleString();
      }
      usersCheckedAt = data.checked_at;
      $("users-checked-at").textContent =
        ($("users-auto-refresh").checked
          ? "状態確認："
          : "自動更新停止中・前回確認：") + timestamp(usersCheckedAt);
    }
    function markUsersStale() {
      userRows.forEach((u) => (u.presence_status = "unknown"));
      paintUsers();
      document
        .querySelectorAll("[data-user-state] b")
        .forEach((e) => (e.textContent = "—"));
      $("users-checked-at").textContent =
        "状態を再確認できません。更新してください。";
    }
    async function loadUsersUnsafe() {
      if (!authorized) return;
      const key = userKey(),
        request = ++usersRequest;
      message("登録者を読み込み中…");
      const { data, error } = await db.rpc(
        "card_admin_users_shared_filtered",
        userArgs(),
      );
      if (!authorized || key !== userKey() || request !== usersRequest) return;
      if (error || !Array.isArray(data?.users)) {
        markUsersStale();
        message(error ? errorText(error) : "登録者の形式を確認してください。");
        return;
      }
      if (data.total === 0) userPage = 1;
      if (userPage > 1 && data.users.length === 0 && data.total > 0) {
        userPage = Math.max(1, Math.ceil(data.total / 100));
        return loadUsersUnsafe();
      }
      userRows = new Map(data.users.map((u) => [u.id, u]));
      applyUserMeta(data);
      paintUsers();
      message("");
    }
    async function refreshAccountStatus() {
      if (
        usersRefreshBusy ||
        !authorized ||
        document.hidden ||
        $("admin-users").hidden ||
        !$("users-auto-refresh").checked
      )
        return;
      usersRefreshBusy = true;
      const key = userKey(),
        request = usersRequest;
      try {
        const { data, error } = await db.rpc(
          "card_admin_users_shared_filtered",
          userArgs(false),
        );
        if (!authorized || key !== userKey() || request !== usersRequest)
          return;
        if (error || !Array.isArray(data?.users)) throw Error();
        if (
          data.users.map((u) => u.id).join("|") !==
          [...userRows.keys()].join("|")
        ) {
          await loadUsersUnsafe();
          return;
        }
        data.users.forEach((u) =>
          userRows.set(u.id, { ...userRows.get(u.id), ...u }),
        );
        applyUserMeta(data);
        paintUsers();
      } catch {
        if (authorized && key === userKey() && request === usersRequest)
          markUsersStale();
      } finally {
        usersRefreshBusy = false;
      }
    }
    setInterval(() => refreshAccountStatus(), 30000);
    document.querySelectorAll("[data-user-state]").forEach(
      (button) =>
        (button.onclick = () => {
          userState = button.dataset.userState;
          userPage = 1;
          loadUsers();
        }),
    );
    $("user-search").oninput = () => {
      clearTimeout(userSearchTimer);
      userQuery = $("user-search").value.normalize("NFKC").trim();
      userPage = 1;
      usersRequest++;
      userSearchTimer = setTimeout(() => loadUsers(), 300);
    };
    $("users-auto-refresh").onchange = () => {
      if ($("users-auto-refresh").checked) refreshAccountStatus();
      else
        $("users-checked-at").textContent =
          "自動更新停止中・前回確認：" + timestamp(usersCheckedAt);
    };
    $("user-sort").onchange = () => {
      userSort = $("user-sort").value;
      userPage = 1;
      loadUsers();
    };
    $("user-share-filter").onchange = () => {
      userShare = $("user-share-filter").value;
      userPage = 1;
      loadUsers();
    };
    $("user-filter-reset").onclick = () => {
      clearTimeout(userSearchTimer);
      userState = "all";
      userShare = "all";
      $("user-share-filter").value = "all";
      userQuery = "";
      userSort = "newest";
      userPage = 1;
      $("user-search").value = "";
      $("user-sort").value = "newest";
      loadUsers();
    };
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
        .map((row) => {
          const fields = [
            ...new Set([
              ...Object.keys(row.before_patch || {}),
              ...Object.keys(row.after_patch || {}),
            ]),
          ].filter(
            (k) =>
              JSON.stringify(row.before_patch?.[k]) !==
              JSON.stringify(row.after_patch?.[k]),
          );
          return `<details class="compact-history"><summary><span class="history-action">${{ DELETE: "解除", INSERT: "追加", UPDATE: "更新" }[row.action] || esc(row.action)}</span><strong>${esc(row.card_id)}</strong><small>${esc(timestamp(row.created_at))}</small></summary><p class="muted">変更項目：${esc(fields.map((k) => labels[k] || k).join("、"))}</p></details>`;
        })
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
    let importPage = 1,
      importCardPage = 1,
      selectedImportBatch = null;
    let importOnlyNew = true,
      importHistoryRequest = 0,
      importCardsRequest = 0;
    let importBatches = [];
    const importPageSize = 20;

    async function loadImports() {
      if (!authorized) return;
      const current = generation,
        request = ++importHistoryRequest;
      $("import-message").textContent = "追加履歴を確認中…";
      try {
        const { data, error } = await db.rpc("card_admin_import_history", {
          p_offset: (importPage - 1) * importPageSize,
          p_limit: importPageSize,
        });
        if (error) throw error;
        if (
          !authorized ||
          current !== generation ||
          request !== importHistoryRequest
        )
          return;
        importBatches = data?.batches || [];
        const total = Number(data?.total) || 0;
        $("import-batches").innerHTML = importBatches
          .map(
            (batch) => `
          <button type="button" class="import-batch" data-import-batch="${esc(batch.id)}" aria-pressed="false">
            <strong>${esc(batch.record_kind === "baseline" ? "記録開始時点" : timestamp(batch.recorded_at))}</strong>
            <span>${batch.record_kind === "baseline" ? `既存カード ${Number(batch.baseline_count) || 0}枚` : `新規 ${Number(batch.added_count) || 0}枚 · 更新 ${Number(batch.updated_count) || 0}枚${Number(batch.deleted_count) ? ` · 削除 ${Number(batch.deleted_count)}枚` : ""}`}</span>
          </button>`,
          )
          .join("");
        $("import-page").textContent =
          `${importPage} / ${Math.max(1, Math.ceil(total / importPageSize))}`;
        $("import-prev").disabled = importPage <= 1;
        $("import-next").disabled = importPage * importPageSize >= total;
        $("import-message").textContent = total
          ? ""
          : "追加履歴はまだありません。";
        if (
          !importBatches.some(
            (batch) => String(batch.id) === selectedImportBatch,
          )
        ) {
          selectedImportBatch = importBatches.length
            ? String(importBatches[0].id)
            : null;
          importCardPage = 1;
        }
        if (selectedImportBatch) await loadImportCards();
        else $("import-card-list").innerHTML = "";
      } catch (error) {
        if (
          authorized &&
          current === generation &&
          request === importHistoryRequest
        )
          $("import-message").textContent = /PGRST202|42883/.test(
            error?.code || "",
          )
            ? "同梱の01-import-history.sqlを先に実行してください。"
            : "履歴を取得できませんでした。" + errorText(error);
      }
    }

    async function loadImportCards() {
      if (!authorized || !selectedImportBatch) return;
      const current = generation,
        request = ++importCardsRequest;
      const batchID = selectedImportBatch,
        onlyNew = importOnlyNew;
      $("import-card-message").textContent = "カードを確認中…";
      $("import-card-list").innerHTML = "";
      document
        .querySelectorAll("[data-import-batch]")
        .forEach((button) =>
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.importBatch === batchID),
          ),
        );
      document
        .querySelectorAll("[data-import-mode]")
        .forEach((button) =>
          button.setAttribute(
            "aria-pressed",
            String((button.dataset.importMode === "new") === onlyNew),
          ),
        );
      try {
        const { data, error } = await db.rpc("card_admin_import_cards", {
          p_batch_id: batchID,
          p_offset: (importCardPage - 1) * pageSize,
          p_limit: pageSize,
          p_only_new: onlyNew,
        });
        if (error) throw error;
        if (
          !authorized ||
          current !== generation ||
          request !== importCardsRequest ||
          batchID !== selectedImportBatch
        )
          return;
        const batch = data?.batch,
          rows = data?.cards || [],
          total = Number(data?.total) || 0;
        $("import-selected-title").textContent =
          batch?.record_kind === "baseline"
            ? "記録開始前のカード"
            : batch
              ? timestamp(batch.recorded_at)
              : "追加履歴";
        $("import-card-count").textContent =
          `${onlyNew ? "新規追加" : "変更カード"} ${total}枚`;
        $("import-card-message").textContent =
          batch?.record_kind === "baseline"
            ? "この時点の既存カード数のみを記録しています。過去の追加日・実行履歴は復元していません。"
            : rows.length
              ? ""
              : onlyNew
                ? "この回の新規追加カードはありません。全変更で更新カードを確認できます。"
                : "この回のカード情報はありません。";
        $("import-card-list").innerHTML = rows
          .map(
            (card) => `
          <article class="admin-card import-card">
            ${card.front ? `<img src="${esc(card.front)}" alt="${esc(card.name || card.code)}" loading="lazy">` : ""}
            <span class="import-operation operation-${esc(card.operation.toLowerCase())}">${{ INSERT: "新規追加", UPDATE: "更新", DELETE: "削除" }[card.operation] || "変更"}</span>
            <p class="muted">${esc(card.code || card.card_id)} · ${esc(card.rarity || "記載なし")}</p>
            <p>${esc(card.name || "カード名未設定")}</p>
            ${card.operation === "UPDATE" ? `<small class="muted">変更：${esc((card.changed_fields || []).map((key) => labels[key] || { ap: "AP", coordinateDefinitions: "コーデ構成" }[key] || key).join("・"))}</small>` : ""}
            ${card.operation !== "DELETE" ? `<button type="button" data-import-edit="${esc(card.card_id)}">現在の情報を確認・編集</button>` : ""}
          </article>`,
          )
          .join("");
        $("import-card-page").textContent =
          `${importCardPage} / ${Math.max(1, Math.ceil(total / pageSize))}`;
        $("import-card-prev").disabled = importCardPage <= 1;
        $("import-card-next").disabled = importCardPage * pageSize >= total;
      } catch (error) {
        if (
          authorized &&
          current === generation &&
          request === importCardsRequest
        )
          $("import-card-message").textContent =
            "カードを取得できませんでした。" + errorText(error);
      }
    }

    $("reload-imports").onclick = () => loadImports();
    $("import-batches").onclick = (event) => {
      const button = event.target.closest("[data-import-batch]");
      if (!button || button.dataset.importBatch === selectedImportBatch) return;
      selectedImportBatch = button.dataset.importBatch;
      importCardPage = 1;
      loadImportCards();
    };
    document.querySelectorAll("[data-import-mode]").forEach(
      (button) =>
        (button.onclick = () => {
          const onlyNew = button.dataset.importMode === "new";
          if (onlyNew === importOnlyNew) return;
          importOnlyNew = onlyNew;
          importCardPage = 1;
          loadImportCards();
        }),
    );
    $("import-prev").onclick = () => {
      if (importPage > 1) {
        importPage--;
        loadImports();
      }
    };
    $("import-next").onclick = () => {
      importPage++;
      loadImports();
    };
    $("import-card-prev").onclick = () => {
      if (importCardPage > 1) {
        importCardPage--;
        loadImportCards();
      }
    };
    $("import-card-next").onclick = () => {
      importCardPage++;
      loadImportCards();
    };
    $("import-card-list").onclick = async (event) => {
      const button = event.target.closest("[data-import-edit]");
      if (!button || !authorized) return;
      const id = button.dataset.importEdit,
        current = generation;
      try {
        if (!baseCards.some((card) => card.id === id)) {
          const { result } = await getCatalog(true);
          if (!authorized || current !== generation) return;
          baseCards = result.cards.filter(
            (card) => card && typeof card.id === "string",
          );
          overrides = new Map(
            result.overrides.map((row) => [row.card_id, row.patch]),
          );
        }
        if (!baseCards.some((card) => card.id === id)) {
          $("import-card-message").textContent =
            "現在のカードDBには存在しません。削除済みの可能性があります。";
          return;
        }
        openEditor(id);
      } catch (error) {
        if (authorized && current === generation)
          $("import-card-message").textContent =
            "カードを確認できませんでした。" + errorText(error);
      }
    };

    function isUnregisteredCandidate(card) {
      if (card._review?.kind === "metadata") return false;
      const code = String(card.code || "")
        .trim()
        .toUpperCase();
      const generic =
        !code ||
        [
          "SP",
          "SPECIAL",
          "PROMO",
          "記載なし",
          "未取得",
          "未確認",
          "未登録",
        ].includes(code);
      return !baseCards.some((base) => {
        const current = combined(base);
        if (current.game !== card.game) return false;
        return (
          current.id === card.id ||
          current.id === card._review?.target_id ||
          current.id === card._review?.formal_id ||
          (card.front &&
            (current.front === card.front || base.front === card.front)) ||
          (!generic &&
            String(current.code || "")
              .trim()
              .toUpperCase() === code)
        );
      });
    }
    let pendingRows = [],
      pendingLoaded = false,
      pendingFlight = null,
      pendingEpoch = 0;
    let editingPending = null,
      pendingBusy = false,
      publishingPending = null;
    const draftFields = [
      "name",
      "code",
      "rarity",
      "character",
      "series",
      "songs",
      "type",
      "category",
      "brand",
      "front",
      "back",
      "source",
      "distribution",
      "variant",
      "ap",
    ];
    const draftLabels = {
      ...labels,
      source: "確認元URL",
      distribution: "配布・入手方法",
      ap: "AP",
    };
    async function loadPending(force = false) {
      if (!authorized || (!force && pendingLoaded)) return;
      if (pendingFlight) return pendingFlight;
      const current = generation,
        epoch = pendingEpoch;
      const flight = (async () => {
        const rows = [];
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await db.rpc("card_admin_pending_cards", {
            p_offset: offset,
            p_limit: 500,
          });
          if (error) throw error;
          if (!authorized || current !== generation || epoch !== pendingEpoch)
            return;
          const batch = data?.cards;
          if (!Array.isArray(batch))
            throw new Error("保留カードの取得結果を確認してください。");
          rows.push(...batch);
          if (batch.length < 500) break;
        }
        if (!authorized || current !== generation || epoch !== pendingEpoch)
          return;
        pendingRows = rows;
        pendingLoaded = true;
        renderCards();
      })();
      pendingFlight = flight;
      try {
        await flight;
      } catch (error) {
        if (authorized && current === generation)
          message(
            "保留カードを取得できませんでした。01-pending-cards.sqlの実行を確認してください。 " +
              errorText(error),
          );
      } finally {
        if (pendingFlight === flight) pendingFlight = null;
      }
    }
    function openPending(id = null) {
      if (!authorized || pendingBusy) return;
      const row = id ? pendingRows.find((r) => r.id === id) : null;
      if (id && (!row || !isUnregisteredCandidate(row.card))) {
        message(
          "このカードは登録済みか整理済みです。登録済み一覧から確認してください。",
        );
        return;
      }
      editingPending = row || {
        id: null,
        card: { game: "aipri", family: "おねがい" },
        note: "",
      };
      const card = editingPending.card;
      const review = card._review || { kind: "new_card" };
      $("pending-reason").textContent =
        review.reason ||
        editingPending.note ||
        "SQL作成時に根拠不足で追加を見送ったカード候補";
      $("pending-target").textContent =
        review.kind === "metadata"
          ? "登録済みカードの項目補完（保留対象外）"
          : "カード本体が未登録・人間による確認が必要";
      $("pending-evidence-url").value = review.evidence_url || "";
      $("pending-evidence-note").value = review.evidence_note || "";
      $("pending-incomplete").checked = false;
      $("pending-title").textContent = id
        ? "SQL保留候補を確認"
        : "SQL保留候補を追加";
      $("pending-game").value = card.game || "aipri";
      $("pending-family").value = card.family || "おねがい";
      $("pending-fields").innerHTML = draftFields
        .map((key) => {
          const value = Array.isArray(card[key])
            ? card[key].join("\n")
            : (card[key] ?? "");
          return `<label>${esc(draftLabels[key] || key)}${arrayFields.has(key) ? '<textarea rows="2"' : `<input ${key === "ap" ? 'type="number" min="0" max="9999999" step="1"' : 'type="text"'}`} data-pending-field="${key}" maxlength="2000" ${arrayFields.has(key) ? "" : `value="${esc(value)}"`}>${arrayFields.has(key) ? esc(value) + "</textarea>" : ""}${arrayFields.has(key) ? "<small>複数ある場合は改行で分けて入力</small>" : ""}</label>`;
        })
        .join("");
      if (review.kind === "metadata") {
        $("pending-game").disabled = $("pending-family").disabled = true;
        for (const input of $("pending-fields").querySelectorAll(
          "[data-pending-field]",
        ))
          input.disabled = !review.fields.includes(input.dataset.pendingField);
      } else $("pending-game").disabled = $("pending-family").disabled = false;
      $("pending-note").value = editingPending.note || "";
      $("pending-incomplete").checked = false;
      $("pending-message").textContent = "";
      $("pending-dialog").showModal();
    }
    async function savePending() {
      if (!authorized || !editingPending || pendingBusy) return null;
      const current = generation;
      const card = { ...editingPending.card, game: $("pending-game").value };
      card._review = {
        ...(card._review || { kind: "new_card" }),
        evidence_url: $("pending-evidence-url").value.trim(),
        evidence_note: $("pending-evidence-note").value.trim(),
        evidence_confirmed: $("pending-incomplete").checked,
      };
      if (card.game === "aipri") card.family = $("pending-family").value;
      else delete card.family;
      for (const input of $("pending-fields").querySelectorAll(
        "[data-pending-field]",
      )) {
        const key = input.dataset.pendingField,
          value = input.value.trim();
        if (
          card._review.kind === "metadata" &&
          !card._review.fields?.includes(key)
        )
          continue;
        if (arrayFields.has(key))
          card[key] = [
            ...new Set(
              value
                .split("\n")
                .map((v) => v.trim())
                .filter(Boolean),
            ),
          ];
        else if (key === "ap") {
          if (
            value &&
            (!Number.isInteger(Number(value)) ||
              Number(value) < 0 ||
              Number(value) > 9999999)
          ) {
            $("pending-message").textContent =
              "APは0〜9999999の整数で入力してください。";
            return null;
          }
          card.ap = value === "" ? null : Number(value);
        } else card[key] = value;
      }
      pendingBusy = true;
      $("pending-save").disabled = $("pending-publish").disabled = true;
      $("pending-message").textContent = "保存しています…";
      try {
        const { data, error } = await db.rpc("card_admin_save_pending", {
          p_id: editingPending.id,
          p_card: card,
          p_note: $("pending-note").value.trim(),
        });
        if (error) throw error;
        if (!authorized || current !== generation) return null;
        const row = {
          id: data.id,
          card: data.card,
          note: $("pending-note").value.trim(),
        };
        pendingEpoch++;
        pendingLoaded = false;
        pendingRows = [...pendingRows.filter((r) => r.id !== row.id), row];
        editingPending = row;
        renderCards();
        $("pending-message").textContent =
          "保留保存しました。一般側には表示されません。";
        return row.id;
      } catch (error) {
        if (authorized && current === generation)
          $("pending-message").textContent = errorText(error);
        return null;
      } finally {
        pendingBusy = false;
        $("pending-save").disabled = $("pending-publish").disabled = false;
      }
    }
    $("pending-new").onclick = () => openPending();
    $("pending-refresh").onclick = () => loadPending(true);
    $("admin-state").onchange = async () => {
      cardPage = 1;
      if ($("admin-state").value !== "registered") await loadPending();
      renderCards();
    };
    $("pending-form").onsubmit = async (event) => {
      event.preventDefault();
      await savePending();
    };
    $("pending-close").onclick = () => {
      if (!pendingBusy) $("pending-dialog").close();
    };
    $("pending-dialog").addEventListener("cancel", (event) => {
      if (pendingBusy) event.preventDefault();
    });
    $("pending-publish").onclick = async () => {
      const id = await savePending();
      if (!id || !authorized) return;
      publishingPending = { id, allow: false };
      $("pending-confirm-name").textContent =
        editingPending.card.name ||
        editingPending.card.code ||
        "名称未設定のカード";
      $("pending-confirm-title").textContent =
        "確認した未登録カードを正式登録しますか？";
      $("pending-confirm-message").textContent = "";
      $("pending-confirm-dialog").showModal();
    };
    $("pending-confirm-cancel").onclick = () => {
      if (!pendingBusy) $("pending-confirm-dialog").close();
    };
    $("pending-confirm-dialog").addEventListener("cancel", (event) => {
      if (pendingBusy) event.preventDefault();
    });
    $("pending-confirm-register").onclick = async () => {
      if (!publishingPending || !authorized || pendingBusy) return;
      const current = generation,
        target = publishingPending;
      pendingBusy = true;
      $("pending-confirm-register").disabled = true;
      try {
        const { data, error } = await db.rpc("card_admin_publish_pending", {
          p_id: target.id,
          p_allow_incomplete: target.allow,
        });
        if (error) throw error;
        if (!authorized || current !== generation) return;
        pendingEpoch++;
        pendingRows = pendingRows.filter((r) => r.id !== target.id);
        pendingLoaded = false;
        $("pending-confirm-dialog").close();
        $("pending-dialog").close();
        invalidateCatalog();
        renderCards();
        await loadCards(true);
        message("根拠を確認した内容を登録しました：" + data);
      } catch (error) {
        if (authorized && current === generation)
          $("pending-confirm-message").textContent = errorText(error);
      } finally {
        pendingBusy = false;
        $("pending-confirm-register").disabled = false;
      }
    };

    let announcementKind = "notice";
    let announcementRows = new Map(),
      announcementPage = 0,
      announcementRequest = 0;
    let announcementEditing = null,
      announcementDeleting = null,
      announcementBusy = false;
    async function loadAnnouncements() {
      if (!authorized) return;
      const current = generation,
        request = ++announcementRequest;
      $("announcement-message").textContent = "読み込んでいます…";
      try {
        const { data, error } = await db
          .from("card_announcements")
          .select("*")
          .eq("kind", announcementKind)
          .order("posted_at", { ascending: false })
          .order("id", { ascending: false })
          .range(announcementPage * 20, announcementPage * 20 + 20);
        if (error) throw error;
        if (
          !authorized ||
          current !== generation ||
          request !== announcementRequest
        )
          return;
        announcementRows = new Map(
          (data || []).slice(0, 20).map((row) => [row.id, row]),
        );
        $("announcement-list").innerHTML = [...announcementRows.values()]
          .map(
            (row) =>
              `<article class="announcement-admin-card"><div class="announcement-admin-meta"><span class="announcement-kind ${row.kind}">${row.kind === "notice" ? "お知らせ" : "更新情報"}</span>${row.important ? '<span class="important-tag">重要</span>' : ""}<span class="announcement-state ${row.published ? "published" : "draft"}">${row.published ? "公開中" : "非公開"}</span><time>${esc(timestamp(row.posted_at))}</time></div><h2>${esc(row.title)}</h2><p>${esc(row.body)}</p><div class="editor-actions"><button type="button" data-announcement-edit="${esc(row.id)}">編集</button><button type="button" class="danger" data-announcement-delete="${esc(row.id)}">削除</button></div></article>`,
          )
          .join("");
        $("announcement-message").textContent = announcementRows.size
          ? ""
          : "まだ登録されていません。";
        $("announcement-prev").disabled = announcementPage === 0;
        $("announcement-next").disabled = (data || []).length <= 20;
      } catch (error) {
        if (
          authorized &&
          current === generation &&
          request === announcementRequest
        )
          $("announcement-message").textContent = errorText(error);
      }
    }
    function editAnnouncement(id = null) {
      if (!authorized || announcementBusy) return;
      const row = id ? announcementRows.get(id) : null;
      if (id && !row) return;
      announcementEditing = row || null;
      $("announcement-editor-title").textContent = row
        ? "掲載情報を編集"
        : "掲載情報を追加";
      $("announcement-kind").value = row?.kind || announcementKind;
      $("announcement-title").value = row?.title || "";
      $("announcement-body").value = row?.body || "";
      $("announcement-posted-at").value = jstInput(
        row?.posted_at || new Date(),
      );
      $("announcement-published").checked = row?.published ?? true;
      $("announcement-important").checked = row?.important ?? false;
      $("announcement-save-message").textContent = "";
      $("announcement-dialog").showModal();
    }
    document.querySelectorAll("[data-announcement-kind]").forEach(
      (button) =>
        (button.onclick = () => {
          announcementKind = button.dataset.announcementKind;
          announcementPage = 0;
          document
            .querySelectorAll("[data-announcement-kind]")
            .forEach((b) =>
              b.setAttribute("aria-pressed", String(b === button)),
            );
          loadAnnouncements();
        }),
    );
    $("announcement-add").onclick = () => editAnnouncement();
    $("announcement-refresh").onclick = () => loadAnnouncements();
    $("announcement-prev").onclick = () => {
      announcementPage = Math.max(0, announcementPage - 1);
      loadAnnouncements();
    };
    $("announcement-next").onclick = () => {
      announcementPage++;
      loadAnnouncements();
    };
    $("announcement-close").onclick = () => {
      if (!announcementBusy) $("announcement-dialog").close();
    };
    $("announcement-dialog").addEventListener("cancel", (event) => {
      if (announcementBusy) event.preventDefault();
    });
    $("announcement-delete-dialog").addEventListener("cancel", (event) => {
      if (announcementBusy) event.preventDefault();
    });
    $("announcement-form").onsubmit = async (event) => {
      event.preventDefault();
      if (!authorized || announcementBusy) return;
      const current = generation,
        row = announcementEditing;
      const values = {
        kind: $("announcement-kind").value,
        title: $("announcement-title").value.trim(),
        body: $("announcement-body").value.trim(),
        published: $("announcement-published").checked,
        important: $("announcement-important").checked,
        posted_at: new Date(
          $("announcement-posted-at").value + "+09:00",
        ).toISOString(),
      };
      if (!values.title || !values.body) {
        $("announcement-save-message").textContent =
          "タイトルと本文を入力してください。";
        return;
      }
      announcementBusy = true;
      $("announcement-save").disabled = true;
      try {
        const query = row
          ? db
              .from("card_announcements")
              .update(values)
              .eq("id", row.id)
              .eq("updated_at", row.updated_at)
          : db.from("card_announcements").insert(values);
        const { data, error } = await query.select("id");
        if (error) throw error;
        if (!authorized || current !== generation) return;
        if (!data?.length)
          throw new Error(
            "別の操作で更新・削除されています。一覧を更新して再度編集してください。",
          );
        $("announcement-dialog").close();
        await loadAnnouncements();
      } catch (error) {
        if (authorized && current === generation)
          $("announcement-save-message").textContent = errorText(error);
      } finally {
        announcementBusy = false;
        $("announcement-save").disabled = false;
      }
    };
    $("announcement-list").onclick = (event) => {
      const edit = event.target.closest("[data-announcement-edit]");
      if (edit) {
        editAnnouncement(edit.dataset.announcementEdit);
        return;
      }
      const button = event.target.closest("[data-announcement-delete]");
      if (!button || announcementBusy) return;
      announcementDeleting = announcementRows.get(
        button.dataset.announcementDelete,
      );
      if (!announcementDeleting) return;
      $("announcement-delete-name").textContent = announcementDeleting.title;
      $("announcement-delete-message").textContent = "";
      $("announcement-delete-dialog").showModal();
    };
    $("announcement-delete-cancel").onclick = () => {
      if (!announcementBusy) $("announcement-delete-dialog").close();
    };
    $("announcement-delete-confirm").onclick = async () => {
      if (!authorized || !announcementDeleting || announcementBusy) return;
      const current = generation,
        row = announcementDeleting;
      announcementBusy = true;
      $("announcement-delete-confirm").disabled = true;
      try {
        const { data, error } = await db
          .from("card_announcements")
          .delete()
          .eq("id", row.id)
          .eq("updated_at", row.updated_at)
          .select("id");
        if (error) throw error;
        if (!authorized || current !== generation) return;
        if (!data?.length)
          throw new Error(
            "別の操作で更新・削除されています。一覧を更新してください。",
          );
        $("announcement-delete-dialog").close();
        if (announcementRows.size === 1 && announcementPage) announcementPage--;
        await loadAnnouncements();
      } catch (error) {
        if (authorized && current === generation)
          $("announcement-delete-message").textContent = errorText(error);
      } finally {
        announcementBusy = false;
        $("announcement-delete-confirm").disabled = false;
      }
    };

    function showPage(page) {
      if (!requireAdminAction()) return;
      for (const id of [
        "cards",
        "users",
        "imports",
        "logs",
        "contacts",
        "usage",
        "operations",
        "verse",
        "announcements",
      ])
        $("admin-" + id).hidden = id !== page;
      document
        .querySelectorAll("[data-page]")
        .forEach((b) => b.classList.toggle("active", b.dataset.page === page));
      message("");
      clearInterval(syncProgressTimer);
      if (page === "cards") {
        loadCards();
        if ($("admin-state").value !== "registered") loadPending();
        refreshSyncProgress();
      }
      if (page === "announcements") loadAnnouncements();
      if (page === "imports") loadImports();
      if (page === "users") loadUsers();
      if (page === "logs") loadLogs();
      if (page === "contacts") loadContacts();
      if (page === "usage" || page === "operations") loadUsage();
      if (page === "verse") loadVerseAdmin();
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
        const identifier = $("admin-email").value.normalize("NFKC").trim();
        let email = identifier.toLowerCase();
        if (!identifier.includes("@")) {
          const lookup = await db.rpc("card_album_login_identifier", {
            p_id: identifier.toUpperCase(),
            p_password: $("admin-password").value,
          });
          if (lookup.error) throw lookup.error;
          email = lookup.data;
        }
        const { data, error } = await db.auth.signInWithPassword({
          email,
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
      adminPresenceLoggingOut = true;
      const logoutSession = session;
      const presenceLogout = adminPresencePending.catch(() => {});
      // Clear private DOM immediately, including when the server is unavailable.
      generation++;
      session = null;
      hidePrivateData();
      try {
        await presenceLogout;
        const { error } = await db.auth.signOut({ scope: "local" });
        if (error) {
          $("admin-auth-message").textContent = errorText(error);
        } else {
          await recordAdminConfirmedLogout(logoutSession);
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
    $("admin-missing").onchange = () => {
      cardPage = 1;
      renderCards();
    };
    $("admin-card-list").onclick = (e) => {
      const b = e.target.closest("[data-edit]");
      if (b) openEditor(b.dataset.edit);
      const draft = e.target.closest("[data-pending-edit]");
      if (draft) openPending(draft.dataset.pendingEdit);
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
      if (userPage <= 1) return;
      userPage--;
      loadUsers();
    };
    $("user-next").onclick = () => {
      if (userPage * 100 >= usersTotal) return;
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
        warnAdminLogin();
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
        body,
        page = contactPage,
        status = $("contact-status-filter").value,
      } = {},
    ) {
      if (!authorized || !session) throw Error("ログインし直してください。");
      let name,
        args = {};
      if (action === "summary") name = "card_admin_contact_summary";
      else if (action === "list") {
        name = "card_admin_contact_list";
        args = { p_offset: (page - 1) * 50, p_status: status };
      } else if (action === "status") {
        name = "card_admin_contact_status";
        args = { p_id: body.id, p_status: body.status };
      } else if (action === "delete-user") {
        name = "card_admin_delete_account";
        args = { p_target: body.user_id, p_confirmation: body.confirmation };
      } else throw Error("無効な操作です。");
      const { data, error } = await db.rpc(name, args);
      if (error) throw error;
      return action === "delete-user" ? { deleted: data === true } : data;
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
        contactRows = new Map(messages.map((row) => [row.id, row]));
        $("contact-list").innerHTML = messages
          .map(
            (row) =>
              `<details class="contact-message status-${["new", "working", "done"].includes(row.status) ? row.status : "new"}"><summary><span class="status-label">${{ new: "未対応", working: "対応中", done: "対応済み" }[row.status] || "未対応"}</span><h2>${esc(categories[row.category] || "お問い合わせ")}</h2><time>${esc(timestamp(row.created_at))}</time></summary><p class="contact-meta">${esc(row.name || "お名前未記入")}<br>${esc(row.album_id ? "アルバムID：" + row.album_id : row.email)}<br>${esc(timestamp(row.created_at))}</p><p class="contact-id">受付番号：${esc(row.id)}</p><div class="message-body">${esc(row.message)}</div><div class="contact-actions"><select aria-label="対応状況" data-contact-status="${esc(row.id)}">${[
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
                )}</select><button data-contact-save="${esc(row.id)}">状態を保存</button>${row.status === "done" ? `<button type="button" class="danger-button" data-contact-delete="${esc(row.id)}">削除</button>` : ""}</div></details>`,
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
      const remove = event.target.closest("[data-contact-delete]");
      if (remove && requireAdminAction()) {
        const row = contactRows.get(remove.dataset.contactDelete);
        if (row?.status === "done") {
          contactDeleting = row;
          $("contact-delete-status").textContent = "";
          $("contact-delete-dialog").showModal();
        }
        return;
      }
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
    $("force-sync").onclick = async () => {
      await loadCards(true);
      await refreshSyncProgress();
    };
    async function refreshSyncProgress() {
      if (!authorized || $("admin-cards").hidden) return;
      const data = window.PUBLIC_CATALOG_CACHE.peek();
      $("sync-progress-status").textContent =
        "SQLで追加・更新したカード情報を表示しています。";
      $("sync-progress-counts").textContent = data
        ? "登録カード " + data.cards.length + "枚"
        : "未確認";
      $("sync-progress-time").textContent = data
        ? "最終更新：" + timestamp(data.state?.updated_at)
        : "";
    }
    $("refresh-sync-progress").onclick = async () => {
      await loadCards(true);
      await refreshSyncProgress();
    };

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
    let maintenanceRevision = 0;
    let latestMaintenanceStatus = null;
    function showMaintenanceStatus(status) {
      latestMaintenanceStatus = status;
      $("maintenance-stop").hidden = status.maintenance !== true;
      $("maintenance-enabled").checked = status.maintenance === true;
      $("maintenance-admin-message").value =
        status.message ||
        "ただ今システムのメンテナンスをしていますので、アルバムを開けません。";
      $("maintenance-ends-at").value = status.ends_at
        ? new Date(new Date(status.ends_at).getTime() + 9 * 3600000)
            .toISOString()
            .slice(0, 16)
        : "";
      $("maintenance-state").textContent = status.maintenance
        ? "メンテナンスON · 一般サイトの利用を停止中"
        : "メンテナンスOFF · 通常の受付設定で運用中";
      $("maintenance-state").classList.toggle(
        "paused",
        status.maintenance === true,
      );
    }
    async function loadUsage() {
      if (!authorized || usageBusy) return;
      usageBusy = true;
      const current = generation;
      $("reload-usage").disabled = true;
      const maintenanceAtStart = maintenanceRevision;
      message("使用状況を確認中…");
      try {
        const { data, error } =
          usageSnapshot && Date.now() - usageFetchedAt < 60000
            ? { data: usageSnapshot }
            : await db.rpc("card_admin_usage");
        if (error) throw error;
        if (current !== generation || !authorized) return;
        if (maintenanceAtStart !== maintenanceRevision) return;
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
        showMaintenanceStatus({
          maintenance: settings.maintenance_enabled === true,
          message: settings.maintenance_message,
          ends_at: settings.maintenance_ends_at,
        });
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
          "/settings/usage";
        message("");

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
    $("reload-usage").onclick = () => {
      usageSnapshot = null;
      usageFetchedAt = 0;
      return loadUsage();
    };
    $("registration-free-preset").onclick = () => {
      $("registration-db-limit").value = "450";
      $("registration-save-message").textContent =
        "無料枠500MBの90％を停止基準に設定しました。保存すると反映されます。";
    };
    $("maintenance-stop").onclick = async () => {
      if (!authorized || $("maintenance-save").disabled) return;
      const current = generation;
      const savedMessage = latestMaintenanceStatus?.message?.trim();
      $("maintenance-save").disabled = true;
      $("maintenance-stop").disabled = true;
      $("maintenance-enabled").disabled = true;
      $("maintenance-save-message").textContent = "メンテナンスを解除中…";
      try {
        // フォームの入力検証を通さず、保存済みの案内文で確実にOFFを指定。
        const { data, error } = await db.rpc("card_admin_set_maintenance", {
          p_enabled: false,
          p_message:
            savedMessage ||
            "ただ今システムのメンテナンスをしていますので、アルバムを開けません。",
          p_ends_at: null,
        });
        if (error) throw error;
        if (current !== generation || !authorized) return;
        if (!data || data.maintenance !== false) {
          throw Error(
            "解除結果を確認できませんでした。使用状況を再取得して確認してください。",
          );
        }
        maintenanceRevision++;
        usageSnapshot = null;
        usageFetchedAt = 0;
        showMaintenanceStatus(data);
        $("maintenance-save-message").textContent =
          "メンテナンスを解除しました。一般サイトで再びログインできます。";
      } catch (error) {
        if (current === generation && authorized) {
          $("maintenance-save-message").textContent =
            "解除に失敗しました：" + errorText(error);
        }
      } finally {
        $("maintenance-save").disabled = false;
        $("maintenance-stop").disabled = false;
        $("maintenance-enabled").disabled = false;
      }
    };
    $("maintenance-controls").onsubmit = async (event) => {
      event.preventDefault();
      if (!authorized || $("maintenance-save").disabled) return;
      const text = $("maintenance-admin-message").value.trim();
      const value = $("maintenance-ends-at").value;
      const endsAt = value ? new Date(value + "+09:00") : null;
      if (
        !text ||
        text.length > 500 ||
        (endsAt && Number.isNaN(endsAt.getTime()))
      ) {
        $("maintenance-save-message").textContent =
          "案内文・終了予定を確認してください。";
        return;
      }
      const enabled = $("maintenance-enabled").checked;
      const current = generation;
      $("maintenance-save").disabled = true;
      $("maintenance-enabled").disabled = true;
      $("maintenance-save-message").textContent = "設定を保存中…";
      try {
        const { data, error } = await db.rpc("card_admin_set_maintenance", {
          p_enabled: enabled,
          p_message: text,
          p_ends_at: endsAt ? endsAt.toISOString() : null,
        });
        if (error) throw error;
        if (current !== generation || !authorized) return;
        if (!data || data.maintenance !== enabled) {
          throw Error(
            "保存結果を確認できませんでした。使用状況を再取得して確認してください。",
          );
        }
        maintenanceRevision++;
        usageSnapshot = null;
        usageFetchedAt = 0;
        showMaintenanceStatus(data);
        $("maintenance-save-message").textContent = enabled
          ? "メンテナンスを開始しました。"
          : "メンテナンスを解除しました。";
      } catch (error) {
        if (current === generation && authorized) {
          $("maintenance-save-message").textContent =
            "保存に失敗しました：" + errorText(error);
        }
      } finally {
        $("maintenance-save").disabled = false;
        $("maintenance-enabled").disabled = false;
      }
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
    let verseAdminPage = 0,
      verseHistoryPage = 0,
      verseRequest = 0,
      verseHistoryRequest = 0;
    let verseRows = new Map(),
      verseEditing = null,
      verseSaving = false;
    let contactRows = new Map(),
      contactDeleting = null,
      contactDeleteBusy = false;
    const jstInput = (value) =>
      new Date(new Date(value).getTime() + 9 * 3600000)
        .toISOString()
        .slice(0, 19);
    function warnAdminLogin(text = "ログインしてください") {
      const warning = $("admin-warning");
      warning.textContent = text;
      warning.hidden = false;
      clearTimeout(warnAdminLogin.timer);
      warnAdminLogin.timer = setTimeout(() => {
        warning.hidden = true;
      }, 6000);
    }
    let forcingLogin = false;
    function requireAdminAction() {
      if (authorized && session?.user?.id) return true;
      warnAdminLogin();
      $("admin-app").hidden = true;
      $("admin-nav").hidden = true;
      $("admin-auth").hidden = false;
      for (const dialog of document.querySelectorAll("dialog[open]"))
        dialog.close();
      history.replaceState(null, "", "#login");
      window.scrollTo({ top: 0, behavior: "instant" });
      return false;
    }
    forceAdminLogin = () => {
      if (forcingLogin || !authorized) return;
      forcingLogin = true;
      generation++;
      session = null;
      hidePrivateData();
      requireAdminAction();
      void db.auth
        .signOut({ scope: "local" })
        .catch(() => {})
        .finally(() => {
          forcingLogin = false;
        });
    };
    document.addEventListener(
      "click",
      (event) => {
        if (
          event.target.closest(
            "#admin-app button,#admin-nav button,dialog button",
          ) &&
          !requireAdminAction()
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    document.addEventListener(
      "submit",
      (event) => {
        if (
          event.target.closest("#admin-app,dialog") &&
          !requireAdminAction()
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    async function adminRPC(name, args = {}) {
      if (!requireAdminAction()) throw Error("ログインしてください");
      const current = generation;
      const { data, error } = await db.rpc(name, args);
      if (error) throw error;
      if (!authorized || current !== generation)
        throw Error("ログインしてください");
      return data;
    }
    async function loadVerseAdmin() {
      if (!requireAdminAction()) return;
      const request = ++verseRequest,
        current = generation;
      $("verse-admin-status").textContent = "コーデを読み込み中…";
      try {
        const data = await adminRPC("card_admin_verse_list", {
          p_family: $("verse-admin-family").value,
          p_query: $("verse-admin-query").value.trim(),
          p_offset: verseAdminPage * 24,
          p_limit: 24,
        });
        if (request !== verseRequest || current !== generation || !authorized)
          return;
        verseRows = new Map(
          (data.rows || []).slice(0, 24).map((c) => [c.id, c]),
        );
        $("verse-admin-list").innerHTML = [...verseRows.values()]
          .map(
            (c) =>
              `<article class="admin-card verse-catalog-card">${c.image ? `<img src="${esc(c.thumbnail || c.image)}" alt="${esc(c.name)}" loading="lazy">` : `<div class="pending-no-image">画像未登録</div>`}<p class="muted">${esc(c.code)} · ${esc(c.rarity || "未分類")}</p><p>${esc(c.name)}</p><p class="muted">${c.family === "onegai" ? "おねがい" : "ひみつ"} · ${c.part_ids.length}パーツ</p><button type="button" data-verse-admin-edit="${esc(c.id)}">情報を編集</button></article>`,
          )
          .join("");
        $("verse-admin-prev").disabled = verseAdminPage === 0;
        $("verse-admin-next").disabled = (data.rows || []).length <= 24;
        $("verse-admin-page").textContent = `${verseAdminPage + 1}ページ`;
        $("verse-admin-status").textContent = verseRows.size
          ? `${verseRows.size}コーデを表示`
          : "該当するコーデがありません。";
      } catch (error) {
        if (request === verseRequest && authorized)
          $("verse-admin-status").textContent = errorText(error);
      }
    }
    const verseField = (label, key, value, type = "text") =>
      `<label>${label}<input data-verse-field="${key}" type="${type}" value="${esc(value ?? "")}" ${type === "number" ? 'min="0" max="1000000" step="1"' : 'maxlength="2000"'}></label>`;
    $("verse-admin-list").onclick = (event) => {
      const button = event.target.closest("[data-verse-admin-edit]");
      if (!button || !requireAdminAction()) return;
      verseEditing = verseRows.get(button.dataset.verseAdminEdit);
      if (!verseEditing) return;
      const c = verseEditing;
      $("verse-editor-title").textContent = c.name;
      $("verse-editor-fields").innerHTML =
        `<fieldset class="verse-edit-coordinate"><legend>フルコーデ</legend><p class="muted">ID：${esc(c.id)}</p><div class="editor-preview verse-editor-preview">${c.image ? `<img src="${esc(c.image)}" alt="フルコーデ">` : ""}<div class="edit-fields verse-edit-grid">${verseField("コーデ名", "name", c.name)}${verseField("フルコーデコード", "code", c.code)}${verseField("レアリティ", "rarity", c.rarity)}${verseField("画像URL", "image", c.image, "url")}${verseField("一覧画像URL", "thumbnail", c.thumbnail, "url")}</div></div><label>だん・キャンペーン情報（JSON配列）<textarea data-verse-field="appearances" rows="5">${esc(JSON.stringify(c.appearances, null, 2))}</textarea></label></fieldset><h3>構成パーツ</h3>${c.parts.map((p) => `<fieldset data-verse-part="${p.id}"><legend>${esc(p.slot)} · ID ${p.id}</legend><div class="verse-part-editor">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.slot)}" loading="lazy">` : ""}<div class="verse-edit-grid">${verseField("部位", "slot", p.slot)}${verseField("バズパワー（未確認は空欄）", "buzz", p.buzz, "number")}${verseField("コード（カンマ区切り）", "codes", p.codes.join(", "))}${verseField("画像URL", "image", p.image, "url")}</div></div></fieldset>`).join("")}`;
      $("verse-editor-status").textContent = "";
      $("verse-editor-dialog").showModal();
    };
    $("verse-editor-close").onclick = () => {
      if (!verseSaving) $("verse-editor-dialog").close();
    };
    $("verse-editor-dialog").addEventListener("cancel", (e) => {
      if (verseSaving) e.preventDefault();
    });
    $("verse-editor-form").onsubmit = async (event) => {
      event.preventDefault();
      if (!requireAdminAction() || verseSaving || !verseEditing) return;
      verseSaving = true;
      $("verse-editor-save").disabled = true;
      try {
        const values = (root) =>
          Object.fromEntries(
            [...root.querySelectorAll("[data-verse-field]")].map((e) => [
              e.dataset.verseField,
              e.value.trim(),
            ]),
          );
        const coordinate = values(
          document.querySelector(".verse-edit-coordinate"),
        );
        coordinate.appearances = JSON.parse(coordinate.appearances);
        const parts = [
          ...$("verse-editor-fields").querySelectorAll("[data-verse-part]"),
        ].map((root) => {
          const v = values(root);
          return {
            ...v,
            id: Number(root.dataset.versePart),
            buzz: v.buzz === "" ? null : Number(v.buzz),
            codes: v.codes
              .split(/[,、\n]/)
              .map((x) => x.trim())
              .filter(Boolean),
          };
        });
        await adminRPC("card_admin_verse_save", {
          p_id: verseEditing.id,
          p_expected: verseEditing.edit_version,
          p_coordinate: coordinate,
          p_parts: parts,
        });
        $("verse-editor-dialog").close();
        await loadVerseAdmin();
        message("コーデとパーツの変更を保存しました。");
      } catch (error) {
        if (authorized) $("verse-editor-status").textContent = errorText(error);
      } finally {
        verseSaving = false;
        $("verse-editor-save").disabled = false;
      }
    };
    $("reload-verse").onclick = loadVerseAdmin;
    $("verse-admin-search").onclick = () => {
      verseAdminPage = 0;
      loadVerseAdmin();
    };
    $("verse-admin-family").onchange = () => {
      verseAdminPage = 0;
      loadVerseAdmin();
    };
    $("verse-admin-query").onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        verseAdminPage = 0;
        loadVerseAdmin();
      }
    };
    $("verse-admin-prev").onclick = () => {
      verseAdminPage = Math.max(0, verseAdminPage - 1);
      loadVerseAdmin();
    };
    $("verse-admin-next").onclick = () => {
      verseAdminPage++;
      loadVerseAdmin();
    };
    async function loadVerseHistory() {
      if (!requireAdminAction()) return;
      const request = ++verseHistoryRequest;
      try {
        const data = await adminRPC("card_admin_verse_history", {
          p_offset: verseHistoryPage * 20,
          p_limit: 20,
        });
        if (request !== verseHistoryRequest || !authorized) return;
        $("verse-history-list").innerHTML =
          (data.rows || [])
            .slice(0, 20)
            .map((row) => {
              const v = row.after_data || row.before_data || {};
              const changed = [
                ...new Set([
                  ...Object.keys(row.before_data || {}),
                  ...Object.keys(row.after_data || {}),
                ]),
              ].filter(
                (k) =>
                  JSON.stringify(row.before_data?.[k]) !==
                  JSON.stringify(row.after_data?.[k]),
              );
              return `<details class="compact-history"><summary><span class="history-action">${{ INSERT: "追加", UPDATE: "更新", DELETE: "削除" }[row.operation]}</span><strong>${esc(v.name || v.codes?.join(" / ") || row.target_id)}</strong><small>${row.entity === "coordinate" ? "コーデ" : "パーツ"} · ${esc(timestamp(row.recorded_at))}</small></summary><p class="muted">${esc(row.target_id)} · ${esc(changed.map((k) => labels[k] || k).join("、"))}</p></details>`;
            })
            .join("") || '<p class="muted">導入後の履歴はまだありません。</p>';
        $("verse-history-prev").disabled = verseHistoryPage === 0;
        $("verse-history-next").disabled = (data.rows || []).length <= 20;
        $("verse-history-page").textContent = `${verseHistoryPage + 1}ページ`;
      } catch (error) {
        if (authorized) message(errorText(error));
      }
    }
    document.querySelectorAll("[data-import-catalog]").forEach(
      (button) =>
        (button.onclick = () => {
          if (!requireAdminAction()) return;
          const verse = button.dataset.importCatalog === "verse";
          $("card-import-body").hidden = verse;
          $("verse-import-body").hidden = !verse;
          document
            .querySelectorAll("[data-import-catalog]")
            .forEach((b) =>
              b.setAttribute("aria-pressed", String(b === button)),
            );
          if (verse) loadVerseHistory();
        }),
    );
    $("reload-verse-history").onclick = loadVerseHistory;
    $("verse-history-prev").onclick = () => {
      verseHistoryPage = Math.max(0, verseHistoryPage - 1);
      loadVerseHistory();
    };
    $("verse-history-next").onclick = () => {
      verseHistoryPage++;
      loadVerseHistory();
    };
    $("reload-operations").onclick = () => {
      usageFetchedAt = 0;
      loadUsage();
    };
    $("contact-delete-cancel").onclick = () => {
      if (!contactDeleteBusy) $("contact-delete-dialog").close();
    };
    $("contact-delete-dialog").addEventListener("cancel", (e) => {
      if (contactDeleteBusy) e.preventDefault();
    });
    $("contact-delete-confirm").onclick = async () => {
      if (!requireAdminAction() || contactDeleteBusy || !contactDeleting)
        return;
      contactDeleteBusy = true;
      $("contact-delete-confirm").disabled = true;
      try {
        await adminRPC("card_admin_contact_delete", {
          p_id: contactDeleting.id,
          p_updated_at: contactDeleting.updated_at,
        });
        $("contact-delete-dialog").close();
        contactDeleting = null;
        await loadContacts();
        message("対応済みのお問い合わせを削除しました。");
      } catch (error) {
        if (authorized)
          $("contact-delete-status").textContent = errorText(error);
      } finally {
        contactDeleteBusy = false;
        $("contact-delete-confirm").disabled = false;
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
