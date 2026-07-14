use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::repo::Repo;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub default_agent_working_dir: Option<String>,
    pub remote_project_id: Option<Uuid>,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

impl Project {
    pub async fn ensure_for_registered_repos(pool: &SqlitePool) -> Result<(), sqlx::Error> {
        let repos = Repo::list_all(pool).await?;
        let mut transaction = pool.begin().await?;

        for repo in repos {
            let project_count = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM project_repos WHERE repo_id = ?",
            )
            .bind(repo.id)
            .fetch_one(&mut *transaction)
            .await?;

            if project_count > 0 {
                continue;
            }

            let project_id = Uuid::new_v4();
            sqlx::query("INSERT INTO projects (id, name) VALUES (?, ?)")
                .bind(project_id)
                .bind(&repo.display_name)
                .execute(&mut *transaction)
                .await?;
            sqlx::query("INSERT INTO project_repos (id, project_id, repo_id) VALUES (?, ?, ?)")
                .bind(Uuid::new_v4())
                .bind(project_id)
                .bind(repo.id)
                .execute(&mut *transaction)
                .await?;
        }

        transaction.commit().await
    }

    pub async fn find_all(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            Project,
            r#"SELECT id as "id!: Uuid",
                      name,
                      default_agent_working_dir,
                      remote_project_id as "remote_project_id: Uuid",
                      created_at as "created_at!: DateTime<Utc>",
                      updated_at as "updated_at!: DateTime<Utc>"
               FROM projects
               ORDER BY created_at DESC"#
        )
        .fetch_all(pool)
        .await
    }

    pub async fn set_remote_project_id(
        pool: &SqlitePool,
        id: Uuid,
        remote_project_id: Option<Uuid>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"UPDATE projects
               SET remote_project_id = $2
               WHERE id = $1"#,
            id,
            remote_project_id
        )
        .execute(pool)
        .await?;

        Ok(())
    }
}
