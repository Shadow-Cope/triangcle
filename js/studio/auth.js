"use strict";

/* =====================================================================
   Triancle Studio - sign in + Alpha Publisher gate
   Accounts are created on the main Triancle website; Studio only signs in.
   ===================================================================== */
const StudioAuth = (function () {
  const $ = id => document.getElementById(id);
  const ALPHA_BADGE = "alpha";
  const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

  let sb = null;
  let busy = false;
  let currentUser = null;
  let currentName = "";

  function client() {
    if (sb) return sb;
    if (!window.supabase || !window.supabase.createClient) return null;
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) return null;
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    return sb;
  }

  function setState(which) {
    $("stAuthLoading").hidden = which !== "loading";
    $("stLoginForm").hidden = which !== "login";
    $("stGate").hidden = which !== "gate";
    $("stAuth").hidden = which === "open";
    $("stMenu").hidden = which !== "open";
  }

  function loginMsg(text, kind) {
    const m = $("stLoginMsg");
    m.textContent = text || "";
    m.className = "stAuthMsg" + (kind ? " " + kind : "");
  }

  function showLogin(message) {
    setState("login");
    loginMsg(message || "");
    setTimeout(() => $("stLoginUser").focus(), 30);
  }

  function showGate(options) {
    const opt = options || {};
    setState("gate");
    $("stGateText").textContent = opt.text || "You need alpha publisher to use Triancle Studio, submit creations on the discord server to apply for alpha publisher";
    $("stGateWho").textContent = currentName ? "Signed in as " + currentName : "";
    $("stGateRetry").hidden = !opt.retry;
  }

  function setAccount(name) {
    $("stAccountUser").textContent = name;
    $("stAccountSub").textContent = "Alpha Publisher";
    $("stAccountAvatar").textContent = (name || "T").slice(0, 1).toUpperCase();
    $("stAccountBadge").hidden = false;
  }

  function openStudio(user, name) {
    currentUser = user;
    currentName = name;
    setAccount(name);
    $("stAccountMenu").hidden = true;
    $("stAccount").setAttribute("aria-expanded", "false");
    setState("open");
  }

  function closeAccountMenu() {
    $("stAccountMenu").hidden = true;
    $("stAccount").setAttribute("aria-expanded", "false");
  }

  async function profileName(user) {
    let name = (user.user_metadata && user.user_metadata.username) || String(user.email || "").split("@")[0] || "Player";
    try {
      const r = await sb.from(CFG.SAVE_TABLE).select("username").eq("id", user.id).maybeSingle();
      if (!r.error && r.data && r.data.username) name = r.data.username;
    } catch (_) {}
    return String(name).slice(0, 20);
  }

  async function badgeKeys(user) {
    const r = await sb.from("badges").select("badge").eq("user_id", user.id);
    if (r.error) throw r.error;
    return (r.data || []).map(row => row.badge);
  }

  async function checkAccess(user) {
    setState("loading");
    currentUser = user;
    const name = await profileName(user);
    currentName = name;
    let badges;
    try {
      badges = await badgeKeys(user);
    } catch (_) {
      showGate({
        text: "We couldn't check your Alpha Publisher badge. Check your connection and try again.",
        retry: true,
      });
      return;
    }
    if (badges.includes(ALPHA_BADGE)) openStudio(user, name);
    else showGate();
  }

  function friendlyAuthError(e) {
    const code = String(e && e.code || ""), msg = String(e && e.message || "");
    if (code === "invalid_credentials" || /invalid login/i.test(msg)) return "Wrong username or password.";
    if (code === "over_request_rate_limit" || (e && e.status === 429)) return "Too many tries, wait a minute and try again.";
    if (code === "email_not_confirmed") return "This account can't sign in right now.";
    return msg || "Couldn't sign in.";
  }

  async function submitLogin(e) {
    if (e) e.preventDefault();
    if (busy) return;
    const username = $("stLoginUser").value.trim();
    const password = $("stLoginPass").value;
    if (!USERNAME_RE.test(username)) return loginMsg("Username: 3-20 letters, numbers or _", "err");
    if (!password) return loginMsg("Enter your password.", "err");
    busy = true;
    $("stLoginGo").disabled = true;
    loginMsg("Signing in…");
    try {
      let email = username.toLowerCase() + "@" + CFG.AUTH_EMAIL_DOMAIN;
      try {
        const r = await sb.rpc("login_email_for", { p_username: username });
        if (!r.error && r.data) {
          if (r.data === "!") { loginMsg("Wrong username or password.", "err"); return; }
          email = r.data;
        }
      } catch (_) {}
      const res = await sb.auth.signInWithPassword({ email, password });
      if (res.error) { loginMsg(friendlyAuthError(res.error), "err"); return; }
      const user = res.data && res.data.user;
      if (!user) { loginMsg("Couldn't sign in.", "err"); return; }
      $("stLoginPass").value = "";
      loginMsg("");
      await checkAccess(user);
    } catch (_) {
      loginMsg("Couldn't reach the server. Try again.", "err");
    } finally {
      busy = false;
      $("stLoginGo").disabled = false;
    }
  }

  async function signOut() {
    closeAccountMenu();
    try { if (sb) await sb.auth.signOut({ scope: "local" }); } catch (_) {}
    currentUser = null;
    currentName = "";
    if (window.StudioEditor && StudioEditor.isOpen && StudioEditor.isOpen()) {
      try { StudioEditor.close(false); } catch (_) {}
    }
    showLogin();
  }

  function bindAccount() {
    $("stAccount").addEventListener("click", e => {
      e.stopPropagation();
      const menu = $("stAccountMenu");
      const open = menu.hidden;
      menu.hidden = !open;
      $("stAccount").setAttribute("aria-expanded", open ? "true" : "false");
    });
    $("stSignOut").addEventListener("click", signOut);
    document.addEventListener("pointerdown", e => {
      if (!e.target.closest(".rsAccountWrap")) closeAccountMenu();
    });
    window.addEventListener("keydown", e => { if (e.key === "Escape") closeAccountMenu(); });
  }

  async function init() {
    bindAccount();
    $("stLoginForm").addEventListener("submit", submitLogin);
    $("stGateOut").addEventListener("click", signOut);
    $("stGateRetry").addEventListener("click", () => { if (currentUser) checkAccess(currentUser); else init(); });
    try {
      const url = new URL("index.html", location.href);
      $("stCreateLink").href = url.href;
    } catch (_) {}

    const c = client();
    if (!c) {
      showLogin("Studio sign-in isn't configured. Add SUPABASE_URL and SUPABASE_ANON_KEY in js/core/config.js.");
      $("stLoginGo").disabled = true;
      return;
    }

    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        currentUser = null;
        currentName = "";
        if (window.StudioEditor && StudioEditor.isOpen && StudioEditor.isOpen()) {
          try { StudioEditor.close(false); } catch (_) {}
        }
        showLogin();
      }
    });

    try {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      if (data && data.session && data.session.user) await checkAccess(data.session.user);
      else showLogin();
    } catch (_) {
      showLogin("Couldn't check your account. Try again.");
    }
  }

  const api = { init, signOut, checkAccess, showGate, showLogin, currentUser: () => currentUser };
  return api;
})();

StudioAuth.init();
