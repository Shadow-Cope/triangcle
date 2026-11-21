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
  if (!(u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47)) throw new Error("png");
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
  inner.position.set(-m.c.x * m.k, (it.attach === "Head" ? -m.min.y : -m.c.y) * m.k, -m.c.z * m.k);
  const holder = new THREE.Group(); holder.add(inner);
  holder.position.set(an[0] - pp[0] + pos[0], an[1] - pp[1] + pos[1], an[2] - pp[2] + pos[2]);
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
  for (const [id, h] of Array.from(av.itemHolders)) if (!ids.includes(id)) { if (h.parent) h.parent.remove(h); av.itemHolders.delete(id); }
  for (const id of Array.from(av.clothItems.keys())) if (!ids.includes(id)) av.clothItems.delete(id);
  const need = ids.filter(id => !av.itemHolders.has(id) && !av.clothItems.has(id));
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
  const ids = Array.isArray(items) ? items.filter(x => typeof x === "string" && UUID_RE.test(x)).slice(0, MAX_WORN) : [];
  syncAvatarItems(pl.avatar, ids);
}
function setMyItems(ids) {
  WEAR.mine = ids.filter(x => UUID_RE.test(x)).slice(0, MAX_WORN);
  syncAvatarItems(localAvatar, WEAR.mine);
  netSend({ t: "colors", colors: myColors });                     // re-sends presence, which now includes what you wear
  if (acct.user) queueUpgrade(acct.user.id);                       // your own picture shows what you wear
}

/* ---- little picture of an item on the player (shop + items list) ---- */
function itemThumb(it) {
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
