#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use tauri::Manager;

const ORCHESTRATOR_HTTP: &str = "http://localhost:3001";
const ORCHESTRATOR_WS: &str = "ws://localhost:8080";

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
    let body = serde_json::json!({
        "type": "goal:submitted",
        "goalText": goal_text,
    });

    let resp = client
        .post(format!("{}/api/goals", ORCHESTRATOR_HTTP))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach orchestrator at {}: {}", ORCHESTRATOR_HTTP, e))?;

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response from orchestrator: {}", e))?;

    Ok(OrchestratorResponse {
        success: true,
        data: Some(data),
        error: None,
    })
}

#[tauri::command]
async fn approve_step(plan_id: String, step_id: String) -> Result<OrchestratorResponse, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "type": "approval:response",
        "planId": plan_id,
        "stepId": step_id,
        "approved": true,
    });

    let resp = client
        .post(format!("{}/api/approval", ORCHESTRATOR_HTTP))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach orchestrator: {}", e))?;

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response from orchestrator: {}", e))?;

    Ok(OrchestratorResponse {
        success: true,
        data: Some(data),
        error: None,
    })
}

#[tauri::command]
async fn reject_step(
    plan_id: String,
    step_id: String,
    reason: Option<String>,
) -> Result<OrchestratorResponse, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "type": "approval:response",
        "planId": plan_id,
        "stepId": step_id,
        "approved": false,
        "reason": reason,
    });

    let resp = client
        .post(format!("{}/api/approval", ORCHESTRATOR_HTTP))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach orchestrator: {}", e))?;

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response from orchestrator: {}", e))?;

    Ok(OrchestratorResponse {
        success: true,
        data: Some(data),
        error: None,
    })
}

#[tauri::command]
async fn get_plans() -> Result<OrchestratorResponse, String> {
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("{}/api/plans", ORCHESTRATOR_HTTP))
        .send()
        .await
        .map_err(|e| format!("Failed to reach orchestrator: {}", e))?;

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response from orchestrator: {}", e))?;

    Ok(OrchestratorResponse {
        success: true,
        data: Some(data),
        error: None,
    })
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
            Ok(OrchestratorResponse {
                success: true,
                data: Some(data),
                error: None,
            })
        }
        Err(e) => Ok(OrchestratorResponse {
            success: false,
            data: None,
            error: Some(format!(
                "Orchestrator not reachable at {}: {}",
                ORCHESTRATOR_HTTP, e
            )),
        }),
    }
}

#[tauri::command]
fn get_ws_url() -> String {
    ORCHESTRATOR_WS.to_string()
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
