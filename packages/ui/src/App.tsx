import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AiGenerationOptions, PendingOperation, TaskItem } from './types/global';
import {
  generateTempId,
  addTaskToTree,
  updateTaskInTree,
  removeTaskFromTree,
  replaceSubtasks,
  updateParentTitle,
  findTaskById
} from '../../core/taskTree';
import { useService } from './ServiceContext';

const isIOS = !!(window as any).webkit?.messageHandlers?.subtasker;

type StatusState = { type: 'success' | 'error' | 'info'; message: string } | null;

type TaskDialogState =
  | null
  | {
      mode: 'create' | 'edit';
      parentId: string | null;
      task?: TaskItem;
    };

type ExpandDialogState =
  | null
  | {
      task: TaskItem;
      context: string;
      questions: string[];
      options: AiGenerationOptions;
    };

type RefineDialogState =
  | null
  | {
      task: TaskItem;
      feedback: string;
      options: AiGenerationOptions;
    };

type SplitDialogState =
  | null
  | {
      task: TaskItem;
      instructions: string;
      options: AiGenerationOptions;
    };

interface TaskDraft {
  title: string;
  notes: string;
  due?: string;
  status?: 'needsAction' | 'completed';
}

type TaskUpdate = {
  title?: string;
  notes?: string;
  due?: string | null;
  status?: 'needsAction' | 'completed';
};

type PreferencesDialogState = {
  open: boolean;
  openAiKey: string;
  showKey: boolean;
  context: string;
};



const FALLBACK_GUIDING_QUESTIONS = [
  'What outcome are you aiming for?',
  'What context or constraints should we keep in mind?',
  'What is the first checkpoint you need to reach?'
];

function prepareDraft(task?: TaskItem): TaskDraft {
  return {
    title: task?.title || '',
    notes: task?.notes || '',
    due: task?.due || undefined,
    status: task?.status || 'needsAction'
  };
}


const GuidingQuestions: React.FC<{ questions: string[] }> = ({ questions }) => (
  <div>
    <h3>Guiding Questions</h3>
    <ul>
      {questions.map((q) => (
        <li key={q} className="small">
          {q}
        </li>
      ))}
    </ul>
  </div>
);

const AiOptionsFields: React.FC<{
  options: AiGenerationOptions;
  onChange: (updates: Partial<AiGenerationOptions>) => void;
}> = ({ options, onChange }) => (
  <>
    <div className="preferences-field">
      <label>
        Task Size
        <select
          value={options.length}
          onChange={(e) => onChange({ length: e.target.value as AiGenerationOptions['length'] })}
        >
          <option value="short">Short (~5 subtasks)</option>
          <option value="long">Long (~10 subtasks)</option>
        </select>
      </label>
    </div>
    <div className="preferences-field">
      <label>
        Style
        <select
          value={options.style}
          onChange={(e) => onChange({ style: e.target.value as AiGenerationOptions['style'] })}
        >
          <option value="simple">Simple, direct steps</option>
          <option value="comprehensive">Comprehensive, with review notes</option>
        </select>
      </label>
    </div>
  </>
);

const StatusBanner: React.FC<{ status: StatusState; onClear: () => void }> = ({ status, onClear }) => {
  if (!status) return null;
  return (
    <div className={`status-banner ${status.type}`}>
      <span>{status.message}</span>
      <button className="secondary" onClick={onClear}>
        Dismiss
      </button>
    </div>
  );
};

const TaskDialog: React.FC<{
  state: TaskDialogState;
  onClose: () => void;
  onSubmit: (draft: TaskDraft) => Promise<void>;
}> = ({ state, onClose, onSubmit }) => {
  const [draft, setDraft] = useState<TaskDraft>(prepareDraft(state?.task));
  // Use a stable key based on mode + task id so background setTasks() re-renders
  // don't change the object reference and wipe a draft mid-edit.
  const openKey = state ? `${state.mode}-${state.task?.id ?? 'new'}` : null;
  const prevOpenKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (openKey !== null && openKey !== prevOpenKeyRef.current) {
      setDraft(prepareDraft(state?.task));
    }
    prevOpenKeyRef.current = openKey;
  }, [openKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit(draft);
  };

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h2>{state.mode === 'create' ? 'New Task' : 'Edit Task'}</h2>
        <form onSubmit={handleSubmit}>
          <label>
            Title
            <input
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              required
              maxLength={256}
            />
          </label>
          <label>
            Notes
            <textarea
              rows={4}
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              placeholder="Add detail or a done-when statement"
            />
          </label>
          <label>
            Due Date
            <input
              type="date"
              value={draft.due ? draft.due.substring(0, 10) : ''}
              onChange={(event) =>
                setDraft({ ...draft, due: event.target.value ? `${event.target.value}T00:00:00Z` : undefined })
              }
            />
          </label>
          {state.task && (
            <label>
              Status
              <select
                value={draft.status}
                onChange={(event) =>
                  setDraft({ ...draft, status: event.target.value as 'needsAction' | 'completed' })
                }
              >
                <option value="needsAction">Needs Action</option>
                <option value="completed">Completed</option>
              </select>
            </label>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary">
              {state.mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ExpandDialog: React.FC<{
  state: ExpandDialogState;
  onClose: () => void;
  onSubmit: (context: string, task: TaskItem, options: AiGenerationOptions) => Promise<void>;
  onOptionsChange: (options: AiGenerationOptions) => void;
}> = ({ state, onClose, onSubmit, onOptionsChange }) => {
  const [context, setContext] = useState(state?.context || '');
  const [options, setOptions] = useState<AiGenerationOptions>(state?.options || { length: 'short', style: 'simple' });

  useEffect(() => {
    setContext(state?.context || '');
    setOptions(state?.options || { length: 'short', style: 'simple' });
  }, [state]);

  if (!state) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    onClose();
    void onSubmit(context, state.task, options);
  };

  const handleOptionsChange = (updates: Partial<AiGenerationOptions>) => {
    setOptions((prev) => {
      const next = { ...prev, ...updates } as AiGenerationOptions;
      onOptionsChange(next);
      return next;
    });
  };

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h2>Expand with AI</h2>
        <p className="small">Gather quick context and let Subtasker draft micro-steps.</p>
        <GuidingQuestions questions={state.questions} />
        <form onSubmit={handleSubmit}>
          <textarea
            rows={6}
            value={context}
            placeholder="Drop in anything the AI should know before expanding."
            onChange={(event) => setContext(event.target.value)}
          />
          <AiOptionsFields options={options} onChange={handleOptionsChange} />
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Generate
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const RefineDialog: React.FC<{
  state: RefineDialogState;
  onClose: () => void;
  onSubmit: (feedback: string, task: TaskItem, options: AiGenerationOptions) => Promise<void>;
  onOptionsChange: (options: AiGenerationOptions) => void;
}> = ({ state, onClose, onSubmit, onOptionsChange }) => {
  const [feedback, setFeedback] = useState(state?.feedback || '');
  const [options, setOptions] = useState<AiGenerationOptions>(state?.options || { length: 'short', style: 'simple' });

  useEffect(() => {
    setFeedback(state?.feedback || '');
    setOptions(state?.options || { length: 'short', style: 'simple' });
  }, [state]);

  if (!state) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    onClose();
    void onSubmit(feedback, state.task, options);
  };

  const handleOptionsChange = (updates: Partial<AiGenerationOptions>) => {
    setOptions((prev) => {
      const next = { ...prev, ...updates } as AiGenerationOptions;
      onOptionsChange(next);
      return next;
    });
  };

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h2>Refine with AI</h2>
        <p className="small">Share tweaks and we will adjust the current subtasks with a light touch.</p>
        <form onSubmit={handleSubmit}>
          <textarea
            rows={6}
            value={feedback}
            placeholder="e.g. Keep under 40 minutes, front-load quick wins"
            onChange={(event) => setFeedback(event.target.value)}
            required
          />
          <AiOptionsFields options={options} onChange={handleOptionsChange} />
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Apply
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const SplitDialog: React.FC<{
  state: SplitDialogState;
  onClose: () => void;
  onSubmit: (instructions: string, task: TaskItem, options: AiGenerationOptions) => Promise<void>;
  onOptionsChange: (options: AiGenerationOptions) => void;
}> = ({ state, onClose, onSubmit, onOptionsChange }) => {
  const [instructions, setInstructions] = useState(state?.instructions || '');
  const [options, setOptions] = useState<AiGenerationOptions>(state?.options || { length: 'short', style: 'simple' });

  useEffect(() => {
    setInstructions(state?.instructions || '');
    setOptions(state?.options || { length: 'short', style: 'simple' });
  }, [state]);

  if (!state) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    onClose();
    void onSubmit(instructions, state.task, options);
  };

  const handleOptionsChange = (updates: Partial<AiGenerationOptions>) => {
    setOptions((prev) => {
      const next = { ...prev, ...updates } as AiGenerationOptions;
      onOptionsChange(next);
      return next;
    });
  };

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h2>Split into Smaller Steps</h2>
        <p className="small">Break each existing subtask into manageable micro-actions.</p>
        <form onSubmit={handleSubmit}>
          <textarea
            rows={4}
            value={instructions}
            placeholder="Optional guidance, e.g. focus on 2-minute actions"
            onChange={(event) => setInstructions(event.target.value)}
          />
          <AiOptionsFields options={options} onChange={handleOptionsChange} />
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Split Steps
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const PreferencesDialog: React.FC<{
  state: PreferencesDialogState;
  onChange: (updates: Partial<PreferencesDialogState>) => void;
  onSave: () => void;
  onClose: () => void;
  onLoadClientSecret: () => void;
  clientSecretLoaded: boolean;
  autoSync: boolean;
  onAutoSyncChange: (value: boolean) => void;
}> = ({ state, onChange, onSave, onClose, onLoadClientSecret, clientSecretLoaded, autoSync, onAutoSyncChange }) => {
  if (!state.open) {
    return null;
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog preferences-dialog">
        <h2>Preferences</h2>
        <p className="small">Manage credentials for Google Tasks and OpenAI.</p>
        {!isIOS && (
          <div className="preferences-section">
            <h3>Google Tasks</h3>
            <p className="small">Load your desktop OAuth client credentials to enable Google sign-in.</p>
            <button onClick={onLoadClientSecret}>
              {clientSecretLoaded ? 'Reload client_secret.json' : 'Load client_secret.json'}
            </button>
            {clientSecretLoaded && <span className="badge">Loaded</span>}
          </div>
        )}
        <div className="preferences-section">
          <h3>OpenAI</h3>
          <label className="preferences-field">
            API Key
            <div className="preferences-key-field">
              <input
                type={state.showKey ? 'text' : 'password'}
                value={state.openAiKey}
                onChange={(event) => onChange({ openAiKey: event.target.value })}
                placeholder="sk-..."
              />
              <button
                type="button"
                className="secondary"
                onClick={() => onChange({ showKey: !state.showKey })}
              >
                {state.showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          <label className="preferences-field">
            Default Context
            <textarea
              rows={4}
              value={state.context || ''}
              onChange={(event) => onChange({ context: event.target.value })}
              placeholder="Tell Subtasker about your role, team, or workflow so AI subtasks stay relevant."
            />
          </label>
        </div>
        {isIOS && (
          <div className="preferences-section">
            <h3>Sync</h3>
            <div className="pref-row">
              <label className="pref-label" htmlFor="autosync-toggle">
                Auto-sync
                <span className="pref-sublabel">Push changes immediately after each edit</span>
              </label>
              <button
                id="autosync-toggle"
                role="switch"
                aria-checked={autoSync}
                className={`toggle-switch${autoSync ? ' on' : ''}`}
                onClick={() => onAutoSyncChange(!autoSync)}
              />
            </div>
          </div>
        )}
        <div className="dialog-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

const ConfirmDialog: React.FC<{
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
}> = ({ message, onConfirm, onCancel, confirmLabel = 'Delete' }) => (
  <div className="dialog-backdrop">
    <div className="dialog">
      <p>{message}</p>
      <div className="dialog-actions">
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

const TaskList: React.FC<{
  tasks: TaskItem[];
  selectedTaskId: string | null;
  onSelect: (task: TaskItem) => void;
  onEditTask: (task: TaskItem) => void;
  onDeleteTask: (task: TaskItem) => void;
  onToggleComplete: (task: TaskItem) => void;
  hasHiddenCompleted: boolean;
  dirtyIds: Set<string>;
  onOpenSheet?: (taskId: string) => void;
}> = ({ tasks, selectedTaskId, onSelect, onEditTask, onDeleteTask, onToggleComplete, hasHiddenCompleted, dirtyIds, onOpenSheet }) => {
  if (!tasks.length) {
    return (
      <div className="empty-state">
        <h3>{hasHiddenCompleted ? 'All tasks complete' : 'No tasks yet'}</h3>
        <p>{hasHiddenCompleted ? 'Show completed to review done items.' : 'Create something to get started or pull in tasks from another app.'}</p>
      </div>
    );
  }

  return (
    <div className="task-list">
      {tasks.map((task) => (
        isIOS && onOpenSheet ? (
          // Mobile row: checkbox + title tap opens sheet, chevron indicates subtasks
          <div key={task.id} className="task-item task-row-mobile">
            <button
              className={`task-checkbox-mobile${task.status === 'completed' ? ' completed' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleComplete(task); }}
              aria-label={task.status === 'completed' ? 'Mark incomplete' : 'Mark complete'}
            >
              {task.status === 'completed' && '✓'}
            </button>
            <span
              className={`task-title-mobile${task.status === 'completed' ? ' completed' : ''}`}
              onClick={() => onOpenSheet(task.id)}
            >
              {task.title}
              {dirtyIds.has(task.id) && <span className="badge unsynced" style={{ marginLeft: 6 }}>Unsynced</span>}
            </span>
            {task.subtasks.length > 0 && (
              <span className="task-chevron" onClick={() => onOpenSheet(task.id)}>›</span>
            )}
          </div>
        ) : (
          // Desktop row: unchanged
          <div
            key={task.id}
            className={`task-list-item ${selectedTaskId === task.id ? 'active' : ''} ${task.status === 'completed' ? 'completed' : ''}`}
            onClick={() => onSelect(task)}
          >
            <div className="task-list-main">
              <div className="task-list-header">
                <div className="task-list-title">{task.title}</div>
                {dirtyIds.has(task.id) && <span className="badge unsynced">Unsynced</span>}
              </div>
              {task.notes && <div className="task-list-notes">{task.notes}</div>}
            </div>
            <div className="task-list-actions">
              <button
                className="secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleComplete(task);
                }}
              >
                {task.status === 'completed' ? 'Undo' : 'Complete'}
              </button>
              <button
                className="secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  onEditTask(task);
                }}
              >
                Edit
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteTask(task);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        )
      ))}
    </div>
  );
};

const SubtaskPanel: React.FC<{
  task: TaskItem | null;
  showCompleted: boolean;
  onAddSubtask: () => void;
  onExpand: () => Promise<void>;
  onRefine: () => void;
  onSplit: () => void;
  onEditTask: () => void;
  onDeleteTask: () => void;
  onEditSubtask: (task: TaskItem) => void;
  onDeleteSubtask: (task: TaskItem) => void;
  aiProgress: string | null;
  aiBusy: boolean;
  aiTaskId: string | null;
  dirtyIds: Set<string>;
  syncing: boolean;
}> = ({
  task,
  showCompleted,
  onAddSubtask,
  onExpand,
  onRefine,
  onEditTask,
  onDeleteTask,
  onEditSubtask,
  onDeleteSubtask,
  aiProgress,
  aiBusy,
  aiTaskId,
  dirtyIds,
  syncing,
  onSplit
}) => {
  if (!task) {
    return (
      <div className="subtasks-panel">
        <div className="empty-state">
          <h3>Select a task</h3>
          <p>Choose a task from the middle column to review and manage its subtasks.</p>
        </div>
      </div>
    );
  }

  const visibleSubtasks = task.subtasks.filter((sub) => showCompleted || sub.status !== 'completed');
  const hasHiddenCompleted = !showCompleted && task.subtasks.some((sub) => sub.status === 'completed');
  const isActiveTask = aiTaskId === task.id;

  return (
    <div className="subtasks-panel">
      <div className="subtasks-header">
        <div>
          <div className="subtasks-header-title">
            <h3>{task.title}</h3>
            {dirtyIds.has(task.id) && <span className="badge unsynced">Unsynced</span>}
          </div>
          {task.notes && <p className="subtask-notes">{task.notes}</p>}
        </div>
        <div className="subtasks-header-actions">
          <button className="secondary" onClick={onEditTask}>
            Edit Task
          </button>
          <button onClick={onDeleteTask}>Delete Task</button>
        </div>
      </div>
      <div className="subtask-list">
        {visibleSubtasks.length ? (
          visibleSubtasks.map((subtask) => (
            <div key={subtask.id} className="subtask-card">
              <div className="subtask-content">
                <div className="title-row">
                  <div className="title">{subtask.title}</div>
                  {dirtyIds.has(subtask.id) && <span className="badge unsynced">Unsynced</span>}
                </div>
                {subtask.notes && <div className="notes">{subtask.notes}</div>}
              </div>
              <div className="subtask-actions">
                <button
                  className="secondary"
                  onClick={() => onEditSubtask(subtask)}
                >
                  Edit
                </button>
                <button onClick={() => onDeleteSubtask(subtask)}>Delete</button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <h3>{hasHiddenCompleted ? 'All subtasks complete' : 'No subtasks yet'}</h3>
            <p>{hasHiddenCompleted ? 'Show completed to review done micro-steps.' : 'Add a subtask or expand with AI to generate a plan.'}</p>
          </div>
        )}
      </div>
      <div className="subtasks-footer">
        <button className="primary" onClick={onAddSubtask} disabled={aiBusy || syncing}>
          Add Subtask
        </button>
        <button className="secondary" onClick={() => void onExpand()} disabled={aiBusy || syncing}>
          Expand Task with AI
        </button>
        {task.subtasks.length > 0 && (
          <button className="secondary" onClick={onRefine} disabled={aiBusy || syncing}>
            Refine with AI
          </button>
        )}
        {task.subtasks.length > 0 && (
          <button className="secondary" onClick={onSplit} disabled={aiBusy || syncing}>
            Split into Smaller Steps
          </button>
        )}
        {aiProgress && isActiveTask && <div className="ai-progress">{aiProgress}</div>}
      </div>
    </div>
  );
};

const MobileTaskSheet: React.FC<{
  task: TaskItem;
  allTasks: TaskItem[];
  onClose: () => void;
  onEditTask: (task: TaskItem) => void;
  onDeleteTask: (task: TaskItem) => void;
  onToggleComplete: (task: TaskItem) => void;
  onAddSubtask: (parentId: string) => void;
  onExpand: () => void;
  onRefine: () => void;
  onSplit: () => void;
  aiBusy: boolean;
  aiProgress: string | null;
  dirtyIds: Set<string>;
}> = ({ task, onClose, onEditTask, onDeleteTask, onToggleComplete, onAddSubtask, onExpand, onRefine, onSplit, aiBusy, aiProgress, dirtyIds }) => {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet-container" role="dialog" aria-modal="true">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{task.title}</span>
          <button
            style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 15, fontWeight: 500, padding: '0 0 0 12px', minHeight: 44, cursor: 'pointer' }}
            onClick={() => onEditTask(task)}
          >
            Edit
          </button>
        </div>
        {(task.notes || task.due) && (
          <div className="sheet-section">
            {task.notes && <p style={{ margin: 0, fontSize: 14, color: 'var(--label-secondary)' }}>{task.notes}</p>}
            {task.due && <p style={{ margin: task.notes ? '8px 0 0' : 0, fontSize: 13, color: 'var(--label-secondary)' }}>Due: {task.due.substring(0, 10)}</p>}
          </div>
        )}
        <div className="sheet-section">
          <div className="sheet-section-label">Subtasks</div>
          {task.subtasks.length > 0 ? (
            task.subtasks.map((sub) => (
              <div key={sub.id} className="task-row-mobile" style={{ padding: '10px 0', gap: 12 }}>
                <button
                  className={`task-checkbox-mobile${sub.status === 'completed' ? ' completed' : ''}`}
                  onClick={() => onToggleComplete(sub)}
                  aria-label={sub.status === 'completed' ? 'Mark incomplete' : 'Mark complete'}
                >
                  {sub.status === 'completed' && '✓'}
                </button>
                <span className={`task-title-mobile${sub.status === 'completed' ? ' completed' : ''}`} style={{ fontSize: 15 }}>
                  {sub.title}
                  {dirtyIds.has(sub.id) && <span className="badge unsynced" style={{ marginLeft: 6 }}>Unsynced</span>}
                </span>
              </div>
            ))
          ) : (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--label-secondary)' }}>No subtasks yet</p>
          )}
          <button
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--accent)', fontSize: 15, fontWeight: 500, padding: '10px 0 0', minHeight: 44, cursor: 'pointer' }}
            onClick={() => onAddSubtask(task.id)}
          >
            + Add subtask
          </button>
        </div>
        {aiBusy && (
          <div className="sheet-ai-progress">
            <span className="page-loading-spinner" />
            <span>{aiProgress ?? 'Generating\u2026'}</span>
          </div>
        )}
        <div className="sheet-ai-buttons">
          <button className="sheet-ai-btn" onClick={onExpand} disabled={aiBusy}>
            Expand
          </button>
          <button className="sheet-ai-btn" onClick={onRefine} disabled={aiBusy || task.subtasks.length === 0}>
            Refine
          </button>
          <button className="sheet-ai-btn" onClick={onSplit} disabled={aiBusy || task.subtasks.length === 0}>
            Split
          </button>
        </div>
        <button className="sheet-delete-btn" onClick={() => onDeleteTask(task)}>
          Delete task
        </button>
      </div>
    </>
  );
};

const MobileMenu: React.FC<{
  isSignedIn: boolean;
  userEmail: string | null;
  hasPendingChanges: boolean;
  pendingCount: number;
  isSyncing: boolean;
  aiBusy: boolean;
  showCompleted: boolean;
  onClose: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenPreferences: () => void;
  onToggleShowCompleted: () => void;
  onRefreshLists: () => void;
  onPushChanges: () => void;
  onDiscardChanges: () => void;
}> = ({
  isSignedIn,
  hasPendingChanges,
  pendingCount,
  isSyncing,
  aiBusy,
  showCompleted,
  onClose,
  onSignIn,
  onSignOut,
  onOpenPreferences,
  onToggleShowCompleted,
  onRefreshLists,
  onPushChanges,
  onDiscardChanges
}) => {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="menu-sheet" role="dialog" aria-modal="true">
        <div className="sheet-handle" />
        <div className="menu-account">
          <div className="menu-account-email">
            {isSignedIn ? 'Google Account' : 'Not signed in'}
          </div>
          <div className="menu-account-status">
            {isSignedIn ? 'Connected to Google Tasks' : 'Sign in to sync tasks'}
          </div>
        </div>
        {isSignedIn ? (
          <button className="menu-item" onClick={() => { onSignOut(); onClose(); }}>
            Sign Out
          </button>
        ) : (
          <button className="menu-item" onClick={() => { onSignIn(); onClose(); }}>
            Sign In with Google
          </button>
        )}
        <button className="menu-item" onClick={() => { onOpenPreferences(); onClose(); }}>
          Preferences
        </button>
        <button className="menu-item" onClick={() => { onToggleShowCompleted(); onClose(); }}>
          <span>{showCompleted ? '✓ Hide Completed' : 'Show Completed'}</span>
        </button>
        <button className="menu-item" onClick={() => { onRefreshLists(); onClose(); }} disabled={isSyncing || hasPendingChanges}>
          Refresh Lists
        </button>
        {hasPendingChanges && (
          <>
            <button className="menu-item" onClick={() => { onPushChanges(); onClose(); }} disabled={aiBusy || isSyncing}>
              Push Changes
              <span className="badge unsynced">{pendingCount}</span>
            </button>
            <button className="menu-item" onClick={() => { onDiscardChanges(); onClose(); }} disabled={isSyncing} style={{ color: 'var(--destructive)' }}>
              Discard Changes
            </button>
          </>
        )}
      </div>
    </>
  );
};

const App: React.FC = () => {
  const service = useService();
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [lists, setLists] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>(null);
  const [taskDialog, setTaskDialog] = useState<TaskDialogState>(null);
  const [expandDialog, setExpandDialog] = useState<ExpandDialogState>(null);
  const [refineDialog, setRefineDialog] = useState<RefineDialogState>(null);
  const [splitDialog, setSplitDialog] = useState<SplitDialogState>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [openAiKey, setOpenAiKey] = useState('');
  const [openAiContext, setOpenAiContext] = useState('');
  const [clientSecretLoaded, setClientSecretLoaded] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [aiProgress, setAiProgress] = useState<string | null>(null);
  const [aiTaskId, setAiTaskId] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [pendingOperations, setPendingOperations] = useState<PendingOperation[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [aiOptions, setAiOptions] = useState<AiGenerationOptions>({ length: 'short', style: 'simple' });
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<TaskItem | null>(null);
  const [pendingListSwitch, setPendingListSwitch] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<PreferencesDialogState>({
    open: false,
    openAiKey: '',
    showKey: false,
    context: ''
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sheetTaskId, setSheetTaskId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [autoSync, setAutoSync] = useState(() => {
    const stored = localStorage.getItem('subtasker_autosync');
    if (stored !== null) return stored === 'true';
    return isIOS; // true on iOS by default, false on desktop
  });
  const pagesRef = useRef<HTMLDivElement>(null);

  const hasPendingChanges = pendingOperations.length > 0;

  useEffect(() => {
    localStorage.setItem('subtasker_autosync', autoSync ? 'true' : 'false');
  }, [autoSync]);

  const dirtyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const op of pendingOperations) {
      ids.add(op.taskId);
      if (op.kind === 'create' && op.parentId) ids.add(op.parentId);
    }
    return ids;
  }, [pendingOperations]);

  const queueCreate = (operation: Extract<PendingOperation, { kind: 'create' }>) => {
    setPendingOperations((prev) => {
      const filtered = prev.filter((op) => !(op.kind === 'create' && op.taskId === operation.taskId));
      return [...filtered, operation];
    });
  };

  const queueUpdate = (taskId: string, updates: TaskUpdate) => {
    if (!selectedListId) return;
    setPendingOperations((prev) => {
      const next = [...prev];
      const createIndex = next.findIndex((op) => op.kind === 'create' && op.taskId === taskId);
      if (createIndex !== -1) {
        const createOp = next[createIndex] as Extract<PendingOperation, { kind: 'create' }>;
        next[createIndex] = {
          ...createOp,
          title: updates.title !== undefined ? updates.title : createOp.title,
          notes: updates.notes !== undefined ? updates.notes ?? '' : createOp.notes,
          due: updates.due !== undefined ? updates.due : createOp.due,
          status: updates.status !== undefined ? updates.status ?? createOp.status : createOp.status
        };
        return next;
      }
      const updateIndex = next.findIndex((op) => op.kind === 'update' && op.taskId === taskId);
      if (updateIndex !== -1) {
        const updateOp = next[updateIndex] as Extract<PendingOperation, { kind: 'update' }>;
        next[updateIndex] = {
          ...updateOp,
          updates: { ...updateOp.updates, ...updates }
        };
        return next;
      }
      return [
        ...next,
        {
          kind: 'update',
          taskId,
          listId: selectedListId,
          updates
        } as PendingOperation
      ];
    });
  };

  const queueDelete = (taskId: string) => {
    if (!selectedListId) return;
    setPendingOperations((prev) => {
      let next = prev.filter((op) => !(op.kind === 'create' && op.taskId === taskId));
      next = next.filter((op) => !(op.kind === 'update' && op.taskId === taskId));
      const hadCreate = prev.some((op) => op.kind === 'create' && op.taskId === taskId);
      next = next.filter((op) => !(op.kind === 'delete' && op.taskId === taskId));
      if (!hadCreate) {
        next = [
          ...next,
          {
            kind: 'delete',
            taskId,
            listId: selectedListId
          } as PendingOperation
        ];
      }
      return next;
    });
  };

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const settings = await service.loadSettings();
        setClientSecretLoaded(settings.hasClientSecret);
        if (settings.hasClientSecret) {
          try {
            await fetchLists();
            setIsSignedIn(true);
          } catch (error) {
            setStatus({ type: 'error', message: (error as Error).message });
          }
        }
        setOpenAiKey(settings.openAiKey || '');
        const context = await service.getOpenAiContext();
        setOpenAiContext(context || '');
        setPreferences((prev) => ({
          ...prev,
          openAiKey: settings.openAiKey || '',
          context: context || ''
        }));
      } catch (error) {
        console.error(error);
        setStatus({ type: 'error', message: (error as Error).message });
      }
    };

    bootstrap();
  }, []);

  const fetchLists = async () => {
    const fetched = await service.listTaskLists();
    setLists(fetched);
    if (fetched.length && !selectedListId) {
      setSelectedListId(fetched[0].id);
    }
  };

  const reloadTasks = async (listId: string) => {
    setIsLoading(true);
    try {
      const fetched = await service.listTasks(listId);
      setTasks(fetched);
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedListId) return;
    reloadTasks(selectedListId);
  }, [selectedListId]);

  useEffect(() => {
    setSelectedTaskId((previous) => {
      if (!tasks.length) {
        return null;
      }
      if (previous) {
        const match = findTaskById(tasks, previous);
        if (match && (showCompleted || match.status !== 'completed')) {
          return previous;
        }
      }
      const firstActive = tasks.find((task) => showCompleted || task.status !== 'completed');
      return firstActive ? firstActive.id : null;
    });
  }, [tasks, showCompleted]);

  const handleLoadSecret = async () => {
    try {
      const result = await service.loadClientSecret();
      if (result) {
        setClientSecretLoaded(true);
        setStatus({ type: 'success', message: 'Client secret loaded.' });
      }
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  };

  const openPreferences = () => {
    setPreferences({ open: true, openAiKey, showKey: false, context: openAiContext });
  };

  const closePreferences = () => {
    setPreferences({ open: false, openAiKey, showKey: false, context: openAiContext });
  };

  const handleSavePreferences = async () => {
    try {
      await service.setOpenAiKey(preferences.openAiKey);
      setOpenAiKey(preferences.openAiKey);
      await service.setOpenAiContext(preferences.context || '');
      setOpenAiContext(preferences.context || '');
      setPreferences({ open: false, openAiKey: preferences.openAiKey, showKey: false, context: preferences.context || '' });
      setStatus({ type: 'success', message: 'Preferences saved.' });
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  };

  const handleSignIn = async () => {
    try {
      await service.signIn();
      setIsSignedIn(true);
      await fetchLists();
      setStatus({ type: 'success', message: 'Signed in to Google Tasks.' });
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  };

  const handleSignOut = async () => {
    try {
      await service.signOut();
      setIsSignedIn(false);
      setTasks([]);
      setLists([]);
      setSelectedListId(null);
      setSelectedTaskId(null);
      setAiBusy(false);
      setAiProgress(null);
      setAiTaskId(null);
      setPendingOperations([]);
      setStatus({ type: 'success', message: 'Signed out and cleared local tokens.' });
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  };

  const handleCreateOrUpdateTask = async (draft: TaskDraft) => {
    if (!selectedListId || !taskDialog) return;
    try {
      if (taskDialog.mode === 'create') {
        const newId = generateTempId();
        const newTask: TaskItem = {
          id: newId,
          title: draft.title,
          notes: draft.notes,
          due: draft.due || null,
          status: draft.status || 'needsAction',
          parentId: taskDialog.parentId || null,
          position: null,
          subtasks: [],
          isLocal: true
        };
        setTasks((prev) => addTaskToTree(prev, newTask));
        queueCreate({
          kind: 'create',
          taskId: newId,
          listId: selectedListId,
          parentId: taskDialog.parentId || null,
          title: draft.title,
          notes: draft.notes,
          due: draft.due || null,
          status: draft.status || 'needsAction'
        });
        setSelectedTaskId(taskDialog.parentId ? taskDialog.parentId : newId);
        setStatus({ type: 'success', message: 'Task staged for sync.' });
      } else if (taskDialog.task) {
        const target = taskDialog.task;
        const updatedTask: TaskItem = {
          ...target,
          title: draft.title,
          notes: draft.notes,
          due: draft.due || null,
          status: draft.status || 'needsAction'
        };
        setTasks((prev) => updateTaskInTree(prev, updatedTask));
        queueUpdate(target.id, {
          title: draft.title,
          notes: draft.notes,
          due: draft.due || null,
          status: draft.status || 'needsAction'
        });
        setStatus({ type: 'success', message: 'Task changes staged.' });
        if (!target.parentId) {
          setSelectedTaskId(target.id);
        }
      }
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    } finally {
      setTaskDialog(null);
    }
  };

  const handleDeleteTask = (task: TaskItem) => {
    setDeleteConfirmTask(task);
  };

  const handleConfirmDelete = () => {
    const task = deleteConfirmTask;
    setDeleteConfirmTask(null);
    if (!task || !selectedListId) return;
    const wasNewTask = pendingOperations.some((op) => op.kind === 'create' && op.taskId === task.id);
    const collectIds = (item: TaskItem): string[] => [item.id, ...item.subtasks.flatMap(collectIds)];
    const ids = collectIds(task);
    setTasks((prev) => removeTaskFromTree(prev, task.id));
    if (wasNewTask) {
      setPendingOperations((prev) => prev.filter((op) => !ids.includes(op.taskId)));
    } else {
      setPendingOperations((prev) => {
        const filtered = prev.filter((op) => !ids.slice(1).includes(op.taskId) && !(op.kind === 'delete' && op.taskId === task.id));
        return [
          ...filtered,
          {
            kind: 'delete',
            taskId: task.id,
            listId: selectedListId
          } as PendingOperation
        ];
      });
    }
    if (!task.parentId) {
      setSelectedTaskId((prev) => (prev === task.id ? null : prev));
    }
    setStatus({ type: 'success', message: wasNewTask ? 'Temporary task removed.' : 'Deletion staged.' });
  };

  const handleToggleComplete = (task: TaskItem) => {
    if (!selectedListId) return;
    const newStatus: TaskUpdate['status'] = task.status === 'completed' ? 'needsAction' : 'completed';
    const updatedTask: TaskItem = { ...task, status: newStatus };
    setTasks((prev) => updateTaskInTree(prev, updatedTask));
    queueUpdate(task.id, { status: newStatus });
    setStatus({ type: 'success', message: newStatus === 'completed' ? 'Task marked complete.' : 'Task marked incomplete.' });
  };

  const handleRefreshLists = async () => {
    if (hasPendingChanges) {
      setStatus({ type: 'error', message: 'Push or discard changes before refreshing lists.' });
      return;
    }
    try {
      await fetchLists();
      if (selectedListId) {
        await reloadTasks(selectedListId);
      }
      setStatus({ type: 'success', message: 'Lists refreshed.' });
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  };

  const handleExpand = async (context: string, task: TaskItem, options: AiGenerationOptions) => {
    if (!selectedListId) return;
    setAiBusy(true);
    setAiProgress('Generating subtasks…');
    setAiTaskId(task.id);
    setAiOptions(options);
    try {
      const plan = await service.planExpand({
        listId: selectedListId,
        task: { id: task.id, title: task.title, notes: task.notes, context },
        options
      });
      const newSubtasks = plan.subtasks.map((subtask) => ({
        id: generateTempId(),
        title: subtask.title,
        notes: subtask.notes,
        due: null,
        status: 'needsAction' as const,
        parentId: task.id,
        position: null,
        subtasks: [],
        isLocal: true
      }));
      setTasks((prev) => {
        const currentParent = findTaskById(prev, task.id);
        const existing = currentParent?.subtasks || [];
        let next = replaceSubtasks(prev, task.id, [...existing, ...newSubtasks]);
        if (plan.parentTitle && plan.parentTitle !== task.title) {
          next = updateParentTitle(next, task.id, plan.parentTitle);
        }
        return next;
      });
      newSubtasks.forEach((subtask) => {
        queueCreate({
          kind: 'create',
          taskId: subtask.id,
          listId: selectedListId,
          parentId: task.id,
          title: subtask.title,
          notes: subtask.notes || '',
          due: null,
          status: 'needsAction'
        });
      });
      if (plan.parentTitle && plan.parentTitle !== task.title) {
        queueUpdate(task.id, { title: plan.parentTitle });
      }
      setStatus({ type: 'success', message: 'AI subtasks staged.' });
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    } finally {
      // Guard against closing a dialog re-opened for a different task while this AI call was running
      setExpandDialog((prev) => (prev?.task.id === task.id ? null : prev));
      setAiBusy(false);
      setAiProgress(null);
      setAiTaskId(null);
    }
  };

  const handleAIReplaceSubtasks = async (
    mode: 'refine' | 'split',
    input: string,
    task: TaskItem,
    options: AiGenerationOptions
  ) => {
    if (!selectedListId) return;
    setAiBusy(true);
    setAiProgress(mode === 'refine' ? 'Refining subtasks…' : 'Splitting subtasks…');
    setAiTaskId(task.id);
    setAiOptions(options);
    try {
      const plan = await (mode === 'refine'
        ? service.planRefine({
            listId: selectedListId,
            task: { id: task.id, title: task.title, notes: task.notes, subtasks: task.subtasks },
            feedback: input,
            options
          })
        : service.planSplit({
            listId: selectedListId,
            task: { id: task.id, title: task.title, notes: task.notes, subtasks: task.subtasks },
            instructions: input,
            options
          }));

      // Resolve current subtasks from the live tree — task captured at dialog-open time may be stale
      const currentTask = findTaskById(tasks, task.id) ?? task;
      currentTask.subtasks.forEach((sub) => queueDelete(sub.id));

      const newSubtasks = plan.subtasks.map((subtask) => ({
        id: generateTempId(),
        title: subtask.title,
        notes: subtask.notes,
        due: null,
        status: 'needsAction' as const,
        parentId: task.id,
        position: null,
        subtasks: [],
        isLocal: true
      }));
      setTasks((prev) => {
        let next = replaceSubtasks(prev, task.id, newSubtasks);
        if (plan.parentTitle && plan.parentTitle !== task.title) {
          next = updateParentTitle(next, task.id, plan.parentTitle);
        }
        return next;
      });
      newSubtasks.forEach((subtask) => {
        queueCreate({
          kind: 'create',
          taskId: subtask.id,
          listId: selectedListId,
          parentId: task.id,
          title: subtask.title,
          notes: subtask.notes || '',
          due: null,
          status: 'needsAction'
        });
      });
      if (plan.parentTitle && plan.parentTitle !== task.title) {
        queueUpdate(task.id, { title: plan.parentTitle });
      }
      setStatus({
        type: 'success',
        message: mode === 'refine' ? 'Subtasks refinement staged.' : 'Subtasks split into smaller steps.'
      });
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    } finally {
      mode === 'refine' ? setRefineDialog(null) : setSplitDialog(null);
      setAiBusy(false);
      setAiProgress(null);
      setAiTaskId(null);
    }
  };

  const discardLocalChanges = async ({ suppressStatus, skipReload }: { suppressStatus?: boolean; skipReload?: boolean } = {}) => {
    setPendingOperations([]);
    setAiBusy(false);
    setAiProgress(null);
    setAiTaskId(null);
    // Dialogs are NOT closed here — call sites close them as appropriate so that
    // a mid-fill dialog (e.g. Expand context textarea) is not silently discarded.
    if (!skipReload && selectedListId) {
      await reloadTasks(selectedListId);
    }
    if (!suppressStatus) {
      setStatus({ type: 'info', message: 'Local changes discarded.' });
    }
  };

  const handleDiscardChanges = async () => {
    // Only close AI dialogs if an AI operation was in flight
    if (aiBusy) {
      setExpandDialog(null);
      setRefineDialog(null);
      setSplitDialog(null);
    }
    await discardLocalChanges();
  };

  const handlePushChanges = async () => {
    if (!selectedListId || !pendingOperations.length) {
      return;
    }
    setIsSyncing(true);
    try {
      await service.applyChanges({ listId: selectedListId, operations: pendingOperations });
      setPendingOperations([]);
      await reloadTasks(selectedListId);
      setStatus({ type: 'success', message: 'Changes synced to Google Tasks.' });
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    } finally {
      setIsSyncing(false);
    }
  };

  // Keep a stable ref so the auto-push effect always reads the current value without stale closure.
  const autoSyncRef = useRef(autoSync);
  autoSyncRef.current = autoSync;
  const isSyncingRef = useRef(isSyncing);
  isSyncingRef.current = isSyncing;
  const aiBusyRef = useRef(aiBusy);
  aiBusyRef.current = aiBusy;

  // Auto-push: fires after React commits new pendingOperations state.
  // setTimeout(0) lets all synchronous queue* calls in a single event handler settle
  // before the push so we send one batch, not one request per queued op.
  useEffect(() => {
    if (!autoSyncRef.current || pendingOperations.length === 0) return;
    const timer = setTimeout(() => {
      if (autoSyncRef.current && !isSyncingRef.current && !aiBusyRef.current) {
        void handlePushChanges();
      }
    }, 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOperations]);

  const selectedListTitle = useMemo(() => lists.find((l) => l.id === selectedListId)?.title || '', [lists, selectedListId]);
  const visibleTasks = useMemo(
    () => tasks.filter((task) => showCompleted || task.status !== 'completed'),
    [tasks, showCompleted]
  );
  const hasHiddenCompleted = useMemo(
    () => !showCompleted && tasks.some((task) => task.status === 'completed'),
    [tasks, showCompleted]
  );
  const selectedTask = useMemo(
    () => (selectedTaskId ? findTaskById(tasks, selectedTaskId) : null),
    [selectedTaskId, tasks]
  );

  const toggleShowCompleted = () => setShowCompleted((prev) => !prev);
  const handleSelectTask = (task: TaskItem) => setSelectedTaskId(task.id);
  const handleAddSubtask = (parentId?: string) => {
    const pid = parentId ?? selectedTask?.id;
    if (!pid) return;
    setTaskDialog({ mode: 'create', parentId: pid });
  };
  const openExpandDialog = async (forTask?: TaskItem) => {
    const target = forTask ?? selectedTask;
    if (!target) return;
    // On iOS the sheet sets selectedTaskId so SubtaskPanel stays in sync
    if (forTask) setSelectedTaskId(forTask.id);
    setExpandDialog({ task: target, context: '', questions: FALLBACK_GUIDING_QUESTIONS, options: aiOptions });
    try {
      const generated = await service.getGuidingQuestions(target.title);
      setExpandDialog((prev) =>
        prev && prev.task.id === target.id ? { ...prev, questions: generated } : prev
      );
    } catch (error) {
      setStatus({ type: 'error', message: (error as Error).message });
    }
  };
  const openRefineDialog = (forTask?: TaskItem) => {
    const target = forTask ?? selectedTask;
    if (!target) return;
    if (forTask) setSelectedTaskId(forTask.id);
    setRefineDialog({ task: target, feedback: '', options: aiOptions });
  };
  const openSplitDialog = (forTask?: TaskItem) => {
    const target = forTask ?? selectedTask;
    if (!target || !target.subtasks.length) return;
    if (forTask) setSelectedTaskId(forTask.id);
    setSplitDialog({ task: target, instructions: '', options: aiOptions });
  };
  const handleEditSelectedTask = () => {
    if (!selectedTask) return;
    setTaskDialog({ mode: 'edit', parentId: selectedTask.parentId || null, task: selectedTask });
  };
  const handleDeleteSelectedTask = () => {
    if (!selectedTask) return;
    handleDeleteTask(selectedTask);
  };
  const handleEditSubtask = (subtask: TaskItem) => {
    setTaskDialog({ mode: 'edit', parentId: subtask.parentId || null, task: subtask });
  };
  const handleDeleteSubtask = (subtask: TaskItem) => {
    handleDeleteTask(subtask);
  };

  const handleSelectList = (id: string) => {
    setSidebarOpen(false);
    if (selectedListId === id) return;
    if (hasPendingChanges) {
      setPendingListSwitch(id);
      return;
    }
    setSelectedListId(id);
  };

  const handleConfirmListSwitch = async () => {
    const id = pendingListSwitch;
    setPendingListSwitch(null);
    if (!id) return;
    await discardLocalChanges({ suppressStatus: true, skipReload: true });
    setExpandDialog(null);
    setRefineDialog(null);
    setSplitDialog(null);
    setTaskDialog(null);
    setTasks([]);
    setSelectedTaskId(null);
    setSelectedListId(id);
  };

  const handlePageScroll = () => {
    const el = pagesRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    const list = lists[idx];
    if (list && list.id !== selectedListId) setSelectedListId(list.id);
  };

  // Use scrollend (fires after snap settles) so we don't update state mid-swipe.
  // Falls back to the onScroll handler on older WebKit.
  useEffect(() => {
    const el = pagesRef.current;
    if (!el || !isIOS) return;
    el.addEventListener('scrollend', handlePageScroll);
    return () => el.removeEventListener('scrollend', handlePageScroll);
  });

  useEffect(() => {
    if (!pagesRef.current || !isIOS) return;
    const idx = lists.findIndex((l) => l.id === selectedListId);
    if (idx >= 0) {
      pagesRef.current.scrollTo({ left: idx * pagesRef.current.clientWidth, behavior: 'smooth' });
    }
  }, [selectedListId, lists]);

  return (
    <div className="app-shell">
      {isIOS && (
        <nav className="mobile-nav">
          <button className="mobile-nav-btn" onClick={() => setMenuOpen(true)}>···</button>
          <span className="mobile-nav-title">
            {lists.find((l) => l.id === selectedListId)?.title ?? 'Tasks'}
          </span>
          <div className="mobile-nav-right">
            {!autoSync && pendingOperations.length > 0 && (
              <span className="pending-badge">{pendingOperations.length}</span>
            )}
            <button className="mobile-nav-btn" onClick={() => setTaskDialog({ mode: 'create', parentId: null })}>+</button>
          </div>
        </nav>
      )}
      {isIOS && lists.length > 1 && (
        <div className="page-dots">
          {lists.map((l) => (
            <div
              key={l.id}
              className={`page-dot${l.id === selectedListId ? ' active' : ''}`}
            />
          ))}
        </div>
      )}
      {/* Hamburger toggle — rendered in DOM always, visible only on mobile via CSS */}
      {!isIOS && (
        <button
          className="sidebar-toggle"
          aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setSidebarOpen((prev) => !prev)}
        >
          <span>Subtasker</span>
          <span className="sidebar-toggle-icon">{sidebarOpen ? '✕' : '☰'}</span>
        </button>
      )}
      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <header>Subtasker</header>
        <p className="small">Extend Google Tasks with AI-powered micro-steps.</p>
        <div className="task-lists">
          {lists.map((list) => (
            <button
              key={list.id}
              className={`task-list-button ${selectedListId === list.id ? 'active' : ''}`}
              onClick={() => handleSelectList(list.id)}
              disabled={isSyncing}
            >
              {list.title}
            </button>
          ))}
        </div>
        <button className="secondary" onClick={handleRefreshLists} disabled={isSyncing || hasPendingChanges}>
          Refresh Lists
        </button>
      </aside>
      <main className="main-panel">
        <StatusBanner status={status} onClear={() => setStatus(null)} />
        {!isIOS && (
          <div className="toolbar">
            <button onClick={handleSignIn} disabled={!clientSecretLoaded || isSignedIn}>
              {isSignedIn ? 'Signed In' : 'Sign In'}
            </button>
            <button className="secondary" onClick={handleSignOut} disabled={!isSignedIn}>
              Sign Out
            </button>
            <button onClick={() => setTaskDialog({ mode: 'create', parentId: null })} disabled={!selectedListId}>
              Add Task
            </button>
            <button className="secondary" onClick={openPreferences}>
              Preferences
            </button>
            <button
              className="secondary"
              onClick={handleDiscardChanges}
              disabled={!hasPendingChanges || isSyncing}
            >
              Discard Changes
            </button>
            <button
              className="secondary"
              onClick={handlePushChanges}
              disabled={!hasPendingChanges || aiBusy || isSyncing}
            >
              Push Changes
            </button>
          </div>
        )}
        {hasPendingChanges && (
          <div className="pending-indicator">
            {pendingOperations.length} change{pendingOperations.length === 1 ? '' : 's'} waiting to sync
          </div>
        )}
        <div className="content-header">
          <h2>{selectedListTitle || 'Select a task list to get started'}</h2>
          <button className="secondary" onClick={toggleShowCompleted}>
            {showCompleted ? 'Hide Completed' : 'Show Completed'}
          </button>
        </div>
        <div className="content-layout">
          {isIOS ? (
            <div
              className="list-pages"
              ref={pagesRef}
            >
              {lists.map((list) => {
                const listVisibleTasks = list.id === selectedListId
                  ? visibleTasks
                  : [];
                const listHasHiddenCompleted = list.id === selectedListId
                  ? hasHiddenCompleted
                  : false;
                return (
                  <div key={list.id} className="list-page">
                    {isLoading && list.id === selectedListId ? (
                      <div className="page-loading"><span className="page-loading-spinner" /></div>
                    ) : (
                      <TaskList
                        tasks={listVisibleTasks}
                        selectedTaskId={selectedTaskId}
                        onSelect={handleSelectTask}
                        onEditTask={(task) => setTaskDialog({ mode: 'edit', parentId: task.parentId || null, task })}
                        onDeleteTask={handleDeleteTask}
                        onToggleComplete={handleToggleComplete}
                        hasHiddenCompleted={listHasHiddenCompleted}
                        dirtyIds={dirtyIds}
                        onOpenSheet={setSheetTaskId}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <section className="tasks-panel">
              {isLoading ? (
                <div className="empty-state">
                  <p>Loading tasks…</p>
                </div>
              ) : (
                <TaskList
                  tasks={visibleTasks}
                  selectedTaskId={selectedTaskId}
                  onSelect={handleSelectTask}
                  onEditTask={(task) => setTaskDialog({ mode: 'edit', parentId: task.parentId || null, task })}
                  onDeleteTask={handleDeleteTask}
                  onToggleComplete={handleToggleComplete}
                  hasHiddenCompleted={hasHiddenCompleted}
                  dirtyIds={dirtyIds}
                  onOpenSheet={undefined}
                />
              )}
            </section>
          )}
          {!isIOS && (
            <SubtaskPanel
              task={selectedTask}
              showCompleted={showCompleted}
              onAddSubtask={handleAddSubtask}
              onExpand={openExpandDialog}
              onRefine={openRefineDialog}
              onSplit={openSplitDialog}
              onEditTask={handleEditSelectedTask}
              onDeleteTask={handleDeleteSelectedTask}
              onEditSubtask={handleEditSubtask}
              onDeleteSubtask={handleDeleteSubtask}
              aiProgress={aiProgress}
              aiBusy={aiBusy}
              aiTaskId={aiTaskId}
              dirtyIds={dirtyIds}
              syncing={isSyncing}
            />
          )}
        </div>
      </main>
      <TaskDialog state={taskDialog} onClose={() => setTaskDialog(null)} onSubmit={handleCreateOrUpdateTask} />
      <ExpandDialog
        state={expandDialog}
        onClose={() => setExpandDialog(null)}
        onSubmit={handleExpand}
        onOptionsChange={(opts) => {
          setAiOptions(opts);
          setExpandDialog((prev) => (prev ? { ...prev, options: opts } : prev));
        }}
      />
      <RefineDialog
        state={refineDialog}
        onClose={() => setRefineDialog(null)}
        onSubmit={(feedback, task, opts) => handleAIReplaceSubtasks('refine', feedback, task, opts)}
        onOptionsChange={(opts) => {
          setAiOptions(opts);
          setRefineDialog((prev) => (prev ? { ...prev, options: opts } : prev));
        }}
      />
      <SplitDialog
        state={splitDialog}
        onClose={() => setSplitDialog(null)}
        onSubmit={(instructions, task, opts) => handleAIReplaceSubtasks('split', instructions, task, opts)}
        onOptionsChange={(opts) => {
          setAiOptions(opts);
          setSplitDialog((prev) => (prev ? { ...prev, options: opts } : prev));
        }}
      />
      <PreferencesDialog
        state={preferences}
        onChange={(updates) => setPreferences((prev) => ({ ...prev, ...updates }))}
        onSave={handleSavePreferences}
        onClose={closePreferences}
        onLoadClientSecret={handleLoadSecret}
        clientSecretLoaded={clientSecretLoaded}
        autoSync={autoSync}
        onAutoSyncChange={setAutoSync}
      />
      {deleteConfirmTask && (
        <ConfirmDialog
          message={`Delete "${deleteConfirmTask.title}"${deleteConfirmTask.subtasks.length ? ' and its subtasks' : ''}?`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteConfirmTask(null)}
        />
      )}
      {pendingListSwitch && (
        <ConfirmDialog
          message={`Discard ${pendingOperations.length} unsynced change${pendingOperations.length === 1 ? '' : 's'}? This cannot be undone.`}
          confirmLabel="Discard"
          onConfirm={() => { void handleConfirmListSwitch(); }}
          onCancel={() => setPendingListSwitch(null)}
        />
      )}
      {isIOS && menuOpen && (
        <MobileMenu
          isSignedIn={isSignedIn}
          userEmail={null}
          hasPendingChanges={hasPendingChanges}
          pendingCount={pendingOperations.length}
          isSyncing={isSyncing}
          aiBusy={aiBusy}
          showCompleted={showCompleted}
          onClose={() => setMenuOpen(false)}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          onOpenPreferences={openPreferences}
          onToggleShowCompleted={() => setShowCompleted(v => !v)}
          onRefreshLists={handleRefreshLists}
          onPushChanges={handlePushChanges}
          onDiscardChanges={handleDiscardChanges}
        />
      )}
      {isIOS && sheetTaskId && (() => {
        const sheetTask = findTaskById(tasks, sheetTaskId);
        if (!sheetTask) return null;
        return (
          <MobileTaskSheet
            task={sheetTask}
            allTasks={tasks}
            onClose={() => setSheetTaskId(null)}
            onEditTask={(t) => {
              setSheetTaskId(null);
              setTaskDialog({ mode: 'edit', parentId: t.parentId || null, task: t });
            }}
            onDeleteTask={(t) => {
              setSheetTaskId(null);
              handleDeleteTask(t);
            }}
            onToggleComplete={handleToggleComplete}
            onAddSubtask={(parentId) => {
              setSheetTaskId(null);
              setTaskDialog({ mode: 'create', parentId });
            }}
            onExpand={() => {
              setSheetTaskId(null);
              void openExpandDialog(sheetTask);
            }}
            onRefine={() => {
              setSheetTaskId(null);
              openRefineDialog(sheetTask);
            }}
            onSplit={() => {
              setSheetTaskId(null);
              openSplitDialog(sheetTask);
            }}
            aiBusy={aiBusy}
            aiProgress={aiProgress}
            dirtyIds={dirtyIds}
          />
        );
      })()}
    </div>
  );
};

export default App;
