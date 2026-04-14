import type { SubtaskerService } from '../core/SubtaskerService';

/**
 * Implements SubtaskerService by forwarding calls over Electron's IPC bridge
 * (window.subtasker, exposed by preload.js via contextBridge).
 *
 * This is the only file in the codebase that references window.subtasker.
 * Swap this class for a different implementation to run the UI on another platform.
 */
export class DesktopService implements SubtaskerService {
  private readonly s = window.subtasker;

  loadSettings() { return this.s.loadSettings(); }
  setOpenAiKey(key: string) { return this.s.setOpenAiKey(key); }
  getOpenAiContext() { return this.s.getOpenAiContext(); }
  setOpenAiContext(ctx: string) { return this.s.setOpenAiContext(ctx); }
  loadClientSecret() { return this.s.loadClientSecret(); }
  signIn() { return this.s.signIn(); }
  signOut() { return this.s.signOut(); }
  listTaskLists() { return this.s.listTaskLists(); }
  listTasks(listId: string) { return this.s.listTasks(listId); }
  createTask(listId: string, payload: Parameters<typeof this.s.createTask>[1]) {
    return this.s.createTask(listId, payload);
  }
  updateTask(listId: string, taskId: string, payload: Parameters<typeof this.s.updateTask>[2]) {
    return this.s.updateTask(listId, taskId, payload);
  }
  deleteTask(listId: string, taskId: string) { return this.s.deleteTask(listId, taskId); }
  applyChanges(payload: Parameters<typeof this.s.applyChanges>[0]) {
    return this.s.applyChanges(payload);
  }
  planExpand(payload: Parameters<typeof this.s.planExpand>[0]) {
    return this.s.planExpand(payload);
  }
  planRefine(payload: Parameters<typeof this.s.planRefine>[0]) {
    return this.s.planRefine(payload);
  }
  planSplit(payload: Parameters<typeof this.s.planSplit>[0]) {
    return this.s.planSplit(payload);
  }
  getGuidingQuestions(title: string) { return this.s.getGuidingQuestions(title); }
  getClientSecretPath() { return this.s.getClientSecretPath(); }
  getErrorLogPath() { return this.s.getErrorLogPath(); }
}
