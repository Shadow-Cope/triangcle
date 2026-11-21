"use strict";

/* =====================================================================
   FACES (Avatar tab), PLAYERS page, OWNER page
   ===================================================================== */
(function buildFacesUI() {
  const grid = $("faceGrid");
  FACE_NAMES.forEach((nm, k) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "faceBtn"; b.dataset.f = k;
    b.innerHTML = '<span class="faceTile"><img alt="" src="' + FACE_SRC[k] + '"></span><span>' + nm + "</span>";
    b.addEventListener("click", () => { myColors.face = k; colorsChanged(); });
    grid.appendChild(b);
  });
  for (const t of document.querySelectorAll("#avTabs button")) t.addEventListener("click", () => {
    const f = t.dataset.av === "faces", it = t.dataset.av === "items";
    for (const x of document.querySelectorAll("#avTabs button")) x.classList.toggle("on", x === t);
    $("avColors").hidden = f || it; $("avFaces").hidden = !f; $("avItems").hidden = !it;
    if (f) refreshFacesUI();
    if (it) renderAvItems();
  });
})();
for (const b of document.querySelectorAll("#avBody button")) b.addEventListener("click", () => { myColors.body = b.dataset.body === "female" ? "female" : "male"; colorsChanged(); });
function refreshFacesUI() {
  for (const b of $("faceGrid").children) {
    b.classList.toggle("on", +b.dataset.f === myColors.face);
    b.firstChild.style.background = myColors.Head;
  }
}
