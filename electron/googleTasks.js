const { google } = require('googleapis');
const { ensureAuthClient } = require('./googleAuth');

function toTaskItem(task) {
  return {
    id: task.id,
    title: task.title || 'Untitled task',
    notes: task.notes || '',
    due: task.due || null,
    status: task.status || 'needsAction',
    parentId: task.parent || null,
    position: task.position || null,
    subtasks: []
  };
}

function buildHierarchy(items) {
  const byId = new Map();
  const roots = [];
  items.forEach((item) => {
    const prepared = { ...item, subtasks: [] };
    byId.set(prepared.id, prepared);
  });

  items.forEach((item) => {
    const current = byId.get(item.id);
    if (item.parentId && byId.has(item.parentId)) {
      byId.get(item.parentId).subtasks.push(current);
    } else {
      roots.push(current);
    }
  });

  const sortTasks = (list) => {
    list.sort((a, b) => {
      if (!a.position || !b.position) {
        return (a.title || '').localeCompare(b.title || '');
      }
      return a.position.localeCompare(b.position);
    });
    list.forEach((task) => sortTasks(task.subtasks));
  };

  sortTasks(roots);
  return roots;
}

async function getTasksClient(mainWindow) {
  const auth = await ensureAuthClient(mainWindow);
  return google.tasks({ version: 'v1', auth });
}

async function listTaskLists(mainWindow) {
  const client = await getTasksClient(mainWindow);
  const response = await client.tasklists.list({ maxResults: 100 });
  return (response.data.items || []).map((list) => ({
    id: list.id,
    title: list.title,
    updated: list.updated
  }));
}

async function listTasks(mainWindow, listId) {
  const client = await getTasksClient(mainWindow);
  const response = await client.tasks.list({
    tasklist: listId,
    showCompleted: true,
    showHidden: true,
    maxResults: 500
  });
  const items = (response.data.items || []).map(toTaskItem);
  return buildHierarchy(items);
}

async function createTask(mainWindow, listId, payload) {
  const client = await getTasksClient(mainWindow);
  const response = await client.tasks.insert({
    tasklist: listId,
    parent: payload.parentId || undefined,
    requestBody: {
      title: payload.title,
      notes: payload.notes,
      due: payload.due || undefined,
      status: payload.status || undefined
    }
  });
  return toTaskItem(response.data);
}

async function updateTask(mainWindow, listId, taskId, payload) {
  const client = await getTasksClient(mainWindow);
  const requestBody = {};
  if (payload.title !== undefined) requestBody.title = payload.title;
  if (payload.notes !== undefined) requestBody.notes = payload.notes;
  if (payload.due !== undefined) requestBody.due = payload.due || undefined;
  if (payload.status !== undefined) requestBody.status = payload.status || undefined;
  const response = await client.tasks.patch({
    tasklist: listId,
    task: taskId,
    requestBody
  });
  return toTaskItem(response.data);
}

async function deleteTask(mainWindow, listId, taskId) {
  const client = await getTasksClient(mainWindow);
  await client.tasks.delete({ tasklist: listId, task: taskId });
  return true;
}

async function insertSubtasks(mainWindow, listId, parentTaskId, subtasks) {
  const client = await getTasksClient(mainWindow);
  let previous = undefined;
  const created = [];
  for (const subtask of subtasks) {
    const response = await client.tasks.insert({
      tasklist: listId,
      parent: parentTaskId,
      requestBody: {
        title: subtask.title,
        notes: subtask.notes
      },
      previous
    });
    previous = response.data.id;
    created.push(toTaskItem(response.data));
  }
  return created;
}

async function replaceSubtasks(mainWindow, listId, parentTaskId, existingIds, newSubtasks) {
  const client = await getTasksClient(mainWindow);
  for (const subtaskId of existingIds) {
    try {
      await client.tasks.delete({ tasklist: listId, task: subtaskId });
    } catch (error) {
      console.error('Failed to delete subtask', subtaskId, error);
    }
  }
  return insertSubtasks(mainWindow, listId, parentTaskId, newSubtasks);
}

module.exports = {
  listTaskLists,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  insertSubtasks,
  replaceSubtasks
};
