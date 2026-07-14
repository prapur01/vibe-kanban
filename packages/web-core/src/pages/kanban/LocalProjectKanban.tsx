import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { PlusIcon, TrashIcon } from '@phosphor-icons/react';
import {
  localKanbanApi,
  type LocalKanbanBoardDefinition,
  type LocalKanbanSavedFilter,
  type LocalKanbanSettings,
  type LocalKanbanSubtask,
  type LocalKanbanTask,
  type LocalKanbanTaskInput,
} from '@/shared/lib/api';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { cn } from '@/shared/lib/utils';
import {
  emptyFilter,
  filterTasks,
  groupTasks,
  monthGridDates,
  parseQuickAdd,
  sortTasks,
  todayIso,
} from './localKanbanModel';

const projectQueryKey = ['local-kanban', 'projects'] as const;
const taskQueryKey = (projectId: string) =>
  ['local-kanban', 'tasks', projectId] as const;
const settingsQueryKey = (projectId: string) =>
  ['local-kanban', 'settings', projectId] as const;

const inputClass =
  'rounded border border-border bg-primary px-base py-half text-base text-normal placeholder:text-low focus:outline-none focus:ring-1 focus:ring-brand';
const buttonClass =
  'rounded border border-border bg-secondary px-base py-half text-base text-normal hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50';

function taskInput(
  task: LocalKanbanTask,
  patch: Partial<LocalKanbanTaskInput> = {}
): LocalKanbanTaskInput {
  return {
    title: task.title,
    description: task.description ?? '',
    columnId: task.column_id,
    projectLabel: task.project_label ?? '',
    clientLabel: task.client_label ?? '',
    priority: task.priority ?? '',
    dueDate: task.due_date ?? '',
    dueTime: task.due_time ?? '',
    recurrence: task.recurrence ?? '',
    linkedNote: task.linked_note ?? '',
    cover: task.cover ?? '',
    subtasks: task.subtasks,
    position: task.position,
    ...patch,
  };
}

function colorFor(value: string) {
  let hash = 0;
  for (const character of value)
    hash = character.charCodeAt(0) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360} 55% 45%)`;
}

function dueTone(date: string) {
  const today = todayIso();
  if (date < today) return 'border-error/40 bg-error/10 text-error';
  if (date === today) return 'border-warning/40 bg-warning/10 text-warning';
  return 'border-border bg-panel text-low';
}

function TaskCard({
  task,
  settings,
  onEdit,
  onMove,
  onToggleSubtask,
}: {
  task: LocalKanbanTask;
  settings: LocalKanbanSettings;
  onEdit: () => void;
  onMove: (columnId: string) => void;
  onToggleSubtask: (subtask: LocalKanbanSubtask) => void;
}) {
  const priority = settings.priorities.find(
    (candidate) => candidate.id === task.priority
  );
  const completeSubtasks = task.subtasks.filter(
    (subtask) => subtask.completed
  ).length;

  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/local-kanban-task', task.id);
      }}
      onClick={onEdit}
      className="group cursor-pointer rounded border border-border bg-primary p-base shadow-sm transition hover:border-brand/50 hover:shadow active:cursor-grabbing"
    >
      {task.cover && /^https?:\/\//i.test(task.cover) && (
        <img
          src={task.cover}
          alt=""
          className="mb-base h-28 w-full rounded object-cover"
        />
      )}
      {task.cover && !/^https?:\/\//i.test(task.cover) && (
        <div className="mb-base rounded bg-panel p-half text-center text-sm text-low">
          {task.cover}
        </div>
      )}

      <div className="flex items-start gap-half">
        {priority && (
          <span
            title={priority.name}
            className="mt-1 text-sm font-bold"
            style={{ color: priority.color }}
          >
            {priority.symbol}
          </span>
        )}
        <h3 className="min-w-0 flex-1 text-base font-medium text-high">
          {task.title}
        </h3>
      </div>

      {task.description && (
        <p className="mt-half line-clamp-3 whitespace-pre-wrap text-sm text-low">
          {task.description}
        </p>
      )}

      <div className="mt-base flex flex-wrap gap-half">
        {task.project_label && (
          <span
            className="rounded px-half py-0.5 text-sm text-white"
            style={{
              backgroundColor:
                settings.projects[task.project_label]?.color ??
                colorFor(task.project_label),
            }}
          >
            {task.project_label}
          </span>
        )}
        {task.client_label && (
          <span
            className="rounded border px-half py-0.5 text-sm"
            style={{
              borderColor:
                settings.clients[task.client_label]?.color ??
                colorFor(task.client_label),
              color:
                settings.clients[task.client_label]?.color ??
                colorFor(task.client_label),
            }}
          >
            {task.client_label}
          </span>
        )}
        {task.due_date && (
          <span
            className={cn(
              'rounded border px-half py-0.5 text-sm',
              dueTone(task.due_date)
            )}
          >
            {task.due_date}
            {task.due_time ? ` ${task.due_time}` : ''}
          </span>
        )}
        {task.recurrence && (
          <span className="rounded bg-panel px-half py-0.5 text-sm text-low">
            ↻ {task.recurrence}
          </span>
        )}
        {task.linked_note && (
          <span className="rounded bg-panel px-half py-0.5 text-sm text-low">
            ↗ {task.linked_note}
          </span>
        )}
      </div>

      {task.subtasks.length > 0 && (
        <div className="mt-base border-t border-border pt-half">
          <p className="mb-half text-sm text-low">
            {completeSubtasks}/{task.subtasks.length} subtasks
          </p>
          {task.subtasks.slice(0, 3).map((subtask) => (
            <label
              key={subtask.id}
              className="flex cursor-pointer items-center gap-half py-0.5 text-sm text-normal"
              onClick={(event) => event.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={subtask.completed}
                onChange={() => onToggleSubtask(subtask)}
              />
              <span
                className={cn(subtask.completed && 'line-through text-low')}
              >
                {subtask.title}
              </span>
            </label>
          ))}
        </div>
      )}

      <select
        aria-label={`Status for ${task.title}`}
        value={task.column_id}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onMove(event.target.value)}
        className="mt-base w-full rounded border border-border bg-secondary px-half py-half text-sm text-normal focus:outline-none focus:ring-1 focus:ring-brand"
      >
        {settings.columns.map((column) => (
          <option key={column.id} value={column.id}>
            {column.name}
          </option>
        ))}
      </select>
    </article>
  );
}

function TaskEditor({
  task,
  settings,
  defaultDueDate,
  onClose,
  onSave,
  onDelete,
}: {
  task: LocalKanbanTask | null;
  settings: LocalKanbanSettings;
  defaultDueDate?: string;
  onClose: () => void;
  onSave: (input: LocalKanbanTaskInput) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<LocalKanbanTaskInput>(() =>
    task
      ? taskInput(task)
      : {
          title: '',
          columnId: settings.defaultColumnId,
          dueDate: defaultDueDate ?? '',
          subtasks: [],
        }
  );
  const [subtaskText, setSubtaskText] = useState(() =>
    (draft.subtasks ?? [])
      .map((subtask) => `${subtask.completed ? '[x]' : '[ ]'} ${subtask.title}`)
      .join('\n')
  );

  const field = (key: keyof LocalKanbanTaskInput, value: unknown) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const subtasks = subtaskText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => ({
        id: draft.subtasks?.[index]?.id ?? crypto.randomUUID(),
        completed: /^\[x\]/i.test(line),
        title: line.replace(/^\[[ x]\]\s*/i, '').trim(),
      }));
    if (!draft.title.trim()) return;
    onSave({ ...draft, title: draft.title.trim(), subtasks });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onMouseDown={onClose}
    >
      <form
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col border-l border-border bg-primary shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border p-base">
          <div>
            <p className="text-sm uppercase tracking-wide text-low">
              {task ? 'Edit task' : 'New task'}
            </p>
            <h2 className="text-lg font-semibold text-high">
              {task?.title ?? 'Capture work'}
            </h2>
          </div>
          <button type="button" onClick={onClose} className={buttonClass}>
            Close
          </button>
        </header>

        <div className="flex-1 space-y-base overflow-y-auto p-double">
          <label className="block text-sm text-low">
            Task
            <input
              autoFocus
              value={draft.title}
              onChange={(event) => field('title', event.target.value)}
              className={cn(inputClass, 'mt-half w-full text-lg')}
              placeholder="What needs to happen?"
            />
          </label>
          <label className="block text-sm text-low">
            Description
            <textarea
              value={draft.description ?? ''}
              onChange={(event) => field('description', event.target.value)}
              className={cn(inputClass, 'mt-half min-h-28 w-full')}
            />
          </label>

          <div className="grid grid-cols-2 gap-base">
            <label className="text-sm text-low">
              Column
              <select
                value={draft.columnId}
                onChange={(event) => field('columnId', event.target.value)}
                className={cn(inputClass, 'mt-half w-full')}
              >
                {settings.columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-low">
              Priority
              <select
                value={draft.priority ?? ''}
                onChange={(event) => field('priority', event.target.value)}
                className={cn(inputClass, 'mt-half w-full')}
              >
                <option value="">No priority</option>
                {settings.priorities.map((priority) => (
                  <option key={priority.id} value={priority.id}>
                    {priority.symbol} {priority.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-low">
              Project
              <input
                value={draft.projectLabel ?? ''}
                onChange={(event) => field('projectLabel', event.target.value)}
                className={cn(inputClass, 'mt-half w-full')}
                placeholder="AACR"
              />
            </label>
            <label className="text-sm text-low">
              Client
              <input
                value={draft.clientLabel ?? ''}
                onChange={(event) => field('clientLabel', event.target.value)}
                className={cn(inputClass, 'mt-half w-full')}
              />
            </label>
            <label className="text-sm text-low">
              Due date
              <input
                type="date"
                value={draft.dueDate ?? ''}
                onChange={(event) => field('dueDate', event.target.value)}
                className={cn(inputClass, 'mt-half w-full')}
              />
            </label>
            <label className="text-sm text-low">
              Time
              <input
                type="time"
                value={draft.dueTime ?? ''}
                onChange={(event) => field('dueTime', event.target.value)}
                className={cn(inputClass, 'mt-half w-full')}
              />
            </label>
          </div>

          <label className="block text-sm text-low">
            Recurrence
            <input
              value={draft.recurrence ?? ''}
              onChange={(event) => field('recurrence', event.target.value)}
              className={cn(inputClass, 'mt-half w-full')}
              placeholder="every week or every 2 months"
            />
          </label>
          <label className="block text-sm text-low">
            Linked note / reference
            <input
              value={draft.linkedNote ?? ''}
              onChange={(event) => field('linkedNote', event.target.value)}
              className={cn(inputClass, 'mt-half w-full')}
              placeholder="Document path or URL"
            />
          </label>
          <label className="block text-sm text-low">
            Cover
            <input
              value={draft.cover ?? ''}
              onChange={(event) => field('cover', event.target.value)}
              className={cn(inputClass, 'mt-half w-full')}
              placeholder="Image URL or short cover text"
            />
          </label>
          <label className="block text-sm text-low">
            Subtasks
            <textarea
              value={subtaskText}
              onChange={(event) => setSubtaskText(event.target.value)}
              className={cn(inputClass, 'mt-half min-h-28 w-full font-mono')}
              placeholder={'[ ] First step\n[x] Completed step'}
            />
          </label>
        </div>

        <footer className="flex items-center justify-between border-t border-border p-base">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="rounded px-base py-half text-base text-error hover:bg-error/10"
            >
              Delete task
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={!draft.title.trim()}
            className="rounded bg-brand px-double py-half text-base font-medium text-on-brand hover:bg-brand-hover disabled:opacity-50"
          >
            {task ? 'Save changes' : 'Create task'}
          </button>
        </footer>
      </form>
    </div>
  );
}

function SettingsModal({
  settings,
  onClose,
  onSave,
}: {
  settings: LocalKanbanSettings;
  onClose: () => void;
  onSave: (settings: LocalKanbanSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const set = <K extends keyof LocalKanbanSettings>(
    key: K,
    value: LocalKanbanSettings[K]
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const updateBoard = (
    id: string,
    patch: Partial<LocalKanbanBoardDefinition>
  ) =>
    set(
      'boards',
      draft.boards.map((board) =>
        board.id === id ? { ...board, ...patch } : board
      )
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-double">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded border border-border bg-primary shadow-2xl">
        <header className="flex items-center justify-between border-b border-border p-base">
          <div>
            <p className="text-sm uppercase tracking-wide text-low">
              Local board
            </p>
            <h2 className="text-lg font-semibold text-high">Kanban settings</h2>
          </div>
          <button type="button" onClick={onClose} className={buttonClass}>
            Close
          </button>
        </header>

        <div className="space-y-double overflow-y-auto p-double">
          <section>
            <h3 className="mb-base text-base font-semibold text-high">
              Workflow
            </h3>
            <div className="mb-base grid grid-cols-3 gap-base">
              <label className="text-sm text-low">
                Design
                <select
                  value={draft.designPreset}
                  onChange={(event) =>
                    set(
                      'designPreset',
                      event.target.value as LocalKanbanSettings['designPreset']
                    )
                  }
                  className={cn(inputClass, 'mt-half w-full')}
                >
                  <option value="native">Native Compact</option>
                  <option value="moonlight">Moonlight</option>
                  <option value="trello">Trello Classic</option>
                  <option value="linear">Linear Minimal</option>
                  <option value="notion">Notion Clean</option>
                </select>
              </label>
              {(['defaultColumnId', 'doneColumnId'] as const).map((key) => (
                <label key={key} className="text-sm text-low">
                  {key === 'defaultColumnId' ? 'Default column' : 'Done column'}
                  <select
                    value={draft[key]}
                    onChange={(event) => set(key, event.target.value)}
                    className={cn(inputClass, 'mt-half w-full')}
                  >
                    {draft.columns.map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div className="space-y-half">
              {draft.columns.map((column, index) => (
                <div
                  key={column.id}
                  className="grid grid-cols-[1fr_120px_auto] gap-half"
                >
                  <input
                    value={column.name}
                    onChange={(event) =>
                      set(
                        'columns',
                        draft.columns.map((candidate) =>
                          candidate.id === column.id
                            ? { ...candidate, name: event.target.value }
                            : candidate
                        )
                      )
                    }
                    className={inputClass}
                    aria-label={`Column ${index + 1} name`}
                  />
                  <input
                    type="number"
                    min={0}
                    value={column.wipLimit}
                    onChange={(event) =>
                      set(
                        'columns',
                        draft.columns.map((candidate) =>
                          candidate.id === column.id
                            ? {
                                ...candidate,
                                wipLimit: Number(event.target.value) || 0,
                              }
                            : candidate
                        )
                      )
                    }
                    className={inputClass}
                    aria-label={`${column.name} WIP limit`}
                    placeholder="WIP limit"
                  />
                  <button
                    type="button"
                    disabled={
                      draft.columns.length <= 2 ||
                      column.id === draft.defaultColumnId ||
                      column.id === draft.doneColumnId
                    }
                    onClick={() =>
                      set(
                        'columns',
                        draft.columns.filter(
                          (candidate) => candidate.id !== column.id
                        )
                      )
                    }
                    className={buttonClass}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const id = `column-${Date.now()}`;
                  set('columns', [
                    ...draft.columns,
                    { id, name: 'New column', wipLimit: 0 },
                  ]);
                }}
                className={buttonClass}
              >
                + Add column
              </button>
            </div>
          </section>

          <section className="border-t border-border pt-double">
            <h3 className="mb-base text-base font-semibold text-high">
              Automation
            </h3>
            <div className="grid grid-cols-2 gap-base">
              {(
                [
                  ['autoMoveToday', 'Move tasks due today to In progress'],
                  ['autoMoveOverdue', 'Move overdue tasks to In progress'],
                  ['archiveCompletedTasks', 'Auto-archive old completed tasks'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-half text-base text-normal"
                >
                  <input
                    type="checkbox"
                    checked={draft[key]}
                    onChange={(event) => set(key, event.target.checked)}
                  />
                  {label}
                </label>
              ))}
              <label className="text-sm text-low">
                Archive after days
                <input
                  type="number"
                  min={0}
                  value={draft.archiveCompletedTaskDays}
                  onChange={(event) =>
                    set(
                      'archiveCompletedTaskDays',
                      Number(event.target.value) || 0
                    )
                  }
                  className={cn(inputClass, 'ml-half w-24')}
                />
              </label>
            </div>
          </section>

          <section className="border-t border-border pt-double">
            <h3 className="mb-base text-base font-semibold text-high">
              Boards
            </h3>
            <div className="space-y-base">
              {draft.boards.map((board) => (
                <div
                  key={board.id}
                  className="rounded border border-border bg-secondary p-base"
                >
                  <div className="grid grid-cols-[1fr_180px_auto] gap-half">
                    <input
                      value={board.name}
                      onChange={(event) =>
                        updateBoard(board.id, { name: event.target.value })
                      }
                      className={inputClass}
                      aria-label="Board name"
                    />
                    <select
                      value={board.swimlane}
                      onChange={(event) =>
                        updateBoard(board.id, {
                          swimlane: event.target
                            .value as LocalKanbanBoardDefinition['swimlane'],
                        })
                      }
                      className={inputClass}
                    >
                      <option value="none">No swimlanes</option>
                      <option value="project">Group by project</option>
                      <option value="client">Group by client</option>
                      <option value="priority">Group by priority</option>
                      <option value="due">Group by due date</option>
                    </select>
                    <button
                      type="button"
                      disabled={draft.boards.length === 1}
                      onClick={() => {
                        const boards = draft.boards.filter(
                          (candidate) => candidate.id !== board.id
                        );
                        set('boards', boards);
                        if (draft.activeBoardId === board.id)
                          set('activeBoardId', boards[0].id);
                      }}
                      className={buttonClass}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-half grid grid-cols-2 gap-half">
                    <input
                      value={board.projectScope.join(', ')}
                      onChange={(event) =>
                        updateBoard(board.id, {
                          projectScope: event.target.value
                            .split(',')
                            .map((value) => value.trim())
                            .filter(Boolean),
                        })
                      }
                      className={inputClass}
                      placeholder="Project scope: AACR, DevOps"
                    />
                    <input
                      value={board.clientScope.join(', ')}
                      onChange={(event) =>
                        updateBoard(board.id, {
                          clientScope: event.target.value
                            .split(',')
                            .map((value) => value.trim())
                            .filter(Boolean),
                        })
                      }
                      className={inputClass}
                      placeholder="Client scope"
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const board: LocalKanbanBoardDefinition = {
                    id: crypto.randomUUID(),
                    name: 'New board',
                    projectScope: [],
                    clientScope: [],
                    swimlane: 'project',
                    activeFilterId: '',
                    filters: [],
                  };
                  set('boards', [...draft.boards, board]);
                }}
                className={buttonClass}
              >
                + Add board
              </button>
            </div>
          </section>
        </div>

        <footer className="flex justify-end gap-half border-t border-border p-base">
          <button type="button" onClick={onClose} className={buttonClass}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            className="rounded bg-brand px-double py-half text-base font-medium text-on-brand"
          >
            Save settings
          </button>
        </footer>
      </div>
    </div>
  );
}

function CalendarView({
  tasks,
  onTaskClick,
  onNewTask,
}: {
  tasks: LocalKanbanTask[];
  onTaskClick: (task: LocalKanbanTask) => void;
  onNewTask: (date: string) => void;
}) {
  const [cursor, setCursor] = useState(new Date());
  const [mode, setMode] = useState<'month' | 'week' | 'day'>('month');
  const dates = useMemo(() => {
    if (mode === 'month') return monthGridDates(cursor);
    if (mode === 'day') return [cursor];
    const start = new Date(cursor);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      return date;
    });
  }, [cursor, mode]);

  const move = (direction: number) => {
    const next = new Date(cursor);
    if (mode === 'month') next.setMonth(next.getMonth() + direction);
    else next.setDate(next.getDate() + direction * (mode === 'week' ? 7 : 1));
    setCursor(next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col p-base">
      <div className="mb-base flex items-center justify-between">
        <div className="flex items-center gap-half">
          <button className={buttonClass} onClick={() => move(-1)}>
            Previous
          </button>
          <button className={buttonClass} onClick={() => setCursor(new Date())}>
            Today
          </button>
          <button className={buttonClass} onClick={() => move(1)}>
            Next
          </button>
          <h2 className="ml-base text-lg font-semibold text-high">
            {cursor.toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric',
              day: mode === 'day' ? 'numeric' : undefined,
            })}
          </h2>
        </div>
        <div className="flex gap-half">
          {(['month', 'week', 'day'] as const).map((value) => (
            <button
              key={value}
              className={cn(
                buttonClass,
                mode === value && 'border-brand text-high'
              )}
              onClick={() => setMode(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div
        className={cn(
          'grid min-h-0 flex-1 overflow-y-auto rounded border border-border bg-secondary',
          mode === 'day' ? 'grid-cols-1' : 'grid-cols-7'
        )}
      >
        {dates.map((date) => {
          const iso = todayIso(date);
          const dayTasks = tasks.filter((task) => task.due_date === iso);
          return (
            <section
              key={iso}
              className={cn(
                'min-h-32 border-b border-r border-border p-half',
                mode === 'month' &&
                  date.getMonth() !== cursor.getMonth() &&
                  'opacity-50',
                iso === todayIso() && 'bg-brand/5'
              )}
            >
              <div className="mb-half flex items-center justify-between">
                <span className="text-sm font-medium text-normal">
                  {mode === 'day'
                    ? date.toLocaleDateString(undefined, {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                      })
                    : date.getDate()}
                </span>
                <button
                  onClick={() => onNewTask(iso)}
                  className="rounded px-half text-low hover:bg-panel hover:text-high"
                  aria-label={`Add task on ${iso}`}
                >
                  +
                </button>
              </div>
              <div className="space-y-half">
                {dayTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => onTaskClick(task)}
                    className="block w-full truncate rounded border border-border bg-primary px-half py-half text-left text-sm text-normal hover:border-brand"
                  >
                    {task.due_time && (
                      <span className="mr-half text-low">{task.due_time}</span>
                    )}
                    {task.title}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function LocalProjectKanban() {
  const { projectId } = useParams({ strict: false });
  const appNavigation = useAppNavigation();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'board' | 'calendar'>('board');
  const [quickAdd, setQuickAdd] = useState('');
  const [editingTask, setEditingTask] = useState<
    LocalKanbanTask | 'new' | null
  >(null);
  const [newTaskDueDate, setNewTaskDueDate] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [liveFilter, setLiveFilter] =
    useState<LocalKanbanSavedFilter>(emptyFilter);
  const [draggedOver, setDraggedOver] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: projectQueryKey,
    queryFn: localKanbanApi.listProjects,
  });
  const tasksQuery = useQuery({
    queryKey: taskQueryKey(projectId ?? ''),
    queryFn: () => localKanbanApi.listTasks(projectId!),
    enabled: Boolean(projectId),
  });
  const settingsQuery = useQuery({
    queryKey: settingsQueryKey(projectId ?? ''),
    queryFn: () => localKanbanApi.getSettings(projectId!),
    enabled: Boolean(projectId),
  });

  const projects = projectsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const settings = settingsQuery.data;
  const project = projects.find((candidate) => candidate.id === projectId);
  const activeBoard = settings?.boards.find(
    (board) => board.id === settings.activeBoardId
  );

  useEffect(() => {
    if (!activeBoard) return;
    const saved = activeBoard.filters.find(
      (filter) => filter.id === activeBoard.activeFilterId
    );
    setLiveFilter(saved ?? emptyFilter());
  }, [activeBoard?.id, activeBoard?.activeFilterId]);

  const visibleTasks = useMemo(() => {
    if (!settings || !activeBoard) return [];
    const hasFilter = Boolean(
      liveFilter.text ||
        liveFilter.columnId ||
        liveFilter.project ||
        liveFilter.client ||
        liveFilter.priority ||
        liveFilter.hideDone ||
        liveFilter.due !== 'any'
    );
    return sortTasks(
      filterTasks(
        tasks,
        activeBoard,
        hasFilter ? liveFilter : null,
        settings.doneColumnId
      ),
      settings
    );
  }, [tasks, settings, activeBoard, liveFilter]);

  const invalidateTasks = async () =>
    queryClient.invalidateQueries({ queryKey: taskQueryKey(projectId!) });

  const createTask = useMutation({
    mutationFn: (input: LocalKanbanTaskInput) =>
      localKanbanApi.createTask(projectId!, input),
    onSuccess: async () => {
      setQuickAdd('');
      setEditingTask(null);
      await invalidateTasks();
    },
  });
  const updateTask = useMutation({
    mutationFn: ({
      taskId,
      input,
    }: {
      taskId: string;
      input: LocalKanbanTaskInput;
    }) => localKanbanApi.updateTask(taskId, input),
    onSuccess: async () => {
      setEditingTask(null);
      await invalidateTasks();
    },
  });
  const deleteTask = useMutation({
    mutationFn: localKanbanApi.deleteTask,
    onSuccess: async () => {
      setEditingTask(null);
      await invalidateTasks();
    },
  });
  const updateSettings = useMutation({
    mutationFn: (next: LocalKanbanSettings) =>
      localKanbanApi.updateSettings(projectId!, next),
    onSuccess: (next) => {
      queryClient.setQueryData(settingsQueryKey(projectId!), next);
      setSettingsOpen(false);
    },
  });
  const archiveTasks = useMutation({
    mutationFn: () =>
      localKanbanApi.archiveTasks(
        projectId!,
        settings?.archiveCompletedTaskDays ?? 30
      ),
    onSuccess: invalidateTasks,
  });

  const saveActiveBoard = (patch: Partial<LocalKanbanBoardDefinition>) => {
    if (!settings || !activeBoard) return;
    updateSettings.mutate({
      ...settings,
      boards: settings.boards.map((board) =>
        board.id === activeBoard.id ? { ...board, ...patch } : board
      ),
    });
  };

  if (
    projectsQuery.isLoading ||
    tasksQuery.isLoading ||
    settingsQuery.isLoading
  ) {
    return (
      <div className="flex h-full items-center justify-center bg-primary text-low">
        Loading local board...
      </div>
    );
  }

  if (!projectId || !project || !settings || !activeBoard) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-base bg-primary p-double text-center">
        <h1 className="text-xl font-semibold text-high">
          No local project found
        </h1>
        <p className="max-w-md text-base text-low">
          Add a Git repository in Workspaces first. Each local repository gets
          its own private Kanban board.
        </p>
      </div>
    );
  }

  const lanes = groupTasks(visibleTasks, activeBoard.swimlane);
  const error =
    projectsQuery.error ??
    tasksQuery.error ??
    settingsQuery.error ??
    createTask.error ??
    updateTask.error ??
    updateSettings.error;

  return (
    <main
      data-preset={settings.designPreset}
      className={cn(
        'flex h-full min-h-0 flex-col bg-primary',
        settings.designPreset === 'trello' && 'bg-panel',
        settings.designPreset === 'notion' && 'font-serif'
      )}
    >
      <header className="border-b border-border bg-secondary px-double py-base">
        <div className="flex flex-wrap items-center justify-between gap-base">
          <div className="flex items-center gap-base">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-low">
                Local Kanban
              </p>
              <h1 className="text-xl font-semibold text-high">
                {project.name}
              </h1>
            </div>
            <select
              value={activeBoard.id}
              onChange={(event) =>
                updateSettings.mutate({
                  ...settings,
                  activeBoardId: event.target.value,
                })
              }
              className={inputClass}
              aria-label="Board"
            >
              {settings.boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-half">
            <button
              onClick={() => setView('board')}
              className={cn(
                buttonClass,
                view === 'board' && 'border-brand text-high'
              )}
            >
              Board
            </button>
            <button
              onClick={() => setView('calendar')}
              className={cn(
                buttonClass,
                view === 'calendar' && 'border-brand text-high'
              )}
            >
              Calendar
            </button>
            <button
              onClick={() => setFiltersOpen((open) => !open)}
              className={cn(buttonClass, filtersOpen && 'border-brand')}
            >
              Filters
            </button>
            <button
              onClick={() => archiveTasks.mutate()}
              className={buttonClass}
            >
              Archive done
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className={buttonClass}
            >
              Settings
            </button>
            <select
              aria-label="Local repository"
              value={project.id}
              onChange={(event) =>
                appNavigation.goToProject(event.target.value)
              }
              className={cn(inputClass, 'min-w-40')}
            >
              {projects.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = parseQuickAdd(quickAdd, settings);
            if (parsed.title) createTask.mutate(parsed);
          }}
          className="mt-base flex gap-half"
        >
          <input
            value={quickAdd}
            onChange={(event) => setQuickAdd(event.target.value)}
            placeholder="Quick add: Follow up tomorrow 2pm #project/AACR high"
            aria-label="Quick add task"
            className={cn(inputClass, 'min-w-0 flex-1')}
          />
          <button
            type="submit"
            disabled={!quickAdd.trim() || createTask.isPending}
            className="flex items-center gap-half rounded bg-brand px-base py-half text-base font-medium text-on-brand hover:bg-brand-hover disabled:opacity-50"
          >
            <PlusIcon className="size-icon-sm" weight="bold" />
            Quick add
          </button>
          <button
            type="button"
            onClick={() => {
              setNewTaskDueDate(undefined);
              setEditingTask('new');
            }}
            className={buttonClass}
          >
            Full task
          </button>
        </form>

        {filtersOpen && (
          <div className="mt-base grid grid-cols-2 gap-half rounded border border-border bg-primary p-base md:grid-cols-4 xl:grid-cols-8">
            <input
              value={liveFilter.text}
              onChange={(event) =>
                setLiveFilter((filter) => ({
                  ...filter,
                  text: event.target.value,
                }))
              }
              className={inputClass}
              placeholder="Search"
            />
            {(
              [
                [
                  'columnId',
                  'All columns',
                  settings.columns.map((item) => [item.id, item.name]),
                ],
                [
                  'priority',
                  'All priorities',
                  settings.priorities.map((item) => [item.id, item.name]),
                ],
              ] as const
            ).map(([key, placeholder, options]) => (
              <select
                key={key}
                value={liveFilter[key]}
                onChange={(event) =>
                  setLiveFilter((filter) => ({
                    ...filter,
                    [key]: event.target.value,
                  }))
                }
                className={inputClass}
              >
                <option value="">{placeholder}</option>
                {options.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            ))}
            <input
              value={liveFilter.project}
              onChange={(event) =>
                setLiveFilter((filter) => ({
                  ...filter,
                  project: event.target.value,
                }))
              }
              className={inputClass}
              placeholder="Project"
            />
            <input
              value={liveFilter.client}
              onChange={(event) =>
                setLiveFilter((filter) => ({
                  ...filter,
                  client: event.target.value,
                }))
              }
              className={inputClass}
              placeholder="Client"
            />
            <select
              value={liveFilter.due}
              onChange={(event) =>
                setLiveFilter((filter) => ({
                  ...filter,
                  due: event.target.value as LocalKanbanSavedFilter['due'],
                }))
              }
              className={inputClass}
            >
              <option value="any">Any due date</option>
              <option value="overdue">Overdue</option>
              <option value="today">Today</option>
              <option value="this-week">This week</option>
              <option value="no-date">No date</option>
            </select>
            <label className="flex items-center gap-half px-half text-sm text-normal">
              <input
                type="checkbox"
                checked={liveFilter.hideDone}
                onChange={(event) =>
                  setLiveFilter((filter) => ({
                    ...filter,
                    hideDone: event.target.checked,
                  }))
                }
              />
              Hide done
            </label>
            <div className="flex gap-half">
              <button
                type="button"
                onClick={() => {
                  const saved = {
                    ...liveFilter,
                    id: crypto.randomUUID(),
                    name: `Filter ${activeBoard.filters.length + 1}`,
                  };
                  setLiveFilter(saved);
                  saveActiveBoard({
                    filters: [...activeBoard.filters, saved],
                    activeFilterId: saved.id,
                  });
                }}
                className={buttonClass}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setLiveFilter(emptyFilter());
                  saveActiveBoard({ activeFilterId: '' });
                }}
                className={buttonClass}
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {error && <p className="mt-half text-sm text-error">{String(error)}</p>}
      </header>

      {view === 'calendar' ? (
        <CalendarView
          tasks={visibleTasks}
          onTaskClick={setEditingTask}
          onNewTask={(date) => {
            setNewTaskDueDate(date);
            setEditingTask('new');
          }}
        />
      ) : (
        <section className="min-h-0 flex-1 overflow-auto p-base">
          <div className="space-y-double">
            {lanes.map(([lane, laneTasks]) => (
              <section key={lane || 'all'}>
                {lane && (
                  <h2 className="sticky left-0 mb-half text-base font-semibold uppercase tracking-wide text-low">
                    {lane}
                  </h2>
                )}
                <div className="flex min-w-max gap-base">
                  {settings.columns.map((column) => {
                    const columnTasks = laneTasks.filter(
                      (task) => task.column_id === column.id
                    );
                    const overLimit =
                      column.wipLimit > 0 &&
                      columnTasks.length > column.wipLimit;
                    return (
                      <section
                        key={`${lane}-${column.id}`}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          setDraggedOver(`${lane}-${column.id}`);
                        }}
                        onDragLeave={() => setDraggedOver(null)}
                        onDrop={(event) => {
                          event.preventDefault();
                          setDraggedOver(null);
                          const taskId = event.dataTransfer.getData(
                            'text/local-kanban-task'
                          );
                          const task = tasks.find(
                            (candidate) => candidate.id === taskId
                          );
                          if (task && task.column_id !== column.id)
                            updateTask.mutate({
                              taskId,
                              input: taskInput(task, { columnId: column.id }),
                            });
                        }}
                        className={cn(
                          'flex w-[286px] flex-col rounded border bg-panel transition-colors',
                          draggedOver === `${lane}-${column.id}`
                            ? 'border-brand bg-brand/5'
                            : 'border-border'
                        )}
                      >
                        <div className="flex items-center justify-between border-b border-border px-base py-base">
                          <h3 className="text-base font-semibold text-high">
                            {column.name}
                          </h3>
                          <span
                            className={cn(
                              'rounded bg-secondary px-half py-0.5 text-sm text-low',
                              overLimit && 'bg-error/10 text-error'
                            )}
                            title={overLimit ? 'WIP limit exceeded' : undefined}
                          >
                            {columnTasks.length}
                            {column.wipLimit > 0 ? `/${column.wipLimit}` : ''}
                          </span>
                        </div>
                        <div className="flex min-h-24 flex-1 flex-col gap-half p-half">
                          {columnTasks.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              settings={settings}
                              onEdit={() => setEditingTask(task)}
                              onMove={(columnId) =>
                                updateTask.mutate({
                                  taskId: task.id,
                                  input: taskInput(task, { columnId }),
                                })
                              }
                              onToggleSubtask={(subtask) =>
                                updateTask.mutate({
                                  taskId: task.id,
                                  input: taskInput(task, {
                                    subtasks: task.subtasks.map((candidate) =>
                                      candidate.id === subtask.id
                                        ? {
                                            ...candidate,
                                            completed: !candidate.completed,
                                          }
                                        : candidate
                                    ),
                                  }),
                                })
                              }
                            />
                          ))}
                          {columnTasks.length === 0 && (
                            <button
                              onClick={() => {
                                setNewTaskDueDate(undefined);
                                setEditingTask('new');
                              }}
                              className="flex min-h-20 items-center justify-center rounded border border-dashed border-border text-sm text-low hover:border-brand hover:text-normal"
                            >
                              + Add or drop task
                            </button>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </section>
      )}

      {editingTask && (
        <TaskEditor
          key={editingTask === 'new' ? `new-${newTaskDueDate}` : editingTask.id}
          task={editingTask === 'new' ? null : editingTask}
          settings={settings}
          defaultDueDate={newTaskDueDate}
          onClose={() => setEditingTask(null)}
          onSave={(input) => {
            if (editingTask === 'new') createTask.mutate(input);
            else updateTask.mutate({ taskId: editingTask.id, input });
          }}
          onDelete={
            editingTask === 'new'
              ? undefined
              : () => deleteTask.mutate(editingTask.id)
          }
        />
      )}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => updateSettings.mutate(next)}
        />
      )}
    </main>
  );
}
