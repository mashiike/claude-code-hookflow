import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { App } from '../app.js';
import { readState, readFailedRun } from '../state.js';
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


  describe('template expressions', () => {
    it('expands \${{ state.trigger }} in run command', () => {
      writeWorkflow(
        'tmpl.yaml',
        `
name: "Tmpl"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "echo \${{ state.trigger }}"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const step = state!.last_run!.workflows['Tmpl']!.jobs['check']!.steps![0]!;
      expect(step.command).toBe('echo Stop');
      expect(step.stdout).toContain('Stop');
    });

    it('expands \${{ matched_files }} in run command', () => {
      writeWorkflow(
        'tmpl-files.yaml',
        `
name: "TmplFiles"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "echo \${{ matched_files }}"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const step = state!.last_run!.workflows['TmplFiles']!.jobs['check']!.steps![0]!;
      expect(step.command).toBe('echo src/app.ts');
      expect(step.stdout).toContain('src/app.ts');
    });

    it('skips step when if condition is false', () => {
      writeWorkflow(
        'tmpl-if.yaml',
        `
name: "TmplIf"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "echo should-skip"
        if: "\${{ state.trigger == 'TaskCompleted' }}"
      - run: "echo should-run"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const steps = state!.last_run!.workflows['TmplIf']!.jobs['check']!.steps!;
      expect(steps).toHaveLength(2);
      expect(steps[0]!.status).toBe('skipped');
      expect(steps[1]!.status).toBe('success');
      expect(steps[1]!.stdout).toContain('should-run');
    });

    it('runs step when if condition is true', () => {
      writeWorkflow(
        'tmpl-if-true.yaml',
        `
name: "TmplIfTrue"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "echo ran"
        if: "\${{ state.trigger == 'Stop' }}"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const steps = state!.last_run!.workflows['TmplIfTrue']!.jobs['check']!.steps!;
      expect(steps).toHaveLength(1);
      expect(steps[0]!.status).toBe('success');
      expect(steps[0]!.stdout).toContain('ran');
    });

    it('references previous step output via steps.<name>', () => {
      writeWorkflow(
        'tmpl-steps.yaml',
        `
name: "TmplSteps"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - name: greet
        run: "echo hello-world"
      - run: "echo \${{ steps.greet.stdout }}"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const steps = state!.last_run!.workflows['TmplSteps']!.jobs['check']!.steps!;
      expect(steps).toHaveLength(2);
      expect(steps[0]!.name).toBe('greet');
      expect(steps[1]!.stdout).toContain('hello-world');
    });

    it('records step name in state', () => {
      writeWorkflow(
        'tmpl-name.yaml',
        `
name: "TmplName"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - name: my-step
        run: "echo ok"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const step = state!.last_run!.workflows['TmplName']!.jobs['check']!.steps![0]!;
      expect(step.name).toBe('my-step');
    });

    it('expands matched_dirs as space-separated', () => {
      writeWorkflow(
        'tmpl-dirs.yaml',
        `
name: "TmplDirs"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "echo \${{ matched_dirs }}"
`,
      );
      // Add files in two different dirs
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'test', cwd: tmpDir }));
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { file_path: path.join(tmpDir, 'src/a.ts') },
          cwd: tmpDir,
        }),
      );
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { file_path: path.join(tmpDir, 'lib/b.ts') },
          cwd: tmpDir,
        }),
      );
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const step = state!.last_run!.workflows['TmplDirs']!.jobs['check']!.steps![0]!;
      expect(step.stdout).toContain('lib/');
      expect(step.stdout).toContain('src/');
    });
  });

  describe('each loop', () => {
    it('iterates over matched_files', () => {
      writeWorkflow(
        'each-files.yaml',
        `
name: "EachFiles"
paths:
  - "**/*.ts"
jobs:
  check:
    each: matched_files
    steps:
      - run: "echo \${{ each.value }}"
`,
      );
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'test', cwd: tmpDir }));
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { file_path: path.join(tmpDir, 'src/a.ts') },
          cwd: tmpDir,
        }),
      );
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { file_path: path.join(tmpDir, 'src/b.ts') },
          cwd: tmpDir,
        }),
      );
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const steps = state!.last_run!.workflows['EachFiles']!.jobs['check']!.steps!;
      expect(steps).toHaveLength(2);
      expect(steps[0]!.stdout).toContain('src/a.ts');
      expect(steps[1]!.stdout).toContain('src/b.ts');
    });

    it('iterates over matched_dirs', () => {
      writeWorkflow(
        'each-dirs.yaml',
        `
name: "EachDirs"
paths:
  - "**/*.ts"
jobs:
  fmt:
    each: matched_dirs
    steps:
      - run: "echo \${{ each.value }}"
`,
      );
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'test', cwd: tmpDir }));
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { file_path: path.join(tmpDir, 'src/a.ts') },
          cwd: tmpDir,
        }),
      );
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { file_path: path.join(tmpDir, 'lib/b.ts') },
          cwd: tmpDir,
        }),
      );
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const steps = state!.last_run!.workflows['EachDirs']!.jobs['fmt']!.steps!;
      expect(steps).toHaveLength(2);
      expect(steps[0]!.stdout).toContain('lib/');
      expect(steps[1]!.stdout).toContain('src/');
    });

    it('reports failure when one iteration fails', () => {
      writeWorkflow(
        'each-fail.yaml',
        `
name: "EachFail"
paths:
  - "**/*.ts"
jobs:
  check:
    each: matched_files
    steps:
      - run: "sh -c 'if [ \${{ each.value }} = src/bad.ts ]; then exit 1; else echo ok; fi'"
`,
      );
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'test', cwd: tmpDir }));
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { file_path: path.join(tmpDir, 'src/good.ts') },
          cwd: tmpDir,
        }),
      );
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { file_path: path.join(tmpDir, 'src/bad.ts') },
          cwd: tmpDir,
        }),
      );
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const job = state!.last_run!.workflows['EachFail']!.jobs['check']!;
      expect(job.status).toBe('failure');
    });
  });

  describe('continue: true step does not fail job', () => {
    it('job succeeds when failing step has continue: true', () => {
      writeWorkflow(
        'continue-step.yaml',
        `
name: "ContinueStep"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "sh -c 'exit 1'"
        continue: true
      - run: "echo should-run"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const job = state!.last_run!.workflows['ContinueStep']!.jobs['check']!;
      expect(job.status).toBe('success');
      expect(job.steps).toHaveLength(2);
      expect(job.steps![0]!.status).toBe('failure');
      expect(job.steps![0]!.continue).toBe(true);
      expect(job.steps![1]!.status).toBe('success');
    });

    it('job fails when non-continue step fails after continue step', () => {
      writeWorkflow(
        'mixed-continue.yaml',
        `
name: "MixedContinue"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "sh -c 'exit 1'"
        continue: true
      - run: "sh -c 'exit 2'"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const job = state!.last_run!.workflows['MixedContinue']!.jobs['check']!;
      expect(job.status).toBe('failure');
      expect(job.exit_code).toBe(2);
    });

    it('job-level continue cascades to steps', () => {
      writeWorkflow(
        'job-continue.yaml',
        `
name: "JobContinue"
paths:
  - "**/*.ts"
jobs:
  check:
    continue: true
    steps:
      - run: "sh -c 'exit 1'"
      - run: "echo should-run"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const state = readState(dummyEvent, resolver);
      const job = state!.last_run!.workflows['JobContinue']!.jobs['check']!;
      expect(job.status).toBe('success');
      expect(job.steps).toHaveLength(2);
    });

    it('workflow succeeds when all failures are continue: true', () => {
      writeWorkflow(
        'wf-continue.yaml',
        `
name: "WfContinue"
paths:
  - "**/*.ts"
jobs:
  lint:
    continue: true
    steps:
      - run: "sh -c 'exit 1'"
  test:
    steps:
      - run: "echo ok"
`,
      );
      setupWithFile('src/app.ts');
      const result = app.run(
        makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }),
      );

      const state = readState(dummyEvent, resolver);
      expect(state!.last_run!.workflows['WfContinue']!.status).toBe('success');
      expect(result).toBeUndefined();
    });

    it('blocks when a non-continue job fails', () => {
      writeWorkflow(
        'block-fail.yaml',
        `
name: "BlockFail"
paths:
  - "**/*.ts"
stop_reason: "checks failed"
jobs:
  lint:
    continue: true
    steps:
      - run: "sh -c 'exit 1'"
  test:
    steps:
      - run: "sh -c 'exit 1'"
`,
      );
      setupWithFile('src/app.ts');
      const result = app.run(
        makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }),
      );

      expect(result).toBeDefined();
      expect(result!.exitCode).toBe(0);
      const stdout = JSON.parse(result!.stdout!);
      expect(stdout.decision).toBe('block');
    });
  });

  describe('failed run backup', () => {
    it('saves failed run on workflow failure', () => {
      writeWorkflow(
        'fail-backup.yaml',
        `
name: "FailBackup"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "sh -c 'exit 1'"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const failedState = readFailedRun(dummyEvent, resolver);
      expect(failedState).not.toBeNull();
      expect(failedState!.last_run).toBeDefined();
      expect(failedState!.last_run!.workflows['FailBackup']!.status).toBe('failure');
    });

    it('does not save failed run on success', () => {
      writeWorkflow(
        'success-no-backup.yaml',
        `
name: "SuccessNoBackup"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "echo ok"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      const failedState = readFailedRun(dummyEvent, resolver);
      expect(failedState).toBeNull();
    });

    it('injects previous failure as systemMessage on next UserPromptSubmit', () => {
      writeWorkflow(
        'fail-inject.yaml',
        `
name: "FailInject"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "sh -c 'echo lint-error >&2; exit 1'"
        stop_reason: "lint failed"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      // Next UserPromptSubmit should return the failure info
      const result = app.run(
        makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'fix it', cwd: tmpDir }),
      );

      expect(result).toBeDefined();
      const stdout = JSON.parse(result!.stdout!);
      expect(stdout.continue).toBe(true);
      expect(stdout.systemMessage).toContain('previous run had failures');
      expect(stdout.systemMessage).toContain('FailInject');
      expect(stdout.systemMessage).toContain('lint failed');

      // Failed run should be cleaned up
      const failedState = readFailedRun(dummyEvent, resolver);
      expect(failedState).toBeNull();
    });

    it('second UserPromptSubmit has no failure info', () => {
      writeWorkflow(
        'fail-once.yaml',
        `
name: "FailOnce"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "sh -c 'exit 1'"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      // First UserPromptSubmit returns failure info
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'fix', cwd: tmpDir }));

      // Second UserPromptSubmit should have no failure info
      const result = app.run(
        makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'next task', cwd: tmpDir }),
      );
      expect(result).toBeUndefined();
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

    it('removes failed run file on SessionEnd', () => {
      writeWorkflow(
        'fail-session.yaml',
        `
name: "FailSession"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "sh -c 'exit 1'"
`,
      );
      setupWithFile('src/app.ts');
      app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false, cwd: tmpDir }));

      // Failed run should exist
      expect(readFailedRun(dummyEvent, resolver)).not.toBeNull();

      app.run(makeInput({ hook_event_name: 'SessionEnd' }));

      // Both state and failed run should be gone
      expect(readState(dummyEvent, resolver)).toBeNull();
      expect(readFailedRun(dummyEvent, resolver)).toBeNull();
    });
  });

  describe('unknown event', () => {
    it('does nothing for unknown events', () => {
      expect(() => app.run(makeInput({ hook_event_name: 'UnknownEvent' }))).not.toThrow();
    });
  });
});
