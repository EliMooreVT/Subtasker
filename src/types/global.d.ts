export type { SubtaskPayload, TaskItem, AiGenerationOptions, PendingOperation } from '../../packages/core/types';

import type { AiGenerationOptions, PendingOperation, TaskItem } from '../../packages/core/types';

declare global {
  interface Window {
    subtasker: {
      loadSettings: () => Promise<{ hasClientSecret: boolean; openAiKey: string }>;
      setOpenAiKey: (key: string) => Promise<{ success: boolean }>;
      getOpenAiContext: () => Promise<string>;
      setOpenAiContext: (context: string) => Promise<{ success: boolean }>;
      loadClientSecret: () => Promise<any>;
      signIn: () => Promise<{ success: boolean }>;
      signOut: () => Promise<{ success: boolean }>;
      listTaskLists: () => Promise<Array<{ id: string; title: string }>>;
      listTasks: (listId: string) => Promise<TaskItem[]>;
      createTask: (
        listId: string,
        payload: { title: string; notes?: string; due?: string | null; parentId?: string | null }
      ) => Promise<TaskItem>;
      updateTask: (
        listId: string,
        taskId: string,
        payload: { title?: string; notes?: string; due?: string | null; status?: string }
      ) => Promise<TaskItem>;
      deleteTask: (listId: string, taskId: string) => Promise<{ success: boolean }>;
      planExpand: (
        payload: {
          listId: string;
          task: { id: string; title: string; notes?: string; context?: string };
          options: AiGenerationOptions;
        }
      ) => Promise<{ parentTitle: string | null; subtasks: TaskItem[] }>;
      planRefine: (
        payload: {
          listId: string;
          task: { id: string; title: string; notes?: string; subtasks: TaskItem[] };
          feedback: string;
          options: AiGenerationOptions;
        }
      ) => Promise<{ parentTitle: string | null; subtasks: TaskItem[] }>;
      planSplit: (
        payload: {
          listId: string;
          task: { id: string; title: string; notes?: string; subtasks: TaskItem[] };
          instructions: string;
          options: AiGenerationOptions;
        }
      ) => Promise<{ parentTitle: string | null; subtasks: TaskItem[] }>;

      getGuidingQuestions: (taskTitle: string) => Promise<string[]>;
      getClientSecretPath: () => Promise<string | null>;
      getErrorLogPath: () => Promise<string>;
      applyChanges: (
        payload: { listId: string; operations: PendingOperation[] }
      ) => Promise<{ success: boolean }>;
    };
  }
}

export {};
