"use strict";

/* =====================================================================
   Triancle Studio - shared dialog helpers
   ===================================================================== */
const StudioUI = (function () {
  const $ = id => document.getElementById(id);
  let bound = false;

  function close() {
    $("stDialog").hidden = true;
  }

  function bind() {
    if (bound) return;
    bound = true;
    $("stDialogX").addEventListener("click", close);
    $("stDialog").addEventListener("pointerdown", e => { if (e.target === $("stDialog")) close(); });
    window.addEventListener("keydown", e => {
      if (e.key === "Escape" && !$("stDialog").hidden) { e.stopPropagation(); close(); }
    }, true);
  }

  function dialog(options) {
    bind();
    const opt = options || {};
    $("stDialogTitle").textContent = opt.title || "";
    $("stDialogBody").innerHTML = opt.body || "";
    const foot = $("stDialogFoot");
    foot.innerHTML = "";
    const buttons = opt.buttons && opt.buttons.length ? opt.buttons : [{ label: "Close" }];
    for (const item of buttons) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rsBtn" + (item.primary ? " rsBtnPrimary" : "") + (item.danger ? " rsBtnDanger" : "");
      b.textContent = item.label;
      b.addEventListener("click", () => {
        const keep = item.onClick ? item.onClick() : undefined;
        if (keep !== false) close();
      });
      foot.appendChild(b);
    }
    $("stDialog").hidden = false;
    const first = foot.querySelector(".rsBtnPrimary") || foot.querySelector(".rsBtn");
    if (first) first.focus();
  }

  function cameraHelp() {
    dialog({
      title: "Camera controls",
      body: `<table class="rsHelpTable">
        <tr><td><span class="rsKey">W A S D</span></td><td>Move the camera</td></tr>
        <tr><td><span class="rsKey">Right-drag</span></td><td>Look around</td></tr>
        <tr><td><span class="rsKey">Middle-drag</span></td><td>Pan the camera</td></tr>
        <tr><td><span class="rsKey">Q</span> / <span class="rsKey">E</span></td><td>Move down / up</td></tr>
        <tr><td><span class="rsKey">Wheel</span></td><td>Zoom in and out</td></tr>
        <tr><td><span class="rsKey">Shift</span></td><td>Move faster</td></tr>
        <tr><td><span class="rsKey">Ctrl + S</span></td><td>Save the game</td></tr>
      </table>`,
    });
  }

  function about() {
    dialog({
      title: "About Triancle Studio",
      body: `<div class="rsAbout"><b>Triancle Studio v1</b><br>
        A first version of the game maker: a baseplate, a Studio-style fly camera and saved games.<br><br>
        Games are stored on this device. Cloud saving and publishing to Triancle are planned for a later version.</div>`,
    });
  }

  return { dialog, close, cameraHelp, about };
})();
