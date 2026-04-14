import React, { createContext, useContext } from 'react';
import type { SubtaskerService } from '../../core/SubtaskerService';

const ServiceContext = createContext<SubtaskerService | null>(null);

export function ServiceProvider({
  service,
  children
}: {
  service: SubtaskerService;
  children: React.ReactNode;
}) {
  return <ServiceContext.Provider value={service}>{children}</ServiceContext.Provider>;
}

export function useService(): SubtaskerService {
  const service = useContext(ServiceContext);
  if (!service) {
    throw new Error('useService must be used inside ServiceProvider');
  }
  return service;
}

/**
 * Adapts window.subtasker (injected by Electron's preload) to SubtaskerService.
 * This is the only place the codebase touches window.subtasker directly.
 */
export function createWindowAdapter(): SubtaskerService {
  const s = window.subtasker;
  return {
    loadSettings: () => s.loadSettings(),
    setOpenAiKey: (key) => s.setOpenAiKey(key),
    getOpenAiContext: () => s.getOpenAiContext(),
    setOpenAiContext: (ctx) => s.setOpenAiContext(ctx),
    loadClientSecret: () => s.loadClientSecret(),
    signIn: () => s.signIn(),
    signOut: () => s.signOut(),
    listTaskLists: () => s.listTaskLists(),
    listTasks: (listId) => s.listTasks(listId),
    createTask: (listId, payload) => s.createTask(listId, payload),
    updateTask: (listId, taskId, payload) => s.updateTask(listId, taskId, payload),
    deleteTask: (listId, taskId) => s.deleteTask(listId, taskId),
    applyChanges: (payload) => s.applyChanges(payload),
    planExpand: (payload) => s.planExpand(payload),
    planRefine: (payload) => s.planRefine(payload),
    planSplit: (payload) => s.planSplit(payload),
    getGuidingQuestions: (title) => s.getGuidingQuestions(title),
    getClientSecretPath: () => s.getClientSecretPath(),
    getErrorLogPath: () => s.getErrorLogPath()
  };
}
