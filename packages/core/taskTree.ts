import type { TaskItem } from './types';

export function generateTempId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `temp-${crypto.randomUUID()}`;
  }
  return `temp-${Math.random().toString(36).slice(2)}`;
}

export function addTaskToTree(tree: TaskItem[], task: TaskItem): TaskItem[] {
  if (!task.parentId) {
    return [...tree, { ...task, subtasks: task.subtasks ?? [] }];
  }

  const mapper = (items: TaskItem[]): TaskItem[] =>
    items.map((item) => {
      if (item.id === task.parentId) {
        return {
          ...item,
          subtasks: [...item.subtasks, { ...task, subtasks: task.subtasks ?? [] }]
        };
      }
      return {
        ...item,
        subtasks: mapper(item.subtasks)
      };
    });

  return mapper(tree);
}

export function updateTaskInTree(tree: TaskItem[], task: TaskItem): TaskItem[] {
  const mapper = (items: TaskItem[]): TaskItem[] =>
    items.map((item) => {
      if (item.id === task.id) {
        return { ...item, ...task };
      }
      return { ...item, subtasks: mapper(item.subtasks) };
    });
  return mapper(tree);
}

export function removeTaskFromTree(tree: TaskItem[], taskId: string): TaskItem[] {
  const filterer = (items: TaskItem[]): TaskItem[] =>
    items
      .filter((item) => item.id !== taskId)
      .map((item) => ({ ...item, subtasks: filterer(item.subtasks) }));
  return filterer(tree);
}

export function replaceSubtasks(tree: TaskItem[], parentId: string, subtasks: TaskItem[]): TaskItem[] {
  const mapper = (items: TaskItem[]): TaskItem[] =>
    items.map((item) => {
      if (item.id === parentId) {
        return { ...item, subtasks };
      }
      return { ...item, subtasks: mapper(item.subtasks) };
    });
  return mapper(tree);
}

export function updateParentTitle(tree: TaskItem[], parentId: string, title: string): TaskItem[] {
  const mapper = (items: TaskItem[]): TaskItem[] =>
    items.map((item) => {
      if (item.id === parentId) {
        return { ...item, title };
      }
      return { ...item, subtasks: mapper(item.subtasks) };
    });
  return mapper(tree);
}

export function findTaskById(tree: TaskItem[], id: string): TaskItem | null {
  for (const task of tree) {
    if (task.id === id) {
      return task;
    }
    const nested = findTaskById(task.subtasks, id);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export function buildHierarchy(items: TaskItem[]): TaskItem[] {
  const byId = new Map<string, TaskItem>();
  const roots: TaskItem[] = [];
  items.forEach((item) => {
    byId.set(item.id, { ...item, subtasks: [] });
  });
  items.forEach((item) => {
    const current = byId.get(item.id)!;
    if (item.parentId && byId.has(item.parentId)) {
      byId.get(item.parentId)!.subtasks.push(current);
    } else {
      roots.push(current);
    }
  });
  const sortTasks = (list: TaskItem[]) => {
    list.sort((a, b) =>
      !a.position || !b.position
        ? (a.title || '').localeCompare(b.title || '')
        : a.position.localeCompare(b.position)
    );
    list.forEach((t) => sortTasks(t.subtasks));
  };
  sortTasks(roots);
  return roots;
}
