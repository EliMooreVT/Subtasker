// BridgeShim.js — injected into WKWebView via WKUserScript at document start.
// Creates window.subtasker with the same API shape as electron/preload.js.
// Each call posts a message to the Swift WKScriptMessageHandler and returns a
// Promise that resolves/rejects when Swift calls back via evaluateJavaScript.

(function () {
  'use strict';

  window.__nativeCallbacks = {};

  function nativeCall(action, payload) {
    return new Promise(function (resolve, reject) {
      var id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.__nativeCallbacks[id] = { resolve: resolve, reject: reject };
      window.webkit.messageHandlers.subtasker.postMessage({
        id: id,
        action: action,
        payload: payload || {}
      });
    });
  }

  // Called by Swift: window.__nativeResolve(id, resultJSON)
  window.__nativeResolve = function (id, resultJSON) {
    var cb = window.__nativeCallbacks[id];
    if (!cb) return;
    delete window.__nativeCallbacks[id];
    try {
      cb.resolve(JSON.parse(resultJSON));
    } catch (e) {
      cb.resolve(resultJSON);
    }
  };

  // Called by Swift: window.__nativeReject(id, errorMessage)
  window.__nativeReject = function (id, errorMessage) {
    var cb = window.__nativeCallbacks[id];
    if (!cb) return;
    delete window.__nativeCallbacks[id];
    cb.reject(new Error(errorMessage));
  };

  window.subtasker = {
    // Settings
    loadSettings: function () {
      return nativeCall('settings_load', {});
    },
    setOpenAiKey: function (key) {
      return nativeCall('settings_setOpenAiKey', { key: key });
    },
    getOpenAiContext: function () {
      return nativeCall('settings_getOpenAiContext', {});
    },
    setOpenAiContext: function (context) {
      return nativeCall('settings_setOpenAiContext', { context: context });
    },

    // Auth
    loadClientSecret: function () {
      return nativeCall('google_loadClientSecret', {});
    },
    signIn: function () {
      return nativeCall('google_signIn', {});
    },
    signOut: function () {
      return nativeCall('google_signOut', {});
    },

    // Tasks
    listTaskLists: function () {
      return nativeCall('google_listTaskLists', {});
    },
    listTasks: function (listId) {
      return nativeCall('google_listTasks', { listId: listId });
    },
    createTask: function (listId, payload) {
      return nativeCall('google_createTask', { listId: listId, payload: payload });
    },
    updateTask: function (listId, taskId, payload) {
      return nativeCall('google_updateTask', { listId: listId, taskId: taskId, payload: payload });
    },
    deleteTask: function (listId, taskId) {
      return nativeCall('google_deleteTask', { listId: listId, taskId: taskId });
    },
    applyChanges: function (payload) {
      return nativeCall('google_applyChanges', payload);
    },

    // AI
    planExpand: function (payload) {
      return nativeCall('ai_planExpand', payload);
    },
    planRefine: function (payload) {
      return nativeCall('ai_planRefine', payload);
    },
    planSplit: function (payload) {
      return nativeCall('ai_planSplit', payload);
    },
    getGuidingQuestions: function (taskTitle) {
      return nativeCall('app_getGuidingQuestions', { taskTitle: taskTitle });
    },

    // Diagnostics
    getClientSecretPath: function () {
      return nativeCall('app_getClientSecretPath', {});
    },
    getErrorLogPath: function () {
      return nativeCall('app_getErrorLogPath', {});
    }
  };
})();
