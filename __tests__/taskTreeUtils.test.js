'use strict';

// ---------------------------------------------------------------------------
// Pure tree utilities from App.tsx, duplicated here for unit testing.
// When these are extracted to a dedicated module, replace with a require().
// ---------------------------------------------------------------------------

function makeTask(overrides = {}) {
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'A task',
    notes: overrides.notes ?? '',
    status: overrides.status ?? 'needsAction',
    parentId: overrides.parentId ?? null,
    position: overrides.position ?? null,
    subtasks: overrides.subtasks ?? [],
    ...overrides,
  };
}

function addTaskToTree(tree, task) {
  if (!task.parentId) {
    return [...tree, { ...task, subtasks: task.subtasks ?? [] }];
  }
  const mapper = (items) =>
    items.map((item) => {
      if (item.id === task.parentId) {
        return { ...item, subtasks: [...item.subtasks, { ...task, subtasks: task.subtasks ?? [] }] };
      }
      return { ...item, subtasks: mapper(item.subtasks) };
    });
  return mapper(tree);
}

function updateTaskInTree(tree, task) {
  const mapper = (items) =>
    items.map((item) => {
      if (item.id === task.id) {
        return { ...item, ...task };
      }
      return { ...item, subtasks: mapper(item.subtasks) };
    });
  return mapper(tree);
}

function removeTaskFromTree(tree, taskId) {
  const filterer = (items) =>
    items
      .filter((item) => item.id !== taskId)
      .map((item) => ({ ...item, subtasks: filterer(item.subtasks) }));
  return filterer(tree);
}

function replaceSubtasks(tree, parentId, subtasks) {
  const mapper = (items) =>
    items.map((item) => {
      if (item.id === parentId) {
        return { ...item, subtasks };
      }
      return { ...item, subtasks: mapper(item.subtasks) };
    });
  return mapper(tree);
}

function updateParentTitle(tree, parentId, title) {
  const mapper = (items) =>
    items.map((item) => {
      if (item.id === parentId) {
        return { ...item, title };
      }
      return { ...item, subtasks: mapper(item.subtasks) };
    });
  return mapper(tree);
}

function findTaskById(tree, id) {
  for (const task of tree) {
    if (task.id === id) return task;
    const nested = findTaskById(task.subtasks, id);
    if (nested) return nested;
  }
  return null;
}

// ---------------------------------------------------------------------------

describe('addTaskToTree', () => {
  it('should append a root-level task when parentId is null', () => {
    const tree = [makeTask({ id: 'a', parentId: null })];
    const newTask = makeTask({ id: 'b', parentId: null });

    const result = addTaskToTree(tree, newTask);

    expect(result).toHaveLength(2);
    expect(result[1].id).toBe('b');
  });

  it('should not mutate the original tree', () => {
    const tree = [makeTask({ id: 'a' })];
    const frozen = Object.freeze(tree);

    expect(() => addTaskToTree(frozen, makeTask({ id: 'b' }))).not.toThrow();
  });

  it('should nest the task under its parent when parentId matches a root item', () => {
    const parent = makeTask({ id: 'parent', parentId: null });
    const child = makeTask({ id: 'child', parentId: 'parent' });

    const result = addTaskToTree([parent], child);

    expect(result[0].subtasks).toHaveLength(1);
    expect(result[0].subtasks[0].id).toBe('child');
  });

  it('should nest the task deep in the hierarchy', () => {
    const grandparent = makeTask({
      id: 'gp',
      subtasks: [makeTask({ id: 'parent', subtasks: [] })],
    });
    const grandchild = makeTask({ id: 'gc', parentId: 'parent' });

    const result = addTaskToTree([grandparent], grandchild);

    const parent = result[0].subtasks[0];
    expect(parent.subtasks).toHaveLength(1);
    expect(parent.subtasks[0].id).toBe('gc');
  });

  it('should not add the task when parentId is present but not found (documents current behaviour)', () => {
    const tree = [makeTask({ id: 'a' })];
    const orphan = makeTask({ id: 'orphan', parentId: 'nonexistent' });

    const result = addTaskToTree(tree, orphan);

    const ids = result.map((t) => t.id);
    expect(ids).not.toContain('orphan');
  });

  it('should ensure subtasks defaults to an empty array on the new task', () => {
    const task = { id: 'x', title: 'X', status: 'needsAction', parentId: null };
    const result = addTaskToTree([], task);

    expect(result[0].subtasks).toEqual([]);
  });
});

describe('updateTaskInTree', () => {
  it('should update the matching root-level task', () => {
    const tree = [makeTask({ id: 'a', title: 'Old title' })];
    const updated = makeTask({ id: 'a', title: 'New title', subtasks: [] });

    const result = updateTaskInTree(tree, updated);

    expect(result[0].title).toBe('New title');
  });

  it('should update a deeply nested task', () => {
    const tree = [
      makeTask({
        id: 'root',
        subtasks: [makeTask({ id: 'child', title: 'Old' })],
      }),
    ];
    const updated = makeTask({ id: 'child', title: 'Updated', subtasks: [] });

    const result = updateTaskInTree(tree, updated);

    expect(result[0].subtasks[0].title).toBe('Updated');
  });

  it('should not mutate the original tree', () => {
    const tree = [makeTask({ id: 'a', title: 'Original' })];
    updateTaskInTree(tree, makeTask({ id: 'a', title: 'Changed', subtasks: [] }));
    expect(tree[0].title).toBe('Original');
  });

  it('should leave the tree unchanged when the task ID is not found', () => {
    const tree = [makeTask({ id: 'a', title: 'Unchanged' })];
    const result = updateTaskInTree(tree, makeTask({ id: 'z', title: 'Ghost', subtasks: [] }));
    expect(result[0].title).toBe('Unchanged');
  });
});

describe('removeTaskFromTree', () => {
  it('should remove a root-level task by ID', () => {
    const tree = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];

    const result = removeTaskFromTree(tree, 'a');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('should remove a nested task', () => {
    const tree = [
      makeTask({
        id: 'root',
        subtasks: [makeTask({ id: 'child' })],
      }),
    ];

    const result = removeTaskFromTree(tree, 'child');

    expect(result[0].subtasks).toHaveLength(0);
  });

  it('should not mutate the original tree', () => {
    const tree = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
    removeTaskFromTree(tree, 'a');
    expect(tree).toHaveLength(2);
  });

  it('should return the tree unchanged when the ID is not found', () => {
    const tree = [makeTask({ id: 'a' })];
    const result = removeTaskFromTree(tree, 'nonexistent');
    expect(result).toHaveLength(1);
  });

  it('should handle an empty tree gracefully', () => {
    const result = removeTaskFromTree([], 'any');
    expect(result).toEqual([]);
  });
});

describe('replaceSubtasks', () => {
  it('should replace subtasks of the matched parent', () => {
    const newSubs = [makeTask({ id: 'new-child' })];
    const tree = [makeTask({ id: 'parent', subtasks: [makeTask({ id: 'old-child' })] })];

    const result = replaceSubtasks(tree, 'parent', newSubs);

    expect(result[0].subtasks).toHaveLength(1);
    expect(result[0].subtasks[0].id).toBe('new-child');
  });

  it('should set subtasks to an empty array when replacement list is empty', () => {
    const tree = [makeTask({ id: 'parent', subtasks: [makeTask({ id: 'old' })] })];

    const result = replaceSubtasks(tree, 'parent', []);

    expect(result[0].subtasks).toEqual([]);
  });

  it('should leave the tree unchanged when the parentId is not found', () => {
    const tree = [makeTask({ id: 'parent', subtasks: [makeTask({ id: 'child' })] })];

    const result = replaceSubtasks(tree, 'ghost', [makeTask({ id: 'interloper' })]);

    expect(result[0].subtasks[0].id).toBe('child');
  });

  it('should replace subtasks of a deeply nested parent', () => {
    const tree = [
      makeTask({
        id: 'grandparent',
        subtasks: [makeTask({ id: 'parent', subtasks: [makeTask({ id: 'old-child' })] })],
      }),
    ];

    const result = replaceSubtasks(tree, 'parent', [makeTask({ id: 'new-child' })]);

    expect(result[0].subtasks[0].subtasks[0].id).toBe('new-child');
  });
});

describe('updateParentTitle', () => {
  it('should update the title of the matched item', () => {
    const tree = [makeTask({ id: 'a', title: 'Old' })];

    const result = updateParentTitle(tree, 'a', 'New Title');

    expect(result[0].title).toBe('New Title');
  });

  it('should leave other items untouched', () => {
    const tree = [makeTask({ id: 'a', title: 'A' }), makeTask({ id: 'b', title: 'B' })];

    const result = updateParentTitle(tree, 'a', 'Updated A');

    expect(result[1].title).toBe('B');
  });

  it('should update a nested item title', () => {
    const tree = [makeTask({ id: 'root', subtasks: [makeTask({ id: 'child', title: 'Child' })] })];

    const result = updateParentTitle(tree, 'child', 'Renamed Child');

    expect(result[0].subtasks[0].title).toBe('Renamed Child');
  });
});

describe('findTaskById', () => {
  it('should find and return a root-level task', () => {
    const tree = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];

    const result = findTaskById(tree, 'b');

    expect(result?.id).toBe('b');
  });

  it('should find a deeply nested task', () => {
    const tree = [
      makeTask({
        id: 'root',
        subtasks: [
          makeTask({
            id: 'mid',
            subtasks: [makeTask({ id: 'deep' })],
          }),
        ],
      }),
    ];

    const result = findTaskById(tree, 'deep');

    expect(result?.id).toBe('deep');
  });

  it('should return null when the task is not found', () => {
    const tree = [makeTask({ id: 'a' })];

    const result = findTaskById(tree, 'nonexistent');

    expect(result).toBeNull();
  });

  it('should return null for an empty tree', () => {
    const result = findTaskById([], 'any');
    expect(result).toBeNull();
  });

  it('should return the first match when duplicate IDs exist', () => {
    const tree = [makeTask({ id: 'dup', title: 'First' }), makeTask({ id: 'dup', title: 'Second' })];

    const result = findTaskById(tree, 'dup');

    expect(result?.title).toBe('First');
  });
});
