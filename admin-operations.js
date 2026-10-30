/* 運営設定・招待の画面。使用状況の描画とは分離する。 */
window.ADMIN_WORKFLOW.mount((host) => {
  "use strict";
  const W = window.ADMIN_WORKFLOW,
    $ = (id) => document.getElementById(id),
    db = host.client();
  const root = $("admin-operations");
  const controlsScope = {
    querySelectorAll: (selector) =>
      [...root.querySelectorAll(selector)].filter(
        (control) => !control.closest("[data-qr-global]"),
      ),
  };
  let request = 0,
    revision = 0,
    loading = false,
    saving = false,
    ready = false;
  let maintenance = null,
    dirty = new Set();
  const forms = ["maintenance-controls", "registration-controls"];
  const enableSettings = (enabled) =>
    forms.forEach((id) =>
      $(id)
        .querySelectorAll("button,input,select,textarea")
        .forEach((control) => {
          control.disabled = !enabled;
        }),
    );
  enableSettings(false);
  W.protect(
    "operations",
    () => dirty.size > 0,
    () => saving,
    () => dirty.clear(),
  );
  for (const id of forms)
    $(id).addEventListener("input", () => {
      dirty.add(id);
      $(
        id === forms[0]
          ? "maintenance-save-message"
          : "registration-save-message",
      ).textContent = "未保存の変更があります。";
    });
  function registrationStatus(status) {
    $("registration-state").textContent = status.allowed
      ? "通常登録を受付中"
      : status.invitation_allowed
        ? "招待からのみ受付中"
        : "招待を含め新規登録を停止中";
    $("registration-state").classList.toggle("paused", !status.allowed);
  }
  function maintenanceStatus(status) {
    maintenance = status;
    $("maintenance-stop").hidden = !status.maintenance;
    $("maintenance-enabled").checked = !!status.maintenance;
    $("maintenance-admin-message").value =
      status.message ||
      "ただ今システムのメンテナンスをしていますので、アルバムを開けません。";
    $("maintenance-ends-at").value = W.localDate(status.ends_at);
    $("maintenance-state").textContent = status.maintenance
      ? "メンテナンス中 · 一般サイトの利用を停止中"
      : "通常運用中";
    $("maintenance-state").classList.toggle("paused", !!status.maintenance);
  }
  async function load(force = false) {
    if (!host.authorized() || loading || saving) return;
    if (
      dirty.size &&
      (!force ||
        !confirm("未保存の変更を破棄して、保存済みの設定を取得しますか？"))
    )
      return;
    if (force) host.invalidateUsage();
    const current = W.checkpoint(host),
      id = ++request,
      atRevision = revision;
    loading = true;
    const unlock = W.lock(controlsScope);
    $("operations-status").textContent = "運営設定を確認中…";
    try {
      const [data, response] = await Promise.all([
        host.getUsage(),
        db.rpc("card_album_registration_status_v2"),
      ]);
      if (!current() || id !== request || atRevision !== revision) return;
      if (response.error) throw response.error;
      if (
        !data?.settings ||
        !["open", "invitation", "closed"].includes(response.data?.mode)
      )
        throw Error(
          "運営設定を確認できません。設定SQLの適用状況を確認してください。",
        );
      const settings = data.settings;
      $("registration-mode").value = response.data.mode;
      $("registration-message").value = settings.pause_message || "";
      $("registration-db-limit").value = settings.database_limit_bytes
        ? Number(settings.database_limit_bytes) / 1000000
        : "";
      maintenanceStatus({
        maintenance: settings.maintenance_enabled === true,
        message: settings.maintenance_message,
        ends_at: settings.maintenance_ends_at,
      });
      registrationStatus(response.data);
      dirty.clear();
      ready = true;
      $("operations-status").textContent =
        "保存済みの設定を表示しています。日時は日本時間です。";
    } catch (error) {
      if (current() && id === request)
        $("operations-status").textContent = host.errorText(error);
    } finally {
      if (id === request) {
        loading = false;
        unlock();
        enableSettings(ready);
      }
    }
  }
  async function save(formId, messageId, rpc, args, apply) {
    if (!host.authorized() || !ready || loading || saving) return;
    const current = W.checkpoint(host),
      atRequest = request;
    saving = true;
    const unlock = W.lock(controlsScope);
    $(messageId).textContent = "設定を保存中…";
    try {
      const result = await db.rpc(rpc, args);
      if (!current() || atRequest !== request) return;
      if (result.error) throw result.error;
      // 書き込み成功後は、結果の検証に失敗した場合も古いキャッシュを破棄する。
      revision++;
      host.invalidateUsage();
      apply(result.data);
      dirty.delete(formId);
      $(messageId).textContent = "設定を保存しました。";
      // 関連する状態表示も再計算する。フォームの再取得・上書きは行わない。
      try {
        const status = await db.rpc("card_album_registration_status_v2");
        if (current() && atRequest === request) {
          if (!status.error && status.data) registrationStatus(status.data);
          else
            $(messageId).textContent +=
              " 現在の受付状態は「状態を更新」で確認してください。";
        }
      } catch {
        if (current() && atRequest === request)
          $(messageId).textContent +=
            " 現在の受付状態は「状態を更新」で確認してください。";
      }
    } catch (error) {
      if (current() && atRequest === request)
        $(messageId).textContent =
          host.errorText(error) +
          " 保存結果が不明な場合は「状態を更新」で確認してください。";
    } finally {
      if (current() && atRequest === request) {
        saving = false;
        unlock();
      }
    }
  }
  $("reload-operations").onclick = () => load(true);
  $("maintenance-controls").onsubmit = (event) => {
    event.preventDefault();
    try {
      const text = $("maintenance-admin-message").value.trim(),
        enabled = $("maintenance-enabled").checked;
      if (!text || text.length > 500)
        throw Error("案内文を1～500文字で入力してください。");
      const ends = W.utcDate($("maintenance-ends-at").value);
      save(
        forms[0],
        "maintenance-save-message",
        "card_admin_set_maintenance",
        { p_enabled: enabled, p_message: text, p_ends_at: ends },
        (data) => {
          if (data?.maintenance !== enabled)
            throw Error("保存結果を確認できませんでした。");
          maintenanceStatus(data);
        },
      );
    } catch (error) {
      $("maintenance-save-message").textContent = host.errorText(error);
    }
  };
  $("maintenance-stop").onclick = () =>
    save(
      forms[0],
      "maintenance-save-message",
      "card_admin_set_maintenance",
      {
        p_enabled: false,
        p_message:
          maintenance?.message ||
          "ただ今システムのメンテナンスをしていますので、アルバムを開けません。",
        p_ends_at: null,
      },
      (data) => {
        if (data?.maintenance !== false)
          throw Error("解除結果を確認できませんでした。");
        maintenanceStatus(data);
      },
    );
  $("registration-controls").onsubmit = (event) => {
    event.preventDefault();
    const mode = $("registration-mode").value,
      text = $("registration-message").value.trim(),
      value = $("registration-db-limit").value;
    const limit = value === "" ? null : Number(value) * 1000000;
    if (
      !["open", "invitation", "closed"].includes(mode) ||
      !text ||
      text.length > 200 ||
      (limit !== null &&
        (!Number.isSafeInteger(limit) ||
          limit < 1000000 ||
          limit > 1099511627776))
    ) {
      $("registration-save-message").textContent =
        "受付方法・案内文・容量の設定を確認してください。";
      return;
    }
    save(
      forms[1],
      "registration-save-message",
      "card_admin_set_registration_mode",
      { p_mode: mode, p_message: text, p_database_limit_bytes: limit },
      (data) => {
        if (!data || data.mode !== mode)
          throw Error("受付方法の保存結果を確認できませんでした。");
        registrationStatus(data);
      },
    );
  };
  $("registration-free-preset").onclick = () => {
    $("registration-db-limit").value = "450";
    dirty.add(forms[1]);
    $("registration-save-message").textContent =
      "停止基準に450MBを入力しました。保存すると反映されます。";
  };
  let invitationBusy = false,
    invitationEpoch = 0;
  const invitationText = (url) => `フォローとご連絡ありがとうございます。
添付のリンク（招待URL）よりご登録をお願いします。
※招待URLは一度のみ有効です。招待URLの再発行は受け付けておりません。あらかじめご了承ください。

${url}`;
  function renderInvitations(rows) {
    const root = $("invitation-list");
    root.replaceChildren();
    const pending = rows.filter((row) =>
      ["ready", "claimed"].includes(row.state),
    );
    const completed = rows.filter((row) => row.state === "completed");
    const other = rows.filter(
      (row) => !["ready", "claimed", "completed"].includes(row.state),
    );
    const current = W.checkpoint(host);
    function table(items) {
      const wrap = document.createElement("div");
      wrap.className = "invitation-table-wrap";
      const table = document.createElement("table");
      table.className = "invitation-table";
      const head = table.createTHead().insertRow();
      for (const title of ["状態", "発行日時", "有効期限", "操作"]) {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = title;
        head.append(th);
      }
      const body = table.createTBody();
      for (const row of items) {
        const tr = body.insertRow();
        tr.dataset.invitationState = row.state;
        const status = tr.insertCell();
        const tag = document.createElement("span");
        tag.className = "invitation-state-tag";
        tag.textContent =
          {
            ready: "未登録",
            claimed: "登録中",
            completed: "登録済み",
            revoked: "無効",
            expired: "期限切れ",
          }[row.state] || "確認が必要";
        status.append(tag);
        for (const value of [row.created_at, row.expires_at]) {
          const cell = tr.insertCell();
          cell.className = "invitation-date";
          for (const part of String(host.timestamp(value)).split(/\s+/)) {
            const span = document.createElement("span");
            span.textContent = part;
            cell.append(span);
          }
        }
        const action = tr.insertCell();
        if (["ready", "claimed"].includes(row.state)) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "無効にする";
          button.onclick = async () => {
            if (
              !current() ||
              !confirm(
                "この招待URLを無効にします。開始済みの登録も完了できなくなります。",
              )
            )
              return;
            button.disabled = true;
            try {
              const result = await db.rpc("card_admin_invitation_revoke", {
                p_id: row.id,
              });
              if (!current()) return;
              if (result.error) throw result.error;
              await loadInvitations();
            } catch (error) {
              if (current())
                $("invitation-message").textContent = host.errorText(error);
            } finally {
              if (current()) button.disabled = false;
            }
          };
          action.append(button);
        } else action.textContent = "—";
      }
      wrap.append(table);
      return wrap;
    }
    const title = document.createElement("h3");
    title.textContent = `未登録・登録中（${pending.length}件）`;
    root.append(title);
    if (pending.length) root.append(table(pending));
    else {
      const empty = document.createElement("p");
      empty.textContent = "未登録・登録中の招待はありません。";
      root.append(empty);
    }
    for (const [label, items] of [
      ["登録済み", completed],
      ["期限切れ・無効など", other],
    ]) {
      if (!items.length) continue;
      const details = document.createElement("details");
      details.className = "invitation-history";
      const summary = document.createElement("summary");
      summary.textContent = `${label}（${items.length}件）`;
      details.append(summary, table(items));
      root.append(details);
    }
  }
  async function loadInvitations() {
    if (!host.authorized() || invitationBusy) return;
    const current = host.generation(),
      epoch = invitationEpoch;
    invitationBusy = true;
    $("invitation-reload").disabled = true;
    try {
      const { data, error } = await db.rpc("card_admin_invitation_list");
      if (error) throw error;
      if (current !== host.generation() || !host.authorized()) return;
      if (!Array.isArray(data)) throw Error("招待一覧を確認できませんでした。");
      renderInvitations(data);
    } catch (error) {
      if (current === host.generation() && host.authorized())
        $("invitation-message").textContent = host.errorText(error);
    } finally {
      if (epoch === invitationEpoch) {
        invitationBusy = false;
        $("invitation-reload").disabled = false;
      }
    }
  }
  $("invitation-reload").onclick = loadInvitations;
  $("invitation-copy").onclick = async () => {
    if (!host.authorized() || !$("invitation-url").value) return;
    const current = W.checkpoint(host);
    try {
      await navigator.clipboard.writeText(
        invitationText($("invitation-url").value),
      );
      if (current())
        $("invitation-message").textContent =
          "案内文と招待URLをコピーしました。";
    } catch {
      if (current())
        $("invitation-message").textContent =
          "コピーできませんでした。「送信用の案内文」を選択してコピーしてください。";
    }
  };
  $("invitation-create").onsubmit = async (event) => {
    event.preventDefault();
    if (!host.authorized() || $("invitation-issue").disabled) return;
    const current = host.generation(),
      days = Number($("invitation-days").value);
    if (!Number.isInteger(days) || days < 1 || days > 30) return;
    if (
      $("invitation-url").value &&
      !confirm(
        "前の招待URLは再表示できなくなります。保存・コピー済みの場合だけ続けてください。",
      )
    )
      return;
    $("invitation-issue").disabled = true;
    $("invitation-message").textContent = "発行中…";
    $("invitation-url").value = "";
    $("invitation-copy-text").value = "";
    $("invitation-result").hidden = true;
    try {
      // 公開先を先に検証し、設定不備で使えないURLを発行しません。
      const publicSiteUrl =
        String(host.config.publicSiteUrl || "").trim() ||
        "https://iprimaker.github.io/card-management/";
      const url = new URL(publicSiteUrl);
      if (
        url.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(url.hostname)
      )
        throw Error("一般サイトのURLを確認してください。");
      const { data, error } = await db.rpc("card_admin_invitation_create", {
        p_days: days,
      });
      if (error) throw error;
      if (current !== host.generation() || !host.authorized()) return;
      if (!/^[0-9a-f]{64}$/.test(data?.token || ""))
        throw Error("招待URLを発行できませんでした。");
      url.search = "";
      url.searchParams.set("view", "invite");
      url.hash = "invite=" + data.token;
      $("invitation-url").value = url.href;
      $("invitation-copy-text").value = invitationText(url.href);
      $("invitation-result").hidden = false;
      $("invitation-message").textContent =
        "招待URLを発行しました。有効期限：" + host.timestamp(data.expires_at);
      await loadInvitations();
    } catch (error) {
      if (current === host.generation() && host.authorized())
        $("invitation-message").textContent = host.errorText(error);
    } finally {
      if (current === host.generation() && host.authorized())
        $("invitation-issue").disabled = false;
    }
  };

  document.addEventListener("admin-page-changed", (event) => {
    if (event.detail.page === "operations") {
      load();
      loadInvitations();
    }
  });
  document.addEventListener("admin-session-reset", () => {
    request++;
    revision++;
    invitationEpoch++;
    loading = saving = ready = invitationBusy = false;
    dirty.clear();
    maintenance = null;
    forms.forEach((id) => $(id).reset());
    root.querySelectorAll("button,input,select,textarea").forEach((control) => {
      control.disabled = false;
    });
    enableSettings(false);
    for (const id of [
      "operations-status",
      "registration-state",
      "maintenance-state",
      "registration-save-message",
      "maintenance-save-message",
      "invitation-message",
    ])
      $(id).textContent = "";
    $("invitation-create").reset();
    $("invitation-url").value = "";
    $("invitation-copy-text").value = "";
    $("invitation-result").hidden = true;
    $("invitation-list").replaceChildren();
  });
  if (!root.hidden && host.authorized()) {
    load();
    loadInvitations();
  }
});
