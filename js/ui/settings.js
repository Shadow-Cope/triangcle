"use strict";

/* =====================================================================
   ACCOUNT SETTINGS
   - Display name: free, change any time (player_profiles.display_name)
   - Username: costs USERNAME_COST triangcles every time. The charge, the check that the name is free and the
     rename itself all happen in Supabase (change_username in supabase_schema.sql) so nobody can skip the cost.
   - Old usernames are kept in username_history and shown on the player's profile.
   ===================================================================== */
const USERNAME_COST = 150;                                          // keep in step with supabase_schema.sql
const NAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const DISPLAY_RE = /^[\p{L}\p{N}_.'\- ]{1,20}$/u;
function validDisplayName(value) { if (window.TriancleRust && window.TriancleRust.validDisplayName) { const ok = window.TriancleRust.validDisplayName(value); if (ok !== null) return ok; } return DISPLAY_RE.test(value); }
const RENAME_ERR = {
  not_signed_in: "Log in first.", invalid: "Username: 3-20 letters, numbers or _", same: "That's already your username.",
  taken: "That username is taken (or someone used it before).", not_enough: "You don't have enough Triangcles.",
  no_profile: "Your account isn't saved yet. Try again in a moment."
};

async function renderSettings() {
  const body = $("sBody");
  if (!acct.user) { body.innerHTML = '<div class="note">Log in to change your account settings.</div>'; return; }
  const sb = getSB(), me = acct.user.id;
  body.innerHTML = '<div class="muted">Loading…</div>';
  let display = "", old = [];
  try { const r = await sb.from(CFG.SAVE_TABLE).select("display_name").eq("id", me).maybeSingle(); if (!r.error && r.data) display = r.data.display_name || ""; } catch (_) {}
  try { const h = await sb.from("username_history").select("old_username, changed_at").eq("user_id", me).order("changed_at", { ascending: false }); if (!h.error) old = h.data || []; } catch (_) {}
  await loadWallet();
  const bal = WAL.bal == null ? "?" : fmtT(WAL.bal);
  body.innerHTML = `
    <h2 id="sTitle">Account settings</h2>
    <div class="box sBox">
      <h4>Display name</h4>
      <p class="muted">The name shown on your profile and on player cards. It's free and you can change it whenever you like. Your username stays the same.</p>
      <div class="sRow"><input id="sDisp" type="text" maxlength="20" value="${esc(display)}" placeholder="${esc(acct.username)}" autocomplete="off" spellcheck="false"><button class="btnP" id="sDispSave" type="button">Save</button></div>
      <div class="note sMsg" id="sDispMsg"></div>
    </div>
    <div class="box sBox">
      <h4>Username</h4>
      <p class="muted">Your username is <b>@${esc(acct.username)}</b>. You log in with it. Changing it costs <span class="sCost">${TRI_SVG}${USERNAME_COST}</span> every time, and everyone can see your old usernames on your profile.</p>
      <div class="sRow"><input id="sUser" type="text" maxlength="20" placeholder="New username" autocomplete="off" spellcheck="false"><button class="btnP" id="sUserSave" type="button">Change for ${TRI_SVG}${USERNAME_COST}</button></div>
      <div class="note sMsg" id="sUserMsg">You have <span class="sCost">${TRI_SVG}<span id="sBal">${esc(bal)}</span></span>.</div>
    </div>
    <div class="box sBox">
      <h4>Previous usernames</h4>
      <div id="sOld">${old.length ? old.map(o => `<div class="sOldRow"><b>@${esc(o.old_username)}</b><span class="muted">${esc(new Date(o.changed_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }))}</span></div>`).join("") : '<span class="muted">You haven\'t changed your username.</span>'}</div>
    </div>`;
  for (const id of ["sDisp", "sUser"]) $(id).addEventListener("keydown", e => e.stopPropagation());
  $("sDispSave").addEventListener("click", saveDisplayName);
  $("sUserSave").addEventListener("click", saveUsername);
}

async function saveDisplayName() {
  const msg = $("sDispMsg"), v = $("sDisp").value.trim(), sb = getSB();
  if (v && !validDisplayName(v)) { msg.textContent = "Display name: up to 20 letters, numbers, spaces, . _ - '"; return; }
  msg.textContent = "Saving…";
  try {
    const r = await sb.from(CFG.SAVE_TABLE).update({ display_name: v || null }).eq("id", acct.user.id).select("id");
    if (r.error || !(r.data && r.data.length)) throw r.error || new Error("no row");
    const p = SOC.cache.get(acct.user.id); if (p) p.display_name = v || null;
    msg.textContent = v ? "Saved. People will see \"" + v + "\"." : "Saved. People will see your username.";
  } catch (_) { msg.textContent = "Couldn't save. Run supabase_schema.sql in Supabase once."; }
}

async function saveUsername() {
  const msg = $("sUserMsg"), btn = $("sUserSave"), v = $("sUser").value.trim(), sb = getSB();
  const check = window.TriancleRust && window.TriancleRust.renameCheck ? window.TriancleRust.renameCheck(v,acct.username,WAL.bal,USERNAME_COST) : null;
  if (check === 1 || (check === null && !validUsername(v))) { msg.textContent = RENAME_ERR.invalid; return; }
  if (check === 2 || (check === null && v.toLowerCase() === acct.username.toLowerCase())) { msg.textContent = RENAME_ERR.same; return; }
  if (check === 3 || (check === null && WAL.bal != null && WAL.bal < USERNAME_COST)) { msg.textContent = RENAME_ERR.not_enough; return; }
  if (!confirm("Change your username to \"" + v + "\" for " + USERNAME_COST + " Triangcles?\nYour old username will show on your profile.")) return;
  btn.disabled = true; msg.textContent = "Changing…";
  try {
    const r = await sb.rpc("change_username", { p_new: v });
    if (r.error) { const code = Object.keys(RENAME_ERR).find(k => String(r.error.message || "").includes(k)); throw new Error(code || "fail"); }
    const d = r.data || {};
    acct.username = d.username || v; setPlayerName(acct.username); acctUI();
    const p = SOC.cache.get(acct.user.id); if (p) p.username = acct.username;
    await renderSettings();
    $("sUserMsg").textContent = "Done. You're now @" + acct.username + ".";
  } catch (e) {
    const m = String(e && e.message);
    msg.textContent = RENAME_ERR[m] || "Couldn't change it. Run supabase_schema.sql in Supabase once.";
  }
  btn.disabled = false;
}
