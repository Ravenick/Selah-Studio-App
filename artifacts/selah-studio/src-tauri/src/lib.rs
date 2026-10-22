use std::fs;
use tauri::Manager;

fn schedule_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|error| format!("Could not locate Documents: {error}"))?;
    let directory = documents.join("SelahStudio").join("Schedule");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the schedules folder: {error}"))?;
    Ok(directory)
}

fn safe_schedule_name(name: &str) -> String {
    let sanitized: String = name
        .trim()
        .chars()
        .map(|character| {
            if matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '-'
            } else {
                character
            }
        })
        .collect();
    sanitized.trim().trim_end_matches('.').to_string()
}

#[tauri::command]
fn save_schedule(name: String, contents: String, app: tauri::AppHandle) -> Result<String, String> {
    let directory = schedule_directory(&app)?;
    let sanitized = safe_schedule_name(&name);
    let file_name = if sanitized.is_empty() { "Service Schedule" } else { &sanitized };
    let destination = directory.join(format!("{file_name}.selah"));
    fs::write(&destination, contents)
        .map_err(|error| format!("Could not write the schedule file: {error}"))?;

    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
fn create_schedule(name: String, contents: String, app: tauri::AppHandle) -> Result<String, String> {
    let directory = schedule_directory(&app)?;
    let sanitized = safe_schedule_name(&name);
    if sanitized.is_empty() {
        return Err("Enter a schedule name.".into());
    }
    let destination = directory.join(format!("{sanitized}.selah"));
    if destination.exists() {
        return Err("A schedule with that name already exists. Choose another name.".into());
    }
    fs::write(&destination, contents)
        .map_err(|error| format!("Could not write the schedule file: {error}"))?;

    Ok(destination.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![save_schedule, create_schedule])
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                if let Some(projector) = window.app_handle().get_webview_window("projector") {
                    let _ = projector.close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Selah Studio");
}
