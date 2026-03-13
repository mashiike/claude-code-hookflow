import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { App } from '../app.js';
import { readState } from '../state.js';
import type { HookEvent } from '../hook-event.js';

function makeInput(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    session_id: 'sess-1',
    transcript_path: '/tmp/test.jsonl',
    cwd: '/tmp',
    ...overrides,
  });
}

const dummyEvent: HookEvent = {
  session_id: '',
  transcript_path: '',
  cwd: '',
  hook_event_name: '',
  _raw: {},
};

describe('App', () => {
  let tmpDir: string;
  let resolver: (event: HookEvent) => string;
  let app: App;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookflow-app-test-'));
    resolver = () => path.join(tmpDir, 'hookflow', 'state.json');
    app = new App(resolver);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeWorkflow(name: string, yaml: string): void {
    const hookflowsDir = path.join(tmpDir, '.claude', 'hookflows');
    fs.mkdirSync(hookflowsDir, { recursive: true });
    fs.writeFileSync(path.join(hookflowsDir, name), yaml);
  }

  function setupWithFile(fileSuffix: string): void {
    app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'test', cwd: tmpDir }));
    app.run(
      makeInput({
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: path.join(tmpDir, fileSuffix) },
        cwd: tmpDir,
      }),
    );
  }

  describe('UserPromptSubmit', () => {
    it('creates state with prompt info', () => {
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' }));

      const state = readState(dummyEvent, resolver);
      expect(state).not.toBeNull();
      expect(state!.session_id).toBe('sess-1');
      expect(state!.cwd).toBe('/tmp');
      expect(state!.changed_files).toEqual([]);
      expect(state!.current_prompt?.prompt).toBe('hello');
      expect(state!.last_run).toBeUndefined();
    });

    it('clears previous changed_files', () => {
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'first' }));
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { file_path: '/tmp/a.ts' },
        }),
      );
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'second' }));

      const state = readState(dummyEvent, resolver);
      expect(state!.changed_files).toEqual([]);
      expect(state!.current_prompt?.prompt).toBe('second');
    });
  });

  describe('PostToolUse', () => {
    it('appends file_path to changed_files', () => {
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'test' }));
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { file_path: '/tmp/a.ts' },
        }),
      );

      const state = readState(dummyEvent, resolver);
      // cwd=/tmp, file_path=/tmp/a.ts → 相対パス "a.ts" で記録
      expect(state!.changed_files).toEqual(['a.ts']);
    });

    it('deduplicates file paths', () => {
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'test' }));
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { file_path: '/tmp/a.ts' },
        }),
      );
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Edit',
          tool_input: { file_path: '/tmp/a.ts' },
        }),
      );

      const state = readState(dummyEvent, resolver);
      expect(state!.changed_files).toEqual(['a.ts']);
    });

    it('skips when no file_path', () => {
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'test' }));
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'ls' },
        }),
      );

      const state = readState(dummyEvent, resolver);
      expect(state!.changed_files).toEqual([]);
    });
  });

  describe('Stop', () => {
    it('skips when stop_hook_active is true', () => {
      writeWorkflow(
        'ts-check.yaml',
        `
name: "TS Check"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "echo ok"
`,
      );
      setupWithFile('a.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: true, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      expect(state!.last_run).toBeUndefined();
    });

    it('records workflow execution when workflows match', () => {
      writeWorkflow(
        'ts-check.yaml',
        `
name: "TS Check"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "echo ok"
`,
      );
      setupWithFile('src/index.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      expect(state!.last_run).toBeDefined();
      expect(state!.last_run!.trigger).toBe('Stop');
      expect(state!.last_run!.workflows['TS Check']).toBeDefined();
      expect(state!.last_run!.workflows['TS Check']!.status).toBe('success');
      expect(state!.last_run!.workflows['TS Check']!.matched_files).toEqual(['src/index.ts']);
      expect(state!.last_run!.workflows['TS Check']!.jobs['check']).toBeDefined();
    });

    it('logs no workflows when none defined', () => {
      const stderr: string[] = [];
      const originalWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Buffer): boolean => {
        stderr.push(chunk.toString());
        return true;
      }) as typeof process.stderr.write;

      try {
        setupWithFile('a.ts');
        app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));
        expect(stderr.join('')).toContain('no workflows defined');
      } finally {
        process.stderr.write = originalWrite;
      }
    });
  });

  describe('TaskCompleted', () => {
    it('records workflow execution', () => {
      writeWorkflow(
        'go-fmt.yaml',
        `
name: "Go Format"
paths:
  - "**/*.go"
jobs:
  fmt:
    steps:
      - run: "echo formatted"
`,
      );
      setupWithFile('main.go');
      app.run(makeInput({ hook_event_name: 'TaskCompleted', cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      expect(state!.last_run).toBeDefined();
      expect(state!.last_run!.trigger).toBe('TaskCompleted');
      expect(state!.last_run!.workflows['Go Format']!.status).toBe('success');
      expect(state!.last_run!.workflows['Go Format']!.matched_files).toEqual(['main.go']);
    });
  });

  describe('step execution', () => {
    it('executes shell command and records success', () => {
      writeWorkflow(
        'echo.yaml',
        `
name: "Echo"
paths:
  - "**/*.ts"
jobs:
  greet:
    steps:
      - run: "echo hello"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const job = state!.last_run!.workflows['Echo']!.jobs['greet']!;
      expect(job.status).toBe('success');
      expect(job.exit_code).toBe(0);
      expect(job.steps).toHaveLength(1);
      expect(job.steps![0]!.command).toBe('echo hello');
      expect(job.steps![0]!.stdout).toContain('hello');
    });

    it('records failure on non-zero exit', () => {
      writeWorkflow(
        'fail.yaml',
        `
name: "Fail"
paths:
  - "**/*.ts"
jobs:
  bad:
    steps:
      - run: "sh -c 'exit 1'"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const wf = state!.last_run!.workflows['Fail']!;
      expect(wf.status).toBe('failure');
      const job = wf.jobs['bad']!;
      expect(job.status).toBe('failure');
      expect(job.exit_code).toBe(1);
      expect(job.steps![0]!.status).toBe('failure');
    });

    it('stops at first failing step', () => {
      writeWorkflow(
        'multi.yaml',
        `
name: "Multi"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "sh -c 'exit 1'"
      - run: "echo should-not-run"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const job = state!.last_run!.workflows['Multi']!.jobs['check']!;
      expect(job.steps).toHaveLength(1);
      expect(job.steps![0]!.command).toBe("sh -c 'exit 1'");
    });
  });


  describe('SessionEnd', () => {
    it('removes state file', () => {
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'test' }));

      const state = readState(dummyEvent, resolver);
      expect(state).not.toBeNull();

      app.run(makeInput({ hook_event_name: 'SessionEnd' }));

      const stateAfter = readState(dummyEvent, resolver);
      expect(stateAfter).toBeNull();
    });
  });

  describe('unknown event', () => {
    it('does nothing for unknown events', () => {
      expect(() => app.run(makeInput({ hook_event_name: 'UnknownEvent' }))).not.toThrow();
    });
  });
});
