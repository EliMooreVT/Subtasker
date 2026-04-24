import type { SubtaskerService } from '../core/SubtaskerService';
import type { AiGenerationOptions, PendingOperation, TaskItem } from '../core/types';
import { buildHierarchy } from '../core/taskTree';

/**
 * Implements SubtaskerService by forwarding calls over the WKWebView bridge
 * (window.subtasker, injected by BridgeShim.js via WKUserScript).
 *
 * The bridge shape is identical to the Electron preload — same method names,
 * same argument order — so this class mirrors DesktopService exactly.
 */
export class MobileService implements SubtaskerService {
  private readonly s = window.subtasker;

  loadSettings() { return this.s.loadSettings(); }
  setOpenAiKey(key: string) { return this.s.setOpenAiKey(key); }
  getOpenAiContext() { return this.s.getOpenAiContext(); }
  setOpenAiContext(ctx: string) { return this.s.setOpenAiContext(ctx); }
  loadClientSecret() { return this.s.loadClientSecret(); }
  signIn() { return this.s.signIn(); }
  signOut() { return this.s.signOut(); }
  listTaskLists() { return this.s.listTaskLists(); }
  async listTasks(listId: string): Promise<TaskItem[]> {
    const flat = await this.s.listTasks(listId) as TaskItem[];
    return buildHierarchy(flat);
  }
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
