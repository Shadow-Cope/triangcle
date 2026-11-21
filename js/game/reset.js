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
