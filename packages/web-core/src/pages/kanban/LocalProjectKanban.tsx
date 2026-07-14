import {
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
  type LocalKanbanTask,
  type LocalTaskStatus,
} from '@/shared/lib/api';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { cn } from '@/shared/lib/utils';

const COLUMNS: Array<{
  status: LocalTaskStatus;
  label: string;
  accent: string;
}> = [
  { status: 'todo', label: 'Todo', accent: 'bg-low' },
  { status: 'inprogress', label: 'In progress', accent: 'bg-brand' },
  { status: 'inreview', label: 'In review', accent: 'bg-warning' },
  { status: 'done', label: 'Done', accent: 'bg-success' },
  { status: 'cancelled', label: 'Cancelled', accent: 'bg-error' },
];

const projectQueryKey = ['local-kanban', 'projects'] as const;
const taskQueryKey = (projectId: string) =>
  ['local-kanban', 'tasks', projectId] as const;

function TaskCard({
  task,
  onMove,
  onDelete,
}: {
  task: LocalKanbanTask;
  onMove: (taskId: string, status: LocalTaskStatus) => void;
  onDelete: (taskId: string) => void;
}) {
  const handleDragStart = (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/local-kanban-task', task.id);
  };

  return (
    <article
      draggable
      onDragStart={handleDragStart}
      className="group cursor-grab rounded border border-border bg-secondary p-base shadow-sm active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-base">
        <h3 className="min-w-0 flex-1 text-base font-medium text-high">
          {task.title}
        </h3>
        <button
          type="button"
          aria-label={`Delete ${task.title}`}
          onClick={() => onDelete(task.id)}
          className="text-low opacity-0 transition-opacity hover:text-error group-hover:opacity-100 focus:opacity-100"
        >
          <TrashIcon className="size-icon-sm" />
        </button>
      </div>

      {task.description && (
        <p className="mt-half line-clamp-3 whitespace-pre-wrap text-sm text-low">
          {task.description}
        </p>
      )}

      <select
        aria-label={`Status for ${task.title}`}
        value={task.status}
        onChange={(event) =>
          onMove(task.id, event.target.value as LocalTaskStatus)
        }
        className="mt-base w-full rounded border border-border bg-primary px-half py-half text-sm text-normal focus:outline-none focus:ring-1 focus:ring-brand"
      >
        {COLUMNS.map((column) => (
          <option key={column.status} value={column.status}>
            {column.label}
          </option>
        ))}
      </select>
    </article>
  );
}

export function LocalProjectKanban() {
  const { projectId } = useParams({ strict: false });
  const appNavigation = useAppNavigation();
  const queryClient = useQueryClient();
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [draggedOverStatus, setDraggedOverStatus] =
    useState<LocalTaskStatus | null>(null);

  const projectsQuery = useQuery({
    queryKey: projectQueryKey,
    queryFn: localKanbanApi.listProjects,
  });
  const tasksQuery = useQuery({
    queryKey: taskQueryKey(projectId ?? ''),
    queryFn: () => localKanbanApi.listTasks(projectId!),
    enabled: Boolean(projectId),
  });

  const projects = projectsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const project = projects.find((candidate) => candidate.id === projectId);

  const tasksByStatus = useMemo(() => {
    const grouped = new Map<LocalTaskStatus, LocalKanbanTask[]>();
    for (const column of COLUMNS) grouped.set(column.status, []);
    for (const task of tasks) grouped.get(task.status)?.push(task);
    return grouped;
  }, [tasks]);

  const createTask = useMutation({
    mutationFn: (title: string) =>
      localKanbanApi.createTask(projectId!, { title }),
    onSuccess: async () => {
      setNewTaskTitle('');
      await queryClient.invalidateQueries({ queryKey: taskQueryKey(projectId!) });
    },
  });

  const updateTask = useMutation({
    mutationFn: ({
      taskId,
      status,
    }: {
      taskId: string;
      status: LocalTaskStatus;
    }) => localKanbanApi.updateTask(taskId, { status }),
    onMutate: async ({ taskId, status }) => {
      const key = taskQueryKey(projectId!);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<LocalKanbanTask[]>(key);
      queryClient.setQueryData<LocalKanbanTask[]>(key, (current = []) =>
        current.map((task) => (task.id === taskId ? { ...task, status } : task))
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(taskQueryKey(projectId!), context.previous);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKey(projectId!) });
    },
  });

  const deleteTask = useMutation({
    mutationFn: localKanbanApi.deleteTask,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKey(projectId!) });
    },
  });

  const handleCreateTask = (event: FormEvent) => {
    event.preventDefault();
    const title = newTaskTitle.trim();
    if (!title || !projectId || createTask.isPending) return;
    createTask.mutate(title);
  };

  const handleDrop = (
    event: DragEvent<HTMLElement>,
    status: LocalTaskStatus
  ) => {
    event.preventDefault();
    setDraggedOverStatus(null);
    const taskId = event.dataTransfer.getData('text/local-kanban-task');
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.status === status) return;
    updateTask.mutate({ taskId, status });
  };

  if (projectsQuery.isLoading || tasksQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-primary text-low">
        Loading local board...
      </div>
    );
  }

  if (!projectId || !project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-base bg-primary p-double text-center">
        <h1 className="text-xl font-semibold text-high">No local project found</h1>
        <p className="max-w-md text-base text-low">
          Add a Git repository in Workspaces first. Each local repository gets
          its own private Kanban board.
        </p>
      </div>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-primary">
      <header className="border-b border-border bg-secondary px-double py-base">
        <div className="flex flex-wrap items-center justify-between gap-base">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-low">
              Local Kanban
            </p>
            <h1 className="text-xl font-semibold text-high">{project.name}</h1>
          </div>

          <select
            aria-label="Local project"
            value={project.id}
            onChange={(event) => appNavigation.goToProject(event.target.value)}
            className="min-w-48 rounded border border-border bg-primary px-base py-half text-base text-normal focus:outline-none focus:ring-1 focus:ring-brand"
          >
            {projects.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={handleCreateTask} className="mt-base flex gap-half">
          <input
            value={newTaskTitle}
            onChange={(event) => setNewTaskTitle(event.target.value)}
            placeholder="Add a task..."
            aria-label="Task title"
            className="min-w-0 flex-1 rounded border border-border bg-primary px-base py-half text-base text-normal placeholder:text-low focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <button
            type="submit"
            disabled={!newTaskTitle.trim() || createTask.isPending}
            className="flex items-center gap-half rounded bg-brand px-base py-half text-base font-medium text-on-brand hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusIcon className="size-icon-sm" weight="bold" />
            Add task
          </button>
        </form>

        {(projectsQuery.error || tasksQuery.error || createTask.error) && (
          <p className="mt-half text-sm text-error">
            {String(
              projectsQuery.error ?? tasksQuery.error ?? createTask.error
            )}
          </p>
        )}
      </header>

      <section className="min-h-0 flex-1 overflow-x-auto p-base">
        <div className="flex h-full min-w-max gap-base">
          {COLUMNS.map((column) => {
            const columnTasks = tasksByStatus.get(column.status) ?? [];
            const isDragTarget = draggedOverStatus === column.status;

            return (
              <section
                key={column.status}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDraggedOverStatus(column.status);
                }}
                onDragLeave={() => setDraggedOverStatus(null)}
                onDrop={(event) => handleDrop(event, column.status)}
                className={cn(
                  'flex w-[280px] flex-col rounded border bg-panel transition-colors',
                  isDragTarget ? 'border-brand bg-brand/5' : 'border-border'
                )}
              >
                <div className="flex items-center justify-between border-b border-border px-base py-base">
                  <div className="flex items-center gap-half">
                    <span className={cn('size-2 rounded-full', column.accent)} />
                    <h2 className="text-base font-semibold text-high">
                      {column.label}
                    </h2>
                  </div>
                  <span className="rounded bg-secondary px-half py-0.5 text-sm text-low">
                    {columnTasks.length}
                  </span>
                </div>

                <div className="flex min-h-24 flex-1 flex-col gap-half overflow-y-auto p-half">
                  {columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onMove={(taskId, status) =>
                        updateTask.mutate({ taskId, status })
                      }
                      onDelete={(taskId) => deleteTask.mutate(taskId)}
                    />
                  ))}
                  {columnTasks.length === 0 && (
                    <div className="flex min-h-20 items-center justify-center rounded border border-dashed border-border text-sm text-low">
                      Drop tasks here
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </main>
  );
}
