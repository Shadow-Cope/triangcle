//! Pure account-error classification; authentication remains a Supabase operation.
use serde_json::Value;

pub fn permission(bytes: &[u8]) -> Option<i32> {
    let state: Value = serde_json::from_slice(bytes).ok()?;
    let email = state.get("email")?.as_str()?;
    let domain = state.get("domain")?.as_str()?;
    let badges = state.get("badges")?.as_array()?;
    let permissions = state.get("permissions")?.as_object()?;
    let mode = state.get("mode")?.as_str()?;
    if !email.is_ascii() || !domain.is_ascii() || badges.len() > 5000 {
        return None;
    }
    let owner = email.eq_ignore_ascii_case(&format!("owen@{domain}"))
        || badges.iter().any(|badge| badge.as_str() == Some("owner"));
    if owner {
        return Some(1);
    }
    if mode == "owner" {
        return Some(0);
    }
    let allowed = badges.iter().any(|badge| {
        let Some(name) = badge.as_str() else {
            return false;
        };
        (mode == "can_ugc" && name == "ugc")
            || permissions
                .get(name)
                .and_then(Value::as_object)
                .and_then(|perms| perms.get(mode))
                .and_then(Value::as_bool)
                .unwrap_or(false)
    });
    Some(allowed as i32)
}

/// # Safety
/// Input points to a live allocation of `input_len` bytes.
#[no_mangle]
pub unsafe extern "C" fn triancle_account_permission(input: *const u8, input_len: usize) -> i32 {
    permission(std::slice::from_raw_parts(input, input_len)).unwrap_or(-1)
}

/// Validate an account rename before the backend is contacted.
/// Returns 1 for invalid name, 2 for unchanged, 3 for insufficient balance.
pub fn rename_check(bytes: &[u8]) -> Option<i32> {
    let root: Value = serde_json::from_slice(bytes).ok()?;
    let name = root.get("name")?.as_str()?;
    let current = root.get("current")?.as_str()?;
    if !name.is_ascii() || !current.is_ascii() {
        return None;
    }
    let balance = match root.get("balance")? {
        Value::Null => None,
        v => Some(v.as_f64()?),
    };
    let cost = root.get("cost")?.as_f64()?;
    if !(3..=20).contains(&name.len())
        || !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
    {
        return Some(1);
    }
    if name.eq_ignore_ascii_case(current) {
        return Some(2);
    }
    if balance.is_some_and(|v| v < cost) {
        return Some(3);
    }
    Some(0)
}

/// # Safety
/// Input must be a live allocation of `input_len` bytes.
#[no_mangle]
pub unsafe extern "C" fn triancle_rename_check(input: *const u8, input_len: usize) -> i32 {
    rename_check(std::slice::from_raw_parts(input, input_len)).unwrap_or(-1)
}

#[cfg(test)]
mod rename_tests {
    use super::rename_check;
    #[test]
    fn validates_before_asking_for_payment() {
        assert_eq!(
            rename_check(br#"{"name":"x","current":"x","balance":0,"cost":100}"#),
            Some(1)
        );
        assert_eq!(
            rename_check(br#"{"name":"Alice","current":"alice","balance":0,"cost":100}"#),
            Some(2)
        );
        assert_eq!(
            rename_check(br#"{"name":"Alice","current":"Bob","balance":99,"cost":100}"#),
            Some(3)
        );
        assert_eq!(
            rename_check(br#"{"name":"Alice","current":"Bob","balance":null,"cost":100}"#),
            Some(0)
        );
    }
}

pub fn login_email(bytes: &[u8]) -> Option<Vec<u8>> {
    let root: Value = serde_json::from_slice(bytes).ok()?;
    let username = root.get("username")?.as_str()?;
    let domain = root.get("domain")?.as_str()?;
    if !(3..=20).contains(&username.len())
        || !username
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_')
    {
        return None;
    }
    serde_json::to_vec(&(username.to_ascii_lowercase() + "@" + domain)).ok()
}

/// # Safety
/// Input/output must be separate live allocations of the supplied lengths.
#[no_mangle]
pub unsafe extern "C" fn triancle_login_email(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let src = std::slice::from_raw_parts(input, input_len);
    let Some(result) = login_email(src) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    let dst = std::slice::from_raw_parts_mut(output, output_len);
    dst[..result.len()].copy_from_slice(&result);
    result.len() as i32
}

#[no_mangle]
pub extern "C" fn triancle_password_length_valid(length: u32) -> i32 {
    (length >= 6) as i32
}

pub fn auth_error(bytes: &[u8]) -> Option<i32> {
    let root: Value = serde_json::from_slice(bytes).ok()?;
    let code = root.get("code")?.as_str()?;
    let message = root.get("message")?.as_str()?.to_ascii_lowercase();
    let rate_limited = root.get("rate_limited")?.as_bool()?;
    if code == "user_already_exists" || message.contains("already registered") {
        return Some(1);
    }
    if code == "invalid_credentials" || message.contains("invalid login") {
        return Some(2);
    }
    if code == "email_not_confirmed" || message.contains("not confirmed") {
        return Some(3);
    }
    if code == "over_request_rate_limit" || rate_limited {
        return Some(4);
    }
    let invalid_address = message.match_indices("address ").any(|(start, _)| {
        let rest = &message[start + 8..];
        rest.find(" is invalid")
            .is_some_and(|end| !rest[..end].contains(['\n', '\r', '\u{2028}', '\u{2029}']))
    });
    if code == "email_address_invalid" || invalid_address {
        return Some(5);
    }
    if code == "weak_password" {
        return Some(6);
    }
    Some(0)
}

/// # Safety
/// Input must be a live allocation of `input_len` bytes.
#[no_mangle]
pub unsafe extern "C" fn triancle_auth_error(input: *const u8, input_len: usize) -> i32 {
    let src = std::slice::from_raw_parts(input, input_len);
    auth_error(src).unwrap_or(-1)
}
