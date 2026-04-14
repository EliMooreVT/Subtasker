'use strict';

jest.mock('../packages/core/store', () => ({
  getOpenAiKey: jest.fn(),
  getOpenAiContext: jest.fn(),
}));

jest.mock('../packages/core/logger', () => ({
  logError: jest.fn(),
}));

const mockCreate = jest.fn();
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }));
});

jest.mock('jsonrepair', () => ({
  jsonrepair: jest.fn((input) => input),
}));

function makeCompletion(content) {
  return { choices: [{ message: { content } }] };
}

describe('openaiClient', () => {
  let openaiClient;
  let getOpenAiKey;
  let getOpenAiContext;
  let jsonrepair;

  beforeEach(() => {
    // With resetModules:true each require() gets a fresh module registry.
    // Re-require all mocked modules so we hold the current mock instances.
    ({ getOpenAiKey, getOpenAiContext } = require('../packages/core/store'));
    ({ jsonrepair } = require('jsonrepair'));
    getOpenAiKey.mockReturnValue('sk-test-key');
    getOpenAiContext.mockReturnValue('');
    openaiClient = require('../packages/core/openaiClient');
  });

  describe('expandTask', () => {
    const baseArgs = {
      taskTitle: 'Write report',
      taskNotes: 'Q1 summary',
      userContext: 'For my manager',
      options: { length: 'short', style: 'simple' },
    };

    it('should return parentTitle and cleaned subtasks on a valid JSON response', async () => {
      const payload = {
        parentTitle: 'Write Q1 report',
        subtasks: [
          { title: 'Gather data', notes: 'Done when spreadsheet is complete' },
          { title: 'Write draft', notes: 'Done when first draft is saved' },
        ],
      };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      const result = await openaiClient.expandTask(baseArgs);

      expect(result.parentTitle).toBe('Write Q1 report');
      expect(result.subtasks).toHaveLength(2);
      expect(result.subtasks[0]).toEqual({
        title: 'Gather data',
        notes: 'Done when spreadsheet is complete',
      });
    });

    it('should strip markdown code fences from the response before parsing', async () => {
      const inner = JSON.stringify({
        parentTitle: 'Fenced task',
        subtasks: [{ title: 'Step one', notes: 'Done when step one is done' }],
      });
      mockCreate.mockResolvedValue(makeCompletion('```json\n' + inner + '\n```'));

      const result = await openaiClient.expandTask(baseArgs);

      expect(result.subtasks[0].title).toBe('Step one');
    });

    it('should use jsonrepair when the response is malformed JSON', async () => {
      const repaired = JSON.stringify({
        parentTitle: null,
        subtasks: [{ title: 'Repaired step', notes: 'Done when fixed' }],
      });
      mockCreate.mockResolvedValue(makeCompletion('{broken json'));
      jsonrepair.mockReturnValueOnce(repaired);

      const result = await openaiClient.expandTask(baseArgs);

      expect(result.subtasks[0].title).toBe('Repaired step');
      expect(jsonrepair).toHaveBeenCalledWith('{broken json');
    });

    it('should throw when both JSON.parse and jsonrepair fail', async () => {
      mockCreate.mockResolvedValue(makeCompletion('{still broken'));
      jsonrepair.mockReturnValueOnce('{still broken');

      await expect(openaiClient.expandTask(baseArgs)).rejects.toThrow(
        'Failed to read AI response'
      );
    });

    it('should throw when the response is empty', async () => {
      mockCreate.mockResolvedValue(makeCompletion(''));

      await expect(openaiClient.expandTask(baseArgs)).rejects.toThrow(
        'Empty response from AI'
      );
    });

    it('should throw when the response is null', async () => {
      mockCreate.mockResolvedValue(makeCompletion(null));

      await expect(openaiClient.expandTask(baseArgs)).rejects.toThrow(
        'Empty response from AI'
      );
    });

    it('should throw when the subtasks field is missing', async () => {
      mockCreate.mockResolvedValue(
        makeCompletion(JSON.stringify({ parentTitle: 'No subtasks here' }))
      );

      await expect(openaiClient.expandTask(baseArgs)).rejects.toThrow(
        'Missing subtasks array in AI response'
      );
    });

    it('should throw when the subtasks array is not an array', async () => {
      mockCreate.mockResolvedValue(
        makeCompletion(JSON.stringify({ parentTitle: 'Bad', subtasks: 'string' }))
      );

      await expect(openaiClient.expandTask(baseArgs)).rejects.toThrow(
        'Missing subtasks array in AI response'
      );
    });

    it('should throw when all subtasks have empty titles after trimming', async () => {
      mockCreate.mockResolvedValue(
        makeCompletion(JSON.stringify({ subtasks: [{ title: '   ', notes: '' }] }))
      );

      await expect(openaiClient.expandTask(baseArgs)).rejects.toThrow(
        'AI response did not contain any subtasks'
      );
    });

    it('should filter out subtask entries that have no title', async () => {
      const payload = {
        parentTitle: 'Filtered',
        subtasks: [
          { title: '', notes: 'orphan note' },
          { title: 'Valid step', notes: 'Done when done' },
        ],
      };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      const result = await openaiClient.expandTask(baseArgs);

      expect(result.subtasks).toHaveLength(1);
      expect(result.subtasks[0].title).toBe('Valid step');
    });

    it('should trim whitespace from title and notes', async () => {
      const payload = {
        parentTitle: '  Trimmed  ',
        subtasks: [{ title: '  Step one  ', notes: '  Some notes  ' }],
      };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      const result = await openaiClient.expandTask(baseArgs);

      expect(result.parentTitle).toBe('Trimmed');
      expect(result.subtasks[0].title).toBe('Step one');
      expect(result.subtasks[0].notes).toBe('Some notes');
    });

    it('should return null parentTitle when the field is not a string', async () => {
      const payload = {
        parentTitle: 42,
        subtasks: [{ title: 'Step', notes: 'note' }],
      };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      const result = await openaiClient.expandTask(baseArgs);

      expect(result.parentTitle).toBeNull();
    });

    it('should throw when no API key is configured', async () => {
      getOpenAiKey.mockReturnValue(null);

      await expect(openaiClient.expandTask(baseArgs)).rejects.toThrow(
        'Add an OpenAI API key'
      );
    });

    it('should pass long options into the prompt and call the API', async () => {
      const payload = {
        parentTitle: 'Long task',
        subtasks: [{ title: 'Step', notes: 'Done when done' }],
      };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      await openaiClient.expandTask({ ...baseArgs, options: { length: 'long', style: 'comprehensive' } });

      const callArgs = mockCreate.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m) => m.role === 'user').content;
      expect(userMessage).toMatch(/roughly 10 subtasks/);
      expect(userMessage).toMatch(/context or review checkpoints/);
    });

    it('should call the OpenAI API with json_object response format', async () => {
      const payload = {
        parentTitle: null,
        subtasks: [{ title: 'Step', notes: 'Done when done' }],
      };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      await openaiClient.expandTask(baseArgs);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: { type: 'json_object' },
          max_tokens: 600,
        })
      );
    });
  });

  describe('refineSubtasks', () => {
    const existingSubtasks = [
      { title: 'Draft outline', notes: 'Done when outline is approved' },
      { title: 'Write body', notes: 'Done when body is complete' },
    ];
    const baseArgs = {
      taskTitle: 'Write report',
      currentSubtasks: existingSubtasks,
      feedback: 'Make the steps more granular',
      options: { length: 'short', style: 'simple' },
    };

    it('should return refined subtasks on a valid response', async () => {
      const payload = {
        parentTitle: 'Write report v2',
        subtasks: [
          { title: 'Draft section headers', notes: 'Done when headers are listed' },
          { title: 'Write intro', notes: 'Done when intro is 200 words' },
          { title: 'Write conclusion', notes: 'Done when conclusion is drafted' },
        ],
      };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      const result = await openaiClient.refineSubtasks(baseArgs);

      expect(result.subtasks).toHaveLength(3);
      expect(result.parentTitle).toBe('Write report v2');
    });

    it('should include existing subtask titles in the prompt', async () => {
      const payload = { parentTitle: null, subtasks: [{ title: 'Step', notes: 'n' }] };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      await openaiClient.refineSubtasks(baseArgs);

      const userContent = mockCreate.mock.calls[0][0].messages.find(
        (m) => m.role === 'user'
      ).content;
      expect(userContent).toContain('Draft outline');
      expect(userContent).toContain('Write body');
    });

    it('should include feedback text in the prompt', async () => {
      const payload = { parentTitle: null, subtasks: [{ title: 'Step', notes: 'n' }] };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      await openaiClient.refineSubtasks(baseArgs);

      const userContent = mockCreate.mock.calls[0][0].messages.find(
        (m) => m.role === 'user'
      ).content;
      expect(userContent).toContain('Make the steps more granular');
    });

    it('should throw when the API returns an empty response', async () => {
      mockCreate.mockResolvedValue(makeCompletion(null));

      await expect(openaiClient.refineSubtasks(baseArgs)).rejects.toThrow(
        'Empty response from AI'
      );
    });
  });

  describe('splitSubtasks', () => {
    const baseArgs = {
      taskTitle: 'Deploy feature',
      currentSubtasks: [
        { title: 'Write tests', notes: 'Done when coverage > 80%' },
      ],
      instructions: 'Split into smaller CI steps',
      options: { length: 'long', style: 'simple' },
    };

    it('should return split subtasks on a valid response', async () => {
      const payload = {
        parentTitle: null,
        subtasks: [
          { title: 'Run unit tests', notes: 'Done when tests pass' },
          { title: 'Run integration tests', notes: 'Done when pipeline is green' },
        ],
      };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      const result = await openaiClient.splitSubtasks(baseArgs);

      expect(result.subtasks).toHaveLength(2);
    });

    it('should use long-length wording in the prompt when options.length is long', async () => {
      const payload = { parentTitle: null, subtasks: [{ title: 'Step', notes: 'n' }] };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      await openaiClient.splitSubtasks(baseArgs);

      const userContent = mockCreate.mock.calls[0][0].messages.find(
        (m) => m.role === 'user'
      ).content;
      expect(userContent).toMatch(/around 10 micro-steps/);
    });

    it('should throw when the subtasks array is empty after filtering', async () => {
      mockCreate.mockResolvedValue(
        makeCompletion(JSON.stringify({ subtasks: [{ title: '', notes: '' }] }))
      );

      await expect(openaiClient.splitSubtasks(baseArgs)).rejects.toThrow(
        'AI response did not contain any subtasks'
      );
    });
  });

  describe('generateGuidingQuestions', () => {
    it('should return an array of question strings', async () => {
      const payload = {
        questions: ['What is the goal?', 'Who is the audience?', 'What is the deadline?'],
      };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      const result = await openaiClient.generateGuidingQuestions('Write a proposal');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(3);
      expect(result[0]).toBe('What is the goal?');
    });

    it('should return at most 5 questions even when the model returns more', async () => {
      const payload = {
        questions: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'],
      };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      const result = await openaiClient.generateGuidingQuestions('Big task');

      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should trim whitespace from each question', async () => {
      const payload = { questions: ['  Is this right?  ', '  What next?  '] };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      const result = await openaiClient.generateGuidingQuestions('Some task');

      expect(result[0]).toBe('Is this right?');
      expect(result[1]).toBe('What next?');
    });

    it('should filter out non-string entries from the questions array', async () => {
      const payload = { questions: ['Valid question?', null, 42, 'Another question?'] };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      const result = await openaiClient.generateGuidingQuestions('Task');

      expect(result).toEqual(['Valid question?', 'Another question?']);
    });

    it('should throw when the response is empty', async () => {
      mockCreate.mockResolvedValue(makeCompletion(null));

      await expect(
        openaiClient.generateGuidingQuestions('Some task')
      ).rejects.toThrow('Empty response from AI');
    });

    it('should throw when the questions field is missing', async () => {
      mockCreate.mockResolvedValue(
        makeCompletion(JSON.stringify({ answers: ['not questions'] }))
      );

      await expect(
        openaiClient.generateGuidingQuestions('Some task')
      ).rejects.toThrow('AI response missing questions array');
    });

    it('should throw when the questions array contains no valid strings', async () => {
      const payload = { questions: [null, 42, '', '   '] };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      await expect(
        openaiClient.generateGuidingQuestions('Task')
      ).rejects.toThrow('AI response did not contain questions');
    });

    it('should include the task title in the prompt', async () => {
      const payload = { questions: ['Why?', 'How?', 'When?'] };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      await openaiClient.generateGuidingQuestions('Deploy the service');

      const userContent = mockCreate.mock.calls[0][0].messages.find(
        (m) => m.role === 'user'
      ).content;
      expect(userContent).toContain('Deploy the service');
    });

    it('should prepend stored context to the prompt when context is set', async () => {
      getOpenAiContext.mockReturnValue('I work in DevOps');
      const payload = { questions: ['Q1', 'Q2', 'Q3'] };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      await openaiClient.generateGuidingQuestions('Deploy service');

      const userContent = mockCreate.mock.calls[0][0].messages.find(
        (m) => m.role === 'user'
      ).content;
      expect(userContent).toContain('I work in DevOps');
    });

    it('should call the OpenAI API with max_tokens 200', async () => {
      const payload = { questions: ['Q?', 'Q2?', 'Q3?'] };
      mockCreate.mockResolvedValue(makeCompletion(JSON.stringify(payload)));

      await openaiClient.generateGuidingQuestions('Task');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 200 })
      );
    });
  });
});
