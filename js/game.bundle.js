/* ---- js/core/app.js ---- */
"use strict";
/* ---- in-page popups (replaces the browser's own confirm / alert boxes) ---- */
function uiPopup(msg, okLabel, cancelLabel, danger) {
  return new Promise(resolve => {
    const ov = document.createElement("div"); ov.className = "uiPop";
    const box = document.createElement("div"); box.className = "uiPopBox"; box.setAttribute("role", "dialog");
    const t = document.createElement("div"); t.className = "uiPopMsg"; t.textContent = msg;
    const row = document.createElement("div"); row.className = "uiPopRow";
    let done = false;
    const end = v => { if (done) return; done = true; document.removeEventListener("keydown", key, true); ov.remove(); resolve(v); };
    const key = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(false); } else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); end(true); } };
    if (cancelLabel) { const c = document.createElement("button"); c.type = "button"; c.className = "uiPopBtn"; c.textContent = cancelLabel; c.onclick = () => end(false); row.appendChild(c); }
    const ok = document.createElement("button"); ok.type = "button"; ok.className = "uiPopBtn ok" + (danger ? " bad" : ""); ok.textContent = okLabel || "OK"; ok.onclick = () => end(true); row.appendChild(ok);
    box.appendChild(t); box.appendChild(row); ov.appendChild(box);
    ov.addEventListener("mousedown", e => { if (e.target === ov) end(false); });
    document.addEventListener("keydown", key, true);
    document.body.appendChild(ov); ok.focus();
  });
}
const uiConfirm = (msg, okLabel, danger) => uiPopup(msg, okLabel || "OK", "Cancel", danger);
const uiAlert = msg => uiPopup(msg, "OK", null, false);

/* ---- taxes & fees (the server enforces these in supabase_schema.sql; this only mirrors them for the screens).
   Kept at the very top with only function declarations so it can be used from anywhere, even at start-up. ---- */
var TAX_MAX = 1000000;
function kindOfItem(a) { if (window.TriancleRust && window.TriancleRust.itemKind) { const kind = window.TriancleRust.itemKind(a); if (kind !== null) return ["acc", "cloth", "face"][kind]; } return (a === "Shirt" || a === "Pants") ? "cloth" : a === "Face" ? "face" : "acc"; }
function uploadFee(a) { if (window.TriancleRust && window.TriancleRust.itemKind) { const kind = window.TriancleRust.itemKind(a); if (kind !== null) return window.TriancleRust.itemUploadFee(kind); } return { cloth: 5, acc: 150, face: 0 }[kindOfItem(a)]; }
function minPrice(a) { if (window.TriancleRust && window.TriancleRust.itemKind) { const kind = window.TriancleRust.itemKind(a); if (kind !== null) return window.TriancleRust.itemMinPrice(kind); } return { cloth: 5, acc: 50, face: 0 }[kindOfItem(a)]; }
function listFee(price, a) { if (kindOfItem(a) === "face") return 0; const n = +price || 0; return window.TriancleRust && window.TriancleRust.listingFee ? window.TriancleRust.listingFee(n, false) : Math.ceil(Math.max(0, n) * 0.15); }
function creatorShare(price) { return window.TriancleRust && window.TriancleRust.creatorShare ? window.TriancleRust.creatorShare(price) : Math.floor(price * 0.8); }
function fmtN(n) { return Number(n || 0).toLocaleString(); }
function feeErr(e, a) {
  const m = String(e && e.message || "");
  return m.includes("insufficient_funds") ? "Not enough Shapes."
    : m.includes("price_too_low") ? "Lowest price: " + fmtN(minPrice(a)) + " Shapes."
    : m.includes("bad_price") ? "Price must be 1,000,000 or less."
    : m.includes("not_allowed") ? "Not your item."
    : m.includes("not_found") ? "Item not found."
    : null;
}
function priceRuleText(a) { return kindOfItem(a) === "face" ? "Price (0 = free)" : "Price (" + fmtN(minPrice(a)) + " - 1,000,000)"; }


/* =====================================================================
   Desktop app: detect it, gate Play behind it, and open it with triancle:// links.
   - Inside the app (window.TriancleApp, or a "TriancleApp/x.y.z" user-agent) everything works as normal.
   - In a normal browser, pressing Play tries to open the app (triancle://join/<game>) and shows a download prompt.
   NOTE: this is a client-side gate - it keeps honest players on the app, it can't stop someone who edits the page.
   ===================================================================== */
const APP = (function () {
  const ua = navigator.userAgent, m = /TriancleApp\/([\d.]+)/.exec(ua);
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const os = mobile ? "mobile" : /Windows/i.test(ua) ? "win" : /Macintosh|Mac OS X/i.test(ua) ? "mac" : "other";
  const inApp = !!window.TriancleApp || !!m;
  if (inApp) document.documentElement.classList.add("inapp");
  return { in: inApp, os, version: m ? m[1] : String(window.TriancleApp && window.TriancleApp.version || ""), required: !!APP_CFG.REQUIRE_APP && !mobile, pendingJoin: null };
})();
const APP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function appDownloadUrl(os) {                                        // direct installer link, or the download page when none is published yet
  const base = APP_CFG.RELEASES_URL;
  if (!base) return "download.html";
  if (os === "mac" && APP_CFG.MAC_AVAILABLE === false) return "download.html";
  return base.replace(/\/*$/, "/") + (os === "win" ? APP_CFG.WIN_FILE : APP_CFG.MAC_FILE);
}

/* ---- ?join=<game> : links like https://yoursite/?join=baseplate ---- */
(function () {
  let j = null;
  try { j = new URLSearchParams(location.search).get("join"); } catch (_) {}
  if (!j || !APP_ID_RE.test(j)) return;
  try { history.replaceState(null, "", location.pathname + location.hash); } catch (_) {}
  if (APP.in) APP.pendingJoin = j;                                    // the app starts it once you're signed in
  else if (APP.required) setTimeout(() => showAppPrompt(j), 0);       // a browser asks the app to open it (or offers the download)
})();
async function appRunPendingJoin() {
  const id = APP.pendingJoin;
  if (!id || !APP.in || !acct.user || starting) return;
  APP.pendingJoin = null;
  try { await loadAllGames(); } catch (_) {}
  if (!GAMES.some(g => g.id === id)) return;                          // unknown game: stay on the home screen
  openGamePage(id); startGame();
}

/* ---- the "get the app / open the app" prompt ---- */
function appPromptEl() {
  let el = document.getElementById("appPrompt"); if (el) return el;
  el = document.createElement("div"); el.id = "appPrompt"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "apTitle");
  el.innerHTML = '<div class="apCard"><button class="apX" type="button" aria-label="Close">&times;</button>'
    + '<img class="apIcon" alt="" src="assets/img/app-icon.png">'
    + '<h2 id="apTitle">Play in the <img class="apName" alt="Triancle" src="assets/img/logo.png"> app</h2><p id="apText"></p><div id="apStatus"></div>'
    + '<div class="apBtns"><a id="apDl" class="apP"></a><button id="apOpen" class="apG" type="button">Open Triancle</button></div>'
    + '<div class="apMore"><a id="apDl2"></a><a href="download.html">All downloads</a></div></div>';
  document.body.appendChild(el);
  const close = () => el.classList.remove("on");
  el.querySelector(".apX").addEventListener("click", close);
  el.addEventListener("pointerdown", e => { if (e.target === el) close(); });
  el.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") close(); });
  el.querySelector("#apOpen").addEventListener("click", () => appTryOpen(el._game));
  return el;
}
function appLaunch(id) {                                              // triancle://join/<id> through a hidden frame (no scary error pages if it isn't installed)
  const f = document.createElement("iframe"); f.style.display = "none";
  f.src = "triancle://" + (id ? "join/" + encodeURIComponent(id) : "open");
  document.body.appendChild(f); setTimeout(() => f.remove(), 3000);
}
function appTryOpen(id) {
  const st = document.getElementById("apStatus"); st.className = ""; st.textContent = "Opening Triancle…";
  let left = false; const mark = () => { left = true; };
  window.addEventListener("blur", mark); document.addEventListener("visibilitychange", mark);
  appLaunch(id);
  setTimeout(() => {                                                  // a browser can't tell us if the app exists, so we go by whether focus moved away
    window.removeEventListener("blur", mark); document.removeEventListener("visibilitychange", mark);
    st.className = left ? "ok" : "warn";
    st.textContent = left ? "Triancle should be opening now. You can close this tab."
      : "Nothing opened? Then Triancle isn't installed yet. Download it below, install it, then press Play again.";
  }, 2200);
}
function showAppPrompt(gameId) {
  const el = appPromptEl(), id = APP_ID_RE.test(gameId || "") ? gameId : "";
  el._game = id;
  const mobile = APP.os === "mobile", other = APP.os === "other";
  const first = APP.os === "mac" ? "mac" : "win", second = first === "win" ? "mac" : "win", name = o => o === "win" ? "Windows" : "Mac";
  el.querySelector("#apText").textContent = mobile
    ? "Triancle games run in the desktop app, which is available for Windows and Mac computers. Open this page on a computer to get it."
    : "Games run in the free Triancle app for Windows and Mac. If you've already installed it, we'll open it for you.";
  const dl = el.querySelector("#apDl"), dl2 = el.querySelector("#apDl2");
  dl.hidden = dl2.hidden = mobile; el.querySelector("#apOpen").hidden = mobile;
  dl.href = appDownloadUrl(first); dl.textContent = APP_CFG.RELEASES_URL ? "Download for " + name(first) : "Get Triancle";
  dl2.href = appDownloadUrl(second); dl2.textContent = APP_CFG.RELEASES_URL ? "or for " + name(second) : ""; dl2.hidden = mobile || !APP_CFG.RELEASES_URL;
  if (other) dl.textContent = APP_CFG.RELEASES_URL ? "Download for Windows" : "Get Triancle";
  const st = el.querySelector("#apStatus"); st.className = ""; st.textContent = "";
  el.classList.add("on");
  if (!mobile) appTryOpen(id);
}

;

/* ---- js/core/renderer.js ---- */
"use strict";

/* =====================================================================
   Renderer / scene
   ===================================================================== */
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CFG.CAM_FOV, 1, 0.1, 3000);

let composer = null, cPR = 1, bloomPass = null, gfxLevel = 4;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (composer) composer.setSize(w * cPR, h * cPR);
}
window.addEventListener("resize", resize);
resize();

/* ---- lighting ---- */
scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x77777f, 0.75));
const sun = new THREE.DirectionalLight(0xfff3dd, 0.7);
const SUN_DIR = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 160;
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);

/* ---- graphics levels 1-5 ---- */
const GFX = {
  1: { res: 0,    pr: 0.6, range: 30, bloom: false },   // no shadows, low res
  2: { res: 512,  pr: 1,   range: 30, bloom: false },
  3: { res: 1024, pr: 1.5, range: 30, bloom: false },
  4: { res: 2048, pr: 2,   range: 40, bloom: false },
  5: { res: 4096, pr: 3,   range: 70, bloom: true },    // big sharp shadows + bloom
};
function ensureComposer() {
  if (composer) return composer;
  if (!THREE.EffectComposer || !THREE.UnrealBloomPass || !THREE.RenderPass) return null;
  const w = window.innerWidth, h = window.innerHeight, pr = renderer.getPixelRatio();
  let rt = null;
  try { rt = new THREE.WebGLMultisampleRenderTarget(w * pr, h * pr, { format: THREE.RGBAFormat }); } catch (_) {}
  composer = new THREE.EffectComposer(renderer, rt || undefined);
  cPR = rt ? 1 : pr;
  composer.addPass(new THREE.RenderPass(scene, camera));
  bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.8, 0.8);
  composer.addPass(bloomPass);
  composer.setSize(w * (rt ? pr : 1), h * (rt ? pr : 1));
  if (rt) cPR = pr;
  return composer;
}
function setGraphics(n) {
  gfxLevel = n; const g = GFX[n];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, g.pr));
  sun.castShadow = g.res > 0;
  if (g.res) {
    sun.shadow.mapSize.set(g.res, g.res);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    renderer.shadowMap.type = n === 2 ? THREE.BasicShadowMap : n === 3 ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    sc.left = sc.bottom = -g.range; sc.right = sc.top = g.range; sc.far = 160 + g.range * 2;
    sc.updateProjectionMatrix();
    scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
  }
  if (composer) { composer.dispose && composer.dispose(); composer = null; }
  resize();
  document.querySelectorAll("#gfx button").forEach(b => b.classList.toggle("on", +b.dataset.l === n));
  try { localStorage.setItem("gfxLevel", String(n)); } catch (_) {}
}
document.querySelectorAll("#gfx button").forEach(b => b.addEventListener("click", () => setGraphics(+b.dataset.l)));
let _gl = 4; try { _gl = +localStorage.getItem("gfxLevel") || 4; } catch (_) {}

/* ---- sky dome ---- */
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { sunDir: { value: SUN_DIR } },
    vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: [
      "varying vec3 vDir; uniform vec3 sunDir;",
      "void main(){",
      "  vec3 d = normalize(vDir);",
      "  float h = max(d.y, 0.0);",
      "  vec3 hor = vec3(0.78, 0.88, 0.98);",
      "  vec3 zen = vec3(0.27, 0.50, 0.90);",
      "  vec3 c = mix(hor, zen, pow(h, 0.55));",
      "  float s = pow(max(dot(d, sunDir), 0.0), 700.0);",
      "  c += vec3(1.0, 0.95, 0.8) * s * 1.5;",
      "  gl_FragColor = vec4(c, 1.0);",
      "}"
    ].join("\n"),
  })
);
sky.renderOrder = -1;
sky.frustumCulled = false;
scene.add(sky);

;

/* ---- js/game/world.js ---- */
"use strict";

/* =====================================================================
   World: static boxes (used for both rendering and collision)
   ===================================================================== */
const solids = [];   // {minX,minY,minZ,maxX,maxY,maxZ}

function addSolid(cx, cy, cz, sx, sy, sz) {
  solids.push({
    minX: cx - sx / 2, maxX: cx + sx / 2,
    minY: cy - sy / 2, maxY: cy + sy / 2,
    minZ: cz - sz / 2, maxZ: cz + sz / 2,
  });
}

const IMG_STUD = new Image(), IMG_INLET = new Image(), IMG_FACE = new Image();
IMG_STUD.src = "assets/textures/stud.png";
IMG_INLET.src = "assets/textures/inlet.png";
IMG_FACE.src = "assets/faces/classic.png";
function studTexture(base, repeat, img) {
  const S = 128, cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  const lit = "#" + [1, 3, 5].map(k => Math.min(255, Math.round(parseInt(base.substr(k, 2), 16) * 1.3 + 30)).toString(16).padStart(2, "0")).join("");
  const draw = () => {
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    if (!img.naturalWidth) return;
    g.globalAlpha = 0.2; g.drawImage(img, 0, 0, S, S);            // faint shadow
    const c2 = document.createElement("canvas"); c2.width = c2.height = S;
    const h = c2.getContext("2d"); h.drawImage(img, 0, 0, S, S);
    h.globalCompositeOperation = "source-in"; h.fillStyle = lit; h.fillRect(0, 0, S, S);
    g.globalAlpha = 0.9; g.drawImage(c2, 0, 0); g.globalAlpha = 1;  // stud tinted a brighter shade of the part colour
  };
  draw();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0] || repeat, repeat[1] || repeat);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (!img.naturalWidth) img.addEventListener("load", () => { draw(); t.needsUpdate = true; });
  return t;
}

function makePart(sx, sy, sz, cx, cy, cz, color, topTex, botTex) {
  const plain = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0 });
  const top = topTex ? new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.6, metalness: 0 }) : plain;
  const bot = botTex ? new THREE.MeshStandardMaterial({ map: botTex, roughness: 0.6, metalness: 0 }) : plain;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), [plain, plain, top, bot, plain, plain]);
  m.position.set(cx, cy, cz);
  m.receiveShadow = true;
  m.castShadow = true;
  scene.add(m);
  addSolid(cx, cy, cz, sx, sy, sz);
  return m;
}

let BASEPLATE_HALF = 256;
const LADDERS = [];
const SPAWN = new THREE.Vector3(0, 3, 0);   // feet start a bit above the pad

/* ---- game 1: Baseplate (built when you press Play on it) ---- */
function buildBaseplateWorld() {
  // Roblox "Baseplate" template: 512 x 20 x 512, top surface at y = 0
    BASEPLATE_HALF = 256; SPAWN.set(0, 3, 0);
  makePart(512, 20, 512, 0, -10, 0, 0x636262,
    studTexture("#636262", 512, IMG_STUD), studTexture("#636262", 512, IMG_INLET));
  // Default SpawnLocation: 12 x 1 x 12 sitting on the baseplate
  makePart(12, 1, 12, 0, 0.5, 0, 0xa3a2a5,
    studTexture("#a3a2a5", 12, IMG_STUD), studTexture("#a3a2a5", 12, IMG_INLET));
  /* ---- test obby: [x, topY, z, sizeX, sizeZ, colour]; runs out along -Z then +X ---- */
  const OBBY = [
    [0,1,-14,6,6,0xd93b3b],[0,2,-19,4,4,0x2f6fe0],[5,3,-24,4,4,0x2ea84f],[10,4,-30,3,3,0xf0c020],
    [16,5,-30,3,3,0xf08a20],[22,6,-30,3,3,0x9b4fd0],[28,7,-30,3,3,0x20b2aa],[36,7,-30,10,1.5,0xd93b3b],
    [44,8,-30,3,3,0x2f6fe0],[44,9,-36,3,3,0x2ea84f],[44,10,-42,3,3,0xf0c020],[44,10,-52,10,10,0xffd700],
  ];
  for (const [x, ty, z, sx, sz, c] of OBBY) {
    const css = "#" + c.toString(16).padStart(6, "0");
    makePart(sx, 1, sz, x, ty - 0.5, z, c, studTexture(css, [sx, sz], IMG_STUD), studTexture(css, [sx, sz], IMG_INLET));
  }
  /* ---- test ladder: a 12-stud tower with a studded ladder on its front (+Z) face ---- */
  makePart(6, 12, 6, -14, 6, -4, 0x8a8a8a, studTexture("#8a8a8a", [6, 6], IMG_STUD), studTexture("#8a8a8a", [6, 6], IMG_INLET));
  (function () {
    const part = (sx, sy, sz, x, y, z) => {          // studded part, no collision (the ladder is climbed, not walked into)
      makePart(sx, sy, sz, x, y, z, 0xa0703c, studTexture("#a0703c", [sx, sz], IMG_STUD), studTexture("#a0703c", [sx, sz], IMG_INLET));
      solids.pop();
    };
    part(1, 12, 1, -15.5, 6, -0.5); part(1, 12, 1, -12.5, 6, -0.5);
    for (let k = 0; k < 6; k++) part(3, 0.5, 1, -14, 0.25 + k * 2, -0.5);
    LADDERS.push({ x0: -16.2, x1: -11.8, z0: -0.3, z1: 1.2, y0: 0, y1: 12, snapZ: 0.6, nx: 0, nz: 1, topZ: -2.2 });
  })();
  
}

/* ---- game 2: Sharknado (converted from mapgood.rbxl; every part has studs on its top AND bottom) ---- */
// row = [sizeX, sizeY, sizeZ, x, y, z, rotation(3x3 row-major), colour, transparency, canCollide]
function addRotatedCollision(sx, sy, sz, x, y, z, R) {
  const ex = Math.abs(R[0]) * sx + Math.abs(R[1]) * sy + Math.abs(R[2]) * sz;
  const ey = Math.abs(R[3]) * sx + Math.abs(R[4]) * sy + Math.abs(R[5]) * sz;
  const ez = Math.abs(R[6]) * sx + Math.abs(R[7]) * sy + Math.abs(R[8]) * sz;
  if (R.every(v => Math.abs(v) < 1e-3 || Math.abs(Math.abs(v) - 1) < 1e-3)) { addSolid(x, y, z, ex, ey, ez); return; }   // flat or turned in 90 degree steps
  if (window.TriancleRust && window.TriancleRust.tiltedColumns) { const columns = window.TriancleRust.tiltedColumns(sx, sy, sz, x, y, z, R); if (columns) { for (const column of columns) solids.push(column); return; } }
  // tilted part: collide with a field of small columns that follow its surface, so ramps can be walked up
  const cell = Math.max(0.6, Math.sqrt(ex * ez / 400)), h = [sx / 2, sy / 2, sz / 2];
  for (let cx = x - ex / 2 + cell / 2; cx < x + ex / 2; cx += cell) for (let cz = z - ez / 2 + cell / 2; cz < z + ez / 2; cz += cell) {
    let lo = -Infinity, hi = Infinity, ok = true;
    for (let i = 0; i < 3 && ok; i++) {
      const a0 = R[i] * (cx - x) - R[3 + i] * y + R[6 + i] * (cz - z), bb = R[3 + i];
      if (Math.abs(bb) < 1e-6) { if (Math.abs(a0) > h[i]) ok = false; continue; }
      let t0 = (-h[i] - a0) / bb, t1 = (h[i] - a0) / bb; if (t0 > t1) { const q = t0; t0 = t1; t1 = q; }
      lo = Math.max(lo, t0); hi = Math.min(hi, t1);
    }
    if (ok && hi - lo > 0.02) solids.push({ minX: cx - cell / 2, maxX: cx + cell / 2, minY: lo, maxY: hi, minZ: cz - cell / 2, maxZ: cz + cell / 2 });
  }
}
/* ---- part shapes: 0 ball, 1 block, 2 cylinder, 3 wedge, 4 corner wedge ---- */
const SHAPE_NAMES = ["Ball", "Block", "Cylinder", "Wedge", "CornerWedge"];

/* material presets, the same list Triancle Studio offers */
const MAT_PRESETS = {
  Plastic:          { roughness: 0.62, metalness: 0 },
  "Smooth Plastic": { roughness: 0.32, metalness: 0 },
  Metal:            { roughness: 0.28, metalness: 0.88 },
  Neon:             { roughness: 0.40, metalness: 0, emissive: true },
  Glass:            { roughness: 0.08, metalness: 0, glass: true },
};

/* unit geometries for the shapes that are just scaled to the part size */
const SHAPE_GEO_CACHE = {};
function shapeGeometry(shape) {
  if (SHAPE_GEO_CACHE[shape]) return SHAPE_GEO_CACHE[shape];
  let g;
  if (shape === 0) g = new THREE.SphereGeometry(0.5, 20, 14);
  else if (shape === 2) { g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); g.rotateZ(Math.PI / 2); }
  else if (shape === 3 || shape === 4) {
    // wedge (3): tall vertical face at -Z, slopes down toward +Z
    // corner wedge (4): tall at the -X/-Z corner, slopes down toward +X and +Z
    const w = [
      // bottom
      -0.5, -0.5, -0.5,  0.5, -0.5, -0.5,  0.5, -0.5, 0.5,
      -0.5, -0.5, -0.5,  0.5, -0.5, 0.5,  -0.5, -0.5, 0.5,
      // back (-Z)
      -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,  0.5, 0.5, -0.5,
      -0.5, -0.5, -0.5,  0.5, 0.5, -0.5,  0.5, -0.5, -0.5,
      // left (-X)
      -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5,
      // right (+X)
      0.5, -0.5, -0.5,  0.5, 0.5, -0.5,  0.5, -0.5, 0.5,
      // slope
      -0.5, 0.5, -0.5, -0.5, -0.5, 0.5,  0.5, -0.5, 0.5,
      -0.5, 0.5, -0.5,  0.5, -0.5, 0.5,  0.5, 0.5, -0.5,
    ];
    const c = [
      // bottom
      -0.5, -0.5, -0.5,  0.5, -0.5, -0.5,  0.5, -0.5, 0.5,
      -0.5, -0.5, -0.5,  0.5, -0.5, 0.5,  -0.5, -0.5, 0.5,
      // back (-Z)
      -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,  0.5, -0.5, -0.5,
      // left (-X)
      -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5,
      // slope (two triangles across the corner)
      -0.5, 0.5, -0.5,  0.5, -0.5, 0.5,  0.5, -0.5, -0.5,
      -0.5, 0.5, -0.5, -0.5, -0.5, 0.5,  0.5, -0.5, 0.5,
    ];
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(shape === 4 ? c : w, 3));
    g.computeVertexNormals();
  } else {
    g = new THREE.BoxGeometry(1, 1, 1);
  }
  SHAPE_GEO_CACHE[shape] = g;
  return g;
}

/* Wedges collide as a staircase of columns that follows the slope, so ramps can be
   walked up. Only axis-aligned wedges get the sloped collider; a turned one falls
   back to a plain box (same as every other turned part). */
function addWedgeCollision(sx, sy, sz, x, y, z, R, corner) {
  const flat = Math.abs(R[1]) < 1e-3 && Math.abs(R[2]) < 1e-3 && Math.abs(R[3]) < 1e-3 &&
               Math.abs(R[5]) < 1e-3 && Math.abs(R[6]) < 1e-3 && Math.abs(R[7]) < 1e-3 &&
               Math.abs(R[0] - 1) < 1e-3 && Math.abs(R[4] - 1) < 1e-3 && Math.abs(R[8] - 1) < 1e-3;
  if (!flat) { addRotatedCollision(sx, sy, sz, x, y, z, R); return; }
  const minY = y - sy / 2, maxY = y + sy / 2, minZ = z - sz / 2, minX = x - sx / 2;
  const N = Math.max(4, Math.min(24, Math.round(sz)));
  const M = corner ? Math.max(4, Math.min(24, Math.round(sx))) : 1;
  for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) {
    const x0 = minX + sx * i / M, x1 = x0 + sx / M;
    const z0 = minZ + sz * j / N, z1 = z0 + sz / N;
    let t = ((z0 + z1) / 2 - minZ) / (sz || 1);                 // 0 at the tall -Z face, 1 at +Z
    if (corner) t = Math.max(t, ((x0 + x1) / 2 - minX) / (sx || 1));
    const top = maxY - sy * Math.min(1, Math.max(0, t));
    if (top - minY < 0.02) continue;
    solids.push({ minX: x0, maxX: x1, minY, maxY: top, minZ: z0, maxZ: z1 });
  }
}

/* one builder for every map: the Sharknado data, published Triancle Studio games and any .rbxl the owner uploads.   row = [sizeX, sizeY, sizeZ, x, y, z, rotation(3x3 row-major), colour, transparency, canCollide, shape,
          material, texture, name, anchored]
   shape: 0 ball, 1 block, 2 cylinder, 3 wedge, 4 corner wedge
   material: Plastic / Smooth Plastic / Metal / Neon / Glass
   texture: Studs / Inlet / Smooth (blocks only) */
const PART_MESHES = new Map();   // part name -> mesh, for block scripts
const PART_SOLIDS = new Map();   // part name -> collision boxes, so moved parts still collide
function buildMapWorld(map) {
  SPAWN.set(map.spawn[0], map.spawn[1], map.spawn[2]);
  let half = 0;                                                         // camera stays above the ground only where there is a big ground part
  for (const r of map.parts) if (r[1] <= 64 && Math.abs(r[4] + r[1] / 2) < 2) half = Math.max(half, Math.min(4096, Math.max(r[0], r[2]) / 2));
  BASEPLATE_HALF = half;
  PART_MESHES.clear();
  PART_SOLIDS.clear();
  const texC = new Map(), matC = new Map(), geoC = new Map();
  const presetOf = name => MAT_PRESETS[name] || MAT_PRESETS.Plastic;
  const opacityOf = (preset, tr) => Math.max(0.02, Math.min(1, (preset.glass ? 0.55 : 1) * (1 - (tr || 0))));
  const tex = (css, rx, rz, img) => {
    const k = css + "|" + rx.toFixed(2) + "|" + rz.toFixed(2) + "|" + (img === IMG_INLET ? "i" : "s");
    let t = texC.get(k); if (!t) { t = studTexture(css, [rx, rz], img); texC.set(k, t); }
    return t;
  };
  const mat = (hex, tr, name) => {
    const preset = presetOf(name), opacity = opacityOf(preset, tr);
    const key = "m|" + hex + "|" + name + "|" + opacity.toFixed(3);
    let m = matC.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: hex, roughness: preset.roughness, metalness: preset.metalness, transparent: opacity < 1, opacity, depthWrite: opacity > 0.55 });
      if (preset.emissive) { m.emissive.setHex(hex); m.emissiveIntensity = 0.8; }
      matC.set(key, m);
    }
    return m;
  };
  const texMat = (css, tr, name, rx, rz, img) => {                       // studded face: material + stud/inlet texture
    const preset = presetOf(name), opacity = opacityOf(preset, tr);
    const key = "t|" + css + "|" + name + "|" + opacity.toFixed(3) + "|" + rx.toFixed(2) + "|" + rz.toFixed(2) + "|" + (img === IMG_INLET ? "i" : "s");
    let m = matC.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map: tex(css, rx, rz, img), color: 0xffffff, roughness: preset.roughness, metalness: preset.metalness, transparent: opacity < 1, opacity, depthWrite: opacity > 0.55 });
      matC.set(key, m);
    }
    return m;
  };
  for (const row of map.parts) {
    const sx = +row[0] || 1, sy = +row[1] || 1, sz = +row[2] || 1;
    const x = +row[3] || 0, y = +row[4] || 0, z = +row[5] || 0;
    const R = Array.isArray(row[6]) && row[6].length === 9 ? row[6] : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const hex = (row[7] | 0) & 0xffffff, tr = Math.max(0, Math.min(1, +row[8] || 0)), col = !(row[9] === 0 || row[9] === false);
    const shape = [0, 1, 2, 3, 4].includes(row[10]) ? row[10] : 1;
    const matName = typeof row[11] === "string" && MAT_PRESETS[row[11]] ? row[11] : "Plastic";
    const texMode = row[12] === "Smooth" || row[12] === "Inlet" ? row[12] : "Studs";
    const css = "#" + hex.toString(16).padStart(6, "0");
    const preset = presetOf(matName);
    let m;
    if (shape === 1) {
      const gk = "b" + sx + "|" + sy + "|" + sz;
      let g = geoC.get(gk); if (!g) { g = new THREE.BoxGeometry(sx, sy, sz); geoC.set(gk, g); }
      const side = mat(hex, tr, matName);
      if (texMode === "Smooth") m = new THREE.Mesh(g, side);
      else {
        const top = texMat(css, tr, matName, sx, sz, texMode === "Inlet" ? IMG_INLET : IMG_STUD);
        const bot = texMat(css, tr, matName, sx, sz, IMG_INLET);
        m = new THREE.Mesh(g, [side, side, top, bot, side, side]);
      }
    } else {
      const gk = "s" + shape;
      let g = geoC.get(gk); if (!g) { g = shapeGeometry(shape); geoC.set(gk, g); }
      m = new THREE.Mesh(g, mat(hex, tr, matName));
      m.scale.set(sx, sy, sz);
    }
    m.position.set(x, y, z);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1));
    m.receiveShadow = true;
    m.castShadow = tr === 0 && !preset.glass;
    scene.add(m);
    if (typeof row[13] === "string" && row[13]) PART_MESHES.set(row[13], m);
    if (!col) continue;
    const solidFrom = solids.length;
    if (shape === 0 && Math.min(sx, sy, sz) > Math.max(sx, sy, sz) * 0.95) {      // a round ball: exact sphere hitbox
      solids.push({ minX: x - sx / 2, maxX: x + sx / 2, minY: y - sy / 2, maxY: y + sy / 2, minZ: z - sz / 2, maxZ: z + sz / 2, ball: { cx: x, cy: y, cz: z, r: Math.min(sx, sy, sz) / 2 } });
    } else if (shape === 3 || shape === 4) addWedgeCollision(sx, sy, sz, x, y, z, R, shape === 4);
    else addRotatedCollision(sx, sy, sz, x, y, z, R);
    if (typeof row[13] === "string" && row[13]) PART_SOLIDS.set(row[13], solids.slice(solidFrom));
  }
}

/* =====================================================================
   StarterGUI runtime: draws the ScreenGui tree saved by Triancle Studio
   (map.gui) over the game canvas. Same rules as the editor preview:
   UDim2 scale/offset, anchor points, colours, text and z-order. There is
   no scripting yet, so nothing here captures clicks.
   ===================================================================== */
let guiLayerEl = null, guiLayerMap = null, guiResizeTimer = 0;

function guiNum(v, fallback) { const n = parseFloat(v); return Number.isFinite(n) ? n : (fallback || 0); }
function guiPx(udim, total) { return Array.isArray(udim) ? guiNum(udim[0]) * total + guiNum(udim[1]) : 0; }
function guiRgba(hex, transparency) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "#000000"));
  const n = parseInt(m ? m[1] : "000000", 16);
  const a = Math.max(0, Math.min(1, 1 - guiNum(transparency)));
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a.toFixed(3) + ")";
}
function guiFontFamily(font) {
  if (font === "Legacy") return "Arial, Helvetica, sans-serif";
  if (font === "Code") return "Consolas, ui-monospace, monospace";
  if (font === "Fantasy") return "Georgia, serif";
  return '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
}
function guiSafeImage(url) {
  const value = String(url || "").trim();
  return /^(https?:\/\/|data:image\/)/i.test(value) ? value : "";
}

function setGuiText(el, text) {
  const first = el.firstChild;
  if (first && first.nodeType === 3) first.nodeValue = text;
  else el.insertBefore(document.createTextNode(text), el.firstChild);
}

/* Applies every visual property to an existing element (no children touched),
   so text/colour updates never replace the nodes the player is clicking. */
function styleGuiElement(el, node, parentW, parentH) {
  if (node.class === "ScreenGui") {
    el.style.zIndex = String(100 + guiNum(node.props.DisplayOrder));
    el.style.top = (node.props.IgnoreGuiInset ? 0 : 36) + "px";
    return { width: parentW, height: Math.max(1, parentH - (node.props.IgnoreGuiInset ? 0 : 36)) };
  }
  const p = node.props;
  const width = Math.max(1, guiPx(p.Size, parentW));
  const height = Math.max(1, guiPx(p.Size.slice(2), parentH));
  el.style.left = guiPx(p.Position, parentW) + "px";
  el.style.top = guiPx(p.Position.slice(2), parentH) + "px";
  el.style.width = width + "px";
  el.style.height = height + "px";
  el.style.background = guiRgba(p.BackgroundColor3, p.BackgroundTransparency);
  const borderSize = guiNum(p.BorderSizePixel);
  el.style.border = borderSize > 0 ? borderSize + "px solid " + String(p.BorderColor3 || "#1b2a35") : "0";
  el.style.visibility = p.Visible === false ? "hidden" : "";
  el.style.zIndex = String(guiNum(p.ZIndex, 1));
  el.style.overflow = p.ClipsDescendants ? "hidden" : "visible";
  const ax = Number(p.AnchorPoint && p.AnchorPoint[0]) || 0;
  const ay = Number(p.AnchorPoint && p.AnchorPoint[1]) || 0;
  el.style.transformOrigin = (ax * 100) + "% " + (ay * 100) + "%";
  el.style.transform = "translate(" + (-ax * 100) + "%," + (-ay * 100) + "%)" + (guiNum(p.Rotation) ? " rotate(" + guiNum(p.Rotation) + "deg)" : "");

  if (node.class === "TextLabel" || node.class === "TextButton") {
    const text = String(p.Text == null ? "" : p.Text);
    setGuiText(el, text);
    el.style.color = guiRgba(p.TextColor3, p.TextTransparency);
    el.style.justifyContent = p.TextXAlignment === "Left" ? "flex-start" : p.TextXAlignment === "Right" ? "flex-end" : "center";
    el.style.alignItems = p.TextYAlignment === "Top" ? "flex-start" : p.TextYAlignment === "Bottom" ? "flex-end" : "center";
    el.style.textAlign = p.TextXAlignment === "Left" ? "left" : p.TextXAlignment === "Right" ? "right" : "center";
    el.style.whiteSpace = p.TextWrapped || p.TextScaled ? "pre-wrap" : "pre";
    el.style.fontFamily = guiFontFamily(p.Font);
    el.style.lineHeight = String(guiNum(p.LineHeight, 1));
    if (p.TextScaled) {
      const byHeight = height * 0.62;
      const byWidth = width / Math.max(1, text.length * 0.52);
      el.style.fontSize = Math.max(4, Math.min(byHeight, byWidth)) + "px";
    } else {
      el.style.fontSize = Math.max(1, guiNum(p.TextSize, 14)) + "px";
    }
    if (guiNum(p.TextStrokeTransparency, 1) < 1) {
      el.style.webkitTextStroke = "1px " + guiRgba(p.TextStrokeColor3, p.TextStrokeTransparency);
    }
  }
  if (node.class === "ImageLabel" || node.class === "ImageButton") {
    const src = guiSafeImage(p.Image);
    let img = el.querySelector('[data-guiimg]');
    if (src) {
      if (!img) {
        img = document.createElement("img");
        img.dataset.guiimg = "1";
        img.alt = "";
        img.draggable = false;
        el.appendChild(img);
      }
      img.src = src;
      img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;object-fit:" +
        (p.ScaleType === "Fit" ? "contain" : "fill") + ";opacity:" + (1 - guiNum(p.ImageTransparency));
    } else if (img) {
      img.remove();
    }
  }
  return { width, height };
}

function buildGuiElement(node, parentW, parentH) {
  if (!node || !node.props) return null;
  if (node.class === "Script" || node.class === "LocalScript") return null;
  if (node.class === "Folder") {
    const frag = document.createDocumentFragment();
    for (const kid of node.children || []) {
      const el = buildGuiElement(kid, parentW, parentH);
      if (el) frag.appendChild(el);
    }
    return frag;
  }
  if (node.class === "ScreenGui") {
    if (node.props.Enabled === false) return null;
    const screen = document.createElement("div");
    screen.className = "ggScreen";
    screen.dataset.name = node.name || "";
    screen.dataset.gid = node.id;
    const size = styleGuiElement(screen, node, parentW, parentH);
    for (const kid of node.children || []) {
      const el = buildGuiElement(kid, parentW, size.height);
      if (el) screen.appendChild(el);
    }
    return screen;
  }

  const el = document.createElement("div");
  el.className = "ggObj gg-" + node.class;
  el.dataset.name = node.name || "";
  el.dataset.gid = node.id;
  const size = styleGuiElement(el, node, parentW, parentH);
  for (const kid of node.children || []) {
    const child = buildGuiElement(kid, size.width, size.height);
    if (child) el.appendChild(child);
  }
  return el;
}

/* Repaint one node in place (no DOM replacement), so clicks and hovers keep working. */
function paintRuntimeNode(node) {
  if (!guiLayerEl || !node) return;
  const el = guiLayerEl.querySelector('[data-gid="' + node.id + '"]');
  if (!el) return;
  const parent = el.parentElement;
  const pw = Math.max(1, parent ? parent.clientWidth : window.innerWidth);
  const ph = Math.max(1, parent ? parent.clientHeight : window.innerHeight);
  styleGuiElement(el, node, pw, ph);
}

function buildRuntimeGui(g) {
  const map = (g && g.map) || {};
  guiLayerMap = map;
  if (!guiLayerEl || !guiLayerEl.isConnected) {
    guiLayerEl = document.createElement("div");
    guiLayerEl.id = "gameGui";
    document.body.appendChild(guiLayerEl);
  }
  guiLayerEl.innerHTML = "";
  const list = Array.isArray(map.gui) ? map.gui : [];
  if (!list.length) return;
  const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
  for (const root of list) {
    const el = buildGuiElement(root, w, h);
    if (el) guiLayerEl.appendChild(el);
  }
  bindScriptEvents(map);
}

/* ---- block scripts (Script = server, LocalScript = client) ---- */
function parseUdimText(text) {
  const nums = String(text || "").split(/[,\s]+/).map(parseFloat).filter(n => Number.isFinite(n));
  if (!nums.length) return null;
  if (nums.length === 1) { const n = nums[0]; return Math.abs(n) < 1 ? [n, 0, n, 0] : [0, n, 0, n]; }
  if (nums.length === 2) return [nums[0], 0, nums[1], 0];
  if (nums.length === 3) return [nums[0], nums[1], nums[2], 0];
  return nums.slice(0, 4);
}

function findRuntimeNode(map, name) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return null;
  let hit = null;
  (function walk(list) {
    for (const node of list || []) {
      if (hit) return;
      const cls = node.class;
      if (cls !== "Folder" && cls !== "Script" && cls !== "LocalScript" && String(node.name || "").toLowerCase() === wanted) { hit = node; return; }
      if (node.children) walk(node.children);
    }
  })(map.gui);
  return hit;
}

function setRuntimeProp(map, target, prop, raw) {
  const node = findRuntimeNode(map, target);
  if (!node || !node.props || !prop) return false;
  const p = node.props;
  const text = String(raw == null ? "" : raw);
  switch (prop) {
    case "Text": p.Text = text; break;
    case "Visible": p.Visible = !/^(false|0|no|off)$/i.test(text); break;
    case "Position":
    case "Size": { const udim = parseUdimText(text); if (udim) p[prop] = udim; break; }
    case "Rotation": case "TextSize": case "TextTransparency": case "BackgroundTransparency":
    case "ImageTransparency": case "ZIndex": case "BorderSizePixel":
      p[prop] = guiNum(text); break;
    case "TextColor3": case "BackgroundColor3": case "ImageColor3":
      p[prop] = text.charAt(0) === "#" ? text : "#" + text; break;
    default: p[prop] = text;
  }
  if (node.class === "ScreenGui" || prop === "Size") buildRuntimeGui({ map });
  else paintRuntimeNode(node);
  return true;
}

function testScriptCondition(map, args) {
  const node = findRuntimeNode(map, args.target);
  if (!node || !node.props) return false;
  const raw = node.props[args.prop];
  const a = Array.isArray(raw) ? raw.join(", ") : String(raw == null ? "" : raw);
  return compareValues(a, args.value, args.op);
}

function compareValues(a, b, op) {
  const left = String(a == null ? "" : a);
  const right = String(b == null ? "" : b);
  if (op === "=") return left.toLowerCase() === right.toLowerCase();
  if (op === "≠") return left.toLowerCase() !== right.toLowerCase();
  const na = parseFloat(left), nb = parseFloat(right);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return op === "<" ? na < nb : op === ">" ? na > nb : false;
}

function runtimePart(name) {
  const wanted = String(name || "").toLowerCase();
  if (!wanted) return null;
  for (const [key, mesh] of PART_MESHES) {
    if (String(key).toLowerCase() === wanted) return mesh;
  }
  return null;
}

function eachPartMaterial(mesh, fn) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const mat of mats) if (mat) fn(mat);
}

/* Identical parts share one cached material, so recolouring one would recolour them
   all. Give the part its own copy before changing anything. */
function ownPartMaterials(mesh) {
  if (!mesh) return;
  if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(mat => mat.clone());
  else if (mesh.material) mesh.material = mesh.material.clone();
}

function setPartColour(name, hex) {
  const mesh = runtimePart(name);
  if (!mesh) return;
  const value = parseInt(String(hex || "").replace("#", ""), 16);
  if (!Number.isFinite(value)) return;
  ownPartMaterials(mesh);
  eachPartMaterial(mesh, mat => { if (mat.color) mat.color.setHex(value); });
}

function setPartTransparency(name, raw) {
  const mesh = runtimePart(name);
  if (!mesh) return;
  const t = Math.max(0, Math.min(1, guiNum(raw)));
  ownPartMaterials(mesh);
  eachPartMaterial(mesh, mat => {
    mat.transparent = t > 0;
    mat.opacity = 1 - t;
    mat.depthWrite = t <= 0.55;
    mat.needsUpdate = true;
  });
}

function setPartVisible(name, on) {
  const mesh = runtimePart(name);
  if (mesh) mesh.visible = !!on;
}

function moveRuntimePart(name, dx, dy, dz) {
  const mesh = runtimePart(name);
  if (!mesh) return;
  const dxn = guiNum(dx), dyn = guiNum(dy), dzn = guiNum(dz);
  const boxes = PART_SOLIDS.get(name) || [];
  let carry = false;
  for (const b of boxes) {
    if (Math.abs(player.pos.y - b.maxY) < 0.3 &&
        player.pos.x > b.minX - 1 && player.pos.x < b.maxX + 1 &&
        player.pos.z > b.minZ - 1 && player.pos.z < b.maxZ + 1) { carry = true; break; }
  }
  mesh.position.x += dxn; mesh.position.y += dyn; mesh.position.z += dzn;
  for (const b of boxes) {
    b.minX += dxn; b.maxX += dxn;
    b.minY += dyn; b.maxY += dyn;
    b.minZ += dzn; b.maxZ += dzn;
  }
  if (carry) {
    player.pos.x += dxn; player.pos.y += dyn; player.pos.z += dzn;
    player.prev.copy(player.pos);
  }
}

function teleportPlayer(x, y, z) {
  player.pos.set(guiNum(x), guiNum(y), guiNum(z));
  player.prev.copy(player.pos);
  player.vel.set(0, 0, 0);
  player.onGround = false;
}

const HOVER_HANDLERS = [];
const TOUCH_HANDLERS = [];

function scriptVar(map, name) {
  return map && map.vars && Object.prototype.hasOwnProperty.call(map.vars, name) ? map.vars[name] : "";
}

function setScriptVar(map, name, value) {
  if (!map || !name) return;
  if (!map.vars || typeof map.vars !== "object" || Array.isArray(map.vars)) map.vars = {};
  map.vars[name] = String(value == null ? "" : value);
}

function scriptElements(target) {
  const wanted = String(target || "").toLowerCase();
  const out = [];
  if (!guiLayerEl || !wanted) return out;
  for (const el of guiLayerEl.querySelectorAll(".ggObj, .ggScreen")) {
    if (String(el.dataset.name || "").toLowerCase() === wanted) out.push(el);
  }
  return out;
}

function bindScriptEvents(map) {
  if (!guiLayerEl || !map) return;
  for (const handler of map.__clicks || []) {
    for (const el of scriptElements(handler.target)) {
      el.style.pointerEvents = "auto";
      el.style.cursor = "pointer";
      el.addEventListener("click", ev => { ev.stopPropagation(); handler.fire(); });
    }
  }
  for (const handler of map.__hovers || []) {
    for (const el of scriptElements(handler.target)) {
      el.style.pointerEvents = "auto";
      el.addEventListener("mouseenter", () => handler.fire());
    }
  }
}

/* runs every frame while a "when player touches" script exists */
function checkTouchScripts() {
  if (!TOUCH_HANDLERS.length) return;
  const half = (typeof CFG !== "undefined" && CFG.CHAR_HALF_XZ) || 1;
  const height = (typeof CFG !== "undefined" && CFG.CHAR_HEIGHT) || 5;
  const p = player.pos;
  for (const handler of TOUCH_HANDLERS) {
    const boxes = PART_SOLIDS.get(handler.part) || [];
    let hit = false;
    for (const b of boxes) {
      if (p.x + half > b.minX && p.x - half < b.maxX &&
          p.z + half > b.minZ && p.z - half < b.maxZ &&
          p.y + height > b.minY - 0.1 && p.y < b.maxY + 0.6) { hit = true; break; }
    }
    if (hit && !handler.inside) { handler.inside = true; handler.fire(); }
    else if (!hit) handler.inside = false;
  }
}

async function runScriptStack(blocks, map, ctl) {
  for (const block of blocks || []) {
    if (ctl && ctl.stop) return;
    if (!block || !block.type) continue;
    if (block.type === "wait") {
      const seconds = Math.max(0, Math.min(60, guiNum(block.args.n)));
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    } else if (block.type === "repeat") {
      const times = Math.max(0, Math.min(100, Math.round(guiNum(block.args.n))));
      for (let i = 0; i < times; i++) await runScriptStack(block.body, map, ctl);
    } else if (block.type === "if") {
      if (testScriptCondition(map, block.args || {})) await runScriptStack(block.body, map, ctl);
    } else if (block.type === "ifVar") {
      if (compareValues(scriptVar(map, block.args.var), block.args.value, block.args.op)) await runScriptStack(block.body, map, ctl);
      else await runScriptStack(block.elseBody, map, ctl);
    } else if (block.type === "setVar") {
      setScriptVar(map, block.args.var, block.args.value);
    } else if (block.type === "changeVar") {
      setScriptVar(map, block.args.var, String(guiNum(scriptVar(map, block.args.var)) + guiNum(block.args.n)));
    } else if (block.type === "stop") {
      if (ctl) ctl.stop = true;
      return;
    } else if (block.type === "setText") {
      setRuntimeProp(map, block.args.target, "Text", block.args.text);
    } else if (block.type === "setTextVar") {
      setRuntimeProp(map, block.args.target, "Text", scriptVar(map, block.args.var));
    } else if (block.type === "setProp") {
      setRuntimeProp(map, block.args.target, block.args.prop, block.args.value);
    } else if (block.type === "setPropVar") {
      setRuntimeProp(map, block.args.target, block.args.prop, scriptVar(map, block.args.var));
    } else if (block.type === "show") {
      setRuntimeProp(map, block.args.target, "Visible", "true");
    } else if (block.type === "hide") {
      setRuntimeProp(map, block.args.target, "Visible", "false");
    } else if (block.type === "partColor") {
      setPartColour(block.args.part, block.args.color);
    } else if (block.type === "partTrans") {
      setPartTransparency(block.args.part, block.args.n);
    } else if (block.type === "partShow") {
      setPartVisible(block.args.part, true);
    } else if (block.type === "partHide") {
      setPartVisible(block.args.part, false);
    } else if (block.type === "movePart") {
      moveRuntimePart(block.args.part, block.args.x, block.args.y, block.args.z);
    } else if (block.type === "teleport") {
      teleportPlayer(block.args.x, block.args.y, block.args.z);
    } else if (block.type === "walkSpeed") {
      CFG.WALK_SPEED = Math.max(1, Math.min(200, guiNum(block.args.n)));
    } else if (block.type === "jumpPower") {
      CFG.JUMP_POWER = Math.max(0, Math.min(500, guiNum(block.args.n)));
    } else if (block.type === "setHealth") {
      setPlayerHealth(guiNum(block.args.n));
    } else if (block.type === "setMaxHealth") {
      setPlayerMaxHealth(guiNum(block.args.n));
    } else if (block.type === "damage") {
      damagePlayer(guiNum(block.args.n));
    } else if (block.type === "heal") {
      healPlayer(guiNum(block.args.n));
    } else if (block.type === "kill") {
      killPlayer();
    } else if (block.type === "respawn") {
      respawn();
    } else if (block.type === "print") {
      console.log("[Triancle script]", block.args.text);
    }
  }
}

function runScripts(map) {
  if (!map || map.__scriptsStarted) return;
  map.__scriptsStarted = true;
  map.__clicks = [];
  map.__hovers = [];
  HOVER_HANDLERS.length = 0;
  TOUCH_HANDLERS.length = 0;
  if (!map.vars || typeof map.vars !== "object" || Array.isArray(map.vars)) map.vars = {};
  const scripts = [];
  (function walk(list) {
    for (const node of list || []) {
      if (node.class === "Script" || node.class === "LocalScript") scripts.push(node);
      if (node.children) walk(node.children);
    }
  })(map.gui);
  (function walk(list) {
    for (const node of list || []) if (node.class === "Script" || node.class === "LocalScript") scripts.push(node);
  })(map.workspaceScripts);
  (function walk(list) {
    for (const node of list || []) if (node.class === "Script" || node.class === "LocalScript") scripts.push(node);
  })(map.replicatedStorage);

  const ordered = scripts.filter(s => s.class === "Script").concat(scripts.filter(s => s.class === "LocalScript"));
  for (const script of ordered) {
    const blocks = script.blocks || [];
    if (!blocks.length) continue;
    const hat = blocks[0].type;
    const body = blocks.slice(1);
    const fail = err => console.warn("[Triancle script] " + (script.name || "Script") + " failed:", err);
    const fire = () => runScriptStack(body, map, { stop: false }).catch(fail);
    if (hat === "onClick") {
      map.__clicks.push({ target: blocks[0].args && blocks[0].args.target, fire });
      continue;
    }
    if (hat === "onHover") {
      map.__hovers.push({ target: blocks[0].args && blocks[0].args.target, fire });
      continue;
    }
    if (hat === "onTouch") {
      TOUCH_HANDLERS.push({ part: blocks[0].args && blocks[0].args.part, inside: false, fire });
      continue;
    }
    if (hat === "onTouchSelf") {
      if (script.parentPart) TOUCH_HANDLERS.push({ part: script.parentPart, inside: false, fire });
      continue;
    }
    if (hat === "every") {
      const ms = Math.max(100, guiNum(blocks[0].args && blocks[0].args.n) * 1000);
      if (!map.__timers) map.__timers = [];
      map.__timers.push(setInterval(fire, ms));
      continue;
    }
    if (hat === "onStart") runScriptStack(body, map, { stop: false }).catch(fail);
    else runScriptStack(blocks, map, { stop: false }).catch(fail);
  }
  bindScriptEvents(map);
}

window.addEventListener("resize", () => {
  if (!guiLayerMap) return;
  clearTimeout(guiResizeTimer);
  guiResizeTimer = setTimeout(() => buildRuntimeGui({ map: guiLayerMap }), 120);
});

let worldBuilt = false;
function buildWorld(g) {
  if (worldBuilt) return; worldBuilt = true;
  if (g.id === "baseplate") buildBaseplateWorld();
  else if (g.id === "sharknado") buildMapWorld({ spawn: [0, 3, 0], parts: SHARK_MAP.parts.concat([SHARK_MAP.base]) });
  else buildMapWorld(g.map);
  buildRuntimeGui(g);
  const guiMap = (g && g.map) || {};
  setTimeout(() => runScripts(guiMap), 80);
  player.pos.copy(SPAWN); player.prev.copy(SPAWN); player.health = player.maxHealth || 100; paintVitals(); hideVitals();
}

;

/* ---- js/game/character.js ---- */
"use strict";

/* =====================================================================
   Character visuals (from the FBX data)
   ===================================================================== */
const GEO_CACHE = {};

/* ---- clothing (Shirt / Pants) ----
   Clothes are a 512x512 PNG made on the Triancle templates (assets/templates). Each body part (except the head) gets
   UVs that point straight at its own cells of that template, and the shader lays the shirt / pants over the body colour.
   Cells are [x, y, w, h] in template pixels; F front (+X), B back (-X), R avatar's right side (+Z), L left side (-Z), U top, D bottom.
   Torso: T.  Right arm / right leg: A.  Left arm / left leg: C. */
const CLOTH_W = 512, CLOTH_H = 512;
const CLOTH_CELLS = {
  T: { U: [167, 79, 86, 54], R: [102, 135, 54, 106], F: [158, 135, 104, 106], L: [264, 135, 54, 106], B: [320, 135, 104, 106], D: [158, 243, 104, 54] },
  A: { U: [66, 261, 54, 54], R: [10, 317, 54, 106], F: [66, 317, 54, 106], L: [122, 317, 54, 106], B: [178, 317, 54, 106], D: [66, 425, 54, 54] },
  C: { U: [390, 261, 54, 54], B: [278, 317, 54, 106], R: [334, 317, 54, 106], F: [390, 317, 54, 106], L: [446, 317, 54, 106], D: [390, 425, 54, 54] },
};
const CLOTH_SET = { Torso: "T", FemaleTorso: "T", RightArm: "A", RightLeg: "A", LeftArm: "C", LeftLeg: "C" };
function clothUV(d, set) {
  const cells = CLOTH_CELLS[set], P = d.pos, n = P.length / 3, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { const v = P[i * 3 + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
  const ext = [0, 1, 2].map(a => (mx[a] - mn[a]) || 1), cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const uv = new Float32Array(n * 2);
  for (let t = 0; t < n; t += 3) {                                  // one face per triangle (picked from the triangle's own normal)
    const e1 = [0, 1, 2].map(a => P[(t + 1) * 3 + a] - P[t * 3 + a]), e2 = [0, 1, 2].map(a => P[(t + 2) * 3 + a] - P[t * 3 + a]);
    const nr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const ax = Math.abs(nr[0]) >= Math.abs(nr[1]) && Math.abs(nr[0]) >= Math.abs(nr[2]) ? 0 : Math.abs(nr[1]) >= Math.abs(nr[2]) ? 1 : 2;
    const pos = nr[ax] >= 0, face = ax === 0 ? (pos ? "F" : "B") : ax === 2 ? (pos ? "R" : "L") : (pos ? "U" : "D"), c = cells[face];
    for (let k = 0; k < 3; k++) {
      const x = P[(t + k) * 3], y = P[(t + k) * 3 + 1], z = P[(t + k) * 3 + 2];
      const nx = (x - mn[0]) / ext[0], ny = (y - mn[1]) / ext[1], nz = (z - mn[2]) / ext[2];
      let u, v;
      if (face === "F") { u = 1 - nz; v = 1 - ny; } else if (face === "B") { u = nz; v = 1 - ny; }
      else if (face === "R") { u = nx; v = 1 - ny; } else if (face === "L") { u = 1 - nx; v = 1 - ny; }
      else if (face === "U") { u = 1 - nz; v = nx; } else { u = 1 - nz; v = 1 - nx; }
      uv[(t + k) * 2] = (c[0] + 0.5 + cl(u) * (c[2] - 1)) / CLOTH_W;                // half a pixel in from the cell edge
      uv[(t + k) * 2 + 1] = 1 - (c[1] + 0.5 + cl(v) * (c[3] - 1)) / CLOTH_H;
    }
  }
  return uv;
}
const CLOTH_NONE = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat); CLOTH_NONE.needsUpdate = true;
function clothify(mat, name) {
  mat.userData.clothU = { shirt: { value: CLOTH_NONE }, pants: { value: CLOTH_NONE }, band: { value: name === "Torso" ? 2.5 : 1000 } };  // pants only reach the bottom of the torso
  mat.onBeforeCompile = sh => {
    const U = mat.userData.clothU; sh.uniforms.shirtMap = U.shirt; sh.uniforms.pantsMap = U.pants; sh.uniforms.pantsBand = U.band;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vCU; varying float vCY;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCU = uv; vCY = position.y;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vCU; varying float vCY; uniform sampler2D shirtMap; uniform sampler2D pantsMap; uniform float pantsBand;")
      .replace("#include <map_fragment>", "#include <map_fragment>\n{ vec4 pc = texture2D(pantsMap, vCU); diffuseColor.rgb = mix(diffuseColor.rgb, pc.rgb, pc.a * step(vCY, pantsBand));\n  vec4 sc = texture2D(shirtMap, vCU); diffuseColor.rgb = mix(diffuseColor.rgb, sc.rgb, sc.a); }");
  };
  mat.customProgramCacheKey = () => "clothpart";
}
function clothTex(cv) {                                             // one texture per loaded clothing image, shared by every avatar wearing it
  if (!cv) return CLOTH_NONE;
  if (!cv._tex) { cv._tex = new THREE.CanvasTexture(cv); cv._tex.anisotropy = 4; }
  return cv._tex;
}
/* shirt / pants are 512x512 canvases (or null). Shirt covers torso + arms, pants cover legs + the bottom of the torso; shirt sits on top. */
function setAvatarCloth(av, shirt, pants) {
  const st = clothTex(shirt), pt = clothTex(pants);
  for (const name in CLOTH_SET) {
    const pv = av.rig[name]; if (!pv) continue;
    const U = pv.children[0].material.userData.clothU; if (!U) continue;
    U.shirt.value = (name === "Torso" || name.endsWith("Arm")) ? st : CLOTH_NONE;
    U.pants.value = (name === "Torso" || name.endsWith("Leg")) ? pt : CLOTH_NONE;
  }
}

function partGeometry(name) {
  if (!GEO_CACHE[name]) {
    const d = MODEL_PARTS[name];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(d.pos), 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(d.nor), 3));
    if (name === "Head") {   // head is a rounded cylinder: project the face straight onto its front half; the rest samples plain yellow
      const P = d.pos, N = d.nor, uv = new Float32Array(P.length / 3 * 2);
      for (let k = 0; k < P.length / 3; k++) {
        if (P[k * 3] > 0) { uv[k * 2] = (0.55 - P[k * 3 + 2]) / 1.1; uv[k * 2 + 1] = (P[k * 3 + 1] - 3.95) / 1.1; }
        else { uv[k * 2] = -1; uv[k * 2 + 1] = -1; }
      }
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    } else geo.setAttribute("uv", new THREE.BufferAttribute(clothUV(d, CLOTH_SET[name]), 2));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    GEO_CACHE[name] = geo;
  }
  return GEO_CACHE[name];
}

// One avatar = group + rig (name -> pivot group; rotate .rotation.z to swing, + = forward)
/* Faces. 0 = Classic (everyone has it). The rest are Catalog items: the number is the face_no stored in body_colors.face.
   Built-ins ship with the site so every player can always draw them; the database (face_meta) can add more later. */
const FACE_BUILTIN = [
  { no: 1,  name: "Content",  file: "content.png",  price: 0,  desc: "A calm, happy little face." },
  { no: 2,  name: "Worried",  file: "worried.png",  price: 0,  desc: "Something doesn't look right." },
  { no: 3,  name: "Happy",    file: "happy.png",    price: 0,  desc: "Big smile, good day." },
  { no: 4,  name: "Silly",    file: "silly.png",    price: 0,  desc: "Tongue out, no worries." },
  { no: 5,  name: "Angry",    file: "angry.png",    price: 0,  desc: "Do not make it mad." },
  { no: 6,  name: "Smirk",    file: "smirk.png",    price: 0,  desc: "Up to something." },
  { no: 7,  name: "Sad",      file: "sad.png",      price: 25, desc: "A big frown." },
  { no: 8,  name: "Blank",    file: "blank.png",    price: 25, desc: "No expression at all." },
  { no: 9,  name: "Fangs",    file: "fangs.png",    price: 25, desc: "Sharp little fangs." },
  { no: 10, name: "Whiskers", file: "whiskers.png", price: 25, desc: "Cat whiskers and a cat smile." },
  { no: 11, name: "Snout",    file: "snout.png",    price: 25, desc: "A black nose and a soft smile." },
  { no: 12, name: "Curious",  file: "curious.png",  price: 25, desc: "Wide open eyes and a little smile." },
];
const FACE_NAMES = ["Classic"], FACE_SRC = [IMG_FACE.src], FACE_IMGS = [IMG_FACE], FACE_TEXS = [];   // all indexed by face number (sparse)
function registerFace(no, name, src) {
  no = +no; if (!Number.isInteger(no) || no < 1 || FACE_TEXS[no]) return;
  const im = new Image(); im.crossOrigin = "anonymous"; im.src = src;
  FACE_NAMES[no] = name; FACE_SRC[no] = src; FACE_IMGS[no] = im;
  const cv = document.createElement("canvas"); cv.width = cv.height = 256;
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4; FACE_TEXS[no] = tex;
  const paint = () => { const g = cv.getContext("2d"); g.clearRect(0, 0, 256, 256); g.drawImage(im, 0, 0, 256, 256); tex.needsUpdate = true;
    try { thumbs.cache.clear(); } catch (_) {} refreshFaceUsers(); };
  if (im.complete && im.naturalWidth) paint(); else im.addEventListener("load", paint);
}
function refreshFaceUsers() {                                     // a face texture just finished loading: redraw anyone wearing it
  try { if (typeof myColors === "object") setAvatarFace(localAvatar, myColors.face | 0); } catch (_) {}
  try { for (const pl of players.values()) if (pl.colors && pl.avatar) setAvatarFace(pl.avatar, pl.colors.face | 0); } catch (_) {}
}
(function () {                                                     // Classic first, then the built-ins
  const cv = document.createElement("canvas"); cv.width = cv.height = 256;
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4; FACE_TEXS[0] = tex;
  const paint = () => { const g = cv.getContext("2d"); g.clearRect(0, 0, 256, 256); g.drawImage(IMG_FACE, 0, 0, 256, 256); tex.needsUpdate = true; try { thumbs.cache.clear(); } catch (_) {} };
  if (IMG_FACE.complete && IMG_FACE.naturalWidth) paint(); else IMG_FACE.addEventListener("load", paint);
  for (const f of FACE_BUILTIN) registerFace(f.no, f.name, "assets/faces/" + f.file);
})();
function setAvatarFace(av, k) {
  const h = av.rig.Head && av.rig.Head.children[0];
  if (h && h.material.userData.faceU) h.material.userData.faceU.value = FACE_TEXS[FACE_TEXS[k] ? k : 0];
}
function faceify(mat) {
  mat.userData.faceU = { value: FACE_TEXS[0] };
  mat.onBeforeCompile = sh => {
    sh.uniforms.faceMap = mat.userData.faceU;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vOP; varying vec2 vFU;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvOP = position; vFU = vec2((0.55 - position.z) / 1.1, (position.y - 3.95) / 1.1);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vOP; varying vec2 vFU; uniform sampler2D faceMap;")
      .replace("#include <map_fragment>", "#include <map_fragment>\n{ vec4 fc = texture2D(faceMap, vFU); float fm = step(0.0, vOP.x) * step(0.0, vFU.x) * step(vFU.x, 1.0) * step(0.0, vFU.y) * step(vFU.y, 1.0); diffuseColor.rgb = mix(diffuseColor.rgb, fc.rgb, fc.a * fm); }");
  };
  mat.customProgramCacheKey = () => "headface";
}
const FF_MAT = new THREE.MeshBasicMaterial({ color: 0x55bbff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
function setFF(av, on) { for (const m of av.ff) m.visible = on; }

function createAvatar() {
  const group = new THREE.Group(); group.rotation.order = "YXZ";
  const rig = {}, ff = [];
  let tMesh = null, tFF = null;
  for (const name of Object.keys(MODEL_PARTS)) {
    if (name === "FemaleTorso") continue;                    // alternate torso: swapped in by setAvatarBody()
    const d = MODEL_PARTS[name];
    const mesh = new THREE.Mesh(partGeometry(name), new THREE.MeshStandardMaterial({
      color: PART_STYLE[name] || 0xcccccc, roughness: 0.55, metalness: 0,
    }));
    mesh.castShadow = true;
    if (name === "Head") faceify(mesh.material); else clothify(mesh.material, name);
    const pivot = new THREE.Group();
    pivot.position.set(d.pivot[0], d.pivot[1], d.pivot[2]);
    pivot.add(mesh);
    const ffm = new THREE.Mesh(partGeometry(name), FF_MAT);
    ffm.visible = false; ffm.renderOrder = 2;
    pivot.add(ffm); ff.push(ffm);
    if (name === "Torso") { tMesh = mesh; tFF = ffm; }
    group.add(pivot);
    rig[name] = pivot;
  }
  return { group, rig, ff, tMesh, tFF, female: false, ln: 0, rl: 0, by: 0, facing: Math.PI / 2, ang: { LeftArm: 0, RightArm: 0, LeftLeg: 0, RightLeg: 0 } };
}
function setAvatarBody(av, female) {                           // male torso <-> female torso (same pivot, so items / animation are unaffected)
  female = !!female; if (!av.tMesh || av.female === female) return;
  av.female = female;
  const g = partGeometry(female ? "FemaleTorso" : "Torso");
  av.tMesh.geometry = g; av.tFF.geometry = g;
}

const localAvatar = createAvatar();
const charGroup = localAvatar.group;
const rig = localAvatar.rig;
scene.add(charGroup);

;

/* ---- js/game/names.js ---- */
"use strict";

/* =====================================================================
   Names, name tags and the player list (Tab)
   ===================================================================== */
const tagsEl = document.getElementById("tags");
const boardEl = document.getElementById("board");
const rowsEl = document.getElementById("rows");
const countEl = document.getElementById("pcount");
const nameInput = document.getElementById("nameInput");
const players = new Map();      // id -> { id, name, avatar, tag, local, target, alive }

function cleanName(s) {
  const text = String(s == null ? "" : s);
  if (window.TriancleRust && window.TriancleRust.cleanName) { const result = window.TriancleRust.cleanName(text); if (result !== null) return result; }
  return text.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 20);
}
let myName = "";
try { myName = cleanName(localStorage.getItem("playerName")); } catch (_) {}
if (!myName) myName = "Player" + Math.floor(1000 + Math.random() * 9000);
nameInput.value = myName;

function addPlayer(id, name, local) {
  const avatar = local ? localAvatar : createAvatar();
  if (!local) { avatar.group.visible = false; scene.add(avatar.group); }
  const tag = document.createElement("div");
  tag.className = "tag";
  tag.textContent = name;
  tagsEl.appendChild(tag);
  const pl = { id, name, avatar, tag, local, target: null, alive: true };
  players.set(id, pl);
  renderBoard();
  return pl;
}
function removePlayer(id) {
  const pl = players.get(id);
  if (!pl || pl.local) return;
  pl.tag.remove(); if (pl.bubble) pl.bubble.remove();
  for (const pt of userParts.slice()) if (pt.owner === id) removePart(pt, true);
  scene.remove(pl.avatar.group);
  clearDebris(id);
  players.delete(id);
  renderBoard();
}
function renderBoard() {
  rowsEl.textContent = "";
  for (const pl of players.values()) {
    const row = document.createElement("div");
    row.className = "row" + (pl.local ? " me" : "");
    row.textContent = pl.name;
    rowsEl.appendChild(row);
  }
  countEl.textContent = String(players.size);
}
const me = addPlayer("me", myName, true);

function applyMyName() {
  const n = cleanName(nameInput.value) || myName;
  myName = n; nameInput.value = n;
  me.name = n; me.tag.textContent = n;
  try { localStorage.setItem("playerName", n); } catch (_) {}
  renderBoard();
  netSend({ t: "name", name: n });
}
let inGame = false, netStarted = false;
function isTyping() {
  const a = document.activeElement;
  return !inGame || !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
}
nameInput.addEventListener("keydown", e => {
  if (e.key === "Enter") { applyMyName(); nameInput.blur(); }
  else if (e.key === "Escape") { nameInput.value = myName; nameInput.blur(); }
  e.stopPropagation();
});
nameInput.addEventListener("focus", () => { for (const k in keys) keys[k] = false; });
document.getElementById("nameBtn").addEventListener("click", () => { applyMyName(); nameInput.blur(); });

const _tp = new THREE.Vector3();
function updateTags() {
  const w = window.innerWidth, h = window.innerHeight, now = performance.now();
  const tanH = Math.tan(CFG.CAM_FOV * Math.PI / 360);
  for (const pl of players.values()) {
    const g = pl.avatar.group;
    if (pl.tagFor !== pl.name) { pl.tagFor = pl.name; try { refreshTagColor(pl); } catch (_) {} }   // name (re)set: look up their badge colour
    let show = g.visible, sc = 1, px = 0, py = 0;
    if (show) {
      _tp.set(g.position.x, g.position.y + 5.9, g.position.z);
      const dist = _tp.distanceTo(camera.position);
      _tp.project(camera);
      show = _tp.z < 1 && dist <= CFG.NAME_DISTANCE;
      if (show) {
        px = Math.round((_tp.x * 0.5 + 0.5) * w); py = Math.round((-_tp.y * 0.5 + 0.5) * h);
        sc = CFG.TAG_WORLD_H * (h / 2) / (Math.max(dist, 0.1) * tanH) / 20;   // world-space size: shrinks/grows with distance like a part
        pl.tag.style.left = px + "px"; pl.tag.style.top = py + "px";
        pl.tag.style.transform = "scale(" + sc.toFixed(3) + ")";
      }
    }
    pl.tag.style.display = (show && !pl.local && !isBlocked(pl.name)) ? "block" : "none";   // your own name tag stays hidden
    if (pl.bubble) {
      const on = show && now < pl.bubbleEnd;
      pl.bubble.style.display = on ? "block" : "none";
      if (on) pl.bubble.style.transform = "translate(" + px + "px," + (py - (pl.local ? 8 : 28) * sc) + "px) translate(-50%,-100%) scale(" + sc.toFixed(3) + ")";
    }
  }
}

/* ---- in-game chat: Enter to type, bubbles over heads, log bottom-left ---- */
const chatLog = document.getElementById("chatlog"), chatInput = document.getElementById("chatInput");
let lastChat = 0;
function cleanChat(s) { const text = String(s == null ? "" : s); if (window.TriancleRust && window.TriancleRust.cleanChat) { const result = window.TriancleRust.cleanChat(text); if (result !== null) return result; } return text.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 120); }
/* each username gets its own colour in chat (the same name always gets the same colour) */
function nameColor(name) {
  let h = 2166136261; const t = String(name);
  if (window.TriancleRust && window.TriancleRust.nameHue) { const hue = window.TriancleRust.nameHue(t); if (hue !== null) return "hsl(" + hue + ",78%,68%)"; }
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return "hsl(" + (h % 360) + ",78%,68%)";
}
/* name tag colour = your most important badge (owner > admin > mod > ...); no badge = plain white */
async function refreshTagColor(pl) {
  const name = pl.name; let col = "";
  try {
    const id = pl.local && acct.user ? acct.user.id : await uidFor(name);
    if (id) { if (!SOC.badges.has(id)) await getBadges([id]); const top = badgeList(id)[0]; if (top) col = badgeColor(top); }
  } catch (_) {}
  if (pl.name !== name || !pl.tag) return;
  pl.tag.style.color = col; pl.tag.classList.toggle("bdgTag", !!col);
}
function addChatLine(name, text) {
  const d = document.createElement("div"); d.className = "line";
  const b = document.createElement("b"); b.textContent = name + ":"; b.style.color = nameColor(name); d.appendChild(b); d.appendChild(document.createTextNode(text));
  chatLog.appendChild(d); chatLog.scrollTop = chatLog.scrollHeight;
  if (!document.body.classList.contains("chatopen")) $("tbChat").classList.add("dot");
  while (chatLog.children.length > 80) chatLog.removeChild(chatLog.firstChild);
  setTimeout(() => d.classList.add("old"), 12000);
}
function showBubble(pl, text) {
  if (!pl.local && isBlocked(pl.name)) return;
  if (!pl.bubble) { pl.bubble = document.createElement("div"); pl.bubble.className = "bubble"; tagsEl.appendChild(pl.bubble); }
  pl.bubble.textContent = text;
  pl.bubbleEnd = performance.now() + Math.min(10000, 4000 + text.length * 70);
}
function sendChat(raw) {
  const text = cleanChat(raw), now = performance.now();
  if (!text || now - lastChat < 600) return;
  lastChat = now;
  addChatLine(myName, text); showBubble(me, text); netSend({ t: "chat", text });
}
function onChat(m) {
  if (!m || !m.id || m.id === NET.id) return;
  const pl = players.get(String(m.id)), text = cleanChat(m.text);
  if (!pl || pl.local || !text || performance.now() - (pl.lastChat || 0) < 300) return;
  pl.lastChat = performance.now();
  if (isBlocked(pl.name)) return;
  addChatLine(pl.name, text); showBubble(pl, text);
}
function openChat() { setChat(true); chatInput.focus(); }
chatInput.addEventListener("focus", () => { for (const k in keys) keys[k] = false; chatLog.classList.add("active"); });
chatInput.addEventListener("blur", () => chatLog.classList.remove("active"));
chatInput.addEventListener("keydown", e => {
  if (e.key === "Enter") { sendChat(chatInput.value); chatInput.value = ""; chatInput.blur(); }
  else if (e.key === "Escape") { chatInput.value = ""; chatInput.blur(); }
  e.stopPropagation();
});

;

/* ---- js/core/network.js ---- */
"use strict";

/* =====================================================================
   Multiplayer client (talks to the Rust relay over WebSocket)
   Client-authoritative: every client simulates itself and broadcasts its
   state; the server only relays.
   ===================================================================== */
const NET = {
  url: "", ws: null, id: null, status: "offline", retry: 0, timer: 0, idle: 0, lastSig: "",
  mode: (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) ? "supabase" : "ws",
  channel: null, interval: 0,
};
NET.interval = 1 / (NET.mode === "supabase" ? CFG.SUPABASE_SEND_HZ : CFG.NET_SEND_HZ);

function resolveServerUrl() {
  const q = new URLSearchParams(location.search).get("server");
  if (q) return q;
  if (CFG.SERVER_URL) return CFG.SERVER_URL;
  if (location.protocol === "http:" || location.protocol === "https:")
    return (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
  return "";   // opened as a local file: single-player unless SERVER_URL is set
}
function netSend(o) {
  if (NET.mode === "supabase") { sbSend(o); return; }
  if (NET.ws && NET.ws.readyState === 1) { try { NET.ws.send(JSON.stringify(o)); } catch (_) {} }
}
function netRetry() {
  NET.retry++;
  setTimeout(netConnect, Math.min(30000, 3000 * NET.retry));
}
/* A game published from Studio can cap its server. Supabase presence tells us who is
   in the room; if we ended up over the cap, leave instead of overflowing it. */
let capChecked = false;
function enforceServerCap() {
  if (capChecked) return;
  capChecked = true;
  if (typeof inGame === "undefined" || !inGame) return;
  if (typeof curGame === "undefined" || !curGame || !curGame.maxPlayers) return;
  if (!NET.channel) return;
  const n = Object.keys(NET.channel.presenceState() || {}).length;
  if (n > curGame.maxPlayers) {
    try { uiAlert("This server is full (" + curGame.maxPlayers + " players max). Try again in a minute."); } catch (_) {}
    leaveGame();
  }
}
/* ---------- Supabase Realtime transport (Broadcast for state, Presence for the player list) ---------- */
let _sb = null;     // one client shared by login (auth + database) and multiplayer (realtime)
function getSB() {
  if (_sb) return _sb;
  if (!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) || !window.supabase || !window.supabase.createClient) return null;
  _sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { realtime: { params: { eventsPerSecond: 20 } } });
  return _sb;
}
function sbConnect() {
  if (!window.supabase || !window.supabase.createClient) { NET.status = "offline (supabase-js failed to load)"; return; }
  NET.id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
  const client = getSB();
  if (!client) { NET.status = "offline (supabase-js failed to load)"; return; }
  const ch = client.channel(CFG.ROOM, { config: { broadcast: { self: false }, presence: { key: NET.id } } });
  ch.on("presence", { event: "sync" }, sbSync)
    .on("broadcast", { event: "s" }, ({ payload }) => {
      if (payload && payload.id && payload.id !== NET.id) remoteState(String(payload.id), payload);
    })
    .on("broadcast", { event: "p" }, ({ payload }) => onPartMsg(payload))
    .on("broadcast", { event: "c" }, ({ payload }) => onChat(payload))
    .on("broadcast", { event: "died" }, ({ payload }) => {
      if (payload && payload.id && payload.id !== NET.id) remoteDied(String(payload.id));
    })
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") { NET.status = "online"; NET.err = ""; ch.track(presenceInfo()); setTimeout(() => netSend({ t: "partreq" }), 700); setTimeout(enforceServerCap, 2500); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { NET.status = "offline – retrying"; NET.err = err && err.message ? String(err.message).slice(0, 80) : status; }
    });
  NET.channel = ch;
  NET.status = "connecting…";
}
function sbSync() {
  const st = NET.channel.presenceState();
  const seen = new Set();
  for (const key of Object.keys(st)) {
    if (key === NET.id) continue;
    seen.add(key);
    const meta = (st[key] && st[key][0]) || {};
    const pl = players.get(key);
    if (!pl) remoteJoin({ id: key, name: meta.name });
    else {
      const n = cleanName(meta.name);
      if (n && n !== pl.name) { pl.name = n; pl.tag.textContent = n; renderBoard(); }
    }
  }
  for (const key of seen) { const rp = players.get(key), mt = (st[key] && st[key][0]) || {}; if (rp) { applyRemoteColors(rp, mt.colors); applyRemoteItems(rp, mt.items); } }
  for (const id of Array.from(players.keys())) if (id !== "me" && !seen.has(id)) removePlayer(id);
}
function sbSend(o) {
  const ch = NET.channel;
  if (!ch || NET.status !== "online") return;
  try {
    if (o.t === "s") ch.send({ type: "broadcast", event: "s", payload: Object.assign({}, o, { id: NET.id }) });
    else if (o.t === "died") ch.send({ type: "broadcast", event: "died", payload: { id: NET.id } });
    else if (o.t === "parts" || o.t === "partdel" || o.t === "partreq") ch.send({ type: "broadcast", event: "p", payload: Object.assign({}, o, { id: NET.id }) });
    else if (o.t === "chat") ch.send({ type: "broadcast", event: "c", payload: { t: "chat", text: o.text, id: NET.id } });
    else if (o.t === "name" || o.t === "colors") ch.track(presenceInfo());
  } catch (_) {}
}

function netConnect() {
  if (NET.mode === "supabase") { sbConnect(); return; }
  NET.url = resolveServerUrl();
  if (!NET.url) { NET.status = "offline (single-player)"; return; }
  let ws;
  try { ws = new WebSocket(NET.url); } catch (_) { NET.status = "offline – retrying"; netRetry(); return; }
  NET.ws = ws; NET.status = "connecting…";
  ws.onopen = () => { NET.status = "online"; NET.retry = 0; netSend({ t: "join", name: myName, colors: myColors }); };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
    onNetMessage(m);
  };
  ws.onclose = () => {
    NET.ws = null; NET.id = null; NET.status = "offline – retrying";
    for (const id of Array.from(players.keys())) if (id !== "me") removePlayer(id);
    netRetry();
  };
  ws.onerror = () => {};
}
function onNetMessage(m) {
  switch (m.t) {
    case "welcome": NET.id = m.id; for (const p of (m.players || [])) remoteJoin(p); break;
    case "join": remoteJoin(m); break;
    case "leave": removePlayer(String(m.id)); break;
    case "name": {
      const pl = players.get(String(m.id));
      if (pl && !pl.local) { pl.name = cleanName(m.name) || pl.name; pl.tag.textContent = pl.name; renderBoard(); }
      break;
    }
    case "colors": { const cp = players.get(String(m.id)); if (cp && !cp.local) applyRemoteColors(cp, m.colors); break; }
    case "s": remoteState(String(m.id), m); break;
    case "died": remoteDied(String(m.id)); break;
    case "parts": case "partdel": case "partreq": onPartMsg(m); break;
    case "chat": onChat(m); break;
  }
}
function remoteJoin(p) {
  const id = String(p.id);
  if (players.has(id)) return;
  const npl = addPlayer(id, cleanName(p.name) || "Player", false);
  applyRemoteColors(npl, p.colors); applyRemoteItems(npl, p.items);
  if (p.s) remoteState(id, p.s);
  setTimeout(sendAllMyParts, 400);   // newcomer gets everything we've built
}
function remoteState(id, m) {
  const pl = players.get(id);
  if (!pl || pl.local) return;
  const num = v => typeof v === "number" && isFinite(v);
  if (!num(m.x) || !num(m.y) || !num(m.z)) return;
  const first = !pl.target;
  pl.target = window.TriancleRust && window.TriancleRust.remoteSnapshot && window.TriancleRust.remoteSnapshot(m) || { x: m.x, y: m.y, z: m.z, f: num(m.f) ? m.f : 0, a: Array.isArray(m.a) ? m.a : [0, 0, 0, 0], ff: m.ff ? 1 : 0, l: num(m.l) ? m.l : 0, r: num(m.r) ? m.r : 0, b: num(m.b) ? m.b : 0 };
  if (m.al === 0) { pl.alive = false; return; }
  if (!pl.alive || first) {                       // (re)spawned: snap into place
    clearDebris(id);
    pl.avatar.group.position.set(m.x, m.y, m.z);
    pl.avatar.facing = pl.target.f;
    pl.alive = true;
  }
}
function remoteDied(id) {
  const pl = players.get(id);
  if (!pl || pl.local || !pl.alive || !pl.target) return;
  pl.alive = false;
  explode(pl.avatar, id, new THREE.Vector3());
  pl.avatar.group.visible = false;
}
const LIMBS = ["LeftArm", "RightArm", "LeftLeg", "RightLeg"];
function updateRemotes(dt) {
  const k = animationBlend(dt, 18);
  for (const pl of players.values()) {
    if (pl.local) continue;
    const av = pl.avatar, t = pl.target;
    if (!t || !pl.alive) { av.group.visible = false; continue; }
    av.group.visible = !isBlocked(pl.name);
    setFF(av, !!t.ff);
    const g = av.group.position;
    if (window.TriancleRust && window.TriancleRust.animateRemote) {
      const state = window.TriancleRust.animateRemote([k, av.ln, av.rl, av.by, g.x, g.y, g.z, av.facing,
        ...LIMBS.map(n => av.ang[n]), t.l, t.r, t.b, t.x, t.y, t.z, t.f, ...LIMBS.map((_, i) => +t.a[i] || 0)]);
      if (state) {
        [av.ln, av.rl, av.by, g.x, g.y, g.z, av.facing] = state.slice(1, 8);
        av.group.rotation.z = -av.ln; av.group.rotation.x = av.rl; av.group.rotation.y = av.facing + CFG.MODEL_FRONT_OFFSET;
        for (let i = 0; i < 4; i++) { const n = LIMBS[i]; av.ang[n] = state[8+i]; av.rig[n].rotation.z = av.ang[n]; }
        continue;
      }
    }
    av.ln += (t.l - av.ln) * k; av.rl += (t.r - av.rl) * k; av.by += (t.b - av.by) * k;
    g.x += (t.x - g.x) * k; g.y += (t.y + av.by - g.y) * k; g.z += (t.z - g.z) * k;
    av.group.rotation.z = -av.ln; av.group.rotation.x = av.rl;
    av.facing = wrapPi(av.facing + wrapPi(t.f - av.facing) * k);
    av.group.rotation.y = av.facing + CFG.MODEL_FRONT_OFFSET;
    for (let i = 0; i < 4; i++) {
      const n = LIMBS[i];
      av.ang[n] += ((+t.a[i] || 0) - av.ang[n]) * k;
      av.rig[n].rotation.z = av.ang[n];
    }
  }
}

;

/* ---- js/core/input.js ---- */
"use strict";

/* =====================================================================
   Input
   ===================================================================== */
const keys = Object.create(null);
window.addEventListener("keydown", e => {
  const tg = e.target, typingEl = tg && (tg.tagName === "TEXTAREA" || (tg.tagName === "INPUT" && tg.type !== "range"));
  if (e.code === "Escape" && inGame && !typingEl && !uiAuthOpen()) { e.preventDefault(); if (performance.now() - menuOpenedAt > 250) toggleMenu(); return; }
  if (menuOpen) { menuKey(e); return; }
  if (isTyping()) return;
  keys[e.code] = true;
  if (e.code === "Space" || e.code.startsWith("Arrow") || e.code === "Slash" || e.code === "Backquote") e.preventDefault();
  if (e.code === "Tab") { e.preventDefault(); boardEl.style.display = boardEl.style.display === "none" ? "block" : "none"; return; }
  if (e.repeat) return;
  if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && shiftLockEnabled && inGame && !uiOpen()) toggleShiftLock();
  if (e.code === "KeyR") resetCharacter();
  if (e.code === "Slash") document.body.classList.toggle("nohud");
  if (e.code === "Enter" || e.code === "NumpadEnter") { e.preventDefault(); openChat(); }
  if (e.code === "Backquote") hitOn = !hitOn;
  if (e.code === "Digit1") toggleBT();
});
window.addEventListener("keyup", e => { keys[e.code] = false; });
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

let rmbDown = false;
let shiftLock = false;                                  // what the player WANTS (the Shift toggle). Stays on through the menu, chat and Esc.
const crossEl = document.getElementById("cross");
const hasLock = () => document.pointerLockElement === canvas;
let firstPerson = false, lockTry = 0, lockErrAt = 0;
function wantLock() { return !uiOpen() && (shiftLock || firstPerson); }
function ensureLock(gesture) {                          // (re)grab the mouse whenever shift lock / first person wants it
  if (!inGame || !wantLock() || hasLock()) return;
  /* A real click / key press ("gesture") may always try: browsers only allow pointer lock from those, and a failed try
     (e.g. the Shift key itself not counting as a click) must never block the next click. Background retries wait a bit. */
  if (!gesture && performance.now() - lockErrAt < 1300) return;
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) {}
}
function setShiftLock(on) {
  shiftLock = on;
  canvas.style.cursor = on ? "none" : "";
  if (on) ensureLock(); else if (hasLock() && !rmbDown && !firstPerson) document.exitPointerLock();
}
function toggleShiftLock() { setShiftLock(!shiftLock); }
window.addEventListener("wheel", () => ensureLock(false), { passive: true });
window.addEventListener("mousemove", () => ensureLock(false));
window.addEventListener("pointerdown", () => ensureLock(true));
window.addEventListener("keydown", () => { if (!isTyping()) ensureLock(true); });
document.addEventListener("pointerlockerror", () => { lockErrAt = performance.now() - 1000; });      // short retry delay only
document.addEventListener("pointerlockchange", () => {
  if (hasLock()) return;
  /* The mouse was released. If nothing of ours did it (Esc, or the browser), it was the player pressing Esc: browsers swallow
     that key press while the mouse is locked, so open the menu ourselves. Shift lock itself stays on. */
  if (inGame && wantLock() && !rmbDown && document.hasFocus()) { lockErrAt = performance.now(); openMenu(); }
});
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("mousedown", e => {
  if (isTyping()) document.activeElement.blur();
  ensureLock(true);
  if (e.button === 2) {
    rmbDown = true;
    if (!hasLock()) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
  }
});
window.addEventListener("mouseup", e => {
  if (e.button === 2) {
    rmbDown = false;
    if (hasLock() && !wantLock()) document.exitPointerLock();
  }
});
window.addEventListener("mousemove", e => {
  /* Shift lock steers the camera with the mouse even if the browser has not handed over the mouse yet (it needs a click
     first in some browsers) - as long as the pointer is over the game. First person still needs the real lock. */
  const steer = rmbDown || (hasLock() && (shiftLock || firstPerson)) || (shiftLock && inGame && !uiOpen() && e.target === canvas);
  if (!steer) return;
  if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;   // ignore lock-jump spikes
  const aim = window.TriancleRust && window.TriancleRust.cameraAim ? window.TriancleRust.cameraAim(cam.yaw,cam.pitch,e.movementX,e.movementY,CFG.CAM_SENS,CFG.CAM_PITCH_LIMIT) : null;
  if (aim) { cam.yaw = aim[0]; cam.pitch = aim[1]; }
  else { cam.yaw -= e.movementX * CFG.CAM_SENS; cam.pitch += e.movementY * CFG.CAM_SENS; cam.pitch = Math.max(-CFG.CAM_PITCH_LIMIT, Math.min(CFG.CAM_PITCH_LIMIT, cam.pitch)); }
});
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const f = e.deltaY > 0 ? 1.14 : 1 / 1.14;
  const zoom = window.TriancleRust && window.TriancleRust.cameraZoom ? window.TriancleRust.cameraZoom(cam.zoomTarget,e.deltaY,CFG.CAM_ZOOM_MIN,CFG.CAM_ZOOM_MAX) : null;
  cam.zoomTarget = zoom === null ? Math.max(CFG.CAM_ZOOM_MIN, Math.min(CFG.CAM_ZOOM_MAX, cam.zoomTarget * f)) : zoom;
}, { passive: false });

;

/* ---- js/core/camera.js ---- */
"use strict";

/* =====================================================================
   Camera state (Roblox-style orbit around the head)
   yaw = 0 looks toward -Z.  pitch > 0 looks down.
   ===================================================================== */
const cam = { yaw: 0, pitch: 0.2, zoom: CFG.CAM_ZOOM_START, zoomTarget: CFG.CAM_ZOOM_START, shift: 0 };

;

/* ---- js/game/physics.js ---- */
"use strict";

/* =====================================================================
   Player physics (fixed 240 Hz step)
   ===================================================================== */
const player = {
  pos: new THREE.Vector3().copy(SPAWN),
  prev: new THREE.Vector3().copy(SPAWN),
  vel: new THREE.Vector3(),
  onGround: false,
  alive: true,
  respawnTimer: 0,
  health: 100, maxHealth: 100,   // changed by scripts (set / damage / heal / kill)
  moveX: 0, moveZ: 0,        // last input direction (world), unit or zero
  ff: CFG.FF_TIME,           // spawn forcefield seconds left
  climb: null, climbReq: null, topExit: null, // ledge-climb state
  stepOff: 0,                // visual-only vertical offset that smooths ledge step-ups
  groundT: 0,                // seconds since feet last touched something (small grace so steps still work)
  lastStep: null,            // where the last big step-up happened { x, z, t }, so a wall of rungs can't be 'stair-stepped' for free
};

function readMoveInput() {
  const fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const rgt = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  if (window.TriancleRust && window.TriancleRust.moveDirection) return window.TriancleRust.moveDirection(cam.yaw, fwd, rgt);
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  const rx =  Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  let mx = fx * fwd + rx * rgt, mz = fz * fwd + rz * rgt;
  const l = Math.hypot(mx, mz);
  if (l > 1) { mx /= l; mz /= l; }
  return [mx, mz];
}

function approach(v, tx, tz, maxDelta) {
  if (window.TriancleRust && window.TriancleRust.approach) return window.TriancleRust.approach(v, tx, tz, maxDelta);
  const dx = tx - v.x, dz = tz - v.z, l = Math.hypot(dx, dz);
  if (l <= maxDelta || l === 0) { v.x = tx; v.z = tz; }
  else { v.x += dx / l * maxDelta; v.z += dz / l * maxDelta; }
}

function overlaps(p, b) {
  const h = CFG.CHAR_HALF_XZ;
  if (window.TriancleRust && window.TriancleRust.boxOverlap) {
    return window.TriancleRust.boxOverlap(p, b, h, CFG.CHAR_HEIGHT) &&
      (!b.ball || window.TriancleRust.sphereOverlap(p, b.ball, h, CFG.CHAR_HEIGHT));
  }
  if (!(p.x + h > b.minX && p.x - h < b.maxX &&
        p.z + h > b.minZ && p.z - h < b.maxZ &&
        p.y + CFG.CHAR_HEIGHT > b.minY && p.y < b.maxY)) return false;
  if (!b.ball) return true;
  const q = b.ball, dx = nearest(q.cx, p.x - h, p.x + h) - q.cx, dy = nearest(q.cy, p.y, p.y + CFG.CHAR_HEIGHT) - q.cy, dz = nearest(q.cz, p.z - h, p.z + h) - q.cz;
  return dx * dx + dy * dy + dz * dz < q.r * q.r;                              // a ball is round, not a box
}
const nearest = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

/* push the player out of anything it is inside (a part was spawned / scaled / moved onto you): the SHORTEST way out, never a teleport */
function depenetrate() {
  const p = player.pos, h = CFG.CHAR_HALF_XZ, H = CFG.CHAR_HEIGHT;
  for (let it = 0; it < 6; it++) {
    let hit = false;
    for (const b of solids) {
      if (!overlaps(p, b)) continue;
      hit = true;
      if (b.ball) {
        const q = b.ball, nx = nearest(q.cx, p.x - h, p.x + h), ny = nearest(q.cy, p.y, p.y + H), nz = nearest(q.cz, p.z - h, p.z + h);
        let dx = nx - q.cx, dy = ny - q.cy, dz = nz - q.cz; const d = Math.hypot(dx, dy, dz);
        if (d < 1e-5) { p.y = q.cy + q.r; if (player.vel.y < 0) player.vel.y = 0; continue; }
        const k = (q.r - d) / d + 1e-3; p.x += dx * k; p.y += dy * k; p.z += dz * k;
        if (dy * k > 0 && player.vel.y < 0) player.vel.y = 0;
        continue;
      }
      const c = [b.maxX + h - p.x, p.x + h - b.minX, b.maxZ + h - p.z, p.z + h - b.minZ, b.maxY - p.y, (p.y + H - b.minY) * 1.25];
      let k = 0; for (let i = 1; i < 6; i++) if (c[i] < c[k]) k = i;
      if (k === 0) p.x = b.maxX + h; else if (k === 1) p.x = b.minX - h;
      else if (k === 2) p.z = b.maxZ + h; else if (k === 3) p.z = b.minZ - h;
      else if (k === 4) { p.y = b.maxY; if (player.vel.y < 0) player.vel.y = 0; }
      else { p.y = b.minY - H; if (player.vel.y > 0) player.vel.y = 0; }
    }
    if (!hit) break;
  }
}

/* climbing moves the player straight up/down: never into a ceiling / floor / wall it was not already in */
function climbMoveY(dy) {
  const p = player.pos, y0 = p.y; p.y = y0 + dy;
  for (const b of solids) {
    if (!overlaps(p, b)) continue;
    p.y = y0; const was = overlaps(p, b); p.y = y0 + dy;
    if (!was) { p.y = y0; return; }
  }
}

/* ---- ladders made of parts: 3+ thin parts stacked up the same wall face (with gaps) are climbed like a real ladder ---- */
function detectPartLadder(axis, dir, b) {
  const p = player.pos, h = CFG.CHAR_HALF_XZ;
  const faceOf = s => axis === "x" ? (dir > 0 ? s.minX : s.maxX) : (dir > 0 ? s.minZ : s.maxZ), face = faceOf(b);
  const pc = axis === "x" ? p.z : p.x, chain = [];
  for (const s of solids) {
    if (s.ball || s.maxY - s.minY > CFG.CLIMB_MAX_SIZE) continue;             // only thin rungs, never a thick block or a ball
    if (Math.abs(faceOf(s) - face) > 0.75) continue;                           // same wall face
    const lo = axis === "x" ? s.minZ : s.minX, hi = axis === "x" ? s.maxZ : s.maxX;
    if (hi < pc - h + 0.3 || lo > pc + h - 0.3) continue;                      // in front of the player
    if (s.maxY < p.y - 0.5 || s.minY > p.y + 200) continue;
    chain.push(s);
  }
  if (chain.length < 3) return null;
  chain.sort((a, c) => a.maxY - c.maxY);
  if (chain[0].minY > p.y + CFG.CHAR_HEIGHT) return null;                      // first rung has to be within reach
  let gap = false, n = 1, top = chain[0];
  for (let i = 1; i < chain.length; i++) {
    const g = chain[i].minY - chain[i - 1].maxY;
    if (g > 3.5) break;                                                         // rungs too far apart: not a ladder
    if (g > 0.4) gap = true;                                                    // a solid stack of plates is a wall, not a ladder
    n++; top = chain[i];
  }
  return n >= 3 && gap ? { top, face, rungs: chain.slice(0, n) } : null;
}
function startPartLadder(axis, dir, pl) {
  const p = player.pos, h = CFG.CHAR_HALF_XZ + 0.1;
  const L = { rungs: pl.rungs, y0: p.y, y1: pl.top.maxY, nx: axis === "x" ? -dir : 0, nz: axis === "z" ? -dir : 0 };
  const ox = p.x, oz = p.z;
  if (axis === "x") { L.snapX = pl.face + L.nx * h; p.x = L.snapX; } else { L.snapZ = pl.face + L.nz * h; p.z = L.snapZ; }
  if (solids.some(o => overlaps(p, o))) { p.x = ox; p.z = oz; return false; }                 // rails / walls in the way: not a ladder here
  player.climb = { mode: "ladder", L, t: 0, dur: 1, armed: false, face: Math.atan2(L.nz, -L.nx) };
  player.vel.set(0, 0, 0); player.stepOff = 0;
  return true;
}

function resolveHorizontal(axis, delta) {
  const p = player.pos, h = CFG.CHAR_HALF_XZ;
  for (const b of solids) {
    if (!overlaps(p, b)) continue;
    if (b.ball) {                                                              // exact sphere: slide off its curve, don't snag on a hidden box corner
      const q = b.ball, ny = nearest(q.cy, p.y, p.y + CFG.CHAR_HEIGHT), dy = ny - q.cy;
      const oc = axis === "x" ? nearest(q.cz, p.z - h, p.z + h) - q.cz : nearest(q.cx, p.x - h, p.x + h) - q.cx;
      const rr = Math.sqrt(Math.max(0, q.r * q.r - dy * dy - oc * oc)), c = axis === "x" ? q.cx : q.cz, cur = axis === "x" ? p.x : p.z;
      const to = window.TriancleRust && window.TriancleRust.sphereSide
        ? window.TriancleRust.sphereSide(cur, axis === "x" ? p.z : p.x, p.y, h, CFG.CHAR_HEIGHT, c, axis === "x" ? q.cz : q.cx, q.cy, q.r, delta)
        : delta > 0 || (delta === 0 && cur < c) ? c - rr - h : c + rr + h;
      if (axis === "x") { p.x = to; player.vel.x = 0; } else { p.z = to; player.vel.z = 0; }
      continue;
    }
    const rise = b.maxY - p.y;
    const mv = axis === "x" ? player.moveX : player.moveZ;
    if (!player.climb && !(player.noGrab > 0) && mv && (b.maxY - b.minY) <= CFG.CLIMB_MAX_SIZE && rise > 0.3) {   // walked into a ladder made of parts
      const pl = detectPartLadder(axis, mv > 0 ? 1 : -1, b);
      if (pl && startPartLadder(axis, mv > 0 ? 1 : -1, pl)) return;
    }
    const big = rise > 0.75, ls = player.lastStep;
    const stuck = big && ls && ls.t < 0.5 && Math.hypot(p.x - ls.x, p.z - ls.z) < 0.8;       // no sideways progress since the last big step: it's a wall, not stairs
    if (rise > 0 && rise <= CFG.STEP_HEIGHT + 1e-4 && !stuck && (big ? player.groundT > 0 : (player.groundT > 0 || player.vel.y > -10))) {
      player.stepOff -= (b.maxY - p.y); // physics snaps up, visuals ease up
      p.y = b.maxY;                    // walk up the ledge
      if (big) player.lastStep = { x: p.x, z: p.z, t: 0 };
      continue;
    }
    if (!player.onGround && !player.climb && !(player.noGrab > 0) && rise >= 3 && rise <= CFG.AUTOJUMP_MAX && (b.maxY - b.minY) <= CFG.CLIMB_MAX_SIZE && (player.moveX || player.moveZ)) {
      const dir = delta > 0 ? 1 : -1, t = { x: p.x, y: b.maxY, z: p.z };
      if (axis === "x") t.x = dir > 0 ? b.minX + h + 0.2 : b.maxX - h - 0.2; else t.z = dir > 0 ? b.minZ + h + 0.2 : b.maxZ - h - 0.2;
      if (axis === "x" ? (t.z > b.minZ - h * 0.5 && t.z < b.maxZ + h * 0.5) : (t.x > b.minX - h * 0.5 && t.x < b.maxX + h * 0.5)) {
        if (!solids.some(o => overlaps(t, o))) player.climbReq = { t, b, ax: axis === "x" ? dir : 0, az: axis === "z" ? dir : 0 };
      }
    }
    if (axis === "x") {
      if (window.TriancleRust && window.TriancleRust.boxSide) p.x = window.TriancleRust.boxSide(p.x, delta, b.minX, b.maxX, h);
      else if (delta > 0) p.x = b.minX - h; else if (delta < 0) p.x = b.maxX + h; else p.x = (p.x - (b.minX + b.maxX) / 2 < 0) ? b.minX - h : b.maxX + h;   // standing still: nearest side
      player.vel.x = 0;
    } else {
      if (window.TriancleRust && window.TriancleRust.boxSide) p.z = window.TriancleRust.boxSide(p.z, delta, b.minZ, b.maxZ, h);
      else if (delta > 0) p.z = b.minZ - h; else if (delta < 0) p.z = b.maxZ + h; else p.z = (p.z - (b.minZ + b.maxZ) / 2 < 0) ? b.minZ - h : b.maxZ + h;
      player.vel.z = 0;
    }
  }
}

function exitClimb(c, ex, bk) {     // leave a climb at the top; if you then stop moving you get put back on it
  player.stepOff -= (ex.y - player.pos.y); player.climb = null; player.pos.set(ex.x, ex.y, ex.z); player.prev.copy(player.pos);   // visuals ease up instead of popping
  player.vel.set(0, 0, 0); player.onGround = true;
  player.topExit = { t: 1, climb: c, bk, x0: ex.x, z0: ex.z };
}

function physicsStep(dt) {
  if (debris.length) stepDebris(dt);
  if (userParts.length) stepUserParts(dt);
  if (!player.alive) {
    player.respawnTimer -= dt;
    if (player.respawnTimer <= 0) respawn();
    return;
  }
  const p = player.pos, v = player.vel;
  player.prev.copy(p);
  if (player.noGrab > 0) player.noGrab -= dt;
  if (player.groundT > 0) player.groundT -= dt;
  if (player.lastStep) player.lastStep.t += dt;
  if (player.topExit) {
    const te = player.topExit; te.t -= dt;
    const moving = keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD || keys.ArrowUp || keys.ArrowDown;
    if (te.t <= 0 || Math.hypot(p.x - te.x0, p.z - te.z0) > 0.6) player.topExit = null;   // you walked off: let go of the climb
    else if (!moving) { te.climb.armed = false; player.climb = te.climb; p.set(te.bk.x, te.bk.y, te.bk.z); v.set(0, 0, 0); player.topExit = null; }
  }
  if (!player.climb && !(player.noGrab > 0) && (keys.KeyW || keys.ArrowUp)) {          // walk into a ladder holding W
    for (const L of LADDERS) if (p.x >= L.x0 && p.x <= L.x1 && p.z >= L.z0 && p.z <= L.z1 && p.y >= L.y0 - 0.5 && p.y <= L.y1 - 1) {
      player.climb = { mode: "ladder", L, t: 0, dur: 1, armed: false, face: Math.atan2(L.nz, -L.nx) }; p.z = L.snapZ; v.set(0, 0, 0); break;
    }
  }
  if (player.climb && player.climb.mode === "over") {   // smooth pull-over onto the top (no teleport)
    const c = player.climb; c.t += dt;
    const u = Math.min(1, c.t / c.dur), e = window.TriancleRust && window.TriancleRust.climbEase || (x => x * x * (3 - 2 * x));
    const yu = e(Math.min(1, u / 0.5)), xu = e(Math.max(0, (u - 0.35) / 0.65));
    p.y = c.from.y + (c.to.y - c.from.y) * yu;
    p.x = c.from.x + (c.to.x - c.from.x) * xu; p.z = c.from.z + (c.to.z - c.from.z) * xu;
    v.set(0, 0, 0);
    if (u >= 1) { p.set(c.to.x, c.to.y, c.to.z); player.climb = null; player.onGround = true; }
    return;
  }
  if (player.climb && player.climb.mode === "ladder") {   // truss-style ladder: W/S up/down, Space hops off backwards
    const c = player.climb, L = c.L, up = keys.KeyW || keys.ArrowUp, dn = keys.KeyS || keys.ArrowDown;
    v.set(0, 0, 0);
    if (!keys.Space) c.armed = true;
    if (c.armed && keys.Space) { player.climb = null; player.noGrab = 0.3; v.set(L.nx * 10, CFG.JUMP_POWER, L.nz * 10); return; }
    if (L.rungs && !L.rungs.some(r => r.maxY > p.y - 1 && r.minY < p.y + CFG.CHAR_HEIGHT + 1.5 && solids.indexOf(r) >= 0)) { player.climb = null; player.noGrab = 0.3; return; }   // the rungs were deleted / moved: let go
    climbMoveY(window.TriancleRust && window.TriancleRust.climbDelta ? window.TriancleRust.climbDelta(up, dn, dt) : ((up ? 1 : 0) - (dn ? 1 : 0)) * 12 * dt);
    if (p.y <= L.y0) { p.y = L.y0; if (dn) { player.climb = null; player.noGrab = 0.3; player.onGround = true; return; } }
    if (p.y >= L.y1 - 0.5) { exitClimb(c, { x: p.x - L.nx, y: L.y1, z: p.z - L.nz }, { x: p.x, y: L.y1 - 1, z: p.z }); return; }   // top: step out, no shove forward
    return;
  }
  if (player.climb && player.climb.mode === "hang") {   // hanging off the ledge, Roblox-style
    const c = player.climb, fw = keys.KeyW || keys.ArrowUp, down = keys.KeyS || keys.ArrowDown;
    v.set(0, 0, 0);
    if (down) { player.climb = null; player.noGrab = 0.5; return; }                 // let go
    if (!keys.Space) c.armed = true;
    if (c.armed && keys.Space) {                                                    // Space = jump off, like off the floor
      player.climb = null; player.noGrab = 0.3; v.set(-c.ax * 10, CFG.JUMP_POWER, -c.az * 10); return;   // hops back off the wall a bit
    }
    if (fw) climbMoveY(12 * dt);                                                  // smooth climb (stops at ceilings)
    if (!solids.includes(c.b)) { player.climb = null; player.noGrab = 0.3; return; }   // the ledge was deleted: let go
    const rgt = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);                          // A/D shimmy along the ledge
    const tx = c.az !== 0 ? 1 : 0, tz = c.ax !== 0 ? 1 : 0;
    const sh = window.TriancleRust && window.TriancleRust.climbShimmy ? window.TriancleRust.climbShimmy(cam.yaw, rgt, tx, tz) : rgt ? Math.cos(cam.yaw) * rgt * tx - Math.sin(cam.yaw) * rgt * tz : 0;
    if (Math.abs(sh) > 0.1) {
      const st = sh * 4 * dt;
      if (tx) { p.x = Math.max(c.b.minX, Math.min(c.b.maxX, p.x + st)); c.to.x = p.x; }
      else    { p.z = Math.max(c.b.minZ, Math.min(c.b.maxZ, p.z + st)); c.to.z = p.z; }
    }
    if (p.y >= c.b.maxY - 1.0) { exitClimb(c, { x: p.x + c.ax * 0.4, y: c.b.maxY, z: p.z + c.az * 0.4 }, { x: p.x, y: c.b.maxY - 1.2, z: p.z }); return; }   // top: just onto the edge
    return;
  }
  if (player.climb) {                               // mantling a ledge: haul up, then swing over
    const c = player.climb; c.t += dt;
    const u = Math.min(1, c.t / c.dur), K = 0.65, e = window.TriancleRust && window.TriancleRust.climbEase || (x => x * x * (3 - 2 * x));
    if (u < K) p.y = c.from.y + (c.to.y - c.from.y) * e(u / K);
    else { const w = e((u - K) / (1 - K)); p.y = c.to.y; p.x = c.from.x + (c.to.x - c.from.x) * w; p.z = c.from.z + (c.to.z - c.from.z) * w; }
    v.set(0, 0, 0);
    if (u >= 1) { p.set(c.to.x, c.to.y, c.to.z); player.climb = null; player.onGround = true; }
    return;
  }

  depenetrate();                                    // something grew / spawned on you: get pushed out the short way

  // --- horizontal control ---
  const [mx, mz] = readMoveInput();
  const hasInput = (mx !== 0 || mz !== 0);
  player.moveX = hasInput ? mx : 0;
  player.moveZ = hasInput ? mz : 0;
  const tx = mx * CFG.WALK_SPEED, tz = mz * CFG.WALK_SPEED;
  if (player.onGround) approach(v, tx, tz, CFG.GROUND_ACCEL * dt);
  else if (hasInput)   approach(v, tx, tz, CFG.AIR_ACCEL * dt);
  else                 approach(v, 0, 0, CFG.AIR_STOP * dt);   // no sliding in the air

  // --- jump (holding space keeps jumping on landing, like Roblox) ---
  if (player.onGround && keys.Space) {
    v.y = CFG.JUMP_POWER;
    player.onGround = false;
  }

  // --- gravity ---
  v.y -= CFG.GRAVITY * dt;

  // --- integrate + collide, axis by axis ---
  p.x += v.x * dt; resolveHorizontal("x", v.x);
  p.z += v.z * dt; resolveHorizontal("z", v.z);

  p.y += v.y * dt;
  let landed = false;
  for (const b of solids) {
    if (!overlaps(p, b)) continue;
    if (b.ball) {
      const q = b.ball, dx = nearest(q.cx, p.x - CFG.CHAR_HALF_XZ, p.x + CFG.CHAR_HALF_XZ) - q.cx, dz = nearest(q.cz, p.z - CFG.CHAR_HALF_XZ, p.z + CFG.CHAR_HALF_XZ) - q.cz;
      const ry = Math.sqrt(Math.max(0, q.r * q.r - dx * dx - dz * dz));
      if (window.TriancleRust && window.TriancleRust.sphereVertical) p.y = window.TriancleRust.sphereVertical(p.x, p.z, CFG.CHAR_HALF_XZ, CFG.CHAR_HEIGHT, q.cx, q.cy, q.cz, q.r, v.y);
      else p.y = v.y <= 0 ? q.cy + ry : q.cy - ry - CFG.CHAR_HEIGHT;
      if (v.y <= 0) landed = true;
      v.y = 0; continue;
    }
    if (window.TriancleRust && window.TriancleRust.boxVertical) p.y = window.TriancleRust.boxVertical(b.minY, b.maxY, CFG.CHAR_HEIGHT, v.y);
    else p.y = v.y <= 0 ? b.maxY : b.minY - CFG.CHAR_HEIGHT;
    if (v.y <= 0) landed = true;
    v.y = 0;
  }
  player.onGround = landed;
  if (landed) player.groundT = 0.1;
  if (player.climbReq) {
    const q = player.climbReq; player.climbReq = null;
    player.climb = { t: 0, dur: 0.6, from: p.clone(), to: new THREE.Vector3(q.t.x, q.t.y, q.t.z), face: Math.atan2(-q.az, q.ax), mode: "hang", armed: false, b: q.b, ax: q.ax, az: q.az };
    v.set(0, 0, 0);
  }

  // --- fell off the world ---
  if (p.y < CFG.FALL_DESTROY_Y) {
    player.alive = false;
    player.respawnTimer = CFG.RESPAWN_TIME;
    v.set(0, 0, 0);
  }
}

/* ---- player health (script blocks: set / damage / heal / kill) ---- */
let vitalsHideTimer = 0;
function paintVitals() {
  const box = document.getElementById("vitals");
  if (!box) return;
  const max = Math.max(1, Number(player.maxHealth) || 100);
  const hp = Math.max(0, Math.min(max, player.health == null ? max : Number(player.health) || 0));
  box.classList.toggle("low", hp <= max * 0.3);
  const fill = document.getElementById("vitFill");
  const num = document.getElementById("vitNum");
  if (fill) fill.style.width = (hp / max * 100).toFixed(1) + "%";
  if (num) num.textContent = Math.round(hp);
}
function hideVitals() {
  clearTimeout(vitalsHideTimer);
  vitalsHideTimer = 0;
  const box = document.getElementById("vitals");
  if (box) box.classList.remove("show");
}
function showVitals() {
  const box = document.getElementById("vitals");
  if (!box) return;
  clearTimeout(vitalsHideTimer);
  box.classList.add("show");
  vitalsHideTimer = setTimeout(() => {
    vitalsHideTimer = 0;
    box.classList.remove("show");
  }, 2400);
}
function updateVitals() { paintVitals(); }
function setPlayerHealth(value) {
  const max = Math.max(1, Number(player.maxHealth) || 100);
  const before = player.health == null ? max : Number(player.health) || 0;
  player.health = Math.max(0, Math.min(max, Number(value) || 0));
  paintVitals();
  if (player.health !== before) showVitals();
  if (player.health <= 0 && player.alive) killPlayer();
}
function setPlayerMaxHealth(value) {
  const before = Number(player.maxHealth) || 100;
  player.maxHealth = Math.max(1, Math.min(100000, Number(value) || 100));
  player.health = Math.min(player.health == null ? player.maxHealth : player.health, player.maxHealth);
  paintVitals();
  if (player.maxHealth !== before) showVitals();
}
function damagePlayer(amount) {
  if (!player.alive) return;
  setPlayerHealth((player.health == null ? player.maxHealth : player.health) - Math.max(0, Number(amount) || 0));
}
function healPlayer(amount) {
  if (!player.alive) return;
  setPlayerHealth((player.health == null ? 0 : player.health) + Math.max(0, Number(amount) || 0));
}
function killPlayer() {
  if (!player.alive) return;
  player.health = 0;
  player.alive = false;
  player.respawnTimer = Math.max(0.5, CFG.RESPAWN_TIME);
  player.vel.set(0, 0, 0);
  paintVitals();
  showVitals();
}

function respawn() {
  player.pos.copy(SPAWN);
  player.prev.copy(SPAWN);
  player.vel.set(0, 0, 0);
  player.onGround = false;
  player.climb = null; player.climbReq = null; player.topExit = null; player.lastStep = null; player.groundT = 0;
  player.alive = true;
  player.health = player.maxHealth || 100;
  player.ff = CFG.FF_TIME;
  player.stepOff = 0;
  clearDebris("me");
  facing = Math.PI / 2;   // face -Z like Roblox spawns
  paintVitals();
  hideVitals();
}

;

/* ---- js/game/reset.js ---- */
"use strict";

/* =====================================================================
   Reset (R): joints break and every body part becomes a loose rigid box
   ===================================================================== */
const debris = [];
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _qi = new THREE.Quaternion();
const _wq = new THREE.Quaternion(), _dq = new THREE.Quaternion();
const CORNERS = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) CORNERS.push(new THREE.Vector3(sx, sy, sz));

function explode(avatar, owner, vel) {
  avatar.group.updateMatrixWorld(true);
  for (const name of Object.keys(avatar.rig)) {
    const pivot = avatar.rig[name], mesh = pivot.children[0], geo = mesh.geometry;
    geo.computeBoundingBox();
    const c = geo.boundingBox.getCenter(new THREE.Vector3());
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, mesh.material);
    m.castShadow = true;
    for (const ch of mesh.children) m.add(ch.clone());   // keep the face on the head
    m.position.copy(c).negate();
    g.add(m);
    g.position.copy(c).applyMatrix4(pivot.matrixWorld);
    pivot.getWorldQuaternion(_wq);
    g.quaternion.copy(_wq);
    scene.add(g);
    const r = () => Math.random() * 2 - 1;
    debris.push({
      owner, g, name,
      half: size.clone().multiplyScalar(0.5),
      // unit-mass box inertia (inverse), in local axes
      iinv: new THREE.Vector3(
        12 / (size.y * size.y + size.z * size.z),
        12 / (size.x * size.x + size.z * size.z),
        12 / (size.x * size.x + size.y * size.y)),
      v: new THREE.Vector3(vel.x + r() * 0.4, vel.y, vel.z + r() * 0.4),   // parts just let go and fall, keeping your momentum
      w: new THREE.Vector3(r() * 1.2, r() * 1.2, r() * 1.2),
    });
  }
}

function resetCharacter() {
  if (!player.alive) return;
  player.climb = null;
  explode(localAvatar, "me", player.vel);
  player.alive = false;
  player.respawnTimer = CFG.RESPAWN_TIME;
  player.vel.set(0, 0, 0);
  player.moveX = player.moveZ = 0;
  netSend({ t: "died" });
}

function clearDebris(owner) {
  for (let i = debris.length - 1; i >= 0; i--) {
    if (owner === undefined || debris[i].owner === owner) { scene.remove(debris[i].g); debris.splice(i, 1); }
  }
}

// world-space inverse inertia applied to a vector
function iinvMul(d, vec, out) {
  _qi.copy(d.g.quaternion).invert();
  return out.copy(vec).applyQuaternion(_qi).multiply(d.iinv).applyQuaternion(d.g.quaternion);
}

function stepDebris(dt) {
  const e0 = CFG.DEBRIS_RESTITUTION, mu = CFG.DEBRIS_FRICTION;
  for (const d of debris) {
    const stepped = window.TriancleRust && window.TriancleRust.stepDebris
      ? window.TriancleRust.stepDebris(d,dt,CFG.GRAVITY,e0,mu,solids) : null;
    if (stepped) {
      d.g.position.set(stepped[0],stepped[1],stepped[2]);
      d.g.quaternion.set(stepped[3],stepped[4],stepped[5],stepped[6]);
      d.v.set(stepped[7],stepped[8],stepped[9]);
      d.w.set(stepped[10],stepped[11],stepped[12]);
      continue;
    }
    const p = d.g.position, q = d.g.quaternion, v = d.v, w = d.w;
    v.y -= CFG.GRAVITY * dt;
    p.addScaledVector(v, dt);
    _dq.set(w.x, w.y, w.z, 0).multiply(q);
    q.set(q.x + 0.5 * dt * _dq.x, q.y + 0.5 * dt * _dq.y, q.z + 0.5 * dt * _dq.z, q.w + 0.5 * dt * _dq.w).normalize();

    let maxPen = 0, contact = false;
    for (const cs of CORNERS) {
      const r = _v1.set(cs.x * d.half.x, cs.y * d.half.y, cs.z * d.half.z).applyQuaternion(q);
      const wx = p.x + r.x, wy = p.y + r.y, wz = p.z + r.z;
      for (const b of solids) {
        if (wx < b.minX || wx > b.maxX || wz < b.minZ || wz > b.maxZ || wy > b.maxY || wy < b.minY) continue;
        const pen = b.maxY - wy;
        if (pen > maxPen) maxPen = pen;
        contact = true;
        // velocity of the contact point
        const vel = _v2.copy(w).cross(r).add(v);
        if (vel.y < 0) {
          const e = vel.y < -3 ? e0 : 0;
          const n = _v3.set(0, 1, 0);
          const rxn = _v4.copy(r).cross(n);
          const k = 1 + n.dot(iinvMul(d, rxn, _v5).cross(r));
          const j = -(1 + e) * vel.y / k;
          v.y += j;
          w.add(iinvMul(d, _v4.copy(r).cross(_v3.set(0, j, 0)), _v5));
          // friction
          const vel2 = _v2.copy(w).cross(r).add(v);
          const lt = Math.hypot(vel2.x, vel2.z);
          if (lt > 1e-4) {
            const t = _v3.set(vel2.x / lt, 0, vel2.z / lt);
            const rxt = _v4.copy(r).cross(t);
            const kt = 1 + t.dot(iinvMul(d, rxt, _v5).cross(r));
            const jt = Math.min(mu * j, lt / kt);
            v.addScaledVector(t, -jt);
            const imp = _v4.copy(t).multiplyScalar(-jt);
            w.add(iinvMul(d, _v2.copy(r).cross(imp), _v5));
          }
        }
      }
    }
    if (maxPen > 0) p.y += maxPen;
    if (contact) {
      w.multiplyScalar(Math.exp(-2.5 * dt));
      if (v.lengthSq() < 0.01 && w.lengthSq() < 0.01) { v.set(0, 0, 0); w.set(0, 0, 0); }
    }
  }
}

;

/* ---- js/game/animation.js ---- */
"use strict";

/* =====================================================================
   Animation (R6-style walk / fall poses)
   ===================================================================== */
let facing = Math.PI / 2;          // model yaw (model forward is +X)
let walkPhase = 0;
const ang = { LeftArm: 0, RightArm: 0, LeftLeg: 0, RightLeg: 0 };

function wrapPi(a) { if (window.TriancleRust && window.TriancleRust.wrapAngle && Number.isFinite(a) && Math.abs(a) <= 100) return window.TriancleRust.wrapAngle(a); while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function animationBlend(dt, rate) { return window.TriancleRust && window.TriancleRust.animationBlend ? window.TriancleRust.animationBlend(dt, rate) : 1 - Math.exp(-dt * rate); }

let air = 0, maxFall = 0, landT = 0, landAmt = 0, climbPh = 0, tAnim = 0, bodyY = 0, lean = 0, roll = 0, animState = "Idle";
function animate(dt) {
  if (window.TriancleRust && window.TriancleRust.animate) {
    const c = player.climb, mode = !c ? 0 : c.mode === "ladder" ? 1 : c.mode === "hang" ? 2 : 3;
    const state = window.TriancleRust.animate([dt, facing, walkPhase, air, maxFall, landT, landAmt, tAnim, bodyY, lean, roll,
      ang.LeftArm, ang.RightArm, ang.LeftLeg, ang.RightLeg, player.alive ? 1 : 0, player.onGround ? 1 : 0, mode,
      c ? c.face : 0, c ? c.t : 0, c ? c.dur : 1, shiftLock || firstPerson ? 1 : 0, cam.yaw, player.moveX, player.moveZ,
      player.vel.x, player.vel.y, player.vel.z, CFG.WALK_SPEED, CFG.TURN_SMOOTH, CFG.SHIFTLOCK_TURN,
      keys.KeyW || keys.KeyS || keys.ArrowUp || keys.ArrowDown ? 1 : 0, 0]);
    if (state) {
      [facing, walkPhase, air, maxFall, landT, landAmt, tAnim, bodyY, lean, roll] = state.slice(1, 11);
      [ang.LeftArm, ang.RightArm, ang.LeftLeg, ang.RightLeg] = state.slice(11, 15);
      animState = ["Idle", "Running", "Jumping", "Freefall", "Climbing"][state[32]];
      for (const n in ang) if (rig[n]) rig[n].rotation.z = ang[n];
      return;
    }
  }
  tAnim += dt;
  if (player.alive) {                                                      // turn toward movement / camera / wall
    let target = null, k = CFG.TURN_SMOOTH;
    if (player.climb) { target = player.climb.face; k = 25; }
    else if (shiftLock || firstPerson) { target = Math.atan2(Math.cos(cam.yaw), -Math.sin(cam.yaw)); k = CFG.SHIFTLOCK_TURN; }
    else if (player.moveX !== 0 || player.moveZ !== 0) target = Math.atan2(-player.moveZ, player.moveX);
    if (target !== null) facing = wrapPi(facing + wrapPi(target - facing) * animationBlend(dt, k));
  }
  const c = player.climb, speed = Math.hypot(player.vel.x, player.vel.z), sr = Math.min(1.2, speed / CFG.WALK_SPEED), vy = player.vel.y;
  if (player.onGround || c) {
    if (air > 0.3 && !c && player.alive) { landT = 0.24; landAmt = Math.min(1, maxFall / 70); }   // only real drops squash on landing
    air = 0; maxFall = 0;
  } else { air += dt; maxFall = Math.max(maxFall, -vy); }
  if (landT > 0) landT -= dt;
  let aL = 0, aR = 0, lL = 0, lR = 0, tb = 0, tl = 0, tr = 0;
  if (c) {
    animState = "Climbing";
    const u = c.t / c.dur; walkPhase += dt * 16; const s = Math.sin(walkPhase);
    if (c.mode === "ladder") {
      const mv = (keys.KeyW || keys.KeyS || keys.ArrowUp || keys.ArrowDown) ? 1 : 0;
      aL = Math.PI * 0.85 + s * 0.3 * mv; aR = Math.PI * 0.85 - s * 0.3 * mv; lL = s * 0.6 * mv; lR = -s * 0.6 * mv;
    } else if (c.mode === "hang") { aL = aR = Math.PI * 0.95; lL = 0.2; lR = -0.2; }
    else if (u < 0.65) { aL = Math.PI * 0.85 + s * 0.3; aR = Math.PI * 0.85 - s * 0.3; lL = s * 0.7; lR = -s * 0.7; }
    else { aL = aR = Math.PI * 0.4; lL = 0.5; lR = -0.2; }
  } else if (air > 0.22 && vy < 0) {           // real fall only (a 1-stud step down never gets here)
    animState = "Freefall"; aL = aR = Math.PI * 0.82 + Math.sin(tAnim * 14) * 0.1; lL = 0.35; lR = -0.25; tl = -0.05;
  } else if (!player.onGround && vy > 1) {
    animState = "Jumping"; aL = aR = Math.PI * 0.72; lL = 0.45; lR = -0.2; tl = -0.04;
  } else if (speed > 0.5) {
    animState = "Running";
    walkPhase += dt * (2 * Math.PI / 0.7) * (speed / 14.5);
    const s = Math.sin(walkPhase), a = 0.35 + 0.7 * sr;
    aR = s * a; lL = s * a; aL = -s * a * 0.95; lR = -s * a;
    tb = (Math.abs(Math.cos(walkPhase)) - 0.5) * 0.14 * sr; tl = 0.1 * sr; tr = s * 0.035 * sr;
  } else {
    animState = "Idle";
    const s = Math.sin(tAnim * 1.7); aL = s * 0.045; aR = -Math.sin(tAnim * 1.7 + 0.6) * 0.045; tb = s * 0.02;
  }
  if (landT > 0 && !c) { const kk = Math.sin((1 - landT / 0.24) * Math.PI) * landAmt; tb -= 0.45 * kk; tl += 0.12 * kk; aL += 0.5 * kk; aR += 0.5 * kk; }
  const k = animationBlend(dt, 22);
  ang.LeftArm += (aL - ang.LeftArm) * k; ang.RightArm += (aR - ang.RightArm) * k;
  ang.LeftLeg += (lL - ang.LeftLeg) * k; ang.RightLeg += (lR - ang.RightLeg) * k;
  bodyY += (tb - bodyY) * animationBlend(dt, 16); lean += (tl - lean) * animationBlend(dt, 10); roll += (tr - roll) * animationBlend(dt, 10);
  for (const n in ang) if (rig[n]) rig[n].rotation.z = ang[n];
}

;

/* ---- js/game/btools.js ---- */
"use strict";

/* =====================================================================
   BTools: spawn / select / edit parts (local only)
   ===================================================================== */
const userParts = [];
let selPart = null, btOn = false, partId = 0, placing = false, gizmoMode = "move", drag = null;
const $ = id => document.getElementById(id);
const BT_GEO = { Block: new THREE.BoxGeometry(1, 1, 1), Ball: new THREE.SphereGeometry(0.5, 24, 16), Cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 24) };
const selBox = new THREE.BoxHelper(new THREE.Mesh(BT_GEO.Block), 0x33aaff);
selBox.visible = false; scene.add(selBox);

function syncSolid(pt) {
  const h = pt.size.map(v => v / 2), s = pt.solid, p = pt.pos;
  const calculated = window.TriancleRust && window.TriancleRust.builtSolid ? window.TriancleRust.builtSolid(pt) : null;
  if (calculated) {
    [s.minX,s.maxX,s.minY,s.maxY,s.minZ,s.maxZ] = calculated.slice(0,6);
    s.ball = calculated[6] ? {cx:p.x,cy:p.y,cz:p.z,r:calculated[7]} : null;
  } else {
  s.minX = p.x - h[0]; s.maxX = p.x + h[0]; s.minY = p.y - h[1]; s.maxY = p.y + h[1]; s.minZ = p.z - h[2]; s.maxZ = p.z + h[2];
  const u = Math.max(...pt.size), round = pt.shape === "Ball" && Math.min(...pt.size) > u * 0.95;   // (a squashed ball stays a box)
  s.ball = round ? { cx: p.x, cy: p.y, cz: p.z, r: Math.min(...pt.size) / 2 } : null;
  }
  const i = solids.indexOf(s);
  if (pt.collide && i < 0) solids.push(s); else if (!pt.collide && i >= 0) solids.splice(i, 1);
}
function rebuildPart(pt) {
  const m = pt.mesh, css = "#" + pt.color.toString(16).padStart(6, "0");
  const mk = map => new THREE.MeshStandardMaterial({ color: map ? 0xffffff : pt.color, map: map || null, roughness: 0.6, metalness: 0,
    transparent: pt.transp > 0, opacity: 1 - pt.transp, depthWrite: pt.transp < 0.5 });
  m.geometry = BT_GEO[pt.shape];
  if (pt.shape === "Block") {
    const plain = mk(null), r = [pt.size[0], pt.size[2]];
    m.material = [plain, plain, mk(studTexture(css, r, IMG_STUD)), mk(studTexture(css, r, IMG_INLET)), plain, plain];
  } else m.material = mk(null);
  m.scale.set(pt.size[0], pt.size[1], pt.size[2]);
  m.position.copy(pt.pos);
  m.castShadow = m.receiveShadow = true;
  syncSolid(pt);
}
function syncPanel() {
  $("btProps").style.display = selPart ? "block" : "none";
  updateHint();
  if (!selPart) return;
  const pt = selPart;
  $("btShape").value = pt.shape;
  ["sx", "sy", "sz"].forEach((id, i) => { $(id).value = pt.size[i]; });
  $("px").value = +pt.pos.x.toFixed(2); $("py").value = +pt.pos.y.toFixed(2); $("pz").value = +pt.pos.z.toFixed(2);
  $("btT").value = pt.transp; $("btC").value = "#" + pt.color.toString(16).padStart(6, "0");
  $("btA").checked = pt.anchored; $("btK").checked = pt.collide;
}
function selectPart(pt) {
  selPart = pt; selBox.visible = !!pt;
  if (pt) { pt.mesh.updateMatrixWorld(true); selBox.setFromObject(pt.mesh); }
  syncPanel();
}
function updateHint() {
  const h = $("btHint");
  if (placing) { h.style.display = "block"; h.textContent = "Click in the world to place the part"; }
  else if (!selPart) { h.style.display = "block"; h.textContent = "Click a part to select it"; }
  else h.style.display = "none";
}
function spawnPart(at) {
  const dx = Math.cos(facing), dz = -Math.sin(facing);
  const pt = { id: ++partId, gid: NET.id + ":" + partId, owner: NET.id, mesh: new THREE.Mesh(), shape: "Block", size: [4, 1, 2], color: 0xa3a2a5, transp: 0, anchored: true, collide: true, vy: 0, solid: {},
    pos: at ? at.clone() : new THREE.Vector3(player.pos.x + dx * 7, player.pos.y + 3, player.pos.z + dz * 7) };
  scene.add(pt.mesh); userParts.push(pt); rebuildPart(pt); selectPart(pt); markPart(pt);
}
function removePart(pt, silent) {
  if (!silent && pt.owner === NET.id) netSend({ t: "partdel", g: pt.gid });
  scene.remove(pt.mesh); const i = solids.indexOf(pt.solid); if (i >= 0) solids.splice(i, 1);
  userParts.splice(userParts.indexOf(pt), 1);
  if (selPart === pt) selectPart(null);
}
function applyPanel(e) {
  const pt = selPart; if (!pt) return;
  const n = id => parseFloat($(id).value);
  pt.shape = $("btShape").value;
  pt.size = ["sx", "sy", "sz"].map(id => Math.max(0.2, n(id) || 1));
  if (["px", "py", "pz"].includes(e.target.id)) pt.pos.set(n("px") || 0, n("py") || 0, n("pz") || 0);
  pt.transp = n("btT") || 0; pt.color = parseInt($("btC").value.slice(1), 16) || 0;
  pt.anchored = $("btA").checked; pt.collide = $("btK").checked; if (pt.anchored) pt.vy = 0;
  rebuildPart(pt); selBox.setFromObject(pt.mesh); markPart(pt);
  if (e.target.type !== "number") e.target.blur();
}
/* who may use BTools in this game: the game's setting is "all" (default), "staff" (Owner + Admin badge) or "off" */
const btMode = () => (curGame && curGame.btools) || "all";
function canBuild() {
  const m = btMode();
  const allowed = window.TriancleRust && window.TriancleRust.canBuild ? window.TriancleRust.canBuild(m,!!acct.user,isOwner(),!!(acct.user && badgeList(acct.user.id).includes("admin"))) : null;
  if (allowed !== null) return allowed;
  if (m === "off") return false;
  if (m === "staff") return !!acct.user && (isOwner() || badgeList(acct.user.id).includes("admin"));
  return true;
}
function applyBuildAccess() { const ok = canBuild(); $("slotBT").style.display = ok ? "" : "none"; if (!ok && btOn) toggleBT(); }
function toggleBT() {
  if (!btOn && !canBuild()) return;
  btOn = !btOn; $("bt").style.display = btOn ? "block" : "none"; $("slotBT").classList.toggle("on", btOn);
  if (!btOn) { selectPart(null); placing = false; drag = null; canvas.style.cursor = ""; }
}
function stepUserParts(dt) {
  for (let i = userParts.length - 1; i >= 0; i--) {
    const pt = userParts[i]; if (pt.anchored) continue;
    const stepped = window.TriancleRust && window.TriancleRust.stepBuiltPart ? window.TriancleRust.stepBuiltPart(pt, dt, CFG.GRAVITY, solids) : null;
    if (stepped) { pt.pos.y = stepped[0]; pt.vy = stepped[1]; } else {
    pt.vy -= CFG.GRAVITY * dt; pt.pos.y += pt.vy * dt;
    const hx = pt.size[0] / 2, hy = pt.size[1] / 2, hz = pt.size[2] / 2, p = pt.pos;
    if (pt.collide) for (const s of solids) {
      if (s === pt.solid || pt.vy > 0) continue;
      if (p.x + hx > s.minX && p.x - hx < s.maxX && p.z + hz > s.minZ && p.z - hz < s.maxZ && p.y + hy > s.minY && p.y - hy < s.maxY) { p.y = s.maxY + hy; pt.vy = 0; }
    }
    }
    const p = pt.pos;
    if (p.y < CFG.FALL_DESTROY_Y) { removePart(pt); continue; }
    if (pt.vy !== 0) pt.mv = true; else if (pt.mv) { pt.mv = false; markPart(pt); }   // settled: tell everyone where it landed
    pt.mesh.position.copy(p); syncSolid(pt);
  }
}
const partDirty = new Set(); let partTimer = 0;
function markPart(pt) { if (pt.owner === NET.id) partDirty.add(pt); }
function sendAllMyParts() { for (const pt of userParts) markPart(pt); }
function flushParts(dt) {
  partTimer += dt; if (partTimer < 0.12 || !partDirty.size) return; partTimer = 0;
  const arr = [...partDirty].filter(pt => userParts.includes(pt)).map(pt => ({ g: pt.gid, sh: pt.shape, sz: pt.size, c: pt.color, t: pt.transp, an: pt.anchored ? 1 : 0, co: pt.collide ? 1 : 0, p: [pt.pos.x, pt.pos.y, pt.pos.z] }));
  partDirty.clear();
  for (let i = 0; i < arr.length; i += 20) netSend({ t: "parts", list: arr.slice(i, i + 20) });
}
function applyRemotePart(d, owner) {
  const num = v => typeof v === "number" && isFinite(v);
  if (!d || typeof d.g !== "string" || !Array.isArray(d.sz) || d.sz.length !== 3 || !Array.isArray(d.p) || d.p.length !== 3 || !d.sz.every(num) || !d.p.every(num)) return;
  let pt = userParts.find(q => q.gid === d.g);
  if (pt && pt.owner !== owner) return;                       // nobody can overwrite someone else's part
  if (!pt) { pt = { id: ++partId, gid: d.g, owner, mesh: new THREE.Mesh(), vy: 0, solid: {}, pos: new THREE.Vector3() }; scene.add(pt.mesh); userParts.push(pt); }
  pt.shape = BT_GEO[d.sh] ? d.sh : "Block";
  const normalized = window.TriancleRust && window.TriancleRust.remotePart ? window.TriancleRust.remotePart(d) : null;
  if (normalized) { pt.size = normalized.slice(0,3); pt.color = normalized[6]; pt.transp = normalized[7]; pt.anchored = !!normalized[8]; pt.collide = !!normalized[9]; pt.vy = 0; pt.pos.set(normalized[3],normalized[4],normalized[5]); }
  else { pt.size = d.sz.map(v => Math.max(0.2, Math.min(512, v))); pt.color = (d.c | 0) & 0xffffff; pt.transp = Math.max(0, Math.min(1, +d.t || 0)); pt.anchored = !!d.an; pt.collide = !!d.co; pt.vy = 0; pt.pos.set(d.p[0], d.p[1], d.p[2]); }
  rebuildPart(pt);
}
function onPartMsg(m) {
  if (btMode() === "off") return;                                   // building is switched off in this game: ignore anyone else's parts
  if (!m || !m.id || m.id === NET.id) return;
  const id = String(m.id);
  if (m.t === "parts" && Array.isArray(m.list)) { for (const d of m.list.slice(0, 40)) applyRemotePart(d, id); }
  else if (m.t === "partdel") { const pt = userParts.find(q => q.gid === m.g && q.owner === id); if (pt) removePart(pt, true); }
  else if (m.t === "partreq") sendAllMyParts();
}
/* ---- hitboxes (` key): every collidable part, ladders, and player boxes ---- */
let hitOn = false;
const hitGroup = new THREE.Group(); hitGroup.visible = false; scene.add(hitGroup);
const HB_GEO = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), hbPool = [];
function updateHitboxes() {
  hitGroup.visible = hitOn; if (!hitOn) return;
  let n = 0;
  const put = (cx, cy, cz, sx, sy, sz, col, depth) => {
    let l = hbPool[n]; if (!l) { l = new THREE.LineSegments(HB_GEO, new THREE.LineBasicMaterial()); l.renderOrder = 5; hitGroup.add(l); hbPool[n] = l; }
    l.visible = true; l.material.color.setHex(col); l.material.depthTest = depth; l.position.set(cx, cy, cz); l.scale.set(sx, sy, sz); n++;
  };
  for (const b of solids) { const sx = b.maxX - b.minX; if (sx < 100) put((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2, sx, b.maxY - b.minY, b.maxZ - b.minZ, 0x3cff7a, true); }
  for (const L of LADDERS) put((L.x0 + L.x1) / 2, (L.y0 + L.y1) / 2, (L.z0 + L.z1) / 2, L.x1 - L.x0, L.y1 - L.y0, L.z1 - L.z0, 0xffd83c, true);
  for (const pl of players.values()) { const g = pl.avatar.group; if (g.visible) put(g.position.x, g.position.y + CFG.CHAR_HEIGHT / 2, g.position.z, CFG.CHAR_HALF_XZ * 2, CFG.CHAR_HEIGHT, CFG.CHAR_HALF_XZ * 2, pl.local ? 0xff4040 : 0xff9a3c, false); }
  for (let i = n; i < hbPool.length; i++) hbPool[i].visible = false;
}
$("btSpawn").addEventListener("click", () => { placing = !placing; canvas.style.cursor = placing ? "crosshair" : ""; updateHint(); });
$("btDel").addEventListener("click", () => { if (selPart) removePart(selPart); });
$("slotBT").addEventListener("click", toggleBT);
["btShape", "sx", "sy", "sz", "px", "py", "pz", "btT", "btC", "btA", "btK"].forEach(id => $(id).addEventListener("input", applyPanel));
/* ---- 3D handles: arrows to move, boxes to resize (1-stud snapping) ---- */
const GCOL = [0xff4444, 0x44dd44, 0x4488ff], AX = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const gizmo = new THREE.Group(); gizmo.visible = false; scene.add(gizmo);
const gHandles = [];
for (let a = 0; a < 3; a++) for (const sg of [1, -1]) for (const kind of ["move", "size"]) {
  const geo = kind === "move" ? new THREE.ConeGeometry(0.45, 1.3, 14) : new THREE.BoxGeometry(0.7, 0.7, 0.7);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: GCOL[a], depthTest: false, transparent: true, opacity: 0.95 }));
  m.renderOrder = 999; m.userData = { a, sg, kind };
  if (kind === "move") m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), AX[a].clone().multiplyScalar(sg));
  gizmo.add(m); gHandles.push(m);
}
function updateGizmo() {
  if (!selPart || !btOn) { gizmo.visible = false; return; }
  gizmo.visible = true;
  const pt = selPart, k = Math.max(0.35, camera.position.distanceTo(pt.pos) * 0.05);
  for (const m of gHandles) {
    const { a, sg, kind } = m.userData; m.visible = kind === gizmoMode;
    m.position.copy(pt.pos).addScaledVector(AX[a], sg * (pt.size[a] / 2 + (kind === "move" ? 1.2 : 0.7) * k));
    m.scale.setScalar(k);
  }
}
function setMode(md) { gizmoMode = md; $("btMove").style.opacity = md === "move" ? 1 : 0.55; $("btSize").style.opacity = md === "size" ? 1 : 0.55; }
$("btMove").addEventListener("click", () => setMode("move")); $("btSize").addEventListener("click", () => setMode("size")); setMode("move");
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
function aimRay(e) { _ndc.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); _ray.setFromCamera(_ndc, camera); }
function axisParam(origin, dir) {   // where along the axis line the mouse ray passes closest
  if (window.TriancleRust && window.TriancleRust.axisParam) { const result = window.TriancleRust.axisParam(origin,dir,_ray.ray); if (result) return result.value; }
  const r = _ray.ray, b = dir.dot(r.direction), w0 = origin.clone().sub(r.origin);
  const den = 1 - b * b; if (Math.abs(den) < 1e-4) return null;
  return (b * r.direction.dot(w0) - dir.dot(w0)) / den;
}
canvas.addEventListener("mousedown", e => {
  if (!btOn || e.button !== 0 || document.pointerLockElement) return;
  aimRay(e);
  if (placing) {                                   // place the new part where you clicked
    const hit = _ray.intersectObjects(scene.children.filter(o => o.isMesh && o.receiveShadow), false)[0];
    if (hit) {
      const n = hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0), sz = [4, 1, 2];
      const off = Math.abs(n.x) * sz[0] / 2 + Math.abs(n.y) * sz[1] / 2 + Math.abs(n.z) * sz[2] / 2;
      const at = hit.point.clone().addScaledVector(n, off); at.x = Math.round(at.x); at.z = Math.round(at.z);
      spawnPart(at); placing = false; canvas.style.cursor = ""; updateHint();
    }
    return;
  }
  if (selPart) {
    gizmo.updateMatrixWorld(true);
    const h = _ray.intersectObjects(gHandles.filter(m => m.visible), false)[0];
    if (h) {
      const { a, sg, kind } = h.object.userData, s0 = axisParam(selPart.pos, AX[a]);
      if (s0 !== null) { drag = { a, sg, kind, s0, pos: selPart.pos.clone(), size: selPart.size.slice(), last: null }; selPart.vy = 0; }
      return;
    }
  }
  const hit = _ray.intersectObjects(userParts.filter(p => p.owner === NET.id).map(p => p.mesh))[0];   // you can only edit your own parts
  selectPart(hit ? userParts.find(p => p.mesh === hit.object) : null);
});
window.addEventListener("mousemove", e => {
  if (!drag || !selPart) return;
  aimRay(e);
  const s = axisParam(drag.pos, AX[drag.a]); if (s === null) return;
  const d = s - drag.s0, pt = selPart, a = drag.a;
  if (drag.kind === "move") {
    const q = Math.round(d); if (q === drag.last) return; drag.last = q;
    pt.pos.copy(drag.pos).addScaledVector(AX[a], q); pt.mesh.position.copy(pt.pos); syncSolid(pt);
  } else {
    const ns = Math.max(1, Math.round(drag.size[a] + drag.sg * d)); if (ns === drag.last) return; drag.last = ns;
    pt.size = drag.size.slice(); pt.size[a] = ns;
    pt.pos.copy(drag.pos).addScaledVector(AX[a], drag.sg * (ns - drag.size[a]) / 2); rebuildPart(pt);
  }
  markPart(pt); syncPanel();
});
window.addEventListener("mouseup", () => { drag = null; });

;

/* ---- js/core/loop.js ---- */
"use strict";

/* =====================================================================
   Main loop
   ===================================================================== */
const hud = document.getElementById("hud");
const msg = document.getElementById("msg");
const FIXED = 1 / CFG.PHYSICS_HZ;
let last = performance.now(), acc = 0, hudTimer = 0, fps = 60;
const deadFocus = new THREE.Vector3(), tmp = new THREE.Vector3(), focus = new THREE.Vector3(), desired = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  if (!inGame) { last = now; return; }
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.05;

  // camera keys (arrow left/right rotate, I/O zoom)
  if (keys.ArrowLeft)  cam.yaw += CFG.CAM_ARROW_SPEED * dt;
  if (keys.ArrowRight) cam.yaw -= CFG.CAM_ARROW_SPEED * dt;
  if (keys.KeyI) cam.zoomTarget = Math.max(CFG.CAM_ZOOM_MIN, cam.zoomTarget - 12 * dt);
  if (keys.KeyO) cam.zoomTarget = Math.min(CFG.CAM_ZOOM_MAX, cam.zoomTarget + 12 * dt);

  acc += dt;
  while (acc >= FIXED) { physicsStep(FIXED); acc -= FIXED; }
  const alpha = acc / FIXED;
  if (TOUCH_HANDLERS.length) checkTouchScripts();

  animate(dt);

  // interpolated render position
  tmp.lerpVectors(player.prev, player.pos, alpha);
  player.stepOff *= Math.exp(-dt * CFG.STEP_SMOOTH);
  tmp.y += player.stepOff;
  charGroup.position.copy(tmp);
  charGroup.rotation.y = facing + CFG.MODEL_FRONT_OFFSET;
  charGroup.position.y += bodyY; charGroup.rotation.z = -lean; charGroup.rotation.x = roll;

  // camera
  if (player.alive) deadFocus.set(tmp.x, tmp.y + CFG.CAM_FOCUS_Y, tmp.z);
  else {                                        // dead: camera follows the loose head
    const hd = debris.find(d => d.owner === "me" && d.name === "Head");
    if (hd) deadFocus.copy(hd.g.position);
  }
  const cameraState = window.TriancleRust && window.TriancleRust.cameraFrame ? window.TriancleRust.cameraFrame(cam,deadFocus,shiftLock && !firstPerson && player.alive,dt,CFG.SHIFTLOCK_OFFSET,BASEPLATE_HALF) : null;
  if (cameraState) { cam.zoom = cameraState[0]; cam.shift = cameraState[1]; focus.set(cameraState[2],cameraState[3],cameraState[4]); desired.set(cameraState[5],cameraState[6],cameraState[7]); }
  else {
  cam.zoom += (cam.zoomTarget - cam.zoom) * (1 - Math.exp(-dt * 20));
  cam.shift += (((shiftLock && !firstPerson && player.alive) ? 1 : 0) - cam.shift) * (1 - Math.exp(-dt * 15));
  const shiftOff = CFG.SHIFTLOCK_OFFSET * cam.shift;
  focus.set(deadFocus.x + Math.cos(cam.yaw) * shiftOff, deadFocus.y, deadFocus.z - Math.sin(cam.yaw) * shiftOff);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  desired.set(
    focus.x + cam.zoom * Math.sin(cam.yaw) * cp,
    focus.y + cam.zoom * sp,
    focus.z + cam.zoom * Math.cos(cam.yaw) * cp
  );
  // keep the camera above the baseplate (simple stand-in for Roblox's Popper)
  const MIN_Y = 0.25;
  if (desired.y < MIN_Y && focus.y > MIN_Y &&
      Math.abs(desired.x) < BASEPLATE_HALF && Math.abs(desired.z) < BASEPLATE_HALF) {
    const s = (focus.y - MIN_Y) / (focus.y - desired.y);
    desired.sub(focus).multiplyScalar(s).add(focus);
  }
  }
  camera.position.copy(desired);
  camera.lookAt(focus);

  firstPerson = cam.zoom < 0.6;
  charGroup.visible = player.alive;
  rig.Head.visible = !firstPerson;               // first person: see your body, not the inside of your head
  crossEl.style.display = ((shiftLock || firstPerson) && player.alive && !uiOpen() && hasLock()) ? "block" : "none";
  canvas.style.cursor = (shiftLock && !uiOpen()) ? "none" : "";
  if (!wantLock() && !rmbDown && hasLock()) document.exitPointerLock();
  lockTry += dt; if (lockTry > 0.4) { lockTry = 0; ensureLock(); }
  if (player.ff > 0) player.ff -= dt;
  FF_MAT.opacity = 0.32 + 0.14 * Math.sin(now / 90);
  setFF(localAvatar, player.alive && player.ff > 0 && (player.ff > 0.6 || Math.floor(player.ff * 12) % 2 === 0));

  updateRemotes(dt);
  if (selPart) selBox.setFromObject(selPart.mesh);
  updateGizmo();
  camera.updateMatrixWorld();
  updateTags();

  NET.timer += dt;
  if (NET.timer >= NET.interval) {
    NET.timer = 0;
    const r2 = v => typeof v === "number" && window.TriancleRust && window.TriancleRust.networkRound ? window.TriancleRust.networkRound(v) : Math.round(v * 100) / 100;
    const msg = { t: "s", x: r2(charGroup.position.x), y: r2(charGroup.position.y - bodyY), z: r2(charGroup.position.z),
      f: r2(facing), a: [r2(ang.LeftArm), r2(ang.RightArm), r2(ang.LeftLeg), r2(ang.RightLeg)], al: player.alive ? 1 : 0, ff: player.ff > 0 ? 1 : 0, l: r2(lean), r: r2(roll), b: r2(bodyY) };
    const sig = JSON.stringify([msg.x, msg.y, msg.z, msg.f, msg.a, msg.al, msg.ff, msg.l, msg.r]);
    NET.idle += NET.interval;
    if (sig !== NET.lastSig || NET.idle >= 1) {      // idle players only send a 1 s heartbeat
      NET.lastSig = sig; NET.idle = 0;
      netSend(msg);
    }
  }

  updateHitboxes(); flushParts(dt);

  // sun + shadow follow the player
  sun.position.set(tmp.x + SUN_DIR.x * 80, tmp.y + SUN_DIR.y * 80, tmp.z + SUN_DIR.z * 80);
  sun.target.position.copy(tmp);
  sky.position.copy(camera.position);

  if (GFX[gfxLevel].bloom && ensureComposer()) composer.render(dt); else renderer.render(scene, camera);

  // HUD
  hudTimer += dt;
  if (hudTimer > 0.1) {
    hudTimer = 0;
    const sp2 = Math.hypot(player.vel.x, player.vel.z);
    hud.textContent = gmStatsEl.textContent =
      "state  " + (player.alive ? animState : "Dead") + "\n" +
      "speed  " + sp2.toFixed(2) + " studs/s   vy " + player.vel.y.toFixed(1) + "\n" +
      "pos    " + player.pos.x.toFixed(1) + ", " + player.pos.y.toFixed(1) + ", " + player.pos.z.toFixed(1) + "\n" +
      "fps    " + Math.round(fps) + "  (physics " + CFG.PHYSICS_HZ + " Hz)\n" +
      "net    " + NET.status + (NET.err ? " [" + NET.err + "]" : "") + "  (" + players.size + " player" + (players.size === 1 ? "" : "s") + ")";
    msg.style.display = "none";
  }
}

;

/* ---- js/ui/colors.js ---- */
"use strict";

/* =====================================================================
   Body colours (in-game popup) + account (login / saving)
   Colours are stored as { Head: "#rrggbb", Torso: ..., LeftArm, RightArm, LeftLeg, RightLeg }.
   Guests save to this device; logged-in players save to Supabase (CFG.SAVE_TABLE).
   ===================================================================== */
const PART_ORDER = ["Head", "Torso", "LeftArm", "RightArm", "LeftLeg", "RightLeg"];
const PART_LABEL = { Head: "Head", Torso: "Torso", LeftArm: "Left Arm", RightArm: "Right Arm", LeftLeg: "Left Leg", RightLeg: "Right Leg" };
const PALETTE = [
  "#f2f3f3", "#e5e4df", "#a3a2a5", "#635f62", "#1b2a35", "#0b0b0b",
  "#f8d9b8", "#e7b98f", "#cc8e69", "#a05f35", "#694028", "#4a2d1b",
  "#c4281c", "#da8541", "#f5cd30", "#a4bd47", "#4b974b", "#287f47",
  "#18b3ad", "#75c6f0", "#0d69ac", "#203a56", "#6b327c", "#a06bbf",
  "#e8bac8", "#ff66cc", "#cd6298", "#7b2e2f", "#9a5b2b", "#d7c59a",
];
const HEX_RE = /^#[0-9a-f]{6}$/i;
const GUEST_KEY = "bodyColors";
const DEFAULT_COLORS = {};
for (const n of PART_ORDER) DEFAULT_COLORS[n] = "#" + PART_STYLE[n].toString(16).padStart(6, "0");

function sanitizeColors(o) {
  if (window.TriancleRust && window.TriancleRust.sanitizeColors) { const result = window.TriancleRust.sanitizeColors(o,DEFAULT_COLORS); if (result) return result; }
  const out = {};
  for (const n of PART_ORDER) out[n] = (o && (window.TriancleRust && window.TriancleRust.validColor ? window.TriancleRust.validColor(o[n]) : typeof o[n] === "string" && HEX_RE.test(o[n]))) ? o[n].toLowerCase() : DEFAULT_COLORS[n];
  out.face = (o && Number.isInteger(o.face) && o.face >= 0 && o.face < 100000) ? o.face : 0;
  out.body = (o && o.body === "female") ? "female" : "male";
  return out;
}
const colorSig = c => PART_ORDER.map(n => c[n]).join() + "|" + c.face + "|" + (c.body === "female" ? "f" : "m");
function setAvatarColors(av, colors) {
  for (const n of PART_ORDER) { const pv = av.rig[n]; if (pv) pv.children[0].material.color.set(colors[n]); }
  setAvatarFace(av, colors.face | 0);
  setAvatarBody(av, colors.body === "female");
}
function applyRemoteColors(pl, colors) {
  if (!colors || typeof colors !== "object") return;
  const c = sanitizeColors(colors), sig = colorSig(c);
  if (pl.colorSig === sig) return;
  pl.colorSig = sig; pl.colors = c; setAvatarColors(pl.avatar, c);
}
function loadGuestColors() {
  try { return sanitizeColors(JSON.parse(localStorage.getItem(GUEST_KEY) || "null")); } catch (_) { return sanitizeColors(null); }
}
let myColors = loadGuestColors();
setAvatarColors(localAvatar, myColors);
const WEAR = { mine: [] };                       // ids of the UGC items you are wearing
function presenceInfo() { return { name: myName, colors: myColors, items: WEAR.mine }; }

const authEl = $("auth");
function uiAuthOpen() { return authEl.classList.contains("open"); }
function uiOpen() { return uiAuthOpen() || menuOpen; }
function freeMouse() {                          // popups need a normal cursor: let go of the mouse (shift lock stays ON and comes back after)
  for (const k in keys) keys[k] = false;
  if (document.pointerLockElement) document.exitPointerLock();
}

/* ---- body colour popup ---- */
let colPart = "Head", saveTimer = 0, netColT = 0;
function saveStatus(t) { $("colSave").textContent = t; }
let hsv = { h: 0, s: 0, v: 1 };
function hsv2rgb(h, s, v) {
  if (window.TriancleRust && window.TriancleRust.hsvToRgb && Number.isFinite(h) && h >= 0 && h <= 360 && Number.isFinite(s) && s >= 0 && s <= 1 && Number.isFinite(v) && v >= 0 && v <= 1) return window.TriancleRust.hsvToRgb(h, s, v);
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}
function hsvToHex(c) { return "#" + hsv2rgb(c.h, c.s, c.v).map(x => x.toString(16).padStart(2, "0")).join(""); }
function hexToHsv(hex) {
  if (window.TriancleRust && window.TriancleRust.rgbToHsv && typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex) && hex.length === 7) return window.TriancleRust.rgbToHsv(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: mx ? d / mx : 0, v: mx };
}
function drawWheel() {
  const cv = $("wheel"), c = cv.getContext("2d"), N = cv.width, R = N / 2 - 3, img = c.createImageData(N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - N / 2 + 0.5, dy = y - N / 2 + 0.5, r = Math.hypot(dx, dy) / R;
    if (r > 1) continue;
    const i = (y * N + x) * 4, rgb = hsv2rgb((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, r, hsv.v);
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const a = hsv.h * Math.PI / 180, mx = N / 2 + Math.cos(a) * hsv.s * R, my = N / 2 + Math.sin(a) * hsv.s * R;
  c.beginPath(); c.arc(mx, my, 7, 0, 6.2832); c.lineWidth = 4; c.strokeStyle = "#000"; c.stroke(); c.lineWidth = 2; c.strokeStyle = "#fff"; c.stroke();
}
(function buildColorsUI() {
  const parts = $("colParts"), cv = $("wheel");
  for (const n of PART_ORDER) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.p = n;
    b.innerHTML = '<span class="chip"></span><span>' + PART_LABEL[n] + "</span>";
    b.addEventListener("click", () => { colPart = n; refreshColorsUI(); });
    parts.appendChild(b);
  }
  let drag = false;
  const pick = e => {
    const rc = cv.getBoundingClientRect(), N = cv.width, R = N / 2 - 3;
    const dx = (e.clientX - rc.left) * N / rc.width - N / 2, dy = (e.clientY - rc.top) * N / rc.height - N / 2;
    hsv = { h: (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, s: Math.min(1, Math.hypot(dx, dy) / R), v: hsv.v };
    setPartColor(colPart, hsvToHex(hsv));
  };
  cv.addEventListener("pointerdown", e => { drag = true; cv.setPointerCapture(e.pointerId); pick(e); });
  cv.addEventListener("pointermove", e => { if (drag) pick(e); });
  cv.addEventListener("pointerup", () => { drag = false; });
  cv.addEventListener("pointercancel", () => { drag = false; });
  $("valSlider").addEventListener("input", e => { hsv = { h: hsv.h, s: hsv.s, v: e.target.value / 100 }; setPartColor(colPart, hsvToHex(hsv)); });
  $("hexIn").addEventListener("input", e => { const v = e.target.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) setPartColor(colPart, v[0] === "#" ? v : "#" + v); });
})();
function refreshColorsUI() {
  const cur = myColors[colPart];
  for (const b of $("colParts").children) {
    b.classList.toggle("on", b.dataset.p === colPart);
    b.firstChild.style.background = myColors[b.dataset.p];
  }
  if (hsvToHex(hsv) !== cur) hsv = hexToHsv(cur);                 // picked a different part / reset / loaded a save
  $("valSlider").value = Math.round(hsv.v * 100); $("hexChip").style.background = cur;
  if (document.activeElement !== $("hexIn")) $("hexIn").value = cur;
  drawWheel();
  refreshFacesUI();
  for (const b of document.querySelectorAll("#avBody button")) b.classList.toggle("on", b.dataset.body === myColors.body);
}
function colorsChanged() {
  setAvatarColors(localAvatar, myColors);
  refreshColorsUI();
  clearTimeout(netColT);
  netColT = setTimeout(() => netSend({ t: "colors", colors: myColors }), 200);
  queueSave();
}
function setPartColor(n, hex) { myColors[n] = hex.toLowerCase(); colorsChanged(); }
function setMyColors(c) { myColors = c; setAvatarColors(localAvatar, myColors); refreshColorsUI(); netSend({ t: "colors", colors: myColors }); }
$("colReset").addEventListener("click", () => { const f = myColors.face, b = myColors.body; myColors = sanitizeColors(null); myColors.face = f; myColors.body = b; colorsChanged(); });
function openColors() {
  refreshColorsUI();
  saveStatus(acct.user ? "Saves to your account" : "Saves on this device (log in to keep it on your account)");
}

;

/* ---- js/ui/account.js ---- */
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
  $("hWho").textContent = on ? acct.username : ""; $("hUser").hidden = !on; $("hLogin").hidden = on;
  if (!on) hMenuToggle(false);
  hdrAv();
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
  loadWallet(); loadInventory(); loadNotifs();
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
  if (window.TriancleRust && window.TriancleRust.authError && e && typeof e === "object" && (Object.getPrototypeOf(e) === Object.prototype || Object.getPrototypeOf(e) === null)) {
    const status = Object.getOwnPropertyDescriptor(e,"status");
    if ((!status || "value" in status) && (status || !("status" in Object.prototype))) {
      const category = window.TriancleRust.authError(code,msg,!!status && status.value === 429);
      if (category === 1) return "That username is taken.";
      if (category === 2) return "Wrong username or password.";
      if (category === 3) return "Supabase is still asking for email confirmation. Turn off Confirm email in Authentication settings.";
      if (category === 4) return "Too many tries, wait a minute and try again.";
      if (category === 5) return "Supabase rejected the fake email domain. Set AUTH_EMAIL_DOMAIN in CFG to a domain that has MX records.";
      if (category === 6) return msg || "Password is too weak.";
    }
  }
  if (code === "user_already_exists" || /already registered/i.test(msg)) return "That username is taken.";
  if (code === "invalid_credentials" || /invalid login/i.test(msg)) return "Wrong username or password.";
  if (code === "email_not_confirmed" || /not confirmed/i.test(msg)) return "Supabase is still asking for email confirmation. Turn off Confirm email in Authentication settings.";
  if (code === "over_request_rate_limit" || e.status === 429) return "Too many tries, wait a minute and try again.";
  if (code === "email_address_invalid" || /address .* is invalid/i.test(msg)) return "Supabase rejected the fake email domain. Set AUTH_EMAIL_DOMAIN in CFG to a domain that has MX records.";
  if (code === "weak_password") return msg || "Password is too weak.";
  return msg || (mode === "signup" ? "Couldn't create the account." : "Couldn't log in.");
}
function validUsername(value) { if (window.TriancleRust && window.TriancleRust.validUsername) { const ok = window.TriancleRust.validUsername(value); if (ok !== null) return ok; } return /^[A-Za-z0-9_]{3,20}$/.test(value); }
async function submitAuth() {
  if (acct.busy) return;
  const sb = getSB();
  if (!sb) return authMsg("Supabase isn't set up yet. Put SUPABASE_URL and SUPABASE_ANON_KEY in CFG at the top of index.html.", true);
  const u = authUser.value.trim(), pw = authPass.value;
  if (!validUsername(u)) return authMsg("Username: 3-20 letters, numbers or _", true);
  const passwordValid = window.TriancleRust && window.TriancleRust.passwordLengthValid ? window.TriancleRust.passwordLengthValid(pw.length) : null;
  if (passwordValid === false || (passwordValid === null && pw.length < 6)) return authMsg("Password must be at least 6 characters.", true);
  acct.busy = true; authGo.disabled = true;
  authMsg(acct.mode === "signup" ? "Creating account…" : "Logging in…");
  const rustEmail = window.TriancleRust && window.TriancleRust.loginEmail ? window.TriancleRust.loginEmail(u,CFG.AUTH_EMAIL_DOMAIN) : null;
  let email = rustEmail === null ? u.toLowerCase() + "@" + CFG.AUTH_EMAIL_DOMAIN : rustEmail;
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
/* top-right account menu: your picture + name, opens Profile / Customize avatar / Settings / Sign out */
function hdrAv() {                                                  // your picture (with whatever you wear) in the corner
  const img = $("hUserImg"); if (!img || !acct.user) return;
  img.dataset.tu = acct.user.id;
  try { const u = thumb(myColors, "face", acct.user.id); if (u) img.src = u; } catch (_) {}
}
function hMenuToggle(open) {
  const m = $("hMenu"), b = $("hUser"); if (!m || !b) return;
  m.hidden = !open; b.setAttribute("aria-expanded", open ? "true" : "false"); b.classList.toggle("open", !!open);
}
$("hUser").addEventListener("click", e => { e.stopPropagation(); hMenuToggle($("hMenu").hidden); });
$("hMenu").addEventListener("click", e => {
  e.stopPropagation();
  const b = e.target.closest("button"); if (!b) return;
  hMenuToggle(false);
  if (b.dataset.go) showTab(b.dataset.go);
});
document.addEventListener("click", () => hMenuToggle(false));
document.addEventListener("keydown", e => { if (e.key === "Escape") hMenuToggle(false); });
$("hLogin").addEventListener("click", () => location.reload());
$("acctBtn").addEventListener("click", signOutNow);
$("hAcct").addEventListener("click", signOutNow);
for (const el of [authUser, authPass]) el.addEventListener("keydown", e => {
  e.stopPropagation();
  if (e.key === "Enter") submitAuth();
});
authUser.addEventListener("focus", () => { for (const k in keys) keys[k] = false; });
authPass.addEventListener("focus", () => { for (const k in keys) keys[k] = false; });

;

/* ---- js/ui/home.js ---- */
"use strict";

/* ---- home screen: Games + Avatar tabs ---- */
let starting = false;
function startGame(web) {
  if (APP.required && !APP.in && web !== true) { showAppPrompt(curGame && curGame.id); return; }   // games run in the desktop app
  if (!acct.user) { openAuth("login"); return; }
  if (starting) return; starting = true;
  if (typeof rememberGame === "function" && curGame) rememberGame(curGame.id);
  const veil = $("veil"); veil.classList.add("on");                  // quick fade to black, swap to the game, fade back in
  setTimeout(async () => {
    if (curGame.custom && !curGame.map) { try { await loadCustomMap(curGame); } catch (_) { veil.classList.remove("on"); starting = false; uiAlert("Couldn't load that map."); return; } }
    buildWorld(curGame); CFG.ROOM = curGame.room; applyBuildAccess();                // the map you picked, and its own multiplayer room
    inGame = true; document.body.classList.remove("home");
    if (document.activeElement) document.activeElement.blur();
    last = performance.now();
    if (!netStarted) { netStarted = true; netConnect(); }          // you only show up for other players once you press Play
    veil.classList.remove("on");
  }, 220);
}
function openGamePage(id) {
  curGame = GAMES.find(g => g.id === id) || GAMES[0]; fillGamePage();
  prevOn = false;
  for (const s of document.querySelectorAll(".tabsec")) s.hidden = true; $("pageItem").hidden = true; $("pageGame").hidden = false;
  playIn($("pageGame"));
}
/* ---- games: Home cards, game page, and Owner editing of names / owners / thumbnails / icons ---- */
const gesc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const GAME_TABLE = "game_settings", GAME_LS = "triangle_game_settings";
const BLANK = (function () { const c = document.createElement("canvas"); c.width = c.height = 8; const g = c.getContext("2d"); g.fillStyle = "#2a2418"; g.fillRect(0, 0, 8, 8); return c.toDataURL("image/png"); })();
const GAMES = [
  { id: "baseplate", room: "baseplate-1", ovr: {}, def: { name: "Baseplate", by: "Owen", thumb: $("playBase").querySelector("img").src, icon: $("gpIcon").src, banner: $("gpBannerImg").src, about: $("gpAbout").querySelector("p").textContent } },
  { id: "sharknado", room: "sharknado-1", ovr: {}, def: { name: "Sharknado", by: "Zed", thumb: BLANK, icon: BLANK, banner: BLANK, about: "A map by Zed. Climb the ramps and platforms, jump across the colourful pads, and chat with whoever else is here." } },
];
let curGame = GAMES[0];
const okImg = v => typeof v === "string" && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(v) && v.length < 400000;
const okTxt = (v, n) => typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n) : "";
function gv(g, k) { const o = g.ovr[k]; return o ? o : g.def[k]; }
function gBanner(g) { return g.ovr.thumb || g.def.banner; }
function applyGameRow(id, r) {                                        // r = { name, by, thumb, icon } (any may be missing)
  const g = GAMES.find(x => x.id === id); if (!g || !r) return;
  const normalized = window.TriancleRust && window.TriancleRust.gameSettings ? window.TriancleRust.gameSettings(r) : null;
  if (normalized) {
    if (normalized.btools) g.btools = normalized.btools;
    delete normalized.btools;
    g.ovr = normalized;
    return;
  }
  const o = {};
  if (okTxt(r.name, 40)) o.name = okTxt(r.name, 40);
  if (okTxt(r.by, 20)) o.by = okTxt(r.by, 20);
  if (okImg(r.thumb)) o.thumb = r.thumb;
  if (okImg(r.icon)) o.icon = r.icon;
  if (okTxt(r.about, 600)) o.about = okTxt(r.about, 600);
  if (r.btools === "all" || r.btools === "staff" || r.btools === "off") g.btools = r.btools;
  g.ovr = o;
}
function renderGames() {
  $("gameGrid").innerHTML = GAMES.filter(g => !hiddenGames.has(g.id)).map(g => `<button class="gcard" data-game="${g.id}" type="button"><span class="gimg"><img alt="${gesc(gv(g, "name"))}" src="${gesc(gv(g, "thumb"))}"><img class="gico" alt="" src="${gesc(gv(g, "icon"))}"></span><span class="gname">${gesc(gv(g, "name"))}</span><span class="gby">made by ${gesc(gv(g, "by"))}</span></button>`).join("");
  if (typeof renderGamesPage === "function") renderGamesPage();
}
function fillGamePage() {
  const g = curGame;
  $("gpTitle").textContent = gv(g, "name"); $("gpBy").innerHTML = "By <b>" + gesc(gv(g, "by")) + "</b>";
  $("gpIcon").src = gv(g, "icon"); $("gpBannerImg").src = gBanner(g);
  $("gpAbout").querySelector("p").textContent = gv(g, "about") || "";
  const pstat = $("gpPlayersStat");
  if (pstat) pstat.textContent = g.maxPlayers ? "1 – " + g.maxPlayers : "Multiplayer";
  if (window.refreshFav) window.refreshFav();
  if (window.refreshGameEdit) window.refreshGameEdit();
  $("gpPlayWeb").hidden = !(APP.required && !APP.in);                // only needed when games normally open in the desktop app
}

/* ---- Games page: featured hero, recently played shelf and the full grid ---- */
const HIDDEN_LS = "triangle_hidden_games", HIDDEN_ROW = "__hidden_games";
let hiddenGames = new Set();
try { const v = JSON.parse(localStorage.getItem(HIDDEN_LS) || "[]"); if (Array.isArray(v)) hiddenGames = new Set(v.filter(x => typeof x === "string")); } catch (_) {}
function hiddenIds() { return Array.from(hiddenGames); }
function visibleGames() { return GAMES.filter(g => !hiddenGames.has(g.id)); }
function setHiddenIds(list) {
  hiddenGames = new Set((Array.isArray(list) ? list : []).filter(x => typeof x === "string"));
  try { localStorage.setItem(HIDDEN_LS, JSON.stringify(hiddenIds())); } catch (_) {}
  if (curGame && hiddenGames.has(curGame.id)) curGame = visibleGames()[0] || GAMES[0];
  renderGames();
}
async function syncHiddenCloud() {
  const sb = getSB();
  if (!sb) return { ok: false, why: "no supabase" };
  try {
    const r = await sb.from(GAME_TABLE).upsert({
      id: HIDDEN_ROW, name: JSON.stringify(hiddenIds()),
      updated_by: acct.user && acct.user.id, updated_at: new Date().toISOString(),
    });
    return { ok: !r.error, why: r.error && r.error.message };
  } catch (e) { return { ok: false, why: e && e.message }; }
}
if (curGame && hiddenGames.has(curGame.id)) curGame = visibleGames()[0] || GAMES[0];
const RECENT_LS = "triangle_recent_games";
function recentGameIds() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_LS) || "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string") : []; }
  catch (_) { return []; }
}
function rememberGame(id) {
  if (!id) return;
  try { localStorage.setItem(RECENT_LS, JSON.stringify([id].concat(recentGameIds().filter(x => x !== id)).slice(0, 12))); } catch (_) {}
}
function gameArt(g) { const thumb = gv(g, "thumb"); return thumb && thumb !== BLANK ? thumb : ""; }
function gameIcon(g) { const icon = gv(g, "icon"); return icon && icon !== BLANK ? icon : ""; }
function gameAccent(g) {
  const s = gv(g, "name") + "|" + gv(g, "by"); let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return "hsl(" + h + " 26% 26%)";
}
function gameInitials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join("") || "?";
}
function gameCardHtml(g, extraClass) {
  const art = gameArt(g), icon = gameIcon(g);
  return '<button class="gcard2' + (extraClass ? " " + extraClass : "") + '" data-games-id="' + gesc(g.id) + '" type="button">' +
    '<span class="gcArt" style="--accent:' + gameAccent(g) + '">' +
      (art ? '<img class="gcImg" alt="" src="' + gesc(art) + '">' : '<span class="gcFallback">' + gesc(gameInitials(gv(g, "name"))) + '</span>') +
      (icon ? '<img class="gcIcon" alt="" src="' + gesc(icon) + '">' : "") +
      '<span class="gcTag' + (g.custom ? "" : " gcTagOff") + '">' + (g.custom ? "Community" : "Official") + '</span>' +
    '</span>' +
    '<span class="gcName">' + gesc(gv(g, "name")) + '</span>' +
    '<span class="gcBy">by ' + gesc(gv(g, "by")) + '</span>' +
  '</button>';
}
function featuredGame() {
  for (const id of recentGameIds()) { const hit = GAMES.find(g => g.id === id && !hiddenGames.has(g.id)); if (hit) return hit; }
  return visibleGames().find(g => g.id === "baseplate") || visibleGames()[0];
}
function gameHeroHtml(g) {
  if (!g) return "";
  const art = gameArt(g);
  const about = gv(g, "about") || "A Triancle map. Press play and see what is waiting inside.";
  return '<div class="gpHeroArt" style="--accent:' + gameAccent(g) + '">' +
      (art ? '<img alt="" src="' + gesc(art) + '">' : '<span class="gpHeroFallback">' + gesc(gameInitials(gv(g, "name"))) + '</span>') +
    '</div>' +
    '<div class="gpHeroInfo">' +
      '<span class="gpHeroTag">' + (g.custom ? "Community game" : "Official game") + '</span>' +
      '<h3>' + gesc(gv(g, "name")) + '</h3>' +
      '<p class="gpHeroBy">by ' + gesc(gv(g, "by")) + '</p>' +
      '<p class="gpHeroAbout">' + gesc(about).slice(0, 220) + '</p>' +
      '<div class="gpHeroBtns">' +
        '<button class="btnP" type="button" data-games-play="' + gesc(g.id) + '">Play now</button>' +
        '<button class="btnG" type="button" data-games-open="' + gesc(g.id) + '">Game page</button>' +
      '</div>' +
    '</div>';
}
function renderGamesPage() {
  const listEl = $("gamesList"); if (!listEl) return;
  const searchEl = $("gamesSearch"), sortEl = $("gamesSort");
  const q = String((searchEl && searchEl.value) || "").trim().toLowerCase();
  const sort = (sortEl && sortEl.value) || "featured";
  const pool = visibleGames();
  let list = pool.slice();
  if (q) list = list.filter(g => (gv(g, "name") + " " + gv(g, "by") + " " + (gv(g, "about") || "")).toLowerCase().indexOf(q) >= 0);
  if (sort === "az") list.sort((a, b) => gv(a, "name").localeCompare(gv(b, "name")));
  if (sort === "community") list.sort((a, b) => (b.custom ? 1 : 0) - (a.custom ? 1 : 0));

  const heroWrap = $("gamesHeroWrap");
  if (heroWrap) {
    heroWrap.hidden = !pool.length || !!q || sort !== "featured";
    if (!heroWrap.hidden) $("gamesHero").innerHTML = gameHeroHtml(featuredGame());
  }
  const recents = recentGameIds().map(id => GAMES.find(g => g.id === id && !hiddenGames.has(g.id))).filter(Boolean).slice(0, 8);
  const recentWrap = $("gamesRecentWrap");
  if (recentWrap) {
    recentWrap.hidden = !recents.length || !!q;
    if (!recentWrap.hidden) $("gamesRecent").innerHTML = recents.map(g => gameCardHtml(g, "gcWide")).join("");
  }
  listEl.innerHTML = list.map(g => gameCardHtml(g)).join("");
  const empty = $("gamesEmpty");
  if (empty) {
    empty.hidden = list.length > 0;
    empty.textContent = !pool.length ? "No games are up right now. Check back soon." : "No games match that search. Try another name.";
  }
  const count = $("gamesCount"); if (count) count.textContent = list.length === 1 ? "1 game" : list.length + " games";
}
$("tabGames").addEventListener("click", e => {
  const play = e.target.closest("[data-games-play]");
  if (play) { const g = GAMES.find(x => x.id === play.dataset.gamesPlay); if (g) { curGame = g; startGame(); } return; }
  const open = e.target.closest("[data-games-open]");
  if (open) { openGamePage(open.dataset.gamesOpen); return; }
  const card = e.target.closest("[data-games-id]");
  if (card) openGamePage(card.dataset.gamesId);
});
if ($("gamesSearch")) $("gamesSearch").addEventListener("input", renderGamesPage);
if ($("gamesSort")) $("gamesSort").addEventListener("change", renderGamesPage);
if ($("homeSeeGames")) $("homeSeeGames").addEventListener("click", () => showTab("games"));

$("gameGrid").addEventListener("click", e => { const c = e.target.closest("[data-game]"); if (c) openGamePage(c.dataset.game); });
try { const saved = JSON.parse(localStorage.getItem(GAME_LS) || "{}"); for (const id in saved) applyGameRow(id, saved[id]); } catch (_) {}
renderGames();
async function loadGameSettings() {                                    // everyone reads the owner's saved names / pictures from Supabase
  const sb = getSB(); if (!sb) return;
  try {
    let r = await sb.from(GAME_TABLE).select("id, name, owner_name, thumb, icon, btools, about");
    if (r.error) r = await sb.from(GAME_TABLE).select("id, name, owner_name, thumb, icon, btools");   // about column not added yet (supabase_schema.sql)
    if (r.error) r = await sb.from(GAME_TABLE).select("id, name, owner_name, thumb, icon");     // btools column not added yet (supabase_schema.sql)
    if (r.error) throw r.error;
    const cache = {};
    for (const row of (r.data || [])) {
      if (row.id === HIDDEN_ROW) {                                   // shared list of games the owner hid
        try {
          const list = JSON.parse(row.name || "[]");
          if (Array.isArray(list)) {
            hiddenGames = new Set(list.filter(x => typeof x === "string"));
            try { localStorage.setItem(HIDDEN_LS, JSON.stringify(hiddenIds())); } catch (_) {}
          }
        } catch (_) {}
        continue;
      }
      const v = { name: row.name, by: row.owner_name, thumb: row.thumb, icon: row.icon, btools: row.btools, about: row.about };
      applyGameRow(row.id, v); cache[row.id] = v;
    }
    if (curGame && hiddenGames.has(curGame.id)) curGame = visibleGames()[0] || curGame;
    try { localStorage.setItem(GAME_LS, JSON.stringify(cache)); } catch (_) {}
    renderGames(); if (!$("pageGame").hidden) fillGamePage(); if (!$("tabOwner").hidden) renderOwnerGames();
  } catch (_) {}
}
async function loadAllGames() { await loadCustomGames(); await loadGameSettings(); }
$("hLogo").addEventListener("click", () => showTab("home"));              // the triangle logo goes home

;

/* ---- js/ui/custom-games.js ---- */
"use strict";

/* ---- custom games: made from an uploaded Roblox .rbxl ---- */
const CUSTOM_LS = "triangle_custom_games_v2", CUSTOM_TABLE = "custom_games";
function addCustomEntry(id, name, by, thumb, icon, map, description, maxPlayers) {
  if (GAMES.some(g => g.id === id)) return GAMES.find(g => g.id === id);
  const about = okTxt(description, 600) || "A game made in Triancle Studio.";
  const g = { id, room: "c-" + id.toLowerCase(), custom: true, map: map || null, maxPlayers: Math.max(0, Math.min(100, maxPlayers | 0)), ovr: {}, def: { name: okTxt(name, 40) || "New game", by: okTxt(by, 20) || "Unknown", thumb: okImg(thumb) ? thumb : BLANK, icon: okImg(icon) ? icon : BLANK, banner: okImg(thumb) ? thumb : BLANK, about } };
  GAMES.push(g); return g;
}
try { const loc = JSON.parse(localStorage.getItem(CUSTOM_LS) || "{}"); for (const id in loc) { const r = loc[id]; let m = null; try { m = JSON.parse(r.map); } catch (_) {} if (m && m.parts) addCustomEntry(id, r.name, r.by, r.thumb, r.icon, m); } renderGames(); } catch (_) {}
function saveCustomLocal() {
  try { const o = {}; for (const g of GAMES) if (g.custom && g.map) o[g.id] = { name: g.def.name, by: g.def.by, map: JSON.stringify(g.map) }; localStorage.setItem(CUSTOM_LS, JSON.stringify(o)); return true; } catch (_) { return false; }
}
async function loadCustomGames() {
  const sb = getSB(); if (!sb) return;
  try {
    let r = await sb.from(CUSTOM_TABLE).select("id, name, owner_name, thumb, icon, created_by, description, max_players");
    if (r.error) r = await sb.from(CUSTOM_TABLE).select("id, name, owner_name, thumb, icon, created_by");     // older table (supabase_publish.sql not run yet)
    if (r.error) throw r.error;
    for (const row of (r.data || [])) if (/^c[a-z0-9]{3,20}$/.test(row.id)) { const g = addCustomEntry(row.id, row.name, row.owner_name, row.thumb, row.icon, null, row.description, row.max_players); if (g) g.creatorId = row.created_by || null; }
    renderGames();
  } catch (_) {}
}
async function loadCustomMap(g) {
  const sb = getSB(); if (!sb) throw new Error("no supabase");
  const r = await sb.from(CUSTOM_TABLE).select("map").eq("id", g.id).single(); if (r.error) throw r.error;
  const m = JSON.parse(r.data.map); if (!m || !Array.isArray(m.parts)) throw new Error("bad map"); g.map = m;
}

/* ---- reading a binary .rbxl in the browser ---- */
const RBX_ROT = {2:[1,0,0,0,1,0,0,0,1],3:[1,0,0,0,0,-1,0,1,0],5:[1,0,0,0,-1,0,0,0,-1],6:[1,0,0,0,0,1,0,-1,0],7:[0,1,0,1,0,0,0,0,-1],9:[0,0,1,1,0,0,0,1,0],10:[0,-1,0,1,0,0,0,0,1],12:[0,0,-1,1,0,0,0,-1,0],13:[0,1,0,0,0,1,1,0,0],14:[0,0,-1,0,1,0,1,0,0],16:[0,-1,0,0,0,-1,1,0,0],17:[0,0,1,0,-1,0,1,0,0],20:[-1,0,0,0,1,0,0,0,-1],21:[-1,0,0,0,0,1,0,1,0],23:[-1,0,0,0,-1,0,0,0,1],24:[-1,0,0,0,0,-1,0,-1,0],25:[0,1,0,-1,0,0,0,0,1],27:[0,0,-1,-1,0,0,0,1,0],28:[0,-1,0,-1,0,0,0,0,-1],30:[0,0,1,-1,0,0,0,-1,0],31:[0,1,0,0,0,-1,-1,0,0],32:[0,0,1,0,1,0,-1,0,0],34:[0,-1,0,0,0,1,-1,0,0],35:[0,0,-1,0,-1,0,-1,0,0]};
const RBX_PARTS = new Set(["Part", "SpawnLocation", "Seat", "VehicleSeat", "MeshPart", "WedgePart", "CornerWedgePart", "TrussPart"]);
const RBX_MAX_PARTS = 6000;
function lz4Block(src, n) {
  if (window.TriancleRust && window.TriancleRust.lz4) { const result = window.TriancleRust.lz4(src, n); if (result) return result; }
  const dst = new Uint8Array(n); let s = 0, d = 0;
  while (s < src.length && d < n) {
    const tok = src[s++]; let lit = tok >> 4;
    if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255); }
    for (let i = 0; i < lit; i++) dst[d++] = src[s++];
    if (s >= src.length) break;
    const off = src[s] | (src[s + 1] << 8); s += 2;
    let ml = tok & 15; if (ml === 15) { let b; do { b = src[s++]; ml += b; } while (b === 255); }
    ml += 4; let m = d - off; for (let i = 0; i < ml; i++) dst[d++] = dst[m++];
  }
  return dst;
}
function loadZstd() {
  if (window.fzstd) return Promise.resolve();
  return new Promise((res, rej) => { const el = document.createElement("script"); el.src = "https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js"; el.onload = () => window.fzstd ? res() : rej(new Error("zstd")); el.onerror = () => rej(new Error("zstd")); document.head.appendChild(el); });
}
async function rbxToMap(buf) {
  const u8 = new Uint8Array(buf), dv0 = new DataView(buf);
  const sig = String.fromCharCode.apply(null, u8.subarray(0, 8));
  if (sig === "<roblox ") throw new Error("xml");
  if (sig !== "<roblox!") throw new Error("notrbx");
  const chunks = []; let off = 32;
  while (off + 16 <= u8.length) {
    const name = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]).replace(/\x00/g, "");
    const cl = dv0.getUint32(off + 4, true), ul = dv0.getUint32(off + 8, true); off += 16;
    let data;
    if (cl === 0) { data = u8.slice(off, off + ul); off += ul; }
    else {
      const raw = u8.subarray(off, off + cl); off += cl;
      if (raw[0] === 0x28 && raw[1] === 0xb5 && raw[2] === 0x2f && raw[3] === 0xfd) { await loadZstd(); data = window.fzstd.decompress(raw); }
      else data = lz4Block(raw, ul);
    }
    chunks.push({ name, data }); if (name === "END") break;
  }
  if (window.TriancleRust && window.TriancleRust.rbxlMap) { const map = window.TriancleRust.rbxlMap(chunks); if (map) return map; }
  const td = new TextDecoder(), dvOf = d => new DataView(d.buffer, d.byteOffset, d.byteLength);
  const rdStr = (d, o) => { const n = dvOf(d).getUint32(o, true); return [td.decode(d.subarray(o + 4, o + 4 + n)), o + 4 + n]; };
  const deint = (d, o, n) => { if (window.TriancleRust && window.TriancleRust.deinterleave) { const result = window.TriancleRust.deinterleave(d, o, n); if (result) return result; } const out = new Array(n); for (let i = 0; i < n; i++) out[i] = ((d[o + i] * 16777216) + (d[o + n + i] << 16) + (d[o + 2 * n + i] << 8) + d[o + 3 * n + i]) >>> 0; return out; };
  const zz = v => window.TriancleRust && window.TriancleRust.zigzag ? window.TriancleRust.zigzag(v) : (v >>> 1) ^ -(v & 1);
  const fl = v => { if (window.TriancleRust && window.TriancleRust.rbxlFloat) return window.TriancleRust.rbxlFloat(v); v = ((v >>> 1) | (v << 31)) >>> 0; const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, v); return b.getFloat32(0); };
  const refsOf = arr => { if (window.TriancleRust && window.TriancleRust.references) { const result = window.TriancleRust.references(arr); if (result) return result; } let a = 0; return arr.map(v => a += zz(v)); };
  const classes = {}, inst = new Map(), parent = new Map();
  const rustIndex = window.TriancleRust && window.TriancleRust.rbxlIndex ? window.TriancleRust.rbxlIndex(chunks) : null;
  if (rustIndex) {
    for (const [id, nm, refs] of rustIndex.classes) { classes[id] = { name: nm, refs }; for (const r of refs) inst.set(r, { c: nm, p: {} }); }
    for (const [child, par] of rustIndex.parents) parent.set(child, par);
  } else for (const c of chunks) if (c.name === "INST") {
    const d = c.data, dv = dvOf(d), id = dv.getUint32(0, true); let [nm, o] = rdStr(d, 4); o++;
    const n = dv.getUint32(o, true); o += 4; const refs = refsOf(deint(d, o, n));
    classes[id] = { name: nm, refs }; for (const r of refs) inst.set(r, { c: nm, p: {} });
  }
  const WANT = { Name: 1, size: 1, Size: 1, CFrame: 1, Color3uint8: 1, Transparency: 1, CanCollide: 1, shape: 1, Shape: 1 };
  for (const c of chunks) {
    const d = c.data, dv = dvOf(d);
    if (c.name === "PROP") {
      const id = dv.getUint32(0, true); let [pn, o] = rdStr(d, 4); const t = d[o++], cl = classes[id];
      if (!cl || !RBX_PARTS.has(cl.name) || !WANT[pn]) continue;
      const n = cl.refs.length; let vals = window.TriancleRust && window.TriancleRust.rbxlProperty ? window.TriancleRust.rbxlProperty(d, o, n, t) : null;
      if (!vals) {
      if (t === 1) { vals = []; for (let i = 0; i < n; i++) { let v; [v, o] = rdStr(d, o); vals.push(v); } }
      else if (t === 2) { vals = []; for (let i = 0; i < n; i++) vals.push(!!d[o + i]); }
      else if (t === 4) vals = deint(d, o, n).map(fl);
      else if (t === 18) vals = deint(d, o, n);
      else if (t === 14) { const X = deint(d, o, n).map(fl), Y = deint(d, o + 4 * n, n).map(fl), Z = deint(d, o + 8 * n, n).map(fl); vals = X.map((x, i) => [x, Y[i], Z[i]]); }
      else if (t === 26) { vals = []; for (let i = 0; i < n; i++) vals.push([d[o + i], d[o + n + i], d[o + 2 * n + i]]); }
      else if (t === 16) {
        const rot = [];
        for (let i = 0; i < n; i++) { const idb = d[o++]; if (idb === 0) { const m = []; for (let k = 0; k < 9; k++) { m.push(dv.getFloat32(o, true)); o += 4; } rot.push(m); } else rot.push(RBX_ROT[idb] || RBX_ROT[2]); }
        const X = deint(d, o, n).map(fl), Y = deint(d, o + 4 * n, n).map(fl), Z = deint(d, o + 8 * n, n).map(fl);
        vals = rot.map((r, i) => ({ pos: [X[i], Y[i], Z[i]], rot: r }));
      }
      }
      if (vals) cl.refs.forEach((r, i) => { inst.get(r).p[pn] = vals[i]; });
    } else if (c.name === "PRNT" && !rustIndex) {
      const n = dv.getUint32(1, true), ch = refsOf(deint(d, 5, n)), pa = refsOf(deint(d, 5 + 4 * n, n));
      ch.forEach((k, i) => parent.set(k, pa[i]));
    }
  }
  const memo = new Map();
  const inWs = r => { if (memo.has(r)) return memo.get(r); let x = r, res = false, guard = 0; while (x !== undefined && x >= 0 && guard++ < 200) { const q = inst.get(x); if (q && q.c === "Workspace") { res = true; break; } x = parent.get(x); } memo.set(r, res); return res; };
  const r3 = v => Math.round(v * 1000) / 1000, r4 = v => Math.round(v * 10000) / 10000;
  const rows = []; let spawn = null, cut = 0;
  for (const [ref, q] of inst) {
    if (!RBX_PARTS.has(q.c) || !q.p.CFrame || !(q.p.size || q.p.Size) || !inWs(ref)) continue;
    if (rows.length >= RBX_MAX_PARTS) { cut++; continue; }
    const sz = q.p.size || q.p.Size, cf = q.p.CFrame, c = q.p.Color3uint8 || [163, 162, 165];
    const shape = q.p.shape !== undefined ? q.p.shape : q.p.Shape;
    const row = [r3(sz[0]), r3(sz[1]), r3(sz[2]), r3(cf.pos[0]), r3(cf.pos[1]), r3(cf.pos[2]), cf.rot.map(r4), (c[0] << 16) | (c[1] << 8) | c[2], r3(q.p.Transparency || 0), q.p.CanCollide === false ? 0 : 1, [0, 1, 2, 3, 4].includes(shape) ? shape : (q.c === "WedgePart" ? 3 : q.c === "CornerWedgePart" ? 4 : 1)];
    rows.push(row);
    if (q.c === "SpawnLocation" && !spawn) spawn = [row[3], row[4] + row[1] / 2 + 3, row[5]];
  }
  if (!rows.length) throw new Error("noparts");
  if (!spawn && window.TriancleRust && window.TriancleRust.defaultSpawn) spawn = window.TriancleRust.defaultSpawn(rows);
  if (!spawn) {
    let best = null;
    for (const r of rows) {
      const R = r[6], ex = Math.abs(R[0]) * r[0] + Math.abs(R[1]) * r[1] + Math.abs(R[2]) * r[2], ey = Math.abs(R[3]) * r[0] + Math.abs(R[4]) * r[1] + Math.abs(R[5]) * r[2], ez = Math.abs(R[6]) * r[0] + Math.abs(R[7]) * r[1] + Math.abs(R[8]) * r[2];
      if (Math.abs(r[3]) <= ex / 2 && Math.abs(r[5]) <= ez / 2) { const top = r[4] + ey / 2; if (!best || top > best) best = top; }
    }
    if (best !== null) spawn = [0, best + 3, 0];
    else { const r = rows.reduce((p, q) => (q[0] * q[2] > p[0] * p[2] ? q : p)); spawn = [r[3], r[4] + r[1] / 2 + 3, r[5]]; }
  }
  return { spawn: spawn.map(r3), parts: rows, cut };
}
function addCustomGame(name, by, map) {
  const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  return addCustomEntry(id, name, by, null, null, map);
}

;

/* ---- js/ui/owner-games.js ---- */
"use strict";

/* owner page: edit games */
const OWG = {};                                                        // drafts while editing: { id: { name, by, thumb, icon } }
function owDraft(g) { return OWG[g.id] || (OWG[g.id] = { name: gv(g, "name"), by: gv(g, "by"), thumb: gv(g, "thumb"), icon: gv(g, "icon"), about: gv(g, "about") || "", btools: g.btools || "all" }); }
function renderOwnerGames() {
  if (!isOwner()) return;
  $("owGames").innerHTML = GAMES.map(g => { const d = owDraft(g), hidden = hiddenGames.has(g.id); return `<div class="owGame box${hidden ? " owHidden" : ""}" data-gid="${g.id}">
    <div class="owPrev"><img class="owThumb" alt="Thumbnail" src="${gesc(d.thumb)}"><img class="owIcon" alt="Icon" src="${gesc(d.icon)}"></div>
    <div class="owFields">
      ${hidden ? '<span class="owHideTag">Hidden from the Games page</span>' : ""}
      <label>Game name<input type="text" data-f="name" maxlength="40" value="${gesc(d.name)}" autocomplete="off" spellcheck="false"></label>
      <label>Owner (made by)<input type="text" data-f="by" maxlength="20" value="${gesc(d.by)}" autocomplete="off" spellcheck="false"></label>
      <label>Description<textarea data-f="about" maxlength="600" rows="3" spellcheck="false">${gesc(d.about)}</textarea></label>
      <label>Building tools (BTools)<select data-f="btools" class="plSel"><option value="all"${d.btools === "all" ? " selected" : ""}>Everyone can use them</option><option value="staff"${d.btools === "staff" ? " selected" : ""}>Admins &amp; Owner only</option><option value="off"${d.btools === "off" ? " selected" : ""}>Off for everyone</option></select></label>
      <div class="owBtnRow"><button type="button" class="btnG" data-pick="thumb">Thumbnail…</button><button type="button" class="btnG" data-pick="icon">Icon…</button><button type="button" class="btnG" data-reset="1">Reset</button>${hidden ? '<button type="button" class="btnG" data-restore="1">Restore</button>' : '<button type="button" class="btnG" data-del="1">Delete</button>'}<button type="button" class="btnP" data-save="1">Save</button></div>
      <input type="file" accept="image/*" data-file="thumb" hidden><input type="file" accept="image/*" data-file="icon" hidden>
    </div></div>`; }).join("");
}
function fitImage(file, w, h, type) {                                  // center-crop to w x h and shrink so it stays small enough to save
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
      const k = Math.max(w / im.naturalWidth, h / im.naturalHeight), dw = im.naturalWidth * k, dh = im.naturalHeight * k;
      g.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh); URL.revokeObjectURL(url);
      res(c.toDataURL(type, 0.85));
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("bad image")); };
    im.src = url;
  });
}
$("owGames").addEventListener("keydown", e => e.stopPropagation());
$("rbxName").addEventListener("keydown", e => e.stopPropagation()); $("rbxBy").addEventListener("keydown", e => e.stopPropagation());
$("rbxPick").addEventListener("click", () => { if (isOwner()) $("rbxFile").click(); });
$("rbxFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f || !isOwner()) return;
  const msg = $("owGMsg"); msg.textContent = "Reading " + f.name + "…";
  try {
    const map = await rbxToMap(await f.arrayBuffer());
    const g = addCustomGame($("rbxName").value || f.name.replace(/\.[^.]+$/, ""), $("rbxBy").value || acct.username, map);
    const localOK = saveCustomLocal(); renderGames(); renderOwnerGames(); $("rbxName").value = ""; $("rbxBy").value = "";
    msg.textContent = "Made \"" + gv(g, "name") + "\" from " + map.parts.length + " parts" + (map.cut ? " (" + map.cut + " extra parts left out)" : "") + ". Saving…";
    const sb = getSB();
    try {
      if (!sb) throw new Error("no supabase");
      const r = await sb.from(CUSTOM_TABLE).upsert({ id: g.id, name: gv(g, "name"), owner_name: gv(g, "by"), map: JSON.stringify(map), created_by: acct.user.id });
      if (r.error) throw r.error;
      msg.textContent = "Made \"" + gv(g, "name") + "\" from " + map.parts.length + " parts" + (map.cut ? " (" + map.cut + " extra parts left out)" : "") + ". It's on Home for everyone.";
    } catch (_) { msg.textContent = "Made \"" + gv(g, "name") + "\" from " + map.parts.length + " parts, but only " + (localOK ? "on this device" : "for this visit (too big to keep)") + ". Run supabase_custom_games.sql in Supabase so everyone can play it."; }
  } catch (err) {
    const m = err && err.message;
    msg.textContent = m === "xml" ? "That's a .rbxlx (XML) file. In Studio use File > Save to File and choose .rbxl." : m === "notrbx" ? "That doesn't look like a Roblox .rbxl file." : m === "zstd" ? "Couldn't load the decompressor. Check your internet and try again." : m === "noparts" ? "No parts were found in that file's Workspace." : "Couldn't read that file.";
  }
});
$("owGames").addEventListener("input", e => {
  const box = e.target.closest("[data-gid]"), f = e.target.dataset && e.target.dataset.f; if (!box || !f) return;
  OWG[box.dataset.gid][f] = e.target.value;
});
$("owGames").addEventListener("click", async e => {
  if (!isOwner()) return;
  const box = e.target.closest("[data-gid]"); if (!box) return;
  const g = GAMES.find(x => x.id === box.dataset.gid), d = owDraft(g), msg = $("owGMsg");
  const pick = e.target.closest("[data-pick]");
  if (pick) { box.querySelector(`[data-file="${pick.dataset.pick}"]`).click(); return; }
  if (e.target.closest("[data-del]")) {
    if (g.custom) {
      if (!(await uiConfirm("Delete " + gv(g, "name") + " for everyone?\nThe game and its map are removed for good.", "Delete", true))) return;
      GAMES.splice(GAMES.indexOf(g), 1); delete OWG[g.id]; saveCustomLocal();
      if (curGame === g) curGame = visibleGames()[0] || GAMES[0];
      try { const all = JSON.parse(localStorage.getItem(GAME_LS) || "{}"); delete all[g.id]; localStorage.setItem(GAME_LS, JSON.stringify(all)); } catch (_) {}
      try { localStorage.setItem(RECENT_LS, JSON.stringify(recentGameIds().filter(x => x !== g.id))); } catch (_) {}
      renderGames(); renderOwnerGames();
      const sb = getSB();
      if (!sb) { msg.textContent = "\"" + gv(g, "name") + "\" deleted from this device."; return; }
      msg.textContent = "Deleting…";
      try {
        const a = await sb.from(CUSTOM_TABLE).delete().eq("id", g.id); if (a.error) throw a.error;
        const b = await sb.from(GAME_TABLE).delete().eq("id", g.id); if (b.error) throw b.error;
        msg.textContent = "\"" + gv(g, "name") + "\" deleted for everyone.";
      } catch (err) {
        msg.textContent = "Gone from this device, but the server copy stayed (" + (err && err.message ? err.message : "no connection") + "). It will come back on reload.";
      }
      return;
    }
    // built-in game: you can't remove the code, so hide it from every Games list
    if (!(await uiConfirm("Hide " + gv(g, "name") + " from the Games page for everyone?\nYou can restore it here whenever you want.", "Hide", true))) return;
    hiddenGames.add(g.id);
    setHiddenIds(hiddenIds());
    renderOwnerGames();
    msg.textContent = "Hiding…";
    const hr = await syncHiddenCloud();
    msg.textContent = hr.ok
      ? "\"" + gv(g, "name") + "\" is hidden for everyone. Use Restore here to bring it back."
      : "\"" + gv(g, "name") + "\" is hidden on this device (" + (hr.why || "no connection") + "). It will come back on reload.";
    return;
  }
  if (e.target.closest("[data-restore]")) {
    hiddenGames.delete(g.id);
    setHiddenIds(hiddenIds());
    renderOwnerGames();
    msg.textContent = "Restoring…";
    const rr = await syncHiddenCloud();
    msg.textContent = rr.ok
      ? "\"" + gv(g, "name") + "\" is back on the Games page."
      : "\"" + gv(g, "name") + "\" is back on this device (" + (rr.why || "no connection") + "). Reload to check the server copy.";
    return;
  }
  if (e.target.closest("[data-reset]")) {
    g.ovr = {}; delete OWG[g.id]; msg.textContent = "Reset to the original. Press Save on this game to keep it.";
    g.btools = "all"; OWG[g.id] = { name: g.def.name, by: g.def.by, thumb: g.def.thumb, icon: g.def.icon, about: g.def.about || "", btools: "all" }; renderOwnerGames(); return;
  }
  if (e.target.closest("[data-save]")) {
    const row = { name: okTxt(d.name, 40), by: okTxt(d.by, 20), thumb: d.thumb, icon: d.icon, about: okTxt(d.about, 600), btools: d.btools };
    if (!row.name || !row.by) { msg.textContent = "Give the game a name and an owner first."; return; }
    const o = {}; if (row.name !== g.def.name) o.name = row.name; if (row.by !== g.def.by) o.by = row.by;
    if (row.thumb !== g.def.thumb) o.thumb = row.thumb; if (row.icon !== g.def.icon) o.icon = row.icon; if (row.about !== (g.def.about || "")) o.about = row.about; o.btools = row.btools;
    g.ovr = {}; applyGameRow(g.id, o);
    try { const all = JSON.parse(localStorage.getItem(GAME_LS) || "{}"); all[g.id] = { name: gv(g, "name"), by: gv(g, "by"), thumb: gv(g, "thumb"), icon: gv(g, "icon"), about: gv(g, "about") || "", btools: g.btools || "all" }; localStorage.setItem(GAME_LS, JSON.stringify(all)); } catch (_) {}
    renderGames(); renderOwnerGames();
    const sb = getSB(); msg.textContent = "Saving…";
    try {
      if (!sb) throw new Error("no supabase");
      const base = { id: g.id, name: gv(g, "name"), owner_name: gv(g, "by"), thumb: gv(g, "thumb"), icon: gv(g, "icon"), updated_by: acct.user.id, updated_at: new Date().toISOString() };
      let r = await sb.from(GAME_TABLE).upsert(Object.assign({ btools: g.btools || "all", about: gv(g, "about") || "" }, base)), noBT = false;
      if (r.error) { r = await sb.from(GAME_TABLE).upsert(Object.assign({ btools: g.btools || "all" }, base)); noBT = "about"; }   // about column missing
      if (r.error) { r = await sb.from(GAME_TABLE).upsert(base); noBT = "btools"; }              // btools column missing: save the rest
      if (r.error) throw r.error;
      msg.textContent = noBT === "about" ? "Saved, but descriptions need supabase_schema.sql run once in Supabase." : noBT ? "Saved, but the building-tools setting needs supabase_schema.sql run once in Supabase." : "Saved. Everyone will see the new " + gv(g, "name") + " details.";
    } catch (_) { msg.textContent = "Saved on this device only. Run supabase_schema.sql (and supabase_game_settings.sql) in Supabase once so everyone sees it."; }
  }
});
$("owGames").addEventListener("change", async e => {
  const inp = e.target.closest("[data-file]"); if (!inp || !inp.files[0] || !isOwner()) return;
  const box = inp.closest("[data-gid]"), g = GAMES.find(x => x.id === box.dataset.gid), d = owDraft(g), kind = inp.dataset.file, msg = $("owGMsg");
  try {
    d[kind] = kind === "thumb" ? await fitImage(inp.files[0], 640, 360, "image/jpeg") : await fitImage(inp.files[0], 192, 192, "image/png");
    msg.textContent = "Picture ready. Press Save to keep it.";
    renderOwnerGames();
  } catch (_) { msg.textContent = "Couldn't read that picture."; }
  inp.value = "";
});
$("gpPlay").addEventListener("click", () => startGame());
$("gpPlayWeb").addEventListener("click", () => startGame(true));
$("gpBack").addEventListener("click", () => showTab("home"));
for (const b of document.querySelectorAll("#gpTabs button")) b.addEventListener("click", () => {
  for (const x of document.querySelectorAll("#gpTabs button")) x.classList.toggle("on", x === b);
  const ab = b.dataset.gp === "about";
  $("gpAbout").hidden = !ab; $("gpControls").hidden = ab;
  playIn(ab ? $("gpAbout") : $("gpControls"));
});
(function () {                                                    // Favorite is remembered on this device; Share copies the page link
  const fav = $("gpFav"), keyOf = () => "triangle_fav_" + curGame.id;
  const paint = on => { fav.classList.toggle("on", on); fav.textContent = on ? "Favorited" : "Favorite"; };
  window.refreshFav = () => { try { paint(localStorage.getItem(keyOf()) === "1"); } catch (_) { paint(false); } };
  window.refreshFav();
  fav.addEventListener("click", () => { const on = !fav.classList.contains("on"); paint(on); try { localStorage.setItem(keyOf(), on ? "1" : "0"); } catch (_) {} });
  $("gpShare").addEventListener("click", async () => {
    const b = $("gpShare");
    try { await navigator.clipboard.writeText(location.href.split("#")[0]); b.textContent = "Link copied"; } catch (_) { b.textContent = "Couldn't copy"; }
    setTimeout(() => { b.textContent = "Share"; }, 1500);
  });
})();
$("homeBtn").addEventListener("click", () => { freeMouse(); flushSave().then(() => location.reload(), () => location.reload()); });

;

/* ---- js/ui/game-edit.js ---- */
"use strict";

/* ---- game page: the person who made a game (and any Owner) can edit its name, description, thumbnail and icon ---- */
(function () {
  const D = {}, box = $("gpEdit"), msg = (t, bad) => { const n = $("geMsg"); n.textContent = t || ""; n.style.color = bad ? "#ff7a6b" : ""; };
  const canEditGame = g => !!(acct.user && (isOwner() || (g.creatorId && g.creatorId === acct.user.id)));
  box.addEventListener("keydown", e => e.stopPropagation());
  function paint() { $("geThumb").src = D.thumb; $("geIcon").src = D.icon; }
  window.refreshGameEdit = function () {
    const g = curGame; box.hidden = !canEditGame(g); if (box.hidden) return;
    Object.assign(D, { name: gv(g, "name"), by: gv(g, "by"), about: gv(g, "about") || "", thumb: gv(g, "thumb"), icon: gv(g, "icon") });
    $("geName").value = D.name; $("geBy").value = D.by; $("geAbout").value = D.about; msg(""); paint();
  };
  $("gePickThumb").addEventListener("click", () => $("geFileThumb").click());
  $("gePickIcon").addEventListener("click", () => $("geFileIcon").click());
  for (const [id, kind] of [["geFileThumb", "thumb"], ["geFileIcon", "icon"]]) $(id).addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { D[kind] = kind === "thumb" ? await fitImage(f, 640, 360, "image/jpeg") : await fitImage(f, 192, 192, "image/png"); paint(); msg("Picture ready. Press Save changes to keep it."); }
    catch (_) { msg("Couldn't read that picture.", true); }
  });
  $("geSave").addEventListener("click", async () => {
    const g = curGame, sb = getSB(); if (!sb || !canEditGame(g)) return;
    const name = okTxt($("geName").value, 40), by = okTxt($("geBy").value, 20), about = okTxt($("geAbout").value, 600);
    if (!name || !by) return msg("Give the game a name and a maker first.", true);
    const o = {}; if (name !== g.def.name) o.name = name; if (by !== g.def.by) o.by = by; if (about !== (g.def.about || "")) o.about = about;
    if (D.thumb !== g.def.thumb) o.thumb = D.thumb; if (D.icon !== g.def.icon) o.icon = D.icon; if (g.btools) o.btools = g.btools;
    applyGameRow(g.id, o); renderGames(); fillGamePage();
    try { const all = JSON.parse(localStorage.getItem(GAME_LS) || "{}"); all[g.id] = { name, by, thumb: gv(g, "thumb"), icon: gv(g, "icon"), about, btools: g.btools || "all" }; localStorage.setItem(GAME_LS, JSON.stringify(all)); } catch (_) {}
    const b = $("geSave"); b.disabled = true; msg("Saving…");
    try {
      const base = { id: g.id, name, owner_name: by, thumb: gv(g, "thumb"), icon: gv(g, "icon"), updated_by: acct.user.id, updated_at: new Date().toISOString() };
      let r = await sb.from(GAME_TABLE).upsert(Object.assign({ about }, base));
      if (r.error) r = await sb.from(GAME_TABLE).upsert(base);                       // about column not added yet
      if (r.error) throw r.error;
      msg("Saved. Everyone will see the new details.");
    } catch (_) { msg("Saved on this device only. Run supabase_schema.sql in Supabase once so everyone sees it.", true); }
    b.disabled = false;
  });
})();

;

/* ---- js/ui/avatar-preview.js ---- */
"use strict";

const prev = (function () {                                       // live avatar preview (its own little renderer)
  let r;
  try { r = new THREE.WebGLRenderer({ canvas: $("prevCv"), antialias: true, alpha: true }); } catch (_) { return null; }
  if (renderer.outputEncoding !== undefined) r.outputEncoding = renderer.outputEncoding;
  if (renderer.outputColorSpace !== undefined) r.outputColorSpace = renderer.outputColorSpace;
  r.toneMapping = renderer.toneMapping; r.toneMappingExposure = renderer.toneMappingExposure;
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100), av = createAvatar();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(4, 8, 6); sc.add(dl);
  sc.add(av.group); cam.position.set(0, 3, 14); cam.lookAt(0, 2.5, 0);
  return { r, sc, cam, av, sig: "", yaw: 0 };
})();
let prevOn = false, prevRunning = false, prevT = 0, dragX = null;
(function () {
  const pb = $("prevBox"), end = () => { dragX = null; };
  pb.addEventListener("pointerdown", e => { if (e.target.closest("button")) return; dragX = e.clientX; pb.setPointerCapture(e.pointerId); });
  pb.addEventListener("pointermove", e => { if (dragX !== null && prev) { prev.yaw += (e.clientX - dragX) * 0.012; dragX = e.clientX; } });
  pb.addEventListener("pointerup", end); pb.addEventListener("pointercancel", end);
})();
function prevLoop(now) {
  if (!prevOn || !prev || inGame) { prevRunning = false; return; }
  requestAnimationFrame(prevLoop);
  const dt = Math.min((now - prevT) / 1000, 0.1); prevT = now;
  const cv = prev.r.domElement, w = cv.clientWidth, h = cv.clientHeight, pr = Math.min(window.devicePixelRatio || 1, 2);
  if (w && (cv.width !== Math.round(w * pr) || cv.height !== Math.round(h * pr))) { prev.r.setPixelRatio(pr); prev.r.setSize(w, h, false); prev.cam.aspect = w / h; prev.cam.updateProjectionMatrix(); }
  const sig = colorSig(myColors);
  if (sig !== prev.sig) { prev.sig = sig; setAvatarColors(prev.av, myColors); }
  syncAvatarItems(prev.av, WEAR.mine);
  if (dragX === null) prev.yaw *= Math.exp(-dt * 0.8);
  const t = now / 1000, rg = prev.av.rig, s = Math.sin(t * 1.7);
  prev.av.group.rotation.y = -Math.PI / 2 + prev.yaw + Math.sin(t * 0.7) * 0.35;
  prev.av.group.position.y = s * 0.02;
  rg.LeftArm.rotation.z = s * 0.05; rg.RightArm.rotation.z = -s * 0.05;
  prev.r.render(prev.sc, prev.cam);
}

;

/* ---- js/ui/tabs.js ---- */
"use strict";

const SECID = { ugc: "tabUgc", home: "tabHome", games: "tabGames", avatar: "tabAvatar", friends: "tabFriends", profile: "tabProfile", shop: "tabShop", players: "tabPlayers", owner: "tabOwner", settings: "tabSettings", transactions: "tabTransactions" };
function showTab(name) {
  if (name === "owner" && !isOwner()) name = "home";
  if (name === "ugc" && !canUgc()) name = "home";
  for (const b of document.querySelectorAll("#hTabs button")) b.classList.toggle("on", b.dataset.tab === name);
  $("pageGame").hidden = true; $("pageItem").hidden = true;
  try { hdrAv(); } catch (_) {}                                    // keep the corner picture in step with your avatar
  for (const s of document.querySelectorAll(".tabsec")) s.hidden = s.id !== SECID[name];
  prevOn = name === "avatar"; document.body.classList.toggle("avWide", prevOn);
  document.body.classList.toggle("shopWide", name === "shop"); document.body.classList.toggle("onHome", name === "home");
  ugOn = name === "ugc";
  playIn($(SECID[name]));
  if (prevOn) { openColors(); if (!prevRunning) { prevRunning = true; requestAnimationFrame(prevLoop); } }
  if (name === "home") renderHome();
  if (name === "games") renderGamesPage();
  if (name === "friends") renderFriends();
  if (name === "players") renderPlayers(true);
  if (name === "owner") { renderOwner(); renderOwnerGames(); if (typeof renderOwnerItems === "function") renderOwnerItems(); }
  if (name === "shop") renderShop();
  if (name === "avatar") renderAvItems();
  if (name === "ugc") ugStart();
  if (name === "settings") renderSettings();
  if (name === "transactions") { TX.page = 0; renderTransactions(); }
  if (name === "profile") renderProfile(SOC.viewId || (acct.user && acct.user.id));
  if (name !== "profile") SOC.viewId = null;
}
for (const b of document.querySelectorAll("#hTabs button")) b.addEventListener("click", () => showTab(b.dataset.tab));

;

/* ---- js/social/social-core.js ---- */
"use strict";

/* =====================================================================
   SOCIAL: welcome page, friends, player profiles
   ===================================================================== */
const SOC = { friends: [], incoming: [], outgoing: [], ok: true, cache: new Map(), viewId: null, badges: new Map(), badgeOK: true };
const esc = s => { const text = String(s == null ? "" : s); if (window.TriancleRust && window.TriancleRust.escapeHtml) { const result = window.TriancleRust.escapeHtml(text); if (result !== null) return result; } return text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); };
const FR_TABLE = "friendships";
const dn = p => (p && (p.display_name || p.username)) || "";                // the name people see: display name if they set one, else username

/* offscreen renderer that turns any set of body colours into a picture */
const thumbs = (function () {
  let r;
  try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (_) { return null; }
  if (renderer.outputEncoding !== undefined) r.outputEncoding = renderer.outputEncoding;
  if (renderer.outputColorSpace !== undefined) r.outputColorSpace = renderer.outputColorSpace;
  r.toneMapping = renderer.toneMapping; r.toneMappingExposure = renderer.toneMappingExposure;
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100), av = createAvatar();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(4, 8, 6); sc.add(dl);
  sc.add(av.group);
  return { r, sc, cam, av, cache: new Map() };
})();
const WORN = new Map();                                              // user id -> ids of the UGC items they wear
const thumbsX = { cache: new Map(), q: Promise.resolve() };
const UP = { ids: new Set(), timer: 0, shown: new Map(), fail: false };
function wornOf(uid) { return acct.user && uid === acct.user.id ? WEAR.mine : WORN.get(uid); }
const thumbKeyX = (colors, kind, ids) => kind + "|" + colorSig(sanitizeColors(colors)) + "|" + ids.join(",");
let _rigX = null;
function getRigX() {
  if (_rigX) return _rigX;
  let r; try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (_) { return null; }
  if (renderer.outputEncoding !== undefined) r.outputEncoding = renderer.outputEncoding;
  if (renderer.outputColorSpace !== undefined) r.outputColorSpace = renderer.outputColorSpace;
  r.toneMapping = renderer.toneMapping; r.toneMappingExposure = renderer.toneMappingExposure;
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100), av = createAvatar();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(4, 8, 6); sc.add(dl); sc.add(av.group);
  return (_rigX = { r, sc, cam, av });
}
function outfitThumb(colors, kind, ids) {                                // picture of a player wearing their items (items load from the network, so this is async)
  const key = thumbKeyX(colors, kind, ids);
  if (thumbsX.cache.has(key)) return Promise.resolve(thumbsX.cache.get(key));
  thumbsX.q = thumbsX.q.then(async () => {
    const R = getRigX(); if (!R) return "";
    setAvatarColors(R.av, sanitizeColors(colors));
    R.av.itemSig = ids.join(","); await applyItemsToAvatar(R.av, ids);
    R.av.group.rotation.y = -Math.PI / 2 + 0.3; R.av.group.position.y = 0;
    R.r.setSize(200, 200, false); R.cam.aspect = 1; R.cam.updateProjectionMatrix();
    if (kind === "body") { R.cam.position.set(0, 2.7, 12.5); R.cam.lookAt(0, 2.6, 0); } else { R.cam.position.set(0, 4.55, 4.6); R.cam.lookAt(0, 4.45, 0); }
    R.r.render(R.sc, R.cam);
    let url = ""; try { url = R.r.domElement.toDataURL("image/png"); } catch (_) {}
    thumbsX.cache.set(key, url); return url;
  }).catch(() => "");
  return thumbsX.q;
}
async function fetchWorn(ids) {
  const sb = getSB(); if (!sb) return;
  const need = ids.filter(i => !WORN.has(i)); if (!need.length) return;
  let rows = null;
  try { const r = await sb.rpc("equipped_items_by_users", { p_users: need }); if (!r.error) rows = r.data || []; } catch (_) {}
  if (!rows) { try { const r = await sb.from("ugc_inventory").select("user_id, item_id").in("user_id", need).eq("equipped", true); if (!r.error) rows = r.data || []; } catch (_) {} }
  if (!rows) { UP.fail = true; return; }                               // this database does not let us see other players' items yet
  for (const id of need) WORN.set(id, []);
  for (const r of rows) { const a = WORN.get(r.user_id); if (a && validItemId(r.item_id) && a.length < MAX_WORN) a.push(r.item_id); }
}
function queueUpgrade(uid) {
  if (!uid || (UP.fail && !(acct.user && uid === acct.user.id))) return;
  UP.ids.add(uid); if (UP.timer) return;
  UP.timer = setTimeout(async () => { const ids = [...UP.ids]; UP.ids.clear(); UP.timer = 0; try { await runUpgrade(ids); } catch (_) {} }, 40);
}
async function runUpgrade(ids) {
  const me = acct.user && acct.user.id;
  await fetchWorn(ids.filter(i => i !== me));
  for (const uid of ids) {
    const items = wornOf(uid) || [], p = uid === me ? { body_colors: myColors } : SOC.cache.get(uid); if (!p) continue;
    const prevUrls = UP.shown.get(uid) || new Map();
    const plain = thumb(p.body_colors, "face");
    const target = items.length ? await outfitThumb(p.body_colors, "face", items) : plain;
    if (!target) continue;
    const known = new Map(prevUrls); known.set(plain, 1);
    for (const el of document.querySelectorAll('[data-pid="' + uid + '"],[data-tu="' + uid + '"]')) {
      const img = el.tagName === "IMG" ? el : el.querySelector("img.pface");
      if (img && known.has(img.getAttribute("src"))) img.src = target;
    }
    known.set(target, 1); UP.shown.set(uid, known);
  }
}
function thumb(colors, kind, uid) {
  if (!thumbs) return "";
  if (uid) { const it = wornOf(uid); if (it && it.length) { const hit = thumbsX.cache.get(thumbKeyX(colors, kind, it)); if (hit) return hit; queueUpgrade(uid); } else if (!it) queueUpgrade(uid); }
  const c = sanitizeColors(colors), key = kind + "|" + colorSig(c);
  if (thumbs.cache.has(key)) return thumbs.cache.get(key);
  const w = 200, hgt = 200;
  setAvatarColors(thumbs.av, c);
  thumbs.av.group.rotation.y = -Math.PI / 2 + 0.3; thumbs.av.group.position.y = 0;
  thumbs.r.setSize(w, hgt, false); thumbs.cam.aspect = w / hgt; thumbs.cam.updateProjectionMatrix();
  if (kind === "body") { thumbs.cam.position.set(0, 2.7, 12.5); thumbs.cam.lookAt(0, 2.6, 0); }
  else { thumbs.cam.position.set(0, 4.55, 4.6); thumbs.cam.lookAt(0, 4.45, 0); }
  thumbs.r.render(thumbs.sc, thumbs.cam);
  let url = ""; try { url = thumbs.r.domElement.toDataURL("image/png"); } catch (_) {}
  thumbs.cache.set(key, url); return url;
}

async function getProfiles(ids, force) {
  const sb = getSB(); if (!sb) return;
  const need = [...new Set(ids)].filter(i => force || !SOC.cache.has(i)); if (!need.length) return;
  try {
    let r = await sb.from(CFG.SAVE_TABLE).select("id, username, display_name, body_colors, about, created_at, player_number").in("id", need);
    if (r.error) r = await sb.from(CFG.SAVE_TABLE).select("id, username, body_colors, about, created_at, player_number").in("id", need);
    if (r.error) r = await sb.from(CFG.SAVE_TABLE).select("id, username, body_colors, about, created_at").in("id", need);
    if (r.error) r = await sb.from(CFG.SAVE_TABLE).select("id, username, body_colors").in("id", need);
    for (const p of (r.data || [])) SOC.cache.set(p.id, p);
  } catch (_) {}
  await getBadges(need);
}
async function loadSocial() {
  const sb = getSB(); if (!sb || !acct.user) return;
  const me = acct.user.id;
  try {
    const { data, error } = await sb.from(FR_TABLE).select("requester, addressee, status").or(`requester.eq.${me},addressee.eq.${me}`);
    if (error) throw error;
    SOC.ok = true; SOC.friends = []; SOC.incoming = []; SOC.outgoing = [];
    const social = window.TriancleRust && window.TriancleRust.socialLists ? window.TriancleRust.socialLists(me, data) : null;
    if (social) { SOC.friends = social.friends; SOC.incoming = social.incoming; SOC.outgoing = social.outgoing; }
    else {
    for (const f of data) {
      const other = f.requester === me ? f.addressee : f.requester;
      if (f.status === "accepted") SOC.friends.push(other);
      else if (f.addressee === me) SOC.incoming.push(other); else SOC.outgoing.push(other);
    }
    }
    await getProfiles([me, ...SOC.friends, ...SOC.incoming, ...SOC.outgoing], true);
  } catch (_) { SOC.ok = false; }
  const n = SOC.incoming.length; $("reqBadge").textContent = n ? "(" + n + ")" : ""; updateUgcBtn();
}
const relation = id => { if (window.TriancleRust && window.TriancleRust.socialRelation) { const result = window.TriancleRust.socialRelation(id,SOC.friends,SOC.incoming,SOC.outgoing); if (result !== null) return result; } return SOC.friends.includes(id) ? "friend" : SOC.incoming.includes(id) ? "incoming" : SOC.outgoing.includes(id) ? "outgoing" : "none"; };
async function friendAct(kind, id) {
  const sb = getSB(), me = acct.user.id; if (!sb) return;
  try {
    const rustAction = window.TriancleRust && window.TriancleRust.friendAction ? window.TriancleRust.friendAction(kind) : null;
    const action = rustAction === null ? (kind === "add" ? 1 : kind === "accept" ? 2 : 3) : rustAction;
    if (action === 1) await sb.from(FR_TABLE).insert({ requester: me, addressee: id, status: "pending" });
    else if (action === 2) await sb.from(FR_TABLE).update({ status: "accepted" }).eq("requester", id).eq("addressee", me);
    else await sb.from(FR_TABLE).delete().or(`and(requester.eq.${me},addressee.eq.${id}),and(requester.eq.${id},addressee.eq.${me})`);
  } catch (_) {}
  await loadSocial();
}

;

/* ---- js/social/badges.js ---- */
"use strict";

/* ---- badges: given out only by the Owner (enforced in Supabase, see supabase_schema.sql) ---- */
const BADGES = { owner: "Owner", admin: "Admin", mod: "Moderator", ugc: "Official UGC Creator", bugfinder: "Bug Finder", alpha: "Alpha Publisher" };
const BADGE_ORDER = ["owner", "admin", "mod", "ugc", "bugfinder", "alpha"];
const BADGE_PERMS = { owner: { can_ugc: true, can_edit_items: true }, ugc: { can_ugc: true }, alpha: { can_studio: true, can_publish: true } };   // what each badge lets you do
const BADGE_BUILTIN = BADGE_ORDER.slice();
const BADGE_COLOR = { owner: "#ffd23f", admin: "#ff5d5d", mod: "#4aa8ff", ugc: "#b879ff", bugfinder: "#4be08a", alpha: "#ff9a20" };   // name tag colour per badge
const badgeColor = k => BADGE_COLOR[k] || ("hsl(" + badgeHueValue(k) + ",80%,62%)");
function badgeHueValue(k) { const text = String(k); if (window.TriancleRust && window.TriancleRust.badgeHue) { const hue = window.TriancleRust.badgeHue(text); if (hue !== null) return hue; } return [...text].reduce((a,c) => (a*31+c.charCodeAt(0))%360,7); }
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

;

/* ---- js/social/social.js ---- */
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
  const shelf = SOC.ok ? SOC.friends.slice(0, 60).map(id => pcard(id)).join("") : "";
  $("wFriends").innerHTML = !SOC.ok ? noteSQL : (shelf || '<div class="note">No friends yet.</div>');
  fitFriends();
}
/* show only the friends that fit on one line; the rest turn into a "7+ Friends" button that opens the Friends page */
function fitFriends() {
  const box = $("wFriends"); if (!box || $("tabHome").hidden) return;
  const total = SOC.ok ? SOC.friends.length : 0, old = box.querySelector(".moreCard"); if (old) old.remove();
  const cards = [...box.querySelectorAll(".pcard")]; if (!cards.length) return;
  for (const c of cards) c.hidden = false;
  const W = box.clientWidth, gap = 12, chipW = 92;
  if (cards.every(c => c.offsetLeft + c.offsetWidth <= W) && total <= cards.length) return;      // everyone fits
  let keep = 0; for (const c of cards) { if (c.offsetLeft + c.offsetWidth + gap + chipW <= W) keep++; else break; }
  keep = Math.max(1, keep);
  cards.forEach((c, i) => { c.hidden = i >= keep; });
  const chip = document.createElement("button"); chip.type = "button"; chip.className = "pcard moreCard"; chip.dataset.go = "friends";
  chip.innerHTML = "<b>" + (total - keep) + "+</b><span>Friends</span>"; box.appendChild(chip);
}
window.addEventListener("resize", () => { try { fitFriends(); } catch (_) {} });

/* ---- friends tab ---- */
let searchT = 0;
async function renderFriends() {
  if (!acct.user) return;
  await loadSocial();
  $("fReqWrap").hidden = !SOC.incoming.length; $("fReqT").textContent = "Requests (" + SOC.incoming.length + ")";
  $("fReqs").innerHTML = SOC.incoming.map(id => { const p = SOC.cache.get(id); if (!p) return "";
    return `<div class="reqRow box"><img alt="" data-pid="${esc(id)}" src="${thumb(p.body_colors, "face", id)}"><b data-pid="${esc(id)}">${esc(dn(p))}</b><button class="btnP" data-act="accept" data-id="${esc(id)}" type="button">Accept</button><button class="btnG" data-act="remove" data-id="${esc(id)}" type="button">Decline</button></div>`; }).join("");
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
    for (const p of rows) SOC.cache.set(p.id, Object.assign({}, SOC.cache.get(p.id) || {}, p));
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
  let oldNames = [];                                                 // everyone can see a player's earlier usernames
  try { const h = await getSB().from("username_history").select("old_username").eq("user_id", id).order("changed_at", { ascending: false }); if (!h.error) oldNames = (h.data || []).map(x => x.old_username); } catch (_) {}
  let theirFriends = [];
  if (mine) theirFriends = SOC.friends;
  else {
    try {
      const r = await getSB().from(FR_TABLE).select("requester, addressee").eq("status", "accepted").or(`requester.eq.${id},addressee.eq.${id}`);
      const rows = r.data || [];
      const friends = window.TriancleRust && window.TriancleRust.socialLists && Array.isArray(rows)
        ? window.TriancleRust.socialLists(id,rows.map(f => ({requester:f.requester,addressee:f.addressee,status:"accepted"}))) : null;
      theirFriends = friends ? friends.friends : rows.map(f => f.requester === id ? f.addressee : f.requester);
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
        <div id="pNameRow"><h2 id="pName">${esc(dn(p))}</h2>${badgeList(id).length ? `<span class="bdgs" id="pBadges">${bigBadges(id)}</span>` : ""}</div>
        ${p.display_name && p.display_name !== p.username ? `<div id="pHandle">@${esc(p.username)}</div>` : ""}
        ${oldNames.length ? `<div id="pOld">Previously: ${oldNames.map(n => esc(n)).join(", ")}</div>` : ""}
        <div id="pStats"><div><b>${theirFriends.length}</b>Friends</div></div>
      </div>
      <div id="pActs">${acts}</div>
    </div>
    <h3 id="pAvTitle">Avatar</h3>
    <div id="pStage">
      <div id="pvBox"><span id="pvWear"></span><button id="pvLock" type="button" title="Lock / unlock rotation"></button></div>
      <div id="pItemsWrap"><div id="pItems" aria-label="Items worn"></div></div>
    </div>
    <div id="pAbout" class="box"><h4>Bio ${mine ? '<button class="linkBtn" id="pEdit" type="button">Edit</button>' : ""}</h4><div id="pAboutBody"><p>${about}</p></div></div>
    <div id="pFriends" class="box"><h4><button class="pFrTitle" type="button" data-go="friends">Friends</button></h4><div id="pFrRow"></div></div>
    <div id="pJoined" class="box"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2zM5 9v11h14V9z"/></svg><div><span>Joined</span><b>${esc(joinedTxt)}</b></div></div>`;
  profileFriends(theirFriends);
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
        if (r.error) $("pMsg").textContent = "Couldn't save (run supabase_schema.sql)"; else renderProfile(id);
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

;

/* ---- js/social/profile-view.js ---- */
"use strict";

/* =====================================================================
   PROFILE PAGE extras: the 3D avatar view, the scrolling list of worn items
   (click one -> its Catalog page) and the friends row with a "more" tile.
   Called from renderProfile() in social.js.
   ===================================================================== */
const PV = { r: null, sc: null, cam: null, av: null, cv: null, fail: false, running: false, t: 0, yaw: 0, drag: null, locked: false, sw: 1, sig: "", colors: null, items: [], tok: 0 };
const PV_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>';
const PV_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 10h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 9.6-2l-1.9.8A3 3 0 0 0 9 7v3z"/></svg>';

function pvInit() {                                                  // one renderer for the page, made on first use
  if (PV.r) return true;
  if (PV.fail) return false;
  try {
    PV.cv = document.createElement("canvas"); PV.cv.id = "pvCv";
    PV.r = new THREE.WebGLRenderer({ canvas: PV.cv, antialias: true, alpha: true });
  } catch (_) { PV.fail = true; PV.r = null; return false; }
  if (renderer.outputEncoding !== undefined) PV.r.outputEncoding = renderer.outputEncoding;
  if (renderer.outputColorSpace !== undefined) PV.r.outputColorSpace = renderer.outputColorSpace;
  PV.r.toneMapping = renderer.toneMapping; PV.r.toneMappingExposure = renderer.toneMappingExposure;
  PV.sc = new THREE.Scene(); PV.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100); PV.av = createAvatar();
  PV.sc.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(4, 8, 6); PV.sc.add(dl);
  PV.sc.add(PV.av.group); PV.cam.position.set(0, 2.85, 12); PV.cam.lookAt(0, 2.8, 0);
  return true;
}

function pvLoop(now) {
  if (!PV.r || $("tabProfile").hidden || inGame) { PV.running = false; return; }
  requestAnimationFrame(pvLoop);
  const dt = Math.min((now - PV.t) / 1000, 0.1); PV.t = now;
  const cv = PV.cv, w = cv.clientWidth, h = cv.clientHeight, pr = Math.min(window.devicePixelRatio || 1, 2);
  if (!w || !h) return;
  if (cv.width !== Math.round(w * pr) || cv.height !== Math.round(h * pr)) { PV.r.setPixelRatio(pr); PV.r.setSize(w, h, false); PV.cam.aspect = w / h; PV.cam.updateProjectionMatrix(); }
  if (PV.colors) { const sig = colorSig(PV.colors); if (sig !== PV.sig) { PV.sig = sig; setAvatarColors(PV.av, sanitizeColors(PV.colors)); } }
  syncAvatarItems(PV.av, PV.items);
  PV.sw += ((PV.locked ? 0 : 1) - PV.sw) * Math.min(1, dt * 6);        // locked: stop swaying and face the front
  if (PV.locked && PV.drag === null) PV.yaw *= Math.exp(-dt * 7);
  const t = now / 1000, rg = PV.av.rig, s = Math.sin(t * 1.7);
  PV.av.group.rotation.y = -Math.PI / 2 + PV.yaw + Math.sin(t * 0.7) * 0.35 * PV.sw;
  PV.av.group.position.y = s * 0.02;
  rg.LeftArm.rotation.z = s * 0.05; rg.RightArm.rotation.z = -s * 0.05;
  PV.r.render(PV.sc, PV.cam);
}

async function profileStage(id, colors, wornP) {
  const tok = ++PV.tok, box = $("pvBox"), list = $("pItems");
  if (!box || !list) return;
  PV.items = []; PV.colors = sanitizeColors(colors); PV.yaw = 0; PV.locked = false; PV.sw = 1; PV.sig = "";
  if (pvInit()) {
    box.insertBefore(PV.cv, box.firstChild);
    box.addEventListener("pointerdown", e => { if (PV.locked || e.target.closest("button")) return; PV.drag = e.clientX; box.setPointerCapture(e.pointerId); });
    box.addEventListener("pointermove", e => { if (PV.drag !== null) { PV.yaw += (e.clientX - PV.drag) * 0.012; PV.drag = e.clientX; } });
    const end = () => { PV.drag = null; }; box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
    const lk = $("pvLock"), paintLock = () => { lk.classList.toggle("locked", PV.locked); lk.innerHTML = PV.locked ? PV_LOCK : PV_OPEN; };
    lk.addEventListener("click", () => { PV.locked = !PV.locked; paintLock(); }); paintLock();
    if (!PV.running) { PV.running = true; PV.t = performance.now(); requestAnimationFrame(pvLoop); }
  } else box.insertAdjacentHTML("beforeend", '<div class="note pvNo">3D view isn\'t available on this device.</div>');

  try { await wornP; } catch (_) {}
  try { await loadFaceMeta(); } catch (_) {}
  if (tok !== PV.tok) return;
  const ids = (wornOf(id) || []).slice(0, MAX_WORN), faceNo = sanitizeColors(colors).face | 0, faceId = faceNo ? faceItemFor(faceNo) : null;
  const rows = await fetchItemRows(faceId ? ids.concat([faceId]) : ids);
  if (tok !== PV.tok) return;
  PV.items = ids; PV.sig = "";                                       // sig reset: face pictures added by the Owner may have just registered
  const n = ids.length + (faceNo ? 1 : 0);
  $("pvWear").textContent = n ? "Wearing " + n + (n === 1 ? " item" : " items") : "Nothing extra on";
  const shown = ids.concat(faceId ? [faceId] : []).filter(x => rows.get(x));
  list.innerHTML = shown.length ? shown.map(x => { const it = rows.get(x);
    return `<button class="pItem" type="button" data-item="${esc(x)}" title="${esc(it.name)}"><img alt="" data-it="${esc(x)}" src=""><span>${esc(it.name)}</span></button>`; }).join("")
    : '<div class="note pItemsNone">No items worn.</div>';
  list.onclick = e => { const b = e.target.closest("[data-item]"); if (b) openItem(b.dataset.item); };
  fillThumbs(list);
}

const PF = { list: [] };
function profileFriends(list) {                                      // as many cards as fit the row; the last slot becomes "more" when some don't
  PF.list = list || PF.list;
  const row = $("pFrRow"); if (!row) return;
  if (!PF.list.length) { row.innerHTML = '<div class="note">No friends yet.</div>'; return; }
  const CARD = 120, GAP = 14, W = row.clientWidth || row.parentElement.clientWidth || 0;
  const slots = Math.max(1, Math.floor((W + GAP) / (CARD + GAP)));
  const all = PF.list.length <= slots, n = all ? PF.list.length : Math.max(0, slots - 1), rest = PF.list.length - n;
  row.innerHTML = PF.list.slice(0, n).map(f => pcard(f)).join("")
    + (all ? "" : `<button class="pMore" type="button" data-go="friends"><b>+${rest}</b><span>more</span></button>`);
}
let pfT = 0;
window.addEventListener("resize", () => { cancelAnimationFrame(pfT); pfT = requestAnimationFrame(() => { if ($("pFrRow") && !$("tabProfile").hidden) profileFriends(); }); });

;

/* ---- js/ui/settings.js ---- */
"use strict";

/* =====================================================================
   ACCOUNT SETTINGS
   - Display name: free, change any time (player_profiles.display_name)
   - Username: costs USERNAME_COST triangcles every time. The charge, the check that the name is free and the
     rename itself all happen in Supabase (change_username in supabase_schema.sql) so nobody can skip the cost.
   - Old usernames are kept in username_history and shown on the player's profile.
   ===================================================================== */
const USERNAME_COST = 150;                                          // keep in step with supabase_schema.sql
const NAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const DISPLAY_RE = /^[\p{L}\p{N}_.'\- ]{1,20}$/u;
function validDisplayName(value) { if (window.TriancleRust && window.TriancleRust.validDisplayName) { const ok = window.TriancleRust.validDisplayName(value); if (ok !== null) return ok; } return DISPLAY_RE.test(value); }
const RENAME_ERR = {
  not_signed_in: "Log in first.", invalid: "Username: 3-20 letters, numbers or _", same: "That's already your username.",
  taken: "That username is taken (or someone used it before).", not_enough: "You don't have enough Shapes.",
  no_profile: "Your account isn't saved yet. Try again in a moment."
};

async function renderSettings() {
  const body = $("sBody");
  if (!acct.user) { body.innerHTML = '<div class="note">Log in to change your account settings.</div>'; return; }
  const sb = getSB(), me = acct.user.id;
  body.innerHTML = '<div class="muted">Loading…</div>';
  let display = "", old = [];
  try { const r = await sb.from(CFG.SAVE_TABLE).select("display_name").eq("id", me).maybeSingle(); if (!r.error && r.data) display = r.data.display_name || ""; } catch (_) {}
  try { const h = await sb.from("username_history").select("old_username, changed_at").eq("user_id", me).order("changed_at", { ascending: false }); if (!h.error) old = h.data || []; } catch (_) {}
  await loadWallet();
  const bal = WAL.bal == null ? "?" : fmtT(WAL.bal);
  body.innerHTML = `
    <h2 id="sTitle">Account settings</h2>
    <div class="box sBox">
      <h4>Display name</h4>
      <p class="muted">The name shown on your profile and on player cards. It's free and you can change it whenever you like. Your username stays the same.</p>
      <div class="sRow"><input id="sDisp" type="text" maxlength="20" value="${esc(display)}" placeholder="${esc(acct.username)}" autocomplete="off" spellcheck="false"><button class="btnP" id="sDispSave" type="button">Save</button></div>
      <div class="note sMsg" id="sDispMsg"></div>
    </div>
    <div class="box sBox">
      <h4>Username</h4>
      <p class="muted">Your username is <b>@${esc(acct.username)}</b>. You log in with it. Changing it costs <span class="sCost">${TRI_SVG}${USERNAME_COST}</span> every time, and everyone can see your old usernames on your profile.</p>
      <div class="sRow"><input id="sUser" type="text" maxlength="20" placeholder="New username" autocomplete="off" spellcheck="false"><button class="btnP" id="sUserSave" type="button">Change for ${TRI_SVG}${USERNAME_COST}</button></div>
      <div class="note sMsg" id="sUserMsg">You have <span class="sCost">${TRI_SVG}<span id="sBal">${esc(bal)}</span></span>.</div>
    </div>
    <div class="box sBox">
      <h4>Previous usernames</h4>
      <div id="sOld">${old.length ? old.map(o => `<div class="sOldRow"><b>@${esc(o.old_username)}</b><span class="muted">${esc(new Date(o.changed_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }))}</span></div>`).join("") : '<span class="muted">You haven\'t changed your username.</span>'}</div>
    </div>`;
  for (const id of ["sDisp", "sUser"]) $(id).addEventListener("keydown", e => e.stopPropagation());
  $("sDispSave").addEventListener("click", saveDisplayName);
  $("sUserSave").addEventListener("click", saveUsername);
}

async function saveDisplayName() {
  const msg = $("sDispMsg"), v = $("sDisp").value.trim(), sb = getSB();
  if (v && !validDisplayName(v)) { msg.textContent = "Display name: up to 20 letters, numbers, spaces, . _ - '"; return; }
  msg.textContent = "Saving…";
  try {
    const r = await sb.from(CFG.SAVE_TABLE).update({ display_name: v || null }).eq("id", acct.user.id).select("id");
    if (r.error || !(r.data && r.data.length)) throw r.error || new Error("no row");
    const p = SOC.cache.get(acct.user.id); if (p) p.display_name = v || null;
    msg.textContent = v ? "Saved. People will see \"" + v + "\"." : "Saved. People will see your username.";
  } catch (_) { msg.textContent = "Couldn't save. Run supabase_schema.sql in Supabase once."; }
}

async function saveUsername() {
  const msg = $("sUserMsg"), btn = $("sUserSave"), v = $("sUser").value.trim(), sb = getSB();
  const check = window.TriancleRust && window.TriancleRust.renameCheck ? window.TriancleRust.renameCheck(v,acct.username,WAL.bal,USERNAME_COST) : null;
  if (check === 1 || (check === null && !validUsername(v))) { msg.textContent = RENAME_ERR.invalid; return; }
  if (check === 2 || (check === null && v.toLowerCase() === acct.username.toLowerCase())) { msg.textContent = RENAME_ERR.same; return; }
  if (check === 3 || (check === null && WAL.bal != null && WAL.bal < USERNAME_COST)) { msg.textContent = RENAME_ERR.not_enough; return; }
  if (!(await uiConfirm("Change your username to \"" + v + "\" for " + USERNAME_COST + " Shapes?\nYour old username will show on your profile.", "Change"))) return;
  btn.disabled = true; msg.textContent = "Changing…";
  try {
    const r = await sb.rpc("change_username", { p_new: v });
    if (r.error) { const code = Object.keys(RENAME_ERR).find(k => String(r.error.message || "").includes(k)); throw new Error(code || "fail"); }
    const d = r.data || {};
    acct.username = d.username || v; setPlayerName(acct.username); acctUI();
    const p = SOC.cache.get(acct.user.id); if (p) p.username = acct.username;
    await renderSettings();
    $("sUserMsg").textContent = "Done. You're now @" + acct.username + ".";
  } catch (e) {
    const m = String(e && e.message);
    msg.textContent = RENAME_ERR[m] || "Couldn't change it. Run supabase_schema.sql in Supabase once.";
  }
  btn.disabled = false;
}

;

/* ---- js/ui/menu.js ---- */
"use strict";

/* =====================================================================
   In-game menu (Esc): Players / Settings / Controls / Stats
   ===================================================================== */
var menuOpen = false, shiftLockEnabled = true, menuOpenedAt = 0;
var gmStatsEl = $("gmStats");
const SET_KEY = "tri_settings";
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SET_KEY) || "{}");
    if (typeof s.sl === "boolean") shiftLockEnabled = s.sl;
    if (isFinite(s.off)) CFG.SHIFTLOCK_OFFSET = s.off;
    if (isFinite(s.turn)) CFG.SHIFTLOCK_TURN = s.turn;
    if (isFinite(s.sens)) CFG.CAM_SENS = s.sens;
    if (s.board === false) boardEl.style.display = "none";
  } catch (_) {}
}
function saveSettings() {
  try { localStorage.setItem(SET_KEY, JSON.stringify({ sl: shiftLockEnabled, off: CFG.SHIFTLOCK_OFFSET, turn: CFG.SHIFTLOCK_TURN, sens: CFG.CAM_SENS, board: boardEl.style.display !== "none" })); } catch (_) {}
}
loadSettings();

const gm = $("gmenu");
function setSeg(id, val) { for (const b of $(id).children) b.classList.toggle("on", b.dataset.v === String(val)); }
function syncSettings() {
  setSeg("sGfx", gfxLevel); setSeg("sSL", shiftLockEnabled ? 1 : 0);
  setSeg("sBoard", boardEl.style.display === "none" ? 0 : 1); setSeg("sHit", hitOn ? 1 : 0);
  const sl = [["sOff", CFG.SHIFTLOCK_OFFSET, v => v.toFixed(2)], ["sTurn", CFG.SHIFTLOCK_TURN, v => String(Math.round(v))], ["sSens", CFG.CAM_SENS, v => (v / 0.0045).toFixed(1) + "x"]];
  for (const [id, v, f] of sl) { $(id).value = v; $(id + "V").textContent = f(+v); }
  $("gmWho").textContent = acct.user ? "Signed in as " + acct.username : "Playing as guest";
}
let gmTab = "settings", gmTimer = 0;
function gmShow(tab) {
  gmTab = tab;
  for (const b of document.querySelectorAll("#gmTabs button")) b.classList.toggle("on", b.dataset.gm === tab);
  for (const p of document.querySelectorAll(".gmp")) p.classList.toggle("on", p.id === "gm-" + tab);
  $("gmTitle").textContent = tab[0].toUpperCase() + tab.slice(1);
  if (tab === "players") renderMenuPlayers(true);
}
function openMenu() {
  if (menuOpen || !inGame) return;
  menuOpen = true; menuOpenedAt = performance.now(); freeMouse(); syncSettings(); gm.classList.add("open"); gmShow(gmTab);
  loadSocial().then(() => renderMenuPlayers(true));
  gmTimer = setInterval(() => { if (gmTab === "players") renderMenuPlayers(); }, 600);
}
function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false; clearInterval(gmTimer); gm.classList.remove("open"); saveSettings();
  if (document.activeElement) document.activeElement.blur();
  lockErrAt = performance.now() - 900; setTimeout(ensureLock, 450);   // shift lock grabs the mouse again right after the menu closes
}
function toggleMenu() { menuOpen ? closeMenu() : openMenu(); }
function leaveGame() { freeMouse(); flushSave().then(() => location.reload(), () => location.reload()); }
function menuKey(e) {
  if (e.target && e.target.type === "range") return;
  if (e.code === "KeyL") leaveGame();
  else if (e.code === "KeyR") { resetCharacter(); closeMenu(); }
}
for (const b of document.querySelectorAll("#gmTabs button")) b.addEventListener("click", () => gmShow(b.dataset.gm));
$("gmClose").addEventListener("click", closeMenu); $("gmRes").addEventListener("click", closeMenu);
$("gmLeave").addEventListener("click", leaveGame);
$("gmResp").addEventListener("click", () => { resetCharacter(); closeMenu(); });
$("gmLogout").addEventListener("click", signOutNow);
gm.addEventListener("mousedown", e => { if (e.target === gm) closeMenu(); });
$("tbLogo").addEventListener("click", openMenu); $("tbMenu").addEventListener("click", openMenu);
$("tbChat").addEventListener("click", () => { if (!menuOpen) toggleChat(); });

$("sGfx").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { setGraphics(+b.dataset.v); setSeg("sGfx", b.dataset.v); } });
$("sSL").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return;
  shiftLockEnabled = b.dataset.v === "1"; if (!shiftLockEnabled && shiftLock) setShiftLock(false); setSeg("sSL", b.dataset.v); saveSettings(); });
$("sBoard").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return;
  boardEl.style.display = b.dataset.v === "1" ? "block" : "none"; setSeg("sBoard", b.dataset.v); saveSettings(); });
$("sHit").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; hitOn = b.dataset.v === "1"; setSeg("sHit", b.dataset.v); });
$("sOff").addEventListener("input", e => { CFG.SHIFTLOCK_OFFSET = +e.target.value; $("sOffV").textContent = (+e.target.value).toFixed(2); });
$("sTurn").addEventListener("input", e => { CFG.SHIFTLOCK_TURN = +e.target.value; $("sTurnV").textContent = e.target.value; });
$("sSens").addEventListener("input", e => { CFG.CAM_SENS = +e.target.value; $("sSensV").textContent = (e.target.value / 0.0045).toFixed(1) + "x"; });
for (const id of ["sOff", "sTurn", "sSens"]) $(id).addEventListener("change", saveSettings);

;

/* ---- js/ui/chat-ui.js ---- */
"use strict";

/* =====================================================================
   Chat window, block, report, friend buttons on players
   ===================================================================== */
function setChat(on) {
  document.body.classList.toggle("chatopen", on);
  if (on) { chatLog.scrollTop = chatLog.scrollHeight; $("tbChat").classList.remove("dot"); } else chatInput.blur();
}
function toggleChat() {
  const on = !document.body.classList.contains("chatopen");
  setChat(on); if (on) chatInput.focus();
}

const BLOCK_KEY = "tri_blocked";
let blocked = new Set();
try { blocked = new Set(JSON.parse(localStorage.getItem(BLOCK_KEY) || "[]")); } catch (_) {}
function isBlocked(name) { return !!name && blocked.has(String(name).toLowerCase()); }
function toggleBlock(name) {
  const k = String(name).toLowerCase();
  if (blocked.has(k)) blocked.delete(k); else blocked.add(k);
  try { localStorage.setItem(BLOCK_KEY, JSON.stringify([...blocked])); } catch (_) {}
}

const uidCache = new Map();
async function uidFor(name) {
  if (uidCache.has(name)) return uidCache.get(name);
  const sb = getSB(); if (!sb) return null;
  try {
    const r = await sb.from(CFG.SAVE_TABLE).select("id").eq("username", name).maybeSingle();
    const id = r.data && r.data.id || null;
    if (id) uidCache.set(name, id); return id;
  } catch (_) { return null; }
}

/* ---- report ---- */
let rptName = "";
function openReport(name) {
  rptName = name; $("rptT").textContent = "Report " + name; $("rptText").value = ""; $("rptMsg").textContent = ""; $("rptSend").disabled = false;
  $("rpt").classList.add("open");
}
function closeReport() { $("rpt").classList.remove("open"); }
$("rptCancel").addEventListener("click", closeReport);
$("rpt").addEventListener("mousedown", e => { if (e.target === $("rpt")) closeReport(); });
$("rptText").addEventListener("keydown", e => e.stopPropagation());
$("rptSend").addEventListener("click", async () => {
  const sb = getSB(); if (!sb || !acct.user) { $("rptMsg").textContent = "Log in to send a report."; return; }
  $("rptSend").disabled = true; $("rptMsg").textContent = "Sending…";
  const id = await uidFor(rptName);
  let err = null;
  try {
    const r = await sb.from("reports").insert({ reporter: acct.user.id, reported_name: rptName, reported_id: id, reason: $("rptReason").value, details: $("rptText").value.trim().slice(0, 300) });
    err = r.error;
  } catch (e) { err = e; }
  if (err) { $("rptMsg").textContent = "Couldn't send. Run supabase_schema.sql first."; $("rptSend").disabled = false; }
  else { $("rptMsg").textContent = "Report sent. Thanks!"; setTimeout(closeReport, 1100); }
});

/* ---- block / report buttons on a profile page ---- */
function addSafetyBtns(p) {
  const box = $("pActs"); if (!box) return;
  const bb = document.createElement("button"); bb.type = "button"; bb.className = "btnG";
  const paint = () => { bb.textContent = isBlocked(p.username) ? "Unblock" : "Block"; };
  paint(); bb.addEventListener("click", () => { toggleBlock(p.username); paint(); });
  const rb = document.createElement("button"); rb.type = "button"; rb.className = "btnG"; rb.textContent = "Report";
  rb.addEventListener("click", () => openReport(p.username));
  box.appendChild(bb); box.appendChild(rb);
}

/* ---- menu player list: icon, add friend, report, block ---- */
let pSig = "";
function renderMenuPlayers(force) {
  const list = [...players.values()];
  const sig = list.map(pl => pl.name + (isBlocked(pl.name) ? "!" : "") + (pl.local ? "*" : "") + (pl.colorSig || "")).join("|") + "#" + SOC.friends.join() + SOC.outgoing.join() + SOC.incoming.join();
  if (!force && sig === pSig) return;
  pSig = sig;
  const box = $("gmPlayers"); box.textContent = "";
  for (const pl of list) {
    const row = document.createElement("div"); row.className = "pr" + (pl.local ? " me" : "");
    const img = document.createElement("img"); img.alt = ""; img.src = thumb(pl.local ? myColors : pl.colors, "face");
    const nm = document.createElement("b"); nm.textContent = pl.name;
    if (pl.local) { const s = document.createElement("small"); s.textContent = "you"; nm.appendChild(s); }
    row.appendChild(img); row.appendChild(nm);
    if (!pl.local) {
      const acts = document.createElement("div"); acts.className = "pacts";
      const fb = document.createElement("button"); fb.type = "button"; fb.className = "pbtn"; fb.textContent = "Add friend"; fb.disabled = true;
      const rb = document.createElement("button"); rb.type = "button"; rb.className = "pbtn"; rb.textContent = "Report";
      const bb = document.createElement("button"); bb.type = "button"; bb.className = "pbtn" + (isBlocked(pl.name) ? " on" : ""); bb.textContent = isBlocked(pl.name) ? "Unblock" : "Block";
      rb.addEventListener("click", () => openReport(pl.name));
      bb.addEventListener("click", () => { toggleBlock(pl.name); renderMenuPlayers(true); });
      acts.appendChild(fb); acts.appendChild(rb); acts.appendChild(bb); row.appendChild(acts);
      uidFor(pl.name).then(id => {
        if (!id) { fb.remove(); return; }
        const rel = relation(id);
        fb.textContent = rel === "friend" ? "Friends" : rel === "outgoing" ? "Request sent" : rel === "incoming" ? "Accept" : "Add friend";
        fb.classList.toggle("on", rel === "friend");
        fb.disabled = rel === "friend" || rel === "outgoing";
        fb.onclick = async () => { fb.disabled = true; await friendAct(rel === "incoming" ? "accept" : "add", id); renderMenuPlayers(true); };
      });
    }
    box.appendChild(row);
  }
}

;

/* ---- js/ui/players.js ---- */
"use strict";

/* ---- players page: browse everyone, or search by name ---- */
const PL = { q: "", sort: "new", filter: "all", from: 0, per: 36, busy: false, t: 0, tok: 0, noNum: false };
$("plSearch").addEventListener("keydown", e => e.stopPropagation());
$("plSearch").addEventListener("input", () => {
  clearTimeout(PL.t);
  PL.t = setTimeout(() => { PL.q = $("plSearch").value.trim().replace(/[^A-Za-z0-9_]/g, ""); renderPlayers(true); }, 250);
});
$("plMore").addEventListener("click", () => renderPlayers(false));
$("plSort").addEventListener("change", () => { PL.sort = $("plSort").value; renderPlayers(true); });
$("plFilter").addEventListener("change", () => { PL.filter = $("plFilter").value; renderPlayers(true); });
async function renderPlayers(reset) {
  const sb = getSB(); if (!sb || !acct.user || (PL.busy && !reset)) return;
  PL.busy = true; if (reset) PL.tok++;
  const tok = PL.tok, T = CFG.SAVE_TABLE;
  if (reset) { PL.from = 0; $("plList").innerHTML = ""; $("plNote").textContent = "Loading…"; $("plMore").hidden = true; }
  try {
    let ids = null;
    if (PL.filter === "friends") { await loadSocial(); ids = SOC.friends.slice(); }
    else if (PL.filter === "any" || BADGES[PL.filter]) {
      let bq = sb.from("badges").select("user_id"); if (BADGES[PL.filter]) bq = bq.eq("badge", PL.filter);
      const br = await bq; if (br.error) throw br.error;
      ids = [...new Set((br.data || []).map(b => b.user_id))];
    }
    if (tok !== PL.tok) { PL.busy = false; return; }
    let rows = [];
    if (!ids || ids.length) {
      const run = (cols, col, asc) => {
        let q = sb.from(T).select(cols);
        if (ids) q = q.in("id", ids);
        if (PL.q) q = q.ilike("username", "%" + PL.q + "%");
        return q.order(col, { ascending: asc, nullsFirst: false }).range(PL.from, PL.from + PL.per - 1);
      };
      const byNum = PL.sort === "new" || PL.sort === "old";
      let r = await run("id, username, body_colors, player_number", byNum ? "player_number" : "username", PL.sort === "old" || PL.sort === "az");
      PL.noNum = false;
      if (r.error) { PL.noNum = true; r = await run("id, username, body_colors", "username", PL.sort !== "za"); }
      if (r.error) throw r.error;
      rows = r.data || [];
    }
    for (const p of rows) SOC.cache.set(p.id, Object.assign({}, SOC.cache.get(p.id) || {}, p));
    await Promise.all([getBadges(rows.map(p => p.id)), loadSocial()]);
    if (tok !== PL.tok) { PL.busy = false; return; }
    $("plList").insertAdjacentHTML("beforeend", rows.map(p => pcard(p.id, p.id === acct.user.id ? "you" : "")).join(""));
    PL.from += rows.length;
    $("plMore").hidden = rows.length < PL.per;
    $("plNote").textContent = PL.from ? (PL.noNum ? "Player IDs and newest/oldest need supabase_schema.sql to be run once." : "") : (PL.q || PL.filter !== "all" ? "No players found." : "No players yet.");
  } catch (_) { $("plNote").textContent = "Couldn't load players right now."; }
  PL.busy = false;
}

;

/* ---- js/social/owner.js ---- */
"use strict";

/* ---- owner page: give or remove badges (Supabase only allows the Owner to do this) ---- */
const OW = { q: "", t: 0 };
$("owSearch").addEventListener("keydown", e => e.stopPropagation());
$("owSearch").addEventListener("input", () => {
  clearTimeout(OW.t);
  OW.t = setTimeout(() => { OW.q = $("owSearch").value.trim().replace(/[^A-Za-z0-9_]/g, ""); renderOwner(); }, 250);
});
function ownerRow(id) {
  const p = SOC.cache.get(id); if (!p) return "";
  const has = badgeList(id);
  return `<div class="owPlayer box" data-owid="${esc(id)}">
    <div class="owTop"><img alt="" data-pid="${esc(id)}" src="${thumb(p.body_colors, "face", id)}"><b data-pid="${esc(id)}">${esc(p.username)}</b></div>
    <div class="owSec"><span class="owLab">Badges</span><div class="owBtns">${BADGE_ORDER.map(k => `<button type="button" class="owB${has.includes(k) ? " on" : ""}" data-bk="${k}"><img alt="" src="${BADGE_IMG[k]}">${BADGES[k]}</button>`).join("")}</div></div>
    <div class="owSec"><span class="owLab">Shapes</span><div class="owWallet"><input data-wallet-amount type="number" min="1" max="1000000000" step="1" value="1" aria-label="Amount"><button class="btnG" data-wallet="add" type="button">Add</button><button class="btnG" data-wallet="remove" type="button">Remove</button></div></div>
  </div>`;
}
async function renderOwner() {
  if (!isOwner()) return;
  if (typeof renderBadgeAdmin === "function") renderBadgeAdmin();
  const sb = getSB(), msg = $("owMsg"); if (!sb) return;
  msg.textContent = "Loading…";
  try {
    let ids = [];
    if (OW.q) {
      let r = await sb.from(CFG.SAVE_TABLE).select("id, username, body_colors, player_number").ilike("username", OW.q + "%").limit(20);
      if (r.error) r = await sb.from(CFG.SAVE_TABLE).select("id, username, body_colors").ilike("username", OW.q + "%").limit(20);
      if (r.error) throw r.error;
      for (const p of (r.data || [])) SOC.cache.set(p.id, Object.assign({}, SOC.cache.get(p.id) || {}, p));
      ids = (r.data || []).map(p => p.id);
    } else {
      const r = await sb.from("badges").select("user_id"); if (r.error) throw r.error;
      ids = [...new Set((r.data || []).map(b => b.user_id))];
      await getProfiles(ids, true);
    }
    await getBadges(ids);
    $("owList").innerHTML = ids.map(ownerRow).join("");
    msg.textContent = ids.length ? (OW.q ? "" : "Players who have badges right now:") : (OW.q ? "No players found." : "Nobody has a badge yet. Search for a player above.");
  } catch (_) { msg.textContent = "Couldn't load badges. Run supabase_schema.sql in Supabase once."; }
}
$("owList").addEventListener("click", async e => {
  const moneyBtn = e.target.closest("[data-wallet]");
  if (moneyBtn) {
    if (!isOwner()) return;
    const row = moneyBtn.closest("[data-owid]"), amount = Number(row.querySelector("[data-wallet-amount]").value);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) { $("owMsg").textContent = "Enter a whole amount from 1 to 1,000,000,000."; return; }
    moneyBtn.disabled = true;
    try {
      const result = await getSB().rpc("owner_adjust_wallet", { p_user: row.dataset.owid, p_delta: moneyBtn.dataset.wallet === "add" ? amount : -amount });
      if (result.error) throw result.error;
      $("owMsg").textContent = "Balance updated: " + Number(result.data).toLocaleString() + " Shapes.";
      if (row.dataset.owid === acct.user.id) await loadWallet();
    } catch (err) { $("owMsg").textContent = /insufficient_funds/.test(err.message || "") ? "That player does not have enough Shapes." : "Couldn't change the balance. Check the owner badge and run supabase_owner_wallet.sql."; }
    finally { moneyBtn.disabled = false; }
    return;
  }
  const btn = e.target.closest("[data-bk]"); if (!btn || !isOwner()) return;
  const row = btn.closest("[data-owid]"), uid = row.dataset.owid, k = btn.dataset.bk, sb = getSB();
  const has = (SOC.badges.get(uid) || []).includes(k);
  btn.disabled = true;
  try {
    const r = has ? await sb.from("badges").delete().eq("user_id", uid).eq("badge", k)
                  : await sb.from("badges").insert({ user_id: uid, badge: k, granted_by: acct.user.id });
    if (r.error) throw r.error;
    $("owMsg").textContent = "";
  } catch (_) { $("owMsg").textContent = "Couldn't change that badge. Make sure supabase_schema.sql has been run and your account has the Owner badge."; }
  await getBadges([uid]);
  row.outerHTML = ownerRow(uid);
});
updateOwnerBtn();
function updateOwnerBtn() { $("ownerTabBtn").hidden = !isOwner(); }

;

/* ---- js/social/owner-tools.js ---- */
"use strict";

/* ---- Owner page: make new badges (picture + name + what it allows) and put the built-in faces in the Catalog ---- */
const BD = { file: null, prevUrl: "" };
const bdMsg = (t, bad) => { const n = $("bdMsg"); n.textContent = t || ""; n.style.color = bad ? "#ff7a6b" : ""; };
$("owBadges").addEventListener("keydown", e => e.stopPropagation());

$("bdFile").addEventListener("change", () => {
  const f = $("bdFile").files && $("bdFile").files[0]; $("bdFile").value = "";
  if (!f) return;
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return bdMsg("Pick a PNG, JPG or WebP picture.", true);
  if (f.size > 4 * 1024 * 1024) return bdMsg("That picture is too big (4 MB max).", true);
  BD.file = f; bdMsg("");
  if (BD.prevUrl) URL.revokeObjectURL(BD.prevUrl);
  BD.prevUrl = URL.createObjectURL(f); $("bdPrev").src = BD.prevUrl; $("bdPick").classList.add("has");
});
function badgePng(file) {                                           // any picture -> a clean 128x128 PNG (cropped square)
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      const cv = document.createElement("canvas"); cv.width = cv.height = 128;
      const g = cv.getContext("2d"), s = Math.min(im.naturalWidth, im.naturalHeight);
      g.imageSmoothingQuality = "high";
      g.drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, 128, 128);
      cv.toBlob(b => b ? res(b) : rej(new Error("png")), "image/png");
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("img")); };
    im.src = url;
  });
}
const badgeKey = name => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "badge";
  return slug + "-" + Math.random().toString(36).slice(2, 6);
};
$("bdCreate").addEventListener("click", async () => {
  const sb = getSB(); if (!sb || !isOwner()) return;
  const name = $("bdName").value.trim();
  if (!name || name.length > 30) return bdMsg("Give the badge a name (up to 30 characters).", true);
  if (!BD.file) return bdMsg("Choose a picture for the badge.", true);
  const b = $("bdCreate"); b.disabled = true; bdMsg("Making the badge…");
  let path = "";
  try {
    const key = badgeKey(name), blob = await badgePng(BD.file);
    path = key + ".png";
    const up = await sb.storage.from("badges").upload(path, blob, { contentType: "image/png", upsert: false });
    if (up.error) throw up.error;
    const image = sb.storage.from("badges").getPublicUrl(path).data.publicUrl;
    const r = await sb.from("badge_defs").insert({ key, name, image, can_ugc: $("bdUgc").checked, can_edit_items: $("bdEdit").checked });
    if (r.error) throw r.error;
    BD.file = null; $("bdName").value = ""; $("bdUgc").checked = $("bdEdit").checked = false; $("bdPick").classList.remove("has"); $("bdPrev").removeAttribute("src");
    bdMsg("Made “" + name + "”. Give it to players from the list above.");
    await loadBadgeDefs(); renderBadgeAdmin(); renderOwner();
  } catch (e) {
    if (path) { try { await sb.storage.from("badges").remove([path]); } catch (_) {} }
    bdMsg("Couldn't make the badge. Run supabase_schema.sql in Supabase once. (" + String(e && e.message || "").slice(0, 80) + ")", true);
  }
  b.disabled = false;
});

function renderBadgeAdmin() {
  const box = $("bdList"), custom = BADGE_ORDER.filter(k => !BADGE_BUILTIN.includes(k));
  box.innerHTML = custom.length ? custom.map(k => `<div class="bdItem box" data-bk="${esc(k)}"><img alt="" src="${esc(BADGE_IMG[k])}"><b>${esc(BADGES[k])}</b>
    <label class="chk"><input type="checkbox" data-perm="can_ugc"${BADGE_PERMS[k] && BADGE_PERMS[k].can_ugc ? " checked" : ""}> UGC</label>
    <label class="chk"><input type="checkbox" data-perm="can_edit_items"${BADGE_PERMS[k] && BADGE_PERMS[k].can_edit_items ? " checked" : ""}> Edit items</label>
    <button type="button" class="btnG" data-bdel="1">Delete</button></div>`).join("")
    : '<div class="note">No custom badges yet. Make one above.</div>';
}
$("bdList").addEventListener("change", async e => {
  const cb = e.target.closest("[data-perm]"); if (!cb || !isOwner()) return;
  const k = cb.closest("[data-bk]").dataset.bk, sb = getSB(); cb.disabled = true;
  try {
    const r = await sb.from("badge_defs").update({ [cb.dataset.perm]: cb.checked }).eq("key", k);
    if (r.error) throw r.error;
    bdMsg("Saved.");
  } catch (_) { cb.checked = !cb.checked; bdMsg("Couldn't change that. Run supabase_schema.sql in Supabase once.", true); }
  cb.disabled = false; await loadBadgeDefs(); updateUgcBtn();
});
$("bdList").addEventListener("click", async e => {
  const del = e.target.closest("[data-bdel]"); if (!del || !isOwner()) return;
  const k = del.closest("[data-bk]").dataset.bk, sb = getSB();
  if (!(await uiConfirm("Delete the “" + (BADGES[k] || k) + "” badge? Everyone who has it loses it.", "Delete", true))) return;
  del.disabled = true;
  try {
    const a = await sb.from("badges").delete().eq("badge", k); if (a.error) throw a.error;
    const r = await sb.from("badge_defs").delete().eq("key", k); if (r.error) throw r.error;
    const m = String(BADGE_IMG[k] || "").split("/badges/")[1];
    if (m) { try { await sb.storage.from("badges").remove([m.split("?")[0]]); } catch (_) {} }
    bdMsg("Deleted.");
  } catch (_) { bdMsg("Couldn't delete that badge.", true); }
  await loadBadgeDefs(); renderBadgeAdmin(); renderOwner();
});

/* ---- Catalog: add the built-in faces (the old ones + the new ones) as Catalog items ---- */
const fcMsg = (t, bad) => { const n = $("fcMsg"); n.textContent = t || ""; n.style.color = bad ? "#ff7a6b" : ""; };
$("fcImport").addEventListener("click", async () => {
  const sb = getSB(); if (!sb || !isOwner() || !acct.user) return;
  const b = $("fcImport"); b.disabled = true; fcMsg("Adding faces…");
  try {
    const meta = await sb.from("face_meta").select("face_no"); if (meta.error) throw meta.error;
    const have = new Set((meta.data || []).map(x => x.face_no)); let added = 0;
    for (const f of FACE_BUILTIN) {
      if (have.has(f.no)) continue;
      const id = crypto.randomUUID(), image = "assets/faces/" + f.file;
      const a = await sb.from("ugc_items").insert({ id, name: f.name, attach: "Face", file_path: image, pos: [0, 0, 0], rot: [0, 0, 0], scale: 1,
        creator: acct.user.id, price: f.price, published: true, published_at: new Date().toISOString(), description: f.desc });
      if (a.error) throw a.error;
      const m = await sb.from("face_meta").insert({ item_id: id, face_no: f.no, image });
      if (m.error) { await sb.from("ugc_items").delete().eq("id", id); throw m.error; }
      added++;
    }
    const g = await sb.rpc("owner_grandfather_faces");
    await loadFaceMeta(true);
    fcMsg(added ? "Added " + added + " face" + (added === 1 ? "" : "s") + " to the Catalog." + (g.error ? "" : " " + (g.data || 0) + " players kept the face they already had.")
                 : "All the built-in faces are already in the Catalog." + (g.error ? "" : " (" + (g.data || 0) + " players re-checked.)"));
  } catch (e) { fcMsg("Couldn't add them. Run supabase_schema.sql in Supabase once. (" + String(e && e.message || "").slice(0, 100) + ")", true); }
  b.disabled = false;
});

;

/* ---- js/social/owner-catalog.js ---- */
"use strict";

/* ---- Owner page: upload new faces into the Catalog, and edit the name / description / price of any Catalog item ----
   Works for anyone with the Owner badge (not just one account). The server checks it too (supabase_schema.sql). ---- */
const FU = { file: null, prevUrl: "" };
const fuMsg = (t, bad) => { const n = $("fcMsg"); n.textContent = t || ""; n.style.color = bad ? "#ff7a6b" : ""; };
for (const id of ["fcNew", "oiList"]) $(id).addEventListener("keydown", e => e.stopPropagation());
$("oiSearch").addEventListener("keydown", e => e.stopPropagation());

$("fcFile").addEventListener("change", () => {
  const f = $("fcFile").files && $("fcFile").files[0]; $("fcFile").value = "";
  if (!f) return;
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return fuMsg("Pick a PNG, JPG or WebP picture.", true);
  if (f.size > 4 * 1024 * 1024) return fuMsg("That picture is too big (4 MB max).", true);
  FU.file = f; fuMsg("");
  if (FU.prevUrl) URL.revokeObjectURL(FU.prevUrl);
  FU.prevUrl = URL.createObjectURL(f); $("fcPrev").src = FU.prevUrl; $("fcPick").classList.add("has");
});
function facePng(file) {                                           // any picture -> a 256x256 PNG (transparent areas stay transparent)
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      const cv = document.createElement("canvas"); cv.width = cv.height = 256;
      const g = cv.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(im, 0, 0, 256, 256);
      cv.toBlob(b => b ? res(b) : rej(new Error("png")), "image/png");
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("img")); };
    im.src = url;
  });
}
$("fcUpload").addEventListener("click", async () => {
  const sb = getSB(); if (!sb || !isOwner() || !acct.user) return;
  const name = $("fcName").value.trim(), desc = $("fcDesc").value.trim().slice(0, 600), price = Math.floor(+$("fcPrice").value);
  if (!name || name.length > 40) return fuMsg("Give the face a name (up to 40 characters).", true);
  if (!(price >= 0 && price <= 1000000)) return fuMsg("Price: 0 to 1,000,000.", true);
  if (!FU.file) return fuMsg("Choose a picture for the face.", true);
  const b = $("fcUpload"); b.disabled = true; fuMsg("Uploading the face…");
  let path = "", id = "";
  try {
    await loadFaceMeta(true);
    const blob = await facePng(FU.file);
    id = crypto.randomUUID(); path = acct.user.id + "/face-" + id + ".png";
    const up = await sb.storage.from("ugc").upload(path, blob, { contentType: "image/png", upsert: false });
    if (up.error) throw up.error;
    const a = await sb.from("ugc_items").insert({ id, name, attach: "Face", file_path: path, pos: [0, 0, 0], rot: [0, 0, 0], scale: 1,
      creator: acct.user.id, price, published: true, published_at: new Date().toISOString(), description: desc });
    if (a.error) throw a.error;
    let no = Math.max(FACE_BUILTIN.reduce((m, f) => Math.max(m, f.no), 0), ...FM.byNo.keys()) + 1, ok = false, last = null;
    for (let i = 0; i < 4 && !ok; i++, no++) {                       // another owner may take the number at the same moment: try the next one
      const m = await sb.from("face_meta").insert({ item_id: id, face_no: no, image: path });
      if (!m.error) { ok = true; break; }
      last = m.error;
      if (!/duplicate|unique|23505/i.test(String(m.error.message || "") + String(m.error.code || ""))) break;
    }
    if (!ok) { await sb.from("ugc_items").delete().eq("id", id); throw last || new Error("face_meta"); }
    await loadFaceMeta(true);
    FU.file = null; $("fcName").value = ""; $("fcDesc").value = ""; $("fcPrice").value = "0"; $("fcPick").classList.remove("has"); $("fcPrev").removeAttribute("src");
    fuMsg("Uploaded “" + name + "”. It's in the Catalog now.");
    if (typeof renderOwnerItems === "function") renderOwnerItems();
  } catch (e) {
    if (path) { try { await sb.storage.from("ugc").remove([path]); } catch (_) {} }
    fuMsg("Couldn't upload the face. Run supabase_schema.sql in Supabase once. (" + String(e && e.message || "").slice(0, 90) + ")", true);
  }
  b.disabled = false;
});

/* ---- edit any Catalog item (items, clothes and faces) ---- */
const OI = { q: "", t: 0, rows: new Map() };
const oiMsg = (t, bad) => { const n = $("oiMsg"); n.textContent = t || ""; n.style.color = bad ? "#ff7a6b" : ""; };
$("oiSearch").addEventListener("input", () => {
  clearTimeout(OI.t);
  OI.t = setTimeout(() => { OI.q = $("oiSearch").value.trim().replace(/[%_,()*\\]/g, ""); renderOwnerItems(); }, 250);
});
function oiRow(it) {
  const id = esc(it.id);
  return `<div class="owGame owItem box" data-oid="${id}">
    <div class="owHead"><b>${esc(slotName(it.attach))}</b><span class="note">${it.published === false ? "Off sale" : "On sale"}</span></div>
    <label class="owLbl">Name<input type="text" data-of="name" maxlength="40" value="${esc(it.name)}" autocomplete="off" spellcheck="false"></label>
    <label class="owLbl">Description<textarea data-of="desc" maxlength="600" rows="2" spellcheck="false">${esc(it.description || "")}</textarea></label>
    <div class="owRow2"><label class="owLbl">Price in Shapes (0 = free)<input type="number" data-of="price" min="0" max="1000000" step="1" value="${Math.max(0, Math.floor(+it.price || 0))}"></label>
    <label class="chk" style="align-self:flex-end;padding-bottom:9px"><input type="checkbox" data-of="sale"${it.published !== false ? " checked" : ""}> On sale</label></div>
    <div class="owBtnRow"><button type="button" class="btnP" data-osave="1">Save</button></div></div>`;
}
async function renderOwnerItems() {
  if (!isOwner() || !hasBadgePerm("can_edit_items")) return;
  const sb = getSB(); if (!sb) return;
  oiMsg("Loading…");
  try {
    let q = sb.from("ugc_items").select("id, name, attach, price, published, description");
    if (OI.q) q = q.ilike("name", "%" + OI.q + "%");
    const r = await q.order("created_at", { ascending: false }).limit(40);
    if (r.error) throw r.error;
    OI.rows.clear(); for (const it of (r.data || [])) OI.rows.set(it.id, it);
    $("oiList").innerHTML = (r.data || []).map(oiRow).join("");
    oiMsg((r.data || []).length ? (OI.q ? "" : "Newest items first. Search to find a specific one.") : "No items found.");
  } catch (e) { oiMsg("Couldn't load items. Run supabase_schema.sql in Supabase once.", true); }
}
$("oiList").addEventListener("click", async e => {
  const btn = e.target.closest("[data-osave]"); if (!btn || !isOwner()) return;
  const box = btn.closest("[data-oid]"), id = box.dataset.oid, sb = getSB(); if (!sb) return;
  const name = box.querySelector('[data-of="name"]').value.trim(), desc = box.querySelector('[data-of="desc"]').value.trim().slice(0, 600);
  const price = Math.floor(+box.querySelector('[data-of="price"]').value), on = box.querySelector('[data-of="sale"]').checked;
  if (!name || name.length > 40) return oiMsg("Give it a name (up to 40 characters).", true);
  if (!(price >= 0 && price <= 1000000)) return oiMsg("Price: 0 to 1,000,000.", true);
  btn.disabled = true; oiMsg("Saving…");
  try {
    const r = await sb.rpc("owner_update_item", { p_item: id, p_name: name, p_desc: desc, p_price: price, p_published: on });
    if (r.error) throw r.error;
    const patch = { name, price, published: on }, it = OI.rows.get(id);
    if (it) Object.assign(it, patch, { description: desc });
    const c = ITM.rows.get(id); if (c) Object.assign(c, patch);
    const s = SHOP.rows.find(x => x.id === id); if (s) Object.assign(s, patch);
    ITM.thumbs.clear();
    box.querySelector(".owHead .note").textContent = on ? "On sale" : "Off sale";
    oiMsg("Saved “" + name + "”.");
  } catch (err) { oiMsg(typeof ioErr === "function" ? ioErr(err) : "Couldn't save that item.", true); }
  btn.disabled = false;
});

;

/* ---- js/social/owner-panel.js ---- */
"use strict";

/* ---- Owner panel: the little menu that switches between Players / Badges / Catalog / Games ---- */
(function () {
  const nav = $("opNav"); if (!nav) return;
  function show(name) {
    for (const b of nav.querySelectorAll("button")) b.classList.toggle("on", b.dataset.op === name);
    for (const p of document.querySelectorAll("#tabOwner .opPanel")) p.hidden = p.dataset.oppanel !== name;
    try { sessionStorage.setItem("triangle_op", name); } catch (_) {}
  }
  nav.addEventListener("click", e => { const b = e.target.closest("[data-op]"); if (b) show(b.dataset.op); });
  let saved = "players"; try { saved = sessionStorage.getItem("triangle_op") || "players"; } catch (_) {}
  show(nav.querySelector(`[data-op="${saved}"]`) ? saved : "players");
})();

;

/* ---- js/core/updater.js ---- */
"use strict";

/* ---- One copy at a time + automatic updates ----
   1. Only one Triancle tab/window per browser can be open: extra ones are blocked until the first is closed.
   2. A signed-in account can only play in one place at once (another browser, a phone, the desktop app...): needs supabase_schema.sql.
   3. When the site is updated, the website refreshes itself; the desktop app shows a box asking to restart. */
(function () {
  const IN_APP = !!(window.TriancleApp && window.TriancleApp.isApp);
  /* Stable for the life of this browser tab: a reload reuses it, so reloading while playing
     no longer looks like a second session in another window. */
  const TAB_ID = (function () {
    try {
      let v = sessionStorage.getItem("triancle_tab_id");
      if (!v) {
        v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "t" + Math.random().toString(36).slice(2) + Date.now();
        sessionStorage.setItem("triancle_tab_id", v);
      }
      return v;
    } catch (_) {
      return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "t" + Math.random().toString(36).slice(2) + Date.now();
    }
  })();
  const st = document.createElement("style");
  st.textContent = `#blockBox{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(8,6,3,.94);font-family:"Capriola",system-ui,sans-serif}
#blockBox.on{display:flex}
#blockBox .bbCard{width:100%;max-width:480px;box-sizing:border-box;padding:34px 30px 28px;text-align:center;background:#1b1710;border:1px solid #3a3322;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.6);color:#fff}
#blockBox img{width:84px;height:84px;margin:0 auto 12px;display:block}
#blockBox h2{margin:0 0 10px;font-size:28px;font-weight:400;color:#ffbf2f}
#blockBox p{margin:0 0 20px;font-size:17px;line-height:1.5;color:#d9cfb6}
#blockBox button{padding:12px 34px;border:0;border-radius:10px;background:#ffbf2f;color:#1a1203;font:inherit;font-size:19px;cursor:pointer}
#blockBox button:hover{background:#ffd25e}`;
  document.head.appendChild(st);
  const box = document.createElement("div"); box.id = "blockBox";
  box.innerHTML = '<div class="bbCard"><img alt="" src="assets/img/app-icon.png"><h2></h2><p></p><button type="button" hidden></button></div>';
  document.body.appendChild(box);
  const bh = box.querySelector("h2"), bp = box.querySelector("p"), bb = box.querySelector("button");
  let reason = null, btnFn = null;
  function block(why, title, text, label, fn) {
    reason = why; bh.textContent = title; bp.textContent = text; btnFn = fn || null;
    bb.hidden = !label; bb.textContent = label || ""; box.classList.add("on");
    try { document.exitPointerLock(); } catch (_) {}
  }
  function unblock(why) { if (reason === why) { reason = null; box.classList.remove("on"); } }
  bb.addEventListener("click", () => { if (btnFn) btnFn(); });
  for (const t of ["keydown", "keyup", "wheel", "mousemove", "mousedown", "pointerdown", "contextmenu"])        // nothing reaches the game while a box is up
    window.addEventListener(t, e => { if (reason && !box.contains(e.target)) { e.stopImmediatePropagation(); if (t !== "mousemove" && t !== "wheel") e.preventDefault(); } }, true);

  /* ---------- 1. one tab / window per browser ---------- */
  const KEY = "triancle_open_tab", since = Date.now();
  const readTab = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && Date.now() - v.t < 3500 ? v : null; } catch (_) { return null; } };
  const writeTab = () => { try { localStorage.setItem(KEY, JSON.stringify({ id: TAB_ID, since, t: Date.now() })); } catch (_) {} };
  function tabBeat() {
    const v = readTab();
    if (!v || v.id === TAB_ID) { writeTab(); unblock("tab"); return; }
    if (reason === "tab" || v.since < since || (v.since === since && v.id < TAB_ID)) {            // the older window keeps playing
      block("tab", "Triancle is already open", "Triancle is open in another tab or window. Close that one, or close this one, to keep playing.");
    } else writeTab();
  }
  tabBeat(); setInterval(tabBeat, 1000);
  window.addEventListener("storage", e => { if (e.key === KEY) tabBeat(); });
  window.addEventListener("pagehide", () => { const v = readTab(); if (v && v.id === TAB_ID) { try { localStorage.removeItem(KEY); } catch (_) {} } });

  /* ---------- 2. one place per account ---------- */
  let sessionOff = false, lastUser = null;
  const playingHere = () => { try { return typeof inGame !== "undefined" && !!inGame; } catch (_) { return false; } };
  async function sessionBeat() {
    const sb = typeof getSB === "function" ? getSB() : null, u = typeof acct !== "undefined" && acct.user;
    if (!sb || sessionOff) return;
    if (!u || !playingHere()) {                        // browsing the site is not "playing": only claim while in a game
      if (lastUser) { try { await sb.rpc("release_play_session", { p_sid: TAB_ID }); } catch (_) {} lastUser = null; }
      unblock("acct"); return;
    }
    lastUser = u.id;
    try {
      const r = await sb.rpc("claim_play_session", { p_sid: TAB_ID });
      if (r.error) { sessionOff = true; unblock("acct"); return; }                              // not set up in Supabase yet: don't lock anyone out
      if (r.data === false) block("acct", "Already playing somewhere else", "This account is playing in another window, browser or device. Close it there, and this will continue by itself.");
      else unblock("acct");
    } catch (_) {}
  }
  setInterval(sessionBeat, 4000); setTimeout(sessionBeat, 1200);
  window.addEventListener("pagehide", () => { const sb = typeof getSB === "function" ? getSB() : null; if (sb && lastUser) { try { sb.rpc("release_play_session", { p_sid: TAB_ID }); } catch (_) {} } });

  /* ---------- 3. updates ---------- */
  const FILES = ["index.html", "js/game.bundle.js", "css/style.css"];
  async function sigOf(url) {
    try {
      const r = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (!r.ok) return "";
      const s = [r.headers.get("etag"), r.headers.get("last-modified"), r.headers.get("content-length")].filter(Boolean).join("|");
      if (s) return s;
      const t = await (await fetch(url, { cache: "no-store" })).text(); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
      return t.length + ":" + h;
    } catch (_) { return ""; }
  }
  const siteSig = async () => (await Promise.all(FILES.map(sigOf))).join("#");
  let base = null, shown = false;
  async function checkUpdate() {
    if (shown || !/^https?:$/.test(location.protocol)) return;
    const now = await siteSig(); if (!now || /^#*$/.test(now)) return;
    if (base === null) { base = now; return; }
    if (now === base) return;
    await new Promise(r => setTimeout(r, 4000));                                                 // a deploy may still be rolling out: confirm once
    if ((await siteSig()) !== now) return;
    if (IN_APP) {
      shown = true;
      block("update", "Restart Triancle for the new update", "A new version of Triancle is ready. Close the app and open it again to get it.", "Close",
        () => { try { if (window.TriancleApp && TriancleApp.quit) TriancleApp.quit(); else window.close(); } catch (_) { window.close(); } });
    } else {
      let last = 0; try { last = +sessionStorage.getItem("triancle_reload") || 0; } catch (_) {}
      if (Date.now() - last < 20000) { base = now; return; }                                     // never loop
      try { sessionStorage.setItem("triancle_reload", String(Date.now())); } catch (_) {}
      shown = true; location.reload();
    }
  }
  setTimeout(checkUpdate, 3000); setInterval(checkUpdate, 45000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(); });
  window.addEventListener("online", checkUpdate);
})();

;

/* ---- js/items/ugc.js ---- */
"use strict";

/* =====================================================================
   UGC: upload a GLB, place it on the player template, save it as an item
   (Owner or Official UGC Creator badge)
   ===================================================================== */
var ugOn = false, ugRun = false;
const UGC_ROLES = ["ugc"];
const UG_SLOTS = [["Head", "Head (hat)"], ["Torso", "Torso"], ["LeftArm", "Left arm"], ["RightArm", "Right arm"], ["LeftLeg", "Left leg"], ["RightLeg", "Right leg"]];
const UG_ANCHOR = { Head: [0, 5.05, 0], Torso: [0, 3, 0], LeftArm: [0, 3, -1.5], RightArm: [0, 3, 1.5], LeftLeg: [0, 1, -0.5], RightLeg: [0, 1, 0.5] };
const UG_VIEW = { Head: [4.6, 8], Torso: [3, 12], LeftArm: [3, 12], RightArm: [3, 12], LeftLeg: [1.4, 12], RightLeg: [1.4, 12], Shirt: [3, 10], Pants: [2, 10], Face: [4.6, 4.6] };
const CLOTH_SLOTS = [["Shirt", "Shirt"], ["Pants", "Pants"]];       // clothes: a PNG on the 512x512 template instead of a GLB
const isCloth = a => { if (window.TriancleRust && window.TriancleRust.itemKind) { const kind = window.TriancleRust.itemKind(a); if (kind !== null) return kind === 1; } return a === "Shirt" || a === "Pants"; };
const UG_KINDS = [["model", "3D accessory (GLB)"], ["Shirt", "Shirt (PNG)"], ["Pants", "Pants (PNG)"]];
const UG_DEFS = [["pos", 0, "Forward / back", -4, 4, 0.01], ["pos", 1, "Up / down", -4, 4, 0.01], ["pos", 2, "Left / right", -4, 4, 0.01],
  ["rot", 0, "Roll", -180, 180, 1], ["rot", 1, "Turn", -180, 180, 1], ["rot", 2, "Tilt", -180, 180, 1], ["scale", 0, "Size", 0.05, 5, 0.01]];
function canUgc() {
  try { if (!acct.user) return false; const value = rustPermission("can_ugc"); if (value !== null) return value; if (isOwner()) return true; return badgeList(acct.user.id).some(k => UGC_ROLES.includes(k)) || hasBadgePerm("can_ugc"); } catch (_) { return false; }
}
function updateUgcBtn() { $("ugcTabBtn").hidden = !canUgc(); }

const UG = { name: "", attach: "Head", pos: [0, 0, 0], rot: [0, 0, 0], scale: 1, file: null, path: null, editId: null, price: 50, livePrice: 0, sale: true, busy: false, published: false, holder: null, inner: null, k: 1, c: null, min: null, mode: "view", cloth: null };
const ugv = (function () {
  let r;
  try { r = new THREE.WebGLRenderer({ canvas: $("ugCv"), antialias: true, alpha: true }); } catch (_) { return null; }
  if (renderer.outputEncoding !== undefined) r.outputEncoding = renderer.outputEncoding;
  if (renderer.outputColorSpace !== undefined) r.outputColorSpace = renderer.outputColorSpace;
  r.toneMapping = renderer.toneMapping; r.toneMappingExposure = renderer.toneMappingExposure;
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200), av = createAvatar();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(4, 8, 6); sc.add(dl);
  av.group.rotation.y = -Math.PI / 2; sc.add(av.group);
  return { r, sc, cam, av, sig: "", yaw: 0, pitch: 0.12, dist: 8, ty: 4.6 };
})();
const ugMsg = (t, bad) => { $("ugMsg").textContent = t || ""; $("ugMsg").style.color = bad ? "#ff7a6b" : ""; };
const ugClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ugGet = d => d[0] === "scale" ? UG.scale : UG[d[0]][d[1]];
function ugSet(d, v) { v = ugClamp(+v || 0, d[3], d[4]); if (d[0] === "scale") UG.scale = v; else UG[d[0]][d[1]] = v; }

(function buildUgcUI() { try {
  $("ugKinds").addEventListener("click", e => {
    const b = e.target.closest("[data-k]"); if (!b) return;
    if (b.dataset.k !== (isCloth(UG.attach) ? UG.attach : "model")) ugClear(b.dataset.k);
  });
  $("ugTpl").addEventListener("click", e => {                        // template downloads: normal / transparent / labelled guide
    const b = e.target.closest("[data-tpl]"); if (!b || !isCloth(UG.attach)) return;
    const a = document.createElement("a"); a.href = "assets/templates/" + UG.attach.toLowerCase() + "-" + b.dataset.tpl + ".png";
    a.download = UG.attach.toLowerCase() + "-" + b.dataset.tpl + ".png"; document.body.appendChild(a); a.click(); a.remove();
  });
  const sel = $("ugAttach");
  for (const [k, l] of UG_SLOTS) { const o = document.createElement("option"); o.value = k; o.textContent = l; sel.appendChild(o); }
  const box = $("ugSliders");
  UG_DEFS.forEach((d, i) => {
    const row = document.createElement("div"); row.className = "ugS"; row.dataset.i = i;
    row.innerHTML = `<span>${d[2]}</span><input type="range" min="${d[3]}" max="${d[4]}" step="${d[5]}"><input type="number" min="${d[3]}" max="${d[4]}" step="${d[5]}">`;
    const rg = row.children[1], nm = row.children[2];
    rg.addEventListener("input", () => { ugSet(d, rg.value); ugSync(); ugApply(); });
    nm.addEventListener("input", () => { if (nm.value === "" || nm.value === "-") return; ugSet(d, nm.value); ugSync(nm); ugApply(); });
    box.appendChild(row);
  });
  $("ugPanel").addEventListener("keydown", e => e.stopPropagation());
  sel.addEventListener("change", () => { UG.attach = sel.value; UG.pos = [0, 0, 0]; ugView(); ugSync(); ugApply(); });
  $("ugName").addEventListener("input", () => { UG.name = $("ugName").value; ugFeeNote(); });
  $("ugPick").addEventListener("click", () => $("ugFile").click());
  $("ugFile").addEventListener("change", async () => {
    const f = $("ugFile").files[0]; $("ugFile").value = ""; if (!f) return;
    if (isCloth(UG.attach)) return ugPickCloth(f);
    if (!/\.glb$/i.test(f.name)) return ugMsg("That isn't a .glb file.", true);
    if (f.size > 10 * 1024 * 1024) return ugMsg("That file is over 10 MB.", true);
    ugMsg("Loading…");
    try {
      await ugLoad(await f.arrayBuffer(), f.name);
      UG.file = f;
      if (!UG.name.trim()) { UG.name = f.name.replace(/\.glb$/i, "").slice(0, 40); $("ugName").value = UG.name; }
      ugMsg(""); ugFeeNote();
    } catch (e) { ugMsg("Couldn't read that GLB. Compressed (Draco/Meshopt) models aren't supported, so export without compression.", true); }
  });
  $("ugReset").addEventListener("click", () => { UG.pos = [0, 0, 0]; UG.rot = [0, 0, 0]; UG.scale = 1; ugSync(); ugApply(); });
  $("ugNew").addEventListener("click", () => ugClear());
  $("ugGo").addEventListener("click", ugUpload);
  for (const b of document.querySelectorAll("#ugModes button")) b.addEventListener("click", () => {
    UG.mode = b.dataset.m;
    for (const x of document.querySelectorAll("#ugModes button")) x.classList.toggle("on", x === b);
    $("ugView").classList.toggle("move", UG.mode === "move");
    $("ugHint").textContent = UG.mode === "move" ? "drag to move the item · hold Shift to push it in or out" : "drag to look around · scroll to zoom";
  });
  const vw = $("ugView"); let drag = null;
  vw.addEventListener("pointerdown", e => { if (e.target.closest("#ugModes")) return; drag = { x: e.clientX, y: e.clientY }; vw.setPointerCapture(e.pointerId); });
  vw.addEventListener("pointermove", e => {
    if (!drag || !ugv) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
    if (UG.mode === "move" && UG.holder) ugMove(dx, dy, e.shiftKey);
    else { ugv.yaw -= dx * 0.01; ugv.pitch = ugClamp(ugv.pitch + dy * 0.006, -1.2, 1.2); }
  });
  const end = () => { drag = null; }; vw.addEventListener("pointerup", end); vw.addEventListener("pointercancel", end);
  vw.addEventListener("wheel", e => { e.preventDefault(); if (ugv) ugv.dist = ugClamp(ugv.dist * Math.exp(e.deltaY * 0.001), 2.5, 30); }, { passive: false });
  ugSync();
  } catch (e) { console.error("UGC panel failed to start", e); }
})();

function ugKindUI() {
  const c = isCloth(UG.attach);
  for (const b of document.querySelectorAll("#ugKinds button")) b.classList.toggle("on", b.dataset.k === (c ? UG.attach : "model"));
  $("ugSliders").hidden = c; $("ugAttachLbl").hidden = c; $("ugModes").hidden = c; $("ugReset").hidden = c; $("ugTpl").hidden = !c;
  $("ugPick").textContent = c ? "Choose image" : "Choose GLB file"; $("ugFile").accept = c ? ".png,image/png" : ".glb,model/gltf-binary";
  if (c && UG.mode === "move") { const b = document.querySelector('#ugModes button[data-m="view"]'); if (b) b.click(); }
}
async function ugPickCloth(f) {
  if (!/\.png$/i.test(f.name)) return ugMsg("That isn't a .png file.", true);
  if (f.size > 2 * 1024 * 1024) return ugMsg("That file is over 2 MB.", true);
  ugMsg("Loading…");
  try {
    UG.cloth = await clothFromBuffer(await f.arrayBuffer()); UG.file = f;
    if (!UG.name.trim()) { UG.name = f.name.replace(/\.png$/i, "").slice(0, 40); $("ugName").value = UG.name; }
    $("ugInfo").textContent = f.name; ugMsg(""); ugApply(); ugSync();
  } catch (e) {
    ugMsg(e && e.message === "shape" ? "That image isn't the right shape. Download a template and keep its size (512 × 512)." : "Couldn't read that PNG.", true);
  }
}
function ugClothApply() {
  if (UG.holder && UG.holder.parent) UG.holder.parent.remove(UG.holder);
  ugv.clothOn = true;
  setAvatarCloth(ugv.av, UG.attach === "Shirt" ? UG.cloth : null, UG.attach === "Pants" ? UG.cloth : null);
}
function ugSync(skip) {
  ugKindUI();
  for (const row of $("ugSliders").children) {
    const d = UG_DEFS[+row.dataset.i], v = ugGet(d);
    row.children[1].value = v;
    if (row.children[2] !== skip && document.activeElement !== row.children[2]) row.children[2].value = Math.round(v * 100) / 100;
  }
  if (!isCloth(UG.attach)) $("ugAttach").value = UG.attach; if (document.activeElement !== $("ugName")) $("ugName").value = UG.name;
  if (document.activeElement !== $("ugPrice")) $("ugPrice").value = UG.price;
  $("ugPriceLbl").textContent = "Price (min " + fmtN(minPrice(UG.attach)) + ")"; $("ugPrice").min = minPrice(UG.attach);
  $("ugOnSale").checked = UG.sale; $("ugPriceBox").hidden = !UG.sale;
  ugFeeNote();
}
function ugView() { if (ugv) { const v = UG_VIEW[UG.attach]; ugv.ty = v[0]; ugv.dist = v[1]; } }
function ugApply() {
  if (!ugv) return;
  if (isCloth(UG.attach)) return ugClothApply();
  if (ugv.clothOn) { ugv.clothOn = false; setAvatarCloth(ugv.av, null, null); }
  if (!UG.holder) return;
  const pv = ugv.av.rig[UG.attach], pp = MODEL_PARTS[UG.attach].pivot, an = UG_ANCHOR[UG.attach], h = UG.holder, rad = Math.PI / 180;
  if (h.parent !== pv) pv.add(h);
  const rust = window.TriancleRust, position = rust && rust.itemPosition || ((a, p, v) => a - p + v);
  h.position.set(position(an[0], pp[0], UG.pos[0]), position(an[1], pp[1], UG.pos[1]), position(an[2], pp[2], UG.pos[2]));
  h.rotation.set(UG.rot[0] * rad, UG.rot[1] * rad, UG.rot[2] * rad, "XYZ");
  h.scale.setScalar(UG.scale);
  const center = rust && rust.itemCenter || ((c, m, k, headY) => (headY ? -m : -c) * k);
  UG.inner.position.set(center(UG.c.x, 0, UG.k, false), center(UG.c.y, UG.attach === "Head" ? UG.min.y : 0, UG.k, UG.attach === "Head"), center(UG.c.z, 0, UG.k, false));
}
function ugMove(dx, dy, depth) {
  const cam = ugv.cam, hpx = ugv.r.domElement.clientHeight || 400, k = 2 * ugv.dist * Math.tan(cam.fov * Math.PI / 360) / hpx;
  const r = new THREE.Vector3(), u = new THREE.Vector3(), f = new THREE.Vector3(); cam.matrixWorld.extractBasis(r, u, f);
  const d = depth ? f.multiplyScalar(dy * k) : r.multiplyScalar(dx * k).add(u.multiplyScalar(-dy * k));
  const pv = ugv.av.rig[UG.attach]; pv.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(pv.matrixWorld).invert(); inv.setPosition(0, 0, 0);
  const moved = window.TriancleRust && window.TriancleRust.ugcDrag ? window.TriancleRust.ugcDrag(UG.pos,d,inv.elements) : null;
  if (moved) UG.pos = moved; else { d.applyMatrix4(inv); const dd = [d.x, d.y, d.z]; UG.pos = UG.pos.map((v, i) => ugClamp(v + dd[i], -4, 4)); }
  ugSync(); ugApply();
}
function ugLoad(buf, label) {
  const u8 = new Uint8Array(buf);
  const signature = window.TriancleRust && window.TriancleRust.assetSignature ? window.TriancleRust.assetSignature(buf,"glb") : null;
  if (signature === false || (signature === null && !(u8[0] === 0x67 && u8[1] === 0x6c && u8[2] === 0x54 && u8[3] === 0x46))) return Promise.reject(new Error("not a glb"));
  return new Promise((res, rej) => new THREE.GLTFLoader().parse(buf, "", gltf => {
    try {
      if (UG.holder && UG.holder.parent) UG.holder.parent.remove(UG.holder);
      const model = gltf.scene, box = new THREE.Box3().setFromObject(model), size = new THREE.Vector3(), c = new THREE.Vector3();
      box.getSize(size); box.getCenter(c);
      const mx = Math.max(size.x, size.y, size.z) || 1;
      let tris = 0; model.traverse(o => { if (o.isMesh && o.geometry) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
      UG.k = 1.2 / mx; UG.c = c; UG.min = box.min.clone();
      UG.inner = new THREE.Group(); UG.inner.scale.setScalar(UG.k); UG.inner.add(model);
      UG.holder = new THREE.Group(); UG.holder.add(UG.inner);
      $("ugInfo").textContent = (label || "model.glb") + " · " + Math.round(tris).toLocaleString() + " triangles";
      ugApply(); res();
    } catch (e) { rej(e); }
  }, rej));
}
function ugClear(kind) {
  kind = kind || (isCloth(UG.attach) ? UG.attach : "model");
  if (UG.holder && UG.holder.parent) UG.holder.parent.remove(UG.holder);
  Object.assign(UG, { name: "", attach: kind === "model" ? "Head" : kind, pos: [0, 0, 0], rot: [0, 0, 0], scale: 1, file: null, path: null, editId: null, price: minPrice(kind === "model" ? "Head" : kind), livePrice: 0, sale: true, published: false, holder: null, inner: null, cloth: null });
  $("ugInfo").textContent = kind === "model" ? "Pick a .glb file (max 10 MB)."
    : "Pick a .png file (max 2 MB).";
  ugView(); ugSync(); ugApply(); ugMsg("");
}
async function ugUpload() {
  if (UG.busy) return;
  const sb = getSB(); if (!sb || !acct.user) return;
  if (!canUgc()) return ugMsg("Your account can't make UGC.", true);
  const name = UG.name.trim(), cloth = isCloth(UG.attach);
  const rust = window.TriancleRust, hasAsset = cloth ? !!UG.cloth : !!UG.holder;
  const rawPrice = +$("ugPrice").value || 0;
  const kind = kindOfItem(UG.attach);
  const canPlan = rust && rust.ugcUploadPlan && (typeof WAL.bal === "number" || WAL.bal == null);
  const plan = canPlan
    ? rust.ugcUploadPlan({
      has_asset: hasAsset, name, kind: kind === "cloth" ? 1 : kind === "face" ? 2 : 0,
      price: rawPrice, balance: WAL.bal, editing: !!UG.editId,
      published: !!UG.published, sale: !!UG.sale, live_price: UG.livePrice, has_file: !!UG.file
    }) : null;
  const basics = plan ? plan.error : rust && rust.ugcBasics ? rust.ugcBasics(hasAsset,!!name) : !hasAsset ? 1 : !name ? 2 : 0;
  if (basics === 1) return ugMsg(cloth ? "Choose an image first." : "Choose a GLB file first.", true);
  if (basics === 2) return ugMsg("Give the item a name.", true);
  const price = plan ? plan.price : ugClamp(Math.floor(rawPrice), 0, TAX_MAX);
  if (plan ? plan.error === 3 : UG.sale && (rust && rust.ugcPriceInvalid ? rust.ugcPriceInvalid(price,minPrice(UG.attach)) : price < minPrice(UG.attach))) return ugMsg("Lowest price: " + fmtT(minPrice(UG.attach)) + " Shapes.", true);
  UG.price = price;
  const upFee = UG.editId ? 0 : uploadFee(UG.attach), total = plan ? plan.total : ugCost();
  if (plan ? plan.error === 4 : rust && rust.ugcInsufficient && (WAL.bal == null || typeof WAL.bal === "number") ? rust.ugcInsufficient(total,WAL.bal) : total > 0 && WAL.bal != null && WAL.bal < total) return ugMsg("Not enough Shapes (" + fmtT(total) + " needed).", true);
  UG.busy = true; ugMsg(""); ugFeeNote();
  let upPath = null, saved = false;
  const wasNew = !UG.editId;
  try {
    const me = acct.user.id, id = UG.editId || (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(16).slice(2)));
    let path = UG.path, old = null;
    if (plan ? plan.upload_file : UG.file) {
      old = UG.path; path = me + "/" + id + "-" + Date.now() + (cloth ? ".png" : ".glb");
      const up = await sb.storage.from("ugc").upload(path, UG.file, { contentType: cloth ? "image/png" : "model/gltf-binary", upsert: false });
      if (up.error) throw up.error;
      upPath = path;
    }
    const row = { name, attach: UG.attach, file_path: path, pos: UG.pos, rot: UG.rot, scale: UG.scale };
    const r = UG.editId ? await sb.from("ugc_items").update(Object.assign(row, { updated_at: new Date().toISOString() })).eq("id", id)
                        : await sb.from("ugc_items").insert(Object.assign(row, { id, creator: me }));
    if (r.error) throw r.error;
    if (old && old !== path) { try { await sb.storage.from("ugc").remove([old]); } catch (_) {} }
    UG.editId = id; UG.path = path; UG.file = null; saved = true;
    // then the shop listing, in the same click
    const changed = plan ? plan.change_sale : rust && rust.ugcSaleChanged && typeof UG.livePrice === "number" ? rust.ugcSaleChanged(UG.sale,UG.published,price,UG.livePrice) : UG.sale ? (!UG.published || price !== UG.livePrice) : UG.published;
    if (changed) {
      const s = await sb.rpc("set_item_sale", { p_item: id, p_price: plan ? plan.sale_price : UG.sale ? price : UG.livePrice, p_published: plan ? plan.sale : UG.sale });
      if (s.error) { UG.busy = false; renderUgcList(); loadWallet(); if (wasNew) loadNotifs(); ugSync(); return ugMsg("Uploaded, but couldn't put it on sale: " + (feeErr(s.error, UG.attach) || "try again.") , true); }
      UG.published = plan ? plan.sale : UG.sale; if (plan ? plan.sale : UG.sale) UG.livePrice = price;
    }
    renderUgcList(); loadWallet(); if (wasNew) loadNotifs();
    if (typeof refreshWorn === "function") refreshWorn(id);
    UG.busy = false;
    if (wasNew) { ugClear(cloth ? UG.attach : "model"); ugMsg("Uploaded “" + name + "”.", false); }
    else { ugSync(); ugMsg("Updated “" + name + "”.", false); }
    return;
  } catch (e) {
    if (upPath && !saved && wasNew) { try { await sb.storage.from("ugc").remove([upPath]); } catch (_) {} }     // the upload was refused: don't leave the file behind
    if (/insufficient_funds/.test(String(e && e.message || ""))) { ugMsg("Not enough Shapes (" + fmtT(total) + " needed).", true); loadWallet(); }
    else { console.error("upload failed", e); ugMsg("Couldn't upload. Try again.", true); }
  }
  UG.busy = false; ugSync();
}
async function renderUgcList() {
  const sb = getSB(), box = $("ugList"); if (!sb || !acct.user) return;
  try {
    let r = await sb.from("ugc_items").select("id, name, attach, file_path, pos, rot, scale, published, price, sales").eq("creator", acct.user.id).neq("attach", "Face").order("created_at", { ascending: false });
    if (r.error) r = await sb.from("ugc_items").select("id, name, attach, file_path, pos, rot, scale").eq("creator", acct.user.id).order("created_at", { ascending: false });
    if (r.error) throw r.error;
    const rows = r.data || []; box._rows = rows;
    box.innerHTML = rows.length ? rows.map(it => `<div class="ugCard box" data-id="${esc(it.id)}"><b>${esc(it.name)}</b><div class="note">${esc(slotName(it.attach))}</div><div class="note ugSt">${esc(it.published ? (it.price ? Number(it.price).toLocaleString() + " Shapes" : "Free") + " · " + (it.sales || 0) + " sold" : "Not for sale")}</div><div class="ugRow"><button class="btnG" data-ug="edit" type="button">Edit model</button><button class="btnG" data-ug="page" type="button">Name, description &amp; price</button><button class="btnG" data-ug="del" type="button">Delete</button></div></div>`).join("")
      : '<div class="note">No items yet.</div>';
  } catch (_) { box.innerHTML = '<div class="note">Couldn\'t load your items. Run supabase_schema.sql in Supabase once.</div>'; }
}
$("ugList").addEventListener("click", async e => {
  const b = e.target.closest("[data-ug]"); if (!b) return;
  const id = b.closest("[data-id]").dataset.id, it = ($("ugList")._rows || []).find(x => x.id === id), sb = getSB(); if (!it || !sb) return;
  if (b.dataset.ug === "page") { ITM.rows.set(id, Object.assign({}, ITM.rows.get(id) || {}, it, { creator: acct.user.id })); return openItem(id); }                  // the item page has the name / description / price / on-sale editor
  if (b.dataset.ug === "del") {
    if ((it.sales || 0) > 0) { ugMsg("People have bought that item, so it can't be deleted. Take it off sale instead.", true); return; }
    if (!(await uiConfirm("Delete “" + it.name + "”?", "Delete", true))) return;
    try {
      const d = await sb.from("ugc_items").delete().eq("id", id).select("id");
      if (d.error) throw d.error;
      if (d.data && d.data.length) await sb.storage.from("ugc").remove([it.file_path]);
    } catch (_) { ugMsg("Couldn't delete that item. Someone may own it.", true); return renderUgcList(); }
    if (UG.editId === id) ugClear();
    return renderUgcList();
  }
  ugMsg("Loading…");
  try {
    const url = sb.storage.from("ugc").getPublicUrl(it.file_path).data.publicUrl, resp = await fetch(url);
    if (!resp.ok) throw new Error("fetch");
    const buf = await resp.arrayBuffer();
    if (isCloth(it.attach)) {
      const cv = await clothFromBuffer(buf);
      if (UG.holder && UG.holder.parent) UG.holder.parent.remove(UG.holder);
      UG.holder = null; UG.inner = null; UG.cloth = cv; $("ugInfo").textContent = it.name + ".png";
    } else { await ugLoad(buf, it.name + ".glb"); UG.cloth = null; }
    Object.assign(UG, { name: it.name, attach: it.attach, pos: (it.pos || [0, 0, 0]).slice(), rot: (it.rot || [0, 0, 0]).slice(), scale: +it.scale || 1, file: null, path: it.file_path, editId: it.id, price: +it.price || minPrice(it.attach), livePrice: +it.price || 0, sale: !!it.published, published: !!it.published });
    ugView(); ugSync(); ugApply(); ugMsg("Editing “" + it.name + "”.");
  } catch (_) { ugMsg("Couldn't load that item's file.", true); }
});
function ugStart() {
  renderUgcList(); ugView(); ugSync(); ugApply();
  if (ugv && !ugRun) { ugRun = true; requestAnimationFrame(ugLoop); }
}
function ugLoop() {
  if (!ugOn || !ugv || inGame) { ugRun = false; return; }
  requestAnimationFrame(ugLoop);
  const cv = ugv.r.domElement, w = cv.clientWidth, h = cv.clientHeight, pr = Math.min(window.devicePixelRatio || 1, 2);
  if (w && (cv.width !== Math.round(w * pr) || cv.height !== Math.round(h * pr))) { ugv.r.setPixelRatio(pr); ugv.r.setSize(w, h, false); ugv.cam.aspect = w / h; ugv.cam.updateProjectionMatrix(); }
  const sig = colorSig(myColors); if (sig !== ugv.sig) { ugv.sig = sig; setAvatarColors(ugv.av, myColors); }
  const cp = Math.cos(ugv.pitch);
  ugv.cam.position.set(Math.sin(ugv.yaw) * cp * ugv.dist, ugv.ty + Math.sin(ugv.pitch) * ugv.dist, Math.cos(ugv.yaw) * cp * ugv.dist);
  ugv.cam.lookAt(0, ugv.ty, 0);
  ugv.r.render(ugv.sc, ugv.cam);
}

;

/* ---- js/items/wallet.js ---- */
"use strict";

/* =====================================================================
   TRIANGCLES: wallet, Shop, buying, and wearing UGC items
   Everything that moves money runs in Supabase (see supabase_schema.sql):
   get_wallet(), buy_ugc_item(), set_ugc_equipped(), ugc_items_by_ids().
   ===================================================================== */
const TRI_SVG = '<img class="tcI" src="assets/img/shapes.png" alt="">';
const fmtT = n => Number(n || 0).toLocaleString();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validItemId(value) { if (window.TriancleRust && window.TriancleRust.validItemId) { const ok = window.TriancleRust.validItemId(value); if (ok !== null) return ok; } return UUID_RE.test(value); }
const MAX_WORN = 6;
const SQL_HINT = "Run supabase_schema.sql in Supabase once.";
const ITM = { models: new Map(), thumbs: new Map(), rows: new Map(), q: Promise.resolve() };
const WAL = { bal: null };
const INV = { owned: new Set(), ok: true, loaded: false };
const SHOP = { rows: [], busy: false };
const slotName = k => (UG_SLOTS.concat(CLOTH_SLOTS, [["Face", "Face"]]).find(x => x[0] === k) || [0, k])[1];
const arr3 = a => (Array.isArray(a) && a.length === 3) ? a.map(x => +x || 0) : [0, 0, 0];

/* ---- wallet ---- */
function walletUI() {
  const on = WAL.bal != null && !!acct.user;
  $("hBal").hidden = !on; $("shBalBox").hidden = !on;
  if (on) { $("hBalN").textContent = fmtT(WAL.bal); $("shBalN").textContent = fmtT(WAL.bal); }
}
async function loadWallet() {
  const sb = getSB(); if (!sb || !acct.user) return;
  try { const r = await sb.rpc("get_wallet"); if (r.error) throw r.error; WAL.bal = Number(r.data); } catch (_) { WAL.bal = null; }
  walletUI();
}

;

/* ---- js/items/faces-catalog.js ---- */
"use strict";

/* =====================================================================
   FACES IN THE CATALOG
   A face is a Catalog item (ugc_items.attach = "Face"). face_meta says which face number it is; the number is what
   gets saved in body_colors.face. Buying works like any other item (buy_ugc_item). Wearing a face = picking its number.
   ===================================================================== */
const FM = { byItem: new Map(), byNo: new Map(), p: null, thumbs: new Map() };
const isFace = a => a === "Face";
function faceImgSrc(path) {                                         // repo images live in assets/, anything else is in the ugc bucket
  path = String(path || "");
  if (path.startsWith("assets/")) return path;
  const sb = getSB(); return sb ? sb.storage.from("ugc").getPublicUrl(path).data.publicUrl : "";
}
function loadFaceMeta(force) {
  if (FM.p && !force) return FM.p;
  const sb = getSB(); if (!sb) return Promise.resolve();
  FM.p = (async () => {
    try {
      const r = await sb.from("face_meta").select("item_id, face_no, image");
      if (r.error) throw r.error;
      FM.byItem.clear(); FM.byNo.clear();
      for (const x of (r.data || [])) {
        FM.byItem.set(x.item_id, x); FM.byNo.set(x.face_no, x);
        if (!FACE_TEXS[x.face_no]) registerFace(x.face_no, "Face " + x.face_no, faceImgSrc(x.image));   // faces added later by the Owner
      }
    } catch (_) { FM.p = null; }
  })();
  return FM.p;
}
const faceNoOf = it => { const m = it && FM.byItem.get(it.id); return m ? m.face_no : 0; };
const faceItemFor = no => { const m = FM.byNo.get(no); return m ? m.item_id : null; };
function faceOwned(no) {
  if (!no) return true;
  const id = faceItemFor(no); if (!id) return false;
  const me = acct.user && acct.user.id, it = ITM.rows.get(id);
  return INV.owned.has(id) || !!(it && me && it.creator === me);
}

/* little picture of a face on a head-coloured square (Catalog cards + Avatar tiles) */
function faceThumb(src, headColor) {
  headColor = HEX_RE.test(headColor || "") ? headColor : "#f5cd30";
  const key = src + "|" + headColor;
  if (FM.thumbs.has(key)) return FM.thumbs.get(key);
  const p = new Promise(res => {
    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => {
      try {
        const cv = document.createElement("canvas"); cv.width = cv.height = 192;
        const g = cv.getContext("2d"); g.fillStyle = headColor; g.fillRect(0, 0, 192, 192);
        g.drawImage(im, 0, 0, 192, 192); res(cv.toDataURL("image/png"));
      } catch (_) { res(src); }
    };
    im.onerror = () => res(src);
    im.src = src;
  });
  FM.thumbs.set(key, p); return p;
}

;

/* ---- js/items/item-models.js ---- */
"use strict";

/* ---- loading item models and drawing them on avatars ---- */
function loadItemModel(path) {
  if (ITM.models.has(path)) return ITM.models.get(path);
  const sb = getSB();
  const p = (async () => {
    if (!sb) throw new Error("no sb");
    const resp = await fetch(sb.storage.from("ugc").getPublicUrl(path).data.publicUrl);
    if (!resp.ok) throw new Error("fetch");
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > 12 * 1024 * 1024) throw new Error("big");
    const u8 = new Uint8Array(buf);
    if (!(u8[0] === 0x67 && u8[1] === 0x6c && u8[2] === 0x54 && u8[3] === 0x46)) throw new Error("not a glb");
    return await new Promise((res, rej) => new THREE.GLTFLoader().parse(buf, "", gltf => {
      try {
        const scene = gltf.scene, box = new THREE.Box3().setFromObject(scene), size = new THREE.Vector3(), c = new THREE.Vector3();
        box.getSize(size); box.getCenter(c);
        res({ scene, k: 1.2 / (Math.max(size.x, size.y, size.z) || 1), c, min: box.min.clone() });
      } catch (e) { rej(e); }
    }, rej));
  })().catch(() => { ITM.models.delete(path); return null; });
  ITM.models.set(path, p);
  return p;
}
/* ---- clothing images (PNG on the 512x512 template) ---- */
function decodePng(buf) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(new Blob([buf], { type: "image/png" })), im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("png")); };
    im.src = url;
  });
}
async function clothFromBuffer(buf) {                             // -> 512x512 canvas, or throws Error("png" | "shape")
  const u8 = new Uint8Array(buf);
  const signature = window.TriancleRust && window.TriancleRust.assetSignature ? window.TriancleRust.assetSignature(buf,"png") : null;
  if (signature === false || (signature === null && !(u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47))) throw new Error("png");
  const im = await decodePng(buf), w = im.naturalWidth, h = im.naturalHeight;
  if (!w || !h || Math.abs(w / h - CLOTH_W / CLOTH_H) > 0.01 || w < 256 || w > 2048) throw new Error("shape");
  const cv = document.createElement("canvas"); cv.width = CLOTH_W; cv.height = CLOTH_H;
  const g = cv.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(im, 0, 0, CLOTH_W, CLOTH_H);
  return cv;
}
function loadClothImg(path) {
  if (ITM.models.has(path)) return ITM.models.get(path);
  const sb = getSB();
  const p = (async () => {
    if (!sb) throw new Error("no sb");
    const resp = await fetch(sb.storage.from("ugc").getPublicUrl(path).data.publicUrl);
    if (!resp.ok) throw new Error("fetch");
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > 3 * 1024 * 1024) throw new Error("big");
    return await clothFromBuffer(buf);
  })().catch(() => { ITM.models.delete(path); return null; });
  ITM.models.set(path, p);
  return p;
}
function paintClothFor(av, ids) {                                   // one shirt + one pants at a time: the last one in the list wins
  let shirt = null, pants = null, sk = "", pk = "";
  for (const id of ids) {
    const c = av.clothItems && av.clothItems.get(id); if (!c) continue;
    if (c.attach === "Shirt") { shirt = c.cv; sk = id; } else if (c.attach === "Pants") { pants = c.cv; pk = id; }
  }
  const sig = sk + "|" + pk; if (av.clothSig === sig) return;
  av.clothSig = sig; setAvatarCloth(av, shirt, pants);
}
function buildHolder(av, it, m) {                                  // same maths as the UGC editor's ugApply()
  const pv = av.rig[it.attach], an = UG_ANCHOR[it.attach], md = MODEL_PARTS[it.attach];
  if (!pv || !an || !md) return null;
  const pp = md.pivot, pos = arr3(it.pos), rot = arr3(it.rot), rad = Math.PI / 180;
  const model = m.scene.clone(true);
  model.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const inner = new THREE.Group(); inner.scale.setScalar(m.k); inner.add(model);
  const rust = window.TriancleRust, center = rust && rust.itemCenter || ((c, minimum, k, headY) => (headY ? -minimum : -c) * k);
  inner.position.set(center(m.c.x,0,m.k,false), center(m.c.y,it.attach === "Head" ? m.min.y : 0,m.k,it.attach === "Head"), center(m.c.z,0,m.k,false));
  const holder = new THREE.Group(); holder.add(inner);
  const position = rust && rust.itemPosition || ((a,p,v) => a-p+v);
  holder.position.set(position(an[0],pp[0],pos[0]), position(an[1],pp[1],pos[1]), position(an[2],pp[2],pos[2]));
  holder.rotation.set(rot[0] * rad, rot[1] * rad, rot[2] * rad, "XYZ");
  holder.scale.setScalar(+it.scale || 1);
  pv.add(holder);
  return holder;
}
async function fetchItemRows(ids) {
  const out = new Map(), miss = [], sb = getSB();
  for (const id of ids) { if (ITM.rows.has(id)) out.set(id, ITM.rows.get(id)); else miss.push(id); }
  if (miss.length && sb) {
    try { const r = await sb.rpc("ugc_items_by_ids", { p_ids: miss }); if (!r.error) for (const it of (r.data || [])) { ITM.rows.set(it.id, it); out.set(it.id, it); } } catch (_) {}
  }
  return out;
}
async function applyItemsToAvatar(av, ids) {
  const want = ids.join(",");
  av.itemHolders = av.itemHolders || new Map(); av.clothItems = av.clothItems || new Map();
  const diff = window.TriancleRust && window.TriancleRust.missingIndices;
  const holders = Array.from(av.itemHolders), holderDrops = diff ? diff(holders.map(x => x[0]),ids) : null;
  for (const [i,[id,h]] of holders.entries()) if (holderDrops ? holderDrops.includes(i) : !ids.includes(id)) { if (h.parent) h.parent.remove(h); av.itemHolders.delete(id); }
  const clothes = Array.from(av.clothItems.keys()), clothDrops = diff ? diff(clothes,ids) : null;
  for (const [i,id] of clothes.entries()) if (clothDrops ? clothDrops.includes(i) : !ids.includes(id)) av.clothItems.delete(id);
  const missing = diff ? diff(ids,Array.from(av.itemHolders.keys()).concat(Array.from(av.clothItems.keys()))) : null;
  const need = missing ? missing.map(i => ids[i]) : ids.filter(id => !av.itemHolders.has(id) && !av.clothItems.has(id));
  if (!need.length) { paintClothFor(av, ids); return; }
  const rows = await fetchItemRows(need);
  for (const id of need) {
    const it = rows.get(id); if (!it) continue;
    if (isCloth(it.attach)) {
      const cv = await loadClothImg(it.file_path); if (!cv) continue;
      if (av.itemSig !== want) return;
      av.clothItems.set(id, { attach: it.attach, cv });
      continue;
    }
    const m = await loadItemModel(it.file_path); if (!m) continue;
    if (av.itemSig !== want) return;                              // a newer outfit replaced this one while loading
    if (av.itemHolders.has(id)) continue;
    const h = buildHolder(av, it, m); if (h) av.itemHolders.set(id, h);
  }
  paintClothFor(av, ids);
}
function syncAvatarItems(av, ids) {
  const sig = ids.join(",");
  if (av.itemSig === sig) return;
  av.itemSig = sig;
  applyItemsToAvatar(av, ids);
}
function applyRemoteItems(pl, items) {
  const rustIds = window.TriancleRust && window.TriancleRust.wornIds && Array.isArray(items) ? window.TriancleRust.wornIds(items,MAX_WORN) : null;
  const ids = rustIds || (Array.isArray(items) ? items.filter(x => typeof x === "string" && validItemId(x)).slice(0, MAX_WORN) : []);
  syncAvatarItems(pl.avatar, ids);
}
function setMyItems(ids) {
  const rustIds = window.TriancleRust && window.TriancleRust.wornIds ? window.TriancleRust.wornIds(ids,MAX_WORN) : null;
  WEAR.mine = rustIds || ids.filter(x => validItemId(x)).slice(0, MAX_WORN);
  syncAvatarItems(localAvatar, WEAR.mine);
  netSend({ t: "colors", colors: myColors });                     // re-sends presence, which now includes what you wear
  if (acct.user) queueUpgrade(acct.user.id);                       // your own picture shows what you wear
}

/* ---- little picture of an item on the player (shop + items list) ---- */
function itemThumb(it) {
  if (isFace(it.attach)) return faceThumb(faceImgSrc(it.file_path), "#f5cd30");
  const key = it.id + "|" + it.file_path + "|" + JSON.stringify([it.pos, it.rot, it.scale]);
  if (ITM.thumbs.has(key)) return Promise.resolve(ITM.thumbs.get(key));
  ITM.q = ITM.q.then(async () => {
    if (ITM.thumbs.has(key)) return;
    let url = "";
    try {
      if (isCloth(it.attach)) {                                    // clothes: the item on a plain player
        const cv = thumbs && await loadClothImg(it.file_path);
        if (cv) {
          const av = thumbs.av, v = UG_VIEW[it.attach]; setAvatarColors(av, sanitizeColors(null));
          setAvatarCloth(av, it.attach === "Shirt" ? cv : null, it.attach === "Pants" ? cv : null);
          av.group.rotation.y = -Math.PI / 2 + 0.45; av.group.position.y = 0;
          thumbs.r.setSize(200, 200, false); thumbs.cam.aspect = 1; thumbs.cam.updateProjectionMatrix();
          thumbs.cam.position.set(0, v[0] + 0.5, v[1]); thumbs.cam.lookAt(0, v[0], 0);
          thumbs.r.render(thumbs.sc, thumbs.cam);
          url = thumbs.r.domElement.toDataURL("image/png");
          setAvatarCloth(av, null, null);
        }
      } else {
      const m = thumbs && await loadItemModel(it.file_path);
      if (m) {
        const av = thumbs.av; setAvatarColors(av, sanitizeColors(null));
        const h = buildHolder(av, it, m);
        if (h) {
          const v = UG_VIEW[it.attach] || [4.6, 8];
          av.group.rotation.y = -Math.PI / 2 + 0.45; av.group.position.y = 0;
          thumbs.r.setSize(200, 200, false); thumbs.cam.aspect = 1; thumbs.cam.updateProjectionMatrix();
          thumbs.cam.position.set(0, v[0] + 0.5, v[1]); thumbs.cam.lookAt(0, v[0], 0);
          thumbs.r.render(thumbs.sc, thumbs.cam);
          url = thumbs.r.domElement.toDataURL("image/png");
          if (h.parent) h.parent.remove(h);
        }
      }
      }
    } catch (_) { try { setAvatarCloth(thumbs.av, null, null); } catch (_) {} }
    ITM.thumbs.set(key, url);
  }).catch(() => {});
  return ITM.q.then(() => ITM.thumbs.get(key) || "");
}
function fillThumbs(root) {
  for (const img of root.querySelectorAll("img[data-it]")) {
    const it = ITM.rows.get(img.dataset.it); if (!it) continue;
    itemThumb(it).then(u => { if (u && img.isConnected) img.src = u; });
  }
}

;

/* ---- js/items/inventory.js ---- */
"use strict";

/* ---- inventory (what you own / wear) ---- */
async function loadInventory() {
  const sb = getSB(); if (!sb || !acct.user) return;
  try {
    const r = await sb.from("ugc_inventory").select("item_id, equipped, acquired_at").eq("user_id", acct.user.id).order("acquired_at", { ascending: true });
    if (r.error) throw r.error;
    const rows = r.data || [], normalized = window.TriancleRust && window.TriancleRust.inventoryRows ? window.TriancleRust.inventoryRows(rows) : null;
    INV.ok = true; INV.loaded = true; INV.owned = new Set(normalized ? normalized.owned : rows.map(x => x.item_id));
    setMyItems(normalized ? normalized.equipped : rows.filter(x => x.equipped).map(x => x.item_id));
  } catch (_) { INV.ok = false; }
  if (typeof renderAvItems === "function") renderAvItems();
}
async function equipItem(id, on) {
  const sb = getSB(); if (!sb || !acct.user) return "Log in first.";
  try {
    if (on) {                                                      // a new shirt replaces the shirt you have on (same for pants)
      const it = ITM.rows.get(id);
      if (it && isCloth(it.attach)) for (const o of WEAR.mine.slice()) {
        const x = ITM.rows.get(o);
        const plan = x && window.TriancleRust && window.TriancleRust.equipConflicts ? window.TriancleRust.equipConflicts(id,it.attach,[{id:o,attach:x.attach}]) : null;
        if (plan ? plan.length > 0 : o !== id && x && x.attach === it.attach) { const off = await sb.rpc("set_ugc_equipped", { p_item: o, p_on: false }); if (off.error) throw off.error; }
      }
    }
    const r = await sb.rpc("set_ugc_equipped", { p_item: id, p_on: on });
    if (r.error) throw r.error;
    INV.owned.add(id);
    setMyItems(Array.isArray(r.data) ? r.data : []);
    return "";
  } catch (e) {
    const m = String(e && e.message || "");
    return m.includes("too_many_equipped") ? "You can wear up to " + MAX_WORN + " items at once." : m.includes("not_owned") ? "You don't own that item." : "Couldn't do that. " + SQL_HINT;
  }
}

;

/* ---- js/items/shop.js ---- */
"use strict";

/* ---- Shop ---- */
function shopNote(t, bad) { const n = $("shopNote"); n.textContent = t || ""; n.style.color = bad ? "#ff7a6b" : ""; }
async function renderShop() {
  const sb = getSB(); if (!sb) { shopNote("The Shop isn't available right now.", true); return; }
  shopNote("");
  if (acct.user) { loadWallet(); if (!INV.loaded) await loadInventory(); }
  try {
    const mod = hasBadgePerm("can_edit_items");                      // owners also see items that are off sale, so they can fix them
    let q = sb.from("ugc_items").select("id, name, attach, file_path, pos, rot, scale, price, sales, creator, published_at, published");
    if (!mod) q = q.eq("published", true);
    const r = await q.order("published_at", { ascending: false, nullsFirst: false }).limit(120);
    if (r.error) throw r.error;
    SHOP.rows = r.data || [];
    for (const it of SHOP.rows) ITM.rows.set(it.id, Object.assign({}, ITM.rows.get(it.id) || {}, it));
    await Promise.all([getProfiles(SHOP.rows.map(it => it.creator)), loadFaceMeta()]);
  } catch (_) { SHOP.rows = []; $("shopList").innerHTML = ""; $("shopBox").hidden = true; shopNote("Couldn't load the Shop. " + SQL_HINT, true); return; }
  paintShop();
}
function paintShop() {
  const q = $("shSearch").value.trim().toLowerCase(), sort = $("shSort").value, me = acct.user && acct.user.id;
  const ty = $("shType").value;
  const au = $("shAuthor").value.trim().toLowerCase(), mn = $("shMin").value === "" ? null : +$("shMin").value, mx = $("shMax").value === "" ? null : +$("shMax").value;
  const free = $("shFree").checked, hideOwned = $("shOwned").checked;
  for (const b of document.querySelectorAll("#shCats .shCat")) b.classList.toggle("on", b.dataset.type === ty);
  const nf = (free ? 1 : 0) + (hideOwned ? 1 : 0) + (au ? 1 : 0) + (mn !== null ? 1 : 0) + (mx !== null ? 1 : 0);
  $("shFiltN").textContent = nf; $("shFiltN").hidden = !nf;
  const filtered = window.TriancleRust && window.TriancleRust.catalogFilter ? window.TriancleRust.catalogFilter(SHOP.rows,q,ty,au,mn,mx,free,hideOwned,SOC.cache,INV.owned) : null;
  let rows = filtered ? filtered.map(i => SHOP.rows[i]) : SHOP.rows.filter(it => (!q || String(it.name).toLowerCase().includes(q)) && (ty === "all" || (ty === "acc" ? !isCloth(it.attach) && !isFace(it.attach) : it.attach === ty))
    && (!au || String((SOC.cache.get(it.creator) || {}).username || "").toLowerCase().includes(au))
    && (mn === null || (+it.price || 0) >= mn) && (mx === null || (+it.price || 0) <= mx)
    && (!free || !(+it.price)) && (!hideOwned || !INV.owned.has(it.id)));
  rows.sort(sort === "low" ? (a, b) => a.price - b.price : sort === "high" ? (a, b) => b.price - a.price : sort === "top" ? (a, b) => b.sales - a.sales
    : (a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  $("shopBox").hidden = rows.length > 0;
  $("shopBox").lastChild.textContent = SHOP.rows.length ? "No items match that search." : "The Catalog is empty. Check back soon.";
  $("shopList").innerHTML = rows.map(it => {
    const p = SOC.cache.get(it.creator), by = p ? p.username : "Someone", price = +it.price || 0;
    const tag = it.published === false ? '<span class="itTag">Off sale</span>' : me && it.creator === me ? '<span class="itTag">Your item</span>' : me && INV.owned.has(it.id) ? '<span class="itTag">Owned</span>' : "";
    return `<div class="itCard box" data-id="${esc(it.id)}"><div class="itPic"><img class="itImg" alt="" data-it="${esc(it.id)}" src="">${tag}</div><div class="itInfo"><b title="${esc(it.name)}">${esc(it.name)}</b>`
      + `<div class="itBy" data-pid="${esc(it.creator)}">${esc(by)}</div><div class="itMeta"><span class="pr">${price ? TRI_SVG + fmtT(price) : "Free"}</span><span class="itSlot">${esc(slotName(it.attach))}</span></div></div></div>`;
  }).join("");
  fillThumbs($("shopList"));
}
$("shSearch").addEventListener("keydown", e => e.stopPropagation());
$("shSearch").addEventListener("input", paintShop);
$("shSort").addEventListener("change", paintShop);
$("shType").addEventListener("change", paintShop);
for (const id of ["shAuthor", "shMin", "shMax"]) { $(id).addEventListener("keydown", e => e.stopPropagation()); $(id).addEventListener("input", paintShop); }
for (const id of ["shFree", "shOwned"]) $(id).addEventListener("change", paintShop);
$("shCats").addEventListener("click", e => { const b = e.target.closest(".shCat"); if (!b) return; $("shType").value = b.dataset.type; paintShop(); });
$("shFiltBtn").addEventListener("click", e => { e.stopPropagation(); $("shFilt").hidden = !$("shFilt").hidden; });
$("shFilt").addEventListener("click", e => e.stopPropagation());
document.addEventListener("click", () => { $("shFilt").hidden = true; });
document.addEventListener("keydown", e => { if (e.key === "Escape") $("shFilt").hidden = true; });
$("shClear").addEventListener("click", () => {
  for (const id of ["shSearch", "shAuthor", "shMin", "shMax"]) $(id).value = "";
  $("shFree").checked = false; $("shOwned").checked = false; $("shType").value = "all"; $("shSort").value = "new"; paintShop();
});
$("shopList").addEventListener("click", e => {
  if (e.target.closest("[data-pid]")) return;                      // creator name -> their profile
  const c = e.target.closest(".itCard"); if (c) openItem(c.dataset.id);
});

;

/* ---- js/items/item-page.js ---- */
"use strict";

/* ---- item page: preview, Try On, and the place where you buy / wear ---- */
const IP = { id: null, tok: 0, lock: false, tryOn: false, yaw: 0.6, pitch: 0.12, drag: null, running: false, S: null, desc: "", created: "", sig: "" };
const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>';
const UNLOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
function ipGL() {
  if (IP.S) return IP.S;
  let r; try { r = new THREE.WebGLRenderer({ canvas: $("ipCv"), antialias: true, alpha: true }); } catch (_) { return null; }
  if (renderer.outputEncoding !== undefined) r.outputEncoding = renderer.outputEncoding;
  if (renderer.outputColorSpace !== undefined) r.outputColorSpace = renderer.outputColorSpace;
  r.toneMapping = renderer.toneMapping; r.toneMappingExposure = renderer.toneMappingExposure;
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100), av = createAvatar(), stage = new THREE.Group();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.15));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(4, 8, 6); sc.add(dl);
  av.group.visible = false; sc.add(av.group); sc.add(stage);
  return (IP.S = { r, sc, cam, av, stage });
}
function ipNote(t, bad) { const n = $("ipNote"); n.textContent = t || ""; n.style.color = bad ? "#ff7a6b" : ""; }
function ipLockUI() { const b = $("ipLock"); b.innerHTML = IP.lock ? LOCK_SVG : UNLOCK_SVG; b.classList.toggle("locked", IP.lock); b.title = IP.lock ? "Rotation locked" : "Rotation unlocked"; }
function ipPaint() {
  const it = ITM.rows.get(IP.id); if (!it) return;
  const me = acct.user && acct.user.id, price = +it.price || 0, p = SOC.cache.get(it.creator);
  const has = !!me && (it.creator === me || INV.owned.has(it.id));
  $("ipName").textContent = it.name;
  $("ipBy").innerHTML = 'By <u data-pid="' + esc(it.creator) + '">' + esc(p ? p.username : "Someone") + "</u>";
  $("ipDesc").textContent = IP.desc || "No description yet.";
  $("ipPrice").innerHTML = price ? TRI_SVG + fmtT(price) : "FREE";
  $("ipType").textContent = it.attach === "Head" ? "Hat" : slotName(it.attach);
  const faceNo = isFace(it.attach) ? faceNoOf(it) : 0;
  const d = IP.created ? new Date(IP.created) : null;
  $("ipCreated").textContent = d && !isNaN(d) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-";
  $("ipSold").textContent = fmtT(it.sales || 0);
  const g = $("ipGet"); g.disabled = false; g.dataset.armed = ""; g.classList.remove("arm");
  const equipped = isFace(it.attach) ? (faceNo > 0 && myColors.face === faceNo) : WEAR.mine.includes(it.id);
  const action = window.TriancleRust && window.TriancleRust.itemAction ? window.TriancleRust.itemAction(!!me,has,equipped) : null;
  if (action === 2 || action === 3 || (action === null && has)) { const on = equipped; g.dataset.mode = "wear"; g.dataset.on = on ? 0 : 1; g.textContent = on ? "Take off" : "Wear"; g.className = on ? "btnG" : "btnP"; }
  else if (action === 0 || (action === null && !me)) { g.dataset.mode = "login"; g.textContent = "Log in to get"; g.className = "btnP"; }
  else { g.dataset.mode = "buy"; g.textContent = "Get"; g.className = "btnP"; }
}
async function ipLoadExtras(id, tok) {                              // description / created date, if this database has them
  const sb = getSB(); if (!sb) return;
  let row = null;
  try { const r = await sb.from("ugc_items").select("description, created_at").eq("id", id).maybeSingle(); if (!r.error) row = r.data; } catch (_) {}
  if (!row) { try { const r = await sb.from("ugc_items").select("created_at").eq("id", id).maybeSingle(); if (!r.error) row = r.data; } catch (_) {} }
  if (tok !== IP.tok) return;
  const it = ITM.rows.get(id);
  if (row) { IP.desc = String(row.description || "").slice(0, 600); IP.created = row.created_at || (it && it.published_at) || ""; }
  ipPaint(); if (typeof ioFill === "function") ioFill(id, tok);
}
async function ipClothAlone(tok) {                                 // clothes and faces are shown on a plain player (Try On = on your own player)
  const S = ipGL(), it = ITM.rows.get(IP.id); if (!S || !it) return;
  if (isFace(it.attach)) { setAvatarColors(S.av, Object.assign(sanitizeColors(null), { face: faceNoOf(it) })); S.av.itemSig = ""; await applyItemsToAvatar(S.av, []); return; }
  setAvatarColors(S.av, sanitizeColors(null));
  S.av.itemSig = it.id; await applyItemsToAvatar(S.av, [it.id]);
}
async function ipBuildItem(tok) {                                   // the item on its own, centred, in the preview
  const S = ipGL(), it = ITM.rows.get(IP.id); if (!S || !it) return;
  if (isCloth(it.attach) || isFace(it.attach)) return ipClothAlone(tok);
  while (S.stage.children.length) S.stage.remove(S.stage.children[0]);
  const m = await loadItemModel(it.file_path); if (!m || tok !== IP.tok) return;
  const inner = new THREE.Group(), k = m.k * (2.3 / 1.2);
  inner.add(m.scene.clone(true)); inner.scale.setScalar(k);
  inner.position.set(-m.c.x * k, -m.c.y * k, -m.c.z * k);
  const holder = new THREE.Group(); holder.add(inner); S.stage.add(holder);
}
async function ipTryOn(tok) {                                       // the item on your avatar (plus what you already wear)
  const S = ipGL(), it = ITM.rows.get(IP.id); if (!S || !it) return;
  setAvatarColors(S.av, isFace(it.attach) ? Object.assign({}, myColors, { face: faceNoOf(it) }) : myColors);
  if (isFace(it.attach)) { S.av.itemSig = WEAR.mine.join(","); await applyItemsToAvatar(S.av, WEAR.mine.slice()); return; }
  const ids = WEAR.mine.includes(it.id) ? WEAR.mine.slice() : WEAR.mine.concat([it.id]).slice(-MAX_WORN);
  S.av.itemSig = ids.join(","); await applyItemsToAvatar(S.av, ids);
  if (tok !== IP.tok) return;
}
function ipMode() {
  const S = IP.S; if (!S) return;
  const a0 = (ITM.rows.get(IP.id) || {}).attach, cl = isCloth(a0) || isFace(a0);
  S.stage.visible = !IP.tryOn && !cl; S.av.group.visible = IP.tryOn || cl;
  $("ipTry").classList.toggle("on", IP.tryOn); $("ipTry").textContent = IP.tryOn ? "Take Off" : "Try On";
}
function ipLoop(now) {
  if ($("pageItem").hidden || !IP.S || inGame) { IP.running = false; return; }
  requestAnimationFrame(ipLoop);
  const S = IP.S, cv = S.r.domElement, w = cv.clientWidth, h = cv.clientHeight, pr = Math.min(window.devicePixelRatio || 1, 2);
  if (w && (cv.width !== Math.round(w * pr) || cv.height !== Math.round(h * pr))) { S.r.setPixelRatio(pr); S.r.setSize(w, h, false); S.cam.aspect = w / h; S.cam.updateProjectionMatrix(); }
  if (!IP.lock && !IP.drag) IP.yaw += 0.008;
  const it = ITM.rows.get(IP.id);
  if (IP.tryOn || (it && (isCloth(it.attach) || isFace(it.attach)))) {
    const v = (it && UG_VIEW[it.attach]) || [4.6, 8], fc = it && isFace(it.attach);
    S.av.group.rotation.y = -Math.PI / 2 + (fc ? Math.sin(IP.yaw) * 0.55 : IP.yaw); S.av.group.position.y = 0;
    S.cam.position.set(0, v[0] + 0.5, v[1] + 1); S.cam.lookAt(0, v[0], 0);
  } else {
    S.stage.rotation.y = IP.yaw; S.stage.rotation.x = IP.pitch; S.stage.position.y = 0;
    S.cam.position.set(0, 0.2, 5.2); S.cam.lookAt(0, 0, 0);
  }
  S.r.render(S.sc, S.cam);
}
async function openItem(id) {
  const it = ITM.rows.get(id) || SHOP.rows.find(x => x.id === id); if (!it) return;
  ITM.rows.set(id, Object.assign({}, ITM.rows.get(id) || {}, it));
  IP.id = id; const tok = ++IP.tok;
  IP.desc = ""; IP.created = it.published_at || ""; IP.tryOn = false; IP.lock = false; IP.yaw = 0.6; IP.pitch = 0.12;
  prevOn = false; document.body.classList.remove("avWide");
  for (const x of document.querySelectorAll("#hTabs button")) x.classList.toggle("on", x.dataset.tab === "shop");
  for (const x of document.querySelectorAll(".tabsec")) x.hidden = true;
  $("pageGame").hidden = true; $("pageItem").hidden = false; playIn($("pageItem"));
  if (isFace(it.attach)) await loadFaceMeta();
  if (tok !== IP.tok) return;
  ipNote(""); ipLockUI(); ipPaint(); ipLoadExtras(id, tok);
  if (!ipGL()) { ipNote("3D preview isn't available on this device.", true); return; }
  ipMode();
  await ipBuildItem(tok);
  if (tok !== IP.tok) return;
  if (!IP.running) { IP.running = true; requestAnimationFrame(ipLoop); }
}
(function () {
  const v = $("ipView");
  const end = () => { IP.drag = null; };
  v.addEventListener("pointerdown", e => { if (e.target.closest("button") || IP.lock) return; IP.drag = { x: e.clientX, y: e.clientY }; v.setPointerCapture(e.pointerId); });
  v.addEventListener("pointermove", e => { if (!IP.drag) return; IP.yaw += (e.clientX - IP.drag.x) * 0.012; IP.pitch = Math.max(-0.6, Math.min(0.6, IP.pitch + (e.clientY - IP.drag.y) * 0.006)); IP.drag = { x: e.clientX, y: e.clientY }; });
  v.addEventListener("pointerup", end); v.addEventListener("pointercancel", end);
})();
$("ipLock").addEventListener("click", () => { IP.lock = !IP.lock; ipLockUI(); });
$("ipTry").addEventListener("click", async () => {
  IP.tryOn = !IP.tryOn; ipMode();
  if (IP.tryOn) await ipTryOn(IP.tok);
  else { const it = ITM.rows.get(IP.id); if (it && (isCloth(it.attach) || isFace(it.attach))) await ipClothAlone(IP.tok); }
});
$("ipBack").addEventListener("click", () => showTab("shop"));
$("ipGet").addEventListener("click", async () => {
  const b = $("ipGet"), it = ITM.rows.get(IP.id), sb = getSB(); if (!it || !sb) return;
  const mode = b.dataset.mode;
  if (mode === "login") { openAuth("login"); return; }
  if (mode === "wear") {
    if (isFace(it.attach)) { const no = faceNoOf(it); myColors.face = b.dataset.on === "1" ? no : 0; colorsChanged(); ipNote(""); ipPaint(); if (IP.tryOn) ipTryOn(IP.tok); return; }
    b.disabled = true; const err = await equipItem(it.id, b.dataset.on === "1"); ipNote(err, !!err); ipPaint();
    if (IP.tryOn) ipTryOn(IP.tok);
    return;
  }
  const price = +it.price || 0;
  if (price && b.dataset.armed !== "1") {                           // paid items: first tap arms the button, second tap buys
    b.dataset.armed = "1"; b.classList.add("arm"); b.textContent = "Tap again to buy for " + fmtT(price);
    setTimeout(() => { if (b.isConnected && b.dataset.armed === "1") ipPaint(); }, 3500);
    return;
  }
  b.disabled = true; b.textContent = "Getting…"; ipNote("");
  try {
    const r = await sb.rpc("buy_ugc_item", { p_item: it.id, p_expected_price: price });
    if (r.error) throw r.error;
    WAL.bal = Number(r.data); walletUI(); INV.owned.add(it.id);
    ipNote(isFace(it.attach) ? "It's yours! Press Wear to use it as your face." : "It's yours! Press Wear to put it on.");
    loadInventory(); paintShop();
  } catch (err) {
    const m = String(err && err.message || "");
    const failure = window.TriancleRust && window.TriancleRust.purchaseError ? window.TriancleRust.purchaseError(m) : null;
    const code = failure ? failure.code : 0;
    ipNote(code === 1 || (!failure && m.includes("insufficient_funds")) ? "You don't have enough Shapes for that."
      : code === 2 || (!failure && m.includes("already_owned")) ? "You already own that item."
      : code === 3 || (!failure && m.includes("price_changed")) ? "The price just changed. Look again and retry."
      : code === 4 || (!failure && m.includes("not_for_sale")) ? "That item isn't for sale anymore."
      : code === 5 || (!failure && m.includes("own_item")) ? "That's your own item."
      : code === 6 || (!failure && m.includes("not_logged_in")) ? "Log in to get things."
      : "Couldn't get that. " + SQL_HINT, true);
    if (failure ? failure.inventory : m.includes("already_owned")) loadInventory();
    if (failure ? failure.catalog : m.includes("price_changed") || m.includes("not_for_sale")) { await renderShop(); const nit = ITM.rows.get(it.id); if (!SHOP.rows.find(x => x.id === it.id)) { showTab("shop"); return; } }
  }
  ipPaint();
});

;

/* ---- notifications: the bell in the header ---- */
const NOTIF = { rows: [], fresh: new Set(), freshPatch: new Set(), timer: 0 };
/* Patch notes: add a new entry at the TOP of this list for every patch / update / version.
   Each one shows up as its own numbered notification. sections: New / Changed / Fixed / Removed. */
const PATCHES = [
  { v: "1.9.0", date: "2026-11-25", title: "Studio blocks, scripts on parts and a new Games page", sections: [
    ["New", ["A full Games page with a featured game, recently played, search and sorting", "Relay Ascent showcase template: obby, sequence puzzle, moving platform and trophy", "Scratch-style block editor: drag to insert, reorder and nest, drop on Delete to remove", "Attach Scripts and LocalScripts to parts - a killbrick is just \u201cwhen this part is touched \u2192 kill player\u201d", "Health blocks (max health, set, damage, heal, kill, respawn) with a health bar that fades in only when HP changes", "Drag scripts and UI objects between services, folders and parts in the Explorer"]],
    ["Changed", ["Blocks and the script editor now use the dark Studio theme", "Walk speed, jump power and health can all be changed by script blocks"]],
    ["Fixed", ["Delete confirmations in the Owner panel were invisible, so games could not be deleted", "UI buttons could stop responding when a ticking script rebuilt the GUI"]]
  ] },
  { v: "1.0.7", date: "2026-11-22", title: "Name colors, new Catalog and mobile", sections: [
    ["New", ["Every username gets its own color in chat", "Name tags are colored by your most important badge", "The website now works on phones, with touch controls to play", "Catalog filters: author, min and max price, free only"]],
    ["Changed", ["A bigger, cleaner Catalog that fills the whole screen", "Home has no scroll bars; extra friends show as \u201c7+ Friends\u201d and open the Friends page"]]
  ] },
  { v: "1.0.6", date: "2026-11-22", title: "Transactions: click your Shapes", sections: [
    ["Changed", ["Click your Shapes amount at the top to open Transactions", "Transactions is no longer a tab in the menu"]]
  ] },
  { v: "1.0.5", date: "2026-11-22", title: "Transactions page", sections: [
    ["New", ["Transactions page: see everything you bought and sold", "Summary view with your totals for 7, 30 or 90 days", "Filter by Purchases, Sales, Fees or Other", "Sales show who bought your item"]],
    ["Fixed", ["The site loading to a blank brown screen"]]
  ] },
  { v: "1.0.4", date: "2026-11-22", title: "UGC uploads are now one step", sections: [
    ["New", ["Pick Shirt, Pants or Accessory with one tap", "On sale toggle: list your item while you upload it", "“You get” shows what you earn from each sale"]],
    ["Changed", ["One Upload button does everything and shows the total cost", "Price starts at the lowest allowed for each type"]],
    ["Removed", ["The Save item button", "The separate Publish to Shop step"]]
  ] }
];
const patchStore = {
  get(k) { try { return JSON.parse(localStorage.getItem("tri_patch_" + k) || "[]"); } catch (_) { return []; } },
  add(k, id) { try { const a = this.get(k); if (!a.includes(id)) { a.push(id); localStorage.setItem("tri_patch_" + k, JSON.stringify(a)); } } catch (_) {} }
};
const patchList = () => { const gone = patchStore.get("gone"); return PATCHES.filter(p => !gone.includes(p.v)); };
const patchUnread = () => { const seen = patchStore.get("seen"); return patchList().filter(p => !seen.includes(p.v)); };
function patchCard(p) {
  const fresh = NOTIF.freshPatch.has(p.v) ? " fresh" : "";
  const d = new Date(p.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const secs = p.sections.map(([h, items]) => `<div class="nfSec nfSec${esc(h)}">${esc(h)}</div><ul class="nfList">${items.map(t => `<li>${esc(t)}</li>`).join("")}</ul>`).join("");
  return `<div class="nfCard nfPatch${fresh}" data-nid="patch-${esc(p.v)}"><div class="nfTop"><span class="nfTag">Patch v${esc(p.v)}</span><span class="nfTime">${esc(d)}</span></div><div class="nfTitle">${esc(p.title)}</div>${secs}<button class="nfBtn" type="button" data-nf="dismiss">Dismiss</button></div>`;
}
const ago = t => { const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000); return s < 60 ? "now" : s < 3600 ? Math.floor(s / 60) + "m" : s < 86400 ? Math.floor(s / 3600) + "h" : Math.floor(s / 86400) + "d"; };
function notifPaint() {
  const bell = $("hBell"); if (!bell) return;
  bell.hidden = !acct.user;
  const unread = NOTIF.rows.filter(r => !r.read).length + patchUnread().length, n = $("hBellN");
  n.hidden = unread === 0; n.textContent = unread > 9 ? "9+" : String(unread);
  bell.title = unread ? unread + " new notification" + (unread === 1 ? "" : "s") : "Notifications";
  if ($("notifPanel").hidden) return;
  const pc = patchList().map(patchCard).join("");
  const rc = NOTIF.rows.map(r => `<div class="nfCard${NOTIF.fresh.has(r.id) ? " fresh" : ""}" data-nid="${esc(String(r.id))}"><div class="nfTop"><span class="nfTitle">${esc(r.title)}</span><span class="nfTime">${esc(ago(r.created_at))}</span></div><div class="nfBody">${esc(r.body)}</div><button class="nfBtn" type="button" data-nf="dismiss">Dismiss</button></div>`).join("");
  $("notifList").innerHTML = (pc || rc) ? pc + rc : '<div class="nfEmpty">Nothing new.</div>';
}
async function loadNotifs() {
  const sb = getSB(); if (!sb || !acct.user) { NOTIF.rows = []; notifPaint(); return; }
  try {
    const r = await sb.from("notifications").select("id, title, body, read, created_at").order("created_at", { ascending: false }).limit(500);
    if (r.error) throw r.error;
    NOTIF.rows = r.data || [];
  } catch (_) { NOTIF.rows = []; }                                  // the table isn't there until supabase_schema.sql has been run
  if (!$("notifPanel").hidden) for (const r of NOTIF.rows) if (!r.read) NOTIF.fresh.add(r.id);
  notifPaint();
  if (!NOTIF.timer) NOTIF.timer = setInterval(() => { if (acct.user && !document.hidden) loadNotifs(); }, 45000);
}
function notifToggle(open) {
  const p = $("notifPanel"); open = open == null ? p.hidden : open;
  p.hidden = !open;
  if (open) {
    NOTIF.fresh = new Set(NOTIF.rows.filter(r => !r.read).map(r => r.id));
    NOTIF.freshPatch = new Set(patchUnread().map(p => p.v));
    for (const p of patchList()) patchStore.add("seen", p.v);
    const sb = getSB(); if (NOTIF.fresh.size && sb) { sb.rpc("mark_notifications_read").then(() => {}, () => {}); for (const r of NOTIF.rows) r.read = true; }
  } else { NOTIF.fresh.clear(); NOTIF.freshPatch.clear(); }
  notifPaint();
}
$("hBell").addEventListener("click", e => { e.stopPropagation(); notifToggle(); });
$("notifPanel").addEventListener("click", async e => {
  e.stopPropagation();
  const b = e.target.closest("[data-nf]"); if (!b) return;
  const id = b.closest("[data-nid]").dataset.nid, sb = getSB();
  if (id.startsWith("patch-")) { patchStore.add("gone", id.slice(6)); notifPaint(); return; }
  NOTIF.rows = NOTIF.rows.filter(r => String(r.id) !== id); notifPaint();
  if (sb) { try { await sb.from("notifications").delete().eq("id", id); } catch (_) {} }
});
document.addEventListener("click", () => { if (!$("notifPanel").hidden) notifToggle(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("notifPanel").hidden) notifToggle(false); });

/* ---- js/social/transactions.js ---- */
"use strict";

/* ---- Transactions page: purchases, sales, fees and the rest (needs supabase_transactions.sql) ---- */
const TX = { type: "summary", days: 30, per: 10, page: 0, busy: 0 };
const TX_KINDS = { purchases: "purchase", sales: "sale", fees: "fee", other: "other" };
const TX_ICON = '<img class="tcI" src="assets/img/shapes.png" alt="">';
const txSigned = n => (n > 0 ? "+" : n < 0 ? "-" : "") + Number(Math.abs(n)).toLocaleString();
const txWhen = t => new Date(t).toLocaleString([], { year: "2-digit", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
function txMissing(e) { return e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || /transactions|transaction_summary|schema cache|does not exist/i.test(String(e.message || ""))); }
function txSummaryHtml(d) {
  const g = k => Number(d[k] || 0);
  const row = (label, v, bold) => `<div class="txR${bold ? " txB" : ""}"><span>${label}</span><span class="txAmt${v < 0 ? " neg" : ""}">${TX_ICON}${v < 0 ? "-" : ""}${Number(Math.abs(v)).toLocaleString()}</span></div>`;
  const inc = g("sale") + g("other_in"), out = g("purchase") + g("fee") + g("other_out");
  const card = (title, rows) => `<div class="txCard box"><div class="txR txH"><span>${title}</span><span>Amount</span></div>${rows}</div>`;
  return card("Incoming Shapes", row("Sales", g("sale")) + (g("other_in") ? row("Other", g("other_in")) : "") + row("Total", inc, true))
    + card("Outgoing Shapes", row("Purchases", g("purchase")) + row("Fees", g("fee")) + (g("other_out") ? row("Other", g("other_out")) : "") + row("Total", out, true))
    + card("Net", row("Total change", inc + out, true));
}
function txAvatar(uid, nm) {                                       // their real picture (with what they wear); the first letter only if we can't draw one
  const mine = acct.user && uid === acct.user.id, p = mine ? { body_colors: myColors } : SOC.cache.get(uid);
  let url = ""; try { if (p && p.body_colors) url = thumb(p.body_colors, "face", uid); } catch (_) {}
  return url ? `<img class="txAv pface" alt="" data-tu="${esc(uid)}" src="${esc(url)}">` : `<i>${esc(nm.slice(0, 1).toUpperCase())}</i>`;
}
async function renderTransactions() {
  const sb = getSB(), box = $("txBody"); if (!sb || !acct.user) return;
  const my = ++TX.busy, sum = TX.type === "summary";
  $("txType").value = TX.type; $("txDays").value = String(TX.days); $("txPer").value = String(TX.per);
  $("txDays").hidden = !sum; $("txPer").hidden = sum;
  box.innerHTML = '<div class="note">Loading…</div>';
  try {
    if (sum) {
      const r = await sb.rpc("transaction_summary", { p_days: TX.days }); if (r.error) throw r.error;
      if (my !== TX.busy) return;
      box.innerHTML = txSummaryHtml(r.data || {});
      return;
    }
    let q = sb.from("transactions").select("id, kind, amount, description, item_id, other_user, created_at", { count: "exact" }).eq("user_id", acct.user.id);
    if (TX_KINDS[TX.type]) q = q.eq("kind", TX_KINDS[TX.type]);
    const from = TX.page * TX.per, r = await q.order("created_at", { ascending: false }).range(from, from + TX.per - 1);
    if (r.error) throw r.error;
    if (my !== TX.busy) return;
    const rows = r.data || [], pages = Math.max(1, Math.ceil((r.count || 0) / TX.per));
    if (!rows.length && TX.page > 0) { TX.page = Math.max(0, pages - 1); return renderTransactions(); }
    if (!rows.length) { box.innerHTML = '<div class="note">No transactions yet.</div>'; return; }
    const ids = Array.from(new Set(rows.map(x => x.other_user).filter(Boolean).concat([acct.user.id]))), names = new Map();
    try { const p = await sb.from("player_profiles").select("id, username").in("id", ids); for (const u of (p.data || [])) names.set(u.id, u.username); } catch (_) {}
    try { await getProfiles(ids); } catch (_) {}                    // so we can draw each person's picture
    if (my !== TX.busy) return;
    const body = rows.map(x => {
      const who = x.other_user || acct.user.id, nm = names.get(who) || "Player";
      const thumb = x.item_id ? `<span class="txThumb" data-item="${esc(x.item_id)}"></span>` : `<span class="txThumb">${TX_ICON}</span>`;
      return `<div class="txRow"><span class="txDate">${esc(txWhen(x.created_at))}</span><span class="txSrc"><button type="button" class="txUser" data-uid="${esc(who)}">${txAvatar(who, nm)}${esc(nm)}</button></span><span class="txDesc">${thumb}<span>${esc(x.description)}</span></span><span class="txAmt${x.amount < 0 ? " neg" : ""}">${TX_ICON}${txSigned(x.amount)}</span></div>`;
    }).join("");
    box.innerHTML = `<div class="txTable box"><div class="txRow txH"><span>Date</span><span>Source</span><span>Description</span><span class="txAmtH">Amount</span></div>${body}</div>`
      + `<div class="txPager"><button type="button" class="btnG" data-tx="prev"${TX.page === 0 ? " disabled" : ""}>Previous</button><span>Page ${TX.page + 1} of ${pages}</span><button type="button" class="btnG" data-tx="next"${TX.page + 1 >= pages ? " disabled" : ""}>Next</button></div>`;
    const need = Array.from(new Set(rows.map(x => x.item_id).filter(Boolean)));
    if (need.length) fetchItemRows(need).then(map => {
      for (const el of box.querySelectorAll(".txThumb[data-item]")) {
        const it = map.get(el.dataset.item); if (!it) continue;
        Promise.resolve(itemThumb(it)).then(url => { if (url && el.isConnected) el.innerHTML = '<img alt="" src="' + esc(url) + '">'; }, () => {});
      }
    });
  } catch (e) {
    if (my !== TX.busy) return;
    box.innerHTML = txMissing(e) ? '<div class="note">Transactions aren\'t switched on yet. Run <b>supabase_transactions.sql</b> in the Supabase SQL editor.</div>' : '<div class="note">Couldn\'t load your transactions.</div>';
    if (!txMissing(e)) console.error("transactions failed", e);
  }
}
const txOpen = () => { if (acct.user) showTab("transactions"); };
$("hBal").addEventListener("click", txOpen);
$("hBal").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); txOpen(); } });
if ($("shBalBox")) { $("shBalBox").style.cursor = "pointer"; $("shBalBox").title = "View your transactions"; $("shBalBox").addEventListener("click", txOpen); }
$("txType").addEventListener("change", () => { TX.type = $("txType").value; TX.page = 0; renderTransactions(); });
$("txDays").addEventListener("change", () => { TX.days = +$("txDays").value || 0; renderTransactions(); });
$("txPer").addEventListener("change", () => { TX.per = +$("txPer").value || 10; TX.page = 0; renderTransactions(); });
$("txBody").addEventListener("click", e => {
  const pg = e.target.closest("[data-tx]"); if (pg && !pg.disabled) { TX.page = Math.max(0, TX.page + (pg.dataset.tx === "next" ? 1 : -1)); renderTransactions(); return; }
  const u = e.target.closest("[data-uid]"); if (u) { SOC.viewId = u.dataset.uid; showTab("profile"); }
});

/* ---- js/items/item-owner.js ---- */
"use strict";

/* ---- Owner tools on an item page: rename, describe, set the price, put on / take off sale, delete.
   Works for ANY item in the Catalog. Needs the Owner badge (or a badge that allows "edit items") - and
   the server checks it too (owner_update_item / owner_delete_item in supabase_schema.sql). ---- */
const canEditItems = () => hasBadgePerm("can_edit_items");
const isMyItem = it => !!(it && acct.user && it.creator === acct.user.id);             // creators can always edit their own items
const canEditItem = it => canEditItems() || isMyItem(it);
const ioMsg = (t, bad) => { const n = $("ioMsg"); n.textContent = t || ""; n.style.color = bad ? "#ff7a6b" : ""; };
$("ipOwner").addEventListener("keydown", e => e.stopPropagation());
function ioFeeNote() {
  const it = ITM.rows.get(IP.id), n = $("ioFeeNote"); if (!it || !n) return;
  if (kindOfItem(it.attach) === "face") { n.textContent = ""; return; }
  const price = Math.floor(+$("ioPrice").value || 0), on = $("ioSale").checked, mine = isMyItem(it);
  const f = (on && mine && (!it.published || price !== Math.floor(+it.price || 0))) ? listFee(price, it.attach) : 0;
  n.textContent = mine ? (f ? "Fee: " + fmtN(f) + " Shapes" : "No fee") + " · You earn 80% of each sale" : "";
}
$("ioPrice").addEventListener("input", ioFeeNote); $("ioSale").addEventListener("change", ioFeeNote);
function ioFill(id, tok) {                                         // called once the item's description has loaded
  const box = $("ipOwner"), it = ITM.rows.get(id);
  box.hidden = !(it && canEditItem(it));
  $("ioTitle").textContent = canEditItems() ? "Owner tools" : "Edit your item";
  $("ioDel").hidden = !canEditItems();                              // only Owners can delete (buyers would lose it)
  if (box.hidden || tok !== IP.tok) return;
  $("ioName").value = it.name || ""; $("ioDesc").value = IP.desc || "";
  $("ioPrice").value = Math.max(0, Math.floor(+it.price || 0)); $("ioSale").checked = it.published !== false;
  $("ioPriceLbl").textContent = priceRuleText(it.attach); $("ioPrice").min = minPrice(it.attach);
  ioFeeNote(); ioMsg("");
}
function ioErr(e) {
  const m = String(e && e.message || "");
  return m.includes("not_allowed") ? "Not your item."
    : m.includes("bad_name") ? "Name: 1-40 characters."
    : m.includes("bad_price") ? "Price must be a whole number from 0 to 1,000,000."
    : m.includes("price_too_low") ? "Price is too low."
    : m.includes("insufficient_funds") ? "Not enough Shapes."
    : m.includes("not_found") ? "Item not found."
    : "Couldn't do that.";
}
$("ioSave").addEventListener("click", async () => {
  const sb = getSB(), it = ITM.rows.get(IP.id); if (!sb || !it || !canEditItem(it)) return;
  const name = $("ioName").value.trim(), desc = $("ioDesc").value.trim().slice(0, 600), price = Math.floor(+$("ioPrice").value);
  const on = $("ioSale").checked, b = $("ioSave");
  const check = window.TriancleRust && window.TriancleRust.itemEditCheck ? window.TriancleRust.itemEditCheck(name.length,price,on,minPrice(it.attach)) : null;
  if (check === 1 || (check === null && (!name || name.length > 40))) return ioMsg("Give it a name (up to 40 characters).", true);
  if (check === 2 || (check === null && !(price >= 0 && price <= 1000000))) return ioMsg("Price must be a whole number from 0 to 1,000,000.", true);
  if (check === 3 || (check === null && on && price < minPrice(it.attach))) return ioMsg("Lowest price: " + fmtT(minPrice(it.attach)) + " Shapes.", true);
  const fee = (on && isMyItem(it) && (!it.published || price !== Math.floor(+it.price || 0))) ? listFee(price, it.attach) : 0;
  if (fee > 0) {
    if (WAL.bal != null && WAL.bal < fee) return ioMsg("Not enough Shapes (" + fmtT(fee) + " needed).", true);
    if (!(await uiConfirm("List for " + fmtT(price) + " Shapes? Fee: " + fmtT(fee) + ".", "List"))) return;
  }
  b.disabled = true; ioMsg("Saving…");
  try {
    const r = await sb.rpc(canEditItems() ? "owner_update_item" : "update_own_item", { p_item: it.id, p_name: name, p_desc: desc, p_price: price, p_published: on });
    if (r.error) throw r.error;
    const patch = { name, price, published: on };
    Object.assign(it, patch); ITM.rows.set(it.id, it);
    const row = SHOP.rows.find(x => x.id === it.id); if (row) Object.assign(row, patch);
    IP.desc = desc; ITM.thumbs.clear();
    ioMsg(fee ? "Saved (-" + fmtT(fee) + ")" : "Saved."); ioFeeNote(); ipPaint(); paintShop(); if (fee) loadWallet();
  } catch (e) { ioMsg(ioErr(e), true); }
  b.disabled = false;
});
$("ioDel").addEventListener("click", async () => {
  const sb = getSB(), it = ITM.rows.get(IP.id); if (!sb || !it || !canEditItems()) return;
  if (!(await uiConfirm("Delete “" + it.name + "” for good? Everyone who owns it loses it.", "Delete", true))) return;
  const b = $("ioDel"); b.disabled = true; ioMsg("Deleting…");
  try {
    const r = await sb.rpc("owner_delete_item", { p_item: it.id });
    if (r.error) throw r.error;
    const path = String(r.data || "");
    if (path && !path.startsWith("assets/")) { try { await sb.storage.from("ugc").remove([path]); } catch (_) {} }
    ITM.rows.delete(it.id); INV.owned.delete(it.id); SHOP.rows = SHOP.rows.filter(x => x.id !== it.id);
    const m = FM.byItem.get(it.id); if (m) { FM.byItem.delete(it.id); FM.byNo.delete(m.face_no); }
    if (WEAR.mine.includes(it.id)) setMyItems(WEAR.mine.filter(x => x !== it.id));
    showTab("shop");
  } catch (e) { ioMsg(ioErr(e), true); }
  b.disabled = false;
});

;

/* ---- js/items/ugc-selling.js ---- */
"use strict";

/* ---- selling from the UGC tab ---- */
function ugRustFeePlan(price) {
  const rust = window.TriancleRust;
  if (!rust || !rust.ugcFeePlan || typeof UG.livePrice !== "number") return null;
  const kind = kindOfItem(UG.attach), index = kind === "cloth" ? 1 : kind === "face" ? 2 : 0;
  return rust.ugcFeePlan(price,index,UG.livePrice,UG.published,UG.sale,!!UG.editId);
}
function ugPendingFee() {                                        // what the listing fee would be for the number in the box right now
  const price = ugClamp(Math.floor(+$("ugPrice").value || 0), 0, TAX_MAX);
  return (UG.published && price === UG.livePrice) ? 0 : listFee(price, UG.attach);
}
function ugCost() {
  const price = ugClamp(Math.floor(+$("ugPrice").value || 0), 0, TAX_MAX), plan = ugRustFeePlan(price);
  return plan ? plan[2] : (UG.editId ? 0 : uploadFee(UG.attach)) + (UG.sale ? ugPendingFee() : 0);
}   // everything one click will charge
function ugFeeNote() {
  const n = $("ugFeeNote"), go = $("ugGo"); if (!n || !go) return;
  const price = ugClamp(Math.floor(+$("ugPrice").value || 0), 0, TAX_MAX), plan = ugRustFeePlan(price), up = plan ? plan[0] : UG.editId ? 0 : uploadFee(UG.attach), lf = plan ? plan[1] : UG.sale ? ugPendingFee() : 0, total = plan ? plan[2] : up + lf;
  n.innerHTML = kindOfItem(UG.attach) === "face" ? "" : "You get " + fmtN(plan ? plan[3] : creatorShare(price)) + ' <img class="tcI" src="assets/img/shapes.png" alt="">'
    + (total ? '<span class="ugBreak">' + (up ? fmtN(up) + " upload" : "") + (up && lf ? " + " : "") + (lf ? fmtN(lf) + " listing fee" : "") + "</span>" : "");
  const ready = !!(isCloth(UG.attach) ? UG.cloth : UG.holder) && !!UG.name.trim();
  go.textContent = UG.busy ? "Uploading…" : (UG.editId ? "Update item" : "Upload") + (total ? " for " + fmtN(total) + " Shapes" : "");
  go.disabled = !ready || UG.busy;
}
if ($("ugPrice")) $("ugPrice").addEventListener("input", () => { UG.price = ugClamp(Math.floor(+$("ugPrice").value || 0), 0, TAX_MAX); ugFeeNote(); });
if ($("ugOnSale")) $("ugOnSale").addEventListener("change", () => { UG.sale = $("ugOnSale").checked; $("ugPriceBox").hidden = !UG.sale; ugFeeNote(); });

/* after a creator re-saves an item, drop the cached copy so the worn version updates */
function refreshWorn(id) {
  ITM.rows.delete(id); ITM.thumbs.clear();
  for (const [path, p] of Array.from(ITM.models)) ITM.models.delete(path);
  const h = localAvatar.itemHolders && localAvatar.itemHolders.get(id);
  if (h) { if (h.parent) h.parent.remove(h); localAvatar.itemHolders.delete(id); }
  if (localAvatar.clothItems) localAvatar.clothItems.delete(id);
  localAvatar.clothSig = null; localAvatar.itemSig = null; syncAvatarItems(localAvatar, WEAR.mine);
}

;

/* ---- js/ui/avatar-editor.js ---- */
"use strict";

/* =====================================================================
   AVATAR EDITOR (Roblox-style): tabs on top, a grid of what you own on the left, your player on the right.
   All / Body / Faces / Clothing / Accessories. Click a tile to wear it, click it again to take it off.
   ===================================================================== */
const AV = { tab: "all", rows: [], busy: false, tok: 0 };
const AV_TABS = ["all", "body", "faces", "clothing", "acc"];

(function buildAvatarEditor() {
  for (const b of document.querySelectorAll("#avTabs button")) b.addEventListener("click", () => avSetTab(b.dataset.av));
  for (const b of document.querySelectorAll("#avBody button")) b.addEventListener("click", () => { myColors.body = b.dataset.body === "female" ? "female" : "male"; colorsChanged(); });
  const pal = $("avPalette");                                       // quick colours for the part you picked
  pal.innerHTML = PALETTE.map(c => `<button type="button" class="sw" data-c="${c}" title="${c}" style="background:${c}"></button>`).join("");
  pal.addEventListener("click", e => { const b = e.target.closest(".sw"); if (b) setPartColor(colPart, b.dataset.c); });
  $("avGrid").addEventListener("click", onAvTile);
  $("avMore").addEventListener("click", () => { $("shType").value = AV.tab === "faces" ? "Face" : AV.tab === "clothing" ? "all" : AV.tab === "acc" ? "acc" : "all"; showTab("shop"); });
  $("avReset").addEventListener("click", () => { $("colReset").click(); });
})();

function avSetTab(t) {
  if (!AV_TABS.includes(t)) t = "all";
  AV.tab = t;
  for (const b of document.querySelectorAll("#avTabs button")) b.classList.toggle("on", b.dataset.av === t);
  $("avColors").hidden = t !== "body"; $("avItems").hidden = t === "body";
  if (t === "body") refreshColorsUI(); else paintAvGrid();
}

/* what the player owns, as rows: faces (incl. Classic and the face worn right now), clothes, accessories */
async function renderAvItems() {                                    // reload from the database, then paint
  if ($("tabAvatar").hidden) return;
  const sb = getSB(), tok = ++AV.tok;
  if (!sb || !acct.user) { AV.rows = []; $("avNote").textContent = "Log in to see your items."; paintAvGrid(); return; }
  if (!INV.loaded && INV.ok) { $("avNote").textContent = "Loading…"; return; }
  if (!INV.ok) { $("avNote").textContent = "Couldn't load your items. " + SQL_HINT; paintAvGrid(); return; }
  $("avNote").textContent = "";
  const ids = new Set(INV.owned);
  if (canUgc()) {                                                   // creators can also wear their own creations
    try { const r = await sb.from("ugc_items").select("id").eq("creator", acct.user.id); for (const x of (r.data || [])) ids.add(x.id); } catch (_) {}
  }
  await loadFaceMeta();
  const rows = await fetchItemRows(Array.from(ids));
  if (tok !== AV.tok) return;
  AV.rows = Array.from(ids).map(id => rows.get(id)).filter(Boolean);
  paintAvGrid();
}
function avFaceList() {
  const list = [{ no: 0, name: "Classic", src: FACE_SRC[0], id: null }], seen = new Set([0]);
  for (const it of AV.rows) if (isFace(it.attach)) { const no = faceNoOf(it); if (no && !seen.has(no)) { seen.add(no); list.push({ no, name: it.name, src: faceImgSrc(it.file_path), id: it.id }); } }
  const cur = myColors.face | 0;
  if (cur && !seen.has(cur)) list.push({ no: cur, name: FACE_NAMES[cur] || "Face " + cur, src: FACE_SRC[cur] || "", id: null });
  return list;
}
function paintAvGrid() {
  if (AV.tab === "body") return;
  const t = AV.tab, parts = [];
  const want = k => t === "all" || t === k;
  if (want("faces")) for (const f of avFaceList()) {
    const on = (myColors.face | 0) === f.no;
    parts.push(`<button type="button" class="avTile${on ? " on" : ""}" data-face="${f.no}" title="${esc(f.name)}"><img alt="" data-fsrc="${esc(f.src)}" src=""><span class="avCheck"></span><span class="avName">${esc(f.name)}</span></button>`);
  }
  const cl = AV.rows.filter(it => isCloth(it.attach)), ac = AV.rows.filter(it => !isCloth(it.attach) && !isFace(it.attach));
  const item = it => { const on = WEAR.mine.includes(it.id);
    return `<button type="button" class="avTile${on ? " on" : ""}" data-id="${esc(it.id)}" title="${esc(it.name)}"><img alt="" data-it="${esc(it.id)}" src=""><span class="avCheck"></span><span class="avName">${esc(it.name)}</span></button>`; };
  if (want("clothing")) parts.push(...cl.map(item));
  if (want("acc")) parts.push(...ac.map(item));
  const grid = $("avGrid"); grid.innerHTML = parts.join("");
  for (const im of grid.querySelectorAll("img[data-fsrc]")) faceThumb(im.dataset.fsrc, myColors.Head).then(u => { if (im.isConnected) im.src = u; });
  fillThumbs(grid);
  const empty = (t === "clothing" && !cl.length) ? "You don't own any clothing yet."
    : (t === "acc" && !ac.length) ? "You don't own any accessories yet."
    : (t === "all" && !parts.length) ? "Nothing here yet." : "";
  $("avEmpty").textContent = empty;
  $("avMore").hidden = !(t === "faces" || t === "clothing" || t === "acc" || t === "all");
  $("avMore").textContent = t === "faces" ? "Get more faces" : "Browse the Catalog";
  const n = WEAR.mine.length + ((myColors.face | 0) ? 1 : 0);
  $("avWearing").textContent = n ? "Wearing " + n + (n === 1 ? " item" : " items") : "Nothing extra on";
}
async function onAvTile(e) {
  const b = e.target.closest(".avTile"); if (!b || AV.busy) return;
  if (b.dataset.face !== undefined) {                               // faces: Classic is the "off" state
    const no = +b.dataset.face; myColors.face = (myColors.face | 0) === no ? 0 : no; colorsChanged(); paintAvGrid(); return;
  }
  AV.busy = true; b.classList.add("busy");
  const on = WEAR.mine.includes(b.dataset.id), err = await equipItem(b.dataset.id, !on);
  $("avNote").textContent = err; AV.busy = false; paintAvGrid();
}
/* called by the colour code whenever colours / face change */
function refreshFacesUI() {
  for (const b of document.querySelectorAll("#avBody button")) b.classList.toggle("on", b.dataset.body === myColors.body);
  for (const b of $("avPalette").children) b.classList.toggle("on", b.dataset.c === myColors[colPart]);
  if (AV.tab !== "body" && !$("tabAvatar").hidden) paintAvGrid();
}

;

/* ---- js/core/main.js ---- */
"use strict";

/* Start-up. Loaded last on purpose: everything below kicks off async work (account UI, login check, game list,
   graphics level) that calls into the other files, so all of them must already be loaded. */
if (window.__PLAYTEST__ && typeof window.__playtestBoot === "function") {
  window.__playtestBoot();               // Triancle Studio playtest: the real game, no account / home / multiplayer
} else {
acctUI();
(async function initAuth() {            // restore a saved login; without one you only ever see the login page
  const sb = getSB();
  try {
    if (sb) await loadBadgeDefs();
    if (sb) { const { data } = await sb.auth.getUser(); if (data && data.user) await onSignedIn(data.user); }
  } catch (_) {}
  document.body.classList.remove("boot");
  if (acct.user) { loadAllGames(); showTab("home"); appRunPendingJoin(); } else openAuth("login");
})();

loadAllGames();

requestAnimationFrame(frame);
setTimeout(() => setGraphics(Math.max(1, Math.min(5, _gl))), 0);
}

;

;

/* ---- touch controls (website on a phone/tablet only; the desktop app never shows them) ---- */
(function () {
  if (APP.in || !(("ontouchstart" in window) || navigator.maxTouchPoints > 0)) return;
  document.documentElement.classList.add("touch");
  const ui = document.createElement("div"); ui.id = "touchUI";
  ui.innerHTML = '<div id="joy"><i id="joyK"></i></div><button id="tJump" type="button" aria-label="Jump">Jump</button>';
  document.body.appendChild(ui);
  const joy = $("joy"), knob = $("joyK"), R = 52;
  let jid = null, jc = null;
  const setKeys = (f, b, l, r) => { keys.KeyW = f; keys.KeyS = b; keys.KeyA = l; keys.KeyD = r; };
  const joyEnd = () => { jid = null; knob.style.transform = ""; setKeys(false, false, false, false); };
  function joyMove(e) {
    const dx = e.clientX - jc.x, dy = e.clientY - jc.y, d = Math.hypot(dx, dy) || 1, k = Math.min(d, R) / d;
    knob.style.transform = "translate(" + (dx * k) + "px," + (dy * k) + "px)";
    const T = R * 0.32;
    setKeys(dy < -T, dy > T, dx < -T, dx > T);
  }
  joy.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); jid = e.pointerId; try { joy.setPointerCapture(jid); } catch (_) {} const b = joy.getBoundingClientRect(); jc = { x: b.left + b.width / 2, y: b.top + b.height / 2 }; joyMove(e); });
  joy.addEventListener("pointermove", e => { if (e.pointerId === jid) joyMove(e); });
  for (const t of ["pointerup", "pointercancel"]) joy.addEventListener(t, e => { if (e.pointerId === jid) joyEnd(); });
  const jb = $("tJump");
  jb.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); keys.Space = true; });
  for (const t of ["pointerup", "pointercancel", "pointerleave"]) jb.addEventListener(t, () => { keys.Space = false; });

  /* one finger on the world turns the camera, two fingers pinch to zoom */
  const ptr = new Map(); let pinch = 0;
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", e => { if (e.pointerType === "mouse") return; ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { canvas.setPointerCapture(e.pointerId); } catch (_) {} pinch = 0; });
  canvas.addEventListener("pointermove", e => {
    const p = ptr.get(e.pointerId); if (!p || !inGame || uiOpen()) return;
    if (ptr.size === 1) {
      cam.yaw -= (e.clientX - p.x) * CFG.CAM_SENS * 1.6;
      cam.pitch = Math.max(-CFG.CAM_PITCH_LIMIT, Math.min(CFG.CAM_PITCH_LIMIT, cam.pitch + (e.clientY - p.y) * CFG.CAM_SENS * 1.6));
    }
    p.x = e.clientX; p.y = e.clientY;
    if (ptr.size === 2) {
      const [a, b] = [...ptr.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) cam.zoomTarget = Math.max(CFG.CAM_ZOOM_MIN, Math.min(CFG.CAM_ZOOM_MAX, cam.zoomTarget * (pinch / d)));
      pinch = d;
    }
  });
  for (const t of ["pointerup", "pointercancel"]) canvas.addEventListener(t, e => { ptr.delete(e.pointerId); pinch = 0; });
  setInterval(() => { if (!inGame || uiOpen()) { if (jid !== null) joyEnd(); keys.Space = false; } }, 300);
})();
