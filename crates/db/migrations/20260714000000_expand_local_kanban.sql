ALTER TABLE tasks ADD COLUMN kanban_column_id TEXT NOT NULL DEFAULT 'backlog';
ALTER TABLE tasks ADD COLUMN project_label TEXT;
ALTER TABLE tasks ADD COLUMN client_label TEXT;
ALTER TABLE tasks ADD COLUMN priority TEXT;
ALTER TABLE tasks ADD COLUMN due_date TEXT;
ALTER TABLE tasks ADD COLUMN due_time TEXT;
ALTER TABLE tasks ADD COLUMN recurrence TEXT;
ALTER TABLE tasks ADD COLUMN completed_date TEXT;
ALTER TABLE tasks ADD COLUMN linked_note TEXT;
ALTER TABLE tasks ADD COLUMN cover TEXT;
ALTER TABLE tasks ADD COLUMN subtasks_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN kanban_position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN archived_at TEXT;

UPDATE tasks
SET kanban_column_id = CASE status
    WHEN 'todo' THEN 'todo'
    WHEN 'inprogress' THEN 'doing'
    WHEN 'inreview' THEN 'waiting'
    WHEN 'done' THEN 'done'
    WHEN 'cancelled' THEN 'done'
    ELSE 'backlog'
END;

CREATE TABLE local_kanban_settings (
    project_id    BLOB PRIMARY KEY,
    settings_json TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_tasks_local_kanban
    ON tasks(project_id, archived_at, kanban_column_id, kanban_position);
