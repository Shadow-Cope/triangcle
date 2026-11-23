"use strict";

/* =====================================================================
   Triancle Studio - editor
   Baseplate/world, Studio camera, selection, move/scale/rotate tools,
   editable properties and resizable panels.
   ===================================================================== */
const StudioEditor = (function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round = (v, n) => Math.round(v * n) / n;
  const LAYOUT_LS = "triangle_studio_layout";

  let renderer = null, scene = null, camera = null, clock = null;
  let axisRenderer = null, axisScene = null, axisCamera = null, axisGroup = null;
  let running = false, raf = 0, autoSave = 0, game = null, dirty = false;
  let yaw = 0, pitch = -0.36, speed = 36;
  let drag = null, down = null, studImg = null, inletImg = null, world = null;
  let parts = [], selected = null, selBox = null, partSeq = 0;
  let tool = "select";
  let gizmo = null, gizmoModes = {}, gizmoDrag = null;
  let explorerOn = true, propsOn = true;
  let bound = false, layout = null, layoutTimer = 0, colorTimer = 0;

  const keys = new Set();
  const tmpDir = new THREE.Vector3();
  const tmpRight = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const GEO_BOX = new THREE.BoxGeometry(1, 1, 1);
  const GEO_SPHERE = new THREE.SphereGeometry(0.5, 24, 16);
  const GEO_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); GEO_CYL.rotateZ(Math.PI / 2);

  const MAT = {
    Plastic: { roughness: 0.62, metalness: 0 },
    "Smooth Plastic": { roughness: 0.32, metalness: 0 },
    Metal: { roughness: 0.28, metalness: 0.88 },
    Neon: { roughness: 0.4, metalness: 0, emissive: true },
    Glass: { roughness: 0.08, metalness: 0, glass: true },
  };
  const TEXTURES = ["Studs", "Inlet", "Smooth"];
  const MATERIALS = Object.keys(MAT);

  /* =====================================================================
     small helpers
     ===================================================================== */
  function hexOf(n) { return "#" + ((n | 0) & 0xffffff).toString(16).padStart(6, "0"); }
  function quatFromRow(R) {
    if (!Array.isArray(R) || R.length !== 9) return new THREE.Quaternion();
    const m = new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }
  function rowMajor(q) {
    const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
    return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
  }
  function defaultName(index) {
    return index === 0 ? "Baseplate" : index === 1 ? "SpawnLocation" : "Part";
  }
  function paintStatus(kind) {
    const doc = $("stDocState"), bar = $("stStatusBar");
    if (kind === "dirty") {
      doc.textContent = "Unsaved"; doc.className = "warn";
      bar.textContent = "Unsaved changes"; bar.className = "warn";
    } else if (kind === "saving") {
      doc.textContent = "Saving…"; doc.className = "";
      bar.textContent = "Saving…"; bar.className = "busy";
    } else if (kind === "error") {
      doc.textContent = "Not saved"; doc.className = "warn";
      bar.textContent = "Couldn't save on this device"; bar.className = "warn";
    } else {
      doc.textContent = "Saved"; doc.className = "";
      bar.textContent = "Saved to this device"; bar.className = "ok";
    }
  }
  function markDirty() { dirty = true; paintStatus("dirty"); }

  /* =====================================================================
     textures / materials
     ===================================================================== */
  function studTexture(base, rx, ry, img) {
    const S = 128, cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    const lit = "#" + [1, 3, 5].map(k => Math.min(255, Math.round(parseInt(base.substr(k, 2), 16) * 1.3 + 30)).toString(16).padStart(2, "0")).join("");
    const draw = () => {
      g.fillStyle = base; g.fillRect(0, 0, S, S);
      if (!img || !img.naturalWidth) return;
      g.globalAlpha = 0.2; g.drawImage(img, 0, 0, S, S);
      const c2 = document.createElement("canvas"); c2.width = c2.height = S;
      const h = c2.getContext("2d"); h.drawImage(img, 0, 0, S, S);
      h.globalCompositeOperation = "source-in"; h.fillStyle = lit; h.fillRect(0, 0, S, S);
      g.globalAlpha = 0.9; g.drawImage(c2, 0, 0); g.globalAlpha = 1;
    };
    draw();
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(1, rx), Math.max(1, ry));
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (img && !img.naturalWidth) img.addEventListener("load", () => { draw(); t.needsUpdate = true; });
    return t;
  }

  function skyTexture() {
    const cv = document.createElement("canvas");
    cv.width = 4; cv.height = 256;
    const g = cv.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#6ea6e8");
    grad.addColorStop(0.45, "#a9c9ee");
    grad.addColorStop(0.62, "#dbe7f1");
    grad.addColorStop(0.70, "#c7cdd2");
    grad.addColorStop(1, "#a9adb2");
    g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
    return new THREE.CanvasTexture(cv);
  }

  function ensureTextures(part, rebuild) {
    if (part.shape !== 1 || !part.matTop) return;
    const smooth = part.textureMode === "Smooth";
    if (smooth) {
      if (part.texTop) { part.texTop.dispose(); part.texTop = null; }
      if (part.texBot) { part.texBot.dispose(); part.texBot = null; }
      part.matTop.map = null; part.matBot.map = null;
      part.texMode = "Smooth";
      return;
    }
    if (rebuild || !part.texTop || part.texBot === null || part.texMode !== part.textureMode) {
      if (part.texTop) part.texTop.dispose();
      if (part.texBot) part.texBot.dispose();
      const css = hexOf(part.color);
      const rx = Math.max(1, part.size.x), rz = Math.max(1, part.size.z);
      part.texTop = studTexture(css, rx, rz, part.textureMode === "Inlet" ? inletImg : studImg);
      part.texBot = studTexture(css, rx, rz, inletImg);
      part.matTop.map = part.texTop;
      part.matBot.map = part.texBot;
      part.texMode = part.textureMode;
    } else {
      part.texTop.repeat.set(Math.max(1, part.size.x), Math.max(1, part.size.z));
      part.texBot.repeat.set(Math.max(1, part.size.x), Math.max(1, part.size.z));
    }
    part.matTop.needsUpdate = true;
    part.matBot.needsUpdate = true;
  }

  function applyLook(part, rebuildTextures) {
    const preset = MAT[part.materialName] || MAT.Plastic;
    const textured = part.shape === 1 && part.textureMode !== "Smooth";
    ensureTextures(part, rebuildTextures);
    const opacity = clamp((preset.glass ? 0.55 : 1) * (1 - part.transparent), 0.02, 1);
    const apply = (m, useMap) => {
      if (!m) return;
      m.color.setHex(useMap ? 0xffffff : part.color);
      m.roughness = preset.roughness;
      m.metalness = preset.metalness;
      if (m.emissive) m.emissive.setHex(preset.emissive ? part.color : 0x000000);
      m.emissiveIntensity = preset.emissive ? 0.8 : 0;
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = opacity > 0.55;
      m.needsUpdate = true;
    };
    apply(part.matSide, false);
    if (part.matTop) {
      apply(part.matTop, textured);
      apply(part.matBot, textured);
      part.matTop.map = textured ? part.texTop : null;
      part.matBot.map = textured ? part.texBot : null;
      part.matTop.needsUpdate = true;
      part.matBot.needsUpdate = true;
    }
    part.mesh.castShadow = opacity > 0.75;
    part.mesh.receiveShadow = true;
  }

  /* =====================================================================
     parts
     ===================================================================== */
  function makePartFromRow(row, index) {
    const size = new THREE.Vector3(+row[0] || 1, +row[1] || 1, +row[2] || 1);
    const pos = new THREE.Vector3(+row[3] || 0, +row[4] || 0, +row[5] || 0);
    const quat = quatFromRow(row[6]);
    const shape = row[10] === 0 || row[10] === 2 ? row[10] : 1;
    const part = {
      key: "part-" + (++partSeq),
      row, index, size, pos, quat, shape,
      color: (row[7] | 0) & 0xffffff,
      transparent: clamp(+row[8] || 0, 0, 1),
      collide: !(row[9] === 0 || row[9] === false),
      anchored: row[14] === 0 || row[14] === false ? false : true,
      materialName: MATERIALS.includes(row[11]) ? row[11] : "Plastic",
      textureMode: TEXTURES.includes(row[12]) ? row[12] : "Studs",
      name: typeof row[13] === "string" && row[13].trim() ? row[13].trim().slice(0, 40) : defaultName(index),
      texTop: null, texBot: null, texMode: null,
    };
    part.matSide = new THREE.MeshStandardMaterial();
    if (shape === 1) {
      part.matTop = new THREE.MeshStandardMaterial();
      part.matBot = new THREE.MeshStandardMaterial();
      part.mesh = new THREE.Mesh(GEO_BOX, [part.matSide, part.matSide, part.matTop, part.matBot, part.matSide, part.matSide]);
    } else {
      part.mesh = new THREE.Mesh(shape === 0 ? GEO_SPHERE : GEO_CYL, part.matSide);
    }
    part.mesh.position.copy(pos);
    part.mesh.quaternion.copy(quat);
    part.mesh.scale.copy(size);
    part.mesh.userData.part = part;
    part.className = part.name === "SpawnLocation" ? "SpawnLocation" : "Part";
    applyLook(part, true);
    world.add(part.mesh);
    return part;
  }

  function refreshTransform(part) {
    part.mesh.position.copy(part.pos);
    part.mesh.quaternion.copy(part.quat);
    part.mesh.scale.copy(part.size);
    if (part.matTop) ensureTextures(part, false);
    if (selected === part) {
      part.mesh.updateMatrixWorld(true);
      if (selBox) selBox.setFromObject(part.mesh);
      syncPropValues(part);
    }
    updateGizmo();
  }

  function writeRow(part) {
    const r = part.row;
    r[0] = round(part.size.x, 1000); r[1] = round(part.size.y, 1000); r[2] = round(part.size.z, 1000);
    r[3] = round(part.pos.x, 1000); r[4] = round(part.pos.y, 1000); r[5] = round(part.pos.z, 1000);
    r[6] = rowMajor(part.quat);
    r[7] = part.color;
    r[8] = round(part.transparent, 1000);
    r[9] = part.collide ? 1 : 0;
    r[10] = part.shape;
    r[11] = part.materialName;
    r[12] = part.textureMode;
    r[13] = part.name;
    r[14] = part.anchored ? 1 : 0;
    if (game && game.map && part.name === "SpawnLocation") {
      game.map.spawn = [round(part.pos.x, 1000), round(part.pos.y + part.size.y / 2 + 3, 1000), round(part.pos.z, 1000)];
    }
  }

  function disposePart(part) {
    const mats = [part.matSide, part.matTop, part.matBot];
    for (const m of mats) {
      if (!m) continue;
      if (m.map) m.map.dispose();
      m.dispose();
    }
  }

  function clearSelection() {
    if (selBox) {
      scene.remove(selBox);
      selBox.geometry.dispose();
      selBox.material.dispose();
      selBox = null;
    }
    selected = null;
    renderTree();
    renderProps();
    updateGizmo();
  }

  function buildWorld(map) {
    if (selBox) {
      scene.remove(selBox);
      selBox.geometry.dispose(); selBox.material.dispose(); selBox = null;
    }
    selected = null;
    while (world.children.length) {
      const c = world.children[0];
      world.remove(c);
      if (c.userData.part) disposePart(c.userData.part);
    }
    parts = [];
    for (const row of (map && map.parts) || []) {
      if (!Array.isArray(row) || row.length < 8) continue;
      parts.push(makePartFromRow(row, parts.length));
    }
    renderTree();
    renderProps();
    updateGizmo();
  }

  function selectPart(key) {
    const part = key ? parts.find(p => p.key === key) : null;
    if (selBox) {
      scene.remove(selBox);
      selBox.geometry.dispose(); selBox.material.dispose(); selBox = null;
    }
    selected = part || null;
    if (part) {
      selBox = new THREE.BoxHelper(part.mesh, 0x0d99ff);
      selBox.material.depthTest = false;
      selBox.material.transparent = true;
      selBox.renderOrder = 999;
      scene.add(selBox);
    }
    for (const b of $("stTree").querySelectorAll("[data-part]")) b.classList.toggle("on", !!part && b.dataset.part === part.key);
    renderProps();
    updateGizmo();
  }

  function addPart() {
    if (!game) return;
    camera.getWorldDirection(tmpDir);
    let x, z;
    if (tmpDir.y < -0.015) {
      const t = (0.5 - camera.position.y) / tmpDir.y;
      const p = camera.position.clone().addScaledVector(tmpDir, Math.min(t, 400));
      x = p.x; z = p.z;
    } else {
      const p = camera.position.clone().addScaledVector(tmpDir, 20);
      x = p.x; z = p.z;
    }
    x = Math.round(x); z = Math.round(z);
    let name = "Part", n = 1;
    while (parts.some(p => p.name === name)) { n++; name = "Part " + n; }
    const row = [4, 1, 2, x, 0.5, z, [1, 0, 0, 0, 1, 0, 0, 0, 1], 0xa3a2a5, 0, 1, 1, "Plastic", "Studs", name, 1];
    game.map.parts.push(row);
    const part = makePartFromRow(row, parts.length);
    parts.push(part);
    renderTree();
    selectPart(part.key);
    setTool("move");
    markDirty();
  }

  function deleteSelected() {
    if (!selected) return;
    const part = selected;
    const i = parts.indexOf(part);
    if (i < 0) return;
    const rowIndex = game.map.parts.indexOf(part.row);
    if (rowIndex >= 0) game.map.parts.splice(rowIndex, 1);
    world.remove(part.mesh);
    disposePart(part);
    parts.splice(i, 1);
    if (part.name === "SpawnLocation" && game.map) game.map.spawn = [0, 3, 0];
    clearSelection();
    markDirty();
  }

  /* =====================================================================
     explorer
     ===================================================================== */
  const TREE_ICON = '<svg class="rsTreeIco" viewBox="0 0 24 24"><path d="M4 9h16v10H4zM4 9l3-3h10l3 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  function renderTree() {
    const box = $("stTreeChildren");
    if (!box) return;
    box.innerHTML = parts.map(p => `<button class="rsTreeRow rsChild${selected === p ? " on" : ""}" type="button" data-part="${p.key}">${TREE_ICON}${esc(p.name)}</button>`).join("");
  }

  /* =====================================================================
     properties
     ===================================================================== */
  function vecRow(label, prefix, values, step) {
    return `<div class="rsPropRow"><span class="rsPropLabel">${label}</span><span class="rsVec">
      ${["x", "y", "z"].map((axis, i) => `<label>${axis.toUpperCase()}<input type="number" data-prop="${prefix}${axis}" step="${step}" value="${values[i]}"></label>`).join("")}
    </span></div>`;
  }

  function optionList(list, active) {
    return list.map(v => `<option value="${esc(v)}"${v === active ? " selected" : ""}>${esc(v)}</option>`).join("");
  }

  function renderProps() {
    const box = $("stProps");
    if (!selected) {
      box.innerHTML = '<div class="rsPropsEmpty">Select a part in the Explorer or click it in the viewport.</div>';
      return;
    }
    const p = selected;
    const e = new THREE.Euler().setFromQuaternion(p.quat, "XYZ");
    const deg = v => round(v * 180 / Math.PI, 10);
    box.innerHTML =
      `<div class="rsPropGroup">Data</div>`
      + `<div class="rsPropRow"><span class="rsPropLabel">Name</span><input type="text" data-prop="name" maxlength="40" value="${esc(p.name)}"></div>`
      + `<div class="rsPropRow"><span class="rsPropLabel">Class</span><span class="rsPropVal">${esc(p.className)}</span></div>`
      + `<div class="rsPropRow"><span class="rsPropLabel">Parent</span><span class="rsPropVal">Workspace</span></div>`
      + `<div class="rsPropGroup">Transform</div>`
      + vecRow("Position", "p", [round(p.pos.x, 1000), round(p.pos.y, 1000), round(p.pos.z, 1000)], 1)
      + vecRow("Size", "s", [round(p.size.x, 1000), round(p.size.y, 1000), round(p.size.z, 1000)], 0.5)
      + vecRow("Orientation", "r", [deg(e.x), deg(e.y), deg(e.z)], 5)
      + `<div class="rsPropGroup">Appearance</div>`
      + `<div class="rsPropRow"><span class="rsPropLabel">Color</span><span class="rsColorWrap"><input type="color" data-prop="color" value="${hexOf(p.color)}"><span class="rsHex" id="stHex">${hexOf(p.color)}</span></span></div>`
      + `<div class="rsPropRow"><span class="rsPropLabel">Material</span><select data-prop="material">${optionList(MATERIALS, p.materialName)}</select></div>`
      + `<div class="rsPropRow"><span class="rsPropLabel">Texture</span><select data-prop="texture">${optionList(TEXTURES, p.textureMode)}</select></div>`
      + `<div class="rsPropRow"><span class="rsPropLabel">Transparency</span><input type="number" data-prop="transparency" min="0" max="1" step="0.05" value="${round(p.transparent, 100)}"></div>`
      + `<div class="rsPropGroup">Behavior</div>`
      + `<div class="rsPropRow"><span class="rsPropLabel">Anchored</span><input type="checkbox" data-prop="anchored"${p.anchored ? " checked" : ""}></div>`
      + `<div class="rsPropRow"><span class="rsPropLabel">CanCollide</span><input type="checkbox" data-prop="collide"${p.collide ? " checked" : ""}></div>`;
  }

  function propInput(prop) { return $("stProps").querySelector(`[data-prop="${prop}"]`); }
  function setPropValue(prop, value, activeCheck) {
    const el = propInput(prop);
    if (!el) return;
    if (activeCheck && document.activeElement === el) return;
    if (el.type === "checkbox") el.checked = !!value;
    else el.value = value;
  }
  function syncPropValues(p) {
    if (!selected || selected !== p) return;
    const e = new THREE.Euler().setFromQuaternion(p.quat, "XYZ");
    const deg = v => round(v * 180 / Math.PI, 10);
    setPropValue("px", round(p.pos.x, 1000), true);
    setPropValue("py", round(p.pos.y, 1000), true);
    setPropValue("pz", round(p.pos.z, 1000), true);
    setPropValue("sx", round(p.size.x, 1000), true);
    setPropValue("sy", round(p.size.y, 1000), true);
    setPropValue("sz", round(p.size.z, 1000), true);
    setPropValue("rx", deg(e.x), true);
    setPropValue("ry", deg(e.y), true);
    setPropValue("rz", deg(e.z), true);
    setPropValue("color", hexOf(p.color), true);
    const hx = $("stHex"); if (hx) hx.textContent = hexOf(p.color);
  }

  function onPropInput(e) {
    const input = e.target;
    const prop = input.dataset ? input.dataset.prop : null;
    if (!prop || !selected) return;
    const part = selected;
    const num = (v, fallback) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; };
    if (prop === "name") {
      part.name = String(input.value || "").replace(/[\u0000-\u001f<>]/g, "").slice(0, 40);
      part.className = part.name === "SpawnLocation" ? "SpawnLocation" : "Part";
      renderTree();
    } else if (prop[0] === "p" && prop.length === 2) {
      const axis = "xyz".indexOf(prop[1]);
      part.pos.setComponent(axis, num(input.value, part.pos.getComponent(axis)));
      refreshTransform(part);
    } else if (prop[0] === "s" && prop.length === 2) {
      const axis = "xyz".indexOf(prop[1]);
      const v = clamp(num(input.value, part.size.getComponent(axis)), 0.1, 2048);
      part.size.setComponent(axis, v);
      refreshTransform(part);
    } else if (prop[0] === "r" && prop.length === 2) {
      const axis = "xyz".indexOf(prop[1]);
      const cur = new THREE.Euler().setFromQuaternion(part.quat, "XYZ");
      const values = [cur.x, cur.y, cur.z];
      values[axis] = num(input.value, values[axis] * 180 / Math.PI) * Math.PI / 180;
      part.quat.setFromEuler(new THREE.Euler(values[0], values[1], values[2], "XYZ"));
      refreshTransform(part);
    } else if (prop === "color") {
      part.color = parseInt(String(input.value).replace("#", ""), 16) || 0;
      const hx = $("stHex"); if (hx) hx.textContent = hexOf(part.color);
      part.matSide.color.setHex(part.color);
      clearTimeout(colorTimer);
      colorTimer = setTimeout(() => { applyLook(part, true); }, 70);
    } else if (prop === "material") {
      part.materialName = MAT[input.value] ? input.value : "Plastic";
      applyLook(part, false);
    } else if (prop === "texture") {
      part.textureMode = TEXTURES.includes(input.value) ? input.value : "Studs";
      applyLook(part, true);
    } else if (prop === "transparency") {
      part.transparent = clamp(num(input.value, part.transparent), 0, 1);
      applyLook(part, false);
    } else if (prop === "anchored") {
      part.anchored = !!input.checked;
    } else if (prop === "collide") {
      part.collide = !!input.checked;
    }
    writeRow(part);
    markDirty();
  }

  /* =====================================================================
     scene
     ===================================================================== */
  function init() {
    if (renderer) return;
    const canvas = $("stCanvas");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x9ec7f5, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = skyTexture();
    scene.fog = new THREE.Fog(0xc7d4de, 340, 900);

    camera = new THREE.PerspectiveCamera(70, 1, 0.1, 4000);
    camera.rotation.order = "YXZ";

    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x77777f, 0.75));
    const sun = new THREE.DirectionalLight(0xfff3dd, 0.7);
    sun.position.set(140, 260, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -340; sc.right = 340; sc.top = 340; sc.bottom = -340; sc.near = 10; sc.far = 900;
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.12));

    world = new THREE.Group();
    world.name = "Workspace";
    scene.add(world);

    studImg = new Image(); studImg.src = "assets/textures/stud.png";
    inletImg = new Image(); inletImg.src = "assets/textures/inlet.png";

    clock = new THREE.Clock();
    initAxis();
    buildGizmo();
    bindInput();
    bindUi();
    layout = loadLayout();
    resize();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) {
      new ResizeObserver(resize).observe($("stViewport"));
      new ResizeObserver(() => saveLayoutDebounced()).observe($("stPropsPanel"));
    }
    window.addEventListener("beforeunload", () => { if (running) save(true); });
  }

  function initAxis() {
    const canvas = $("stAxisCanvas");
    axisRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    axisRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    axisRenderer.setSize(108, 108, false);
    axisScene = new THREE.Scene();
    axisCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
    axisCamera.position.set(3.1, 2.35, 4.2);
    axisCamera.lookAt(0, 0, 0);

    const group = new THREE.Group();
    axisGroup = group;
    const boxGeo = new THREE.BoxGeometry(1.35, 1.35, 1.35);
    group.add(new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xe4e4e4, transparent: true, opacity: 0.13, depthWrite: false })));
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), new THREE.LineBasicMaterial({ color: 0xc2c2c2, transparent: true, opacity: 0.55 })));

    const axes = [
      [new THREE.Vector3(1, 0, 0), 0xff5b57, "X"],
      [new THREE.Vector3(0, 1, 0), 0x62c96b, "Y"],
      [new THREE.Vector3(0, 0, 1), 0x4f9dff, "Z"],
    ];
    for (const [dir, color, label] of axes) {
      const len = 1.78;
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(len)]);
      group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 12), new THREE.MeshBasicMaterial({ color }));
      cone.position.copy(dir).multiplyScalar(len);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      group.add(cone);
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const g = c.getContext("2d");
      g.font = "600 40px Inter, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = "#" + color.toString(16).padStart(6, "0"); g.fillText(label, 32, 33);
      const tex = new THREE.CanvasTexture(c);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      sprite.position.copy(dir).multiplyScalar(len + 0.36);
      sprite.scale.set(0.52, 0.52, 0.52);
      group.add(sprite);
    }
    axisScene.add(group);
  }

  function resize() {
    if (!renderer) return;
    const vp = $("stViewport");
    const w = Math.max(1, vp.clientWidth || window.innerWidth);
    const h = Math.max(1, vp.clientHeight || window.innerHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* =====================================================================
     gizmo
     ===================================================================== */
  function gizmoMaterial(color) {
    return new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
  }
  function orientHandle(group, axis) {
    if (axis === 0) group.rotation.z = -Math.PI / 2;
    else if (axis === 2) group.rotation.x = Math.PI / 2;
  }
  function createHandle(mode, axis, color) {
    const group = new THREE.Group();
    const mat = gizmoMaterial(color);
    if (mode === "rotate") {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.055, 8, 64), mat);
      if (axis === 0) ring.rotation.y = Math.PI / 2;
      else if (axis === 1) ring.rotation.x = Math.PI / 2;
      ring.renderOrder = 1005;
      group.add(ring);
    } else {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, mode === "move" ? 1.05 : 0.92, 8), mat);
      shaft.position.y = mode === "move" ? 0.55 : 0.5;
      shaft.renderOrder = 1005;
      group.add(shaft);
      if (mode === "move") {
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 12), mat);
        head.position.y = 1.2;
        head.renderOrder = 1005;
        group.add(head);
      } else {
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat);
        head.position.y = 1.04;
        head.renderOrder = 1005;
        group.add(head);
      }
      orientHandle(group, axis);
    }
    group.userData.mode = mode;
    group.userData.axis = axis;
    return group;
  }
  function buildGizmo() {
    gizmo = new THREE.Group();
    gizmo.visible = false;
    const colors = [0xff4d4d, 0x5ad469, 0x4d9dff];
    for (const mode of ["move", "scale", "rotate"]) {
      const group = new THREE.Group();
      group.visible = false;
      for (let axis = 0; axis < 3; axis++) group.add(createHandle(mode, axis, colors[axis]));
      gizmoModes[mode] = group;
      gizmo.add(group);
    }
    scene.add(gizmo);
  }
  function updateGizmo() {
    if (!gizmo) return;
    const show = running && !!selected && tool !== "select";
    gizmo.visible = show;
    if (!show) return;
    gizmo.position.copy(selected.pos);
    gizmo.quaternion.copy(selected.quat);
    gizmo.scale.setScalar(Math.max(0.6, camera.position.distanceTo(selected.pos) * 0.12));
    for (const mode of Object.keys(gizmoModes)) gizmoModes[mode].visible = mode === tool;
  }
  function handleFromObject(obj) {
    let o = obj;
    while (o && o !== gizmo) {
      if (o.userData && o.userData.mode === tool && o.userData.axis !== undefined) return o;
      o = o.parent;
    }
    return null;
  }
  function setRay(e) {
    const rect = $("stCanvas").getBoundingClientRect();
    ndc.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function pickGizmo(e) {
    if (!gizmo || !gizmo.visible) return null;
    setRay(e);
    const hits = ray.intersectObject(gizmo, true);
    for (const hit of hits) {
      const handle = handleFromObject(hit.object);
      if (handle) return handle;
    }
    return null;
  }
  function axisParam(origin, dir) {
    const r = ray.ray;
    const b = dir.dot(r.direction);
    const w0 = origin.clone().sub(r.origin);
    const den = 1 - b * b;
    if (Math.abs(den) < 1e-4) return null;
    return (b * r.direction.dot(w0) - dir.dot(w0)) / den;
  }
  function axisBasis(axis) {
    const ref = Math.abs(axis.x) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const u = ref.clone().addScaledVector(axis, -ref.dot(axis)).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    return { u, v };
  }
  function angleAround(point, center, basis) {
    const d = point.clone().sub(center);
    return Math.atan2(d.dot(basis.v), d.dot(basis.u));
  }
  function startGizmoDrag(handle, e) {
    if (!selected) return false;
    const part = selected;
    const axis = new THREE.Vector3();
    axis.setComponent(handle.userData.axis, 1);
    axis.applyQuaternion(part.quat).normalize();
    setRay(e);
    if (tool === "rotate") {
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, part.pos);
      const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) return false;
      const basis = axisBasis(axis);
      gizmoDrag = { kind: "rotate", part, axis, axisIndex: handle.userData.axis, plane, basis, startAngle: angleAround(hit, part.pos, basis), startQuat: part.quat.clone() };
    } else {
      const s0 = axisParam(part.pos.clone(), axis);
      if (s0 === null) return false;
      gizmoDrag = { kind: tool, part, axis, axisIndex: handle.userData.axis, startPos: part.pos.clone(), startSize: part.size.clone(), s0 };
    }
    return true;
  }
  function updateGizmoDrag(e) {
    const g = gizmoDrag;
    if (!g) return;
    const part = g.part;
    setRay(e);
    if (g.kind === "rotate") {
      const hit = ray.ray.intersectPlane(g.plane, new THREE.Vector3());
      if (!hit) return;
      let delta = angleAround(hit, part.pos, g.basis) - g.startAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const snap = (e.shiftKey ? 1 : 5) * Math.PI / 180;
      delta = Math.round(delta / snap) * snap;
      const q = new THREE.Quaternion().setFromAxisAngle(g.axis, delta);
      part.quat.copy(q).multiply(g.startQuat).normalize();
    } else {
      const s = axisParam(g.kind === "move" ? g.startPos : part.pos, g.axis);
      if (s === null) return;
      let d = s - g.s0;
      if (g.kind === "move") {
        const step = e.shiftKey ? 0.1 : 1;
        d = Math.round(d / step) * step;
        part.pos.copy(g.startPos).addScaledVector(g.axis, d);
      } else {
        const step = e.shiftKey ? 0.1 : 0.5;
        let n = g.startSize.getComponent(g.axisIndex) + d;
        n = Math.max(0.1, Math.round(n / step) * step);
        part.size.setComponent(g.axisIndex, n);
      }
    }
    refreshTransform(part);
    writeRow(part);
    markDirty();
  }

  /* =====================================================================
     camera / input
     ===================================================================== */
  function resetCamera() {
    yaw = 0; pitch = -0.36;
    camera.position.set(0, 26, 42);
    camera.rotation.set(pitch, yaw, 0);
  }
  function pickAt(clientX, clientY) {
    const rect = $("stCanvas").getBoundingClientRect();
    ndc.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(world.children.filter(m => m.isMesh), false);
    selectPart(hits.length ? hits[0].object.userData.part.key : null);
  }
  function bindInput() {
    const canvas = $("stCanvas");
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    canvas.addEventListener("pointerdown", e => {
      if (!running || (e.button !== 0 && e.button !== 1 && e.button !== 2)) return;
      e.preventDefault();
      if (e.button === 0 && tool !== "select" && selected) {
        const handle = pickGizmo(e);
        if (handle && startGizmoDrag(handle, e)) {
          down = { button: 0, x: e.clientX, y: e.clientY, moved: true };
          drag = null;
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          canvas.classList.add("grabbing");
          return;
        }
      }
      drag = { button: e.button, x: e.clientX, y: e.clientY };
      down = { button: e.button, x: e.clientX, y: e.clientY, moved: false };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      canvas.classList.add("grabbing");
    });
    canvas.addEventListener("pointermove", e => {
      if (!running) return;
      if (gizmoDrag) { updateGizmoDrag(e); return; }
      if (!drag) {
        if (tool !== "select" && selected) canvas.style.cursor = pickGizmo(e) ? "pointer" : "";
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (down && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 5) down.moved = true;
      if (drag.button === 2 || drag.button === 0) {
        yaw -= dx * 0.0045;
        pitch -= dy * 0.0045;
        const lim = Math.PI / 2 - 0.03;
        pitch = Math.max(-lim, Math.min(lim, pitch));
      } else {
        camera.getWorldDirection(tmpDir);
        tmpRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
        camera.position.addScaledVector(tmpRight, -dx * 0.055);
        camera.position.y += dy * 0.055;
      }
    });
    const stop = e => {
      if (!drag && !gizmoDrag) return;
      const wasClick = down && down.button === 0 && !down.moved && !gizmoDrag;
      const wasGizmo = !!gizmoDrag;
      gizmoDrag = null;
      drag = null; down = null;
      canvas.classList.remove("grabbing");
      canvas.style.cursor = "";
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      if (wasGizmo) return;
      if (wasClick && running) pickAt(e.clientX, e.clientY);
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("wheel", e => {
      if (!running) return;
      e.preventDefault();
      camera.getWorldDirection(tmpDir);
      camera.position.addScaledVector(tmpDir, -e.deltaY * 0.035);
    }, { passive: false });

    window.addEventListener("keydown", e => {
      if (!running) return;
      const tag = (e.target && e.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || (e.target && e.target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
      if (e.key === "Escape") { closeMenus(); return; }
      if (typing) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); deleteSelected(); return; }
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "q", "e", " ", "shift", "control"].includes(k)) e.preventDefault();
      keys.add(k);
    });
    window.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => keys.clear());
  }

  function step(dt) {
    camera.rotation.set(pitch, yaw, 0);
    camera.getWorldDirection(tmpDir);
    tmpRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const boost = keys.has("shift") ? 3 : 1;
    const amount = speed * boost * dt;
    let moved = false;
    if (keys.has("w")) { camera.position.addScaledVector(tmpDir, amount); moved = true; }
    if (keys.has("s")) { camera.position.addScaledVector(tmpDir, -amount); moved = true; }
    if (keys.has("d")) { camera.position.addScaledVector(tmpRight, amount); moved = true; }
    if (keys.has("a")) { camera.position.addScaledVector(tmpRight, -amount); moved = true; }
    if (keys.has("e") || keys.has(" ")) { camera.position.y += amount; moved = true; }
    if (keys.has("q") || keys.has("control")) { camera.position.y -= amount; moved = true; }
    if (moved) camera.position.y = Math.max(-40, camera.position.y);
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!running) return;
    const dt = Math.min(0.05, clock.getDelta());
    step(dt);
    updateGizmo();
    renderer.render(scene, camera);
    if (axisGroup) axisGroup.quaternion.copy(camera.quaternion).invert();
    axisRenderer.render(axisScene, axisCamera);
  }

  /* =====================================================================
     layout / panels
     ===================================================================== */
  function loadLayout() {
    try { return JSON.parse(localStorage.getItem(LAYOUT_LS) || "{}") || {}; } catch (_) { return {}; }
  }
  function saveLayoutNow() {
    if (!running) return;
    const panel = $("stPropsPanel");
    const float = panel.classList.contains("rsFloating");
    const rect = float ? panel.getBoundingClientRect() : null;
    layout = {
      dockWidth: $("stDock").hidden ? (layout.dockWidth || null) : Math.round($("stDock").getBoundingClientRect().width),
      explorerHeight: $("stExplorerPanel").hidden ? (layout.explorerHeight || null) : Math.round($("stExplorerPanel").getBoundingClientRect().height),
      propsFloat: float && rect ? { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
    };
    try { localStorage.setItem(LAYOUT_LS, JSON.stringify(layout)); } catch (_) {}
  }
  function saveLayoutDebounced() {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(saveLayoutNow, 180);
  }
  function updateSplit() {
    $("stDockSplit").hidden = !(explorerOn && propsOn && !$("stPropsPanel").classList.contains("rsFloating"));
  }
  function updateDockVisibility() {
    const floating = $("stPropsPanel").classList.contains("rsFloating");
    const dockedProps = propsOn && !floating;
    const hasDock = explorerOn || dockedProps;
    $("stDock").hidden = !hasDock;
    $("stDockGrip").hidden = !hasDock;
    updateSplit();
  }
  function setPanel(which, show) {
    if (which === "explorer") {
      explorerOn = show;
      $("stExplorerPanel").hidden = !show;
      $("stToolExplorer").classList.toggle("on", show);
    } else {
      propsOn = show;
      $("stPropsPanel").hidden = !show;
      $("stToolProps").classList.toggle("on", show);
    }
    updateDockVisibility();
    saveLayoutDebounced();
  }

  function setFloating(on, rect) {
    const panel = $("stPropsPanel");
    const dock = $("stDock");
    const editor = document.querySelector(".rsEditor");
    if (on) {
      if (panel.parentElement !== editor) editor.appendChild(panel);
      panel.classList.add("rsFloating");
      const w = clamp(rect && rect.width || 300, 220, Math.max(220, window.innerWidth - 30));
      const h = clamp(rect && rect.height || 360, 150, Math.max(150, window.innerHeight - 30));
      const left = clamp(rect && rect.left !== undefined ? rect.left : window.innerWidth - w - 40, 0, Math.max(0, window.innerWidth - w));
      const top = clamp(rect && rect.top !== undefined ? rect.top : window.innerHeight - h - 80, 0, Math.max(0, window.innerHeight - h));
      panel.style.width = w + "px";
      panel.style.height = h + "px";
      panel.style.left = left + "px";
      panel.style.top = top + "px";
      $("stPropsDock").hidden = false;
    } else {
      panel.classList.remove("rsFloating");
      panel.style.left = panel.style.top = panel.style.width = panel.style.height = "";
      if (panel.parentElement !== dock) dock.appendChild(panel);
      $("stPropsDock").hidden = true;
    }
    panel.hidden = !propsOn;
    updateDockVisibility();
  }

  function applyLayout() {
    layout = loadLayout();
    const dock = $("stDock");
    const explorer = $("stExplorerPanel");
    if (layout.dockWidth) dock.style.width = clamp(layout.dockWidth, 240, 560) + "px";
    if (layout.explorerHeight) explorer.style.flex = "0 0 " + clamp(layout.explorerHeight, 80, 700) + "px";
    if (layout.propsFloat) setFloating(true, layout.propsFloat);
    else setFloating(false);
    updateDockVisibility();
  }

  function resetLayout() {
    try { localStorage.removeItem(LAYOUT_LS); } catch (_) {}
    layout = {};
    $("stDock").style.width = "";
    $("stExplorerPanel").style.flex = "";
    setFloating(false);
    setPanel("explorer", true);
    setPanel("props", true);
    resize();
  }

  function bindLayout() {
    const grip = $("stDockGrip");
    let dockDrag = null;
    grip.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault();
      dockDrag = { x: e.clientX, w: $("stDock").getBoundingClientRect().width };
      grip.classList.add("dragging");
      try { grip.setPointerCapture(e.pointerId); } catch (_) {}
    });
    grip.addEventListener("pointermove", e => {
      if (!dockDrag) return;
      const w = clamp(dockDrag.w - (e.clientX - dockDrag.x), 240, 560);
      $("stDock").style.width = Math.round(w) + "px";
      resize();
    });
    const endDock = () => { if (dockDrag) { dockDrag = null; grip.classList.remove("dragging"); resize(); saveLayoutDebounced(); } };
    grip.addEventListener("pointerup", endDock);
    grip.addEventListener("pointercancel", endDock);

    const split = $("stDockSplit");
    let splitDrag = null;
    split.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault();
      splitDrag = { y: e.clientY, h: $("stExplorerPanel").getBoundingClientRect().height };
      split.classList.add("dragging");
      try { split.setPointerCapture(e.pointerId); } catch (_) {}
    });
    split.addEventListener("pointermove", e => {
      if (!splitDrag) return;
      const max = $("stDock").clientHeight - 110;
      const h = clamp(splitDrag.h + (e.clientY - splitDrag.y), 80, Math.max(90, max));
      $("stExplorerPanel").style.flex = "0 0 " + Math.round(h) + "px";
    });
    const endSplit = () => { if (splitDrag) { splitDrag = null; split.classList.remove("dragging"); saveLayoutDebounced(); } };
    split.addEventListener("pointerup", endSplit);
    split.addEventListener("pointercancel", endSplit);

    const head = $("stPropsHead");
    let floatDrag = null;
    head.addEventListener("pointerdown", e => {
      if (e.button !== 0 || e.target.closest("button")) return;
      const panel = $("stPropsPanel");
      floatDrag = { x: e.clientX, y: e.clientY, rect: panel.getBoundingClientRect(), active: panel.classList.contains("rsFloating") };
      try { head.setPointerCapture(e.pointerId); } catch (_) {}
    });
    head.addEventListener("pointermove", e => {
      if (!floatDrag) return;
      const dx = e.clientX - floatDrag.x, dy = e.clientY - floatDrag.y;
      if (!floatDrag.active && Math.abs(dx) + Math.abs(dy) > 4) {
        setFloating(true, floatDrag.rect);
        floatDrag.active = true;
      }
      if (!floatDrag.active) return;
      const panel = $("stPropsPanel");
      const w = panel.offsetWidth, h = panel.offsetHeight;
      panel.style.left = clamp(floatDrag.rect.left + dx, 0, Math.max(0, window.innerWidth - w)) + "px";
      panel.style.top = clamp(floatDrag.rect.top + dy, 0, Math.max(0, window.innerHeight - h)) + "px";
    });
    const endFloat = () => {
      if (!floatDrag) return;
      if (floatDrag.active) {
        const panel = $("stPropsPanel");
        const pr = panel.getBoundingClientRect();
        const dr = $("stDock").getBoundingClientRect();
        if (!$("stDock").hidden && pr.left + pr.width / 2 > dr.left) setFloating(false);
      }
      floatDrag = null;
      saveLayoutDebounced();
    };
    head.addEventListener("pointerup", endFloat);
    head.addEventListener("pointercancel", endFloat);
    head.addEventListener("dblclick", e => {
      if (e.target.closest("button")) return;
      setFloating(!$("stPropsPanel").classList.contains("rsFloating"));
      saveLayoutDebounced();
    });
    $("stPropsDock").addEventListener("click", () => {
      setFloating(false);
      saveLayoutDebounced();
    });
  }

  /* =====================================================================
     menus / ribbon
     ===================================================================== */
  function setTool(name) {
    tool = ["select", "move", "scale", "rotate"].includes(name) ? name : "select";
    for (const b of document.querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool === tool);
    updateGizmo();
  }
  function setRibbonTab(name) {
    for (const b of document.querySelectorAll("[data-rtab]")) b.classList.toggle("on", b.dataset.rtab === name);
    $("stRibbonHome").hidden = name !== "home";
    $("stRibbonSoon").hidden = name === "home";
  }
  function closeMenus() {
    for (const d of document.querySelectorAll(".rsDrop")) d.hidden = true;
    for (const b of document.querySelectorAll(".rsMenus button")) b.classList.remove("open");
  }
  function openMenu(button) {
    const name = button.dataset.menu;
    const drop = $("stDrop" + name.charAt(0).toUpperCase() + name.slice(1));
    if (!drop) return;
    const wasOpen = !drop.hidden;
    closeMenus();
    if (wasOpen) return;
    const bar = document.querySelector(".rsMenubar").getBoundingClientRect();
    const r = button.getBoundingClientRect();
    drop.style.left = Math.max(4, r.left - bar.left) + "px";
    drop.hidden = false;
    button.classList.add("open");
  }
  function doAction(act) {
    if (act === "save") save();
    else if (act === "saveExit" || act === "exit") close();
    else if (act === "toggleExplorer") setPanel("explorer", !explorerOn);
    else if (act === "toggleProps") setPanel("props", !propsOn);
    else if (act === "resetCamera") resetCamera();
    else if (act === "resetLayout") resetLayout();
    else if (act === "controls") StudioUI.cameraHelp();
    else if (act === "about") StudioUI.about();
  }
  function bindUi() {
    if (bound) return;
    bound = true;
    for (const b of document.querySelectorAll(".rsMenus button")) {
      b.addEventListener("click", e => { e.stopPropagation(); openMenu(b); });
    }
    for (const drop of document.querySelectorAll(".rsDrop")) {
      drop.addEventListener("click", e => {
        const b = e.target.closest("[data-act]");
        if (!b || b.disabled) return;
        closeMenus();
        doAction(b.dataset.act);
      });
    }
    document.addEventListener("pointerdown", e => { if (!e.target.closest(".rsMenubar")) closeMenus(); });

    for (const b of document.querySelectorAll("[data-rtab]")) b.addEventListener("click", () => setRibbonTab(b.dataset.rtab));
    for (const b of document.querySelectorAll("[data-tool]")) b.addEventListener("click", () => setTool(b.dataset.tool));
    $("stToolPart").addEventListener("click", addPart);
    $("stToolExplorer").addEventListener("click", () => setPanel("explorer", !explorerOn));
    $("stToolProps").addEventListener("click", () => setPanel("props", !propsOn));
    $("stToolSave").addEventListener("click", () => save());
    $("stToolHome").addEventListener("click", () => close());
    $("stBack").addEventListener("click", () => close());
    $("stToolCamera").addEventListener("click", () => resetCamera());

    $("stTree").addEventListener("click", e => {
      const b = e.target.closest("[data-part]");
      if (b) selectPart(b.dataset.part);
    });
    $("stProps").addEventListener("input", onPropInput);

    $("stName").addEventListener("input", markDirty);
    $("stName").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.target.blur(); save(); }
    });
    bindLayout();
  }

  /* =====================================================================
     open / save / close
     ===================================================================== */
  function thumbnail() {
    if (!renderer) return "";
    try {
      const prevVisible = gizmo ? gizmo.visible : false;
      const prevSel = selBox ? selBox.visible : false;
      if (gizmo) gizmo.visible = false;
      if (selBox) selBox.visible = false;
      renderer.render(scene, camera);
      if (gizmo) gizmo.visible = prevVisible;
      if (selBox) selBox.visible = prevSel;
      const src = renderer.domElement;
      const out = document.createElement("canvas");
      out.width = 480; out.height = 270;
      const g = out.getContext("2d");
      const sw = src.width, sh = src.height, want = out.width / out.height;
      let cw = sw, ch = Math.round(sw / want);
      if (ch > sh) { ch = sh; cw = Math.round(sh * want); }
      g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, out.width, out.height);
      return out.toDataURL("image/jpeg", 0.72);
    } catch (_) {
      return game && game.thumb ? game.thumb : "";
    }
  }

  function save(quiet) {
    if (!game) return;
    const clean = studioCleanName($("stName").value) || game.name || "Untitled game";
    $("stName").value = clean;
    game.name = clean;
    document.title = clean + " - Triancle Studio";
    for (const p of parts) writeRow(p);
    game.updated = Date.now();
    const thumb = thumbnail();
    if (thumb) game.thumb = thumb;
    const ok = studioUpsert(game);
    dirty = false;
    paintStatus(ok ? "saved" : "error");
    if (!quiet && ok) paintStatus("saved");
  }

  function open(g) {
    init();
    game = g;
    document.title = (g.name || "Untitled game") + " - Triancle Studio";
    $("stName").value = g.name || "Untitled game";
    buildWorld(g.map);
    resetCamera();
    dirty = false;
    paintStatus("saved");
    $("stLoading").hidden = true;
    $("stMenu").hidden = true;
    $("stEditor").hidden = false;
    running = true;
    setTool("select");
    setRibbonTab("home");
    closeMenus();
    applyLayout();
    setPanel("explorer", true);
    setPanel("props", true);
    clock.getDelta();
    resize();
    if (!raf) raf = requestAnimationFrame(loop);
    clearInterval(autoSave);
    autoSave = setInterval(() => { if (running && dirty) save(true); }, 15000);
  }

  function close(saveNow) {
    if (!running) return;
    if (saveNow !== false) save(true);
    saveLayoutNow();
    running = false;
    clearInterval(autoSave);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    drag = null; down = null; gizmoDrag = null; keys.clear();
    closeMenus();
    $("stEditor").hidden = true;
    $("stMenu").hidden = false;
    document.title = "Triancle Studio";
    if (typeof StudioEditor.onExit === "function") StudioEditor.onExit();
  }

  const api = {
    open,
    close,
    save,
    onExit: null,
    isOpen: () => running,
    get game() { return game; },
  };
  return api;
})();
