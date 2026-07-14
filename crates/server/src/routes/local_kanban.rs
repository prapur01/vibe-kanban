use axum::{
    Json, Router,
    extract::{Path, State},
    response::Json as ResponseJson,
    routing::get,
};
use chrono::{Duration, Months, NaiveDate, Utc};
use db::models::{
    project::Project,
    task::{LocalKanbanSubtask, LocalKanbanTask, LocalKanbanTaskInput, Task},
};
use deployment::Deployment;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::SqlitePool;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskPayload {
    title: Option<String>,
    description: Option<String>,
    column_id: Option<String>,
    project_label: Option<String>,
    client_label: Option<String>,
    priority: Option<String>,
    due_date: Option<String>,
    due_time: Option<String>,
    recurrence: Option<String>,
    linked_note: Option<String>,
    cover: Option<String>,
    subtasks: Option<Vec<LocalKanbanSubtask>>,
    position: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveRequest {
    older_than_days: Option<i64>,
}

fn default_settings() -> Value {
    json!({
        "designPreset": "linear",
        "columns": [
            { "id": "backlog", "name": "Backlog", "wipLimit": 0 },
            { "id": "todo", "name": "To do", "wipLimit": 0 },
            { "id": "doing", "name": "In progress", "wipLimit": 0 },
            { "id": "waiting", "name": "Waiting for response", "wipLimit": 0 },
            { "id": "done", "name": "Done", "wipLimit": 0 }
        ],
        "defaultColumnId": "backlog",
        "doneColumnId": "done",
        "inProgressColumnId": "doing",
        "autoMoveToday": false,
        "autoMoveOverdue": false,
        "archiveCompletedTasks": true,
        "archiveCompletedTaskDays": 30,
        "priorities": [
            { "id": "highest", "name": "Highest", "symbol": "!!", "color": "#d94b4b" },
            { "id": "high", "name": "High", "symbol": "!", "color": "#e08a2e" },
            { "id": "medium", "name": "Medium", "symbol": "=", "color": "#c9a227" },
            { "id": "low", "name": "Low", "symbol": "-", "color": "#4f9d69" },
            { "id": "lowest", "name": "Lowest", "symbol": "--", "color": "#6f879d" }
        ],
        "projects": {},
        "clients": {},
        "boards": [{
            "id": "default", "name": "All tasks", "projectScope": [],
            "clientScope": [], "swimlane": "none", "activeFilterId": "", "filters": []
        }],
        "activeBoardId": "default"
    })
}

async fn read_settings(pool: &SqlitePool, project_id: Uuid) -> Result<Value, ApiError> {
    let raw = sqlx::query_scalar::<_, String>(
        "SELECT settings_json FROM local_kanban_settings WHERE project_id = ?",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await?;

    match raw {
        Some(raw) => serde_json::from_str(&raw)
            .map_err(|error| ApiError::BadRequest(format!("Invalid Kanban settings: {error}"))),
        None => Ok(default_settings()),
    }
}

async fn write_settings(
    pool: &SqlitePool,
    project_id: Uuid,
    settings: &Value,
) -> Result<(), ApiError> {
    if !settings.is_object() {
        return Err(ApiError::BadRequest(
            "Kanban settings must be an object".to_string(),
        ));
    }
    let raw = serde_json::to_string(settings)
        .map_err(|error| ApiError::BadRequest(format!("Invalid Kanban settings: {error}")))?;
    sqlx::query(
        r#"INSERT INTO local_kanban_settings (project_id, settings_json)
           VALUES (?, ?)
           ON CONFLICT(project_id) DO UPDATE SET
             settings_json = excluded.settings_json,
             updated_at = datetime('now', 'subsec')"#,
    )
    .bind(project_id)
    .bind(raw)
    .execute(pool)
    .await?;
    Ok(())
}

fn trimmed(value: Option<String>, fallback: Option<String>) -> Option<String> {
    match value {
        Some(value) => {
            let value = value.trim().to_string();
            (!value.is_empty()).then_some(value)
        }
        None => fallback,
    }
}

fn normalized_title(title: Option<String>, fallback: Option<String>) -> Result<String, ApiError> {
    let title = title.or(fallback).unwrap_or_default().trim().to_string();
    if title.is_empty() {
        return Err(ApiError::BadRequest(
            "Task title cannot be empty".to_string(),
        ));
    }
    Ok(title)
}

fn task_input(
    payload: TaskPayload,
    current: Option<&LocalKanbanTask>,
    default_column: &str,
    done_column: &str,
) -> Result<LocalKanbanTaskInput, ApiError> {
    let column_id = payload
        .column_id
        .or_else(|| current.map(|task| task.column_id.clone()))
        .unwrap_or_else(|| default_column.to_string());
    let completed_date = if column_id == done_column {
        current
            .and_then(|task| task.completed_date.clone())
            .or_else(|| Some(Utc::now().date_naive().to_string()))
    } else {
        None
    };

    Ok(LocalKanbanTaskInput {
        title: normalized_title(payload.title, current.map(|task| task.title.clone()))?,
        description: trimmed(
            payload.description,
            current.and_then(|task| task.description.clone()),
        ),
        column_id,
        project_label: trimmed(
            payload.project_label,
            current.and_then(|task| task.project_label.clone()),
        ),
        client_label: trimmed(
            payload.client_label,
            current.and_then(|task| task.client_label.clone()),
        ),
        priority: trimmed(
            payload.priority,
            current.and_then(|task| task.priority.clone()),
        ),
        due_date: trimmed(
            payload.due_date,
            current.and_then(|task| task.due_date.clone()),
        ),
        due_time: trimmed(
            payload.due_time,
            current.and_then(|task| task.due_time.clone()),
        ),
        recurrence: trimmed(
            payload.recurrence,
            current.and_then(|task| task.recurrence.clone()),
        ),
        completed_date,
        linked_note: trimmed(
            payload.linked_note,
            current.and_then(|task| task.linked_note.clone()),
        ),
        cover: trimmed(payload.cover, current.and_then(|task| task.cover.clone())),
        subtasks: payload.subtasks.unwrap_or_else(|| {
            current
                .map(|task| task.subtasks.clone())
                .unwrap_or_default()
        }),
        position: payload.position,
    })
}

fn setting_string(settings: &Value, key: &str, fallback: &str) -> String {
    settings
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_string()
}

fn next_recurring_date(date: &str, recurrence: &str) -> Option<String> {
    let mut words = recurrence.to_ascii_lowercase();
    words = words.replace("repeating", "").replace("repeat", "");
    let parts: Vec<_> = words.split_whitespace().collect();
    let every = parts.iter().position(|part| *part == "every")?;
    let amount = parts
        .get(every + 1)
        .and_then(|part| part.parse::<u32>().ok())
        .unwrap_or(1);
    let unit_index = every
        + if parts.get(every + 1)?.parse::<u32>().is_ok() {
            2
        } else {
            1
        };
    let unit = *parts.get(unit_index)?;
    let date = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    let next = match unit.trim_end_matches('s') {
        "day" => date.checked_add_signed(Duration::days(i64::from(amount)))?,
        "week" => date.checked_add_signed(Duration::weeks(i64::from(amount)))?,
        "month" => date.checked_add_months(Months::new(amount))?,
        "year" => date.checked_add_months(Months::new(amount * 12))?,
        _ => return None,
    };
    Some(next.to_string())
}

async fn apply_automatic_rules(
    pool: &SqlitePool,
    project_id: Uuid,
    settings: &Value,
) -> Result<(), ApiError> {
    let today = Utc::now().date_naive().to_string();
    let auto_today = settings
        .get("autoMoveToday")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let auto_overdue = settings
        .get("autoMoveOverdue")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if auto_today || auto_overdue {
        let comparison = match (auto_today, auto_overdue) {
            (true, true) => "<=",
            (true, false) => "=",
            (false, true) => "<",
            _ => unreachable!(),
        };
        let column = setting_string(settings, "inProgressColumnId", "doing");
        let query = format!(
            "UPDATE tasks SET kanban_column_id = ?, status = 'inprogress', updated_at = datetime('now', 'subsec') WHERE project_id = ? AND archived_at IS NULL AND due_date {comparison} ? AND kanban_column_id NOT IN ('done', ?)"
        );
        sqlx::query(&query)
            .bind(&column)
            .bind(project_id)
            .bind(&today)
            .bind(&column)
            .execute(pool)
            .await?;
    }

    if settings
        .get("archiveCompletedTasks")
        .and_then(Value::as_bool)
        .unwrap_or(true)
    {
        let days = settings
            .get("archiveCompletedTaskDays")
            .and_then(Value::as_i64)
            .unwrap_or(30);
        let cutoff = (Utc::now().date_naive() - Duration::days(days)).to_string();
        LocalKanbanTask::archive_completed_before(pool, project_id, &cutoff).await?;
    }
    Ok(())
}

async fn list_projects(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<Project>>>, ApiError> {
    Project::ensure_for_registered_repos(&deployment.db().pool).await?;
    let projects = Project::find_all(&deployment.db().pool).await?;
    Ok(ResponseJson(ApiResponse::success(projects)))
}

async fn get_settings(
    Path(project_id): Path<Uuid>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Value>>, ApiError> {
    let settings = read_settings(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(ApiResponse::success(settings)))
}

async fn update_settings(
    Path(project_id): Path<Uuid>,
    State(deployment): State<DeploymentImpl>,
    Json(settings): Json<Value>,
) -> Result<ResponseJson<ApiResponse<Value>>, ApiError> {
    write_settings(&deployment.db().pool, project_id, &settings).await?;
    Ok(ResponseJson(ApiResponse::success(settings)))
}

async fn list_tasks(
    Path(project_id): Path<Uuid>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<LocalKanbanTask>>>, ApiError> {
    let settings = read_settings(&deployment.db().pool, project_id).await?;
    apply_automatic_rules(&deployment.db().pool, project_id, &settings).await?;
    let tasks = LocalKanbanTask::find_by_project_id(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(ApiResponse::success(tasks)))
}

async fn create_task(
    Path(project_id): Path<Uuid>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<TaskPayload>,
) -> Result<ResponseJson<ApiResponse<LocalKanbanTask>>, ApiError> {
    let settings = read_settings(&deployment.db().pool, project_id).await?;
    let default_column = setting_string(&settings, "defaultColumnId", "backlog");
    let done_column = setting_string(&settings, "doneColumnId", "done");
    let input = task_input(payload, None, &default_column, &done_column)?;
    let task = LocalKanbanTask::create(&deployment.db().pool, project_id, &input).await?;
    Ok(ResponseJson(ApiResponse::success(task)))
}

async fn update_task(
    Path(task_id): Path<Uuid>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<TaskPayload>,
) -> Result<ResponseJson<ApiResponse<LocalKanbanTask>>, ApiError> {
    let current = LocalKanbanTask::find_by_id(&deployment.db().pool, task_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Task not found".to_string()))?;
    let settings = read_settings(&deployment.db().pool, current.project_id).await?;
    let default_column = setting_string(&settings, "defaultColumnId", "backlog");
    let done_column = setting_string(&settings, "doneColumnId", "done");
    let transitioned_to_done = current.column_id != done_column
        && payload.column_id.as_deref() == Some(done_column.as_str());
    let input = task_input(payload, Some(&current), &default_column, &done_column)?;
    let task = LocalKanbanTask::update(&deployment.db().pool, task_id, &input).await?;

    if transitioned_to_done
        && let (Some(date), Some(recurrence)) = (&current.due_date, &current.recurrence)
        && let Some(next_date) = next_recurring_date(date, recurrence)
    {
        let recurring = LocalKanbanTaskInput {
            title: current.title,
            description: current.description,
            column_id: default_column,
            project_label: current.project_label,
            client_label: current.client_label,
            priority: current.priority,
            due_date: Some(next_date),
            due_time: current.due_time,
            recurrence: current.recurrence,
            completed_date: None,
            linked_note: current.linked_note,
            cover: current.cover,
            subtasks: current
                .subtasks
                .into_iter()
                .map(|mut subtask| {
                    subtask.completed = false;
                    subtask
                })
                .collect(),
            position: None,
        };
        LocalKanbanTask::create(&deployment.db().pool, current.project_id, &recurring).await?;
    }

    Ok(ResponseJson(ApiResponse::success(task)))
}

async fn delete_task(
    Path(task_id): Path<Uuid>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    Task::delete(&deployment.db().pool, task_id).await?;
    Ok(ResponseJson(ApiResponse::success(())))
}

async fn archive_tasks(
    Path(project_id): Path<Uuid>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<ArchiveRequest>,
) -> Result<ResponseJson<ApiResponse<u64>>, ApiError> {
    let days = payload.older_than_days.unwrap_or(30).max(0);
    let cutoff = (Utc::now().date_naive() - Duration::days(days)).to_string();
    let count =
        LocalKanbanTask::archive_completed_before(&deployment.db().pool, project_id, &cutoff)
            .await?;
    Ok(ResponseJson(ApiResponse::success(count)))
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/local-kanban/projects", get(list_projects))
        .route(
            "/local-kanban/projects/{project_id}/settings",
            get(get_settings).put(update_settings),
        )
        .route(
            "/local-kanban/projects/{project_id}/tasks",
            get(list_tasks).post(create_task),
        )
        .route(
            "/local-kanban/projects/{project_id}/archive",
            axum::routing::post(archive_tasks),
        )
        .route(
            "/local-kanban/tasks/{task_id}",
            axum::routing::patch(update_task).delete(delete_task),
        )
}

#[cfg(test)]
mod tests {
    use super::{next_recurring_date, normalized_title};

    #[test]
    fn task_title_must_not_be_blank() {
        assert!(normalized_title(Some("  ".to_string()), None).is_err());
        assert_eq!(
            normalized_title(Some("  ship it  ".to_string()), None).unwrap(),
            "ship it"
        );
    }

    #[test]
    fn recurrence_advances_the_due_date() {
        assert_eq!(
            next_recurring_date("2026-07-14", "every 2 weeks").as_deref(),
            Some("2026-07-28")
        );
        assert_eq!(
            next_recurring_date("2026-01-31", "every month").as_deref(),
            Some("2026-02-28")
        );
    }
}
