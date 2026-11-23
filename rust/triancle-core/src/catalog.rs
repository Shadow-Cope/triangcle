//! Catalog filtering. Text is normalized by the browser to preserve JS case rules.
use serde_json::{json, Value};
use std::collections::HashSet;

pub fn worn_ids(bytes: &[u8]) -> Option<Vec<u8>> {
    let root: Value = serde_json::from_slice(bytes).ok()?;
    let ids = root.get("ids")?.as_array()?;
    let limit = root.get("limit")?.as_u64()? as usize;
    if ids.len() > 100_000 || limit > 1000 {
        return None;
    }
    let mut selected = Vec::new();
    for value in ids {
        let id = value.as_str()?;
        let valid = id.len() == 36
            && id.bytes().enumerate().all(|(index, byte)| {
                if matches!(index, 8 | 13 | 18 | 23) {
                    byte == b'-'
                } else {
                    byte.is_ascii_hexdigit()
                }
            });
        if valid && selected.len() < limit {
            selected.push(id);
        }
    }
    serde_json::to_vec(&selected).ok()
}

/// # Safety
/// Input and output point to separate live allocations of the supplied sizes.
#[no_mangle]
pub unsafe extern "C" fn triancle_worn_ids(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let Some(result) = worn_ids(std::slice::from_raw_parts(input, input_len)) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    std::slice::from_raw_parts_mut(output, output_len)[..result.len()].copy_from_slice(&result);
    result.len() as i32
}

/// Encode the catalog button action. Ownership and equipment are snapshots
/// supplied by the browser. The backend verifies any purchase or outfit change.
#[no_mangle]
pub extern "C" fn triancle_item_action(signed_in: i32, owned: i32, equipped: i32) -> i32 {
    match (signed_in != 0, owned != 0, equipped != 0) {
        (false, _, _) => 0,
        (true, false, _) => 1,
        (true, true, false) => 2,
        (true, true, true) => 3,
    }
}

/// Classify a purchase failure and indicate which cached data to refresh.
/// The low byte is the message code, with flags at 256 (inventory) and
/// 512 (catalog). A backend message may match more than one code.
pub fn purchase_error(message: &str) -> i32 {
    let codes = [
        "insufficient_funds",
        "already_owned",
        "price_changed",
        "not_for_sale",
        "own_item",
        "not_logged_in",
    ];
    let code = codes
        .iter()
        .position(|key| message.contains(key))
        .map_or(0, |index| index as i32 + 1);
    let inventory = message.contains("already_owned");
    let catalog = message.contains("price_changed") || message.contains("not_for_sale");
    code | ((inventory as i32) << 8) | ((catalog as i32) << 9)
}

/// # Safety
/// Input points to a live allocation of `len` bytes.
#[no_mangle]
pub unsafe extern "C" fn triancle_purchase_error(input: *const u8, len: usize) -> i32 {
    let bytes = std::slice::from_raw_parts(input, len);
    std::str::from_utf8(bytes).map_or(-1, purchase_error)
}

/// Return the first validation error for a catalog edit, in UI order.
#[no_mangle]
pub extern "C" fn triancle_item_edit_check(
    name_length: u32,
    price: f64,
    on_sale: i32,
    minimum: f64,
) -> i32 {
    if !(1..=40).contains(&name_length) {
        1
    } else if !(0.0..=1_000_000.0).contains(&price) {
        2
    } else if on_sale != 0 && price < minimum {
        3
    } else {
        0
    }
}

/// Select equipped clothing to remove before equipping another item.
/// The browser executes the returned operations against its current backend.
pub fn equip_conflicts(bytes: &[u8]) -> Option<Vec<u8>> {
    let root: Value = serde_json::from_slice(bytes).ok()?;
    let target = root.get("id")?.as_str()?;
    let attach = root.get("attach")?.as_str()?;
    let worn = root.get("worn")?.as_array()?;
    if worn.len() > 10000 {
        return None;
    }
    let mut conflicts = Vec::new();
    if matches!(attach, "Shirt" | "Pants") {
        for (index, item) in worn.iter().enumerate() {
            let id = item.get("id")?.as_str()?;
            let slot = item.get("attach")?.as_str()?;
            if id != target && slot == attach {
                conflicts.push(index);
            }
        }
    }
    serde_json::to_vec(&conflicts).ok()
}

#[cfg(test)]
mod equip_tests {
    use super::equip_conflicts;
    #[test]
    fn replaces_only_other_clothing_in_same_slot() {
        let input = br#"{"id":"new","attach":"Shirt","worn":[{"id":"old","attach":"Shirt"},{"id":"new","attach":"Shirt"},{"id":"pants","attach":"Pants"}]}"#;
        assert_eq!(equip_conflicts(input).unwrap(), b"[0]");
        assert_eq!(
            equip_conflicts(br#"{"id":"hat","attach":"Hat","worn":[{"id":"old","attach":"Hat"}]}"#)
                .unwrap(),
            b"[]"
        );
        assert!(equip_conflicts(br#"{"id":"new","attach":"Shirt","worn":[{}]}"#).is_none());
    }
}

/// # Safety
/// Input and output must be separate live allocations of the supplied lengths.
#[no_mangle]
pub unsafe extern "C" fn triancle_equip_conflicts(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let Some(result) = equip_conflicts(std::slice::from_raw_parts(input, input_len)) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    std::slice::from_raw_parts_mut(output, output_len)[..result.len()].copy_from_slice(&result);
    result.len() as i32
}

pub fn filter(bytes: &[u8]) -> Option<Vec<u8>> {
    let root: Value = serde_json::from_slice(bytes).ok()?;
    let query = root.get("query")?.as_str()?;
    let category = root.get("category")?.as_str()?;
    let author = root.get("author")?.as_str()?;
    let min = match root.get("min")? {
        Value::Null => None,
        v => Some(v.as_f64()?),
    };
    let max = match root.get("max")? {
        Value::Null => None,
        v => Some(v.as_f64()?),
    };
    let free = root.get("free")?.as_bool()?;
    let hide_owned = root.get("hide_owned")?.as_bool()?;
    let items = root.get("items")?.as_array()?;
    if items.len() > 10000 {
        return None;
    }
    let mut result = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let name = item.get("name")?.as_str()?;
        let attach = item.get("attach")?.as_str()?;
        let creator = item.get("author")?.as_str()?;
        let price = item.get("price")?.as_f64()?;
        let owned = item.get("owned")?.as_bool()?;
        let kind_ok = category == "all"
            || if category == "acc" {
                !matches!(attach, "Shirt" | "Pants" | "Face")
            } else {
                attach == category
            };
        if (query.is_empty() || name.contains(query))
            && kind_ok
            && (author.is_empty() || creator.contains(author))
            && min.is_none_or(|v| price >= v)
            && max.is_none_or(|v| price <= v)
            && (!free || price == 0.0)
            && (!hide_owned || !owned)
        {
            result.push(index);
        }
    }
    serde_json::to_vec(&json!(result)).ok()
}

pub fn inventory(bytes: &[u8]) -> Option<Vec<u8>> {
    let root: Value = serde_json::from_slice(bytes).ok()?;
    let rows = root.as_array()?;
    if rows.len() > 100_000 {
        return None;
    }
    let (mut owned, mut equipped) = (Vec::with_capacity(rows.len()), Vec::new());
    for row in rows {
        let id = row.get("item_id")?.as_str()?;
        let is_equipped = row.get("equipped")?.as_bool()?;
        owned.push(id);
        if is_equipped {
            equipped.push(id);
        }
    }
    serde_json::to_vec(&json!({"owned":owned,"equipped":equipped})).ok()
}

/// Find positions in one item-ID list absent from another, preserving order and duplicates.
pub fn missing_indices(bytes: &[u8]) -> Option<Vec<u8>> {
    let root: Value = serde_json::from_slice(bytes).ok()?;
    let values = root.get("values")?.as_array()?;
    let present = root.get("present")?.as_array()?;
    if values.len() > 10000 || present.len() > 10000 {
        return None;
    }
    let known: HashSet<&str> = present.iter().map(Value::as_str).collect::<Option<_>>()?;
    let mut missing = Vec::new();
    for (index, value) in values.iter().enumerate() {
        if !known.contains(value.as_str()?) {
            missing.push(index);
        }
    }
    serde_json::to_vec(&json!(missing)).ok()
}

/// # Safety
/// Input and output must be separate live allocations of the supplied lengths.
#[no_mangle]
pub unsafe extern "C" fn triancle_missing_indices(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let src = std::slice::from_raw_parts(input, input_len);
    let Some(result) = missing_indices(src) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    let dst = std::slice::from_raw_parts_mut(output, output_len);
    dst[..result.len()].copy_from_slice(&result);
    result.len() as i32
}

/// # Safety
/// Input and output must be separate live allocations of the supplied lengths.
#[no_mangle]
pub unsafe extern "C" fn triancle_inventory_rows(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let src = std::slice::from_raw_parts(input, input_len);
    let Some(result) = inventory(src) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    let dst = std::slice::from_raw_parts_mut(output, output_len);
    dst[..result.len()].copy_from_slice(&result);
    result.len() as i32
}

/// # Safety
/// Input and output must be separate live allocations of the supplied lengths.
#[no_mangle]
pub unsafe extern "C" fn triancle_catalog_filter(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let src = std::slice::from_raw_parts(input, input_len);
    let Some(result) = filter(src) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    let dst = std::slice::from_raw_parts_mut(output, output_len);
    dst[..result.len()].copy_from_slice(&result);
    result.len() as i32
}
