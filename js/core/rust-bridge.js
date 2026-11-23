"use strict";

// Opt in with localStorage.setItem('triancleRustPhysics', '1') and reload.
// The game can always use the JavaScript implementation while this loads or fails.
window.TriancleRust = { status: "disabled", approach: null, moveDirection: null, boxOverlap: null, sphereOverlap: null, boxSide: null, sphereSide: null, boxVertical: null, sphereVertical: null, validColor: null, climbEase: null, climbDelta: null, climbShimmy: null, hsvToRgb: null, lz4: null };
(() => {
  let enabled = false;
  try { enabled = localStorage.getItem("triancleRustPhysics") === "1"; } catch (_) {}
  if (!enabled) return;
  const bridge = window.TriancleRust;
  bridge.status = "loading";
  fetch("js/core/triancle_core.wasm?v=65")
    .then(response => {
      if (!response.ok) throw new Error("WebAssembly download failed: " + response.status);
      return response.arrayBuffer();
    })
    .then(bytes => WebAssembly.instantiate(bytes))
    .then(({ instance }) => {
      const { triancle_approach_x: x, triancle_approach_z: z,
        triancle_move_x: mx, triancle_move_z: mz, triancle_box_overlap: box, triancle_sphere_overlap: sphere,
        triancle_box_side: boxSide, triancle_sphere_side: sphereSide,
        triancle_box_vertical: boxVertical, triancle_sphere_vertical: sphereVertical,
        triancle_valid_hex6: hex6, triancle_climb_ease: climbEase,
        triancle_climb_delta: climbDelta, triancle_climb_shimmy: climbShimmy, triancle_hsv_to_rgb: hsvToRgb,
        triancle_alloc: alloc, triancle_free: free, triancle_lz4: lz4, triancle_deinterleave: deinterleave,
        triancle_zigzag: zigzag, triancle_rbxl_float: rbxlFloat, triancle_references: references, triancle_wrap_angle: wrapAngle, triancle_animation_blend: animationBlend, triancle_network_round: networkRound,
        triancle_rgb_h: rgbH, triancle_rgb_s: rgbS, triancle_rgb_v: rgbV, triancle_tilted_columns: tiltedColumns, triancle_default_spawn: defaultSpawn,
        triancle_listing_fee: listingFee, triancle_creator_share: creatorShare, triancle_animation_step: animationStep, triancle_remote_animation_step: remoteStep, triancle_remote_snapshot: remoteSnapshot,
        triancle_item_position: itemPosition, triancle_item_center: itemCenter, triancle_item_kind: itemKind, triancle_item_upload_fee: itemUploadFee, triancle_item_min_price: itemMinPrice, triancle_ugc_basics: ugcBasics, triancle_ugc_price_invalid: ugcPriceInvalid, triancle_ugc_insufficient: ugcInsufficient, triancle_ugc_sale_changed: ugcSaleChanged, triancle_clean_name: cleanName, triancle_clean_chat: cleanChat, triancle_name_hue: nameHue, triancle_badge_hue: badgeHue, triancle_valid_username: validUsername, triancle_valid_display_name: validDisplayName, triancle_valid_item_id: validItemId, triancle_escape_html: escapeHtml, triancle_step_built_part: stepBuiltPart, triancle_built_solid: builtSolid, triancle_axis_param: axisParam, triancle_ugc_drag: ugcDrag, triancle_remote_part: remotePart, triancle_social_lists: socialLists, triancle_social_relation: socialRelation, triancle_friend_action: friendAction, triancle_ordered_badges: orderedBadges, triancle_auth_error: authError, triancle_login_email: loginEmail, triancle_password_length_valid: passwordLengthValid, triancle_sanitize_colors: sanitizeColors, triancle_catalog_filter: catalogFilter, triancle_inventory_rows: inventoryRows, triancle_missing_indices: missingIndices, triancle_rbxl_index: rbxlIndex, triancle_rbxl_property: rbxlProperty, triancle_rbxl_map: rbxlMap, memory } = instance.exports;
      if ([x, z, mx, mz, box, sphere, boxSide, sphereSide, boxVertical, sphereVertical, hex6, climbEase, climbDelta, climbShimmy, hsvToRgb, alloc, free, lz4, deinterleave, zigzag, rbxlFloat, references, wrapAngle, animationBlend, networkRound, rgbH, rgbS, rgbV, tiltedColumns, defaultSpawn, listingFee, creatorShare, animationStep, remoteStep, remoteSnapshot, itemPosition, itemCenter, itemKind, itemUploadFee, itemMinPrice, ugcBasics, ugcPriceInvalid, ugcInsufficient, ugcSaleChanged, cleanName, cleanChat, nameHue, badgeHue, validUsername, validDisplayName, validItemId, escapeHtml, stepBuiltPart, builtSolid, axisParam, ugcDrag, remotePart, socialLists, socialRelation, friendAction, orderedBadges, authError, loginEmail, passwordLengthValid, sanitizeColors, catalogFilter, inventoryRows, missingIndices, rbxlIndex, rbxlProperty, rbxlMap].some(fn => typeof fn !== "function") || !memory) throw new Error("Missing Rust exports");
      const {triancle_camera_yaw: cameraYaw, triancle_camera_pitch: cameraPitch, triancle_camera_zoom: cameraZoom, triancle_camera_frame: cameraFrame} = instance.exports;
      if ([cameraYaw,cameraPitch,cameraZoom,cameraFrame].some(fn => typeof fn !== "function")) throw new Error("Missing camera exports");
      const itemAction = instance.exports.triancle_item_action;
      const purchaseError = instance.exports.triancle_purchase_error;
      const itemEditCheck = instance.exports.triancle_item_edit_check;
      if ([itemAction,purchaseError,itemEditCheck].some(fn => typeof fn !== "function")) throw new Error("Missing catalog exports");
      bridge.itemAction = (signedIn,owned,equipped) => itemAction(signedIn?1:0,owned?1:0,equipped?1:0);
      bridge.itemEditCheck = (nameLength,price,onSale,minimum) =>
        Number.isSafeInteger(nameLength) && nameLength >= 0 && Number.isFinite(minimum)
          ? itemEditCheck(nameLength,price,onSale?1:0,minimum) : null;
      bridge.purchaseError = message => {
        if (typeof message !== "string" || message.length > 1000000) return null;
        const bytes = new TextEncoder().encode(message);
        let input = 0;
        try {
          input = alloc(bytes.length || 1);
          new Uint8Array(memory.buffer,input,bytes.length).set(bytes);
          const value = purchaseError(input,bytes.length);
          return value >= 0 ? {code:value & 255,inventory:!!(value & 256),catalog:!!(value & 512)} : null;
        } catch (_) { return null; }
        finally { if (input) free(input,bytes.length || 1); }
      };
      const equipConflicts = instance.exports.triancle_equip_conflicts;
      if (typeof equipConflicts !== "function") throw new Error("Missing inventory exports");
      const groupBadges = instance.exports.triancle_group_badges;
      if (typeof groupBadges !== "function") throw new Error("Missing social exports");
      const renameCheck = instance.exports.triancle_rename_check;
      if (typeof renameCheck !== "function") throw new Error("Missing account exports");
      const ugcFeePlan = instance.exports.triancle_ugc_fee_plan;
      if (typeof ugcFeePlan !== "function") throw new Error("Missing UGC exports");
      const assetSignature = instance.exports.triancle_asset_signature;
      if (typeof assetSignature !== "function") throw new Error("Missing asset exports");
      const ugcUploadPlan = instance.exports.triancle_ugc_upload_plan;
      if (typeof ugcUploadPlan !== "function") throw new Error("Missing UGC plan export");
      const wornIds = instance.exports.triancle_worn_ids;
      if (typeof wornIds !== "function") throw new Error("Missing inventory export");
      const accountPermission = instance.exports.triancle_account_permission;
      if (typeof accountPermission !== "function") throw new Error("Missing account permission export");
      const canBuild = instance.exports.triancle_can_build;
      if (typeof canBuild !== "function") throw new Error("Missing build permission export");
      const gameSettings = instance.exports.triancle_game_settings;
      if (typeof gameSettings !== "function") throw new Error("Missing game settings export");
      const stepDebris = instance.exports.triancle_step_debris;
      if (typeof stepDebris !== "function") throw new Error("Missing debris export");
      let debrisState = 0;
      bridge.stepDebris = (part,dt,gravity,restitution,friction,solids) => {
        if (!part || !Array.isArray(solids) || solids.length > 10000) return null;
        const p=part.g.position,q=part.g.quaternion,v=part.v,w=part.w,h=part.half,i=part.iinv;
        const values=[p.x,p.y,p.z,q.x,q.y,q.z,q.w,v.x,v.y,v.z,w.x,w.y,w.z,h.x,h.y,h.z,i.x,i.y,i.z,dt,gravity,restitution,friction];
        if (!values.every(Number.isFinite)) return null;
        let bounds = 0, boundsSize = Math.max(8,solids.length*48);
        try {
          if (!debrisState) debrisState=alloc(184);
          bounds=alloc(boundsSize);
          const state=new Float64Array(memory.buffer,debrisState,23), box=new Float64Array(memory.buffer,bounds,boundsSize/8);
          state.set(values);
          for (let index=0;index<solids.length;index++) {
            const solid=solids[index], at=index*6;
            box.set([solid.minX,solid.minY,solid.minZ,solid.maxX,solid.maxY,solid.maxZ],at);
          }
          if (!stepDebris(debrisState,bounds,solids.length)) return null;
          const result=Array.from(state.slice(0,13));
          return result.every(Number.isFinite) ? result : null;
        } catch (_) { return null; }
        finally { if (bounds) free(bounds,boundsSize); }
      };
      bridge.gameSettings = row => {
        if (!row || typeof row !== "object") return null;
        for (const field of ["name","by","about"]) {
          if (typeof row[field] === "string" && !/^[\x00-\x7f]*$/.test(row[field])) return null;
        }
        let input = 0, output = 0, size = 0, outputSize = 0;
        try {
          const bytes = new TextEncoder().encode(JSON.stringify({
            name:row.name,by:row.by,about:row.about,thumb:row.thumb,icon:row.icon,btools:row.btools
          }));
          size = bytes.length;
          if (!size || size > 1024 * 1024) return null;
          outputSize = size + 128;
          input = alloc(size); output = alloc(outputSize);
          new Uint8Array(memory.buffer,input,size).set(bytes);
          const count = gameSettings(input,size,output,outputSize);
          if (count < 0 || count > outputSize) return null;
          return JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,output,count)));
        } catch (_) { return null; }
        finally { if (output) free(output,outputSize); if (input) free(input,size); }
      };
      bridge.canBuild = (mode,signedIn,owner,admin) =>
        mode === "off" || mode === "staff" || mode === "all"
          ? !!canBuild(mode === "off" ? 2 : mode === "staff" ? 1 : 0,signedIn?1:0,owner?1:0,admin?1:0)
          : null;
      bridge.accountPermission = (email,domain,badges,permissions,mode) => {
        if (typeof email !== "string" || typeof domain !== "string" || !Array.isArray(badges) || !badges.every(x => typeof x === "string") || !permissions || typeof permissions !== "object" || typeof mode !== "string") return null;
        let input = 0, size = 0;
        try {
          const bytes = new TextEncoder().encode(JSON.stringify({email,domain,badges,permissions,mode}));
          size = bytes.length;
          if (!size || size > 1024 * 1024) return null;
          input = alloc(size); new Uint8Array(memory.buffer,input,size).set(bytes);
          const result = accountPermission(input,size);
          return result < 0 ? null : !!result;
        } catch (_) { return null; }
        finally { if (input) free(input,size); }
      };
      bridge.wornIds = (ids,limit) => {
        if (!Array.isArray(ids) || ids.length > 100000 || !ids.every(x => typeof x === "string") || !Number.isSafeInteger(limit) || limit < 0 || limit > 1000) return null;
        let input = 0, output = 0, size = 0, outputSize = 0;
        try {
          const bytes = new TextEncoder().encode(JSON.stringify({ids,limit}));
          size = bytes.length;
          if (!size || size > 8 * 1024 * 1024) return null;
          outputSize = Math.min(8 * 1024 * 1024, Math.max(2,limit * 48 + 2));
          input = alloc(size); output = alloc(outputSize);
          new Uint8Array(memory.buffer,input,size).set(bytes);
          const count = wornIds(input,size,output,outputSize);
          if (count < 0 || count > outputSize) return null;
          const result = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,output,count)));
          return Array.isArray(result) && result.every(x => typeof x === "string") ? result : null;
        } catch (_) { return null; }
        finally { if (output) free(output,outputSize); if (input) free(input,size); }
      };
      bridge.ugcUploadPlan = state => {
        if (!state || typeof state !== "object" || !Number.isFinite(state.price) || !Number.isFinite(state.live_price)) return null;
        let input = 0, output = 0, size = 0;
        const outputSize = 512;
        try {
          const bytes = new TextEncoder().encode(JSON.stringify(state));
          size = bytes.length;
          if (!size || size > 4096) return null;
          input = alloc(size);
          output = alloc(outputSize);
          new Uint8Array(memory.buffer,input,size).set(bytes);
          const count = ugcUploadPlan(input,size,output,outputSize);
          if (count < 0 || count > outputSize) return null;
          const result = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,output,count)));
          return Number.isFinite(result.price) && Number.isFinite(result.total) && Number.isInteger(result.error) ? result : null;
        } catch (_) { return null; }
        finally { if (output) free(output,outputSize); if (input) free(input,size); }
      };
      bridge.assetSignature = (buffer,kind) => {
        if (Object.prototype.toString.call(buffer) !== "[object ArrayBuffer]" || (kind !== "glb" && kind !== "png")) return null;
        if (buffer.byteLength < 4) return false;
        let input = 0;
        try {
          input = alloc(4);
          new Uint8Array(memory.buffer,input,4).set(new Uint8Array(buffer,0,4));
          return !!assetSignature(input,kind === "glb" ? 1 : 0);
        } catch (_) { return null; }
        finally { if (input) free(input,4); }
      };
      let ugcFeeBuffer = 0;
      bridge.ugcFeePlan = (price,kind,livePrice,published,sale,editing) => {
        if (![price,kind,livePrice].every(Number.isFinite) || price < 0 || ![0,1,2].includes(kind)) return null;
        try {
          if (!ugcFeeBuffer) ugcFeeBuffer = alloc(80);
          const data = new DataView(memory.buffer,ugcFeeBuffer,80), values=[price,kind,livePrice,published?1:0,sale?1:0,editing?1:0];
          for (let i=0;i<values.length;i++) data.setFloat64(i*8,values[i],true);
          if (!ugcFeePlan(ugcFeeBuffer)) return null;
          const result=[]; for (let i=6;i<10;i++) result.push(data.getFloat64(i*8,true));
          return result.every(Number.isFinite) ? result : null;
        } catch (_) { return null; }
      };
      bridge.renameCheck = (name,current,balance,cost) => {
        if (typeof name !== "string" || typeof current !== "string" || name.length > 10000 || current.length > 10000 || !(balance == null || Number.isFinite(balance)) || !Number.isFinite(cost)) return null;
        let input = 0, size = 0;
        try {
          const bytes = new TextEncoder().encode(JSON.stringify({name,current,balance:balance == null ? null : balance,cost})); size = bytes.length;
          input = alloc(size); new Uint8Array(memory.buffer,input,size).set(bytes);
          const result = renameCheck(input,size); return result >= 0 && result <= 3 ? result : null;
        } catch (_) { return null; }
        finally { if (input) free(input,size); }
      };
      bridge.groupBadges = (users,rows,valid) => {
        if (![users,valid].every(a => Array.isArray(a) && a.length <= 100000 && a.every(x => typeof x === "string")) || !Array.isArray(rows) || rows.length > 100000 || !rows.every(r => r && typeof r.user_id === "string" && typeof r.badge === "string")) return null;
        let input = 0, output = 0, size = 0, outputSize = 0;
        try {
          const bytes = new TextEncoder().encode(JSON.stringify({users,rows,valid})); size = bytes.length;
          if (!size || size > 8 * 1024 * 1024) return null;
          outputSize = Math.min(16 * 1024 * 1024,size * 2 + 128);
          input = alloc(size); output = alloc(outputSize); new Uint8Array(memory.buffer,input,size).set(bytes);
          const n = groupBadges(input,size,output,outputSize); if (n < 0 || n > outputSize) return null;
          const result = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,output,n)));
          return Array.isArray(result) && result.length === users.length && result.every(a => Array.isArray(a) && a.every(x => typeof x === "string")) ? result : null;
        } catch (_) { return null; }
        finally { if (output) free(output,outputSize); if (input) free(input,size); }
      };
      bridge.equipConflicts = (id,attach,worn) => {
        if (typeof id !== "string" || typeof attach !== "string" || !Array.isArray(worn) || worn.length > 10000 || !worn.every(x => x && typeof x.id === "string" && typeof x.attach === "string")) return null;
        let input = 0, output = 0, size = 0, outputSize = Math.max(2,worn.length*7+2);
        try {
          const bytes = new TextEncoder().encode(JSON.stringify({id,attach,worn})); size = bytes.length;
          if (!size || size > 1048576) return null;
          input = alloc(size); output = alloc(outputSize); new Uint8Array(memory.buffer,input,size).set(bytes);
          const n = equipConflicts(input,size,output,outputSize); if (n < 0 || n > outputSize) return null;
          const result = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,output,n)));
          return Array.isArray(result) && result.every(i => Number.isSafeInteger(i) && i >= 0 && i < worn.length) ? result : null;
        } catch (_) { return null; }
        finally { if (output) free(output,outputSize); if (input) free(input,size); }
      };
      bridge.approach = (v, tx, tz, delta) => {
        const oldX = v.x, oldZ = v.z;
        const newX = x(oldX, oldZ, tx, tz, delta);
        const newZ = z(oldX, oldZ, tx, tz, delta);
        v.x = newX; v.z = newZ;
      };
      bridge.moveDirection = (yaw, forward, right) => [mx(yaw, forward, right), mz(yaw, forward, right)];
      bridge.boxOverlap = (p, b, half, height) => !!box(p.x, p.y, p.z, half, height, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
      bridge.sphereOverlap = (p, q, half, height) => !!sphere(p.x, p.y, p.z, half, height, q.cx, q.cy, q.cz, q.r);
      bridge.boxSide = boxSide;
      bridge.sphereSide = sphereSide;
      bridge.boxVertical = boxVertical;
      bridge.sphereVertical = sphereVertical;
      bridge.zigzag = zigzag;
      bridge.rbxlFloat = rbxlFloat;
      bridge.wrapAngle = wrapAngle;
      bridge.animationBlend = animationBlend;
      bridge.networkRound = networkRound;
      bridge.cameraAim = (yaw,pitch,dx,dy,sensitivity,limit) => {
        if (![yaw,pitch,dx,dy,sensitivity,limit].every(Number.isFinite) || limit <= 0 || Math.max(Math.abs(dx),Math.abs(dy),Math.abs(sensitivity)) > 1e100) return null;
        const result = [cameraYaw(yaw,dx,sensitivity),cameraPitch(pitch,dy,sensitivity,limit)];
        return result.every(Number.isFinite) ? result : null;
      };
      bridge.cameraZoom = (zoom,delta,minimum,maximum) => {
        if (![zoom,delta,minimum,maximum].every(Number.isFinite) || minimum <= 0 || minimum > maximum) return null;
        const result = cameraZoom(zoom,delta,minimum,maximum); return Number.isFinite(result) ? result : null;
      };
      let cameraFrameBuffer = 0;
      bridge.cameraFrame = (cam, focus, wanted, dt, offset, baseHalf) => {
        if (!cam || !focus) return null;
        const values = [cam.zoom,cam.zoomTarget,cam.shift,wanted ? 1 : 0,dt,cam.yaw,cam.pitch,focus.x,focus.y,focus.z,offset,baseHalf];
        if (!values.every(Number.isFinite) || Math.abs(cam.yaw) > 1e6 || Math.abs(cam.pitch) > 1e6) return null;
        try {
          if (!cameraFrameBuffer) cameraFrameBuffer = alloc(160);
          const data = new DataView(memory.buffer,cameraFrameBuffer,160);
          for (let i=0;i<values.length;i++) data.setFloat64(i*8,values[i],true);
          if (!cameraFrame(cameraFrameBuffer)) return null;
          const out=[]; for (let i=12;i<20;i++) out.push(data.getFloat64(i*8,true));
          return out.every(Number.isFinite) ? out : null;
        } catch (_) { return null; }
      };
      let animationBuffer = 0;
      bridge.animate = values => {
        if (!Array.isArray(values) || values.length !== 33 || !values.every(Number.isFinite) || values[28] <= 0 || (values[17] && values[20] <= 0) || Math.abs(values[1]) > 100 || Math.abs(values[18]) > 100) return null;
        try {
          if (!animationBuffer) animationBuffer = alloc(264);
          const data = new DataView(memory.buffer, animationBuffer, 264);
          for (let i = 0; i < 33; i++) data.setFloat64(i * 8, values[i], true);
          animationStep(animationBuffer);
          const out = [];
          for (let i = 0; i < 33; i++) out.push(data.getFloat64(i * 8, true));
          return out.every(Number.isFinite) ? out : null;
        } catch (_) { return null; }
      };
      let remoteBuffer = 0;
      bridge.animateRemote = values => {
        if (!Array.isArray(values) || values.length !== 23 || !values.every(Number.isFinite) || Math.abs(values[7]) > 100 || Math.abs(values[18]) > 100) return null;
        try {
          if (!remoteBuffer) remoteBuffer = alloc(184);
          const data = new DataView(memory.buffer, remoteBuffer, 184);
          for (let i = 0; i < 23; i++) data.setFloat64(i * 8, values[i], true);
          remoteStep(remoteBuffer);
          const out = [];
          for (let i = 0; i < 23; i++) out.push(data.getFloat64(i * 8, true));
          return out.every(Number.isFinite) ? out : null;
        } catch (_) { return null; }
      };
      let snapshotBuffer = 0;
      bridge.remoteSnapshot = message => {
        if (!message || typeof message !== "object") return null;
        const number = value => typeof value === "number" ? value : NaN;
        const values = [number(message.x),number(message.y),number(message.z),number(message.f),number(message.l),number(message.r),number(message.b),message.ff ? 1 : 0];
        try {
          if (!snapshotBuffer) snapshotBuffer = alloc(64);
          const data = new DataView(memory.buffer,snapshotBuffer,64);
          for (let i = 0; i < 8; i++) data.setFloat64(i*8,values[i],true);
          if (!remoteSnapshot(snapshotBuffer)) return null;
          const out=[]; for (let i=0;i<8;i++) out.push(data.getFloat64(i*8,true));
          return {x:out[0],y:out[1],z:out[2],f:out[3],a:Array.isArray(message.a) ? message.a : [0,0,0,0],ff:out[7],l:out[4],r:out[5],b:out[6]};
        } catch (_) { return null; }
      };
      bridge.listingFee = (price, isFace) => listingFee(price, isFace ? 1 : 0);
      bridge.creatorShare = creatorShare;
      bridge.itemPosition = itemPosition;
      bridge.itemCenter = (center, minimum, scale, headY) => itemCenter(center, minimum, scale, headY ? 1 : 0);
      bridge.itemKind = text => {
        if (typeof text !== "string" || !text.length || text.length > 1000000) return null;
        const size = text.length * 2; let input = 0;
        try {
          input = alloc(size); const data = new DataView(memory.buffer, input, size);
          for (let i = 0; i < text.length; i++) data.setUint16(i * 2, text.charCodeAt(i), true);
          const kind = itemKind(input, text.length); return kind >= 0 && kind <= 2 ? kind : null;
        } catch (_) { return null; }
        finally { if (input) free(input, size); }
      };
      bridge.itemUploadFee = itemUploadFee;
      bridge.itemMinPrice = itemMinPrice;
      bridge.ugcBasics = (asset,name) => ugcBasics(asset ? 1 : 0,name ? 1 : 0);
      bridge.ugcPriceInvalid = (price,minimum) => !!ugcPriceInvalid(price,minimum);
      bridge.ugcInsufficient = (total,balance) => !!ugcInsufficient(total,balance == null ? 0 : balance,balance == null ? 0 : 1);
      bridge.ugcSaleChanged = (sale,published,price,live) => !!ugcSaleChanged(sale ? 1 : 0,published ? 1 : 0,price,live);
      bridge.stepBuiltPart = (part, dt, gravity, solids) => {
        if (!part || !Array.isArray(part.size) || part.size.length !== 3 || !part.pos || !Array.isArray(solids) || (part.collide && solids.length > 4096)) return null;
        const values = [dt, gravity, part.pos.x, part.pos.y, part.pos.z, part.vy, part.size[0]/2, part.size[1]/2, part.size[2]/2, part.collide ? 1 : 0];
        let count = 0;
        if (part.collide) for (const s of solids) { if (s === part.solid) continue; if (!s) return null; values.push(s.minX,s.maxX,s.minY,s.maxY,s.minZ,s.maxZ); count++; }
        if (!values.every(Number.isFinite)) return null;
        const size = values.length * 8; let input = 0;
        try {
          input = alloc(size); const data = new DataView(memory.buffer, input, size);
          for (let i = 0; i < values.length; i++) data.setFloat64(i * 8, values[i], true);
          if (!stepBuiltPart(input, count)) return null;
          const y = data.getFloat64(24, true), vy = data.getFloat64(40, true);
          return Number.isFinite(y) && Number.isFinite(vy) ? [y,vy] : null;
        } catch (_) { return null; }
        finally { if (input) free(input, size); }
      };
      let solidBuffer = 0;
      bridge.builtSolid = part => {
        if (!part || !part.pos || !Array.isArray(part.size) || part.size.length !== 3) return null;
        const values = [part.pos.x,part.pos.y,part.pos.z,...part.size,part.shape === "Ball" ? 1 : 0];
        if (!values.every(Number.isFinite) || part.size.some(v => v <= 0)) return null;
        try {
          if (!solidBuffer) solidBuffer = alloc(120);
          const data = new DataView(memory.buffer,solidBuffer,120);
          for (let i = 0; i < 7; i++) data.setFloat64(i*8,values[i],true);
          builtSolid(solidBuffer);
          const result = []; for (let i = 7; i < 15; i++) result.push(data.getFloat64(i*8,true));
          return result.every(Number.isFinite) ? result : null;
        } catch (_) { return null; }
      };
      bridge.axisParam = (origin,dir,ray) => {
        if (!origin || !dir || !ray || !ray.origin || !ray.direction) return null;
        const values = [origin.x,origin.y,origin.z,dir.x,dir.y,dir.z,ray.origin.x,ray.origin.y,ray.origin.z,ray.direction.x,ray.direction.y,ray.direction.z];
        if (!values.every(v => Number.isFinite(v) && Math.abs(v) <= 1e70)) return null;
        const result = axisParam(...values);
        return Number.isNaN(result) ? {value:null} : Number.isFinite(result) ? {value:result} : null;
      };
      let ugcDragBuffer = 0;
      bridge.ugcDrag = (pos,delta,matrix) => {
        if (!Array.isArray(pos) || pos.length !== 3 || !delta || !matrix || matrix.length !== 16) return null;
        const values = [delta.x,delta.y,delta.z,...pos,...matrix];
        if (!values.every(Number.isFinite)) return null;
        try {
          if (!ugcDragBuffer) ugcDragBuffer = alloc(176);
          const data = new DataView(memory.buffer,ugcDragBuffer,176);
          for (let i=0;i<22;i++) data.setFloat64(i*8,values[i],true);
          if (!ugcDrag(ugcDragBuffer)) return null;
          const result = [data.getFloat64(24,true),data.getFloat64(32,true),data.getFloat64(40,true)];
          return result.every(Number.isFinite) ? result : null;
        } catch (_) { return null; }
      };
      let remotePartBuffer = 0;
      bridge.remotePart = d => {
        if (!d || !Array.isArray(d.sz) || d.sz.length !== 3 || !Array.isArray(d.p) || d.p.length !== 3 || !d.sz.every(Number.isFinite) || !d.p.every(Number.isFinite)) return null;
        // Symbols, objects and BigInts retain the exact original JS coercion path.
        if (!["number","string","undefined","boolean"].includes(typeof d.c) && d.c !== null) return null;
        if (!["number","string","undefined","boolean"].includes(typeof d.t) && d.t !== null) return null;
        const values = [...d.sz,...d.p,Number(d.c),Number(d.t) || 0,d.an ? 1 : 0,d.co ? 1 : 0];
        try {
          if (!remotePartBuffer) remotePartBuffer = alloc(80);
          const data = new DataView(memory.buffer,remotePartBuffer,80);
          for (let i=0;i<10;i++) data.setFloat64(i*8,values[i],true);
          if (!remotePart(remotePartBuffer)) return null;
          const out=[]; for (let i=0;i<10;i++) out.push(data.getFloat64(i*8,true));
          return out;
        } catch (_) { return null; }
      };
      bridge.socialLists = (me, rows) => {
        if (typeof me !== "string" || !Array.isArray(rows) || rows.length > 100000 || !rows.every(r => r && typeof r.requester === "string" && typeof r.addressee === "string" && typeof r.status === "string")) return null;
        const limit = 8 * 1024 * 1024; let input = 0, output = 0, size = 0, outputSize = 0;
        try {
          const encoded = new TextEncoder().encode(JSON.stringify({me,rows})); size = encoded.length;
          if (!size || size > limit) return null;
          outputSize = Math.min(limit,size*2+128); input = alloc(size); output = alloc(outputSize);
          new Uint8Array(memory.buffer,input,size).set(encoded);
          const written = socialLists(input,size,output,outputSize);
          if (written < 0 || written > outputSize) return null;
          const result = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,output,written)));
          return Array.isArray(result.friends) && Array.isArray(result.incoming) && Array.isArray(result.outgoing) ? result : null;
        } catch (_) { return null; }
        finally { if (output) free(output,outputSize); if (input) free(input,size); }
      };
      bridge.socialRelation = (id, friends, incoming, outgoing) => {
        if (typeof id !== "string" || ![friends,incoming,outgoing].every(a => Array.isArray(a) && a.every(v => typeof v === "string")) || friends.length + incoming.length + outgoing.length > 1000) return null;
        const limit = 8 * 1024 * 1024; let input = 0, size = 0;
        try {
          const encoded = new TextEncoder().encode(JSON.stringify({id,friends,incoming,outgoing})); size = encoded.length;
          if (!size || size > limit) return null;
          input = alloc(size); new Uint8Array(memory.buffer,input,size).set(encoded);
          const result = socialRelation(input,size); return result >= 0 && result <= 3 ? ["none","friend","incoming","outgoing"][result] : null;
        } catch (_) { return null; }
        finally { if (input) free(input,size); }
      };
      bridge.friendAction = kind => {
        if (typeof kind !== "string" || !kind.length || kind.length > 1024) return null;
        const size = kind.length * 2; let input = 0;
        try {
          input = alloc(size); const data = new DataView(memory.buffer,input,size);
          for (let i=0;i<kind.length;i++) data.setUint16(i*2,kind.charCodeAt(i),true);
          const action = friendAction(input,kind.length); return action >= 1 && action <= 3 ? action : null;
        } catch (_) { return null; }
        finally { if (input) free(input,size); }
      };
      bridge.authError = (code,message,rateLimited) => {
        if (typeof code !== "string" || typeof message !== "string" || typeof rateLimited !== "boolean") return null;
        const limit = 1024 * 1024; let input = 0, size = 0;
        try {
          const bytes = new TextEncoder().encode(JSON.stringify({code,message,rate_limited:rateLimited})); size = bytes.length;
          if (!size || size > limit) return null;
          input = alloc(size); new Uint8Array(memory.buffer,input,size).set(bytes);
          const result = authError(input,size); return result >= 0 && result <= 6 ? result : null;
        } catch (_) { return null; }
        finally { if (input) free(input,size); }
      };
      bridge.passwordLengthValid = length => Number.isSafeInteger(length) && length >= 0 && length <= 0xffffffff ? !!passwordLengthValid(length) : null;
      bridge.loginEmail = (username,domain) => {
        if (typeof username !== "string" || typeof domain !== "string" || domain.length > 10000) return null;
        let input = 0, output = 0, size = 0, outSize = 0;
        try {
          const bytes = new TextEncoder().encode(JSON.stringify({username,domain})); size = bytes.length;
          outSize = size + 64; input = alloc(size); output = alloc(outSize); new Uint8Array(memory.buffer,input,size).set(bytes);
          const n = loginEmail(input,size,output,outSize); if (n < 0 || n > outSize) return null;
          const result = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,output,n)));
          return typeof result === "string" ? result : null;
        } catch (_) { return null; }
        finally { if (output) free(output,outSize); if (input) free(input,size); }
      };
      bridge.orderedBadges = (badges,order) => {
        if (![badges,order].every(a => Array.isArray(a) && a.length <= 5000 && a.every(v => typeof v === "string"))) return null;
        const limit = 1024 * 1024; let input = 0, output = 0, size = 0;
        try {
          const bytes = new TextEncoder().encode(JSON.stringify({badges,order})); size = bytes.length;
          if (!size || size > limit) return null;
          input = alloc(size); output = alloc(size); new Uint8Array(memory.buffer,input,size).set(bytes);
          const n = orderedBadges(input,size,output,size); if (n < 0 || n > size) return null;
          const result = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,output,n)));
          return Array.isArray(result) && result.length === badges.length ? result : null;
        } catch (_) { return null; }
        finally { if (output) free(output,size); if (input) free(input,size); }
      };
      bridge.sanitizeColors = (colors,defaults) => {
        const limit = 1024 * 1024, outputLimit = 2048; let input = 0, output = 0, size = 0;
        try {
          if (colors !== null && (typeof colors !== "object" || Array.isArray(colors) || (Object.getPrototypeOf(colors) !== Object.prototype && Object.getPrototypeOf(colors) !== null))) return null;
          if (colors && Object.is(colors.face,-0)) return null;
          const encoded = new TextEncoder().encode(JSON.stringify({colors,defaults})); size = encoded.length;
          if (!size || size > limit) return null;
          input = alloc(size); output = alloc(outputLimit); new Uint8Array(memory.buffer,input,size).set(encoded);
          const written = sanitizeColors(input,size,output,outputLimit);
          if (written < 0 || written > outputLimit) return null;
          const result = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,output,written)));
          const parts = ["Head","Torso","LeftArm","RightArm","LeftLeg","RightLeg"], out = {};
          for (const part of parts) { if (typeof result[part] !== "string") return null; out[part] = result[part]; }
          if (typeof result.face !== "number" || typeof result.body !== "string") return null;
          out.face = result.face; out.body = result.body; return out;
        } catch (_) { return null; }
        finally { if (output) free(output,outputLimit); if (input) free(input,size); }
      };
      bridge.catalogFilter = (rows,query,category,author,min,max,freeOnly,hideOwned,cache,owned) => {
        if (!Array.isArray(rows) || rows.length > 10000 || typeof query !== "string" || typeof category !== "string" || typeof author !== "string" || (min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max)) || typeof freeOnly !== "boolean" || typeof hideOwned !== "boolean" || !(cache instanceof Map) || !(owned instanceof Set) || cache.get !== Map.prototype.get || owned.has !== Set.prototype.has) return null;
        const limit = 8 * 1024 * 1024; let input = 0, output = 0, size = 0, outputSize = 0;
        try {
          const items = [];
          for (const item of rows) {
            if (!item || typeof item.name !== "string" || typeof item.attach !== "string" || !(item.price == null || typeof item.price === "number" || typeof item.price === "string")) return null;
            const numeric = +item.price, price = numeric || 0;
            if (!Number.isFinite(price)) return null;
            const profile = cache.get(item.creator), username = profile && profile.username || "";
            if (!["string","number","boolean"].includes(typeof username)) return null;
            items.push({name:item.name.toLowerCase(),attach:item.attach,author:String(username).toLowerCase(),price,owned:owned.has(item.id)});
          }
          const bytes = new TextEncoder().encode(JSON.stringify({items,query,category,author,min,max,free:freeOnly,hide_owned:hideOwned})); size = bytes.length;
          if (!size || size > limit) return null;
          outputSize = Math.max(2,rows.length*7+2); input = alloc(size); output = alloc(outputSize); new Uint8Array(memory.buffer,input,size).set(bytes);
          const n = catalogFilter(input,size,output,outputSize); if (n < 0 || n > outputSize) return null;
          const result = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,output,n)));
          return Array.isArray(result) && result.every(i => Number.isSafeInteger(i) && i >= 0 && i < rows.length) ? result : null;
        } catch (_) { return null; }
        finally { if (output) free(output,outputSize); if (input) free(input,size); }
      };
      bridge.inventoryRows = rows => {
        if (!Array.isArray(rows) || rows.length > 100000 || !rows.every(r => r && typeof r.item_id === "string" && typeof r.equipped === "boolean")) return null;
        const limit = 8 * 1024 * 1024; let input = 0, output = 0, size = 0, outputSize = 0;
        try {
          const normalized = rows.map(r => ({item_id:r.item_id,equipped:r.equipped}));
          const bytes = new TextEncoder().encode(JSON.stringify(normalized)); size = bytes.length;
          if (!size || size > limit) return null;
          outputSize = Math.min(limit,size*2+128); input = alloc(size); output = alloc(outputSize); new Uint8Array(memory.buffer,input,size).set(bytes);
          const n = inventoryRows(input,size,output,outputSize); if (n < 0 || n > outputSize) return null;
          const result = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,output,n)));
          return Array.isArray(result.owned) && Array.isArray(result.equipped) ? result : null;
        } catch (_) { return null; }
        finally { if (output) free(output,outputSize); if (input) free(input,size); }
      };
      bridge.missingIndices = (values,present) => {
        if (![values,present].every(a => Array.isArray(a) && a.length <= 10000 && a.every(v => typeof v === "string"))) return null;
        const limit = 1024 * 1024, outputSize = Math.max(2,values.length*7+2); let input = 0, output = 0, size = 0;
        try {
          const bytes = new TextEncoder().encode(JSON.stringify({values,present})); size = bytes.length;
          if (!size || size > limit) return null;
          input = alloc(size); output = alloc(outputSize); new Uint8Array(memory.buffer,input,size).set(bytes);
          const n = missingIndices(input,size,output,outputSize); if (n < 0 || n > outputSize) return null;
          const result = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,output,n)));
          return Array.isArray(result) && result.every(i => Number.isSafeInteger(i) && i >= 0 && i < values.length) ? result : null;
        } catch (_) { return null; }
        finally { if (output) free(output,outputSize); if (input) free(input,size); }
      };
      const cleanString = (text, limit, action) => {
        if (typeof text !== "string" || !text.length || text.length > 1000000) return null;
        const size = text.length * 2, outSize = limit * 2; let input = 0, output = 0;
        try {
          input = alloc(size); output = alloc(outSize);
          const src = new DataView(memory.buffer, input, size);
          for (let i = 0; i < text.length; i++) src.setUint16(i * 2, text.charCodeAt(i), true);
          const count = action(input, text.length, output);
          if (count < 0 || count > limit) return null;
          const dst = new DataView(memory.buffer, output, outSize), units = [];
          for (let i = 0; i < count; i++) units.push(dst.getUint16(i * 2, true));
          return String.fromCharCode(...units);
        } catch (_) { return null; }
        finally { if (output) free(output, outSize); if (input) free(input, size); }
      };
      bridge.cleanName = text => cleanString(text, 20, cleanName);
      bridge.cleanChat = text => cleanString(text, 120, cleanChat);
      bridge.nameHue = text => {
        if (typeof text !== "string" || !text.length || text.length > 1000000) return null;
        const size = text.length * 2; let input = 0;
        try {
          input = alloc(size); const bytes = new DataView(memory.buffer, input, size);
          for (let i = 0; i < text.length; i++) bytes.setUint16(i * 2, text.charCodeAt(i), true);
          const hue = nameHue(input, text.length); return hue >= 0 && hue < 360 ? hue : null;
        } catch (_) { return null; }
        finally { if (input) free(input, size); }
      };
      bridge.badgeHue = text => {
        if (typeof text !== "string" || !text.length || text.length > 1000000) return null;
        const size = text.length * 2; let input = 0;
        try {
          input = alloc(size); const data = new DataView(memory.buffer,input,size);
          for (let i=0;i<text.length;i++) data.setUint16(i*2,text.charCodeAt(i),true);
          const hue = badgeHue(input,text.length); return hue >= 0 && hue < 360 ? hue : null;
        } catch (_) { return null; }
        finally { if (input) free(input,size); }
      };
      bridge.validUsername = text => {
        if (typeof text !== "string") return null;
        if (text.length < 3 || text.length > 20) return false;
        const size = text.length * 2; let input = 0;
        try {
          input = alloc(size); const bytes = new DataView(memory.buffer, input, size);
          for (let i = 0; i < text.length; i++) bytes.setUint16(i * 2, text.charCodeAt(i), true);
          return !!validUsername(input, text.length);
        } catch (_) { return null; }
        finally { if (input) free(input, size); }
      };
      bridge.validDisplayName = text => {
        if (typeof text !== "string" || !text.length || text.length > 1000000) return null;
        const size = text.length * 2; let input = 0;
        try {
          input = alloc(size); const data = new DataView(memory.buffer,input,size);
          for (let i=0;i<text.length;i++) data.setUint16(i*2,text.charCodeAt(i),true);
          const result = validDisplayName(input,text.length); return result < 0 ? null : !!result;
        } catch (_) { return null; }
        finally { if (input) free(input,size); }
      };
      bridge.validItemId = text => {
        if (typeof text !== "string") return null;
        if (text.length !== 36) return false;
        let input = 0;
        try {
          input = alloc(72); const data = new DataView(memory.buffer, input, 72);
          for (let i = 0; i < 36; i++) data.setUint16(i * 2, text.charCodeAt(i), true);
          return !!validItemId(input, 36);
        } catch (_) { return null; }
        finally { if (input) free(input, 72); }
      };
      bridge.escapeHtml = text => {
        if (typeof text !== "string" || !text.length || text.length > 100000) return null;
        const size = text.length * 2, capacity = text.length * 6, outSize = capacity * 2; let input = 0, output = 0;
        try {
          input = alloc(size); output = alloc(outSize);
          const src = new DataView(memory.buffer, input, size);
          for (let i = 0; i < text.length; i++) src.setUint16(i * 2, text.charCodeAt(i), true);
          const count = escapeHtml(input, text.length, output, capacity);
          if (count < 0 || count > capacity) return null;
          const dst = new DataView(memory.buffer, output, count * 2), pieces = [];
          for (let start = 0; start < count; start += 4096) {
            const units = []; for (let i = start; i < Math.min(count, start + 4096); i++) units.push(dst.getUint16(i * 2, true));
            pieces.push(String.fromCharCode(...units));
          }
          return pieces.join("");
        } catch (_) { return null; }
        finally { if (output) free(output, outSize); if (input) free(input, size); }
      };
      bridge.rbxlIndex = chunks => {
        const relevant = chunks.filter(c => c.name === "INST" || c.name === "PRNT");
        if (!relevant.length || relevant.some(c => !(c.data instanceof Uint8Array))) return null;
        const size = relevant.reduce((n, c) => n + 8 + c.data.length, 0), limit = 8 * 1024 * 1024;
        if (!Number.isSafeInteger(size) || size <= 0 || size > limit) return null;
        let input = 0, output = 0;
        try {
          input = alloc(size); output = alloc(limit);
          const bytes = new Uint8Array(memory.buffer, input, size), header = new DataView(memory.buffer, input, size);
          let at = 0;
          for (const chunk of relevant) {
            for (let i = 0; i < 4; i++) bytes[at + i] = chunk.name.charCodeAt(i);
            header.setUint32(at + 4, chunk.data.length, true); bytes.set(chunk.data, at + 8); at += 8 + chunk.data.length;
          }
          const written = rbxlIndex(input, size, output, limit);
          if (written < 0 || written > limit) return null;
          const result = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, output, written)));
          return Array.isArray(result.classes) && Array.isArray(result.parents) ? result : null;
        } catch (_) { return null; }
        finally { if (output) free(output, limit); if (input) free(input, size); }
      };
      bridge.rbxlProperty = (bytes, offset, count, kind) => {
        const limit = 8 * 1024 * 1024;
        if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > limit || !Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length || !Number.isSafeInteger(count) || count < 0 || count > 1000000 || ![1,2,4,14,16,18,26].includes(kind)) return null;
        let input = 0, output = 0;
        try {
          input = alloc(bytes.length); output = alloc(limit);
          new Uint8Array(memory.buffer, input, bytes.length).set(bytes);
          const written = rbxlProperty(input, bytes.length, offset, count, kind, output, limit);
          if (written < 0 || written > limit) return null;
          const result = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, output, written)));
          return Array.isArray(result) && result.length === count ? result : null;
        } catch (_) { return null; }
        finally { if (output) free(output, limit); if (input) free(input, bytes.length); }
      };
      bridge.rbxlMap = chunks => {
        const relevant = chunks.filter(c => c.name === "INST" || c.name === "PRNT" || c.name === "PROP");
        if (!relevant.length || relevant.some(c => !(c.data instanceof Uint8Array))) return null;
        const size = relevant.reduce((n, c) => n + 8 + c.data.length, 0), limit = 8 * 1024 * 1024;
        if (!Number.isSafeInteger(size) || size <= 0 || size > limit) return null;
        let input = 0, output = 0;
        try {
          input = alloc(size); output = alloc(limit);
          const bytes = new Uint8Array(memory.buffer, input, size), header = new DataView(memory.buffer, input, size);
          let at = 0;
          for (const chunk of relevant) {
            for (let i = 0; i < 4; i++) bytes[at + i] = chunk.name.charCodeAt(i);
            header.setUint32(at + 4, chunk.data.length, true); bytes.set(chunk.data, at + 8); at += 8 + chunk.data.length;
          }
          const written = rbxlMap(input, size, output, limit);
          if (written < 0 || written > limit) return null;
          const result = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, output, written)));
          if (!Array.isArray(result.spawn) || !Array.isArray(result.parts) || !Number.isSafeInteger(result.cut)) return null;
          return {spawn: result.spawn, parts: result.parts, cut: result.cut};
        } catch (_) { return null; }
        finally { if (output) free(output, limit); if (input) free(input, size); }
      };
      bridge.references = values => {
        if (!Array.isArray(values) || !values.length || values.length > 2097152 || !values.every(v => Number.isInteger(v) && v >= 0 && v <= 0xffffffff)) return null;
        const inputSize = values.length * 4, outputSize = values.length * 8; let input = 0, output = 0;
        try {
          input = alloc(inputSize); output = alloc(outputSize);
          const source = new DataView(memory.buffer, input, inputSize);
          for (let i = 0; i < values.length; i++) source.setUint32(i * 4, values[i], true);
          if (!references(input, output, values.length)) return null;
          const data = new DataView(memory.buffer, output, outputSize), result = new Array(values.length);
          for (let i = 0; i < values.length; i++) result[i] = data.getFloat64(i * 8, true);
          return result;
        } catch (_) { return null; }
        finally { if (output) free(output, outputSize); if (input) free(input, inputSize); }
      };
      bridge.climbEase = climbEase;
      bridge.climbDelta = (up, down, dt) => climbDelta(up ? 1 : 0, down ? 1 : 0, dt);
      bridge.climbShimmy = climbShimmy;
      bridge.hsvToRgb = (h, s, v) => { const rgb = hsvToRgb(h, s, v); return [(rgb >>> 16) & 255, (rgb >>> 8) & 255, rgb & 255]; };
      bridge.rgbToHsv = (r, g, b) => ({ h: rgbH(r, g, b), s: rgbS(r, g, b), v: rgbV(r, g, b) });
      bridge.tiltedColumns = (sx, sy, sz, x, y, z, R) => {
        if (!Array.isArray(R) || R.length !== 9 || ![sx, sy, sz, x, y, z, ...R].every(Number.isFinite) || sx <= 0 || sy <= 0 || sz <= 0 || Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 1e9) return null;
        const ex = Math.abs(R[0])*sx + Math.abs(R[1])*sy + Math.abs(R[2])*sz;
        const ez = Math.abs(R[6])*sx + Math.abs(R[7])*sy + Math.abs(R[8])*sz;
        const cell = Math.max(0.6, Math.sqrt(ex*ez/400));
        const capacity = (Math.ceil(ex/cell) + 2) * (Math.ceil(ez/cell) + 2);
        if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > 100000) return null;
        const size = capacity * 48; let output = 0;
        try {
          output = alloc(size);
          const count = tiltedColumns(sx, sy, sz, x, y, z, ...R, output, capacity);
          if (count < 0 || count > capacity) return null;
          const data = new DataView(memory.buffer, output, count * 48), result = [];
          for (let i = 0; i < count; i++) { const p = i * 48; result.push({ minX: data.getFloat64(p, true), maxX: data.getFloat64(p+8, true), minY: data.getFloat64(p+16, true), maxY: data.getFloat64(p+24, true), minZ: data.getFloat64(p+32, true), maxZ: data.getFloat64(p+40, true) }); }
          return result;
        } catch (_) { return null; }
        finally { if (output) free(output, size); }
      };
      bridge.defaultSpawn = rows => {
        if (!Array.isArray(rows) || !rows.length || rows.length > 6000) return null;
        const packed = [];
        for (const r of rows) {
          if (!Array.isArray(r) || !Array.isArray(r[6]) || r[6].length !== 9) return null;
          const values = [...r.slice(0, 6), ...r[6]];
          if (values.length !== 15 || !values.every(v => Number.isFinite(v) && Math.abs(v) <= 1e100)) return null;
          packed.push(values);
        }
        const size = rows.length * 120; let input = 0, output = 0;
        try {
          input = alloc(size); output = alloc(24);
          const data = new DataView(memory.buffer, input, size);
          for (let i = 0; i < packed.length; i++) for (let j = 0; j < 15; j++) data.setFloat64(i * 120 + j * 8, packed[i][j], true);
          if (!defaultSpawn(input, rows.length, output)) return null;
          const result = new DataView(memory.buffer, output, 24);
          return [result.getFloat64(0, true), result.getFloat64(8, true), result.getFloat64(16, true)];
        } catch (_) { return null; }
        finally { if (output) free(output, 24); if (input) free(input, size); }
      };
      bridge.lz4 = (src, n) => {
        // Keep very large blocks and unusual arguments on the existing path.
        if (!(src instanceof Uint8Array) || !Number.isSafeInteger(n) || n <= 0 || n > 16777216 || !src.length || src.length > 16777216) return null;
        let input = 0, output = 0;
        try {
          input = alloc(src.length); output = alloc(n);
          new Uint8Array(memory.buffer, input, src.length).set(src);
          if (!lz4(input, src.length, output, n)) return null;
          return new Uint8Array(memory.buffer, output, n).slice();
        } catch (_) { return null; }
        finally { if (output) free(output, n); if (input) free(input, src.length); }
      };
      bridge.deinterleave = (src, offset, count) => {
        if (!(src instanceof Uint8Array) || !Number.isSafeInteger(offset) || !Number.isSafeInteger(count) || offset < 0 || count <= 0 || count > 4194304 || offset + count * 4 > src.length) return null;
        const size = count * 4; let input = 0, output = 0;
        try {
          input = alloc(size); output = alloc(size);
          new Uint8Array(memory.buffer, input, size).set(src.subarray(offset, offset + size));
          if (!deinterleave(input, output, size)) return null;
          const data = new DataView(memory.buffer, output, size), result = new Array(count);
          for (let i = 0; i < count; i++) result[i] = data.getUint32(i * 4, true);
          return result;
        } catch (_) { return null; }
        finally { if (output) free(output, size); if (input) free(input, size); }
      };
      bridge.validColor = color => typeof color === "string" && (color.length !== 7 ? /^#[0-9a-f]{6}$/i.test(color) : color[0] === "#" &&
        !!hex6(color.charCodeAt(1), color.charCodeAt(2), color.charCodeAt(3), color.charCodeAt(4), color.charCodeAt(5), color.charCodeAt(6)));
      bridge.status = "ready";
    })
    .catch(error => {
      bridge.status = "unavailable";
      console.warn("Rust physics unavailable; using JavaScript.", error);
    });
})();
