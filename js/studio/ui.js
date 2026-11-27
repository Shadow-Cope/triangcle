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
      title: "Camera & play controls",
      body: `<table class="rsHelpTable">
        <tr><td><span class="rsKey">W A S D</span></td><td>Move the camera</td></tr>
        <tr><td><span class="rsKey">Right-drag</span></td><td>Look around</td></tr>
        <tr><td><span class="rsKey">Middle-drag</span></td><td>Pan the camera</td></tr>
        <tr><td><span class="rsKey">Q</span> / <span class="rsKey">E</span></td><td>Move down / up</td></tr>
        <tr><td><span class="rsKey">Wheel</span></td><td>Zoom in and out</td></tr>
        <tr><td><span class="rsKey">Shift</span></td><td>Move faster</td></tr>
        <tr><td><span class="rsKey">Ctrl + S</span></td><td>Save the game</td></tr>
        <tr><td><span class="rsKey">F5</span></td><td>Play the game from the spawn point</td></tr>
        <tr><td><span class="rsKey">Shift + F5</span></td><td>Play here, where the camera is</td></tr>
        <tr><td><span class="rsKey">Esc</span></td><td>Stop playing and go back to editing</td></tr>
      </table>
      <div class="rsAbout" style="margin-top:12px">In play mode: <b>WASD</b> walk, <b>Space</b> jump (hold to keep hopping),
      <b>Shift</b> sprint, drag to look around, wheel to zoom, <b>R</b> go back to the spawn point. You can also use the
      <b>Play</b> button in the Home ribbon or <b>Test &gt; Play game</b>.</div>
      <div class="rsAbout" style="margin-top:12px"><b>UI editing:</b> select <b>StarterGUI</b> in the Explorer and press the
      <b>+</b> on its row to insert a ScreenGui. Inside a ScreenGui, Frame or Folder, <b>+</b> inserts Frame, TextLabel,
      TextButton, ImageLabel, ImageButton and Folder. Any visual object can also take <b>UICorner</b>, <b>UIStroke</b>,
      <b>UIGradient</b>, <b>UIPadding</b>, <b>UIListLayout</b>, <b>UIGridLayout</b>, <b>UIAspectRatioConstraint</b> and
      <b>UIScale</b> from its <b>+</b> menu. Drag an object to move it, drag the white handles to resize it, and edit
      Position/Size as <b>Scale X, Offset X, Scale Y, Offset Y</b> in Properties. Right-click an object for
      <b>Copy</b>, <b>Cut</b>, <b>Paste Into</b>, <b>Duplicate</b> (<b>Ctrl+D</b>), <b>Rename</b> (<b>F2</b>) and <b>Delete</b>.</div>
      <div class="rsAbout" style="margin-top:12px"><b>Block scripts:</b> insert a <b>Script</b> (server) or <b>LocalScript</b>
      (client) from Workspace, ReplicatedStorage or StarterGUI - or hover a part and press its <b>+</b> to attach a
      script straight to it - then double-click it to open the block editor.
      Drag blocks from the left palette into the stack: a blue line shows where they will land, so you can reorder,
      nest into <b>repeat</b>/<b>if</b> bodies, or drop on the canvas to add at the end. Drop a block on <b>Delete</b>
      (bottom of the palette) to remove it. Hats: <b>when game starts</b>, <b>when an object is clicked</b>,
      <b>when an object is hovered</b>, <b>when the player touches a part</b>, <b>when this part is touched</b>
      (scripts on a part), <b>when a variable changes</b>, <b>when the player dies</b>, <b>when the player respawns</b>
      or <b>every N seconds</b>. <b>Make a Variable</b> in the palette for score/health; variables are shared by every
      script. Variable blocks cover set/change, copy one variable into another, add/subtract, multiply, divide,
      percentages, min/max, rounding up/down, absolute values, toggles, random numbers and <b>if a variable is between</b>.
      <b>Parts &amp; Player</b> blocks recolour, hide/show, move, resize, rotate, retint with a material, or
      <b>spawn / clone</b> parts (the new part's name is stored in a variable so another block can move or destroy it),
      teleport the player, change walk speed / jump power / gravity from plain numbers or variables, toggle
      <b>CanCollide</b>, <b>anchor</b> parts (unanchored parts fall), <b>tween</b> a part to a position over time,
      and set <b>health</b> (max health, set, damage, heal, kill, respawn) - <b>when this part is touched &rarr;
      kill player</b> makes a killbrick. UI blocks set text, size, position, colours, text size, rotation and
      transparency, flash a label, show/hide from a variable, or tween a UI element to a new screen position.
      <b>Folders and Models</b> in Workspace group parts: press <b>+</b> on Workspace or a folder to add them, drag parts
      or folders onto a folder/model to move them in, and drag them back onto Workspace to take them out. Ctrl-click
      parts (or Shift-click for a range) to select several at once; the gizmo moves, rotates or scales them together.
      You can also drag scripts and UI objects in the Explorer to move them between services, folders and parts. Try
      <b>Home &gt; Open a Template &gt; Relay Ascent</b> for a finished example.</div>`,
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
