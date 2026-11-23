//! UGC upload decisions. The browser handles file access and backend calls.
use serde_json::{json, Value};

pub fn upload_plan(bytes: &[u8]) -> Option<Vec<u8>> {
    let state: Value = serde_json::from_slice(bytes).ok()?;
    let has_asset = state.get("has_asset")?.as_bool()?;
    let name = state.get("name")?.as_str()?;
    let kind = state.get("kind")?.as_i64()?;
    let raw_price = state.get("price")?.as_f64()?;
    let balance = match state.get("balance")? {
        Value::Null => None,
        value => Some(value.as_f64()?),
    };
    let editing = state.get("editing")?.as_bool()?;
    let published = state.get("published")?.as_bool()?;
    let sale = state.get("sale")?.as_bool()?;
    let live_price = state.get("live_price")?.as_f64()?;
    let has_file = state.get("has_file")?.as_bool()?;
    if !matches!(kind, 0..=2) || !raw_price.is_finite() || !live_price.is_finite() {
        return None;
    }
    let price = raw_price.floor().clamp(0.0, 1_000_000.0);
    let minimum = match kind {
        1 => 5.0,
        2 => 0.0,
        _ => 50.0,
    };
    let upload_fee = if editing {
        0.0
    } else {
        match kind {
            1 => 5.0,
            2 => 0.0,
            _ => 150.0,
        }
    };
    let listing_fee = if sale && !(published && price == live_price) && kind != 2 {
        (price * 0.15).ceil()
    } else {
        0.0
    };
    let total = upload_fee + listing_fee;
    let error = if !has_asset {
        1
    } else if name.is_empty() {
        2
    } else if sale && price < minimum {
        3
    } else if total > 0.0 && balance.is_some_and(|amount| amount < total) {
        4
    } else {
        0
    };
    let sale_changed = if sale {
        !published || price != live_price
    } else {
        published
    };
    serde_json::to_vec(&json!({
        "error": error,
        "price": price,
        "total": total,
        "upload_file": has_file,
        "create_item": !editing,
        "change_sale": sale_changed,
        "sale_price": if sale { price } else { live_price },
        "sale": sale,
    }))
    .ok()
}

/// # Safety
/// Input and output point to separate live allocations of the supplied sizes.
#[no_mangle]
pub unsafe extern "C" fn triancle_ugc_upload_plan(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let Some(result) = upload_plan(std::slice::from_raw_parts(input, input_len)) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    std::slice::from_raw_parts_mut(output, output_len)[..result.len()].copy_from_slice(&result);
    result.len() as i32
}

#[cfg(test)]
mod tests {
    use super::upload_plan;
    #[test]
    fn plans_paid_new_upload_and_edit() {
        let initial = br#"{"has_asset":true,"name":"Hat","kind":0,"price":50,"balance":1000,"editing":false,"published":false,"sale":true,"live_price":0,"has_file":true}"#;
        let value: serde_json::Value =
            serde_json::from_slice(&upload_plan(initial).unwrap()).unwrap();
        assert_eq!(value["error"], 0);
        assert_eq!(value["total"], 158.0);
        assert_eq!(value["change_sale"], true);
        let edit = br#"{"has_asset":true,"name":"Hat","kind":0,"price":50,"balance":0,"editing":true,"published":true,"sale":true,"live_price":50,"has_file":false}"#;
        let value: serde_json::Value = serde_json::from_slice(&upload_plan(edit).unwrap()).unwrap();
        assert_eq!(value["total"], 0.0);
        assert_eq!(value["change_sale"], false);
    }
}
