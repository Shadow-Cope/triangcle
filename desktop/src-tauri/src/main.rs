#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use std::{
    env,
    net::{TcpStream, ToSocketAddrs},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{
    menu::{MenuBuilder, SubmenuBuilder},
    webview::{Color, NewWindowResponse},
    App, AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

#[cfg(feature = "studio")]
const SCHEME: &str = "triancle-studio";
#[cfg(not(feature = "studio"))]
const SCHEME: &str = "triancle";

#[cfg(feature = "studio")]
const APP_NAME: &str = "Triancle Studio";
#[cfg(not(feature = "studio"))]
const APP_NAME: &str = "Triancle";

const MAIN_WINDOW: &str = "main";

#[derive(Clone)]
struct AppState {
    site: Option<Url>,
    target: Arc<Mutex<Option<Url>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopConfig {
    site_url: Option<String>,
    studio_site_url: Option<String>,
}

#[derive(Debug, PartialEq)]
enum DeepLinkAction {
    Open,
    Join(String),
}

fn config_file() -> Option<DesktopConfig> {
    serde_json::from_str::<DesktopConfig>(include_str!("../../config.json")).ok()
}

fn normalize_site(raw: String) -> Option<Url> {
    let raw = raw.trim().trim_end_matches('/');
    if raw.is_empty() || raw.contains("YOUR-SITE-URL") {
        return None;
    }
    let mut url = Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return None;
    }
    url.set_fragment(None);
    Some(url)
}

fn configured_site() -> Option<Url> {
    let argument =
        env::args().find_map(|argument| argument.strip_prefix("--url=").map(str::to_owned));
    let config = config_file();
    let raw = argument
        .or_else(|| env::var("TRIANGLE_URL").ok())
        .or_else(|| config.and_then(|value| value.site_url))?;
    normalize_site(raw)
}

fn configured_studio_site() -> Option<Url> {
    if !cfg!(feature = "studio") {
        return configured_site();
    }
    let argument = env::args().find_map(|argument| {
        argument
            .strip_prefix("--studio-url=")
            .map(str::to_owned)
    });
    let shared = env::args()
        .find_map(|argument| argument.strip_prefix("--url=").map(str::to_owned))
        .or_else(|| env::var("TRIANGLE_URL").ok());
    let config = config_file();
    let raw = argument
        .or_else(|| env::var("TRIANGLE_STUDIO_URL").ok())
        .or(shared)
        .or_else(|| config.as_ref().and_then(|value| value.studio_site_url.clone()))
        .or_else(|| config.and_then(|value| value.site_url))?;
    normalize_site(raw)
}

fn root_url(site: &Url) -> Url {
    let mut url = site.clone();
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    url
}

fn join_url(site: &Url, game: &str) -> Url {
    let mut url = root_url(site);
    url.set_query(Some(&format!("join={game}")));
    url
}

fn start_url(site: &Url) -> Url {
    let mut url = root_url(site);
    if cfg!(feature = "studio") {
        url.set_path("/studio.html");
    }
    url
}

fn parse_deep_link(raw: &str) -> Option<DeepLinkAction> {
    let url = Url::parse(raw).ok()?;
    if url.scheme() != SCHEME {
        return None;
    }
    if url.host_str() == Some("join") {
        let id = url.path().trim_start_matches('/');
        if !id.is_empty()
            && id.len() <= 64
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        {
            return Some(DeepLinkAction::Join(id.to_string()));
        }
    }
    Some(DeepLinkAction::Open)
}

fn site_reachable(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let Some(port) = url.port_or_known_default() else {
        return false;
    };
    (host, port)
        .to_socket_addrs()
        .ok()
        .into_iter()
        .flatten()
        .take(4)
        .any(|address| TcpStream::connect_timeout(&address, Duration::from_secs(2)).is_ok())
}

fn offline_url() -> Url {
    if cfg!(windows) {
        Url::parse("http://tauri.localhost/offline.html").unwrap()
    } else {
        Url::parse("tauri://localhost/offline.html").unwrap()
    }
}

fn is_local_app_url(url: &Url) -> bool {
    url.scheme() == "tauri" || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
}

fn same_origin(left: &Url, right: &Url) -> bool {
    left.origin().ascii_serialization() == right.origin().ascii_serialization()
}

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn navigate_to_target(app: &AppHandle, state: &AppState) {
    let target = state.target.lock().unwrap().clone();
    if let (Some(window), Some(target)) = (app.get_webview_window(MAIN_WINDOW), target) {
        let destination = if site_reachable(&target) {
            target
        } else {
            offline_url()
        };
        let _ = window.navigate(destination);
    }
    focus_main(app);
}

fn handle_deep_link(app: &AppHandle, state: &AppState, raw: &str) -> bool {
    let Some(action) = parse_deep_link(raw) else {
        return false;
    };
    if let (DeepLinkAction::Join(game), Some(site)) = (action, &state.site) {
        state.target.lock().unwrap().replace(join_url(site, &game));
        navigate_to_target(app, state);
    } else {
        focus_main(app);
    }
    true
}

fn initialization_script(site: Option<&Url>, version: &str) -> String {
    let origin = site
        .map(|url| url.origin().ascii_serialization())
        .unwrap_or_default();
    let origin = serde_json::to_string(&origin).unwrap();
    let version = serde_json::to_string(version).unwrap();
    let platform = if cfg!(windows) { "win32" } else { "darwin" };
    format!(
        r#"(() => {{
          const siteOrigin = {origin};
          const localPage = location.protocol === 'tauri:' || location.hostname === 'tauri.localhost';
          if ((localPage || location.origin === siteOrigin) && !window.TriancleApp) {{
            Object.defineProperty(window, 'TriancleApp', {{value:Object.freeze({{
              isApp:true,
              platform:{platform:?},
              version:{version},
              retry:()=>location.assign('triancle-internal://retry'),
              quit:()=>location.assign('triancle-internal://quit')
            }}), configurable:false}});
            if (!localPage) addEventListener('offline', () => location.assign('triancle-internal://offline'));
          }}
        }})();"#
    )
}

/* Forced auto-update: on start-up the app checks the release manifest. If there is a newer
   build the player may only pick "Update now" (download + install + restart) or "Quit" -
   the game window is never created until the app is up to date. A failed check (offline,
   no manifest yet) does not block anybody, so an unconfigured build still opens. */
/* The plugin config keeps the public key; until it is replaced with a real one the
   check is skipped so a fresh checkout can still run. */
fn updater_configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|value| value.get("pubkey"))
        .and_then(|value| value.as_str())
        .map(|key| !key.is_empty() && !key.starts_with("PASTE_"))
        .unwrap_or(false)
}

#[allow(unreachable_code)]
fn check_updates_or_exit(app: &AppHandle) -> bool {
    if !updater_configured(app) {
        eprintln!("updater has no signing key yet: skipping the update check");
        return true;
    }
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            eprintln!("updater unavailable: {err}");
            return true;
        }
    };
    let update = match tauri::async_runtime::block_on(updater.check()) {
        Ok(Some(update)) => update,
        Ok(None) => return true,
        Err(err) => {
            eprintln!("update check failed: {err}");
            return true;
        }
    };

    let version = update.version.clone();
    let go = app
        .dialog()
        .message(format!(
            "{APP_NAME} {version} is available.\n\nYou need this update before you can play."
        ))
        .title("Update required")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Update now".to_string(),
            "Quit".to_string(),
        ))
        .blocking_show();
    if !go {
        app.exit(0);
        return false;
    }

    let installed = tauri::async_runtime::block_on(update.download_and_install(
        |_chunk, _total| {},
        || {},
    ))
    .is_ok();
    if !installed {
        app.dialog()
            .message("The update couldn't be installed. Check your connection and open the app again.")
            .title("Update failed")
            .kind(MessageDialogKind::Error)
            .buttons(MessageDialogButtons::Ok)
            .blocking_show();
        app.exit(1);
        return false;
    }

    app.restart();
    false
}

fn build_menu(app: &App) -> tauri::Result<()> {
    let triancle = SubmenuBuilder::new(app, APP_NAME)
        .text("home", "Home")
        .text("reload", "Reload")
        .fullscreen()
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .close_window()
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&triancle, &edit, &window])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

fn main() {
    let site = configured_studio_site();
    let target = site.as_ref().map(start_url);
    let state = AppState {
        site,
        target: Arc::new(Mutex::new(target)),
    };
    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", windows))]
    {
        let prefix = format!("{SCHEME}://");
        builder = builder.plugin(tauri_plugin_single_instance::init(
            move |app, arguments, _cwd| {
                let state = app.state::<AppState>();
                let handled = arguments
                    .iter()
                    .find(|argument| argument.starts_with(&prefix))
                    .is_some_and(|link| handle_deep_link(app, &state, link));
                if !handled {
                    focus_main(app);
                }
            },
        ));
    }

    let app = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "home" => {
                let state = app.state::<AppState>();
                if let Some(site) = &state.site {
                    state.target.lock().unwrap().replace(start_url(site));
                    navigate_to_target(app, &state);
                }
            }
            "reload" => {
                if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                    let _ = window.reload();
                }
            }
            _ => {}
        })
        .on_window_event(|_window, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                api.prevent_close();
                let _ = _window.hide();
            }
        })
        .setup(|app| {
            if !cfg!(feature = "studio") {
                build_menu(app)?;
            }

            // Nothing below runs until the app is on the newest published version.
            if !check_updates_or_exit(app.handle()) {
                return Ok(());
            }

            let state = app.state::<AppState>().inner().clone();

            if let Some(urls) = app.deep_link().get_current()? {
                for url in urls {
                    if let (Some(DeepLinkAction::Join(game)), Some(site)) =
                        (parse_deep_link(url.as_str()), &state.site)
                    {
                        state.target.lock().unwrap().replace(join_url(site, &game));
                    }
                }
            }

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let state = handle.state::<AppState>();
                for url in event.urls() {
                    handle_deep_link(&handle, &state, url.as_str());
                }
            });

            let initial = match &state.site {
                None => WebviewUrl::App("setup.html".into()),
                Some(_) => {
                    let target = state.target.lock().unwrap().clone().unwrap();
                    if site_reachable(&target) {
                        WebviewUrl::External(target)
                    } else {
                        WebviewUrl::App("offline.html".into())
                    }
                }
            };
            let app_for_navigation = app.handle().clone();
            let state_for_navigation = state.clone();
            let site_for_navigation = state.site.clone();
            let app_for_new_window = app.handle().clone();
            let script =
                initialization_script(state.site.as_ref(), &app.package_info().version.to_string());

            WebviewWindowBuilder::new(app, MAIN_WINDOW, initial)
                .title(APP_NAME)
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .background_color(Color(18, 15, 9, 255))
                .enable_clipboard_access()
                .initialization_script(script)
                .on_navigation(move |url| {
                    if url.scheme() == "triancle-internal" {
                        match url.host_str() {
                            Some("quit") => app_for_navigation.exit(0),
                            Some("retry") => {
                                let app = app_for_navigation.clone();
                                let state = state_for_navigation.clone();
                                let _ = app_for_navigation
                                    .run_on_main_thread(move || navigate_to_target(&app, &state));
                            }
                            Some("offline") => {
                                let app = app_for_navigation.clone();
                                let _ = app_for_navigation.run_on_main_thread(move || {
                                    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                                        let _ = window.navigate(offline_url());
                                    }
                                });
                            }
                            _ => {}
                        }
                        return false;
                    }
                    if is_local_app_url(url)
                        || site_for_navigation
                            .as_ref()
                            .is_some_and(|site| same_origin(site, url))
                    {
                        return true;
                    }
                    if url.scheme() == "https" {
                        let _ = open::that_detached(url.as_str());
                    }
                    false
                })
                .on_new_window(move |url, _features| {
                    if url.scheme() == "https" {
                        let _ = open::that_detached(url.as_str());
                    }
                    focus_main(&app_for_new_window);
                    NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Triancle");

    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            focus_main(_app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{join_url, parse_deep_link, root_url, DeepLinkAction, SCHEME};
    use tauri::Url;

    #[test]
    fn accepts_only_valid_triancle_links() {
        assert_eq!(
            parse_deep_link(&format!("{SCHEME}://open")),
            Some(DeepLinkAction::Open)
        );
        assert_eq!(
            parse_deep_link(&format!("{SCHEME}://join/baseplate-1")),
            Some(DeepLinkAction::Join("baseplate-1".into()))
        );
        assert_eq!(
            parse_deep_link(&format!("{SCHEME}://join/bad%20id")),
            Some(DeepLinkAction::Open)
        );
        assert_eq!(parse_deep_link("https://example.com"), None);
    }

    #[test]
    fn creates_root_and_join_urls() {
        let site = Url::parse("https://example.com/old?x=1#part").unwrap();
        assert_eq!(root_url(&site).as_str(), "https://example.com/");
        assert_eq!(
            join_url(&site, "baseplate-1").as_str(),
            "https://example.com/?join=baseplate-1"
        );
    }
}
