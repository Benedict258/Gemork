#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};

const ORCHESTRATOR_HTTP: &str = "http://152.67.149.134:3030";
const ORCHESTRATOR_WS: &str = "ws://152.67.149.134:8081";
const API_KEY: &str = "98124815fa577417ef8a419a61dfddb8";

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

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

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
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(resp) => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            Ok(OrchestratorResponse { success: true, data: Some(data), error: None })
        }
        Err(e) => Ok(OrchestratorResponse {
            success: false,
            data: None,
            error: Some(format!("Orchestrator not reachable: {}", e)),
        }),
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
