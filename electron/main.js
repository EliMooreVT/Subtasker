const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const isDev = !app.isPackaged;

const {
  getOpenAiKey,
  setOpenAiKey,
  getOpenAiContext,
  setOpenAiContext,
  getClientSecret,
  setWindowBounds
} = require('./store');
const { handleLoadClientSecret, ensureAuthClient, revokeAuth } = require('./googleAuth');
const {
  listTaskLists,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  insertSubtasks,
  replaceSubtasks
} = require('./googleTasks');
const {
  expandTask,
  refineSubtasks,
  splitSubtasks,
  generateGuidingQuestions
} = require('./openaiClient');
const { logError, getLogPath } = require('./logger');

let mainWindow;

process.on('uncaughtException', (error) => {
  logError('Uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logError('Unhandled rejection', error);
});

function registerHandle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      logError(`IPC ${channel}`, error);
      throw error;
    }
  });
}

function createWindow() {
  const bounds = require('./store').getWindowBounds();
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.on('close', () => {
    if (mainWindow) {
      const { width, height } = mainWindow.getBounds();
      setWindowBounds({ width, height });
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

registerHandle('settings:load', async () => ({
  hasClientSecret: Boolean(getClientSecret()),
  openAiKey: getOpenAiKey()
}));

registerHandle('settings:setOpenAiKey', async (_event, key) => {
  setOpenAiKey(key || '');
  return { success: true };
});

registerHandle('settings:getOpenAiContext', async () => getOpenAiContext() || '');

registerHandle('settings:setOpenAiContext', async (_event, context) => {
  setOpenAiContext(context || '');
  return { success: true };
});

registerHandle('google:loadClientSecret', async () => handleLoadClientSecret(mainWindow));

registerHandle('google:signIn', async () => {
  await ensureAuthClient(mainWindow);
  return { success: true };
});

registerHandle('google:listTaskLists', async () => listTaskLists(mainWindow));

registerHandle('google:listTasks', async (_event, listId) => listTasks(mainWindow, listId));

registerHandle('google:createTask', async (_event, listId, payload) => createTask(mainWindow, listId, payload));

registerHandle('google:updateTask', async (_event, listId, taskId, payload) =>
  updateTask(mainWindow, listId, taskId, payload)
);

registerHandle('google:deleteTask', async (_event, listId, taskId) => {
  await deleteTask(mainWindow, listId, taskId);
  return { success: true };
});

registerHandle('ai:planExpand', async (_event, { task, options }) =>
  expandTask({
    taskTitle: task.title,
    taskNotes: task.notes,
    userContext: task.context,
    options
  })
);

registerHandle('ai:planRefine', async (_event, { task, feedback, options }) =>
  refineSubtasks({
    taskTitle: task.title,
    currentSubtasks: task.subtasks,
    feedback,
    options
  })
);

registerHandle('ai:planSplit', async (_event, { task, instructions, options }) =>
  splitSubtasks({
    taskTitle: task.title,
    currentSubtasks: task.subtasks,
    instructions,
    options
  })
);

registerHandle('app:getGuidingQuestions', async (_event, taskTitle) => {
  try {
    const questions = await generateGuidingQuestions(taskTitle);
    return questions;
  } catch (error) {
    logError('Failed to generate guiding questions', error);
    return [
      'What outcome are you aiming for?',
      'What details or constraints should we keep in mind?',
      'What information do you still need before you start?'
    ];
  }
});

registerHandle('google:signOut', async () => {
  await revokeAuth();
  return { success: true };
});

registerHandle('app:selectClientSecretPath', async () => {
  const secret = getClientSecret();
  if (secret && secret.path && fs.existsSync(secret.path)) {
    return secret.path;
  }
  return null;
});

registerHandle('app:getErrorLogPath', async () => getLogPath());

registerHandle('google:applyChanges', async (_event, payload) => {
  const { listId, operations } = payload;
  const idMap = new Map();

  for (const operation of operations) {
    switch (operation.kind) {
      case 'create': {
        const parentId = operation.parentId
          ? idMap.get(operation.parentId) || operation.parentId
          : null;
        const created = await createTask(mainWindow, listId, {
          title: operation.title,
          notes: operation.notes,
          due: operation.due ?? undefined,
          parentId: parentId || undefined,
          status: operation.status
        });
        idMap.set(operation.taskId, created.id);
        break;
      }
      case 'update': {
        const actualId = idMap.get(operation.taskId) || operation.taskId;
        await updateTask(mainWindow, listId, actualId, operation.updates);
        break;
      }
      case 'delete': {
        const actualId = idMap.get(operation.taskId) || operation.taskId;
        try {
          await deleteTask(mainWindow, listId, actualId);
        } catch (error) {
          logError('Failed to delete task during applyChanges', error);
          throw error;
        }
        break;
      }
      default:
        break;
    }
  }

  return { success: true };
});
