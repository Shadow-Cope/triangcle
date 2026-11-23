"use strict";

/* =====================================================================
   Triancle Studio - home screen (create, open and delete games)
   ===================================================================== */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const FALLBACK = "assets/img/game-baseplate.png";
  const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="19" r="1.7" fill="currentColor"/></svg>';
  let games = [];

  function modified(ts) {
    const d = new Date(ts || 0);
    return "Modified " + d.toLocaleString(undefined, { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function closeCardMenus() {
    for (const m of document.querySelectorAll(".rsCardMenu")) m.hidden = true;
  }

  function visibleGames() {
    const q = $("stSearch").value.trim().toLowerCase();
    return q ? games.filter(g => (g.name || "").toLowerCase().includes(q)) : games;
  }

  function render() {
    games = studioLoadAll();
    const list = visibleGames();
    const searching = !!$("stSearch").value.trim();

    let html = list.map(g => `<article class="rsCard" data-id="${esc(g.id)}">
      <button class="rsCardBtn" type="button" data-open="${esc(g.id)}" title="Edit ${esc(g.name)}">
        <span class="rsThumb">
          <img alt="" src="${esc(g.thumb || FALLBACK)}">
          <span class="rsPrivacy">${LOCK}Private</span>
        </span>
        <span class="rsCardInfo">
          <span class="rsCardName">${esc(g.name || "Untitled game")}</span>
          <span class="rsCardMeta">${esc(modified(g.updated))}</span>
        </span>
      </button>
      <button class="rsKebab" type="button" data-kebab="${esc(g.id)}" aria-label="Options for ${esc(g.name)}">${DOTS}</button>
      <div class="rsCardMenu" hidden>
        <button type="button" data-open="${esc(g.id)}">Edit</button>
        <button type="button" class="danger" data-del="${esc(g.id)}">Delete</button>
      </div>
    </article>`).join("");

    if (!list.length) {
      html = `<button class="rsEmptyCard" type="button" data-new>
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        <span>${searching ? "No games match your search" : "Create a new game"}</span>
      </button>`;
    }
    $("stGrid").innerHTML = html;
  }

  function openCreate() {
    $("stCreateName").value = "";
    $("stCreate").hidden = false;
    setTimeout(() => $("stCreateName").focus(), 30);
  }

  function closeCreate() {
    $("stCreate").hidden = true;
  }

  function openGame(g) {
    StudioEditor.onExit = render;
    closeCardMenus();
    StudioEditor.open(g);
  }

  function createGame(e) {
    if (e) e.preventDefault();
    const name = studioCleanName($("stCreateName").value) || "Untitled game";
    const game = studioNewGame(name);
    studioUpsert(game);
    closeCreate();
    render();
    openGame(game);
  }

  function setNav(name) {
    for (const b of document.querySelectorAll(".rsNavItem")) b.classList.toggle("on", b.dataset.nav === name);
    const titles = { home: "Home", recents: "Recents", experiences: "Experiences", templates: "Templates" };
    $("stPageTitle").textContent = titles[name] || "Home";
    if (name === "experiences") $("stRecentTitle").textContent = "Your Games";
    else if (name === "recents") $("stRecentTitle").textContent = "Recent Games";
    else $("stRecentTitle").textContent = "My Recent Games";
    if (name === "templates") $("stTemplateSection").scrollIntoView({ behavior: "smooth", block: "start" });
    else $("stContent").scrollTo({ top: 0, behavior: "smooth" });
  }

  function deleteGame(id) {
    const game = studioGet(id);
    if (!game) return;
    StudioUI.dialog({
      title: "Delete game",
      body: `<div class="rsAbout">Delete <b>${esc(game.name)}</b>? This can't be undone.</div>`,
      buttons: [
        { label: "Cancel" },
        { label: "Delete", danger: true, onClick: () => { studioRemove(id); render(); } },
      ],
    });
  }

  /* ---- events ---- */
  $("stNew").addEventListener("click", openCreate);
  $("stCreateCancel").addEventListener("click", closeCreate);
  $("stCreateX").addEventListener("click", closeCreate);
  $("stCreateForm").addEventListener("submit", createGame);
  $("stCreate").addEventListener("pointerdown", e => { if (e.target === $("stCreate")) closeCreate(); });
  $("stSearch").addEventListener("input", render);

  for (const b of document.querySelectorAll(".rsNavItem")) b.addEventListener("click", () => setNav(b.dataset.nav));
  for (const b of document.querySelectorAll("[data-nav='recents']")) {
    if (b.classList.contains("rsViewAll")) b.addEventListener("click", () => setNav("recents"));
  }

  $("stGrid").addEventListener("click", e => {
    const kebab = e.target.closest("[data-kebab]");
    if (kebab) {
      e.stopPropagation();
      const card = kebab.closest(".rsCard");
      const menu = card && card.querySelector(".rsCardMenu");
      const wasOpen = menu && !menu.hidden;
      closeCardMenus();
      if (menu && !wasOpen) menu.hidden = false;
      return;
    }
    const del = e.target.closest("[data-del]");
    if (del) { closeCardMenus(); deleteGame(del.dataset.del); return; }
    const open = e.target.closest("[data-open]");
    if (open) { const g = studioGet(open.dataset.open); if (g) openGame(g); return; }
    if (e.target.closest("[data-new]")) openCreate();
  });

  document.addEventListener("pointerdown", e => { if (!e.target.closest(".rsCard")) closeCardMenus(); });
  window.addEventListener("keydown", e => { if (e.key === "Escape" && !$("stCreate").hidden) closeCreate(); });

  $("stHideSide").addEventListener("click", () => {
    $("stSide").classList.add("isHidden");
    $("stShowSide").hidden = false;
  });
  $("stShowSide").addEventListener("click", () => {
    $("stSide").classList.remove("isHidden");
    $("stShowSide").hidden = true;
  });

  const template = document.querySelector("[data-template='baseplate']");
  if (template) template.addEventListener("click", openCreate);
  $("stBasicsControls").addEventListener("click", () => StudioUI.cameraHelp());
  $("stBasicsPlay").addEventListener("click", () => StudioUI.cameraHelp());
  $("stBasicsSave").addEventListener("click", () => StudioUI.dialog({
    title: "Saving your game",
    body: `<div class="rsAbout">Press <span class="rsKey">Ctrl</span> + <span class="rsKey">S</span>, use <b>File &gt; Save</b>, or press Save in the Home ribbon.<br><br>
      Your game is saved on this device. Leaving the editor saves it too.</div>`,
  }));

  render();
})();
