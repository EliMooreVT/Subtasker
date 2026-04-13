const OpenAI = require('openai');
const { getOpenAiKey, getOpenAiContext } = require('./store');

const { jsonrepair } = require('jsonrepair');
const { logError } = require('./logger');

const DEFAULT_MODEL = 'gpt-4o-mini';

function getClient() {
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    throw new Error('Add an OpenAI API key to use AI features.');
  }
  return new OpenAI({ apiKey });
}

function buildExpandPrompt(taskTitle, taskNotes, guidingAnswers, options) {
  const lengthLine = options.length === 'long'
    ? 'Return roughly 10 subtasks so the user can plan a longer sequence. '
    : 'Return roughly 5 subtasks to keep the plan short. ';
  const styleLine = options.style === 'comprehensive'
    ? 'Steps should include context or review checkpoints when helpful.'
    : 'Keep every step direct and action-oriented without extra commentary.';

  return `${lengthLine}${styleLine} Respond with JSON shaped as { "parentTitle": string, "subtasks": [ { "title": string, "notes": string } ... ] }. ` +
    `Only update parentTitle if you can make it clearer; otherwise keep the original. ` +
    `Each subtask must take 2-8 minutes, include a "done when" statement in notes, avoid vague verbs, and stay practical. ` +
    `If information is missing, begin with a confirm/check step under three minutes.\n` +
    `Parent task: ${taskTitle}.\n` +
    `Task notes: ${taskNotes || 'None provided.'}\n` +
    `User context: ${guidingAnswers || 'No extra context.'}`;
}

function buildRefinePrompt(taskTitle, currentSubtasks, feedback, options) {
  const subtasksText = currentSubtasks
    .map((task, index) => `${index + 1}. ${task.title} (notes: ${task.notes || 'n/a'})`)
    .join('\n');
  const lengthLine = options.length === 'long'
    ? 'Aim for up to 10 focused subtasks after refinement. '
    : 'Aim for about 5 focused subtasks after refinement. ';
  const styleLine = options.style === 'comprehensive'
    ? 'Feel free to layer in quick reviews or double-checks when it helps.'
    : 'Keep every step direct and to-the-point.';

  return `${lengthLine}${styleLine} Refine the provided subtasks according to the feedback while keeping the plan concise and minimally changed. ` +
    `Every subtask must retain a "done when" statement and remain within the 2-8 minute window. ` +
    `Respond with JSON shaped as { "parentTitle": string, "subtasks": [ { "title": string, "notes": string } ... ] }. ` +
    `Only adjust parentTitle if it improves clarity for the revised plan.\n` +
    `Parent task: ${taskTitle}.\nCurrent subtasks:\n${subtasksText || 'None provided.'}\nFeedback: ${feedback}.`;
}

function normalizeJson(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const endFence = trimmed.lastIndexOf('```');
    if (endFence > 0) {
      return trimmed.substring(trimmed.indexOf('\n') + 1, endFence).trim();
    }
  }
  return trimmed;
}

function extractSubtasksFromResponse(raw) {
  if (!raw) {
    throw new Error('Empty response from AI');
  }

  const normalized = normalizeJson(raw);
  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    try {
      parsed = JSON.parse(jsonrepair(normalized));
    } catch (repairError) {
      throw new Error(`Failed to read AI response: ${repairError.message}`);
    }
  }

  const parentTitle = typeof parsed.parentTitle === 'string' ? parsed.parentTitle.trim() : null;

  if (!parsed.subtasks || !Array.isArray(parsed.subtasks)) {
    logError('AI response missing subtasks array', new Error(normalized));
    throw new Error('Missing subtasks array in AI response');
  }

  const cleaned = parsed.subtasks
    .map((item) => ({
      title: (item.title || '').trim(),
      notes: (item.notes || '').trim()
    }))
    .filter((item) => item.title);

  if (!cleaned.length) {
    logError('AI response empty subtasks list', new Error(normalized));
    throw new Error('AI response did not contain any subtasks');
  }

  return {
    parentTitle,
    subtasks: cleaned
  };
}

async function expandTask({ taskTitle, taskNotes, userContext, options }) {
  const client = getClient();
  const prompt = buildExpandPrompt(taskTitle, taskNotes, `${getOpenAiContext() || ''}\n${userContext || ''}`, options);
  const completion = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system', content: 'You output only JSON that matches the requested format.' },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 600
  });

  const content = completion.choices?.[0]?.message?.content;
  return extractSubtasksFromResponse(content);
}

async function refineSubtasks({ taskTitle, currentSubtasks, feedback, options }) {
  const client = getClient();
  const prompt = buildRefinePrompt(taskTitle, currentSubtasks, `${getOpenAiContext() || ''}\n${feedback}`, options);
  const completion = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system', content: 'You output only JSON that matches the requested format.' },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 600
  });

  const content = completion.choices?.[0]?.message?.content;
  return extractSubtasksFromResponse(content);
}

function buildQuestionPrompt(taskTitle) {
  const context = getOpenAiContext() || '';
  const contextSnippet = context ? `Use this background context: ${context}. ` : '';
  return contextSnippet +
    `You are assisting a user in preparing to break down a task. ` +
    `Generate three short guiding questions that will help gather context before expanding the task into subtasks. ` +
    `Provide output as JSON: { "questions": [string, string, string] }. Each question should be concise, actionable, and focused on details that clarify the task "${taskTitle}".`;
}

function parseQuestions(raw) {
  if (!raw) {
    throw new Error('Empty response from AI');
  }
  const normalized = normalizeJson(raw);
  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    parsed = JSON.parse(jsonrepair(normalized));
  }
  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    throw new Error('AI response missing questions array');
  }
  const questions = parsed.questions
    .map((question) => (typeof question === 'string' ? question.trim() : ''))
    .filter(Boolean);
  if (!questions.length) {
    throw new Error('AI response did not contain questions');
  }
  return questions.slice(0, 5);
}


function buildSplitPrompt(taskTitle, currentSubtasks, instructions, options) {
  const subtasksText = currentSubtasks
    .map((task, index) => `${index + 1}. ${task.title} (notes: ${task.notes || 'n/a'})`)
    .join('\n');
  const lengthLine = options.length === 'long'
    ? 'Split the tasks so the final list has around 10 micro-steps.'
    : 'Split the tasks so the final list has around 5 micro-steps.';
  const styleLine = options.style === 'comprehensive'
    ? 'It is okay to add quick review/check-in steps where helpful.'
    : 'Keep every new step crisp and action-oriented.';
  return `${lengthLine} ${styleLine} Respond with JSON shaped as { "parentTitle": string, "subtasks": [ { "title": string, "notes": string } ... ] }. ` +
    `Each resulting step should take 2-5 minutes and include a "done when" note. ` +
    `Split or extend the provided subtasks rather than inventing unrelated work.` +
    `\nParent task: ${taskTitle}.` +
    `\nExisting subtasks:\n${subtasksText || 'None provided.'}` +
    `\nAdditional guidance: ${instructions || 'None'}.`;
}

async function splitSubtasks({ taskTitle, currentSubtasks, instructions, options }) {
  const client = getClient();
  const prompt = buildSplitPrompt(
    taskTitle,
    currentSubtasks,
    `${getOpenAiContext() || ''}\n${instructions || ''}`,
    options
  );
  const completion = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system', content: 'You output only JSON that matches the requested format.' },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 600
  });
  const content = completion.choices?.[0]?.message?.content;
  return extractSubtasksFromResponse(content);
}

async function generateGuidingQuestions(taskTitle) {
  const client = getClient();
  const prompt = buildQuestionPrompt(taskTitle);
  const completion = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system', content: 'You return JSON only.' },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 200
  });
  const content = completion.choices?.[0]?.message?.content;
  return parseQuestions(content);
}

module.exports = {
  expandTask,
  refineSubtasks,
  splitSubtasks,
  generateGuidingQuestions
};
