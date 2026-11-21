"use strict";

/* ---- welcome ---- */
async function renderHome() {
  if (!acct.user) return;
  $("wName").textContent = "Hello, " + acct.username + "!";
  $("wImg").dataset.tu = acct.user.id; $("wImg").src = thumb(myColors, "face", acct.user.id);
  $("wSub").textContent = "";
  await loadSocial();
  const f = SOC.friends.length, q = SOC.incoming.length;
  $("wSub").textContent = SOC.ok ? (q ? `You have ${q} friend request${q === 1 ? "" : "s"}.` : "Welcome back.") : "Welcome back.";
  $("wTitle").textContent = "Friends (" + f + ")";
  const shelf = SOC.ok ? SOC.friends.slice(0, 10).map(id => pcard(id)).join("") : "";
  $("wFriends").innerHTML = !SOC.ok ? noteSQL : (shelf + (f > 10 ? '<button class="pcard moreCard" type="button" data-go="friends">+' + (f - 10) + '</button>' : "")
    || '<div class="note">No friends yet.</div>');
}

/* ---- friends tab ---- */
let searchT = 0;
async function renderFriends() {
  if (!acct.user) return;
  await loadSocial();
  $("fReqWrap").hidden = !SOC.incoming.length; $("fReqT").textContent = "Requests (" + SOC.incoming.length + ")";
  $("fReqs").innerHTML = SOC.incoming.map(id => { const p = SOC.cache.get(id); if (!p) return "";
    return `<div class="reqRow box"><img alt="" data-pid="${esc(id)}" src="${thumb(p.body_colors, "face", id)}"><b data-pid="${esc(id)}">${esc(p.username)}</b><button class="btnP" data-act="accept" data-id="${esc(id)}" type="button">Accept</button><button class="btnG" data-act="remove" data-id="${esc(id)}" type="button">Decline</button></div>`; }).join("");
  $("fTitle").textContent = "Your friends (" + SOC.friends.length + ")";
  $("fList").innerHTML = !SOC.ok ? noteSQL : (SOC.friends.length ? SOC.friends.map(id => pcard(id)).join("") : '<div class="note">No friends yet. Search for a username above.</div>');
}
$("fSearch").addEventListener("keydown", e => e.stopPropagation());
$("fSearch").addEventListener("input", () => {
  clearTimeout(searchT);
  const q = $("fSearch").value.trim().replace(/[^A-Za-z0-9_]/g, "");
  if (!q) { $("fResults").innerHTML = ""; return; }
  searchT = setTimeout(async () => {
    const sb = getSB(); if (!sb) return;
    let rows = [];
    try { let r = await sb.from(CFG.SAVE_TABLE).select("id, username, body_colors, player_number").ilike("username", q + "%").limit(12);
      if (r.error) r = await sb.from(CFG.SAVE_TABLE).select("id, username, body_colors").ilike("username", q + "%").limit(12); rows = r.data || []; } catch (_) {}
    rows = rows.filter(p => p.id !== acct.user.id);
    for (const p of rows) SOC.cache.set(p.id, p);
    await getBadges(rows.map(p => p.id));
    $("fResults").innerHTML = rows.length ? '<div class="grid">' + rows.map(p => pcard(p.id)).join("") + "</div>" : '<div class="note">No players found.</div>';
  }, 250);
});

/* ---- profile page ---- */
async function renderProfile(id) {
  if (!id) return;
  const body = $("pBody"); body.innerHTML = '<div class="muted">Loading…</div>';
  await loadSocial();
  await getProfiles([id], true);
  const me = acct.user.id, mine = id === me, p = SOC.cache.get(id);
  if (!p) { body.innerHTML = '<div class="note">Couldn\'t find that player.</div>'; return; }
  const colors = mine ? myColors : p.body_colors;
  const wornP = mine ? Promise.resolve() : fetchWorn([id]);
  let theirFriends = [];
  if (mine) theirFriends = SOC.friends;
  else {
    try {
      const r = await getSB().from(FR_TABLE).select("requester, addressee").eq("status", "accepted").or(`requester.eq.${id},addressee.eq.${id}`);
      theirFriends = (r.data || []).map(f => f.requester === id ? f.addressee : f.requester);
      await getProfiles(theirFriends);
    } catch (_) {}
  }
  const joined = p.created_at || (mine && acct.user.created_at);
  const joinedTxt = joined ? new Date(joined).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "-";
  const rel = relation(id), I = esc(id);
  const acts = mine ? '<button class="btnG" id="pEditAv" type="button">Customize avatar</button>' :
    rel === "friend" ? `<button class="btnG" data-act="remove" data-id="${I}" type="button">Unfriend</button>` :
    rel === "incoming" ? `<button class="btnP" data-act="accept" data-id="${I}" type="button">Accept</button><button class="btnG" data-act="remove" data-id="${I}" type="button">Decline</button>` :
    rel === "outgoing" ? `<button class="btnG" data-act="remove" data-id="${I}" type="button">Request sent</button>` :
    `<button class="btnP" data-act="add" data-id="${I}" type="button">Add friend</button>`;
  const about = p.about && p.about.trim() ? esc(p.about) : '<span class="muted">' + (mine ? "You haven't written a bio yet." : "This user has no bio yet.") + "</span>";
  body.innerHTML = `
    <div id="pHead">
      <img id="pFace" alt="" data-tu="${esc(id)}" src="${thumb(colors, "face", id)}">
      <div id="pInfo">
        <div id="pNameRow"><h2 id="pName">${esc(p.username)}</h2>${badgeList(id).length ? `<span class="bdgs" id="pBadges">${bigBadges(id)}</span>` : ""}</div>
        <div id="pStats">${p.player_number ? `<div><b>#${esc(p.player_number)}</b>Player ID</div>` : ""}<div><b>${theirFriends.length}</b>Friends</div><div><b>${esc(joinedTxt)}</b>Joined</div></div>
      </div>
      <div id="pActs">${acts}</div>
    </div>
    <div id="pStage">
      <div id="pvBox"><span id="pvWear"></span><button id="pvReset" type="button" title="Face the front">Reset</button><em>drag to turn</em></div>
      <div id="pItemsWrap"><div id="pItems" aria-label="Items worn"></div></div>
    </div>
    <div id="pAbout" class="box"><h4>Bio ${mine ? '<button class="linkBtn" id="pEdit" type="button">Edit</button>' : ""}</h4><div id="pAboutBody"><p>${about}</p></div></div>
    <div id="pFriends" class="box"><h4>Friends</h4><div id="pFrRow"></div></div>`;
  profileFriends(theirFriends, false);
  profileStage(id, colors, wornP);
  if (!mine) addSafetyBtns(p);
  if (mine) {
    $("pEditAv").addEventListener("click", () => showTab("avatar"));
    $("pEdit").addEventListener("click", () => {
      $("pAboutBody").innerHTML = `<textarea id="pTa" maxlength="200" spellcheck="false"></textarea><div class="editRow"><button class="btnP" id="pSave" type="button">Save</button><button class="btnG" id="pCancel" type="button">Cancel</button><span class="muted" id="pMsg"></span></div>`;
      const ta = $("pTa"); ta.value = p.about || ""; ta.focus();
      ta.addEventListener("keydown", e => e.stopPropagation());
      $("pCancel").addEventListener("click", () => renderProfile(id));
      $("pSave").addEventListener("click", async () => {
        $("pMsg").textContent = "Saving…";
        const r = await getSB().from(CFG.SAVE_TABLE).update({ about: ta.value.trim().slice(0, 200) }).eq("id", me);
        if (r.error) $("pMsg").textContent = "Couldn't save (run supabase_social.sql)"; else renderProfile(id);
      });
    });
  }
}

/* ---- shared click handling ---- */
$("home").addEventListener("click", e => {
  const act = e.target.closest("[data-act]");
  if (act) { act.disabled = true; friendAct(act.dataset.act, act.dataset.id).then(() => {
    if (!$("tabProfile").hidden) renderProfile(SOC.viewId || acct.user.id); else renderFriends(); }); return; }
  const pid = e.target.closest("[data-pid]");
  if (pid) { SOC.viewId = pid.dataset.pid; showTab("profile"); SOC.viewId = pid.dataset.pid; return; }
  const go = e.target.closest("[data-go]");
  if (go) { e.preventDefault(); showTab(go.dataset.go); }
});
