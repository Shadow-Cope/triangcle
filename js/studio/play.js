"use strict";

/* =====================================================================
   Triancle Studio - Play mode (playtest)
   Embeds the real game (index.html?playtest=1) in the viewport, so a
   playtest runs the same bundle the website ships: same avatar, skin,
   physics, camera, climbing, reset, HUD and map builder. Only accounts,
   the home screen and multiplayer are skipped.

   The map is handed over through sessionStorage (same origin, same tab),
   and the embedded game talks back with postMessage. The editor keeps its
   normal layout; Stop lives next to Play in the Home ribbon.
   ===================================================================== */
const StudioPlay = (function () {
  const KEY = "triangle_studio_playtest";
  const ORIGIN = location.origin === "null" ? "*" : location.origin;

  let frame = null, viewport = null, onStop = null, running = false;

  function start(options) {
    if (running) return false;
    const opt = options || {};
    viewport = opt.viewport || document.getElementById("stViewport");
    onStop = opt.onStop || null;
    if (!viewport) return false;

    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        map: opt.map,
        spawnHere: !!opt.spawnHere,
        spawn: opt.spawn || null,
        name: opt.name || "",
      }));
    } catch (_) {
      return false;
    }

    running = true;
    frame = document.createElement("iframe");
    frame.className = "stPlayFrame";
    frame.title = "Playtest";
    frame.src = "index.html?playtest=1";
    frame.setAttribute("allow", "autoplay");
    frame.addEventListener("load", () => {
      try { frame.contentWindow.focus(); } catch (_) {}
    });
    viewport.appendChild(frame);
    window.addEventListener("message", onMessage);
    return true;
  }

  function stop() {
    if (!running) return;
    running = false;
    window.removeEventListener("message", onMessage);
    if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
    frame = null;
    try { sessionStorage.removeItem(KEY); } catch (_) {}
    const done = onStop;
    onStop = null;
    if (typeof done === "function") done();
  }

  function onMessage(e) {
    if (ORIGIN !== "*" && e.origin !== ORIGIN) return;
    const data = e.data;
    if (!data || data.type !== "triancle-playtest") return;
    if (data.action === "stop" || data.action === "error") stop();
    else if (data.action === "ready" && frame) {
      try { frame.contentWindow.focus(); } catch (_) {}
    }
  }

  return {
    start,
    stop,
    isPlaying: () => running,
  };
})();
