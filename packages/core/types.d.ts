export interface SubtaskPayload {
  title: string;
  notes?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  notes?: string;
  due?: string | null;
  status: 'needsAction' | 'completed';
  parentId?: string | null;
  position?: string | null;
  subtasks: TaskItem[];
  isDirty?: boolean;
  isLocal?: boolean;
}

export type AiGenerationOptions = {
  length: 'short' | 'long';
  style: 'simple' | 'comprehensive';
};

export type PendingOperation =
  | {
      kind: 'create';
      taskId: string;
      listId: string;
      parentId: string | null;
      title: string;
      notes: string;
      due?: string | null;
      status: 'needsAction' | 'completed';
    }
  | {
      kind: 'update';
      taskId: string;
      listId: string;
      updates: {
        title?: string;
        notes?: string;
        due?: string | null;
        status?: 'needsAction' | 'completed';
      };
    }
  | {
      kind: 'delete';
      taskId: string;
      listId: string;
    };
