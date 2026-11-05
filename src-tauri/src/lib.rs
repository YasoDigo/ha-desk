use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use std::{fs, path::PathBuf};
use tauri::{
    AppHandle, Manager, WebviewWindow, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_positioner::{Position, WindowExt};

static LAST_HIDE: Mutex<Option<Instant>> = Mutex::new(None);
// Sabitlenmişse popup dışarı tıklayınca kapanmaz (palet bundan etkilenmez)
static PINNED: AtomicBool = AtomicBool::new(false);

const KEYRING_SERVICE: &str = "ha-desk";
const KEYRING_USER: &str = "ha-token";

// Komut paleti penceresi boyutu (mantıksal piksel)
const PALETTE_W: f64 = 640.0;
const PALETTE_H: f64 = 440.0;

// Popup'ı imlecin bulunduğu monitörün sağ altına koyar (görev çubuğunun üstü)
fn place_on_cursor_monitor(win: &WebviewWindow) {
    let (Ok(cur), Ok(size), Ok(cur_scale), Ok(monitors)) = (
        win.cursor_position(),
        win.outer_size(),
        win.scale_factor(),
        win.available_monitors(),
    ) else {
        return;
    };
    let hit = monitors.iter().find(|m| {
        let (p, s) = (m.position(), m.size());
        cur.x >= p.x as f64
            && cur.x < p.x as f64 + s.width as f64
            && cur.y >= p.y as f64
            && cur.y < p.y as f64 + s.height as f64
    });
    let Some(m) = hit.or(monitors.first()) else {
        return;
    };
    let (p, s, scale) = (m.position(), m.size(), m.scale_factor());

    // Pencere boyutu mantıksal ölçüde sabit; farklı ölçekli monitöre geçince fiziksel
    // boyutu değişir, bu yüzden boyutu hedef monitörün ölçeğiyle hesaplıyoruz
    let logical: tauri::LogicalSize<f64> = size.to_logical(cur_scale);
    let w = (logical.width * scale).round() as i32;
    let h = (logical.height * scale).round() as i32;
    let x = p.x + s.width as i32 - w - (12.0 * scale) as i32;
    let y = p.y + s.height as i32 - h - (60.0 * scale) as i32;
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}

fn show_popup(win: &WebviewWindow, from_tray: bool) {
    if !(from_tray && win.move_window(Position::TrayCenter).is_ok()) {
        place_on_cursor_monitor(win);
        // Monitör ölçeği değişince Windows pencereyi yeniden boyutlandırır;
        // boyut oturduktan sonra bir kez daha yerleştir
        let w2 = win.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(90));
            place_on_cursor_monitor(&w2);
        });
    }
    let _ = win.show();
    let _ = win.set_focus();
}

// Paleti imlecin bulunduğu monitörün üst-orta kısmına koyar
fn place_palette(win: &WebviewWindow) {
    let (Ok(cur), Ok(monitors)) = (win.cursor_position(), win.available_monitors()) else {
        return;
    };
    let hit = monitors.iter().find(|m| {
        let (p, s) = (m.position(), m.size());
        cur.x >= p.x as f64
            && cur.x < p.x as f64 + s.width as f64
            && cur.y >= p.y as f64
            && cur.y < p.y as f64 + s.height as f64
    });
    let Some(m) = hit.or(monitors.first()) else {
        return;
    };
    let (p, s, scale) = (m.position(), m.size(), m.scale_factor());
    let w = (PALETTE_W * scale).round() as i32;
    let h = (PALETTE_H * scale).round() as i32;
    let x = p.x + (s.width as i32 - w) / 2;
    let y = p.y + (s.height as f64 * 0.16) as i32;
    let _ = win.set_size(tauri::PhysicalSize::new(w as u32, h as u32));
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}

fn show_palette(win: &WebviewWindow) {
    place_palette(win);
    // Monitör ölçeği değişince Windows pencereyi yeniden boyutlandırır; bir kez daha yerleştir
    let w2 = win.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(90));
        place_palette(&w2);
    });
    let _ = win.show();
    let _ = win.set_focus();
}

// ---------- Ayar dosyası ----------

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

#[tauri::command]
fn load_config(app: AppHandle) -> Result<Option<String>, String> {
    let p = config_path(&app)?;
    match fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn save_config(app: AppHandle, json: String) -> Result<(), String> {
    let p = config_path(&app)?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())?; // Windows'ta var olanın üstüne yazar
    Ok(())
}

// ---------- Token (Windows Credential Manager) ----------

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_token() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn set_token(token: String) -> Result<(), String> {
    entry()?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------- Popup ve palet ----------

#[tauri::command]
fn toggle_popup(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_popup(&w, false);
        }
    }
}

#[tauri::command]
fn set_pinned(pinned: bool) {
    PINNED.store(pinned, Ordering::Relaxed);
}

// Sadece http/https adreslerini varsayılan tarayıcıda açar (HA'da aç düğmesi için)
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Geçersiz adres".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_palette(app: AppHandle) {
    if let Some(w) = app.get_webview_window("palette") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_palette(&w);
        }
    }
}

#[tauri::command]
fn hide_palette(app: AppHandle) {
    if let Some(w) = app.get_webview_window("palette") {
        let _ = w.hide();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                show_popup(&w, false);
            }
        }))
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            get_token,
            set_token,
            delete_token,
            toggle_popup,
            toggle_palette,
            hide_palette,
            set_pinned,
            open_url
        ])
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) => {
                if window.label() == "main" {
                    if PINNED.load(Ordering::Relaxed) {
                        return;
                    }
                    *LAST_HIDE.lock().unwrap() = Some(Instant::now());
                }
                let _ = window.hide();
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .setup(|app| {
            // Komut paleti: açılışta gizli oluşturulur, kısayolla anında görünür
            tauri::WebviewWindowBuilder::new(
                app,
                "palette",
                tauri::WebviewUrl::App("palette".into()),
            )
            .title("HA Palet")
            .inner_size(PALETTE_W, PALETTE_H)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .build()?;

            let open = MenuItem::with_id(app, "open", "Aç", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("HA Desk")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            show_popup(&w, false);
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);

                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                                return;
                            }
                            let just_hidden = LAST_HIDE
                                .lock()
                                .unwrap()
                                .map(|t| t.elapsed() < Duration::from_millis(400))
                                .unwrap_or(false);
                            if !just_hidden {
                                show_popup(&w, true);
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri uygulaması çalıştırılırken hata oluştu");
}
