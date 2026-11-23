//! Detached avatar part physics. Rendering and scene ownership stay in the browser.
type Vec3 = [f64; 3];

fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn scale(a: Vec3, s: f64) -> Vec3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn rotate(v: Vec3, q: [f64; 4]) -> Vec3 {
    let qv = [q[0], q[1], q[2]];
    let t = scale(cross(qv, v), 2.0);
    add(add(v, scale(t, q[3])), cross(qv, t))
}
fn inertia(v: Vec3, q: [f64; 4], inverse: Vec3) -> Vec3 {
    let local = rotate(v, [-q[0], -q[1], -q[2], q[3]]);
    rotate(
        [
            local[0] * inverse[0],
            local[1] * inverse[1],
            local[2] * inverse[2],
        ],
        q,
    )
}
fn triplet(values: &[f64], at: usize) -> Vec3 {
    [values[at], values[at + 1], values[at + 2]]
}
fn put(values: &mut [f64], at: usize, v: Vec3) {
    values[at..at + 3].copy_from_slice(&v);
}

pub fn step(state: &mut [f64; 23], solids: &[[f64; 6]]) -> bool {
    if !state.iter().all(|n| n.is_finite()) || solids.iter().flatten().any(|n| !n.is_finite()) {
        return false;
    }
    let mut p = triplet(state, 0);
    let mut q = [state[3], state[4], state[5], state[6]];
    let mut v = triplet(state, 7);
    let mut w = triplet(state, 10);
    let half = triplet(state, 13);
    let inverse = triplet(state, 16);
    let dt = state[19];
    let gravity = state[20];
    let restitution = state[21];
    let friction = state[22];
    v[1] -= gravity * dt;
    p = add(p, scale(v, dt));
    let dq = [
        w[0] * q[3] + w[1] * q[2] - w[2] * q[1],
        w[1] * q[3] + w[2] * q[0] - w[0] * q[2],
        w[2] * q[3] + w[0] * q[1] - w[1] * q[0],
        -w[0] * q[0] - w[1] * q[1] - w[2] * q[2],
    ];
    for i in 0..4 {
        q[i] += 0.5 * dt * dq[i];
    }
    let qlen = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if qlen == 0.0 {
        q = [0.0, 0.0, 0.0, 1.0];
    } else {
        for item in &mut q {
            *item /= qlen;
        }
    }
    let mut max_pen = 0.0f64;
    let mut contact = false;
    for sx in [-1.0, 1.0] {
        for sy in [-1.0, 1.0] {
            for sz in [-1.0, 1.0] {
                let r = rotate([sx * half[0], sy * half[1], sz * half[2]], q);
                let point = add(p, r);
                for solid in solids {
                    if point[0] < solid[0]
                        || point[0] > solid[3]
                        || point[2] < solid[2]
                        || point[2] > solid[5]
                        || point[1] > solid[4]
                        || point[1] < solid[1]
                    {
                        continue;
                    }
                    max_pen = max_pen.max(solid[4] - point[1]);
                    contact = true;
                    let velocity = add(cross(w, r), v);
                    if velocity[1] >= 0.0 {
                        continue;
                    }
                    let bounce = if velocity[1] < -3.0 { restitution } else { 0.0 };
                    let normal = [0.0, 1.0, 0.0];
                    let rxn = cross(r, normal);
                    let k = 1.0 + dot(normal, cross(inertia(rxn, q, inverse), r));
                    let impulse = -(1.0 + bounce) * velocity[1] / k;
                    v[1] += impulse;
                    w = add(w, inertia(cross(r, [0.0, impulse, 0.0]), q, inverse));
                    let tangential = add(cross(w, r), v);
                    let length = tangential[0].hypot(tangential[2]);
                    if length > 1e-4 {
                        let tangent = [tangential[0] / length, 0.0, tangential[2] / length];
                        let kt =
                            1.0 + dot(tangent, cross(inertia(cross(r, tangent), q, inverse), r));
                        let jt = (friction * impulse).min(length / kt);
                        v = sub(v, scale(tangent, jt));
                        w = add(w, inertia(cross(r, scale(tangent, -jt)), q, inverse));
                    }
                }
            }
        }
    }
    if max_pen > 0.0 {
        p[1] += max_pen;
    }
    if contact {
        w = scale(w, (-2.5 * dt).exp());
        if dot(v, v) < 0.01 && dot(w, w) < 0.01 {
            v = [0.0; 3];
            w = [0.0; 3];
        }
    }
    if !p
        .iter()
        .chain(q.iter())
        .chain(v.iter())
        .chain(w.iter())
        .all(|n| n.is_finite())
    {
        return false;
    }
    put(state, 0, p);
    state[3..7].copy_from_slice(&q);
    put(state, 7, v);
    put(state, 10, w);
    true
}

/// # Safety
/// State references 23 writable f64 values. Bounds reference `count * 6` f64
/// values in minX,minY,minZ,maxX,maxY,maxZ order. Allocations must not overlap.
#[no_mangle]
pub unsafe extern "C" fn triancle_step_debris(
    state: *mut f64,
    bounds: *const f64,
    count: usize,
) -> i32 {
    if count > 10_000 {
        return 0;
    }
    let source = std::slice::from_raw_parts(state, 23);
    let mut values = [0.0; 23];
    values.copy_from_slice(source);
    let raw = std::slice::from_raw_parts(bounds, count * 6);
    let solids: Vec<[f64; 6]> = raw
        .chunks_exact(6)
        .map(|part| part.try_into().unwrap())
        .collect();
    if !step(&mut values, &solids) {
        return 0;
    }
    std::slice::from_raw_parts_mut(state, 23).copy_from_slice(&values);
    1
}
