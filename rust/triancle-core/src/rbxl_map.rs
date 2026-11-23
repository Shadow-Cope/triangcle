//! Map extraction from decompressed binary RBXL chunks.
//! Unsupported or malformed data returns None so the JS importer remains available.
use crate::rbxl_index::{property, refs, text, u32_le};
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Clone)]
struct Class {
    name: String,
    refs: Vec<i64>,
}
struct Instance {
    class: String,
    props: HashMap<String, Value>,
}

fn reference(value: f64) -> Option<i64> {
    if value.is_finite() && value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_991.0 {
        Some(value as i64)
    } else {
        None
    }
}
fn part(name: &str) -> bool {
    matches!(
        name,
        "Part"
            | "SpawnLocation"
            | "Seat"
            | "VehicleSeat"
            | "MeshPart"
            | "WedgePart"
            | "CornerWedgePart"
            | "TrussPart"
    )
}
fn wanted(name: &str) -> bool {
    matches!(
        name,
        "Name"
            | "size"
            | "Size"
            | "CFrame"
            | "Color3uint8"
            | "Transparency"
            | "CanCollide"
            | "shape"
            | "Shape"
    )
}
fn round(value: f64, factor: f64) -> Option<f64> {
    let n = value * factor;
    if !n.is_finite() {
        return None;
    }
    let floor = n.floor();
    let result = if n - floor < 0.5 { floor } else { floor + 1.0 };
    Some(if result == 0.0 && n.is_sign_negative() {
        -0.0
    } else {
        result / factor
    })
}
fn number(v: &Value) -> Option<f64> {
    let n = v.as_f64()?;
    if n.is_finite() {
        Some(n)
    } else {
        None
    }
}
fn vector(v: &Value, len: usize) -> Option<Vec<f64>> {
    let a = v.as_array()?;
    if a.len() != len {
        return None;
    }
    a.iter().map(number).collect()
}

pub fn decode(data: &[u8]) -> Option<Vec<u8>> {
    let mut chunks: Vec<(&[u8], &[u8])> = Vec::new();
    let mut at = 0usize;
    while at < data.len() {
        let tag = data.get(at..at.checked_add(4)?)?;
        let len = u32_le(data, at.checked_add(4)?)? as usize;
        let start = at.checked_add(8)?;
        let end = start.checked_add(len)?;
        chunks.push((tag, data.get(start..end)?));
        at = end;
    }
    let mut classes: HashMap<u32, Class> = HashMap::new();
    let mut indices: HashMap<i64, usize> = HashMap::new();
    let mut instances: Vec<(i64, Instance)> = Vec::new();
    for (tag, d) in &chunks {
        if *tag != b"INST" {
            continue;
        }
        let id = u32_le(d, 0)?;
        let (name, next) = text(d, 4)?;
        let count_at = next.checked_add(1)?;
        let n = u32_le(d, count_at)? as usize;
        if n > 1_000_000 {
            return None;
        }
        let ids: Vec<i64> = refs(d, count_at.checked_add(4)?, n)?
            .into_iter()
            .map(reference)
            .collect::<Option<_>>()?;
        for id in &ids {
            let value = Instance {
                class: name.clone(),
                props: HashMap::new(),
            };
            if let Some(i) = indices.get(id) {
                instances[*i].1 = value;
            } else {
                indices.insert(*id, instances.len());
                instances.push((*id, value));
            }
        }
        classes.insert(id, Class { name, refs: ids });
    }
    let mut parents: HashMap<i64, i64> = HashMap::new();
    for (tag, d) in &chunks {
        if *tag == b"PROP" {
            let id = u32_le(d, 0)?;
            let (name, pos) = text(d, 4)?;
            let kind = *d.get(pos)?;
            let offset = pos.checked_add(1)?;
            let Some(class) = classes.get(&id) else {
                continue;
            };
            if !part(&class.name) || !wanted(&name) {
                continue;
            }
            if !matches!(kind, 1 | 2 | 4 | 14 | 16 | 18 | 26) {
                continue;
            }
            let raw = property(d, offset, class.refs.len(), kind)?;
            let vals: Vec<Value> = serde_json::from_slice(&raw).ok()?;
            if vals.len() != class.refs.len() {
                return None;
            }
            for (id, val) in class.refs.iter().zip(vals) {
                let idx = *indices.get(id)?;
                instances[idx].1.props.insert(name.clone(), val);
            }
        } else if *tag == b"PRNT" {
            let n = u32_le(d, 1)? as usize;
            if n > 1_000_000 {
                return None;
            }
            let children = refs(d, 5, n)?;
            let other = 5usize.checked_add(n.checked_mul(4)?)?;
            let parent_refs = refs(d, other, n)?;
            for (c, p) in children.into_iter().zip(parent_refs) {
                parents.insert(reference(c)?, reference(p)?);
            }
        }
    }
    let mut rows: Vec<Value> = Vec::new();
    let mut packed: Vec<u8> = Vec::new();
    let mut spawn: Option<[f64; 3]> = None;
    let mut cut = 0usize;
    for (id, obj) in &instances {
        if !part(&obj.class) {
            continue;
        }
        let Some(cf) = obj.props.get("CFrame") else {
            continue;
        };
        let Some(size) = obj.props.get("size").or_else(|| obj.props.get("Size")) else {
            continue;
        };
        let mut cursor = *id;
        let mut in_ws = false;
        for _ in 0..200 {
            if cursor < 0 {
                break;
            }
            if let Some(index) = indices.get(&cursor) {
                if instances[*index].1.class == "Workspace" {
                    in_ws = true;
                    break;
                }
            }
            let Some(next) = parents.get(&cursor) else {
                break;
            };
            cursor = *next;
        }
        if !in_ws {
            continue;
        }
        if rows.len() >= 6000 {
            cut += 1;
            continue;
        }
        let sizes = vector(size, 3)?;
        let pos = vector(cf.get("pos")?, 3)?;
        let rot = vector(cf.get("rot")?, 9)?;
        let color = match obj.props.get("Color3uint8") {
            Some(v) => vector(v, 3)?,
            None => vec![163.0, 162.0, 165.0],
        };
        if color
            .iter()
            .any(|v| *v < 0.0 || *v > 255.0 || v.fract() != 0.0)
        {
            return None;
        }
        let color_num = ((color[0] as u32) << 16) | ((color[1] as u32) << 8) | color[2] as u32;
        let transparency = match obj.props.get("Transparency") {
            Some(v) => number(v)?,
            None => 0.0,
        };
        let collidable = obj.props.get("CanCollide") != Some(&Value::Bool(false));
        let shape = obj
            .props
            .get("shape")
            .or_else(|| obj.props.get("Shape"))
            .and_then(Value::as_u64)
            .filter(|v| *v == 0 || *v == 2)
            .unwrap_or(1);
        let s: Vec<f64> = sizes
            .into_iter()
            .map(|v| round(v, 1000.0))
            .collect::<Option<_>>()?;
        let p: Vec<f64> = pos
            .into_iter()
            .map(|v| round(v, 1000.0))
            .collect::<Option<_>>()?;
        let r: Vec<f64> = rot
            .into_iter()
            .map(|v| round(v, 10000.0))
            .collect::<Option<_>>()?;
        for value in s.iter().chain(p.iter()).chain(r.iter()) {
            packed.extend_from_slice(&value.to_le_bytes());
        }
        if obj.class == "SpawnLocation" && spawn.is_none() {
            spawn = Some([p[0], p[1] + s[1] / 2.0 + 3.0, p[2]]);
        }
        rows.push(json!([
            s[0],
            s[1],
            s[2],
            p[0],
            p[1],
            p[2],
            r,
            color_num,
            round(transparency, 1000.0)?,
            if collidable { 1 } else { 0 },
            shape
        ]));
    }
    if rows.is_empty() {
        return None;
    }
    let sp = match spawn {
        Some(s) => s,
        None => crate::default_spawn(&packed)?,
    };
    let result = json!({"spawn":[round(sp[0],1000.0)?,round(sp[1],1000.0)?,round(sp[2],1000.0)?],"parts":rows,"cut":cut});
    serde_json::to_vec(&result).ok()
}

/// # Safety
/// Input/output must be separate live allocations of the supplied lengths.
#[no_mangle]
pub unsafe extern "C" fn triancle_rbxl_map(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let bytes = std::slice::from_raw_parts(input, input_len);
    let Some(result) = decode(bytes) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    let dst = std::slice::from_raw_parts_mut(output, output_len);
    dst[..result.len()].copy_from_slice(&result);
    result.len() as i32
}
