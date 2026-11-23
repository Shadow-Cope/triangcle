"use strict";

/* =====================================================================
   Desktop app: detect it, gate Play behind it, and open it with triancle:// links.
   - Inside the app (window.TriancleApp, with the old user-agent token as a fallback) everything works as normal.
   - In a normal browser, pressing Play tries to open the app (triancle://join/<game>) and shows a download prompt.
   NOTE: this is a client-side gate - it keeps honest players on the app, it can't stop someone who edits the page.
   ===================================================================== */
const APP = (function () {
  const ua = navigator.userAgent, m = /TriancleApp\/([\d.]+)/.exec(ua);
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const os = mobile ? "mobile" : /Windows/i.test(ua) ? "win" : /Macintosh|Mac OS X/i.test(ua) ? "mac" : "other";
  const inApp = !!window.TriancleApp || !!m;
  if (inApp) document.documentElement.classList.add("inapp");
  return { in: inApp, os, version: m ? m[1] : String(window.TriancleApp && window.TriancleApp.version || ""), required: !!APP_CFG.REQUIRE_APP, pendingJoin: null };
})();
const APP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function appDownloadUrl(os) {                                        // direct installer link, or the download page when none is published yet
  const base = APP_CFG.RELEASES_URL;
  if (!base) return "download.html";
  if (os === "mac" && APP_CFG.MAC_AVAILABLE === false) return "download.html";
  return base.replace(/\/*$/, "/") + (os === "win" ? APP_CFG.WIN_FILE : APP_CFG.MAC_FILE);
}

/* ---- ?join=<game> : links like https://yoursite/?join=baseplate ---- */
(function () {
  let j = null;
  try { j = new URLSearchParams(location.search).get("join"); } catch (_) {}
  if (!j || !APP_ID_RE.test(j)) return;
  try { history.replaceState(null, "", location.pathname + location.hash); } catch (_) {}
  if (APP.in) APP.pendingJoin = j;                                    // the app starts it once you're signed in
  else if (APP.required) setTimeout(() => showAppPrompt(j), 0);       // a browser asks the app to open it (or offers the download)
})();
async function appRunPendingJoin() {
  const id = APP.pendingJoin;
  if (!id || !APP.in || !acct.user || starting) return;
  APP.pendingJoin = null;
  try { await loadAllGames(); } catch (_) {}
  if (!GAMES.some(g => g.id === id)) return;                          // unknown game: stay on the home screen
  openGamePage(id); startGame();
}

/* ---- the "get the app / open the app" prompt ---- */
function appPromptEl() {
  let el = document.getElementById("appPrompt"); if (el) return el;
  el = document.createElement("div"); el.id = "appPrompt"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "apTitle");
  el.innerHTML = '<div class="apCard"><button class="apX" type="button" aria-label="Close">&times;</button>'
    + '<img class="apIcon" alt="" src="assets/img/app-icon.png">'
    + '<h2 id="apTitle">Play in the <img class="apName" alt="Triancle" src="assets/img/logo.png"> app</h2><p id="apText"></p><div id="apStatus"></div>'
    + '<div class="apBtns"><a id="apDl" class="apP"></a><button id="apOpen" class="apG" type="button">Open Triancle</button></div>'
    + '<div class="apMore"><a id="apDl2"></a><a href="download.html">All downloads</a></div></div>';
  document.body.appendChild(el);
  const close = () => el.classList.remove("on");
  el.querySelector(".apX").addEventListener("click", close);
  el.addEventListener("pointerdown", e => { if (e.target === el) close(); });
  el.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") close(); });
  el.querySelector("#apOpen").addEventListener("click", () => appTryOpen(el._game));
  return el;
}
function appLaunch(id) {                                              // triancle://join/<id> through a hidden frame (no scary error pages if it isn't installed)
  const f = document.createElement("iframe"); f.style.display = "none";
  f.src = "triancle://" + (id ? "join/" + encodeURIComponent(id) : "open");
  document.body.appendChild(f); setTimeout(() => f.remove(), 3000);
}
function appTryOpen(id) {
  const st = document.getElementById("apStatus"); st.className = ""; st.textContent = "Opening Triancle…";
  let left = false; const mark = () => { left = true; };
  window.addEventListener("blur", mark); document.addEventListener("visibilitychange", mark);
  appLaunch(id);
  setTimeout(() => {                                                  // a browser can't tell us if the app exists, so we go by whether focus moved away
    window.removeEventListener("blur", mark); document.removeEventListener("visibilitychange", mark);
    st.className = left ? "ok" : "warn";
    st.textContent = left ? "Triancle should be opening now. You can close this tab."
      : "Nothing opened? Then Triancle isn't installed yet. Download it below, install it, then press Play again.";
  }, 2200);
}
function showAppPrompt(gameId) {
  const el = appPromptEl(), id = APP_ID_RE.test(gameId || "") ? gameId : "";
  el._game = id;
  const mobile = APP.os === "mobile", other = APP.os === "other";
  const first = APP.os === "mac" ? "mac" : "win", second = first === "win" ? "mac" : "win", name = o => o === "win" ? "Windows" : "Mac";
  el.querySelector("#apText").textContent = mobile
    ? "Triancle games run in the desktop app, which is available for Windows and Mac computers. Open this page on a computer to get it."
    : "Games run in the free Triancle app for Windows and Mac. If you've already installed it, we'll open it for you.";
  const dl = el.querySelector("#apDl"), dl2 = el.querySelector("#apDl2");
  dl.hidden = dl2.hidden = mobile; el.querySelector("#apOpen").hidden = mobile;
  dl.href = appDownloadUrl(first); dl.textContent = APP_CFG.RELEASES_URL ? "Download for " + name(first) : "Get Triancle";
  dl2.href = appDownloadUrl(second); dl2.textContent = APP_CFG.RELEASES_URL ? "or for " + name(second) : ""; dl2.hidden = mobile || !APP_CFG.RELEASES_URL;
  if (other) dl.textContent = APP_CFG.RELEASES_URL ? "Download for Windows" : "Get Triancle";
  const st = el.querySelector("#apStatus"); st.className = ""; st.textContent = "";
  el.classList.add("on");
  if (!mobile) appTryOpen(id);
}
