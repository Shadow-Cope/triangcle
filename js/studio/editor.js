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
  let playing = false, playCam = null;

  const keys = new Set();
  const tmpDir = new THREE.Vector3();
  const tmpRight = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const GEO_BOX = new THREE.BoxGeometry(1, 1, 1);
  const GEO_SPHERE = new THREE.SphereGeometry(0.5, 24, 16);
  const GEO_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); GEO_CYL.rotateZ(Math.PI / 2);

  /* shapes: 0 ball, 1 block, 2 cylinder, 3 wedge, 4 corner wedge */
  const SHAPES = ["Ball", "Block", "Cylinder", "Wedge", "Corner wedge"];
  function shapeGeometry(corner) {
    const w = [
      -0.5, -0.5, -0.5,  0.5, -0.5, -0.5,  0.5, -0.5, 0.5,
      -0.5, -0.5, -0.5,  0.5, -0.5, 0.5,  -0.5, -0.5, 0.5,
      -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,  0.5, 0.5, -0.5,
      -0.5, -0.5, -0.5,  0.5, 0.5, -0.5,  0.5, -0.5, -0.5,
      -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5,
      0.5, -0.5, -0.5,  0.5, 0.5, -0.5,  0.5, -0.5, 0.5,
      -0.5, 0.5, -0.5, -0.5, -0.5, 0.5,  0.5, -0.5, 0.5,
      -0.5, 0.5, -0.5,  0.5, -0.5, 0.5,  0.5, 0.5, -0.5,
    ];
    const c = [
      -0.5, -0.5, -0.5,  0.5, -0.5, -0.5,  0.5, -0.5, 0.5,
      -0.5, -0.5, -0.5,  0.5, -0.5, 0.5,  -0.5, -0.5, 0.5,
      -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,  0.5, -0.5, -0.5,
      -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5,
      -0.5, 0.5, -0.5,  0.5, -0.5, 0.5,  0.5, -0.5, -0.5,
      -0.5, 0.5, -0.5, -0.5, -0.5, 0.5,  0.5, -0.5, 0.5,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(corner ? c : w, 3));
    g.computeVertexNormals();
    return g;
  }
  const GEO_WEDGE = shapeGeometry(false);
  const GEO_CORNER = shapeGeometry(true);
  const SHAPE_GEO = [GEO_SPHERE, GEO_BOX, GEO_CYL, GEO_WEDGE, GEO_CORNER];

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
  function markDirty() { dirty = true; paintStatus("dirty"); queueHistory(); }

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
    const shape = [0, 1, 2, 3, 4].includes(row[10]) ? row[10] : 1;
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
    buildMesh(part);
    part.mesh.position.copy(pos);
    part.mesh.quaternion.copy(quat);
    part.mesh.scale.copy(size);
    part.mesh.userData.part = part;
    part.className = part.name === "SpawnLocation" ? "SpawnLocation" : "Part";
    applyLook(part, true);
    world.add(part.mesh);
    return part;
  }

  function buildMesh(part) {
    part.matSide = new THREE.MeshStandardMaterial();
    part.matTop = null; part.matBot = null;
    if (part.shape === 1) {
      part.matTop = new THREE.MeshStandardMaterial();
      part.matBot = new THREE.MeshStandardMaterial();
      part.mesh = new THREE.Mesh(GEO_BOX, [part.matSide, part.matSide, part.matTop, part.matBot, part.matSide, part.matSide]);
    } else {
      part.mesh = new THREE.Mesh(SHAPE_GEO[part.shape] || GEO_BOX, part.matSide);
    }
  }

  function setPartShape(part, shape) {
    shape = [0, 1, 2, 3, 4].includes(shape) ? shape : 1;
    if (part.shape === shape) return;
    world.remove(part.mesh);
    disposePart(part);
    part.shape = shape;
    part.texTop = null; part.texBot = null; part.texMode = null;
    buildMesh(part);
    part.mesh.position.copy(part.pos);
    part.mesh.quaternion.copy(part.quat);
    part.mesh.scale.copy(part.size);
    part.mesh.userData.part = part;
    applyLook(part, true);
    world.add(part.mesh);
    refreshTransform(part);
    writeRow(part);
    renderProps();
    markDirty();
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
    dropSelBox();
    selected = null;
    selGui = null;
    selService = null;
    renderTree();
    renderProps();
    renderGui();
    updateGizmo();
    syncEditMenu();
  }

  function buildWorld(map) {
    ensureGui();
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
    selGui = null;
    selService = null;
    if (part) {
      selBox = new THREE.BoxHelper(part.mesh, 0x0d99ff);
      selBox.material.depthTest = false;
      selBox.material.transparent = true;
      selBox.renderOrder = 999;
      scene.add(selBox);
    }
    for (const b of $("stTree").querySelectorAll("[data-part]")) b.classList.toggle("on", !!part && b.dataset.part === part.key);
    renderProps();
    renderGui();
    updateGizmo();
    syncEditMenu();
  }

  function addPart(shapePick) {
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
    const pick = $("stToolShape");
    const shape = [0, 1, 2, 3, 4].includes(+shapePick) ? +shapePick
      : pick && [0, 1, 2, 3, 4].includes(+pick.value) ? +pick.value : 1;
    const base = ["Ball", "Part", "Cylinder", "Wedge", "Corner"][shape] || "Part";
    let name = base, n = 1;
    while (parts.some(p => p.name === name)) { n++; name = base + " " + n; }
    const row = [4, 1, 2, x, 0.5, z, [1, 0, 0, 0, 1, 0, 0, 0, 1], 0xa3a2a5, 0, 1, shape, "Plastic", "Studs", name, 1];
    game.map.parts.push(row);
    const part = makePartFromRow(row, parts.length);
    parts.push(part);
    renderTree();
    selectPart(part.key);
    setTool("move");
    markDirty();
  }

  function deleteSelected() {
    if (selGui) { removeGui(selGui); return; }
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
     undo / redo / cut / copy / paste
     ===================================================================== */
  const HISTORY_MAX = 80;
  let undoStack = [], redoStack = [], clip = null, baseline = null, applying = false, histTimer = 0;

  function snapshot() {
    if (!game || !game.map) return "{}";
    return JSON.stringify({
      spawn: game.map.spawn || [0, 3, 0],
      parts: game.map.parts || [],
      gui: game.map.gui || [],
      replicatedStorage: game.map.replicatedStorage || [],
      workspaceScripts: game.map.workspaceScripts || [],
      vars: game.map.vars || {},
    });
  }

  function resetHistory() {
    if (histTimer) { clearTimeout(histTimer); histTimer = 0; }
    undoStack = []; redoStack = [];
    baseline = snapshot();
    syncEditMenu();
  }

  function queueHistory() {
    if (applying || playing || !game) return;
    if (histTimer) clearTimeout(histTimer);
    histTimer = setTimeout(commitHistory, 450);
  }

  function commitHistory() {
    if (histTimer) { clearTimeout(histTimer); histTimer = 0; }
    if (!game || applying) return;
    const cur = snapshot();
    if (baseline === null) { baseline = cur; return; }
    if (cur === baseline) return;
    undoStack.push(baseline);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack = [];
    baseline = cur;
    syncEditMenu();
  }

  function applySnapshot(json) {
    let data = null;
    try { data = JSON.parse(json); } catch (_) { return; }
    if (!data || !Array.isArray(data.parts)) return;
    applying = true;
    try {
      game.map.parts = data.parts;
      game.map.gui = Array.isArray(data.gui) ? data.gui : [];
      game.map.replicatedStorage = Array.isArray(data.replicatedStorage) ? data.replicatedStorage : [];
      game.map.workspaceScripts = Array.isArray(data.workspaceScripts) ? data.workspaceScripts : [];
      game.map.vars = data.vars && typeof data.vars === "object" && !Array.isArray(data.vars) ? data.vars : {};
      if (Array.isArray(data.spawn)) game.map.spawn = data.spawn;
      selGui = null; selService = null;
      buildWorld(game.map);
      renderTree();
      renderGui();
    } finally { applying = false; }
    dirty = true;
    paintStatus("dirty");
    renderProps();
    syncEditMenu();
  }

  function undo() {
    if (!game || playing) return;
    commitHistory();
    if (!undoStack.length) return;
    const cur = snapshot();
    const prev = undoStack.pop();
    redoStack.push(cur);
    baseline = prev;
    applySnapshot(prev);
  }

  function redo() {
    if (!game || playing) return;
    commitHistory();
    if (!redoStack.length) return;
    const cur = snapshot();
    const next = redoStack.pop();
    undoStack.push(cur);
    baseline = next;
    applySnapshot(next);
  }

  function copySelected() {
    if (selGui) {
      clip = { kind: "gui", node: JSON.parse(JSON.stringify(selGui)), listKey: listKeyOf(selGui) };
      syncEditMenu();
      return true;
    }
    if (!selected) return false;
    clip = { kind: "part", row: JSON.parse(JSON.stringify(selected.row)) };
    syncEditMenu();
    return true;
  }

  function cutSelected() {
    if (!copySelected()) return;
    deleteSelected();
  }

  function pasteClip(targetNode) {
    if (!clip || !game || playing) return;
    if (clip.kind === "gui") { pasteGuiClip(targetNode); return; }
    pastePartRow(clip.row || clip);
  }

  function pastePartRow(row) {
    const copy = JSON.parse(JSON.stringify(row));
    copy[3] = round((+copy[3] || 0) + 3, 1000);                              // drop the copy beside the original
    const base = typeof copy[13] === "string" && copy[13].trim() ? copy[13].replace(/ \d+$/, "") : "Part";
    let name = base, n = 1;
    while (parts.some(p => p.name === name)) { n++; name = base + " " + n; }
    copy[13] = name;
    game.map.parts.push(copy);
    const part = makePartFromRow(copy, parts.length);
    parts.push(part);
    renderTree();
    selectPart(part.key);
    markDirty();
  }

  function uniqueGuiName(cls, siblings) {
    let n = 0, name = cls;
    const taken = new Set((siblings || []).map(x => x.name));
    while (taken.has(name)) { n++; name = cls + n; }
    return name;
  }

  function cloneGuiNode(node, siblings) {
    const copy = JSON.parse(JSON.stringify(node));
    (function fresh(n) {
      n.id = "ui" + (++guiSeq) + Math.random().toString(36).slice(2, 6);
      for (const kid of n.children || []) fresh(kid);
    })(copy);
    copy.name = uniqueGuiName(node.class, siblings);
    return copy;
  }

  function acceptsGui(container, cls) {
    if (!container) return cls === "ScreenGui";
    if (cls === "ScreenGui") return false;
    return container.class === "ScreenGui" || container.class === "Frame" || container.class === "Folder";
  }

  function guiListOf(node) {
    const hit = findNode(node.id);
    if (!hit) return GUI_ROOTS();
    return hit.list || (hit.parent ? hit.parent.children : GUI_ROOTS());
  }

  function pasteTargetNode() {
    if (!selGui) return null;
    if (isScript(selGui)) return null;
    if (acceptsGui(selGui, "Frame")) return selGui;
    const hit = findNode(selGui.id);
    return hit && hit.parent ? hit.parent : null;
  }

  function pasteGuiClip(targetNode) {
    const copy = JSON.parse(JSON.stringify(clip.node));
    let list = null, parent = null;
    if (isScript(copy)) {
      const key = targetNode && isScript(targetNode) ? listKeyOf(targetNode) : (clip.listKey || "gui");
      list = listByKey(key);
    } else if (copy.class === "ScreenGui") list = GUI_ROOTS();
    else if (targetNode && acceptsGui(targetNode, copy.class)) { list = targetNode.children; parent = targetNode; }
    else if (targetNode) {
      const hit = findNode(targetNode.id);
      if (hit && hit.parent && acceptsGui(hit.parent, copy.class)) { list = hit.parent.children; parent = hit.parent; }
    }
    if (!list) {                                                             // pasted into StarterGUI: needs a ScreenGui
      const screen = GUI_ROOTS().find(n => n.class === "ScreenGui") || insertGui(null, "ScreenGui");
      list = screen.children;
      parent = screen;
    }
    (function fresh(n) {
      n.id = "ui" + (++guiSeq) + Math.random().toString(36).slice(2, 6);
      for (const kid of n.children || []) fresh(kid);
    })(copy);
    copy.name = uniqueGuiName(copy.class, list);
    list.push(copy);
    if (parent) expanded[parent.id] = true;
    renderTree(); selectGui(copy.id); markDirty();
  }

  function duplicateSelected() {
    if (!game || playing) return;
    if (selGui) {
      const list = guiListOf(selGui);
      const copy = cloneGuiNode(selGui, list);
      list.push(copy);
      const hit = findNode(selGui.id);
      if (hit && hit.parent) expanded[hit.parent.id] = true;
      renderTree(); selectGui(copy.id); markDirty();
      return;
    }
    if (selected) pastePartRow(selected.row);
  }

  function renameGui(node) {
    if (!node) return;
    StudioUI.dialog({
      title: "Rename",
      body: '<label class="rsField">Name<input id="stRename" type="text" maxlength="40" spellcheck="false" value="' + esc(node.name) + '"></label>',
      buttons: [
        { label: "Cancel" },
        {
          label: "Rename",
          primary: true,
          onClick: () => {
            const value = String($("stRename").value || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
            if (value) { node.name = value; renderTree(); renderProps(); renderGui(); markDirty(); }
          },
        },
      ],
    });
    setTimeout(() => { const input = $("stRename"); if (input) { input.focus(); input.select(); } }, 30);
  }

  /* ---- right-click context menu ---- */
  let ctxTarget = null;

  function closeContextMenu() {
    const menu = $("stContextMenu");
    if (menu) menu.hidden = true;
    ctxTarget = null;
  }

  function canInsertInto(target) {
    if (target.kind === "part") return true;
    if (target.kind === "service") return target.key === "workspace" || target.key === "starterGui" || target.key === "replicatedStorage";
    return !!target.node && !isScript(target.node) && !isUIModifier(target.node);
  }

  function openContextMenu(x, y, target) {
    const menu = $("stContextMenu");
    if (!menu) return;
    ctxTarget = target;
    const item = (label, cmd, enabled, hint) =>
      '<button type="button" class="stCtxItem" data-cmd="' + cmd + '"' + (enabled ? "" : " disabled") + "><span class=\"stCtxLabel\">" + label + "</span>" +
      (hint ? "<kbd>" + hint + "</kbd>" : "") + "</button>";
    const editable = target.kind !== "service";
    let html = "";
    if (canInsertInto(target)) html += item("Insert Object", "insert", true, "");
    if (html) html += '<div class="stCtxSep"></div>';
    html += item("Copy", "copy", editable, "Ctrl+C");
    html += item("Cut", "cut", editable, "Ctrl+X");
    html += item("Paste Into", "paste", !!clip, "Ctrl+V");
    html += item("Duplicate", "duplicate", editable, "Ctrl+D");
    if (target.kind === "gui") html += item("Rename", "rename", true, "F2");
    html += '<div class="stCtxSep"></div>';
    html += item("Delete", "delete", editable, "Del");
    menu.innerHTML = html;
    menu.hidden = false;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x)) + "px";
    menu.style.top = Math.min(window.innerHeight - h - 8, Math.max(8, y)) + "px";
  }

  function runContextCommand(cmd, target) {
    if (!target) return;
    if (cmd === "insert") {
      if (target.kind === "part") {
        openInsertMenu(target.el || $("stTree"), { kind: "part", part: target.part });
        return;
      }
      const kind = target.kind === "service"
        ? (target.key === "workspace" ? "workspace" : target.key === "replicatedStorage" ? "replicatedStorage" : "starterGui")
        : "gui";
      const menuTarget = target.kind === "service" ? { kind } : { kind: "gui", node: target.node };
      const anchor = target.el || $("stTree");
      openInsertMenu(anchor, menuTarget);
      return;
    }
    if (cmd === "copy") { copySelected(); return; }
    if (cmd === "cut") { cutSelected(); return; }
    if (cmd === "paste") { pasteClip(target.kind === "gui" ? target.node : null); return; }
    if (cmd === "duplicate") { duplicateSelected(); return; }
    if (cmd === "rename" && target.node) { renameGui(target.node); return; }
    if (cmd === "delete") { deleteSelected(); return; }
  }

  function syncEditMenu() {
    const btn = act => document.querySelector('#stDropEdit [data-act="' + act + '"]');
    const canEdit = !!game && !playing;
    const set = (act, on) => { const b = btn(act); if (b) b.disabled = !on; };
    set("undo", canEdit && undoStack.length > 0);
    set("redo", canEdit && redoStack.length > 0);
    set("cut", canEdit && !!selected);
    set("copy", canEdit && !!selected);
    set("paste", canEdit && !!clip);
  }

  /* =====================================================================
     explorer: services + GUI objects (Roblox-style)
     ===================================================================== */
  const SERVICE_ROWS = [
    { key: "workspace", name: "Workspace" },
    { key: "replicatedStorage", name: "ReplicatedStorage" },
    { key: "starterGui", name: "StarterGUI" },
  ];
  const FOLDER_ICON = '<svg class="rsTreeIco" viewBox="0 0 24 24"><path d="M3 6h7l2 2h9v11H3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  const PART_ICON = '<svg class="rsTreeIco" viewBox="0 0 24 24"><path d="M4 9h16v10H4zM4 9l3-3h10l3 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  const GUI_ICON = {
    ScreenGui: '<svg class="rsTreeIco" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 8h18" stroke="currentColor" stroke-width="1.7"/></svg>',
    Frame: '<svg class="rsTreeIco" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    TextLabel: '<svg class="rsTreeIco" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7 10.5h10M7 13.5h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    TextButton: '<svg class="rsTreeIco" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 12h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    ImageLabel: '<svg class="rsTreeIco" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="8.5" cy="9.5" r="1.6" fill="currentColor"/><path d="M4 17l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    ImageButton: '<svg class="rsTreeIco" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="8.5" cy="9.5" r="1.4" fill="currentColor"/><path d="M4 17l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    UICorner: '<svg class="rsTreeIco" viewBox="0 0 24 24"><path d="M4 20V10a6 6 0 0 1 6-6h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    UIStroke: '<svg class="rsTreeIco" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
    UIGradient: '<svg class="rsTreeIco" viewBox="0 0 24 24"><defs><linearGradient id="ggi" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity=".15"/></linearGradient></defs><rect x="4" y="4" width="16" height="16" rx="2" fill="url(#ggi)"/></svg>',
    UIAspectRatioConstraint: '<svg class="rsTreeIco" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 10h8M8 14h8" stroke="currentColor" stroke-width="1.4"/></svg>',
    UIScale: '<svg class="rsTreeIco" viewBox="0 0 24 24"><path d="M9 4H4v5M15 20h5v-5M4 9l6-6M20 15l-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    UIPadding: '<svg class="rsTreeIco" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2"/><rect x="7" y="7" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    UIListLayout: '<svg class="rsTreeIco" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    UIGridLayout: '<svg class="rsTreeIco" viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    Folder: '<svg class="rsTreeIco" viewBox="0 0 24 24"><path d="M3 6h7l2 2h9v11H3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    Script: '<svg class="rsTreeIco" viewBox="0 0 24 24"><path d="M6 4h9l4 4v12H6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 12l2 2-2 2M13 16h3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    LocalScript: '<svg class="rsTreeIco" viewBox="0 0 24 24"><path d="M6 4h9l4 4v12H6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 11l-2 2 2 2M13 15l2-2-2-2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  let selGui = null, selService = null, guiSeq = 0, guiDrag = null, insertTarget = null;
  const expanded = { workspace: true, replicatedStorage: true, starterGui: true };

  function ensureGui() {
    if (!game || !game.map) return;
    if (!Array.isArray(game.map.gui)) game.map.gui = [];
    if (!Array.isArray(game.map.replicatedStorage)) game.map.replicatedStorage = [];
    if (!Array.isArray(game.map.workspaceScripts)) game.map.workspaceScripts = [];
    if (!game.map.vars || typeof game.map.vars !== "object" || Array.isArray(game.map.vars)) game.map.vars = {};
    for (const list of [game.map.gui, game.map.replicatedStorage, game.map.workspaceScripts]) migrateScriptVars(list);
  }

  function migrateScriptVars(list) {
    for (const node of list || []) {
      if (Array.isArray(node.vars)) {
        for (const name of node.vars) if (!(name in game.map.vars)) game.map.vars[name] = "0";
        delete node.vars;
      }
      if (node.children) migrateScriptVars(node.children);
    }
  }

  const SCRIPT_CLASSES = ["Script", "LocalScript"];
  const isScript = node => !!node && SCRIPT_CLASSES.includes(node.class);
  const UI_MODIFIERS = ["UICorner", "UIStroke", "UIGradient", "UIAspectRatioConstraint", "UIScale", "UIPadding", "UIListLayout", "UIGridLayout"];
  const isUIModifier = node => !!node && UI_MODIFIERS.includes(node.class);
  const uiMod = (node, cls) => ((node && node.children) || []).find(child => child.class === cls);

  function guiDefaults(cls) {
    if (SCRIPT_CLASSES.includes(cls)) return {};
    const base = {
      Position: [0, 0, 0, 0], Size: [0, 200, 0, 100], AnchorPoint: [0, 0], Rotation: 0,
      BackgroundColor3: "#a3a2a5", BackgroundTransparency: 0,
      BorderSizePixel: 1, BorderColor3: "#1b2a35",
      Visible: true, ZIndex: 1, ClipsDescendants: false,
    };
    if (cls === "ScreenGui") {
      return { Enabled: true, DisplayOrder: 0, IgnoreGuiInset: false, ResetOnSpawn: true, ZIndexBehavior: "Sibling", ClipToDeviceSafeArea: true };
    }
    if (cls === "Folder") {
      return { Enabled: true };
    }
    if (UI_MODIFIERS.includes(cls)) {
      if (cls === "UICorner") return { CornerRadius: 8 };
      if (cls === "UIStroke") return { Color: "#1b2a35", Thickness: 2, Transparency: 0 };
      if (cls === "UIGradient") return { Color1: "#ffbf2f", Color2: "#e5534b", Rotation: 90, Transparency: 0 };
      if (cls === "UIAspectRatioConstraint") return { AspectRatio: 1.5, DominantAxis: "Width" };
      if (cls === "UIScale") return { Scale: 1 };
      if (cls === "UIPadding") return { PaddingTop: 8, PaddingBottom: 8, PaddingLeft: 8, PaddingRight: 8 };
      if (cls === "UIListLayout") return { FillDirection: "Vertical", Padding: 8, HorizontalAlignment: "Left", VerticalAlignment: "Top" };
      if (cls === "UIGridLayout") return { CellSizeX: 64, CellSizeY: 64, PaddingX: 8, PaddingY: 8, FillDirection: "Horizontal" };
    }
    if (cls === "TextLabel" || cls === "TextButton") {
      return Object.assign(base, {
        Size: [0, 200, 0, 50],
        Text: cls === "TextButton" ? "Button" : "TextLabel",
        TextColor3: "#000000", TextSize: 14, Font: "SourceSans",
        TextScaled: false, TextWrapped: false, TextXAlignment: "Center", TextYAlignment: "Center",
        RichText: false, LineHeight: 1, TextTransparency: 0,
        TextStrokeTransparency: 1, TextStrokeColor3: "#000000",
      });
    }
    if (cls === "ImageLabel" || cls === "ImageButton") {
      return Object.assign(base, {
        Size: [0, 200, 0, 200], BackgroundTransparency: 1,
        Image: "", ImageColor3: "#ffffff", ImageTransparency: 0, ScaleType: "Stretch",
      });
    }
    return base;
  }

  function newGuiNode(cls, siblings) {
    ensureGui();
    let n = 0, name = cls;
    const taken = new Set((siblings || []).map(child => child.name));
    while (taken.has(name)) { n++; name = cls + n; }
    const node = {
      id: "ui" + (++guiSeq) + Math.random().toString(36).slice(2, 6),
      class: cls, name, props: guiDefaults(cls), children: [],
    };
    if (SCRIPT_CLASSES.includes(cls)) node.blocks = [];
    return node;
  }

  function findNode(id) {
    ensureGui();
    const guiHit = guiFind(id, game.map.gui);
    if (guiHit) return guiHit;
    for (const list of [game.map.workspaceScripts, game.map.replicatedStorage]) {
      const index = (list || []).findIndex(node => node.id === id);
      if (index >= 0) return { node: list[index], parent: null, list, index };
    }
    return null;
  }

  function listKeyOf(node) {
    ensureGui();
    if ((game.map.workspaceScripts || []).includes(node)) return "workspaceScripts";
    if ((game.map.replicatedStorage || []).includes(node)) return "replicatedStorage";
    return "gui";
  }

  function listByKey(key) {
    ensureGui();
    if (key === "workspaceScripts") return game.map.workspaceScripts;
    if (key === "replicatedStorage") return game.map.replicatedStorage;
    return game.map.gui;
  }

  function guiFind(id, list, parent) {
    for (const node of list || []) {
      if (node.id === id) return { node, parent: parent || null };
      const hit = guiFind(id, node.children, node);
      if (hit) return hit;
    }
    return null;
  }

  function guiListFor(parent) { return parent ? parent.children : (game && game.map.gui) || []; }

  function insertGui(parent, cls) {
    ensureGui();
    const node = newGuiNode(cls, guiListFor(parent));
    guiListFor(parent).push(node);
    if (parent) expanded[parent.id] = true;
    renderTree();
    selectGui(node.id);
    markDirty();
    return node;
  }

  function removeGui(node) {
    const hit = findNode(node.id);
    if (!hit) return;
    if (scriptEdit === node) closeScriptEditor();
    const list = hit.list || (hit.parent ? hit.parent.children : GUI_ROOTS());
    const i = list.indexOf(hit.node);
    if (i >= 0) list.splice(i, 1);
    if (selGui === node) { selGui = null; }
    renderTree(); renderGui(); renderProps();
    markDirty();
  }

  function GUI_ROOTS() { ensureGui(); return game.map.gui; }

  function guiChildren(node) {
    if (isUIModifier(node)) return [];
    return node.children || [];
  }

  /* ---- explorer drag & drop (scripts and UI between services, folders and parts) ---- */
  let treeDrag = null;

  function findAnyNode(id) {
    ensureGui();
    const guiHit = guiFind(id, game.map.gui);
    if (guiHit) {
      const list = guiHit.parent ? (guiHit.parent.children || []) : game.map.gui;
      return { node: guiHit.node, parent: guiHit.parent, list, index: list.indexOf(guiHit.node) };
    }
    for (const key of ["workspaceScripts", "replicatedStorage"]) {
      const list = game.map[key] || [];
      const index = list.findIndex(node => node.id === id);
      if (index >= 0) return { node: list[index], parent: null, list, index, key };
    }
    return null;
  }

  function treeDropTarget(row) {
    if (!row) return null;
    if (row.dataset.part) {
      const part = parts.find(p => p.key === row.dataset.part);
      return part ? { kind: "part", part, el: row } : null;
    }
    if (row.dataset.gui) {
      const hit = findAnyNode(row.dataset.gui);
      return hit ? { kind: "gui", node: hit.node, el: row } : null;
    }
    if (row.dataset.service) return { kind: "service", key: row.dataset.service, el: row };
    return null;
  }

  function canTreeDrop(node, target) {
    if (!node || !target) return false;
    const script = isScript(node);
    if (target.kind === "part") return script;
    if (target.kind === "service") {
      if (target.key === "workspace" || target.key === "replicatedStorage") return script;
      if (target.key === "starterGui") return true;
      return false;
    }
    if (target.kind === "gui") {
      const p = target.node;
      if (!p || isScript(p)) return false;
      if (p.class !== "ScreenGui" && p.class !== "Frame" && p.class !== "Folder") return false;
      if (p === node) return false;
      if (guiFind(node.id, [p])) return false;
      return true;
    }
    return false;
  }

  function moveTreeNode(hit, target) {
    const node = hit.node;
    if (!node || hit.index < 0) return;
    const script = isScript(node);
    if (target.kind === "part") {
      if (!script) return;
      hit.list.splice(hit.index, 1);
      if (!game.map.workspaceScripts.includes(node)) game.map.workspaceScripts.push(node);
      node.parentPart = target.part.name;
    } else if (target.kind === "service") {
      if (target.key === "workspace" || target.key === "replicatedStorage") {
        if (!script) return;
        hit.list.splice(hit.index, 1);
        const list = target.key === "workspace" ? game.map.workspaceScripts : game.map.replicatedStorage;
        if (!list.includes(node)) list.push(node);
        delete node.parentPart;
      } else if (target.key === "starterGui") {
        hit.list.splice(hit.index, 1);
        delete node.parentPart;
        game.map.gui.push(node);
      } else return;
    } else if (target.kind === "gui") {
      const parent = target.node;
      if (!parent || parent === node) return;
      if (!script && guiFind(node.id, [parent])) return;
      hit.list.splice(hit.index, 1);
      delete node.parentPart;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
      expanded[parent.id] = true;
    } else return;
    renderTree();
    renderProps();
    selectGui(node.id);
    markDirty();
  }

  function endTreeDrag() {
    treeDrag = null;
    document.body.classList.remove("treeDragging");
    for (const el of document.querySelectorAll("#stTree .dragging, #stTree .dropInto")) el.classList.remove("dragging", "dropInto");
  }

  /* ---- GUI rendering (2D overlay over the viewport) ---- */
  function toPx(udim, total) { return (Number(udim[0]) || 0) * total + (Number(udim[1]) || 0); }

  function hexToRgba(hex, transparency) {    const h = /^#?([0-9a-f]{6})$/i.exec(String(hex || "#000000"));
    const n = parseInt(h ? h[1] : "000000", 16);
    const a = Math.max(0, Math.min(1, 1 - (Number(transparency) || 0)));
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a.toFixed(3) + ")";
  }

  function guiFontStack(font) {
    if (font === "Legacy") return "Arial, Helvetica, sans-serif";
    if (font === "Code") return "Consolas, ui-monospace, monospace";
    if (font === "Fantasy") return "Georgia, serif";
    return '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
  }

  function guiImageUrl(url) {
    const value = String(url || "").trim();
    return /^(https?:\/\/|data:image\/)/i.test(value) ? value : "";
  }

  function buildGuiNode(node, parentW, parentH) {
    if (isScript(node) || isUIModifier(node)) return document.createDocumentFragment();
    if (node.class === "Folder") {
      const frag = document.createDocumentFragment();
      for (const child of node.children || []) frag.appendChild(buildGuiNode(child, parentW, parentH));
      return frag;
    }
    if (node.class === "ScreenGui") {
      const screen = document.createElement("div");
      screen.className = "stGuiScreen" + (selGui === node ? " isSel" : "");
      screen.dataset.gui = node.id;
      screen.style.display = node.props.Enabled === false ? "none" : "";
      screen.style.zIndex = String(300 + (Number(node.props.DisplayOrder) || 0));
      screen.style.top = node.props.IgnoreGuiInset ? "0px" : "36px";
      if (selGui === node) screen.appendChild(guiTag(node));
      for (const child of node.children || []) if (!isUIModifier(child)) screen.appendChild(buildGuiNode(child, parentW, Math.max(1, parentH - (node.props.IgnoreGuiInset ? 0 : 36))));
      return screen;
    }
    const el = document.createElement("div");
    el.className = "stGui stGui-" + node.class + (selGui === node ? " isSel" : "");
    el.dataset.gui = node.id;
    const p = node.props;
    let width = Math.max(1, toPx(p.Size, parentW));
    let height = Math.max(1, toPx(p.Size.slice(2), parentH));
    const aspect = uiMod(node, "UIAspectRatioConstraint");
    if (aspect) {
      const ar = Math.max(0.05, Number(aspect.props.AspectRatio) || 1);
      if (aspect.props.DominantAxis === "Height") width = Math.max(1, height * ar);
      else height = Math.max(1, width / ar);
    }
    const left = toPx(p.Position, parentW);
    const top = toPx(p.Position.slice(2), parentH);
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.width = width + "px";
    el.style.height = height + "px";
    const gradient = uiMod(node, "UIGradient");
    if (gradient) {
      const gt = Math.min(1, (Number(p.BackgroundTransparency) || 0) + (Number(gradient.props.Transparency) || 0));
      el.style.background = "linear-gradient(" + (Number(gradient.props.Rotation) || 0) + "deg, " +
        hexToRgba(gradient.props.Color1, gt) + ", " +
        hexToRgba(gradient.props.Color2, gt) + ")";
    } else {
      el.style.background = hexToRgba(p.BackgroundColor3, p.BackgroundTransparency);
    }
    const corner = uiMod(node, "UICorner");
    if (corner) el.style.borderRadius = Math.max(0, Number(corner.props.CornerRadius) || 0) + "px";
    const stroke = uiMod(node, "UIStroke");
    const strokeColor = stroke ? hexToRgba(stroke.props.Color, stroke.props.Transparency) : "";
    el.style.border = (Number(p.BorderSizePixel) || 0) + "px solid " + (Number(p.BorderSizePixel) ? String(p.BorderColor3 || "#1b2a35") : "transparent");
    if (stroke && Number(stroke.props.Thickness) > 0) el.style.boxShadow = "inset 0 0 0 " + Number(stroke.props.Thickness) + "px " + strokeColor;
    el.style.visibility = p.Visible === false ? "hidden" : "";
    el.style.zIndex = String(Number(p.ZIndex) || 0);
    el.style.overflow = p.ClipsDescendants ? "hidden" : "visible";
    const scale = uiMod(node, "UIScale");
    const scaleVal = scale ? Math.max(0.05, Number(scale.props.Scale) || 1) : 1;
    el.style.transformOrigin = ((Number(p.AnchorPoint[0]) || 0) * 100) + "% " + ((Number(p.AnchorPoint[1]) || 0) * 100) + "%";
    el.style.transform = "translate(" + (-(Number(p.AnchorPoint[0]) || 0) * 100) + "%," + (-(Number(p.AnchorPoint[1]) || 0) * 100) + "%)" +
      (Number(p.Rotation) ? " rotate(" + Number(p.Rotation) + "deg)" : "") + (scaleVal !== 1 ? " scale(" + scaleVal + ")" : "");
    if (node.class === "TextLabel" || node.class === "TextButton") {
      const text = String(p.Text == null ? "" : p.Text);
      el.textContent = text;
      el.style.color = hexToRgba(p.TextColor3, p.TextTransparency);
      el.style.justifyContent = p.TextXAlignment === "Left" ? "flex-start" : p.TextXAlignment === "Right" ? "flex-end" : "center";
      el.style.alignItems = p.TextYAlignment === "Top" ? "flex-start" : p.TextYAlignment === "Bottom" ? "flex-end" : "center";
      el.style.textAlign = p.TextXAlignment === "Left" ? "left" : p.TextXAlignment === "Right" ? "right" : "center";
      el.style.whiteSpace = p.TextWrapped || p.TextScaled ? "pre-wrap" : "pre";
      el.style.fontFamily = guiFontStack(p.Font);
      el.style.lineHeight = String(Number(p.LineHeight) || 1);
      if (p.TextScaled) {
        const byHeight = height * 0.62;
        const byWidth = width / Math.max(1, text.length * 0.52);
        el.style.fontSize = Math.max(4, Math.min(byHeight, byWidth)) + "px";
      } else {
        el.style.fontSize = Math.max(1, Number(p.TextSize) || 14) + "px";
      }
      if (Number(p.TextStrokeTransparency) < 1) {
        el.style.webkitTextStroke = "1px " + hexToRgba(p.TextStrokeColor3, p.TextStrokeTransparency);
      }
      if (stroke && Number(stroke.props.Thickness) > 0) {
        el.style.webkitTextStroke = Math.max(1, Number(stroke.props.Thickness) / 2) + "px " + strokeColor;
      }
    }
    if (node.class === "ImageLabel" || node.class === "ImageButton") {
      const src = guiImageUrl(p.Image);
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "";
        img.draggable = false;
        img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;object-fit:" +
          (p.ScaleType === "Fit" ? "contain" : "fill") + ";opacity:" + (1 - (Number(p.ImageTransparency) || 0));
        el.appendChild(img);
      }
    }
    const padM = uiMod(node, "UIPadding");
    let host = el, childW = width, childH = height;
    if (padM) {
      const pt = Math.max(0, Number(padM.props.PaddingTop) || 0), pb = Math.max(0, Number(padM.props.PaddingBottom) || 0);
      const pl = Math.max(0, Number(padM.props.PaddingLeft) || 0), pr = Math.max(0, Number(padM.props.PaddingRight) || 0);
      if (node.class === "TextLabel" || node.class === "TextButton") el.style.padding = pt + "px " + pr + "px " + pb + "px " + pl + "px";
      host = document.createElement("div");
      host.className = "stGuiContent";
      host.style.cssText = "position:absolute;left:" + pl + "px;top:" + pt + "px;right:" + pr + "px;bottom:" + pb + "px;";
      el.appendChild(host);
      childW = Math.max(1, width - pl - pr);
      childH = Math.max(1, height - pt - pb);
    }
    for (const child of node.children || []) {
      if (isUIModifier(child)) continue;
      host.appendChild(buildGuiNode(child, childW, childH));
    }
    const list = uiMod(node, "UIListLayout"), grid = uiMod(node, "UIGridLayout");
    if (list || grid) layoutGuiChildren(host, childW, childH, list, grid);
    if (selGui === node) {
      el.appendChild(guiTag(node));
      for (const dir of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
        const handle = document.createElement("span");
        handle.className = "stGuiHandle stGuiHandle-" + dir;
        handle.dataset.handle = dir;
        el.appendChild(handle);
      }
    }
    return el;
  }

  function layoutGuiChildren(host, width, height, list, grid) {
    const items = Array.from(host.children).filter(el => el.classList && el.classList.contains("stGui"));
    const px = el => parseFloat(el.style.width) || 1;
    const py = el => parseFloat(el.style.height) || 1;
    if (list) {
      const vertical = list.props.FillDirection !== "Horizontal";
      const gap = Math.max(0, Number(list.props.Padding) || 0);
      let cursor = 0;
      for (const el of items) {
        const w = px(el), h = py(el);
        if (vertical) {
          const x = list.props.HorizontalAlignment === "Center" ? (width - w) / 2 : list.props.HorizontalAlignment === "Right" ? width - w : 0;
          el.style.left = Math.max(0, x) + "px"; el.style.top = cursor + "px"; cursor += h + gap;
        } else {
          const y = list.props.VerticalAlignment === "Center" ? (height - h) / 2 : list.props.VerticalAlignment === "Bottom" ? height - h : 0;
          el.style.left = cursor + "px"; el.style.top = Math.max(0, y) + "px"; cursor += w + gap;
        }
      }
      return;
    }
    const cw = Math.max(1, Number(grid.props.CellSizeX) || 64), ch = Math.max(1, Number(grid.props.CellSizeY) || 64);
    const gx = Math.max(0, Number(grid.props.PaddingX) || 0), gy = Math.max(0, Number(grid.props.PaddingY) || 0);
    const cols = Math.max(1, Math.floor((width + gx) / (cw + gx)));
    const rows = Math.max(1, Math.floor((height + gy) / (ch + gy)));
    items.forEach((el, i) => {
      let col, row;
      if (grid.props.FillDirection === "Vertical") { row = i % rows; col = Math.floor(i / rows); }
      else { col = i % cols; row = Math.floor(i / cols); }
      el.style.width = cw + "px"; el.style.height = ch + "px";
      el.style.left = (col * (cw + gx)) + "px";
      el.style.top = (row * (ch + gy)) + "px";
    });
  }

  function guiTag(node) {
    const tag = document.createElement("span");
    tag.className = "stGuiTag";
    tag.textContent = node.name;
    return tag;
  }

  function renderGui() {
    const layer = $("stGuiLayer");
    if (!layer) return;
    ensureGui();
    layer.innerHTML = "";
    if (!game || playing) { layer.hidden = true; return; }
    layer.hidden = false;
    const w = Math.max(1, layer.clientWidth), h = Math.max(1, layer.clientHeight);
    for (const root of game.map.gui) layer.appendChild(buildGuiNode(root, w, h));
  }

  /* ---- selection ---- */
  function dropSelBox() {
    if (selBox) {
      scene.remove(selBox);
      selBox.geometry.dispose();
      selBox.material.dispose();
      selBox = null;
    }
  }

  function selectGui(id) {
    const hit = findNode(id);
    selGui = hit ? hit.node : null;
    selService = null;
    if (selGui) { selected = null; dropSelBox(); }
    renderTree();
    renderProps();
    renderGui();
    updateGizmo();
  }

  function selectService(key) {
    selService = key;
    selGui = null;
    selected = null;
    dropSelBox();
    renderTree();
    renderProps();
    renderGui();
    updateGizmo();
  }

  /* ---- explorer rendering ---- */
  function twisty(key, hasKids) {
    if (!hasKids) return '<span class="rsTwistyWrap"></span>';
    return '<button class="rsTwisty' + (expanded[key] ? " open" : "") + '" type="button" data-twist="' + esc(key) + '" aria-label="Expand">' +
      '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
  }

  function insertBtn(kind, id, title) {
    return '<button class="rsInsert" type="button" data-insert="' + esc(kind) + '"' + (id ? ' data-insert-id="' + esc(id) + '"' : "") + ' title="' + esc(title) + '">+</button>';
  }

  function renderTree() {
    const box = $("stTree");
    if (!box || !game) return;
    ensureGui();
    let html = "";
    for (const svc of SERVICE_ROWS) {
      const isOpen = expanded[svc.key] !== false;
      const rows = [];
      if (svc.key === "workspace") {
        const partNames = new Set(parts.map(p => p.name));
        for (const p of parts) {
          const kids = (game.map.workspaceScripts || []).filter(s => s.parentPart === p.name);
          rows.push('<div class="rsTreeRow rsChild' + (selected === p ? " on" : "") + '" data-part="' + p.key + '">' + PART_ICON + '<span class="rsTreeName">' + esc(p.name) + "</span>"
            + (kids.length ? '<span class="rsTreeClass">' + kids.length + ' script' + (kids.length === 1 ? "" : "s") + "</span>" : "")
            + insertBtn("part:" + p.key, "", "Insert a script into " + p.name) + "</div>");
          for (const node of kids) rows.push(guiRowHtml(node, 2));
        }
        for (const node of game.map.workspaceScripts) {
          if (node.parentPart && partNames.has(node.parentPart)) continue;
          rows.push(guiRowHtml(node, 1));
        }
      } else if (svc.key === "starterGui") {
        for (const node of game.map.gui) rows.push(guiRowHtml(node, 1));
      } else if (svc.key === "replicatedStorage") {
        for (const node of game.map.replicatedStorage) rows.push(guiRowHtml(node, 1));
        if (!game.map.replicatedStorage.length) rows.push('<div class="rsTreeNote">Nothing in here yet</div>');
      }
      const active = selService === svc.key;
      html += '<div class="rsTreeRow rsServiceRow' + (active ? " on" : "") + '" data-service="' + svc.key + '">'
        + twisty(svc.key, rows.length > 0)
        + FOLDER_ICON
        + '<span class="rsTreeName">' + svc.name + "</span>"
        + insertBtn("service:" + svc.key, "", "Insert object into " + svc.name)
        + "</div>";
      if (isOpen && rows.length) html += '<div class="rsTreeKids">' + rows.join("") + "</div>";
    }
    box.innerHTML = html;
  }

  function guiRowHtml(node, depth) {
    const kids = guiChildren(node);
    const isOpen = expanded[node.id] !== false;
    let html = '<div class="rsTreeRow rsChild' + (selGui === node ? " on" : "") + '" data-gui="' + esc(node.id) + '" draggable="true" style="padding-left:' + (6 + depth * 12) + 'px">'
      + twisty(node.id, kids.length > 0)
      + (GUI_ICON[node.class] || FOLDER_ICON)
      + '<span class="rsTreeName">' + esc(node.name) + "</span>"
      + '<span class="rsTreeClass">' + esc(node.class) + "</span>"
      + (isScript(node) || isUIModifier(node) ? "" : insertBtn("gui:" + node.id, "", "Insert object into " + node.name))
      + "</div>";
    if (isOpen && kids.length) html += '<div class="rsTreeKids">' + kids.map(kid => guiRowHtml(kid, depth + 1)).join("") + "</div>";
    return html;
  }

  /* ---- insert menu ---- */
  function insertablesFor(target) {
    if (!target) return [];
    if (target.kind === "workspace") {
      return SHAPES.map((name, shape) => ({ label: name, shape }))
        .concat([{ label: "Script", cls: "Script" }, { label: "LocalScript", cls: "LocalScript" }]);
    }
    if (target.kind === "part") {
      return [{ label: "Script", cls: "Script" }, { label: "LocalScript", cls: "LocalScript" }];
    }
    if (target.kind === "replicatedStorage") {
      return [{ label: "Script", cls: "Script" }, { label: "LocalScript", cls: "LocalScript" }];
    }
    if (target.kind === "starterGui") {
      return [
        { label: "ScreenGui", cls: "ScreenGui" },
        { label: "Folder", cls: "Folder" },
        { label: "Script", cls: "Script" },
        { label: "LocalScript", cls: "LocalScript" },
      ];
    }
    if (target.kind === "gui" && target.node) {
      const c = target.node.class;
      if (isUIModifier(target.node)) return [];
      const mods = UI_MODIFIERS.map(cls => ({ label: cls, cls }));
      if (c === "ScreenGui") {
        return [
          { label: "Frame", cls: "Frame" },
          { label: "TextLabel", cls: "TextLabel" },
          { label: "TextButton", cls: "TextButton" },
          { label: "ImageLabel", cls: "ImageLabel" },
          { label: "ImageButton", cls: "ImageButton" },
          { label: "Folder", cls: "Folder" },
        ];
      }
      if (c === "Frame") {
        return [
          { label: "Frame", cls: "Frame" },
          { label: "TextLabel", cls: "TextLabel" },
          { label: "TextButton", cls: "TextButton" },
          { label: "ImageLabel", cls: "ImageLabel" },
          { label: "ImageButton", cls: "ImageButton" },
          { label: "Folder", cls: "Folder" },
        ].concat(mods);
      }
      if (c === "Folder") {
        return [
          { label: "Frame", cls: "Frame" },
          { label: "TextLabel", cls: "TextLabel" },
          { label: "TextButton", cls: "TextButton" },
          { label: "ImageLabel", cls: "ImageLabel" },
          { label: "ImageButton", cls: "ImageButton" },
          { label: "Folder", cls: "Folder" },
        ];
      }
      if (c === "TextLabel" || c === "TextButton" || c === "ImageLabel" || c === "ImageButton") return mods;
    }
    return [];
  }

  function openInsertMenu(anchor, target) {
    const menu = $("stInsertMenu");
    if (!menu) return;
    const items = insertablesFor(target);
    insertTarget = target;
    menu.innerHTML = '<div class="stInsertHead">Insert Object</div>'
      + (items.length
        ? items.map(item => '<button type="button" class="stInsertItem" data-cls="' + esc(item.cls || "") + '" data-shape="' + (item.shape == null ? "" : item.shape) + '">'
          + (item.cls ? (GUI_ICON[item.cls] || FOLDER_ICON) : PART_ICON) + '<span>' + esc(item.label) + "</span></button>").join("")
        : '<div class="stInsertEmpty">Nothing can be inserted here yet.</div>');
    const rect = anchor.getBoundingClientRect();
    menu.hidden = false;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const left = Math.min(window.innerWidth - mw - 8, Math.max(8, rect.right - mw));
    const top = Math.min(window.innerHeight - mh - 8, rect.bottom + 4);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  function closeInsertMenu() {
    const menu = $("stInsertMenu");
    if (menu) menu.hidden = true;
    insertTarget = null;
  }

  function insertFromMenu(btn) {
    const target = insertTarget;
    closeInsertMenu();
    if (!target) return;
    const cls = btn.dataset.cls;
    if (target.kind === "workspace") {
      if (cls) { insertNodeInto(game.map.workspaceScripts, cls); return; }
      const shape = btn.dataset.shape === "" ? 1 : +btn.dataset.shape;
      addPart(shape);
      return;
    }
    if (target.kind === "part") {
      if (cls) {
        const node = insertNodeInto(game.map.workspaceScripts, cls);
        node.parentPart = target.part.name;
        renderTree();
        selectGui(node.id);
      }
      return;
    }
    if (target.kind === "replicatedStorage") {
      if (cls) insertNodeInto(game.map.replicatedStorage, cls);
      return;
    }
    if (cls) insertGui(target.kind === "gui" ? target.node : null, cls);
  }

  function insertNodeInto(list, cls) {
    ensureGui();
    const node = newGuiNode(cls, list);
    list.push(node);
    renderTree();
    selectGui(node.id);
    markDirty();
    return node;
  }

  /* ---- GUI properties ---- */
  function fmtUdim(values) {
    return [0, 1, 2, 3].map(i => round(+values[i] || 0, 1000)).join(", ");
  }

  function parseUdim(text) {
    const nums = String(text || "").split(/[,\s]+/).map(parseFloat).filter(n => Number.isFinite(n));
    if (!nums.length) return null;
    if (nums.length === 1) {
      const n = nums[0];
      return Math.abs(n) < 1 ? [n, 0, n, 0] : [0, n, 0, n];
    }
    if (nums.length === 2) return [nums[0], 0, nums[1], 0];
    if (nums.length === 3) return [nums[0], nums[1], nums[2], 0];
    return nums.slice(0, 4);
  }

  function parseAnchor(text) {
    const nums = String(text || "").split(/[,\s]+/).map(parseFloat).filter(n => Number.isFinite(n));
    if (!nums.length) return null;
    if (nums.length === 1) return [nums[0], nums[0]];
    return [nums[0], nums[1]];
  }

  function guiVecRow(label, prop, values) {
    return '<div class="rsPropRow"><span class="rsPropLabel">' + label + '</span>'
      + '<input type="text" class="rsUdim" spellcheck="false" data-gpudim="' + prop + '" value="' + fmtUdim(values) + '" title="Scale X, Offset X, Scale Y, Offset Y"></div>';
  }

  function guiAnchorRow(value) {
    return '<div class="rsPropRow"><span class="rsPropLabel">AnchorPoint</span>'
      + '<input type="text" class="rsUdim" spellcheck="false" data-gpanchor="1" value="' + round(+value[0] || 0, 1000) + ", " + round(+value[1] || 0, 1000) + '" title="X, Y (0 to 1)"></div>';
  }

  function guiBoolRow(label, prop, value) {
    return '<div class="rsPropRow"><span class="rsPropLabel">' + label + '</span><input type="checkbox" data-gp="' + prop + '"' + (value ? " checked" : "") + "></div>";
  }

  function guiColorRow(label, prop, value) {
    return '<div class="rsPropRow"><span class="rsPropLabel">' + label + '</span><span class="rsColorWrap"><input type="color" data-gp="' + prop + '" value="' + esc(value) + '"><span class="rsHex">' + esc(value) + "</span></span></div>";
  }

  function guiSelectRow(label, prop, list, value) {
    return '<div class="rsPropRow"><span class="rsPropLabel">' + label + '</span><select data-gp="' + prop + '">' + optionList(list, value) + "</select></div>";
  }

  function guiNumberRow(label, prop, value, step, min, max) {
    return '<div class="rsPropRow"><span class="rsPropLabel">' + label + '</span><input type="number" data-gp="' + prop + '" step="' + step + '"'
      + (min == null ? "" : ' min="' + min + '"') + (max == null ? "" : ' max="' + max + '"') + ' value="' + round(+value || 0, 1000) + '"></div>';
  }

  function uiModifierRows(node) {
    const p = node.props;
    if (node.class === "UICorner") return guiNumberRow("CornerRadius", "CornerRadius", p.CornerRadius, 1, 0, 256);
    if (node.class === "UIStroke") return guiColorRow("Color", "Color", p.Color)
      + guiNumberRow("Thickness", "Thickness", p.Thickness, 1, 0, 40)
      + guiNumberRow("Transparency", "Transparency", p.Transparency, 0.05, 0, 1);
    if (node.class === "UIGradient") return guiColorRow("Color1", "Color1", p.Color1)
      + guiColorRow("Color2", "Color2", p.Color2)
      + guiNumberRow("Rotation", "Rotation", p.Rotation, 1, -360, 360)
      + guiNumberRow("Transparency", "Transparency", p.Transparency, 0.05, 0, 1);
    if (node.class === "UIAspectRatioConstraint") return guiNumberRow("AspectRatio", "AspectRatio", p.AspectRatio, 0.05, 0.05, 100)
      + guiSelectRow("DominantAxis", "DominantAxis", ["Width", "Height"], p.DominantAxis);
    if (node.class === "UIScale") return guiNumberRow("Scale", "Scale", p.Scale, 0.05, 0.05, 20);
    if (node.class === "UIPadding") return guiNumberRow("PaddingTop", "PaddingTop", p.PaddingTop, 1, 0, 512)
      + guiNumberRow("PaddingBottom", "PaddingBottom", p.PaddingBottom, 1, 0, 512)
      + guiNumberRow("PaddingLeft", "PaddingLeft", p.PaddingLeft, 1, 0, 512)
      + guiNumberRow("PaddingRight", "PaddingRight", p.PaddingRight, 1, 0, 512);
    if (node.class === "UIListLayout") return guiSelectRow("FillDirection", "FillDirection", ["Vertical", "Horizontal"], p.FillDirection)
      + guiNumberRow("Padding", "Padding", p.Padding, 1, 0, 256)
      + guiSelectRow("HorizontalAlignment", "HorizontalAlignment", ["Left", "Center", "Right"], p.HorizontalAlignment)
      + guiSelectRow("VerticalAlignment", "VerticalAlignment", ["Top", "Center", "Bottom"], p.VerticalAlignment);
    if (node.class === "UIGridLayout") return guiNumberRow("CellSizeX", "CellSizeX", p.CellSizeX, 1, 4, 512)
      + guiNumberRow("CellSizeY", "CellSizeY", p.CellSizeY, 1, 4, 512)
      + guiNumberRow("PaddingX", "PaddingX", p.PaddingX, 1, 0, 256)
      + guiNumberRow("PaddingY", "PaddingY", p.PaddingY, 1, 0, 256)
      + guiSelectRow("FillDirection", "FillDirection", ["Horizontal", "Vertical"], p.FillDirection);
    return "";
  }

  function renderGuiProps(box, node) {
    if (isScript(node)) { renderScriptProps(box, node); return; }
    const p = node.props;
    let html = '<div class="rsPropGroup">Data</div>'
      + '<div class="rsPropRow"><span class="rsPropLabel">Name</span><input type="text" data-gp="Name" maxlength="40" value="' + esc(node.name) + '"></div>'
      + '<div class="rsPropRow"><span class="rsPropLabel">Class</span><span class="rsPropVal">' + esc(node.class) + "</span></div>"
      + '<div class="rsPropRow"><span class="rsPropLabel">Parent</span><span class="rsPropVal">' + (guiFind(node.id, GUI_ROOTS()) && guiFind(node.id, GUI_ROOTS()).parent ? esc(guiFind(node.id, GUI_ROOTS()).parent.name) : "StarterGUI") + "</span></div>";

    if (isUIModifier(node)) {
      html += '<div class="rsPropGroup">' + esc(node.class) + "</div>" + uiModifierRows(node);
      box.innerHTML = html;
      return;
    }

    if (node.class === "ScreenGui") {
      html += '<div class="rsPropGroup">ScreenGui</div>'
        + guiBoolRow("Enabled", "Enabled", p.Enabled)
        + guiNumberRow("DisplayOrder", "DisplayOrder", p.DisplayOrder, 1)
        + guiBoolRow("IgnoreGuiInset", "IgnoreGuiInset", p.IgnoreGuiInset)
        + guiBoolRow("ResetOnSpawn", "ResetOnSpawn", p.ResetOnSpawn)
        + guiBoolRow("ClipToDeviceSafeArea", "ClipToDeviceSafeArea", p.ClipToDeviceSafeArea)
        + guiSelectRow("ZIndexBehavior", "ZIndexBehavior", ["Sibling", "Global"], p.ZIndexBehavior);
    } else if (node.class !== "Folder") {
      html += '<div class="rsPropGroup">Transform</div>'
        + guiVecRow("Position", "Position", p.Position)
        + guiVecRow("Size", "Size", p.Size)
        + guiAnchorRow(p.AnchorPoint)
        + guiNumberRow("Rotation", "Rotation", p.Rotation, 1)
        + '<div class="rsPropGroup">Appearance</div>'
        + guiColorRow("BackgroundColor3", "BackgroundColor3", p.BackgroundColor3)
        + guiNumberRow("BackgroundTransparency", "BackgroundTransparency", p.BackgroundTransparency, 0.05, 0, 1)
        + guiNumberRow("BorderSizePixel", "BorderSizePixel", p.BorderSizePixel, 1, 0, 100)
        + guiColorRow("BorderColor3", "BorderColor3", p.BorderColor3)
        + guiBoolRow("Visible", "Visible", p.Visible)
        + guiNumberRow("ZIndex", "ZIndex", p.ZIndex, 1)
        + guiBoolRow("ClipsDescendants", "ClipsDescendants", p.ClipsDescendants);
      if (node.class === "TextLabel" || node.class === "TextButton") {
        html += '<div class="rsPropGroup">Text</div>'
          + '<div class="rsPropRow"><span class="rsPropLabel">Text</span><textarea data-gp="Text" rows="2" maxlength="400">' + esc(p.Text) + "</textarea></div>"
          + guiColorRow("TextColor3", "TextColor3", p.TextColor3)
          + guiNumberRow("TextSize", "TextSize", p.TextSize, 1, 1, 200)
          + guiBoolRow("TextScaled", "TextScaled", p.TextScaled)
          + guiBoolRow("TextWrapped", "TextWrapped", p.TextWrapped)
          + guiSelectRow("TextXAlignment", "TextXAlignment", ["Left", "Center", "Right"], p.TextXAlignment)
          + guiSelectRow("TextYAlignment", "TextYAlignment", ["Top", "Center", "Bottom"], p.TextYAlignment)
          + guiSelectRow("Font", "Font", ["Legacy", "SourceSans", "Code", "Fantasy"], p.Font)
          + guiNumberRow("LineHeight", "LineHeight", p.LineHeight, 0.1, 0.1, 5)
          + guiNumberRow("TextTransparency", "TextTransparency", p.TextTransparency, 0.05, 0, 1)
          + guiNumberRow("TextStrokeTransparency", "TextStrokeTransparency", p.TextStrokeTransparency, 0.05, 0, 1)
          + guiColorRow("TextStrokeColor3", "TextStrokeColor3", p.TextStrokeColor3)
          + guiBoolRow("RichText", "RichText", p.RichText);
      }
      if (node.class === "ImageLabel" || node.class === "ImageButton") {
        html += '<div class="rsPropGroup">Image</div>'
          + '<div class="rsPropRow"><span class="rsPropLabel">Image</span><input type="text" data-gp="Image" spellcheck="false" placeholder="https://…" value="' + esc(p.Image || "") + '"></div>'
          + guiColorRow("ImageColor3", "ImageColor3", p.ImageColor3)
          + guiNumberRow("ImageTransparency", "ImageTransparency", p.ImageTransparency, 0.05, 0, 1)
          + guiSelectRow("ScaleType", "ScaleType", ["Stretch", "Fit"], p.ScaleType);
      }
    }
    box.innerHTML = html;
  }

  function renderServiceProps(box, key) {
    const svc = SERVICE_ROWS.find(row => row.key === key);
    const count = key === "workspace" ? parts.length : key === "starterGui" ? GUI_ROOTS().length : (game.map.replicatedStorage || []).length;
    box.innerHTML = '<div class="rsPropGroup">Service</div>'
      + '<div class="rsPropRow"><span class="rsPropLabel">Name</span><span class="rsPropVal">' + esc(svc ? svc.name : key) + "</span></div>"
      + '<div class="rsPropRow"><span class="rsPropLabel">Class</span><span class="rsPropVal">' + esc(svc ? svc.name : key) + "</span></div>"
      + '<div class="rsPropRow"><span class="rsPropLabel">Children</span><span class="rsPropVal">' + count + "</span></div>"
      + '<div class="rsPropsEmpty" style="padding:12px 0 0">Use the + button on this row to insert objects.</div>';
  }

  function onGuiProp(input) {
    if (!selGui) return;
    const node = selGui, p = node.props;
    const num = (v, fallback) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; };
    if (input.dataset.gpudim) {
      const values = parseUdim(input.value);
      if (values) p[input.dataset.gpudim] = values;
    } else if (input.dataset.gpanchor) {
      const values = parseAnchor(input.value);
      if (values) p.AnchorPoint = values;
    } else if (input.dataset.gpvec) {
      const key = input.dataset.gpvec, idx = +input.dataset.idx;
      if (!Array.isArray(p[key])) return;
      p[key][idx] = num(input.value, p[key][idx]);
    } else {
      const key = input.dataset.gp;
      if (!key) return;
      if (key === "Name") {
        node.name = String(input.value || "").replace(/[\u0000-\u001f<>]/g, "").slice(0, 40) || node.class;
        renderTree();
      } else if (input.type === "checkbox") {
        p[key] = !!input.checked;
      } else if (input.type === "color") {
        p[key] = String(input.value || "#000000");
        const hex = input.parentElement && input.parentElement.querySelector(".rsHex");
        if (hex) hex.textContent = p[key];
      } else if (typeof p[key] === "number") {
        let v = num(input.value, p[key]);
        if (key === "BackgroundTransparency" || key === "TextTransparency" || key === "TextStrokeTransparency") v = Math.max(0, Math.min(1, v));
        if (key === "TextSize") v = Math.max(1, Math.min(200, v));
        p[key] = v;
      } else {
        p[key] = input.value;
      }
    }
    renderGui();
    markDirty();
  }

  function syncGuiVecInputs() {
    if (!selGui) return;
    for (const input of $("stProps").querySelectorAll("[data-gpudim]")) {
      if (document.activeElement === input) continue;
      const value = selGui.props[input.dataset.gpudim];
      if (Array.isArray(value)) input.value = fmtUdim(value);
    }
    for (const input of $("stProps").querySelectorAll("[data-gpanchor]")) {
      if (document.activeElement === input) continue;
      const a = selGui.props.AnchorPoint;
      input.value = round(+a[0] || 0, 1000) + ", " + round(+a[1] || 0, 1000);
    }
  }

  /* ---- dragging and resizing on the overlay ---- */
  function bindGuiLayer() {
    const layer = $("stGuiLayer");
    if (!layer || layer.dataset.bound) return;
    layer.dataset.bound = "1";
    layer.addEventListener("pointerdown", e => {
      const handle = e.target.closest("[data-handle]");
      const el = e.target.closest("[data-gui]");
      if (!el) return;
      const id = el.dataset.gui;
      const handleDir = handle ? handle.dataset.handle : "";
      const box = el.parentElement;
      const pw = Math.max(1, box ? box.clientWidth : 1);
      const ph = Math.max(1, box ? box.clientHeight : 1);
      const x = e.clientX, y = e.clientY;
      selectGui(id);
      if (!selGui || selGui.class === "ScreenGui") { e.preventDefault(); return; }
      guiDrag = { id, handle: handleDir, x, y, pw, ph, pos: selGui.props.Position.slice(), size: selGui.props.Size.slice() };
      document.body.classList.add("stGuiDragging");
      e.preventDefault();
      e.stopPropagation();
    });
    window.addEventListener("pointermove", onGuiDragMove);
    window.addEventListener("pointerup", onGuiDragEnd);
    window.addEventListener("pointercancel", onGuiDragEnd);
    layer.addEventListener("contextmenu", e => {
      const el = e.target.closest("[data-gui]");
      if (!el) return;
      e.preventDefault();
      selectGui(el.dataset.gui);
      const hit = guiFind(el.dataset.gui, GUI_ROOTS());
      if (hit) openContextMenu(e.clientX, e.clientY, { kind: "gui", node: hit.node, el: null });
    });
  }

  function onGuiDragMove(e) {
    if (!guiDrag || !selGui || selGui.id !== guiDrag.id) return;
    const dx = Math.round(e.clientX - guiDrag.x);
    const dy = Math.round(e.clientY - guiDrag.y);
    const p = selGui.props;
    if (!guiDrag.handle) {
      p.Position = [guiDrag.pos[0], guiDrag.pos[1] + dx, guiDrag.pos[2], guiDrag.pos[3] + dy];
    } else {
      const h = guiDrag.handle;
      let w = guiDrag.size[0] * guiDrag.pw + guiDrag.size[1];
      let height = guiDrag.size[2] * guiDrag.ph + guiDrag.size[3];
      if (h.includes("e")) w += dx;
      if (h.includes("w")) w -= dx;
      if (h.includes("s")) height += dy;
      if (h.includes("n")) height -= dy;
      w = Math.max(4, Math.round(w));
      height = Math.max(4, Math.round(height));
      p.Size = [0, w, 0, height];
      if (h.includes("w")) p.Position = [guiDrag.pos[0], guiDrag.pos[1] + dx, guiDrag.pos[2], guiDrag.pos[3]];
      if (h.includes("n")) p.Position = [guiDrag.pos[0], guiDrag.pos[1], guiDrag.pos[2], guiDrag.pos[3] + dy];
    }
    renderGui();
    syncGuiVecInputs();
  }

  function onGuiDragEnd() {
    if (!guiDrag) return;
    guiDrag = null;
    document.body.classList.remove("stGuiDragging");
    renderProps();
    markDirty();
  }

  /* =====================================================================
     block scripting (Script = server, LocalScript = client)
     ===================================================================== */
  const SCRIPT_BLOCKS = {
    onStart: { cat: "event", label: "when game starts", args: {}, hat: true },
    onClick: { cat: "event", label: "when {target} is clicked", args: { target: "" }, hat: true },
    onHover: { cat: "event", label: "when {target} is hovered", args: { target: "" }, hat: true },
    onTouch: { cat: "event", label: "when player touches {part}", args: { part: "" }, hat: true },
    onTouchSelf: { cat: "event", label: "when this part is touched", args: {}, hat: true },
    onKey:   { cat: "event", label: "when key {key} is pressed", args: { key: "space" }, hat: true },
    onVariable: { cat: "event", label: "when {var} {op} {value}", args: { var: "", op: "=", value: "0" }, hat: true },
    every:   { cat: "event", label: "every {n} seconds", args: { n: "1" }, hat: true },

    wait:    { cat: "flow", label: "wait {n} seconds", args: { n: "1" } },
    waitUntil: { cat: "flow", label: "wait until {var} {op} {value}", args: { var: "", op: "=", value: "0" } },
    repeat:  { cat: "flow", label: "repeat {n} times", args: { n: "3" }, body: true },
    repeatForever: { cat: "flow", label: "repeat forever (yields 0.03s)", args: {}, body: true },
    if:      { cat: "flow", label: "if {target} · {prop} {op} {value}", args: { target: "", prop: "Text", op: "=", value: "" }, body: true },
    stop:    { cat: "flow", label: "stop this script", args: {} },

    setVar:    { cat: "var", label: "set {var} to {value}", args: { var: "", value: "0" } },
    changeVar: { cat: "var", label: "change {var} by {n}", args: { var: "", n: "1" } },
    setVarRandom: { cat: "var", label: "set {var} to random {min} to {max}", args: { var: "", min: "1", max: "10" } },
    changeVarRandom: { cat: "var", label: "change {var} by random {min} to {max}", args: { var: "", min: "1", max: "10" } },
    setVarOp:  { cat: "var", label: "set {var} to {var2} {mop} {n}", args: { var: "", var2: "", mop: "+", n: "1" } },
    clampVar:  { cat: "var", label: "limit {var} between {min} and {max}", args: { var: "", min: "0", max: "100" } },
    ifVar:     { cat: "var", label: "if {var} {op} {value}", args: { var: "", op: "=", value: "0" }, body: true, elseBody: true },

    setText:   { cat: "ui", label: "set text of {target} to {text}", args: { target: "", text: "Hello" } },
    setTextVar:{ cat: "ui", label: "set text of {target} to variable {var}", args: { target: "", var: "" } },
    setProp:   { cat: "ui", label: "set {prop} of {target} to {value}", args: { target: "", prop: "BackgroundColor3", value: "#ffbf2f" } },
    setPropVar:{ cat: "ui", label: "set {prop} of {target} to variable {var}", args: { target: "", prop: "Text", var: "" } },
    show:      { cat: "ui", label: "show {target}", args: { target: "" } },
    hide:      { cat: "ui", label: "hide {target}", args: { target: "" } },
    tweenGui:  { cat: "ui", label: "tween {target} to x {x} y {y} in {n} seconds", args: { target: "", x: "0.5", y: "0.5", n: "1" } },

    partColor:  { cat: "part", label: "set colour of part {part} to {color}", args: { part: "", color: "#ff4444" } },
    partTrans:  { cat: "part", label: "set transparency of part {part} to {n}", args: { part: "", n: "0.5" } },
    partShow:   { cat: "part", label: "show part {part}", args: { part: "" } },
    partHide:   { cat: "part", label: "hide part {part}", args: { part: "" } },
    setCollide: { cat: "part", label: "set {part} can collide {on}", args: { part: "", on: "true" } },
    setAnchored:{ cat: "part", label: "set {part} anchored {on}", args: { part: "", on: "true" } },
    movePart:   { cat: "part", label: "move part {part} by {x} {y} {z}", args: { part: "", x: "0", y: "1", z: "0" } },
    setPartPos: { cat: "part", label: "set part {part} position to {x} {y} {z}", args: { part: "", x: "0", y: "0", z: "0" } },
    setPartSize:{ cat: "part", label: "set part {part} size to {x} {y} {z}", args: { part: "", x: "4", y: "1", z: "4" } },
    rotatePart: { cat: "part", label: "rotate part {part} by {x} {y} {z} degrees", args: { part: "", x: "0", y: "90", z: "0" } },
    tweenPart:  { cat: "part", label: "tween part {part} to {x} {y} {z} in {n} seconds", args: { part: "", x: "0", y: "3", z: "0", n: "1" } },
    destroyPart:{ cat: "part", label: "destroy part {part}", args: { part: "" } },

    teleport:   { cat: "world", label: "teleport player to {x} {y} {z}", args: { x: "0", y: "3", z: "0" } },
    teleportPart:{ cat: "world", label: "teleport player to part {part}", args: { part: "" } },
    setGravity: { cat: "world", label: "set gravity to {n}", args: { n: "196.2" } },
    forcefield: { cat: "world", label: "give player forcefield for {n} seconds", args: { n: "3" } },
    walkSpeed:  { cat: "world", label: "set walk speed to {n}", args: { n: "16" } },
    jumpPower:  { cat: "world", label: "set jump power to {n}", args: { n: "50" } },
    setMaxHealth: { cat: "world", label: "set max health to {n}", args: { n: "100" } },
    setHealth:  { cat: "world", label: "set health to {n}", args: { n: "100" } },
    damage:     { cat: "world", label: "damage player by {n}", args: { n: "10" } },
    heal:       { cat: "world", label: "heal player by {n}", args: { n: "10" } },
    kill:       { cat: "world", label: "kill player", args: {} },
    respawn:    { cat: "world", label: "respawn player", args: {} },

    print:   { cat: "debug", label: "log {text}", args: { text: "hello" } },
    printVar:{ cat: "debug", label: "log variable {var}", args: { var: "" } },
  };
  const BLOCK_CATS = { event: "Events", flow: "Flow", var: "Variables", ui: "UI", part: "Parts", world: "Player", debug: "Debug" };
  const BLOCK_COLORS = { event: "#8a6a2f", flow: "#7c5a2d", var: "#9a5a2c", ui: "#2f5d8a", part: "#35664a", world: "#4a5568", debug: "#5a4a7a" };
  const BLOCK_PROPS = ["Text", "TextColor3", "TextSize", "TextTransparency", "BackgroundColor3", "BackgroundTransparency", "BorderSizePixel", "Visible", "ZIndex", "Position", "Size", "Rotation", "Image", "ImageTransparency"];
  const BLOCK_OPS = ["=", "≠", "<", ">"];

  let scriptEdit = null, selectedBlock = null, blockSeq = 0;
  let blkDrag = null, blkDropLine = null, blkClickSuppress = 0;

  function blockColor(type) {
    const def = SCRIPT_BLOCKS[type];
    return (def && BLOCK_COLORS[def.cat]) || "#555";
  }

  function clearDropMarks() {
    if (blkDropLine && blkDropLine.parentElement) blkDropLine.remove();
    for (const el of document.querySelectorAll(".blkStack.dropOn")) el.classList.remove("dropOn");
    const trash = document.querySelector(".blkTrash");
    if (trash) trash.classList.remove("on");
    const pal = $("stPalette");
    if (pal) pal.classList.remove("dragOver");
  }

  function endBlockDrag() {
    if (blkDrag && blkDrag.ghost) blkDrag.ghost.remove();
    blkDrag = null;
    clearDropMarks();
    document.body.classList.remove("blkDragging");
    for (const el of document.querySelectorAll(".isDragging")) el.classList.remove("isDragging");
  }

  function dropLineAt(stack, index) {
    if (!blkDropLine) { blkDropLine = document.createElement("div"); blkDropLine.className = "blkDropLine"; }
    const kids = Array.from(stack.children).filter(child => child.dataset && child.dataset.block);
    const before = kids[index] || null;
    if (blkDropLine.parentElement !== stack || blkDropLine.nextSibling !== before) {
      stack.insertBefore(blkDropLine, before);
    }
  }

  /* ---- pointer dragging for blocks (palette and stack) ---- */
  function beginBlockPointerDrag(e, source) {
    if (e.button !== 0 || !scriptEdit) return;
    if (e.target.closest("input,select,button,a")) return;
    const row = e.target.closest(".blkRow");
    if (!row) return;
    let srcEl = source === "palette" ? row.closest("[data-palette]") : row.closest("[data-block]");
    if (!srcEl) return;
    if (source !== "palette" && !srcEl.closest("#stScriptStack")) return;
    const payload = source === "palette"
      ? { from: "palette", type: srcEl.dataset.palette }
      : { from: "script", id: srcEl.dataset.block };
    if (!payload.type && !payload.id) return;
    blkDrag = { payload, srcEl, x: e.clientX, y: e.clientY, started: false, ghost: null };
  }

  function startBlockGhost() {
    const drag = blkDrag;
    if (!drag || drag.ghost) return;
    const row = drag.srcEl.querySelector(":scope > .blkRow");
    const ghost = document.createElement("div");
    ghost.className = "blk blkGhost" + (drag.srcEl.classList.contains("blkHat") ? " blkHat" : "");
    ghost.style.setProperty("--blk-color", getComputedStyle(drag.srcEl).backgroundColor);
    ghost.style.width = Math.round(drag.srcEl.getBoundingClientRect().width) + "px";
    ghost.innerHTML = row ? row.outerHTML : "";
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.started = true;
    drag.srcEl.classList.add("isDragging");
    document.body.classList.add("blkDragging");
  }

  function moveBlockPointerDrag(e) {
    const drag = blkDrag;
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      startBlockGhost();
    }
    e.preventDefault();
    drag.ghost.style.transform = "translate(" + (e.clientX + 12) + "px, " + (e.clientY + 10) + "px)";
    drag.target = blockDropTargetAt(e.clientX, e.clientY);
  }

  function blockDropTargetAt(x, y) {
    clearDropMarks();
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const trash = el.closest(".blkTrash");
    if (trash) { trash.classList.add("on"); return { kind: "trash" }; }
    const stack = el.closest(".blkStack");
    if (stack) {
      const ownerId = stack.dataset.drop;
      const payload = blkDrag && blkDrag.payload;
      let def = null;
      if (payload) {
        if (payload.from === "palette") def = SCRIPT_BLOCKS[payload.type];
        else { const hit = findBlockEntry(scriptEdit.blocks || [], payload.id); def = hit && SCRIPT_BLOCKS[hit.block.type]; }
      }
      if (def && def.hat && ownerId !== "root") return null;
      stack.classList.add("dropOn");
      const index = dropIndex(stack, y);
      dropLineAt(stack, index);
      return { kind: "stack", ownerId, index };
    }
    if (el.closest(".stScriptCanvas")) {
      const root = document.querySelector("#stScriptStack > .blkStack");
      if (!root) return null;
      root.classList.add("dropOn");
      const count = root.querySelectorAll(":scope > .blk").length;
      dropLineAt(root, count);
      return { kind: "root", count };
    }
    return null;
  }

  function endBlockPointerDrag(e) {
    const drag = blkDrag;
    if (!drag) return;
    let target = null;
    if (drag.started) {
      target = blockDropTargetAt(e.clientX, e.clientY);
      blkClickSuppress = Date.now() + 250;
      if (e.cancelable) e.preventDefault();
    }
    blkDrag = null;
    if (drag.started && target) {
      if (target.kind === "trash" && drag.payload.from === "script") {
        const entry = findBlockEntry(scriptEdit.blocks || [], drag.payload.id);
        if (entry) {
          entry.list.splice(entry.index, 1);
          if (selectedBlock && selectedBlock.id === drag.payload.id) selectedBlock = null;
          markDirty();
          renderBlocks();
        }
      } else if (target.kind === "stack") {
        applyBlockDrop(drag.payload, target.ownerId, target.index);
      } else if (target.kind === "root") {
        applyBlockDrop(drag.payload, "root", target.count);
      }
    }
    if (drag.ghost) drag.ghost.remove();
    clearDropMarks();
    document.body.classList.remove("blkDragging");
    for (const el of document.querySelectorAll(".isDragging")) el.classList.remove("isDragging");
  }

  function cancelBlockPointerDrag() {
    const drag = blkDrag;
    if (!drag) return;
    if (drag.ghost) drag.ghost.remove();
    blkDrag = null;
    clearDropMarks();
    document.body.classList.remove("blkDragging");
    for (const el of document.querySelectorAll(".isDragging")) el.classList.remove("isDragging");
  }

  function newBlock(type) {
    const def = SCRIPT_BLOCKS[type];
    if (!def) return null;
    const block = {
      id: "b" + (++blockSeq) + Math.random().toString(36).slice(2, 5),
      type,
      args: Object.assign({}, def.args),
    };
    if (def.body) block.body = [];
    if (def.elseBody) block.elseBody = [];
    return block;
  }

  function ensureScriptVars(node) { if (!Array.isArray(node.vars)) node.vars = []; return node.vars; }

  function setHat(block) {
    if (!scriptEdit || !block) return;
    const root = scriptEdit.blocks || (scriptEdit.blocks = []);
    for (let i = root.length - 1; i >= 0; i--) {
      if (SCRIPT_BLOCKS[root[i].type] && SCRIPT_BLOCKS[root[i].type].hat) root.splice(i, 1);
    }
    root.unshift(block);
    selectedBlock = block;
    markDirty();
    renderBlocks();
  }

  function promptVariable() {
    if (!scriptEdit) return;
    StudioUI.dialog({
      title: "Make a Variable",
      body: '<label class="rsField">Variable name<input id="stVarName" type="text" maxlength="30" spellcheck="false" placeholder="score"></label>'
        + '<label class="rsField">Starting value<input id="stVarValue" type="text" maxlength="40" spellcheck="false" value="0"></label>'
        + '<div class="rsAbout">Variables are shared by every script in this game.</div>',
      buttons: [
        { label: "Cancel" },
        {
          label: "Create",
          primary: true,
          onClick: () => {
            const nameInput = $("stVarName");
            const valueInput = $("stVarValue");
            const raw = String((nameInput && nameInput.value) || "").replace(/[^A-Za-z0-9_ ]/g, "").trim().slice(0, 30);
            if (!raw) return false;
            ensureGui();
            if (!(raw in game.map.vars)) game.map.vars[raw] = String((valueInput && valueInput.value) || "0").slice(0, 40);
            markDirty();
            renderPalette();
            renderBlocks();
          },
        },
      ],
    });
    setTimeout(() => { const input = $("stVarName"); if (input) input.focus(); }, 30);
  }

  function removeVariable(name) {
    if (!game || !game.map || !game.map.vars) return;
    delete game.map.vars[name];
    markDirty();
    renderPalette();
    renderBlocks();
  }

  function guiNamesForScripts() {
    const names = [];
    (function walk(list) {
      for (const node of list || []) {
        if (!isScript(node) && node.class !== "Folder") names.push(node.name);
        if (node.children) walk(node.children);
      }
    })(game.map.gui);
    return Array.from(new Set(names));
  }

  function blockSlotPlaceholder(key) {
    return ({ target: "object", prop: "property", op: "=", n: "number", text: "text", value: "value", on: "yes / no", key: "key", var2: "variable", mop: "+", min: "number", max: "number" })[key] || key;
  }

  function blockInputHtml(key, block) {
    const value = block.args[key] == null ? "" : block.args[key];
    const common = ' data-arg="' + key + '" draggable="false"';
    if (key === "target") {
      const names = guiNamesForScripts();
      return '<select class="blkInput"' + common + '><option value="">— object —</option>'
        + names.map(n => '<option value="' + esc(n) + '"' + (n === value ? " selected" : "") + ">" + esc(n) + "</option>").join("")
        + "</select>";
    }
    if (key === "part") {
      const names = Array.from(new Set(parts.map(p => p.name)));
      return '<select class="blkInput"' + common + '><option value="">— part —</option>'
        + names.map(n => '<option value="' + esc(n) + '"' + (n === value ? " selected" : "") + ">" + esc(n) + "</option>").join("")
        + "</select>";
    }
    if (key === "var") {
      const vars = (game && game.map && game.map.vars) ? Object.keys(game.map.vars) : [];
      return '<select class="blkInput"' + common + '><option value="">— variable —</option>'
        + vars.map(n => '<option value="' + esc(n) + '"' + (n === value ? " selected" : "") + ">" + esc(n) + "</option>").join("")
        + "</select>";
    }
    if (key === "prop") return '<select class="blkInput"' + common + ">" + optionList(BLOCK_PROPS, value || "Text") + "</select>";
    if (key === "op") return '<select class="blkInput"' + common + ">" + optionList(BLOCK_OPS, value || "=") + "</select>";
    if (key === "key") {
      const list = [["space", "Space"], ["w", "W"], ["a", "A"], ["s", "S"], ["d", "D"], ["shift", "Shift"], ["e", "E"], ["q", "Q"], ["r", "R"], ["f", "F"], ["g", "G"], ["enter", "Enter"], ["arrowup", "Up"], ["arrowdown", "Down"], ["arrowleft", "Left"], ["arrowright", "Right"]];
      return '<select class="blkInput"' + common + ">" + list.map(([v, label]) => '<option value="' + v + '"' + (v === value ? " selected" : "") + ">" + label + "</option>").join("") + "</select>";
    }
    if (key === "var2") {
      const vars = (game && game.map && game.map.vars) ? Object.keys(game.map.vars) : [];
      return '<select class="blkInput"' + common + '><option value="">— variable —</option>'
        + vars.map(n => '<option value="' + esc(n) + '"' + (n === value ? " selected" : "") + ">" + esc(n) + "</option>").join("")
        + "</select>";
    }
    if (key === "mop") {
      return '<select class="blkInput"' + common + ">" + optionList(["+", "-", "×", "÷"], value || "+") + "</select>";
    }
    if (key === "min" || key === "max") return '<input class="blkInput blkNum" type="number" step="0.1"' + common + ' value="' + esc(value) + '">';
    if (key === "on") {
      const on = value !== "false";
      return '<select class="blkInput"' + common + '><option value="true"' + (on ? " selected" : "") + ">yes</option><option value=\"false\"" + (on ? "" : " selected") + ">no</option></select>";
    }
    if (key === "color") return '<input class="blkInput blkColor" type="color"' + common + ' value="' + esc(value || "#ff4444") + '">';
    if (key === "x" || key === "y" || key === "z") return '<input class="blkInput blkAxis" type="number" step="1"' + common + ' value="' + esc(value) + '">';
    if (key === "n") return '<input class="blkInput blkNum" type="number" step="0.1"' + common + ' value="' + esc(value) + '">';
    return '<input class="blkInput blkText" type="text"' + common + ' value="' + esc(value) + '">';
  }

  function blockLabelHtml(def, block, palette) {
    const parts = def.label.split(/\{(\w+)\}/g);
    let html = "";
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) { if (parts[i]) html += '<span class="blkText">' + esc(parts[i]) + "</span>"; }
      else if (palette) html += '<span class="blkSlot">' + blockSlotPlaceholder(parts[i]) + "</span>";
      else html += blockInputHtml(parts[i], block);
    }
    return html;
  }

  function renderScriptProps(box, node) {
    const key = listKeyOf(node);
    const parentName = node.parentPart || (key === "workspaceScripts" ? "Workspace" : key === "replicatedStorage" ? "ReplicatedStorage" : "StarterGUI");
    const blocks = (node.blocks || []).length;
    box.innerHTML =
      '<div class="rsPropGroup">Data</div>'
      + '<div class="rsPropRow"><span class="rsPropLabel">Name</span><input type="text" data-gp="Name" maxlength="40" value="' + esc(node.name) + '"></div>'
      + '<div class="rsPropRow"><span class="rsPropLabel">Class</span><span class="rsPropVal">' + esc(node.class) + "</span></div>"
      + '<div class="rsPropRow"><span class="rsPropLabel">Parent</span><span class="rsPropVal">' + esc(parentName) + "</span></div>"
      + '<div class="rsPropGroup">Script</div>'
      + '<div class="rsPropRow"><span class="rsPropLabel">Runs</span><span class="rsPropVal">' + (node.class === "Script" ? "Server · on start" : "Client · on start") + "</span></div>"
      + '<div class="rsPropRow"><span class="rsPropLabel">Blocks</span><span class="rsPropVal">' + blocks + "</span></div>"
      + '<div class="rsPropRow"><button type="button" class="rsBtn rsOpenScript" data-open-script="1">Open block editor</button></div>';
  }

  function openScriptEditor(node) {
    if (!isScript(node) || playing) return;
    endBlockDrag();
    closeInsertMenu();
    closeContextMenu();
    closeMenus();
    scriptEdit = node;
    selectedBlock = null;
    if (!Array.isArray(scriptEdit.blocks)) scriptEdit.blocks = [];
    $("stScriptEditor").hidden = false;
    $("stScriptName").value = node.name;
    const badge = $("stScriptClass");
    badge.textContent = node.class;
    badge.className = "stScriptBadge " + (node.class === "Script" ? "isServer" : "isLocal");
    renderPalette();
    renderBlocks();
    $("stScriptStack").focus();
  }

  function closeScriptEditor() {
    const panel = $("stScriptEditor");
    if (!panel || panel.hidden) return;
    endBlockDrag();
    panel.hidden = true;
    scriptEdit = null;
    selectedBlock = null;
    renderTree();
    renderProps();
  }

  function renderPalette() {
    const box = $("stPalette");
    if (!box) return;
    let html = '<div class="blkPaletteHead">Blocks</div>';
    for (const cat of Object.keys(BLOCK_CATS)) {
      const rows = Object.entries(SCRIPT_BLOCKS).filter(([, def]) => def.cat === cat);
      if (!rows.length) continue;
      const color = BLOCK_COLORS[cat] || "#555";
      html += '<div class="blkCat"><i class="blkCatDot" style="background:' + color + '"></i>' + BLOCK_CATS[cat] + "</div>";
      for (const [type, def] of rows) {
        html += '<div class="blk blkPaletteItem blk-' + cat + (def.hat ? " blkHat" : "") + '" role="button" tabindex="0" data-palette="' + type + '" style="--blk-color:' + color + '">'
          + '<div class="blkRow">' + blockLabelHtml(def, { args: {} }, true) + "</div></div>";
      }
    }
    const vars = (game && game.map && game.map.vars) ? Object.keys(game.map.vars) : [];
    html += '<div class="blkCat"><i class="blkCatDot" style="background:#9a5a2c"></i>My Variables</div>'
      + '<div class="blkVars">' + (vars.length
        ? vars.map(v => '<span class="blkVarChip">' + esc(v) + '<button type="button" data-del-var="' + esc(v) + '" aria-label="Delete ' + esc(v) + '">&times;</button></span>').join("")
        : '<span class="blkVarsEmpty">No variables yet</span>') + "</div>"
      + '<button type="button" class="blkAddVar" data-add-var="1">+ Make a Variable</button>'
      + '<div class="blkTrash" data-trash="1" tabindex="0" aria-label="Delete blocks"><b>Delete</b><span>Drop a block here to remove it</span></div>';
    box.innerHTML = html;
  }

  function renderBlocks() {
    const stack = $("stScriptStack");
    if (!stack || !scriptEdit) return;
    stack.innerHTML = "";
    stack.classList.toggle("isBlank", !(scriptEdit.blocks || []).length);
    stack.appendChild(renderStack(scriptEdit.blocks || [], "root", true));
  }

  function renderStack(list, ownerId, showIntro) {
    const wrap = document.createElement("div");
    wrap.className = "blkStack";
    wrap.dataset.drop = ownerId;
    if (ownerId === "root") { wrap.tabIndex = 0; wrap.setAttribute("aria-label", "Script stack"); }
    if (showIntro && !list.length) {
      const intro = document.createElement("div");
      intro.className = "blkIntro";
      intro.innerHTML = '<b>Build your script</b><span>Drag an event block from the left, then stack action blocks underneath it.</span>';
      wrap.appendChild(intro);
    }
    let prevColor = "";
    for (const block of list) {
      if (!SCRIPT_BLOCKS[block.type]) continue;
      const el = renderBlock(block);
      if (prevColor) { el.style.setProperty("--prev-color", prevColor); el.classList.add("hasPrev"); }
      prevColor = blockColor(block.type);
      wrap.appendChild(el);
    }
    wireStackDrop(wrap);
    return wrap;
  }

  function renderBlock(block) {
    const def = SCRIPT_BLOCKS[block.type];
    const el = document.createElement("div");
    if (!def) return el;
    el.className = "blk blk-" + def.cat + (def.hat ? " blkHat" : "") + (selectedBlock === block ? " isSel" : "");
    el.dataset.block = block.id;
    el.tabIndex = 0;
    el.style.setProperty("--blk-color", blockColor(block.type));
    el.innerHTML = '<div class="blkRow">' + blockLabelHtml(def, block) + "</div>";
    if (def.body) {
      const body = renderStack(block.body || [], block.id);
      body.classList.add("blkBody");
      el.appendChild(body);
    }
    if (def.elseBody) {
      const label = document.createElement("div");
      label.className = "blkElseLabel";
      label.textContent = "else";
      el.appendChild(label);
      const alt = renderStack(block.elseBody || [], block.id + ":else");
      alt.classList.add("blkBody", "blkElseBody");
      el.appendChild(alt);
    }
    for (const input of el.querySelectorAll("[data-arg]")) {
      const set = () => { block.args[input.dataset.arg] = input.value; markDirty(); };
      input.addEventListener("input", set);
      input.addEventListener("change", set);
      input.addEventListener("pointerdown", e => e.stopPropagation());
      input.addEventListener("dragstart", e => e.preventDefault());
    }
    el.addEventListener("click", e => {
      if (Date.now() < blkClickSuppress) return;
      if (e.target.closest("input,select")) return;
      selectedBlock = block;
      renderBlocks();
    });
    return el;
  }

  function blockById(blocks, id) {
    for (const block of blocks || []) {
      if (block.id === id) return block;
      for (const list of [block.body, block.elseBody]) {
        if (!list) continue;
        const hit = blockById(list, id);
        if (hit) return hit;
      }
    }
    return null;
  }

  function findBlockEntry(blocks, id, list) {
    const arr = list || blocks;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === id) return { block: arr[i], list: arr, index: i };
      for (const sub of [arr[i].body, arr[i].elseBody]) {
        if (!sub) continue;
        const hit = findBlockEntry(sub, id, sub);
        if (hit) return hit;
      }
    }
    return null;
  }

  function blockContainsId(block, id) {
    for (const kid of (block.body || []).concat(block.elseBody || [])) {
      if (kid.id === id || blockContainsId(kid, id)) return true;
    }
    return false;
  }

  function dropIndex(stackEl, clientY) {
    const kids = Array.from(stackEl.children).filter(child => child.dataset && child.dataset.block);
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return kids.length;
  }

  function wireStackDrop(el) {
    el.addEventListener("dragover", e => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = (blkDrag && blkDrag.from === "palette") ? "copy" : "move";
      el.classList.add("dropOn");
      dropLineAt(el, dropIndex(el, e.clientY));
    });
    el.addEventListener("dragleave", e => {
      if (el.contains(e.relatedTarget)) return;
      el.classList.remove("dropOn");
      if (blkDropLine && blkDropLine.parentElement === el) blkDropLine.remove();
    });
    el.addEventListener("drop", e => {
      e.preventDefault();
      e.stopPropagation();
      clearDropMarks();
      if (!scriptEdit) return;
      let payload = null;
      try { payload = JSON.parse(e.dataTransfer.getData("text/plain") || "null"); } catch (_) {}
      applyBlockDrop(payload, el.dataset.drop, dropIndex(el, e.clientY));
    });
  }

  function applyBlockDrop(payload, ownerId, index) {
    if (!payload || !scriptEdit) return;
    const payloadDef = payload.from === "palette"
      ? SCRIPT_BLOCKS[payload.type]
      : (() => { const found = findBlockEntry(scriptEdit.blocks || [], payload.id); return found ? SCRIPT_BLOCKS[found.block.type] : null; })();
    if (payloadDef && payloadDef.hat) {
      if (ownerId !== "root") return;
      if (payload.from === "palette") setHat(newBlock(payload.type));
      else {
        const entry = findBlockEntry(scriptEdit.blocks || [], payload.id);
        if (entry) { entry.list.splice(entry.index, 1); setHat(entry.block); }
      }
      return;
    }
    const owner = ownerId === "root" ? null : blockById(scriptEdit.blocks || [], ownerId.replace(/:else$/, ""));
    const targetList = ownerId === "root"
      ? (scriptEdit.blocks || (scriptEdit.blocks = []))
      : ownerId.slice(-5) === ":else"
        ? (owner ? (owner.elseBody || (owner.elseBody = [])) : null)
        : (owner && owner.body ? owner.body : null);
    if (!targetList) return;
    if (payload.from === "palette") {
      const block = newBlock(payload.type);
      if (!block) return;
      targetList.splice(Math.max(0, Math.min(index, targetList.length)), 0, block);
      selectedBlock = block;
    } else {
      const entry = findBlockEntry(scriptEdit.blocks || [], payload.id);
      if (!entry) return;
      if (payload.id === ownerId || blockContainsId(entry.block, ownerId)) return;
      const sameList = entry.list === targetList;
      entry.list.splice(entry.index, 1);
      let at = index;
      if (sameList && entry.index < index) at--;
      targetList.splice(Math.max(0, Math.min(at, targetList.length)), 0, entry.block);
      selectedBlock = entry.block;
    }
    markDirty();
    renderBlocks();
  }

  function deleteSelectedBlock() {
    if (!scriptEdit || !selectedBlock) return;
    const entry = findBlockEntry(scriptEdit.blocks || [], selectedBlock.id);
    if (entry) entry.list.splice(entry.index, 1);
    selectedBlock = null;
    markDirty();
    renderBlocks();
  }

  function bindScriptEditor() {
    const close = $("stScriptClose");
    if (close) close.addEventListener("click", closeScriptEditor);
    const name = $("stScriptName");
    if (name) name.addEventListener("input", () => {
      if (!scriptEdit) return;
      scriptEdit.name = String(name.value || "").replace(/[\u0000-\u001f<>]/g, "").slice(0, 40) || scriptEdit.class;
      renderTree();
      markDirty();
    });
    const palette = $("stPalette");
    if (palette) {
      palette.addEventListener("click", e => {
        const add = e.target.closest("[data-add-var]");
        if (add) { promptVariable(); return; }
        const del = e.target.closest("[data-del-var]");
        if (del) { removeVariable(del.dataset.delVar); return; }
        const item = e.target.closest("[data-palette]");
        if (!item || !scriptEdit) return;
        if (Date.now() < blkClickSuppress) return;
        const block = newBlock(item.dataset.palette);
        if (!block) return;
        if (SCRIPT_BLOCKS[block.type].hat) { setHat(block); return; }
        (scriptEdit.blocks || (scriptEdit.blocks = [])).push(block);
        selectedBlock = block;
        markDirty();
        renderBlocks();
      });
      palette.addEventListener("pointerdown", e => beginBlockPointerDrag(e, "palette"));
    }
    const stackBox = $("stScriptStack");
    if (stackBox) stackBox.addEventListener("pointerdown", e => beginBlockPointerDrag(e, "script"));
    document.addEventListener("pointermove", moveBlockPointerDrag);
    document.addEventListener("pointerup", endBlockPointerDrag);
    document.addEventListener("pointercancel", cancelBlockPointerDrag);
    document.addEventListener("keydown", e => {
      const panel = $("stScriptEditor");
      if (!panel || panel.hidden) return;
      const typing = e.target && (e.target.closest && e.target.closest("input,select,textarea"));
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeScriptEditor(); return; }
      if (!typing && (e.key === "Delete" || e.key === "Backspace") && selectedBlock) {
        e.preventDefault(); e.stopPropagation(); deleteSelectedBlock();
      }
    }, true);
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
    if (selGui) { renderGuiProps(box, selGui); return; }
    if (selService) { renderServiceProps(box, selService); return; }
    if (!selected) {
      box.innerHTML = '<div class="rsPropsEmpty">Select an object in the Explorer or click it in the viewport.</div>';
      return;
    }
    const p = selected;
    const e = new THREE.Euler().setFromQuaternion(p.quat, "XYZ");
    const deg = v => round(v * 180 / Math.PI, 10);
    box.innerHTML =
      `<div class="rsPropGroup">Data</div>`
      + `<div class="rsPropRow"><span class="rsPropLabel">Name</span><input type="text" data-prop="name" maxlength="40" value="${esc(p.name)}"></div>`
      + `<div class="rsPropRow"><span class="rsPropLabel">Class</span><span class="rsPropVal">${esc(p.className)}</span></div>`
      + `<div class="rsPropRow"><span class="rsPropLabel">Shape</span><select data-prop="shape">${SHAPES.map((n, i) => `<option value="${i}"${i === p.shape ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></div>`
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
    if (input.dataset && (input.dataset.gp || input.dataset.gpvec || input.dataset.gpudim || input.dataset.gpanchor)) { onGuiProp(input); return; }
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
    } else if (prop === "shape") {
      const idx = +input.value;
      if (idx >= 0 && idx <= 4) { setPartShape(part, idx); return; }
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
    bindScriptEditor();
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
    renderGui();
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
      if (!running || playing || (e.button !== 0 && e.button !== 1 && e.button !== 2)) return;
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
      if (!running || playing) return;
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
      if (!running || playing) return;
      e.preventDefault();
      camera.getWorldDirection(tmpDir);
      camera.position.addScaledVector(tmpDir, -e.deltaY * 0.035);
    }, { passive: false });

    window.addEventListener("keydown", e => {
      if (!running) return;
      const tag = (e.target && e.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || (e.target && e.target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
      const scriptPanel = $("stScriptEditor");
      if (scriptPanel && !scriptPanel.hidden) return;
      if (e.key === "Escape") {
        if (playing) { e.preventDefault(); stopPlay(); return; }
        closeInsertMenu();
        closeContextMenu();
        closeMenus(); return;
      }
      if (typing || playing) return;
      if (e.key === "F2" && selGui) { e.preventDefault(); renameGui(selGui); return; }
      if (e.ctrlKey || e.metaKey) {                       // Edit menu shortcuts
        const k = e.key.toLowerCase();
        if (k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if (k === "y") { e.preventDefault(); redo(); return; }
        if (k === "x") { e.preventDefault(); cutSelected(); return; }
        if (k === "c") { e.preventDefault(); copySelected(); return; }
        if (k === "v") { e.preventDefault(); pasteClip(pasteTargetNode()); return; }
        if (k === "d") { e.preventDefault(); duplicateSelected(); return; }
      }
      if (e.key === "F5") { e.preventDefault(); startPlay(e.shiftKey); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && (selected || selGui)) { e.preventDefault(); deleteSelected(); return; }
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
    if (keys.has("e")) { camera.position.y += amount; moved = true; }
    if (keys.has("q")) { camera.position.y -= amount; moved = true; }
    if (moved) camera.position.y = Math.max(-40, camera.position.y);
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!running) return;
    if (playing) return;               // the embedded real game draws itself
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
    if (name !== "home") {
      const notes = {
        model: "Model tools come in a later update. For now insert parts from the Workspace row with +.",
        avatar: "Avatar tools come in a later update. Your real avatar skin is used when you press Play.",
        ui: "Select StarterGUI in the Explorer and press + to add a ScreenGui. Inside a ScreenGui, Frame or Folder, + adds Frame, TextLabel, TextButton, ImageLabel and Folder. Right-click any object for Copy, Paste Into, Duplicate, Rename and Delete. Drag to move, handles to resize.",
        script: "Scripts are block stacks. Start with a hat: when game starts, when <object> is clicked, or every N seconds. Use Variables for score/health, UI blocks to change labels, and Parts & Player blocks for colour, transparency, visibility, teleport and walk/jump speed.",
        plugins: "Plugins come in a later update.",
      };
      $("stRibbonSoon").textContent = notes[name] || "These tools will be added in a later version of Studio.";
    }
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
    if (name === "edit") syncEditMenu();
  }
  function doAction(act) {
    if (act === "save") save();
    else if (act === "publish") publish();
    else if (act === "undo") undo();
    else if (act === "redo") redo();
    else if (act === "cut") cutSelected();
    else if (act === "copy") copySelected();
    else if (act === "paste") pasteClip(pasteTargetNode());
    else if (act === "saveExit" || act === "exit") close();
    else if (act === "play") startPlay(false);
    else if (act === "playHere") startPlay(true);
    else if (act === "stop") stopPlay();
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
    const playBtn = $("stToolPlay");
    if (playBtn) playBtn.addEventListener("click", () => startPlay(false));
    const stopBtn = $("stToolStop");
    if (stopBtn) stopBtn.addEventListener("click", () => stopPlay());

    $("stTree").addEventListener("click", e => {
      const twist = e.target.closest("[data-twist]");
      if (twist) { const key = twist.dataset.twist; expanded[key] = expanded[key] === false; renderTree(); return; }
      const ins = e.target.closest("[data-insert]");
      if (ins) {
        const kind = ins.dataset.insert;
        let target = null;
        if (kind === "service:workspace") target = { kind: "workspace" };
        else if (kind === "service:replicatedStorage") target = { kind: "replicatedStorage" };
        else if (kind === "service:starterGui") target = { kind: "starterGui" };
        else if (kind.indexOf("gui:") === 0) {
          const hit = guiFind(kind.slice(4), GUI_ROOTS());
          if (hit) target = { kind: "gui", node: hit.node };
        }
        else if (kind.indexOf("part:") === 0) {
          const part = parts.find(p => p.key === kind.slice(5));
          if (part) target = { kind: "part", part };
        }
        if (target) openInsertMenu(ins, target);
        return;
      }
      const part = e.target.closest("[data-part]");
      if (part) { selectPart(part.dataset.part); return; }
      const gui = e.target.closest("[data-gui]");
      if (gui) { selectGui(gui.dataset.gui); return; }
      const svc = e.target.closest("[data-service]");
      if (svc) { selectService(svc.dataset.service); return; }
    });
    const treeBox = $("stTree");
    treeBox.addEventListener("dragstart", e => {
      const row = e.target.closest("[data-gui]");
      if (!row) return;
      const hit = findAnyNode(row.dataset.gui);
      if (!hit) return;
      treeDrag = { id: hit.node.id };
      try { e.dataTransfer.setData("text/plain", JSON.stringify({ tree: 1, id: hit.node.id })); } catch (_) {}
      e.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
      document.body.classList.add("treeDragging");
    });
    treeBox.addEventListener("dragend", endTreeDrag);
    treeBox.addEventListener("dragover", e => {
      if (!treeDrag) return;
      const row = e.target.closest("[data-gui], [data-part], [data-service]");
      if (!row) return;
      const hit = findAnyNode(treeDrag.id);
      const target = treeDropTarget(row);
      if (!hit || !canTreeDrop(hit.node, target)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      for (const el of treeBox.querySelectorAll(".dropInto")) el.classList.remove("dropInto");
      row.classList.add("dropInto");
    });
    treeBox.addEventListener("dragleave", e => {
      if (treeBox.contains(e.relatedTarget)) return;
      for (const el of treeBox.querySelectorAll(".dropInto")) el.classList.remove("dropInto");
    });
    treeBox.addEventListener("drop", e => {
      if (!treeDrag) return;
      const row = e.target.closest("[data-gui], [data-part], [data-service]");
      const hit = findAnyNode(treeDrag.id);
      const target = treeDropTarget(row);
      if (hit && target && canTreeDrop(hit.node, target)) {
        e.preventDefault();
        moveTreeNode(hit, target);
      }
      endTreeDrag();
    });
    $("stInsertMenu").addEventListener("click", e => {
      const b = e.target.closest("[data-cls]");
      if (b) insertFromMenu(b);
    });
    $("stTree").addEventListener("contextmenu", e => {
      const row = e.target.closest("[data-gui], [data-part], [data-service]");
      if (!row) return;
      e.preventDefault();
      let target;
      if (row.dataset.gui) {
        selectGui(row.dataset.gui);
        const hit = guiFind(row.dataset.gui, GUI_ROOTS());
        if (!hit) return;
        target = { kind: "gui", node: hit.node };
      } else if (row.dataset.part) {
        selectPart(row.dataset.part);
        target = { kind: "part", part: selected, el: row };
      } else {
        selectService(row.dataset.service);
        target = { kind: "service", key: row.dataset.service };
      }
      target.el = row;
      openContextMenu(e.clientX, e.clientY, target);
    });
    $("stContextMenu").addEventListener("click", e => {
      const b = e.target.closest("[data-cmd]");
      if (!b || b.disabled) return;
      const cmd = b.dataset.cmd, target = ctxTarget;
      closeContextMenu();
      runContextCommand(cmd, target);
    });
    $("stTree").addEventListener("dblclick", e => {
      const row = e.target.closest("[data-gui]");
      if (!row) return;
      const hit = findNode(row.dataset.gui);
      if (!hit) return;
      if (isScript(hit.node)) openScriptEditor(hit.node);
      else renameGui(hit.node);
    });
    document.addEventListener("pointerdown", e => {
      const menu = $("stInsertMenu");
      if (menu && !menu.hidden && !e.target.closest("#stInsertMenu") && !e.target.closest("[data-insert]")) closeInsertMenu();
      const ctx = $("stContextMenu");
      if (ctx && !ctx.hidden && !e.target.closest("#stContextMenu")) closeContextMenu();
    });
    bindGuiLayer();
    $("stProps").addEventListener("input", onPropInput);
    $("stProps").addEventListener("click", e => {
      const open = e.target.closest("[data-open-script]");
      if (open && selGui && isScript(selGui)) openScriptEditor(selGui);
    });

    $("stName").addEventListener("input", markDirty);
    $("stName").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.target.blur(); save(); }
    });
    bindLayout();
  }

  /* =====================================================================
     play test
     ===================================================================== */
  function paintPlayState() {
    const play = $("stToolPlay"), stop = $("stToolStop");
    if (play) play.disabled = playing;
    if (stop) stop.disabled = !playing;
  }

  function startPlay(here) {
    if (!running || playing || !game) return;
    if (typeof StudioPlay === "undefined") return;
    closeMenus();
    for (const p of parts) writeRow(p);
    playing = true;
    keys.clear();
    drag = null; down = null; gizmoDrag = null;
    playCam = { pos: camera.position.clone(), yaw, pitch };
    if (selBox) selBox.visible = false;
    if (gizmo) gizmo.visible = false;

    let spawn = null;
    if (here) {
      // "Play here": drop the character at the camera's ground position
      camera.getWorldDirection(tmpDir);
      const x = camera.position.x, z = camera.position.z;
      let top = -Infinity;
      for (const p of parts) {
        if (!p.collide) continue;
        p.mesh.updateWorldMatrix(true, false);
        const b = new THREE.Box3().setFromObject(p.mesh);
        if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
        if (b.max.y > top) top = b.max.y;
      }
      spawn = [x, isFinite(top) ? top + 0.1 : camera.position.y, z];
    }

    const ok = StudioPlay.start({
      viewport: $("stViewport"),
      map: game.map,
      name: game.name,
      spawnHere: !!here,
      spawn,
      onStop: () => stopPlay(),
    });
    if (!ok) {
      playing = false;
      playCam = null;
      if (selBox) selBox.visible = true;
      if (gizmo) gizmo.visible = true;
      return;
    }
    $("stEditor").classList.add("isPlaying");
    renderGui();
    paintPlayState();
    clock.getDelta();
  }

  function stopPlay() {
    if (!playing) return;
    playing = false;
    try { StudioPlay.stop(); } catch (_) {}
    if (playCam) {
      camera.position.copy(playCam.pos);
      yaw = playCam.yaw; pitch = playCam.pitch;
      camera.rotation.set(pitch, yaw, 0);
      playCam = null;
    }
    if (selBox) selBox.visible = true;
    if (gizmo) gizmo.visible = true;
    $("stEditor").classList.remove("isPlaying");
    keys.clear();
    drag = null; down = null; gizmoDrag = null;
    paintPlayState();
    renderGui();
    clock.getDelta();
    resize();
    paintStatus(dirty ? "dirty" : "saved");
  }

  /* =====================================================================
     publish to Triancle
     ===================================================================== */
  function publishId(studioId) {
    let s = String(studioId || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (s.charAt(0) === "s") s = s.slice(1);
    s = s.slice(0, 20);
    while (s.length < 3) s += "0";
    return "c" + s;
  }

  function publish() {
    if (!game) return;
    const sb = typeof StudioAuth !== "undefined" && StudioAuth.client ? StudioAuth.client() : null;
    const user = typeof StudioAuth !== "undefined" && StudioAuth.user ? StudioAuth.user() : null;
    if (!sb || !user) {
      StudioUI.dialog({
        title: "Publish to Triancle",
        body: `<div class="rsAbout">Publishing uses your Triancle account. Sign in to Studio first, then try again.</div>`,
      });
      return;
    }
    const prev = game.publish || {};
    const max = clamp(parseInt(prev.maxPlayers, 10) || 12, 1, 100);
    StudioUI.dialog({
      title: prev.id ? "Republish to Triancle" : "Publish to Triancle",
      body:
        `<label class="rsField">Game name<input id="stPubName" type="text" maxlength="40" spellcheck="false" value="${esc(prev.name || game.name || "Untitled game")}"></label>` +
        `<label class="rsField">Description<textarea id="stPubDesc" maxlength="600" rows="3" spellcheck="false" placeholder="What do players do in your game?">${esc(prev.description || "")}</textarea></label>` +
        `<label class="rsField">Max players per server<input id="stPubMax" type="number" min="1" max="100" step="1" value="${max}"></label>` +
        `<div id="stPubMsg" class="rsAbout"></div>`,
      buttons: [
        { label: "Cancel" },
        { label: prev.id ? "Republish" : "Publish", primary: true, onClick: () => { submitPublish(user); return false; } },
      ],
    });
    setTimeout(() => { const n = $("stPubName"); if (n) n.focus(); }, 30);
  }

  async function submitPublish(user) {
    const msg = $("stPubMsg");
    const name = studioCleanName($("stPubName").value) || "Untitled game";
    const description = String($("stPubDesc").value || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 600);
    const maxPlayers = clamp(parseInt($("stPubMax").value, 10) || 12, 1, 100);
    if (msg) { msg.className = "rsAbout"; msg.textContent = "Publishing…"; }
    try {
      const sb = StudioAuth.client();
      if (!sb) throw new Error("not signed in");
      for (const p of parts) writeRow(p);
      save(true);
      const id = publishId(game.id);
      const owner = (StudioAuth.name && StudioAuth.name()) || (user.user_metadata && user.user_metadata.username) || "Unknown";
      const row = {
        id, name, owner_name: owner,
        map: JSON.stringify(game.map),
        thumb: game.thumb || null,
        icon: game.thumb || null,
        description, max_players: maxPlayers,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      };
      let r = await sb.from("custom_games").upsert(row, { onConflict: "id" });
      let basicOnly = false;
      if (r.error && /column|could not find|schema cache/i.test(r.error.message || "")) {     // older table: publish the basics
        const { description: d, max_players: m, updated_at: u, ...base } = row;
        r = await sb.from("custom_games").upsert(base, { onConflict: "id" });
        basicOnly = !r.error;
      }
      if (r.error) throw r.error;
      game.publish = { id, name, description, maxPlayers, at: Date.now() };
      studioUpsert(game);
      paintStatus(dirty ? "dirty" : "saved");
      if (msg) {
        msg.textContent = basicOnly
          ? "Published, but the description and max players weren't saved: run supabase_publish.sql once, then publish again."
          : "Published! Open Triancle and look for “" + name + "”.";
      }
      setTimeout(() => StudioUI.close(), basicOnly ? 3200 : 1100);
    } catch (e) {
      if (msg) { msg.className = "rsAbout"; msg.textContent = "Couldn't publish: " + (e && e.message ? e.message : e); }
    }
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
    resetHistory();
    resetCamera();
    dirty = false;
    paintStatus("saved");
    $("stLoading").hidden = true;
    $("stMenu").hidden = true;
    $("stEditor").hidden = false;
    playing = false;
    playCam = null;
    $("stEditor").classList.remove("isPlaying");
    paintPlayState();
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
    autoSave = setInterval(() => { if (playing) return; if (running && dirty) save(true); }, 15000);
  }

  function close(saveNow) {
    if (!running) return;
    if (playing) stopPlay();
    closeScriptEditor();
    if (saveNow !== false) save(true);
    saveLayoutNow();
    running = false;
    undoStack = []; redoStack = []; baseline = null; clip = null; syncEditMenu();
    if (histTimer) { clearTimeout(histTimer); histTimer = 0; }
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
    startPlay,
    stopPlay,
    isPlaying: () => playing,
    onExit: null,
    isOpen: () => running,
    get game() { return game; },
  };
  return api;
})();
