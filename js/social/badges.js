"use strict";

/* ---- badges: given out only by the Owner (enforced in Supabase, see supabase_schema.sql) ---- */
const BADGES = { owner: "Owner", admin: "Admin", mod: "Moderator", ugc: "Official UGC Creator", bugfinder: "Bug Finder", alpha: "Alpha Publisher" };
const BADGE_ORDER = ["owner", "admin", "mod", "ugc", "bugfinder", "alpha"];
const BADGE_PERMS = { owner: { can_ugc: true, can_edit_items: true }, ugc: { can_ugc: true }, alpha: { can_studio: true, can_publish: true } };   // what each badge lets you do
const BADGE_BUILTIN = BADGE_ORDER.slice();
const BADGE_IMG = {"owner": "assets/badges/owner.png", "admin": "assets/badges/admin.png", "mod": "assets/badges/mod.png", "ugc": "assets/badges/ugc.png", "bugfinder": "assets/badges/bugfinder.png", "alpha": "assets/badges/alpha.png?v=1"};
/* Badges the Owner made in the site (table badge_defs, see supabase_schema.sql). They join the built-in five. */
async function loadBadgeDefs() {
  const sb = getSB(); if (!sb) return;
  try {
    const r = await sb.from("badge_defs").select("key, name, image, can_ugc, can_edit_items").order("created_at", { ascending: true });
    if (r.error) throw r.error;
    for (const k of BADGE_ORDER.slice()) if (!BADGE_BUILTIN.includes(k)) { delete BADGES[k]; delete BADGE_IMG[k]; delete BADGE_PERMS[k]; BADGE_ORDER.splice(BADGE_ORDER.indexOf(k), 1); }
    for (const d of (r.data || [])) {
      if (BADGE_BUILTIN.includes(d.key)) continue;
      BADGES[d.key] = d.name; BADGE_IMG[d.key] = d.image; BADGE_ORDER.push(d.key);
      BADGE_PERMS[d.key] = { can_ugc: !!d.can_ugc, can_edit_items: !!d.can_edit_items };
    }
    SOC.defsOK = true;
  } catch (_) { SOC.defsOK = false; }
  rebuildBadgeFilter();
}
function rebuildBadgeFilter() {                                     // the Players page filter lists every badge
  const sel = document.getElementById("plFilter"); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="all">Everyone</option><option value="friends">Friends</option><option value="any">Any badge</option>'
    + BADGE_ORDER.map(k => `<option value="${esc(k)}">${esc(BADGES[k])}</option>`).join("");
  sel.value = Array.from(sel.options).some(o => o.value === cur) ? cur : "all";
}
const rustPermission = mode => acct.user && window.TriancleRust && window.TriancleRust.accountPermission
  ? window.TriancleRust.accountPermission(String(acct.user.email || ""),String(CFG.AUTH_EMAIL_DOMAIN),SOC.badges.get(acct.user.id) || [],BADGE_PERMS,mode) : null;
const hasBadgePerm = perm => { const value = rustPermission(perm); return value !== null ? value : !!(acct.user && (isOwner() || badgeList(acct.user.id).some(k => BADGE_PERMS[k] && BADGE_PERMS[k][perm]))); };
async function getBadges(ids) {
  const sb = getSB(); ids = [...new Set(ids)]; if (!sb || !ids.length) return;
  try {
    const r = await sb.from("badges").select("user_id, badge").in("user_id", ids);
    if (r.error) throw r.error;
    for (const id of ids) SOC.badges.set(id, []);
    const rows = r.data || [], users = [...SOC.badges.keys()];
    const groups = window.TriancleRust && window.TriancleRust.groupBadges && Array.isArray(rows) && rows.every(b => b && typeof b.badge === "string") ? window.TriancleRust.groupBadges(users,rows,rows.filter(b => BADGES[b.badge]).map(b => b.badge)) : null;
    if (groups) { for (let i = 0; i < users.length; i++) for (const badge of groups[i]) SOC.badges.get(users[i]).push(badge); }
    else for (const b of rows) if (BADGES[b.badge] && SOC.badges.has(b.user_id)) SOC.badges.get(b.user_id).push(b.badge);
    SOC.badgeOK = true;
  } catch (_) { SOC.badgeOK = false; }
}
const badgeList = id => { const badges = SOC.badges.get(id) || []; if (window.TriancleRust && window.TriancleRust.orderedBadges) { const result = window.TriancleRust.orderedBadges(badges,BADGE_ORDER); if (result) return result; } return badges.slice().sort((a, b) => BADGE_ORDER.indexOf(a) - BADGE_ORDER.indexOf(b)); };
const smallBadges = id => badgeList(id).map(k => `<img alt="${BADGES[k]}" title="${BADGES[k]}" src="${BADGE_IMG[k]}">`).join("");
const bigBadges = id => badgeList(id).map(k => `<span class="bdg" tabindex="0" data-name="${BADGES[k]}"><img alt="${BADGES[k]}" src="${BADGE_IMG[k]}"></span>`).join("");
function isOwner() { const value = rustPermission("owner"); return value !== null ? value : !!(acct.user && (String(acct.user.email || "").toLowerCase() === "owen@" + String(CFG.AUTH_EMAIL_DOMAIN).toLowerCase() || badgeList(acct.user.id).includes("owner"))); }
const pcard = (id, sub) => {
  const p = SOC.cache.get(id); if (!p) return "";
  const bd = smallBadges(id), meta = [sub].filter(Boolean).join(" · ");
  return `<button class="pcard box" type="button" data-pid="${esc(id)}"><img class="pface" alt="" src="${thumb(p.body_colors, "face", id)}"><span class="pn" title="@${esc(p.username)}">${esc(dn(p))}</span>${bd ? `<span class="pbd">${bd}</span>` : ""}${meta ? `<span class="ps">${esc(meta)}</span>` : ""}</button>`;
};
const noteSQL = '<div class="note">Run supabase_schema.sql in Supabase once to turn on friends.</div>';
