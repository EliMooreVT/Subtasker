const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('subtasker', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  setOpenAiKey: (key) => ipcRenderer.invoke('settings:setOpenAiKey', key),
  getOpenAiContext: () => ipcRenderer.invoke('settings:getOpenAiContext'),
  setOpenAiContext: (context) => ipcRenderer.invoke('settings:setOpenAiContext', context),
  loadClientSecret: () => ipcRenderer.invoke('google:loadClientSecret'),
  signIn: () => ipcRenderer.invoke('google:signIn'),
  signOut: () => ipcRenderer.invoke('google:signOut'),
  listTaskLists: () => ipcRenderer.invoke('google:listTaskLists'),
  listTasks: (listId) => ipcRenderer.invoke('google:listTasks', listId),
  createTask: (listId, payload) => ipcRenderer.invoke('google:createTask', listId, payload),
  updateTask: (listId, taskId, payload) => ipcRenderer.invoke('google:updateTask', listId, taskId, payload),
  deleteTask: (listId, taskId) => ipcRenderer.invoke('google:deleteTask', listId, taskId),
  planExpand: (payload) => ipcRenderer.invoke('ai:planExpand', payload),
  planRefine: (payload) => ipcRenderer.invoke('ai:planRefine', payload),
  planSplit: (payload) => ipcRenderer.invoke('ai:planSplit', payload),
  getGuidingQuestions: (taskTitle) => ipcRenderer.invoke('app:getGuidingQuestions', taskTitle),
  getClientSecretPath: () => ipcRenderer.invoke('app:selectClientSecretPath'),
  getErrorLogPath: () => ipcRenderer.invoke('app:getErrorLogPath'),
  applyChanges: (payload) => ipcRenderer.invoke('google:applyChanges', payload)
});
