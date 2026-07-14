use axum::{
    Json, Router,
    extract::{Path, State},
    response::Json as ResponseJson,
    routing::get,
};
use db::models::{
    project::Project,
    task::{Task, TaskStatus},
};
use deployment::Deployment;
use serde::Deserialize;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize)]
struct CreateTaskRequest {
    title: String,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateTaskRequest {
    title: Option<String>,
    description: Option<String>,
    status: Option<TaskStatus>,
}

fn normalized_title(title: &str) -> Result<&str, ApiError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(ApiError::BadRequest(
            "Task title cannot be empty".to_string(),
        ));
    }
    Ok(title)
}

async fn list_projects(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<Project>>>, ApiError> {
    let projects = Project::find_all(&deployment.db().pool).await?;
    Ok(ResponseJson(ApiResponse::success(projects)))
}

async fn list_tasks(
    Path(project_id): Path<Uuid>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<Task>>>, ApiError> {
    let tasks = Task::find_by_project_id(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(ApiResponse::success(tasks)))
}

async fn create_task(
    Path(project_id): Path<Uuid>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateTaskRequest>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    let title = normalized_title(&payload.title)?;
    let description = payload.description.as_deref().map(str::trim);
    let task = Task::create(&deployment.db().pool, project_id, title, description).await?;
    Ok(ResponseJson(ApiResponse::success(task)))
}

async fn update_task(
    Path(task_id): Path<Uuid>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<UpdateTaskRequest>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    let current = Task::find_by_id(&deployment.db().pool, task_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Task not found".to_string()))?;

    let title = match payload.title {
        Some(title) => normalized_title(&title)?.to_string(),
        None => current.title,
    };
    let description = payload
        .description
        .as_deref()
        .map(str::trim)
        .map(str::to_string)
        .or(current.description);
    let status = payload.status.unwrap_or(current.status);

    let task = Task::update(
        &deployment.db().pool,
        task_id,
        &title,
        description.as_deref(),
        status,
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(task)))
}

async fn delete_task(
    Path(task_id): Path<Uuid>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    Task::delete(&deployment.db().pool, task_id).await?;
    Ok(ResponseJson(ApiResponse::success(())))
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/local-kanban/projects", get(list_projects))
        .route(
            "/local-kanban/projects/{project_id}/tasks",
            get(list_tasks).post(create_task),
        )
        .route(
            "/local-kanban/tasks/{task_id}",
            axum::routing::patch(update_task).delete(delete_task),
        )
}

#[cfg(test)]
mod tests {
    use super::normalized_title;

    #[test]
    fn task_title_must_not_be_blank() {
        assert!(normalized_title("  ").is_err());
        assert_eq!(normalized_title("  ship it  ").unwrap(), "ship it");
    }
}
