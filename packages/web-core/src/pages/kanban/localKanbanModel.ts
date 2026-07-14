import type {
  LocalKanbanBoardDefinition,
  LocalKanbanSavedFilter,
  LocalKanbanSettings,
  LocalKanbanTask,
  LocalKanbanTaskInput,
} from '@/shared/lib/api';

export const emptyFilter = (): LocalKanbanSavedFilter => ({
  id: crypto.randomUUID(),
  name: 'New filter',
  columnId: '',
  project: '',
  client: '',
  priority: '',
  due: 'any',
  text: '',
  hideDone: false,
});

export function todayIso(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseTime(hourText: string, minuteText?: string, meridiem?: string) {
  let hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText ?? '0', 10);
  if (Number.isNaN(hour) || Number.isNaN(minute) || minute > 59) return null;
  if (meridiem?.toLowerCase() === 'pm' && hour < 12) hour += 12;
  if (meridiem?.toLowerCase() === 'am' && hour === 12) hour = 0;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function relativeDate(phrase: string) {
  const date = new Date();
  if (phrase === 'tomorrow') date.setDate(date.getDate() + 1);
  if (phrase === 'next week') date.setDate(date.getDate() + 7);
  if (phrase === 'next month') date.setMonth(date.getMonth() + 1);
  return todayIso(date);
}

function hasToken(text: string, token: string) {
  if (!token.trim()) return false;
  return new RegExp(`\\b${escapeRegExp(token.trim())}\\b`, 'i').test(text);
}

function removeToken(text: string, token: string) {
  if (!token.trim()) return text;
  return text.replace(
    new RegExp(`\\b${escapeRegExp(token.trim())}\\b`, 'gi'),
    ''
  );
}

export function parseQuickAdd(
  value: string,
  settings: LocalKanbanSettings
): LocalKanbanTaskInput {
  let text = value.trim();
  const input: LocalKanbanTaskInput = {
    title: '',
    columnId: settings.defaultColumnId,
  };

  const column = settings.columns.find(
    (candidate) =>
      hasToken(text, candidate.id) || hasToken(text, candidate.name)
  );
  if (column) {
    input.columnId = column.id;
    text = removeToken(removeToken(text, column.id), column.name);
  }

  text = text.replace(/#project\/([\w/-]+)/i, (_match, project: string) => {
    input.projectLabel = project;
    return '';
  });
  text = text.replace(/#client\/([\w/-]+)/i, (_match, client: string) => {
    input.clientLabel = client;
    return '';
  });
  text = text.replace(/#kanban\/([\w/-]+)/i, (_match, columnId: string) => {
    input.columnId = columnId;
    return '';
  });
  text = text.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/, (_match, note) => {
    input.linkedNote = String(note).trim();
    return '';
  });
  text = text.replace(/\[cover::\s*(.+?)\]/i, (_match, cover) => {
    input.cover = String(cover).trim();
    return '';
  });
  text = text.replace(
    /\b(?:at\s+(\d{1,2})(?::(\d{2}))?|(\d{1,2}):(\d{2})|(\d{1,2})\s*(am|pm))\b/i,
    (
      match,
      atHour: string | undefined,
      atMinute: string | undefined,
      colonHour: string | undefined,
      colonMinute: string | undefined,
      ampmHour: string | undefined,
      meridiem: string | undefined
    ) => {
      const parsed = parseTime(
        atHour ?? colonHour ?? ampmHour ?? '',
        atMinute ?? colonMinute,
        meridiem
      );
      if (!parsed) return match;
      input.dueTime = parsed;
      return '';
    }
  );
  text = text.replace(
    /\b(today|tomorrow|next week|next month)\b/i,
    (_match, phrase: string) => {
      input.dueDate = relativeDate(phrase.toLowerCase());
      return '';
    }
  );
  text = text.replace(/\b(\d{4}-\d{2}-\d{2})\b/, (_match, date: string) => {
    input.dueDate = date;
    return '';
  });
  text = text.replace(
    /\b(?:every|repeat(?:s|ing)?\s+every)\s+(\d+\s+)?(day|week|month|year)s?\b/i,
    (match) => {
      input.recurrence = match.replace(/^repeats?\s+/i, '').trim();
      return '';
    }
  );

  const prioritiesBySpecificity = [...settings.priorities].sort(
    (a, b) => b.symbol.length - a.symbol.length
  );
  for (const priority of prioritiesBySpecificity) {
    if (
      text.includes(priority.symbol) ||
      hasToken(text, priority.id) ||
      hasToken(text, priority.name)
    ) {
      input.priority = priority.id;
      text = removeToken(removeToken(text, priority.id), priority.name).replace(
        priority.symbol,
        ''
      );
      break;
    }
  }

  input.title = text.replace(/\s+/g, ' ').trim();
  return input;
}

export function matchesDueFilter(
  dueDate: string | null,
  due: LocalKanbanSavedFilter['due']
) {
  if (due === 'any') return true;
  if (due === 'no-date') return !dueDate;
  if (!dueDate) return false;
  const today = todayIso();
  if (due === 'overdue') return dueDate < today;
  if (due === 'today') return dueDate === today;
  const current = new Date();
  const mondayOffset = (current.getDay() + 6) % 7;
  const start = todayIso(addDays(current, -mondayOffset));
  const end = todayIso(addDays(current, 6 - mondayOffset));
  return dueDate >= start && dueDate <= end;
}

export function filterTasks(
  tasks: LocalKanbanTask[],
  board: LocalKanbanBoardDefinition,
  filter: LocalKanbanSavedFilter | null,
  doneColumnId: string
) {
  return tasks.filter((task) => {
    if (
      board.projectScope.length > 0 &&
      !board.projectScope.some(
        (value) => value.toLowerCase() === task.project_label?.toLowerCase()
      )
    )
      return false;
    if (
      board.clientScope.length > 0 &&
      !board.clientScope.some(
        (value) => value.toLowerCase() === task.client_label?.toLowerCase()
      )
    )
      return false;
    if (!filter) return true;
    if (filter.columnId && filter.columnId !== task.column_id) return false;
    if (filter.project && filter.project !== task.project_label) return false;
    if (filter.client && filter.client !== task.client_label) return false;
    if (filter.priority && filter.priority !== task.priority) return false;
    if (filter.hideDone && task.column_id === doneColumnId) return false;
    if (
      filter.text &&
      !`${task.title} ${task.description ?? ''}`
        .toLowerCase()
        .includes(filter.text.toLowerCase())
    )
      return false;
    return matchesDueFilter(task.due_date, filter.due);
  });
}

export function sortTasks(
  tasks: LocalKanbanTask[],
  settings: LocalKanbanSettings
) {
  const rank = new Map(
    settings.priorities.map((priority, index) => [priority.id, index])
  );
  return [...tasks].sort((a, b) => {
    const priority =
      (rank.get(a.priority ?? '') ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.priority ?? '') ?? Number.MAX_SAFE_INTEGER);
    if (priority !== 0) return priority;
    const due = (a.due_date ?? '9999-12-31').localeCompare(
      b.due_date ?? '9999-12-31'
    );
    if (due !== 0) return due;
    return a.title.localeCompare(b.title);
  });
}

export function groupTasks(
  tasks: LocalKanbanTask[],
  mode: LocalKanbanBoardDefinition['swimlane']
) {
  if (mode === 'none') return [['', tasks] as const];
  const groups = new Map<string, LocalKanbanTask[]>();
  for (const task of tasks) {
    const key =
      mode === 'project'
        ? (task.project_label ?? 'No project')
        : mode === 'client'
          ? (task.client_label ?? 'No client')
          : mode === 'priority'
            ? (task.priority ?? 'No priority')
            : (task.due_date ?? 'No due date');
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function monthGridDates(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
