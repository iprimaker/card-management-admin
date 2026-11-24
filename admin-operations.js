/* Operations settings: explicit scope, per-database revisions and honest partial results. */
window.ADMIN_WORKFLOW.mount((host) => {
  "use strict";
  const W = window.ADMIN_WORKFLOW,
    $ = (id) => document.getElementById(id),
    db = host.client();
  const root = $("admin-operations"),
    api = window.CARD_OPS_ADMIN;
  const forms = [
    "maintenance-controls",
    "registration-controls",
    "registration-capacity-controls",
    "guest-browse-controls",
    "cleanup-controls",
    "qr-global-controls",
  ];
  const dirty = new Set();
  let request = 0,
    revision = 0,
    loading = false,
    saving = false,
    ready = false;
  let configuredRegistrationMode = null,
    maintenance = null,
    capacityRevision = null,
    guestBrowseRevision = null;
  let snapshots = [],
    entries = [],
    scope = "all";
  function enableSettings(enabled) {
    for (const id of forms)
      $(id)
        .querySelectorAll("button,input,select,textarea")
        .forEach((c) => (c.disabled = !enabled));
    $("operations-target").disabled = !enabled;
    if (enabled)
      $("qr-global-limit").disabled = $("qr-global-unlimited").checked;
    $("reload-operations").disabled = loading || saving;
  }
  enableSettings(false);
  W.protect(
    "operations",
    () => dirty.size > 0,
    () => saving || loading,
    () => dirty.clear(),
  );
  forms.forEach((id) => $(id).addEventListener("input", () => dirty.add(id)));
  const state = (id, text, paused) => {
    $(id).textContent = text;
    $(id).classList.toggle("paused", paused);
  };
  function maintenanceStatus(s) {
    maintenance = s;
    $("maintenance-enabled").checked = s.maintenance === true;
    $("maintenance-admin-message").value =
      s.message ||
      "ただ今システムのメンテナンスをしていますので、アルバムを開けません。";
    $("maintenance-ends-at").value = W.localDate(s.ends_at);
    $("maintenance-stop").hidden = !snapshots.some(
      (row) => row.data.settings.maintenance_enabled,
    );
    state(
      "maintenance-state",
      s.maintenance ? "メンテナンス中" : "通常運用中",
      s.maintenance,
    );
  }
  function registrationStatus(s) {
    const mode = configuredRegistrationMode || s.mode;
    const label =
      { open: "通常登録", invitation: "招待のみ", closed: "登録停止" }[mode] ||
      "確認が必要です";
    state(
      "registration-state",
      label +
        (s.reservation_limited
          ? " · 発行済みIDの登録待ち"
          : s.shard_full
            ? " · 人数上限に到達"
            : s.capacity_limited
              ? " · ID発行制限中"
              : ""),
      mode !== "open" || !s.allowed,
    );
  }
  function renderCapacity(s) {
    capacityRevision = s.revision;
    $("registration-capacity-enabled").checked = s.enabled;
    $("registration-capacity-minutes").value = s.window_minutes;
    $("registration-capacity-maximum").value = s.max_registrations;
    $("registration-capacity-state").textContent =
      `${s.window_minutes}分あたり${s.max_registrations}件 · ${s.enabled ? "ON" : "OFF"}`;
  }
  function renderGuestBrowse(s) {
    if (typeof s?.enabled !== "boolean" || !Number.isSafeInteger(s.revision))
      throw Error("閲覧設定を確認できません。");
    guestBrowseRevision = s.revision;
    $("guest-browse-enabled").checked = s.enabled;
    state(
      "guest-browse-state",
      s.enabled ? "ログインせずに利用できます" : "閲覧を停止中",
      !s.enabled,
    );
  }
  function validSnapshot(r) {
    return (
      r?.success === true &&
      r.data?.settings &&
      typeof r.data.settings.maintenance_enabled === "boolean" &&
      ["open", "invitation", "closed"].includes(r.data.status?.mode) &&
      typeof r.data.capacity?.enabled === "boolean" &&
      Number.isSafeInteger(r.data.capacity.revision) &&
      typeof r.data.cleanup?.enabled === "boolean" &&
      Number.isSafeInteger(r.data.cleanup.revision) &&
      Number.isSafeInteger(r.data.cleanup.inactive_days) &&
      (r.data.qr?.global_limit === null ||
        Number.isSafeInteger(r.data.qr?.global_limit))
    );
  }
  function renderSnapshots() {
    const first = snapshots[0].data,
      s = first.settings;
    configuredRegistrationMode = s.registration_enabled
      ? "open"
      : s.invitation_registration_enabled
        ? "invitation"
        : "closed";
    $("registration-mode").value = configuredRegistrationMode;
    $("registration-message").value =
      s.pause_message || "現在、新規登録を停止しています。";
    $("registration-db-limit").value = s.database_limit_bytes
      ? Number(s.database_limit_bytes) / 1000000
      : "";
    maintenanceStatus({
      maintenance: s.maintenance_enabled,
      message: s.maintenance_message,
      ends_at: s.maintenance_ends_at,
    });
    registrationStatus(first.status);
    renderCapacity(first.capacity);
    $("cleanup-enabled").checked = first.cleanup.enabled;
    $("cleanup-days").value = first.cleanup.inactive_days;
    state(
      "cleanup-state",
      `${first.cleanup.enabled ? "ON" : "OFF"} · 最終利用から${first.cleanup.inactive_days}日`,
      first.cleanup.enabled,
    );
    const qr = first.qr.global_limit;
    $("qr-global-unlimited").checked = qr === null;
    $("qr-global-limit").value = qr ?? 100;
    $("qr-global-limit").disabled = qr === null;
    state(
      "qr-global-state",
      qr === null ? "上限なし" : `1人あたり${qr}件`,
      false,
    );
    const container = $("operations-overview");
    container.replaceChildren();
    const table = document.createElement("table"),
      head = table.createTHead().insertRow();
    for (const title of [
      "登録者DB",
      "運用",
      "新規登録",
      "ID発行制限",
      "自動削除",
      "QR上限",
    ]) {
      const th = document.createElement("th");
      th.textContent = title;
      th.scope = "col";
      head.append(th);
    }
    const body = table.createTBody();
    for (const row of snapshots) {
      const d = row.data,
        c = d.settings,
        tr = body.insertRow();
      for (const value of [
        row.label,
        c.maintenance_enabled ? "メンテナンス" : "通常運用",
        c.registration_enabled
          ? "通常"
          : c.invitation_registration_enabled
            ? "招待のみ"
            : "停止",
        d.capacity.enabled
          ? `${d.capacity.window_minutes}分／${d.capacity.max_registrations}件`
          : "OFF",
        d.cleanup.enabled ? `${d.cleanup.inactive_days}日` : "OFF",
        d.qr.global_limit === null ? "上限なし" : `${d.qr.global_limit}件`,
      ])
        tr.insertCell().textContent = value;
    }
    container.append(table);
    // A mixed form is never silently prefilled from one database.
    const groups = [
      [
        "maintenance-controls",
        (r) => [
          r.data.settings.maintenance_enabled,
          r.data.settings.maintenance_message || "",
          r.data.settings.maintenance_ends_at || null,
        ],
      ],
      [
        "registration-controls",
        (r) => [
          r.data.settings.registration_enabled,
          r.data.settings.invitation_registration_enabled,
          r.data.settings.pause_message,
          r.data.settings.database_limit_bytes,
        ],
      ],
      [
        "registration-capacity-controls",
        (r) => [
          r.data.capacity.enabled,
          r.data.capacity.window_minutes,
          r.data.capacity.max_registrations,
        ],
      ],
      [
        "cleanup-controls",
        (r) => [r.data.cleanup.enabled, r.data.cleanup.inactive_days],
      ],
      ["qr-global-controls", (r) => [r.data.qr.global_limit]],
    ];
    for (const [id, values] of groups) {
      const form = $(id);
      form.querySelector(".mixed-settings")?.remove();
      const mixed =
        new Set(snapshots.map((r) => JSON.stringify(values(r)))).size > 1;
      if (mixed) {
        const note = document.createElement("p");
        note.className = "mixed-settings";
        note.textContent =
          "DBごとに設定が異なります。表示値は「" +
          snapshots[0].label +
          "」の設定です。保存すると、このフォームの内容で選択範囲を統一します。";
        form.prepend(note);
        const stateId = {
          "maintenance-controls": "maintenance-state",
          "registration-controls": "registration-state",
          "registration-capacity-controls": "registration-capacity-state",
          "cleanup-controls": "cleanup-state",
          "qr-global-controls": "qr-global-state",
        }[id];
        if (stateId) state(stateId, "DBごとに設定が異なります", false);
      }
    }
  }
  async function load(force = false) {
    if (!host.authorized() || loading || saving) return;
    if (
      dirty.size &&
      (!force || !confirm("未保存の変更を破棄して設定を更新しますか？"))
    )
      return;
    const current = W.checkpoint(host),
      ticket = ++request;
    loading = true;
    ready = false;
    enableSettings(false);
    $("operations-status").textContent = "選択範囲の設定を確認中…";
    try {
      entries = await api.registry();
      const selector = $("operations-target");
      selector.replaceChildren();
      for (const row of [
        { key: "all", label: "すべての登録者DB" },
        ...entries,
      ]) {
        const option = document.createElement("option");
        option.value = row.key;
        option.textContent = row.label;
        selector.append(option);
      }
      selector.value = scope;
      const invite = $("invitation-database");
      invite.replaceChildren(
        ...entries.map((row) => {
          const o = document.createElement("option");
          o.value = row.key;
          o.textContent = row.label;
          return o;
        }),
      );
      invite.value = api.database();
      invite.disabled = false;
      const [result, guest] = await Promise.all([
        api.settings(scope, "load"),
        db.rpc("card_guest_browse_status"),
      ]);
      if (!current() || ticket !== request) return;
      if (
        result.complete !== true ||
        !Array.isArray(result.results) ||
        !result.results.length ||
        !result.results.every(validSnapshot)
      ) {
        const failures = (result.results || [])
          .filter((r) => !validSnapshot(r))
          .map((r) => r.label + "：" + (r.message || "設定を確認できません"));
        throw Error(
          failures.join(" ／ ") ||
            "設定を確認できません。元・Aの設定SQLを確認してください。",
        );
      }
      if (guest.error) throw guest.error;
      snapshots = result.results;
      renderSnapshots();
      renderGuestBrowse(guest.data);
      dirty.clear();
      ready = true;
      $("operations-status").textContent =
        `適用先：${scope === "all" ? "全登録者DB（" + snapshots.length + "件）" : snapshots[0].label}。各フォームの保存ボタンで反映します。`;
    } catch (error) {
      if (current() && ticket === request)
        $("operations-status").textContent = host.errorText(error);
    } finally {
      if (current() && ticket === request) {
        loading = false;
        enableSettings(ready);
        $("operations-target").disabled = false;
      }
    }
  }
  $("operations-target").onchange = () => {
    const next = $("operations-target").value;
    if (
      dirty.size &&
      !confirm("未保存の変更を破棄して適用先を変更しますか？")
    ) {
      $("operations-target").value = scope;
      return;
    }
    dirty.clear();
    scope = next;
    load();
  };
  $("invitation-database").onchange = () => {
    try {
      api.changeDatabase($("invitation-database").value);
    } catch (e) {
      $("invitation-message").textContent = host.errorText(e);
    }
    $("invitation-database").value = api.database();
  };
  $("reload-operations").onclick = () => load(true);
  async function save(formId, messageId, name, args) {
    if (!host.authorized() || !ready || loading || saving) return;
    const current = W.checkpoint(host),
      ticket = request;
    saving = true;
    enableSettings(false);
    $(messageId).textContent = "保存中…";
    try {
      if (name === "card_admin_guest_browse_save") {
        const r = await db.rpc(name, args);
        if (r.error) throw r.error;
        if (current()) renderGuestBrowse(r.data);
      } else {
        const section =
          name === "card_admin_cleanup_save_v179"
            ? "cleanup"
            : name === "card_admin_registration_capacity_save"
              ? "capacity"
              : null;
        const revisions = section
          ? Object.fromEntries(
              snapshots.map((r) => [r.database, r.data[section].revision]),
            )
          : undefined;
        const result = await api.settings(
          scope,
          name,
          args,
          revisions,
          snapshots.map((row) => row.database),
        );
        if (!current() || ticket !== request) return;
        if (result.complete !== true) {
          ready = false;
          $(messageId).textContent =
            "DBごとの結果：" +
            result.results
              .map(
                (r) =>
                  r.label +
                  "：" +
                  (r.success ? "保存済み" : r.message || "未確認"),
              )
              .join(" ／ ") +
            "。状態を更新して確認してください。";
          return;
        }
        if (
          !Array.isArray(result.results) ||
          result.results.length !== snapshots.length ||
          !result.results.every(
            (r) =>
              r.success && snapshots.some((s) => s.database === r.database),
          )
        )
          throw Error("保存結果のDBを確認できません。");
        for (const row of result.results) {
          const d = snapshots.find((s) => s.database === row.database).data;
          if (
            (name === "card_admin_set_maintenance" &&
              row.data?.maintenance !== args.p_enabled) ||
            (name === "card_admin_set_registration_mode" &&
              row.data?.mode !== args.p_mode) ||
            (section &&
              (!Number.isSafeInteger(row.data?.revision) ||
                row.data.revision <= d[section].revision ||
                row.data.enabled !== args.p_enabled ||
                (section === "cleanup" &&
                  row.data.inactive_days !== args.p_inactive_days) ||
                (section === "capacity" &&
                  (row.data.window_minutes !== args.p_window_minutes ||
                    row.data.max_registrations !== args.p_max_registrations))))
          )
            throw Error(
              "保存後の設定を確認できません。状態を更新してください。",
            );
          if (name === "card_admin_set_maintenance")
            Object.assign(d.settings, {
              maintenance_enabled: args.p_enabled,
              maintenance_message: args.p_message,
              maintenance_ends_at: args.p_ends_at,
            });
          else if (name === "card_admin_set_registration_mode") {
            Object.assign(d.settings, {
              registration_enabled: args.p_mode === "open",
              invitation_registration_enabled: args.p_mode !== "closed",
              pause_message: args.p_message,
              database_limit_bytes: args.p_database_limit_bytes,
            });
            d.status = { ...row.data, mode: args.p_mode };
          } else if (name === "card_qr_admin_limit") {
            d.qr = { global_limit: args.p_limit };
          } else if (section) {
            if (!Number.isSafeInteger(row.data?.revision))
              throw Error(
                "保存後の設定を確認できません。状態を更新してください。",
              );
            d[section] = row.data;
          }
        }
        // Do not replace other forms with unsaved edits.
        const unsaved = forms
          .filter((id) => id !== formId && dirty.has(id))
          .map((id) => [
            $(id),
            [...$(id).querySelectorAll("input,select,textarea")].map((c) => [
              c,
              c.value,
              c.checked,
            ]),
          ]);
        renderSnapshots();
        for (const [, controls] of unsaved)
          for (const [control, value, checked] of controls) {
            control.value = value;
            control.checked = checked;
          }
      }
      if (!current() || ticket !== request) return;
      host.invalidateUsage();
      dirty.delete(formId);
      $(messageId).textContent = "選択した範囲に保存しました。";
    } catch (error) {
      if (current()) {
        ready = false;
        $(messageId).textContent =
          host.errorText(error) +
          " 保存結果が不明な場合は状態を更新してください。";
      }
    } finally {
      if (current()) {
        saving = false;
        enableSettings(ready);
        $("operations-target").disabled = false;
      }
    }
  }
  const fail = (id, error) => ($(id).textContent = host.errorText(error));
  $("maintenance-controls").onsubmit = (e) => {
    e.preventDefault();
    try {
      const text = $("maintenance-admin-message").value.trim();
      if (!text || text.length > 500)
        throw Error("案内文は1〜500文字で入力してください。");
      save(forms[0], "maintenance-save-message", "card_admin_set_maintenance", {
        p_enabled: $("maintenance-enabled").checked,
        p_message: text,
        p_ends_at: W.utcDate($("maintenance-ends-at").value),
      });
    } catch (error) {
      fail("maintenance-save-message", error);
    }
  };
  $("maintenance-stop").onclick = () =>
    save(forms[0], "maintenance-save-message", "card_admin_set_maintenance", {
      p_enabled: false,
      p_message: maintenance?.message || "メンテナンス中です。",
      p_ends_at: null,
    });
  $("registration-controls").onsubmit = (e) => {
    e.preventDefault();
    const mode = $("registration-mode").value,
      text = $("registration-message").value.trim(),
      raw = $("registration-db-limit").value;
    const limit = raw === "" ? null : Number(raw) * 1000000;
    if (
      !["open", "invitation", "closed"].includes(mode) ||
      !text ||
      text.length > 200 ||
      (limit !== null &&
        (!Number.isSafeInteger(limit) ||
          limit < 1000000 ||
          limit > 1099511627776))
    ) {
      fail(
        "registration-save-message",
        Error("受付方法・案内文・容量を確認してください。"),
      );
      return;
    }
    save(
      forms[1],
      "registration-save-message",
      "card_admin_set_registration_mode",
      { p_mode: mode, p_message: text, p_database_limit_bytes: limit },
    );
  };
  $("registration-capacity-controls").onsubmit = (e) => {
    e.preventDefault();
    const minutes = Number($("registration-capacity-minutes").value),
      maximum = Number($("registration-capacity-maximum").value);
    if (
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > 1440 ||
      !Number.isInteger(maximum) ||
      maximum < 1 ||
      maximum > 10000
    ) {
      fail(
        "registration-capacity-message",
        Error("集計期間は1〜1440分、発行数は1〜10000件で入力してください。"),
      );
      return;
    }
    save(
      forms[2],
      "registration-capacity-message",
      "card_admin_registration_capacity_save",
      {
        p_enabled: $("registration-capacity-enabled").checked,
        p_window_minutes: minutes,
        p_max_registrations: maximum,
      },
    );
  };
  $("cleanup-controls").onsubmit = (e) => {
    e.preventDefault();
    const days = Number($("cleanup-days").value);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      fail(
        "cleanup-message",
        Error("未利用日数は1〜3650日で入力してください。"),
      );
      return;
    }
    save(
      "cleanup-controls",
      "cleanup-message",
      "card_admin_cleanup_save_v179",
      { p_enabled: $("cleanup-enabled").checked, p_inactive_days: days },
    );
  };
  $("guest-browse-controls").onsubmit = (e) => {
    e.preventDefault();
    save(forms[3], "guest-browse-message", "card_admin_guest_browse_save", {
      p_enabled: $("guest-browse-enabled").checked,
      p_revision: guestBrowseRevision,
    });
  };
  $("registration-free-preset").onclick = () => {
    $("registration-db-limit").value = "450";
    dirty.add(forms[1]);
  };
  $("qr-global-unlimited").addEventListener("change", () => {
    $("qr-global-limit").disabled = $("qr-global-unlimited").checked || !ready;
  });
  $("qr-global-controls").onsubmit = (e) => {
    e.preventDefault();
    const limit = $("qr-global-unlimited").checked
      ? null
      : Number($("qr-global-limit").value);
    if (
      limit !== null &&
      (!Number.isInteger(limit) || limit < 0 || limit > 100000)
    ) {
      fail("qr-global-message", Error("上限は0〜100000件で入力してください。"));
      return;
    }
    save("qr-global-controls", "qr-global-message", "card_qr_admin_limit", {
      p_limit: limit,
    });
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
      const selectedDB = window.CARD_OPS_ADMIN.database();
      if (selectedDB !== "main") url.searchParams.set("db", selectedDB);
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
    capacityRevision = guestBrowseRevision = null;
    configuredRegistrationMode = null;
    snapshots = [];
    entries = [];
    scope = "all";
    $("operations-overview").replaceChildren();
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
      "registration-capacity-message",
      "registration-capacity-state",
      "maintenance-save-message",
      "guest-browse-message",
      "guest-browse-state",
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
