/* 公開設定・承認。既存RPC・revisionによる競合検出を維持する。 */
window.ADMIN_WORKFLOW.mount((host) => {
  "use strict";
  const W = window.ADMIN_WORKFLOW,
    root = document.getElementById("admin-visibility");
  root.innerHTML = `<div class="section-heading">
<div>
<h1>公開設定・承認</h1>
<p>追加候補の承認と、登録済みカード・コーデの公開設定を管理します。</p>
</div>
<button type="button" data-refresh>一覧を更新</button>
</div>
<p class="publishing-explanation">発売前・シークレットの公開設定はこちらで管理します。情報修正や手動追加の保留候補は<button type="button" data-manual-pending>カード情報の保留一覧</button>で確認できます。</p>
<p data-status role="status" aria-live="polite">
</p>
<div class="publishing-layout">
<aside class="publishing-list">
<label>カード・コーデを探す<input type="search" data-search placeholder="名前・番号で検索">
</label>
<div class="publishing-tabs" role="group" aria-label="承認の状態">
<button type="button" data-tab="pending">確認待ち</button>
<button type="button" data-tab="restricted">制限中</button>
<button type="button" data-tab="all">すべて</button>
</div>
<label>対象<select data-kind>
<option value="all">カード・コーデ</option>
<option value="card">カード</option>
<option value="coordinate">コーデ</option>
</select>
</label>
<p data-count class="muted">
</p>
<div data-list class="publishing-items">
</div>
<button type="button" data-more hidden>さらに表示</button>
</aside>
<article class="publishing-editor">
<div data-empty class="empty-state">一覧からカード・コーデを選択してください。</div>
<div data-editor hidden>
<div class="publishing-card-heading">
<span data-state class="status-chip">
</span>
<h2 data-name>
</h2>
<p data-code class="muted">
</p>
</div>
<form>
<section class="editor-section">
<h3>1. 公開日時</h3>
<p>承認済みの設定は、開始日時から公開日時まで適用します。日本時間で入力してください。非表示項目がなければ公開日時は空欄にできます。</p>
<div class="field-grid">
<label>非表示を開始する日時<input type="datetime-local" name="starts_at" step="60" required>
</label>
<label>公開する日時<input type="datetime-local" name="ends_at" step="60" required>
</label>
</div>
</section>
<section class="editor-section">
<h3>2. 非表示にする内容</h3>
<div class="visibility-options">
<label>
<input type="checkbox" name="hide_image">
<span>
<strong>画像</strong>
<small>表面・裏面を案内表示に変更</small>
</span>
</label>
<label>
<input type="checkbox" name="hide_name">
<span>
<strong>名前</strong>
<small>公開準備中の表記に変更</small>
</span>
</label>
<label>
<input type="checkbox" name="hide_details">
<span>
<strong>詳細情報</strong>
<small>番号・キャラクター・楽曲などを非表示</small>
</span>
</label>
</div>
<label>非公開の理由<select name="reason">
<option value="secret">シークレット</option>
<option value="prerelease">発売・配布開始前</option>
<option value="review">情報を確認中</option>
</select>
</label>
</section>
<section class="editor-section">
<h3>表示イメージ</h3>
<div class="visibility-preview">
<p data-preview>
</p>
</div>
</section>
<details class="evidence-panel">
<summary>調査根拠・追加元を確認</summary>
<div data-evidence>
</div>
</details>
<label>保存後の状態<select name="state">
<option value="pending">確認待ちのまま保存</option>
<option value="approved">承認して適用</option>
<option value="rejected">却下・設定解除</option>
</select>
</label>
<p class="publishing-explanation">確認待ち：候補を保留します。承認：公開設定を適用し、未登録のカードは正式登録します。却下・設定解除：未登録候補は登録せず、登録済みの情報は削除せずに公開制限を解除します。</p>
<p data-save-status role="status" aria-live="polite">
</p>
<div class="publishing-save">
<button type="submit" class="primary">設定を保存</button>
<button type="button" data-approve class="primary" hidden>承認して正式登録</button>
</div>
</form>
</div>
</article>
</div>`;
  const $ = (selector) => root.querySelector(selector),
    form = $("form"),
    f = form.elements;
  let rows = [],
    reviews = new Map(),
    selectedId = null,
    selected = null,
    tab = "pending",
    limit = 60;
  let dirty = false,
    busy = false,
    loading = false,
    request = 0,
    stale = false;
  let transitionTimer = null;
  function reviewStatus(review, now = Date.now()) {
    if (!review) return "未設定";
    if (review.state === "pending") return "確認待ち";
    if (review.state === "rejected") return "却下・設定解除";
    if (review.state !== "approved") return "確認が必要";
    if (
      !["hide_image", "hide_name", "hide_details"].some(
        (key) => review[key] === true,
      )
    )
      return "公開中";
    const start = Date.parse(review.starts_at),
      end = Date.parse(review.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end))
      return "日時の確認が必要";
    if (end <= now) return "公開中";
    if (start > now) return "制限予定";
    return "制限中";
  }
  function scheduleTransition() {
    clearTimeout(transitionTimer);
    transitionTimer = null;
    if (root.hidden || !host.authorized()) return;
    const now = Date.now();
    let next = Infinity;
    for (const review of reviews.values()) {
      if (
        review.state !== "approved" ||
        !["hide_image", "hide_name", "hide_details"].some(
          (key) => review[key] === true,
        )
      )
        continue;
      for (const value of [review.starts_at, review.ends_at]) {
        const time = Date.parse(value);
        if (time > now && time < next) next = time;
      }
    }
    if (Number.isFinite(next))
      transitionTimer = setTimeout(
        () => {
          if (!host.authorized() || root.hidden) return;
          paintList();
          if (selectedId)
            $("[data-state]").textContent = reviewStatus(selected);
          scheduleTransition();
        },
        Math.min(Math.max(1, next - now), 2147483647),
      );
  }
  const normalize = (value) =>
    String(value || "")
      .normalize("NFKC")
      .toLowerCase();
  W.protect(
    "visibility",
    () => dirty,
    () => busy,
    () => {
      dirty = false;
    },
  );
  function allowDiscard() {
    return !dirty || confirm("未保存の変更を破棄しますか？");
  }
  function kind(card) {
    return card.target_kind === "coordinate" ? "coordinate" : "card";
  }
  function paintList() {
    if (selectedId) $("[data-state]").textContent = reviewStatus(selected);
    const query = normalize($("[data-search]").value),
      target = $("[data-kind]").value;
    const filtered = rows.filter(
      (card) =>
        (tab === "all" ||
          (tab === "restricted"
            ? reviewStatus(card.review) === "制限中"
            : card.review?.state === "pending")) &&
        (target === "all" || kind(card) === target) &&
        normalize([card.id, card.code, card.name].join(" ")).includes(query),
    );
    $("[data-list]").replaceChildren();
    for (const card of filtered.slice(0, limit)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "publishing-item";
      button.setAttribute("aria-pressed", String(selectedId === card.id));
      for (const [tag, value] of [
        [
          "small",
          (kind(card) === "coordinate" ? "コーデ" : "カード") +
            " · " +
            reviewStatus(card.review),
        ],
        ["strong", card.name || "名前未取得"],
        ["span", card.code || card.id],
      ]) {
        const element = document.createElement(tag);
        element.textContent = value;
        button.append(element);
      }
      button.onclick = () => {
        if (!busy && !loading && selectedId !== card.id && allowDiscard())
          choose(card.id);
      };
      $("[data-list]").append(button);
    }
    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "該当するカード・コーデはありません。";
      $("[data-list]").append(empty);
    }
    $("[data-count]").textContent = filtered.length + "件";
    $("[data-more]").hidden = filtered.length <= limit;
    root
      .querySelectorAll("[data-tab]")
      .forEach((button) =>
        button.setAttribute("aria-pressed", String(button.dataset.tab === tab)),
      );
  }
  function preview() {
    const hiding = ["hide_image", "hide_name", "hide_details"].filter(
      (key) => f[key].checked,
    );
    f.ends_at.required = f.state.value === "approved" && hiding.length > 0;
    const names = {
      hide_image: "画像",
      hide_name: "名前",
      hide_details: "詳細情報",
    };
    const until = f.ends_at.value
      ? f.ends_at.value.replace("T", " ") + "（日本時間）"
      : "公開日時未設定";
    $("[data-preview]").textContent =
      f.state.value === "rejected"
        ? "公開制限を解除します。登録済みの情報は削除しません。"
        : f.state.value === "pending"
          ? selected?.proposed_card && !selected.registered_at
            ? "確認待ちとして保留します。正式登録・公開は承認後に行います。"
            : "確認待ちとして保留します。登録済みの情報には確認待ちの公開制限が適用されます。"
          : hiding.length
            ? hiding.map((key) => names[key]).join("・") +
              "を非表示にします。公開日時：" +
              until
            : "画像・名前・詳細情報を通常どおり表示します。";
  }
  function choose(id) {
    const card = rows.find((row) => row.id === id);
    if (!card) return;
    selectedId = id;
    selected = reviews.get(id) || null;
    dirty = false;
    $("[data-empty]").hidden = true;
    $("[data-editor]").hidden = false;
    $("[data-name]").textContent = card.name || "名前未取得";
    $("[data-code]").textContent = card.code || id;
    $("[data-state]").textContent = reviewStatus(selected);
    f.starts_at.value = W.localDate(selected?.starts_at || new Date());
    f.ends_at.value = W.localDate(selected?.ends_at);
    f.reason.value = selected?.reason || "prerelease";
    f.state.value = selected?.state || "approved";
    for (const key of ["hide_image", "hide_name", "hide_details"])
      f[key].checked = selected?.[key] ?? key === "hide_image";
    $("[data-approve]").hidden = !(
      selected?.proposed_card && !selected.registered_at
    );
    $("[data-save-status]").textContent = "";
    $("[data-evidence]").replaceChildren();
    for (const text of [
      "対象：" + (kind(card) === "coordinate" ? "コーデ" : "カード"),
      "追加元：" + (selected?.batch_key || "既存登録情報"),
      "調査根拠：" + (selected?.evidence || "未取得"),
      "発売・配布開始：" +
        (W.localDate(selected?.release_at).replace("T", " ") || "未取得"),
    ]) {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      $("[data-evidence]").append(paragraph);
    }
    paintList();
    preview();
  }
  async function load({ discard = false } = {}) {
    if (!host.authorized() || loading || (dirty && !discard)) return false;
    const current = W.checkpoint(host),
      id = ++request;
    loading = true;
    $("[data-status]").textContent = "公開設定を読み込み中…";
    const unlock = W.lock(root);
    try {
      const response = await host.client().rpc("card_visibility_admin_state");
      if (!current() || id !== request) return false;
      if (response.error) throw response.error;
      if (
        !Array.isArray(response.data?.cards) ||
        !Array.isArray(response.data?.reviews)
      )
        throw Error("公開設定の形式を確認できませんでした。");
      reviews = new Map(
        response.data.reviews.map((review) => [review.card_id, review]),
      );
      const all = new Map(
        response.data.cards.map((card) => [
          card.id,
          { ...card, review: reviews.get(card.id) },
        ]),
      );
      for (const review of reviews.values())
        if (!all.has(review.card_id))
          all.set(review.card_id, {
            ...review.proposed_card,
            id: review.card_id,
            review,
          });
      rows = [...all.values()].sort(
        (a, b) =>
          Number(b.review?.state === "pending") -
            Number(a.review?.state === "pending") ||
          String(a.code || a.id).localeCompare(String(b.code || b.id), "ja"),
      );
      dirty = stale = false;
      paintList();
      scheduleTransition();
      if (selectedId && all.has(selectedId)) choose(selectedId);
      else {
        selectedId = selected = null;
        $("[data-editor]").hidden = true;
        $("[data-empty]").hidden = false;
      }
      $("[data-status]").textContent =
        "制限中には、現在の時刻が制限期間内で、画像・名前・詳細のいずれかを非表示にしているものを表示します。公開中・制限予定は「すべて」から確認できます。";
      return true;
    } catch (error) {
      if (current() && id === request)
        $("[data-status]").textContent = host.errorText(error);
      return false;
    } finally {
      if (id === request) {
        loading = false;
        unlock();
      }
    }
  }
  async function save(approve) {
    if (busy || loading || !selectedId || !host.authorized()) return;
    if (stale) {
      $("[data-save-status]").textContent =
        "保存結果を再取得してから編集してください。一覧を更新してください。";
      return;
    }
    const input = {
      card_id: selectedId,
      revision: selected?.revision || null,
      state: approve ? "approved" : f.state.value,
      reason: f.reason.value,
    };
    try {
      input.starts_at = W.utcDate(f.starts_at.value);
      input.ends_at = W.utcDate(f.ends_at.value);
      for (const key of ["hide_image", "hide_name", "hide_details"])
        input[key] = f[key].checked;
      if (
        !input.starts_at ||
        (input.state === "approved" &&
          (input.hide_image || input.hide_name || input.hide_details) &&
          !input.ends_at)
      )
        throw Error("開始日時と公開日時を入力してください。");
      if (input.ends_at && input.ends_at <= input.starts_at)
        throw Error("公開日時は開始日時より後にしてください。");
    } catch (error) {
      $("[data-save-status]").textContent = host.errorText(error);
      return;
    }
    const current = W.checkpoint(host),
      id = request;
    busy = true;
    const unlock = W.lock(root);
    $("[data-save-status]").textContent = "保存中…";
    try {
      const response = await host
        .client()
        .rpc("card_visibility_admin_save", { p_input: input });
      if (!current() || id !== request) return;
      if (response.error) throw response.error;
      if (response.data !== true)
        throw Error("保存結果を確認できませんでした。");
      dirty = false;
      stale = true;
      host.invalidateCatalog?.();
      host.invalidateUsage();
      // 保存成功と再取得失敗を区別し、二重の承認操作を避ける。
      const refreshed = await load({ discard: true });
      if (!current()) return;
      $("[data-save-status]").textContent = refreshed
        ? "保存しました。同じ追加元の登録情報は一つにまとめて表示されます。"
        : "保存しましたが、最新状態を取得できませんでした。一覧を更新してください。";
    } catch (error) {
      if (current() && id === request)
        $("[data-save-status]").textContent = host.errorText(error);
    } finally {
      if (current()) {
        busy = false;
        unlock();
      }
    }
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    save(false);
  };
  $("[data-approve]").onclick = () => save(true);
  $("[data-manual-pending]").onclick = () => {
    if (host.showPage("cards") === false) return;
    const state = document.getElementById("admin-state");
    state.value = "pending";
    state.dispatchEvent(new Event("change"));
  };
  $("[data-refresh]").onclick = () => {
    if (!busy && !loading && allowDiscard()) load({ discard: true });
  };
  $("[data-search]").oninput = $("[data-kind]").onchange = () => {
    limit = 60;
    paintList();
  };
  $("[data-more]").onclick = () => {
    limit += 60;
    paintList();
  };
  root.querySelectorAll("[data-tab]").forEach((button) => {
    button.onclick = () => {
      tab = button.dataset.tab;
      limit = 60;
      paintList();
    };
  });
  form.addEventListener("input", () => {
    dirty = true;
    preview();
    $("[data-save-status]").textContent = "未保存の変更があります。";
  });
  document.addEventListener("admin-page-changed", (event) => {
    if (event.detail.page === "visibility") {
      load();
      paintList();
      scheduleTransition();
    } else {
      clearTimeout(transitionTimer);
      transitionTimer = null;
    }
  });
  document.addEventListener("admin-session-reset", () => {
    request++;
    clearTimeout(transitionTimer);
    transitionTimer = null;
    rows = [];
    reviews.clear();
    selectedId = selected = null;
    dirty = busy = loading = stale = false;
    form.reset();
    $("[data-search]").value = "";
    $("[data-kind]").value = "all";
    tab = "pending";
    limit = 60;
    root.querySelectorAll("button,input,select").forEach((control) => {
      control.disabled = false;
    });
    for (const selector of ["[data-list]", "[data-evidence]"])
      $(selector).replaceChildren();
    for (const selector of [
      "[data-status]",
      "[data-save-status]",
      "[data-count]",
      "[data-name]",
      "[data-code]",
      "[data-state]",
      "[data-preview]",
    ])
      $(selector).textContent = "";
    $("[data-editor]").hidden = true;
    $("[data-empty]").hidden = false;
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !root.hidden && host.authorized()) {
      paintList();
      scheduleTransition();
    }
  });
  window.addEventListener("focus", () => {
    if (!root.hidden && host.authorized()) {
      paintList();
      scheduleTransition();
    }
  });
  if (!root.hidden && host.authorized()) load();
});
