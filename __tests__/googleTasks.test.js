'use strict';

jest.mock('../electron/googleAuth', () => ({
  ensureAuthClient: jest.fn(),
}));

const mockTasksClient = {
  tasklists: { list: jest.fn() },
  tasks: {
    list: jest.fn(),
    insert: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock('googleapis', () => ({
  google: {
    tasks: jest.fn(() => mockTasksClient),
  },
}));

const { ensureAuthClient } = require('../electron/googleAuth');

describe('googleTasks', () => {
  let googleTasks;

  beforeEach(() => {
    ensureAuthClient.mockResolvedValue({});
    googleTasks = require('../electron/googleTasks');
  });

  describe('toTaskItem (via listTasks)', () => {
    it('should map a raw API task to the expected shape', async () => {
      const rawTask = {
        id: 'abc',
        title: 'My task',
        notes: 'Some notes',
        due: '2026-05-01T00:00:00.000Z',
        status: 'needsAction',
        parent: null,
        position: '00000000000000000001',
      };
      mockTasksClient.tasks.list.mockResolvedValue({ data: { items: [rawTask] } });

      const result = await googleTasks.listTasks({}, 'list-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'abc',
        title: 'My task',
        notes: 'Some notes',
        status: 'needsAction',
        subtasks: [],
      });
    });

    it('should fall back to "Untitled task" when title is absent', async () => {
      mockTasksClient.tasks.list.mockResolvedValue({
        data: { items: [{ id: 'x', title: undefined, status: 'needsAction' }] },
      });

      const result = await googleTasks.listTasks({}, 'list-1');

      expect(result[0].title).toBe('Untitled task');
    });

    it('should set notes to empty string when absent', async () => {
      mockTasksClient.tasks.list.mockResolvedValue({
        data: { items: [{ id: 'x', title: 'T', status: 'needsAction' }] },
      });

      const result = await googleTasks.listTasks({}, 'list-1');

      expect(result[0].notes).toBe('');
    });

    it('should nest a child under its parent', async () => {
      mockTasksClient.tasks.list.mockResolvedValue({
        data: {
          items: [
            { id: 'parent-1', title: 'Parent', status: 'needsAction' },
            { id: 'child-1', title: 'Child', status: 'needsAction', parent: 'parent-1' },
          ],
        },
      });

      const result = await googleTasks.listTasks({}, 'list-1');

      expect(result[0].subtasks).toHaveLength(1);
      expect(result[0].subtasks[0].id).toBe('child-1');
    });
  });

  describe('buildHierarchy (via listTasks)', () => {
    it('should return a flat list when no items have a parentId', async () => {
      mockTasksClient.tasks.list.mockResolvedValue({
        data: {
          items: [
            { id: '1', title: 'Alpha', status: 'needsAction', position: '00000000000000000001' },
            { id: '2', title: 'Beta', status: 'needsAction', position: '00000000000000000002' },
          ],
        },
      });

      const result = await googleTasks.listTasks({}, 'list-1');

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Alpha');
      expect(result[1].title).toBe('Beta');
    });

    it('should nest children under their parent', async () => {
      mockTasksClient.tasks.list.mockResolvedValue({
        data: {
          items: [
            { id: 'p1', title: 'Parent', status: 'needsAction' },
            { id: 'c1', title: 'Child A', status: 'needsAction', parent: 'p1' },
            { id: 'c2', title: 'Child B', status: 'needsAction', parent: 'p1' },
          ],
        },
      });

      const result = await googleTasks.listTasks({}, 'list-1');

      expect(result).toHaveLength(1);
      expect(result[0].subtasks).toHaveLength(2);
    });

    it('should promote an orphan to root when its parent ID is not in the list', async () => {
      mockTasksClient.tasks.list.mockResolvedValue({
        data: {
          items: [
            { id: 'orphan', title: 'Orphan', status: 'needsAction', parent: 'missing-parent' },
          ],
        },
      });

      const result = await googleTasks.listTasks({}, 'list-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('orphan');
    });

    it('should sort tasks by position string', async () => {
      mockTasksClient.tasks.list.mockResolvedValue({
        data: {
          items: [
            { id: '2', title: 'Second', status: 'needsAction', position: '00000000000000000002' },
            { id: '1', title: 'First', status: 'needsAction', position: '00000000000000000001' },
          ],
        },
      });

      const result = await googleTasks.listTasks({}, 'list-1');

      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
    });

    it('should handle an empty items list', async () => {
      mockTasksClient.tasks.list.mockResolvedValue({ data: { items: [] } });

      const result = await googleTasks.listTasks({}, 'list-1');

      expect(result).toEqual([]);
    });

    it('should handle missing data.items', async () => {
      mockTasksClient.tasks.list.mockResolvedValue({ data: {} });

      const result = await googleTasks.listTasks({}, 'list-1');

      expect(result).toEqual([]);
    });
  });

  describe('createTask', () => {
    it('should call tasks.insert with the correct payload and return a TaskItem', async () => {
      const rawResponse = { id: 'new-1', title: 'New task', status: 'needsAction' };
      mockTasksClient.tasks.insert.mockResolvedValue({ data: rawResponse });

      const result = await googleTasks.createTask({}, 'list-1', {
        title: 'New task',
        notes: 'A note',
        parentId: null,
      });

      expect(mockTasksClient.tasks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          tasklist: 'list-1',
          requestBody: expect.objectContaining({ title: 'New task', notes: 'A note' }),
        })
      );
      expect(result.id).toBe('new-1');
      expect(result.subtasks).toEqual([]);
    });

    it('should pass parentId when provided', async () => {
      mockTasksClient.tasks.insert.mockResolvedValue({
        data: { id: 'child', title: 'Child task', status: 'needsAction', parent: 'parent-id' },
      });

      await googleTasks.createTask({}, 'list-1', {
        title: 'Child task',
        notes: '',
        parentId: 'parent-id',
      });

      expect(mockTasksClient.tasks.insert).toHaveBeenCalledWith(
        expect.objectContaining({ parent: 'parent-id' })
      );
    });
  });

  describe('updateTask', () => {
    it('should call tasks.patch with only the provided fields', async () => {
      mockTasksClient.tasks.patch.mockResolvedValue({
        data: { id: 'task-1', title: 'Updated', status: 'needsAction' },
      });

      await googleTasks.updateTask({}, 'list-1', 'task-1', { title: 'Updated' });

      const patchArgs = mockTasksClient.tasks.patch.mock.calls[0][0];
      expect(patchArgs.requestBody).toEqual({ title: 'Updated' });
      expect(patchArgs.requestBody).not.toHaveProperty('notes');
    });

    it('should include all provided fields in the patch body', async () => {
      mockTasksClient.tasks.patch.mockResolvedValue({
        data: { id: 'task-1', title: 'T', notes: 'N', status: 'completed' },
      });

      await googleTasks.updateTask({}, 'list-1', 'task-1', {
        title: 'T',
        notes: 'N',
        status: 'completed',
      });

      const patchArgs = mockTasksClient.tasks.patch.mock.calls[0][0];
      expect(patchArgs.requestBody).toMatchObject({ title: 'T', notes: 'N', status: 'completed' });
    });
  });

  describe('deleteTask', () => {
    it('should call tasks.delete with the correct IDs and return true', async () => {
      mockTasksClient.tasks.delete.mockResolvedValue({});

      const result = await googleTasks.deleteTask({}, 'list-1', 'task-99');

      expect(mockTasksClient.tasks.delete).toHaveBeenCalledWith({
        tasklist: 'list-1',
        task: 'task-99',
      });
      expect(result).toBe(true);
    });
  });
});
