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
    const errorText = (error) => {
      const detail = error?.message || String(error || "不明なエラー");
      if (/abort|timeout/i.test(detail))
        return "通信がタイムアウトしました。接続を確認して再試行してください。";
      if (/failed to fetch|network|load failed/i.test(detail))
        return "Supabaseに接続できません。ネットワークとconfig.jsのURLを確認してください。";
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
      ])
        $(id).replaceChildren();
      for (const id of ["edit-dialog", "confirm-dialog"])
        if ($(id).open) $(id).close();
    }
    async function checkAccess(next) {
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
      showPage("cards");
      await loadCards();
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
    async function loadCards() {
      if (!authorized) return;
      const current = generation;
      message("カード情報を読み込み中…");
      try {
        const [cards, patches] = await Promise.all([
          readAll("card_catalog", "card"),
          readAll("card_catalog_overrides", "card_id,patch,updated_at"),
        ]);
        if (current !== generation || !authorized) return;
        baseCards = cards
          .map((r) => r.card)
          .filter((card) => card && typeof card.id === "string");
        overrides = new Map(patches.map((r) => [r.card_id, r.patch]));
        renderCards();
        message(
          cards.length
            ? ""
            : "カードが未登録です。一般サイト側のcard-syncを実行してから更新してください。",
        );
      } catch (e) {
        if (current === generation)
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
      const current = generation;
      message("登録者を読み込み中…");
      const { data, error } = await db.rpc("card_admin_list_users", {
        p_offset: (userPage - 1) * 100,
        p_limit: 100,
      });
      if (current !== generation || !authorized) return;
      if (error) {
        message(errorText(error));
        return;
      }
      $("user-list").innerHTML = (data || [])
        .map(
          (u) =>
            `<tr><td>${esc(u.nickname || "未設定")}<small>${esc(u.email)}</small></td><td>${esc(timestamp(u.created_at))}</td><td>${esc(timestamp(u.last_sign_in_at))}</td><td>${u.confirmed ? "確認済み" : "未確認"}</td><td>${Number(u.owned_count) || 0}枚</td></tr>`,
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
      const current = generation;
      try {
        await loader();
      } catch (error) {
        if (current === generation && authorized) message(errorText(error));
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
      for (const id of ["cards", "users", "logs", "contacts"])
        $("admin-" + id).hidden = id !== page;
      document
        .querySelectorAll("[data-page]")
        .forEach((b) => b.classList.toggle("active", b.dataset.page === page));
      message("");
      if (page === "users") loadUsers();
      if (page === "logs") loadLogs();
      if (page === "contacts") loadContacts();
    }
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
    $("reload-cards").onclick = loadCards;
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
      } else if (event === "TOKEN_REFRESHED") session = next;
    });

    async function contactRequest(action, { method = "GET", body } = {}) {
      const { data, error } = await db.auth.getSession();
      if (error || !data.session) throw Error("ログインし直してください。");
      const url = new URL(
        config.supabaseUrl +
          "/functions/v1/" +
          (config.contactFunction || "contact-admin"),
      );
      url.searchParams.set("action", action);
      if (action === "list") {
        url.searchParams.set("offset", String((contactPage - 1) * 50));
        url.searchParams.set("status", $("contact-status-filter").value);
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
      const current = generation;
      message("お問い合わせを読み込み中…");
      try {
        const { messages } = await contactRequest("list");
        if (current !== generation || !authorized) return;
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
              `<article class="contact-message"><h2>${esc(categories[row.category] || "お問い合わせ")}</h2><p class="contact-meta">${esc(row.name || "お名前未記入")}<br>${esc(row.email)}<br>${esc(timestamp(row.created_at))}</p><p class="contact-id">受付番号：${esc(row.id)}</p><div class="message-body">${esc(row.message)}</div><div class="contact-actions"><select aria-label="対応状況" data-contact-status="${esc(row.id)}">${[
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
      } catch (error) {
        if (current === generation) message(errorText(error));
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
          await loadContacts();
        }
      } catch (error) {
        if (current === generation) message(errorText(error));
      } finally {
        button.disabled = false;
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
