"use strict";

/* =====================================================================
   Playtest boot (used by Triancle Studio)
   index.html?playtest=1 runs the real game - same bundle, same avatar,
   same physics/camera/HUD - but skips accounts, the app gate, the home
   screen and multiplayer, and builds the map Studio just saved.
   Studio writes the map to sessionStorage and embeds this page.
   ===================================================================== */
(function () {
  const KEY = "triangle_studio_playtest";
  const ORIGIN = location.origin === "null" ? "*" : location.origin;
  const params = new URLSearchParams(location.search);

  window.__PLAYTEST__ = params.get("playtest") === "1";

  function tell(action, extra) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(Object.assign({ type: "triancle-playtest", action }, extra || {}), ORIGIN);
      }
    } catch (_) {}
  }

  /* Runs instead of js/core/main.js when ?playtest=1 is set. */
  window.__playtestBoot = async function () {
    let data = null;
    try { data = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (_) {}
    const body = document.body;
    body.classList.add("playtest");
    body.classList.remove("home", "boot");

    if (!data || !data.map || !Array.isArray(data.map.parts)) {
      body.innerHTML = '<div style="position:fixed;inset:0;display:grid;place-items:center;background:#191919;color:#bbb;font:13px Inter,system-ui,sans-serif">' +
        'Nothing to play yet. Press Play in Triancle Studio.</div>';
      tell("error");
      return;
    }

    // Studio opens the playtest as soon as Play is pressed; wait for the stud/inlet
    // images so the first frame already has the part textures.
    try { await Promise.all([IMG_STUD.decode(), IMG_INLET.decode()]); } catch (_) {}

    const map = data.map;
    if (data.spawnHere && Array.isArray(data.spawn) && data.spawn.length === 3) map.spawn = data.spawn;

    curGame = { id: "studio", room: "studio-local", custom: true, map };   // same object shape as a custom game
    buildWorld(curGame);                                                   // the real map builder: parts + collision
    inGame = true;
    last = performance.now();

    canBuild = () => false;             // Studio is the editor: a playtest never edits the map
    if (document.activeElement) document.activeElement.blur();

    // Esc stops the playtest (Studio style) instead of opening the in-game menu
    window.addEventListener("keydown", e => {
      if (e.key !== "Escape" && e.code !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      tell("stop");
    }, true);

    requestAnimationFrame(frame);
    tell("ready", { spawn: map.spawn || null });
    loadAccountSkin();                     // the signed-in player's colours, face, shirt/pants and accessories
  };

  /* Studio and the playtest share the origin, so the Supabase session saved by the
     Studio sign-in is already in storage: reuse it and pull the same profile the
     website uses (player_profiles.body_colors) plus the equipped UGC outfit. */
  async function loadAccountSkin() {
    try {
      const sb = typeof getSB === "function" ? getSB() : null;
      if (!sb) return;

      let user = null;
      try {
        const s = await sb.auth.getSession();
        user = s && s.data && s.data.session && s.data.session.user;
      } catch (_) {}
      if (!user) return;                 // not signed in: keep the default look

      acct.user = user;
      let name = (user.user_metadata && user.user_metadata.username) || String(user.email || "").split("@")[0] || "Player";

      try {
        const r = await sb.from(CFG.SAVE_TABLE).select("username, body_colors").eq("id", user.id).maybeSingle();
        if (!r.error && r.data) {
          if (r.data.username) name = r.data.username;
          if (r.data.body_colors) {
            myColors = sanitizeColors(r.data.body_colors);
            setAvatarColors(localAvatar, myColors);          // body colours + face
          }
        }
      } catch (_) {}

      acct.username = cleanName(name) || "Player";
      try { setPlayerName(acct.username); } catch (_) {}
      try { await loadInventory(); } catch (_) {}            // shirt, pants and accessories you wear
      try { acctUI(); } catch (_) {}
    } catch (_) {}
  }
})();
