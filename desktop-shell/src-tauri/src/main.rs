#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::process::Command;

const ORCHESTRATOR_HTTP: &str = "http://localhost:5180";
const ORCHESTRATOR_WS: &str = "ws://localhost:5180";
const API_KEY: &str = "dd8168e51c495feeb21733c29d89b12c";

#[derive(Debug, Serialize, Deserialize)]
struct OrchestratorResponse {
    success: bool,
    data: Option<serde_json::Value>,
    error: Option<String>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Gemork.", name)
}

#[tauri::command]
async fn submit_goal(goal_text: String) -> Result<OrchestratorResponse, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({ "text": goal_text });

    let resp = client
        .post(format!("{}/api/goals", ORCHESTRATOR_HTTP))
        .header("X-API-Key", API_KEY)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach orchestrator: {}", e))?;

    let data: serde_json::Value = resp.json().await.map_err(|e| format!("Invalid response: {}", e))?;
    Ok(OrchestratorResponse { success: true, data: Some(data), error: None })
}

#[tauri::command]
async fn approve_step(plan_id: String, step_id: String) -> Result<OrchestratorResponse, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/plans/{}/steps/{}/approve", ORCHESTRATOR_HTTP, plan_id, step_id))
        .header("X-API-Key", API_KEY)
        .send()
        .await
        .map_err(|e| format!("Failed: {}", e))?;
    let data: serde_json::Value = resp.json().await.unwrap_or_default();
    Ok(OrchestratorResponse { success: true, data: Some(data), error: None })
}

#[tauri::command]
async fn reject_step(plan_id: String, step_id: String, _reason: Option<String>) -> Result<OrchestratorResponse, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/plans/{}/steps/{}/reject", ORCHESTRATOR_HTTP, plan_id, step_id))
        .header("X-API-Key", API_KEY)
        .send()
        .await
        .map_err(|e| format!("Failed: {}", e))?;
    let data: serde_json::Value = resp.json().await.unwrap_or_default();
    Ok(OrchestratorResponse { success: true, data: Some(data), error: None })
}

#[tauri::command]
async fn get_plans() -> Result<OrchestratorResponse, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/api/plans", ORCHESTRATOR_HTTP))
        .header("X-API-Key", API_KEY)
        .send()
        .await
        .map_err(|e| format!("Failed: {}", e))?;
    let data: serde_json::Value = resp.json().await.unwrap_or_default();
    Ok(OrchestratorResponse { success: true, data: Some(data), error: None })
}

#[tauri::command]
async fn check_orchestrator() -> Result<OrchestratorResponse, String> {
    let client = reqwest::Client::new();
    match client
        .get(format!("{}/api/health", ORCHESTRATOR_HTTP))
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
    {
        Ok(resp) => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            Ok(OrchestratorResponse { success: true, data: Some(data), error: None })
        }
        Err(e) => Ok(OrchestratorResponse { success: false, data: None, error: Some(format!("Not reachable: {}", e)) }),
    }
}

#[tauri::command]
fn get_ws_url() -> String {
    format!("{}?key={}", ORCHESTRATOR_WS, API_KEY)
}

#[tauri::command]
fn get_api_key() -> String {
    API_KEY.to_string()
}

#[tauri::command]
fn get_api_url() -> String {
    ORCHESTRATOR_HTTP.to_string()
}

// ── Desktop Control Commands ──────────────────────────────────

#[tauri::command]
fn execute_command(command: String) -> Result<OrchestratorResponse, String> {
    let output = if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", &command]).output()
    } else {
        Command::new("sh").args(["-c", &command]).output()
    };

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            Ok(OrchestratorResponse {
                success: output.status.success(),
                data: Some(serde_json::json!({
                    "stdout": stdout,
                    "stderr": stderr,
                    "exitCode": output.status.code()
                })),
                error: if !output.status.success() { Some(stderr) } else { None },
            })
        }
        Err(e) => Ok(OrchestratorResponse { success: false, data: None, error: Some(format!("Failed to execute: {}", e)) }),
    }
}

#[tauri::command]
fn open_application(app_name: String) -> Result<OrchestratorResponse, String> {
    let result = if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", &app_name]).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg("-a").arg(&app_name).spawn()
    } else {
        Command::new("xdg-open").arg(&app_name).spawn()
    };

    match result {
        Ok(_) => Ok(OrchestratorResponse { success: true, data: Some(serde_json::json!({"opened": app_name})), error: None }),
        Err(e) => Ok(OrchestratorResponse { success: false, data: None, error: Some(format!("Failed to open {}: {}", app_name, e)) }),
    }
}

#[tauri::command]
fn open_file(file_path: String) -> Result<OrchestratorResponse, String> {
    let result = if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", &file_path]).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&file_path).spawn()
    } else {
        Command::new("xdg-open").arg(&file_path).spawn()
    };

    match result {
        Ok(_) => Ok(OrchestratorResponse { success: true, data: Some(serde_json::json!({"opened": file_path})), error: None }),
        Err(e) => Ok(OrchestratorResponse { success: false, data: None, error: Some(format!("Failed to open: {}", e)) }),
    }
}

#[tauri::command]
fn list_directory(path: String) -> Result<OrchestratorResponse, String> {
    match std::fs::read_dir(&path) {
        Ok(entries) => {
            let items: Vec<serde_json::Value> = entries
                .filter_map(|e| e.ok())
                .map(|e| {
                    let file_type = e.file_type().map(|t| if t.is_dir() { "dir" } else { "file" }).unwrap_or("unknown");
                    serde_json::json!({
                        "name": e.file_name().to_string_lossy(),
                        "type": file_type,
                        "path": e.path().to_string_lossy()
                    })
                })
                .collect();
            Ok(OrchestratorResponse { success: true, data: Some(serde_json::json!({"items": items})), error: None })
        }
        Err(e) => Ok(OrchestratorResponse { success: false, data: None, error: Some(format!("Failed to list: {}", e)) }),
    }
}

#[tauri::command]
fn read_file(file_path: String) -> Result<OrchestratorResponse, String> {
    match std::fs::read_to_string(&file_path) {
        Ok(content) => Ok(OrchestratorResponse { success: true, data: Some(serde_json::json!({"content": content})), error: None }),
        Err(e) => Ok(OrchestratorResponse { success: false, data: None, error: Some(format!("Failed to read: {}", e)) }),
    }
}

#[tauri::command]
fn write_file(file_path: String, content: String) -> Result<OrchestratorResponse, String> {
    // Create snapshot before writing
    let snapshot_dir = std::path::Path::new(".gemork/history/desktop");
    let _ = std::fs::create_dir_all(snapshot_dir);

    if let Ok(existing) = std::fs::read(&file_path) {
        let snapshot_name = format!("{}_{}", chrono_filename(), std::path::Path::new(&file_path).file_name().unwrap_or_default().to_string_lossy());
        let _ = std::fs::write(snapshot_dir.join(&snapshot_name), existing);
    }

    match std::fs::write(&file_path, &content) {
        Ok(_) => Ok(OrchestratorResponse { success: true, data: Some(serde_json::json!({"written": file_path})), error: None }),
        Err(e) => Ok(OrchestratorResponse { success: false, data: None, error: Some(format!("Failed to write: {}", e)) }),
    }
}

fn chrono_filename() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", now)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            submit_goal,
            approve_step,
            reject_step,
            get_plans,
            check_orchestrator,
            get_ws_url,
            get_api_key,
            get_api_url,
            execute_command,
            open_application,
            open_file,
            list_directory,
            read_file,
            write_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
