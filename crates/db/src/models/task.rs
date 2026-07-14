use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use strum_macros::{Display, EnumString};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct LocalKanbanSubtask {
    pub id: String,
    pub title: String,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct LocalKanbanTask {
    pub id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub column_id: String,
    pub project_label: Option<String>,
    pub client_label: Option<String>,
    pub priority: Option<String>,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub recurrence: Option<String>,
    pub completed_date: Option<String>,
    pub linked_note: Option<String>,
    pub cover: Option<String>,
    pub subtasks: Vec<LocalKanbanSubtask>,
    pub position: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct LocalKanbanTaskInput {
    pub title: String,
    pub description: Option<String>,
    pub column_id: String,
    pub project_label: Option<String>,
    pub client_label: Option<String>,
    pub priority: Option<String>,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub recurrence: Option<String>,
    pub completed_date: Option<String>,
    pub linked_note: Option<String>,
    pub cover: Option<String>,
    pub subtasks: Vec<LocalKanbanSubtask>,
    pub position: Option<i64>,
}

#[derive(Debug, FromRow)]
struct LocalKanbanTaskRow {
    id: Uuid,
    project_id: Uuid,
    title: String,
    description: Option<String>,
    kanban_column_id: String,
    project_label: Option<String>,
    client_label: Option<String>,
    priority: Option<String>,
    due_date: Option<String>,
    due_time: Option<String>,
    recurrence: Option<String>,
    completed_date: Option<String>,
    linked_note: Option<String>,
    cover: Option<String>,
    subtasks_json: String,
    kanban_position: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<LocalKanbanTaskRow> for LocalKanbanTask {
    fn from(row: LocalKanbanTaskRow) -> Self {
        Self {
            id: row.id,
            project_id: row.project_id,
            title: row.title,
            description: row.description,
            column_id: row.kanban_column_id,
            project_label: row.project_label,
            client_label: row.client_label,
            priority: row.priority,
            due_date: row.due_date,
            due_time: row.due_time,
            recurrence: row.recurrence,
            completed_date: row.completed_date,
            linked_note: row.linked_note,
            cover: row.cover,
            subtasks: serde_json::from_str(&row.subtasks_json).unwrap_or_default(),
            position: row.kanban_position,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(
    Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS, EnumString, Display, Default,
)]
#[sqlx(type_name = "task_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum TaskStatus {
    #[default]
    Todo,
    InProgress,
    InReview,
    Done,
    Cancelled,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Task {
    pub id: Uuid,
    pub project_id: Uuid, // Foreign key to Project
    pub title: String,
    pub description: Option<String>,
    pub status: TaskStatus,
    pub parent_workspace_id: Option<Uuid>, // Foreign key to parent Workspace
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Task {
    pub async fn find_all(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            Task,
            r#"SELECT id as "id!: Uuid", project_id as "project_id!: Uuid", title, description, status as "status!: TaskStatus", parent_workspace_id as "parent_workspace_id: Uuid", created_at as "created_at!: DateTime<Utc>", updated_at as "updated_at!: DateTime<Utc>"
               FROM tasks
               ORDER BY created_at ASC"#
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            Task,
            r#"SELECT id as "id!: Uuid", project_id as "project_id!: Uuid", title, description, status as "status!: TaskStatus", parent_workspace_id as "parent_workspace_id: Uuid", created_at as "created_at!: DateTime<Utc>", updated_at as "updated_at!: DateTime<Utc>"
               FROM tasks
               WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_project_id(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Task>(
            r#"SELECT id, project_id, title, description, status, parent_workspace_id,
                      created_at, updated_at
               FROM tasks
               WHERE project_id = ?
               ORDER BY created_at ASC"#,
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        project_id: Uuid,
        title: &str,
        description: Option<&str>,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();

        sqlx::query(
            r#"INSERT INTO tasks (id, project_id, title, description, status)
               VALUES (?, ?, ?, ?, ?)"#,
        )
        .bind(id)
        .bind(project_id)
        .bind(title)
        .bind(description)
        .bind(TaskStatus::Todo)
        .execute(pool)
        .await?;

        Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        title: &str,
        description: Option<&str>,
        status: TaskStatus,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query(
            r#"UPDATE tasks
               SET title = ?, description = ?, status = ?,
                   updated_at = datetime('now', 'subsec')
               WHERE id = ?"#,
        )
        .bind(title)
        .bind(description)
        .bind(status)
        .bind(id)
        .execute(pool)
        .await?;

        Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<(), sqlx::Error> {
        let result = sqlx::query("DELETE FROM tasks WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }

        Ok(())
    }
}

impl LocalKanbanTask {
    const SELECT: &'static str = r#"SELECT id, project_id, title, description,
        kanban_column_id, project_label, client_label, priority, due_date,
        due_time, recurrence, completed_date, linked_note, cover, subtasks_json,
        kanban_position, created_at, updated_at FROM tasks"#;

    pub async fn find_by_project_id(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        let query = format!(
            "{} WHERE project_id = ? AND archived_at IS NULL ORDER BY kanban_position, created_at",
            Self::SELECT
        );
        let rows = sqlx::query_as::<_, LocalKanbanTaskRow>(&query)
            .bind(project_id)
            .fetch_all(pool)
            .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        let query = format!("{} WHERE id = ?", Self::SELECT);
        let row = sqlx::query_as::<_, LocalKanbanTaskRow>(&query)
            .bind(id)
            .fetch_optional(pool)
            .await?;
        Ok(row.map(Into::into))
    }

    pub async fn create(
        pool: &SqlitePool,
        project_id: Uuid,
        input: &LocalKanbanTaskInput,
    ) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        let position =
            match input.position {
                Some(position) => position,
                None => sqlx::query_scalar::<_, i64>(
                    "SELECT COALESCE(MAX(kanban_position), -1) + 1 FROM tasks WHERE project_id = ?",
                )
                .bind(project_id)
                .fetch_one(pool)
                .await?,
            };
        let subtasks_json = serde_json::to_string(&input.subtasks)
            .map_err(|error| sqlx::Error::Encode(Box::new(error)))?;
        let status = core_status_for_column(&input.column_id);

        sqlx::query(
            r#"INSERT INTO tasks (
                id, project_id, title, description, status, kanban_column_id,
                project_label, client_label, priority, due_date, due_time,
                recurrence, completed_date, linked_note, cover, subtasks_json,
                kanban_position
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(id)
        .bind(project_id)
        .bind(&input.title)
        .bind(&input.description)
        .bind(status)
        .bind(&input.column_id)
        .bind(&input.project_label)
        .bind(&input.client_label)
        .bind(&input.priority)
        .bind(&input.due_date)
        .bind(&input.due_time)
        .bind(&input.recurrence)
        .bind(&input.completed_date)
        .bind(&input.linked_note)
        .bind(&input.cover)
        .bind(subtasks_json)
        .bind(position)
        .execute(pool)
        .await?;

        Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        input: &LocalKanbanTaskInput,
    ) -> Result<Self, sqlx::Error> {
        let subtasks_json = serde_json::to_string(&input.subtasks)
            .map_err(|error| sqlx::Error::Encode(Box::new(error)))?;
        let status = core_status_for_column(&input.column_id);

        sqlx::query(
            r#"UPDATE tasks SET title = ?, description = ?, status = ?,
                kanban_column_id = ?, project_label = ?, client_label = ?,
                priority = ?, due_date = ?, due_time = ?, recurrence = ?,
                completed_date = ?, linked_note = ?, cover = ?, subtasks_json = ?,
                kanban_position = COALESCE(?, kanban_position),
                updated_at = datetime('now', 'subsec')
               WHERE id = ?"#,
        )
        .bind(&input.title)
        .bind(&input.description)
        .bind(status)
        .bind(&input.column_id)
        .bind(&input.project_label)
        .bind(&input.client_label)
        .bind(&input.priority)
        .bind(&input.due_date)
        .bind(&input.due_time)
        .bind(&input.recurrence)
        .bind(&input.completed_date)
        .bind(&input.linked_note)
        .bind(&input.cover)
        .bind(subtasks_json)
        .bind(input.position)
        .bind(id)
        .execute(pool)
        .await?;

        Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    pub async fn archive_completed_before(
        pool: &SqlitePool,
        project_id: Uuid,
        cutoff: &str,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"UPDATE tasks SET archived_at = datetime('now', 'subsec')
               WHERE project_id = ? AND kanban_column_id = 'done'
                 AND completed_date IS NOT NULL AND completed_date <= ?
                 AND archived_at IS NULL"#,
        )
        .bind(project_id)
        .bind(cutoff)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }
}

fn core_status_for_column(column_id: &str) -> &'static str {
    match column_id {
        "doing" => "inprogress",
        "waiting" => "inreview",
        "done" => "done",
        _ => "todo",
    }
}
