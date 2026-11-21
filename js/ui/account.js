"use strict";

/* ---- saving ---- */
function queueSave() { saveStatus("Saving…"); clearTimeout(saveTimer); saveTimer = setTimeout(doSave, 600); }
async function doSave() {
  saveTimer = 0;
  if (!acct.user) {
    try { localStorage.setItem(GUEST_KEY, JSON.stringify(myColors)); saveStatus("Saved on this device (log in to keep it on your account)"); }
    catch (_) { saveStatus("Couldn't save on this device"); }
    return;
  }
  const sb = getSB(); if (!sb) return;
  try {
    const { error } = await sb.from(CFG.SAVE_TABLE).upsert({ id: acct.user.id, username: acct.username, body_colors: myColors, updated_at: new Date().toISOString() });
    saveStatus(error ? "Couldn't save, try again" : "Saved to your account");
  } catch (_) { saveStatus("Couldn't save, try again"); }
}
async function flushSave() { if (saveTimer) { clearTimeout(saveTimer); await doSave(); } }

/* ---- account ---- */
const acct = { user: null, username: "", busy: false, mode: "login" };
let guestName = myName;
function setPlayerName(n) {
  myName = n; nameInput.value = n; me.name = n; me.tag.textContent = n;
  renderBoard(); netSend({ t: "name", name: n });
}
function acctUI() {
  const on = !!acct.user;
  for (const id of ["nameLbl", "nameInput", "nameBtn"]) $(id).style.display = on ? "none" : "";
  $("acctWho").style.display = on ? "block" : "none";
  $("acctWho").textContent = on ? acct.username : "";
  $("acctBtn").textContent = on ? "Log out" : "Log in";
  $("hWho").textContent = on ? acct.username : ""; $("hAcct").textContent = on ? "Log out" : "Log in";
  $("ownerTabBtn").hidden = !isOwner();
  updateUgcBtn();
}
async function onSignedIn(user) {
  const sb = getSB();
  acct.user = user;
  let username = (user.user_metadata && user.user_metadata.username) || String(user.email || "").split("@")[0];
  let loaded = false, failed = false;
  try {
    const { data, error } = await sb.from(CFG.SAVE_TABLE).select("username, body_colors").eq("id", user.id).maybeSingle();
    if (error) failed = true;
    else if (data) { loaded = true; username = data.username || username; setMyColors(sanitizeColors(data.body_colors)); }
  } catch (_) { failed = true; }
  acct.username = cleanName(username) || "Player";
  setPlayerName(acct.username);
  await loadBadgeDefs();
  await getBadges([user.id]);
  acctUI();
  loadWallet(); loadInventory();
  if (!$("tabShop").hidden) renderShop();
  if (failed) saveStatus("Couldn't load your save (is the SQL set up?)");
  else if (!loaded) { saveStatus("Saving…"); await doSave(); }      // brand-new account: keep the colours you already picked
}
async function logOut() {
  await flushSave();
  const sb = getSB();
  try { if (sb) await sb.auth.signOut({ scope: "local" }); } catch (_) {}
  acct.user = null; acct.username = "";
  setPlayerName(guestName);
  setMyColors(loadGuestColors());
  acctUI();
}

/* ---- login popup ---- */
const authUser = $("authUser"), authPass = $("authPass"), authGo = $("authGo");
function authMsg(t, err) { const m = $("authMsg"); m.textContent = t || ""; m.classList.remove("err"); void m.offsetWidth; m.classList.toggle("err", !!err); }
function setAuthMode(mode) {
  acct.mode = mode;
  const su = mode === "signup";
  $("authAsk").textContent = su ? "Have an account?" : "No account?"; $("authLink").textContent = su ? "Sign in" : "Create one";
  $("authTitle").textContent = su ? "Create account" : "Sign in";
  authGo.textContent = su ? "Create account" : "Sign in";
  authPass.autocomplete = su ? "new-password" : "current-password";
  authMsg("");
  playIn($("authForm"));
}
function openAuth(mode) {
  freeMouse(); setAuthMode(mode || "login"); authEl.classList.add("open");
  setTimeout(() => authUser.focus(), 0);
}
function playIn(el) { el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter"); }
function closeAuth() {
  authUser.blur(); authPass.blur(); authEl.classList.add("leaving"); playIn($("home"));
  setTimeout(() => authEl.classList.remove("open", "leaving"), 200);
}
function friendlyAuthError(e, mode) {
  const msg = String(e && e.message || ""), code = String(e && e.code || "");
  if (code === "user_already_exists" || /already registered/i.test(msg)) return "That username is taken.";
  if (code === "invalid_credentials" || /invalid login/i.test(msg)) return "Wrong username or password.";
  if (code === "email_not_confirmed" || /not confirmed/i.test(msg)) return "Supabase is still asking for email confirmation. Turn off Confirm email in Authentication settings.";
  if (code === "over_request_rate_limit" || e.status === 429) return "Too many tries, wait a minute and try again.";
  if (code === "email_address_invalid" || /address .* is invalid/i.test(msg)) return "Supabase rejected the fake email domain. Set AUTH_EMAIL_DOMAIN in CFG to a domain that has MX records.";
  if (code === "weak_password") return msg || "Password is too weak.";
  return msg || (mode === "signup" ? "Couldn't create the account." : "Couldn't log in.");
}
async function submitAuth() {
  if (acct.busy) return;
  const sb = getSB();
  if (!sb) return authMsg("Supabase isn't set up yet. Put SUPABASE_URL and SUPABASE_ANON_KEY in CFG at the top of index.html.", true);
  const u = authUser.value.trim(), pw = authPass.value;
  if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) return authMsg("Username: 3-20 letters, numbers or _", true);
  if (pw.length < 6) return authMsg("Password must be at least 6 characters.", true);
  acct.busy = true; authGo.disabled = true;
  authMsg(acct.mode === "signup" ? "Creating account…" : "Logging in…");
  let email = u.toLowerCase() + "@" + CFG.AUTH_EMAIL_DOMAIN;
  try {
    if (acct.mode === "signup") {                                  // old usernames can't be taken by someone else
      try { const a = await sb.rpc("username_available", { p_username: u }); if (!a.error && a.data === false) { authMsg("That username is taken.", true); return; } } catch (_) {}
    } else {                                                       // logging in uses your CURRENT username, even after you changed it
      try { const r = await sb.rpc("login_email_for", { p_username: u }); if (!r.error && r.data) { if (r.data === "!") { authMsg("Wrong username or password.", true); return; } email = r.data; } } catch (_) {}
    }
    const res = acct.mode === "signup"
      ? await sb.auth.signUp({ email, password: pw, options: { data: { username: u } } })
      : await sb.auth.signInWithPassword({ email, password: pw });
    if (res.error) { authMsg(friendlyAuthError(res.error, acct.mode), true); return; }
    const user = res.data && res.data.user, session = res.data && res.data.session;
    if (!user || !session) { authMsg("Account made, but Supabase wants email confirmation. Turn off Confirm email in Authentication settings.", true); return; }
    authPass.value = "";
    await onSignedIn(user);
    closeAuth(); showTab("home"); appRunPendingJoin();
  } catch (_) { authMsg("Couldn't reach the server. Try again.", true); }
  finally { acct.busy = false; authGo.disabled = false; }
}
authGo.addEventListener("click", submitAuth);
$("authLink").addEventListener("click", () => setAuthMode(acct.mode === "signup" ? "login" : "signup"));
const signOutNow = () => logOut().then(() => location.reload(), () => location.reload());
$("acctBtn").addEventListener("click", signOutNow);
$("hAcct").addEventListener("click", signOutNow);
for (const el of [authUser, authPass]) el.addEventListener("keydown", e => {
  e.stopPropagation();
  if (e.key === "Enter") submitAuth();
});
authUser.addEventListener("focus", () => { for (const k in keys) keys[k] = false; });
authPass.addEventListener("focus", () => { for (const k in keys) keys[k] = false; });
