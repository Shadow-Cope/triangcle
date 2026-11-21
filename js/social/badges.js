"use strict";

/* ---- badges: given out only by the Owner (enforced in Supabase, see supabase_badges.sql) ---- */
const BADGES = { owner: "Owner", admin: "Admin", mod: "Moderator", ugc: "Official UGC Creator", bugfinder: "Bug Finder" };
const BADGE_ORDER = ["owner", "admin", "mod", "ugc", "bugfinder"];
const BADGE_IMG = {"owner": "assets/badges/owner.png", "admin": "assets/badges/admin.png", "mod": "assets/badges/mod.png", "ugc": "assets/badges/ugc.png", "bugfinder": "assets/badges/bugfinder.png"};
async function getBadges(ids) {
  const sb = getSB(); ids = [...new Set(ids)]; if (!sb || !ids.length) return;
  try {
    const r = await sb.from("badges").select("user_id, badge").in("user_id", ids);
    if (r.error) throw r.error;
    for (const id of ids) SOC.badges.set(id, []);
    for (const b of (r.data || [])) if (BADGES[b.badge] && SOC.badges.has(b.user_id)) SOC.badges.get(b.user_id).push(b.badge);
    SOC.badgeOK = true;
  } catch (_) { SOC.badgeOK = false; }
}
const badgeList = id => (SOC.badges.get(id) || []).slice().sort((a, b) => BADGE_ORDER.indexOf(a) - BADGE_ORDER.indexOf(b));
const smallBadges = id => badgeList(id).map(k => `<img alt="${BADGES[k]}" title="${BADGES[k]}" src="${BADGE_IMG[k]}">`).join("");
const bigBadges = id => badgeList(id).map(k => `<span class="bdg" tabindex="0" data-name="${BADGES[k]}"><img alt="${BADGES[k]}" src="${BADGE_IMG[k]}"></span>`).join("");
function isOwner() { return !!(acct.user && (String(acct.user.email || "").toLowerCase() === "owen@" + String(CFG.AUTH_EMAIL_DOMAIN).toLowerCase() || badgeList(acct.user.id).includes("owner"))); }
const pcard = (id, sub) => {
  const p = SOC.cache.get(id); if (!p) return "";
  const bd = smallBadges(id), meta = [p.player_number ? "#" + p.player_number : "", sub].filter(Boolean).join(" · ");
  return `<button class="pcard box" type="button" data-pid="${esc(id)}"><img class="pface" alt="" src="${thumb(p.body_colors, "face", id)}"><span class="pn">${esc(p.username)}</span>${bd ? `<span class="pbd">${bd}</span>` : ""}${meta ? `<span class="ps">${esc(meta)}</span>` : ""}</button>`;
};
const noteSQL = '<div class="note">Run supabase_social.sql in Supabase once to turn on friends.</div>';
