'use strict';

const {
  addTaskToTree,
  updateTaskInTree,
  removeTaskFromTree,
  replaceSubtasks,
  updateParentTitle,
  findTaskById,
  buildHierarchy,
} = require('../packages/core/taskTree');

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

// ---------------------------------------------------------------------------
// updateTaskInTree — additional edge-case coverage
// ---------------------------------------------------------------------------

describe('updateTaskInTree — edge cases', () => {
  it('should preserve the existing subtasks of an updated root node when task carries its own subtasks', () => {
    const child = makeTask({ id: 'child' });
    const tree = [makeTask({ id: 'root', title: 'Original', subtasks: [child] })];
    const updated = makeTask({ id: 'root', title: 'Renamed', subtasks: [child] });

    const result = updateTaskInTree(tree, updated);

    expect(result[0].subtasks).toHaveLength(1);
    expect(result[0].subtasks[0].id).toBe('child');
  });

  it('should return a new array reference (no mutation) even when ID is not found', () => {
    const tree = [makeTask({ id: 'a' })];
    const result = updateTaskInTree(tree, makeTask({ id: 'z', subtasks: [] }));

    // Same logical content, different array identity
    expect(result).not.toBe(tree);
  });
});

// ---------------------------------------------------------------------------
// replaceSubtasks — additional edge-case coverage
// ---------------------------------------------------------------------------

describe('replaceSubtasks — edge cases', () => {
  it('should not mutate the original tree', () => {
    const originalChild = makeTask({ id: 'old' });
    const tree = [makeTask({ id: 'parent', subtasks: [originalChild] })];

    replaceSubtasks(tree, 'parent', [makeTask({ id: 'new' })]);

    expect(tree[0].subtasks[0].id).toBe('old');
  });
});

// ---------------------------------------------------------------------------
// updateParentTitle — additional edge-case coverage
// ---------------------------------------------------------------------------

describe('updateParentTitle — edge cases', () => {
  it('should not mutate the original tree', () => {
    const tree = [makeTask({ id: 'a', title: 'Original' })];

    updateParentTitle(tree, 'a', 'Changed');

    expect(tree[0].title).toBe('Original');
  });

  it('should return the tree structurally unchanged when the ID is not found', () => {
    const tree = [makeTask({ id: 'a', title: 'Untouched' })];

    const result = updateParentTitle(tree, 'ghost', 'New Title');

    expect(result[0].title).toBe('Untouched');
  });
});

// ---------------------------------------------------------------------------
// buildHierarchy
// ---------------------------------------------------------------------------

describe('buildHierarchy', () => {
  it('should return an empty array when given an empty array', () => {
    const result = buildHierarchy([]);
    expect(result).toEqual([]);
  });

  it('should return all tasks at the top level when none have a parentId', () => {
    const items = [
      makeTask({ id: 'a', parentId: null, title: 'A', position: '1' }),
      makeTask({ id: 'b', parentId: null, title: 'B', position: '2' }),
    ];

    const result = buildHierarchy(items);

    expect(result).toHaveLength(2);
    const ids = result.map((t) => t.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('should nest a child under its parent and exclude it from the root level', () => {
    const items = [
      makeTask({ id: 'parent', parentId: null, title: 'Parent', position: '1' }),
      makeTask({ id: 'child', parentId: 'parent', title: 'Child', position: '1' }),
    ];

    const result = buildHierarchy(items);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('parent');
    expect(result[0].subtasks).toHaveLength(1);
    expect(result[0].subtasks[0].id).toBe('child');
  });

  it('should support multiple levels of nesting (grandparent → parent → child)', () => {
    const items = [
      makeTask({ id: 'gp', parentId: null, title: 'Grandparent', position: '1' }),
      makeTask({ id: 'p', parentId: 'gp', title: 'Parent', position: '1' }),
      makeTask({ id: 'c', parentId: 'p', title: 'Child', position: '1' }),
    ];

    const result = buildHierarchy(items);

    expect(result).toHaveLength(1);
    const grandparent = result[0];
    expect(grandparent.id).toBe('gp');
    expect(grandparent.subtasks).toHaveLength(1);
    const parent = grandparent.subtasks[0];
    expect(parent.id).toBe('p');
    expect(parent.subtasks).toHaveLength(1);
    expect(parent.subtasks[0].id).toBe('c');
  });

  it('should treat an orphaned subtask (non-existent parentId) as a root task', () => {
    const items = [
      makeTask({ id: 'real', parentId: null, title: 'Real', position: '1' }),
      makeTask({ id: 'orphan', parentId: 'does-not-exist', title: 'Orphan', position: '2' }),
    ];

    const result = buildHierarchy(items);

    const ids = result.map((t) => t.id);
    expect(ids).toContain('orphan');
    // orphan should not be nested inside any other task
    expect(result.find((t) => t.id === 'real').subtasks).toHaveLength(0);
  });

  it('should sort root tasks by position string (lexicographic ascending)', () => {
    const items = [
      makeTask({ id: 'c', parentId: null, title: 'C task', position: '00000000003' }),
      makeTask({ id: 'a', parentId: null, title: 'A task', position: '00000000001' }),
      makeTask({ id: 'b', parentId: null, title: 'B task', position: '00000000002' }),
    ];

    const result = buildHierarchy(items);

    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('should fall back to title sort when position is absent from all items', () => {
    const items = [
      makeTask({ id: 'z', parentId: null, title: 'Zebra', position: null }),
      makeTask({ id: 'a', parentId: null, title: 'Apple', position: null }),
      makeTask({ id: 'm', parentId: null, title: 'Mango', position: null }),
    ];

    const result = buildHierarchy(items);

    expect(result.map((t) => t.title)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('should fall back to title sort when either item in a comparison lacks position', () => {
    // One task has a position, the other does not — the comparator treats this
    // as the title-fallback branch (because !a.position || !b.position is true)
    const items = [
      makeTask({ id: 'with-pos', parentId: null, title: 'Zoo', position: '00000000001' }),
      makeTask({ id: 'no-pos', parentId: null, title: 'Ant', position: null }),
    ];

    const result = buildHierarchy(items);

    // Ant < Zoo alphabetically, so Ant should come first
    expect(result[0].id).toBe('no-pos');
    expect(result[1].id).toBe('with-pos');
  });

  it('should sort subtasks recursively by position', () => {
    const items = [
      makeTask({ id: 'parent', parentId: null, title: 'Parent', position: '1' }),
      makeTask({ id: 'sub-b', parentId: 'parent', title: 'Sub B', position: '00000000002' }),
      makeTask({ id: 'sub-a', parentId: 'parent', title: 'Sub A', position: '00000000001' }),
    ];

    const result = buildHierarchy(items);

    const subtasks = result[0].subtasks;
    expect(subtasks.map((t) => t.id)).toEqual(['sub-a', 'sub-b']);
  });

  it('should not mutate the input array or its items', () => {
    const items = [
      makeTask({ id: 'b', parentId: null, title: 'B', position: '2' }),
      makeTask({ id: 'a', parentId: null, title: 'A', position: '1' }),
    ];
    const originalOrder = items.map((t) => t.id);
    const originalSubtasks = items.map((t) => t.subtasks);

    buildHierarchy(items);

    // Input array order unchanged
    expect(items.map((t) => t.id)).toEqual(originalOrder);
    // Input items' subtasks arrays unchanged
    items.forEach((item, i) => {
      expect(item.subtasks).toBe(originalSubtasks[i]);
    });
  });

  it('should give each output node a fresh subtasks array (not sharing with input)', () => {
    const child = makeTask({ id: 'child', parentId: 'parent', title: 'Child', position: '1' });
    const parent = makeTask({ id: 'parent', parentId: null, title: 'Parent', position: '1' });
    const items = [parent, child];

    const result = buildHierarchy(items);

    // The output parent's subtasks array should be a new one, not the input's
    expect(result[0].subtasks).not.toBe(parent.subtasks);
    expect(result[0].subtasks[0].id).toBe('child');
  });
});
