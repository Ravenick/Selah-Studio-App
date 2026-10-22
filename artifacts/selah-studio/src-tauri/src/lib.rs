use std::fs;
use tauri::Manager;

#[tauri::command]
fn save_schedule(name: String, contents: String, app: tauri::AppHandle) -> Result<String, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|error| format!("Could not locate Documents: {error}"))?;
    let directory = documents.join("SelahStudio").join("Schedule");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the schedules folder: {error}"))?;

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
    let sanitized = sanitized.trim().trim_end_matches('.');
    let file_name = if sanitized.is_empty() { "Service Schedule" } else { sanitized };
    let destination = directory.join(format!("{file_name}.selah"));
    fs::write(&destination, contents)
        .map_err(|error| format!("Could not write the schedule file: {error}"))?;

    Ok(destination.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![save_schedule])
        .run(tauri::generate_context!())
        .expect("failed to run Selah Studio");
}
