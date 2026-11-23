"use strict";
/* download page: link the installers, switch Game / Studio, highlight the visitor's computer */
(function () {
  const $ = id => document.getElementById(id), ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const os = mobile ? "mobile" : /Windows/i.test(ua) ? "win" : /Macintosh|Mac OS X/i.test(ua) ? "mac" : "other";
  const base = APP_CFG.RELEASES_URL ? APP_CFG.RELEASES_URL.replace(/\/*$/, "/") : "";

  const installers = [
    { id: "dlWin", card: "cardWin", file: APP_CFG.WIN_FILE || "Triancle-Setup.exe", available: true },
    { id: "dlMac", card: "cardMac", file: APP_CFG.MAC_FILE || "Triancle-mac.dmg", available: APP_CFG.MAC_AVAILABLE !== false },
    { id: "studioDlWin", card: "studioCardWin", file: APP_CFG.STUDIO_WIN_FILE || "Triancle-Studio-Setup.exe", available: true },
    { id: "studioDlMac", card: "studioCardMac", file: APP_CFG.STUDIO_MAC_FILE || "Triancle-Studio-mac.dmg", available: APP_CFG.STUDIO_MAC_AVAILABLE !== false },
  ];

  for (const item of installers) {
    const a = $(item.id), card = $(item.card);
    if (!a || !card) continue;
    card.querySelector(".file").textContent = item.available ? item.file : "Not published yet";
    if (base && item.available) {
      a.href = base + item.file;
      a.setAttribute("download", "");
    } else {
      if (item.available) a.removeAttribute("href");
      else { a.removeAttribute("href"); a.textContent = "Mac build coming soon"; }
      a.classList.add("off");
    }
  }

  $("soon").hidden = !!base;

  if (os === "mobile") {
    $("mobileNote").hidden = false;
    $("openApp").parentElement.hidden = true;
  } else if (os === "win" || os === "mac") {
    for (const item of installers.filter(i => i.id.toLowerCase().includes(os))) {
      const card = $(item.card);
      if (card) { card.classList.add("rec"); card.querySelector(".badge").hidden = false; }
    }
    if (os === "mac") {
      $("cards").insertBefore($("cardMac"), $("cardWin"));
      $("cardsStudio").insertBefore($("studioCardMac"), $("studioCardWin"));
    }
  }

  const tabs = [...document.querySelectorAll(".tab")];
  const panes = [...document.querySelectorAll(".pane")];
  function show(name) {
    for (const t of tabs) { const on = t.dataset.tab === name; t.classList.toggle("on", on); t.setAttribute("aria-selected", on ? "true" : "false"); }
    for (const p of panes) p.hidden = p.dataset.pane !== name;
  }
  for (const tab of tabs) tab.addEventListener("click", () => show(tab.dataset.tab));
  if (location.hash === "#studio") show("studio");
})();
