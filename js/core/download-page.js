"use strict";
/* download page: link the installers, highlight the visitor's computer */
(function () {
  const $ = id => document.getElementById(id), ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const os = mobile ? "mobile" : /Windows/i.test(ua) ? "win" : /Macintosh|Mac OS X/i.test(ua) ? "mac" : "other";
  const base = APP_CFG.RELEASES_URL ? APP_CFG.RELEASES_URL.replace(/\/*$/, "/") : "";
  for (const [id, file] of [["dlWin", APP_CFG.WIN_FILE], ["dlMac", APP_CFG.MAC_FILE]]) {
    const a = $(id); $(id === "dlWin" ? "cardWin" : "cardMac").querySelector(".file").textContent = file;
    if (base) { a.href = base + file; a.setAttribute("download", ""); } else { a.removeAttribute("href"); a.classList.add("off"); }
  }
  $("soon").hidden = !!base;
  if (os === "mobile") { $("mobileNote").hidden = false; $("openApp").parentElement.hidden = true; }
  else if (os === "win" || os === "mac") {
    const c = $(os === "win" ? "cardWin" : "cardMac"); c.classList.add("rec"); c.querySelector(".badge").hidden = false;
    if (os === "mac") $("cards").insertBefore($("cardMac"), $("cardWin"));          // your computer first
  }
})();
