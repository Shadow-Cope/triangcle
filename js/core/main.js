"use strict";

/* Start-up. Loaded last on purpose: everything below kicks off async work (account UI, login check, game list,
   graphics level) that calls into the other files, so all of them must already be loaded. */
acctUI();
(async function initAuth() {            // restore a saved login; without one you only ever see the login page
  const sb = getSB();
  try {
    if (sb) await loadBadgeDefs();
    if (sb) { const { data } = await sb.auth.getUser(); if (data && data.user) await onSignedIn(data.user); }
  } catch (_) {}
  document.body.classList.remove("boot");
  if (acct.user) { loadAllGames(); showTab("home"); appRunPendingJoin(); } else openAuth("login");
})();

loadAllGames();

requestAnimationFrame(frame);
setTimeout(() => setGraphics(Math.max(1, Math.min(5, _gl))), 0);
