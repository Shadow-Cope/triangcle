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
