"use strict";

const SECID = { ugc: "tabUgc", home: "tabHome", games: "tabGames", avatar: "tabAvatar", friends: "tabFriends", profile: "tabProfile", shop: "tabShop", players: "tabPlayers", owner: "tabOwner" };
function showTab(name) {
  if (name === "owner" && !isOwner()) name = "home";
  if (name === "ugc" && !canUgc()) name = "home";
  for (const b of document.querySelectorAll("#hTabs button")) b.classList.toggle("on", b.dataset.tab === name);
  $("pageGame").hidden = true; $("pageItem").hidden = true;
  for (const s of document.querySelectorAll(".tabsec")) s.hidden = s.id !== SECID[name];
  prevOn = name === "avatar";
  ugOn = name === "ugc";
  playIn($(SECID[name]));
  if (prevOn) { openColors(); if (!prevRunning) { prevRunning = true; requestAnimationFrame(prevLoop); } }
  if (name === "home") renderHome();
  if (name === "friends") renderFriends();
  if (name === "players") renderPlayers(true);
  if (name === "owner") { renderOwner(); renderOwnerGames(); }
  if (name === "shop") renderShop();
  if (name === "avatar") renderAvItems();
  if (name === "ugc") ugStart();
  if (name === "profile") renderProfile(SOC.viewId || (acct.user && acct.user.id));
  if (name !== "profile") SOC.viewId = null;
}
for (const b of document.querySelectorAll("#hTabs button")) b.addEventListener("click", () => showTab(b.dataset.tab));
