(() => {
  let finished = false;
  let lastError = "";
  function paint() {
    const panel = document.getElementById("startup-panel");
    if (!panel) return;
    panel.hidden = finished && !lastError;
    document.getElementById("startup-message").textContent =
      lastError || "管理者アプリを起動中…";
    document.getElementById("startup-actions").hidden = !lastError;
    document.getElementById("admin-submit").disabled = !finished || !!lastError;
  }
  function reset() {
    try {
      for (const suffix of ["", "-code-verifier", "-user"])
        localStorage.removeItem("card-album-admin-auth" + suffix);
      location.reload();
    } catch {
      lastError =
        "保存領域にアクセスできません。ブラウザのサイトデータ設定を確認してください。";
      paint();
    }
  }
  window.ADMIN_STARTUP = {
    ready(persistent) {
      finished = true;
      lastError = "";
      paint();
      if (!persistent)
        document.getElementById("admin-auth-message").textContent =
          "ブラウザの保存領域を使えないため、この画面を閉じるとログアウトします。";
    },
    fail(message) {
      finished = true;
      lastError = "起動できませんでした。" + message;
      paint();
    },
  };
  window.addEventListener(
    "error",
    (event) => {
      const script = event.target;
      if (script?.tagName === "SCRIPT")
        window.ADMIN_STARTUP.fail(
          "ファイルを読み込めません：" + script.getAttribute("src"),
        );
      else if (!finished)
        window.ADMIN_STARTUP.fail(
          event.message || "JavaScriptの実行に失敗しました。",
        );
    },
    true,
  );
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("startup-retry").onclick = () => location.reload();
    document.getElementById("startup-reset").onclick = reset;
    document.getElementById("auth-reset").onclick = reset;
    paint();
    setTimeout(() => {
      if (!finished)
        window.ADMIN_STARTUP.fail(
          "起動が完了しません。通信環境と公開ファイルを確認してください。",
        );
    }, 30000);
  });
})();
