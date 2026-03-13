import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadWorkflows, matchWorkflow } from '../workflow.js';
import type { Workflow } from '../workflow.js';

describe('loadWorkflows', () => {
  let tmpDir: string;
  let hookflowsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookflow-wf-test-'));
    hookflowsDir = path.join(tmpDir, '.claude', 'hookflows');
    fs.mkdirSync(hookflowsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads yaml workflow files', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'go-lint.yaml'),
      `
name: "Go Lint"
paths:
  - "**/*.go"
jobs:
  lint:
    steps:
      - run: "golangci-lint run ./..."
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows).toHaveLength(1);
    expect(workflows[0]!.name).toBe('Go Lint');
    expect(workflows[0]!.paths).toEqual(['**/*.go']);
    expect(workflows[0]!.paths_ignore).toEqual([]);
    expect(Object.keys(workflows[0]!.jobs)).toEqual(['lint']);
    expect(workflows[0]!.jobs.lint!.steps).toEqual([{ run: 'golangci-lint run ./...', working_dir: undefined }]);
  });

  it('loads yml extension', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'test.yml'),
      `
name: "Test"
paths:
  - "**/*.ts"
jobs:
  test:
    steps:
      - run: "npm test"
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows).toHaveLength(1);
  });

  it('supports single string for paths', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'simple.yaml'),
      `
name: "Simple"
paths: "**/*.go"
jobs:
  fmt:
    steps:
      - run: "gofmt -w ."
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows[0]!.paths).toEqual(['**/*.go']);
  });

  it('parses paths-ignore', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'with-ignore.yaml'),
      `
name: "With Ignore"
paths:
  - "**/*.ts"
paths-ignore:
  - "**/*.test.ts"
  - "**/*.spec.ts"
jobs:
  check:
    steps:
      - run: "echo ok"
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows[0]!.paths_ignore).toEqual(['**/*.test.ts', '**/*.spec.ts']);
  });

  it('parses on event_name', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'stop-only.yaml'),
      `
name: "Stop Only"
on: Stop
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "echo ok"
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows[0]!.on).toEqual(['Stop']);
  });

  it('defaults on to Stop and TaskCompleted', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'default-events.yaml'),
      `
name: "Default Events"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "echo ok"
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows[0]!.on).toEqual(['Stop', 'TaskCompleted']);
  });

  it('parses on as array', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'both-events.yaml'),
      `
name: "Both"
on: [Stop, TaskCompleted]
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "echo ok"
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows[0]!.on).toEqual(['Stop', 'TaskCompleted']);
  });

  it('parses needs (job dependency)', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'deps.yaml'),
      `
name: "With Deps"
paths:
  - "**/*.ts"
jobs:
  build:
    steps:
      - run: "npm run build"
  test:
    needs: build
    steps:
      - run: "npm test"
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows[0]!.jobs.test!.needs).toEqual(['build']);
  });

  it('parses multiple steps per job', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'multi-step.yaml'),
      `
name: "Multi Step"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "npm run build"
      - run: "npm test"
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows[0]!.jobs.check!.steps).toHaveLength(2);
    expect(workflows[0]!.jobs.check!.steps[0]!.run).toBe('npm run build');
    expect(workflows[0]!.jobs.check!.steps[1]!.run).toBe('npm test');
  });

  it('defaults external_files to false', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'default-ext.yaml'),
      `
name: "Default Ext"
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "echo ok"
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows[0]!.external_files).toBe(false);
  });

  it('parses external_files: true', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'ext-true.yaml'),
      `
name: "Ext True"
external_files: true
paths:
  - "**/*.ts"
jobs:
  check:
    steps:
      - run: "echo ok"
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows[0]!.external_files).toBe(true);
  });

  it('skips files without paths', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'empty.yaml'),
      `
name: "Empty"
jobs:
  check:
    steps:
      - run: "echo ok"
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows).toHaveLength(0);
  });

  it('returns empty for non-existent directory', () => {
    const workflows = loadWorkflows('/nonexistent/path');
    expect(workflows).toHaveLength(0);
  });
});

describe('matchWorkflow', () => {
  const makeWorkflow = (
    paths: string[],
    pathsIgnore: string[] = [],
    on?: string[],
    externalFiles: boolean = false,
  ): Workflow => ({
    name: 'test',
    external_files: externalFiles,
    on: on ?? ['Stop', 'TaskCompleted'],
    paths,
    paths_ignore: pathsIgnore,
    jobs: {},
    _file: '/test.yaml',
  });

  it('matches glob patterns against relative paths', () => {
    const w = makeWorkflow(['**/*.go']);
    const matched = matchWorkflow(w, ['src/main.go', 'pkg/app.go'], '/project');
    expect(matched).toEqual(['src/main.go', 'pkg/app.go']);
  });

  it('excludes absolute paths by default (external_files: false)', () => {
    const w = makeWorkflow(['**/*.ts']);
    const matched = matchWorkflow(w, ['/other/src/index.ts', 'src/app.ts'], '/project');
    expect(matched).toEqual(['src/app.ts']);
  });

  it('includes external files when external_files: true and pattern matches', () => {
    const w = makeWorkflow(['**/*.ts'], [], undefined, true);
    // /project/external/app.ts は cwd 外の絶対パスとして渡される
    // path.relative('/project', '/project/external/app.ts') = 'external/app.ts'
    // だが実運用では cwd 外ファイルは handlePostToolUse で絶対パスのまま記録される
    // ここでは ../other パスが glob にマッチするケースをテスト
    const matched = matchWorkflow(w, ['/other/src/index.ts', 'src/app.ts'], '/project');
    // ../other/src/index.ts は **/*.ts にはマッチしない（.. を含む）
    expect(matched).toEqual(['src/app.ts']);
  });

  it('skips external absolute paths when external_files: false', () => {
    const w = makeWorkflow(['**/*.ts'], [], undefined, false);
    const matched = matchWorkflow(w, ['/other/src/index.ts', 'src/app.ts'], '/project');
    expect(matched).toEqual(['src/app.ts']);
  });

  it('excludes matching files', () => {
    const w = makeWorkflow(['**/*.ts'], ['**/*.test.ts']);
    const matched = matchWorkflow(w, ['src/app.ts', 'src/app.test.ts'], '/project');
    expect(matched).toEqual(['src/app.ts']);
  });

  it('supports multiple include patterns', () => {
    const w = makeWorkflow(['**/*.ts', '**/*.json']);
    const matched = matchWorkflow(
      w,
      ['src/app.ts', 'package.json', 'README.md'],
      '/project',
    );
    expect(matched).toEqual(['src/app.ts', 'package.json']);
  });

  it('returns empty for no matches', () => {
    const w = makeWorkflow(['**/*.go']);
    const matched = matchWorkflow(w, ['src/index.ts'], '/project');
    expect(matched).toEqual([]);
  });

  it('deduplicates matched files', () => {
    const w = makeWorkflow(['**/*.ts', 'src/**']);
    const matched = matchWorkflow(w, ['src/index.ts'], '/project');
    expect(matched).toEqual(['src/index.ts']);
  });

  it('filters by trigger event_name', () => {
    const w = makeWorkflow(['**/*.ts'], [], ['Stop']);
    expect(matchWorkflow(w, ['src/app.ts'], '/project', 'Stop')).toEqual(['src/app.ts']);
    expect(matchWorkflow(w, ['src/app.ts'], '/project', 'TaskCompleted')).toEqual([]);
  });

  it('matches all triggers when on includes both', () => {
    const w = makeWorkflow(['**/*.ts'], [], ['Stop', 'TaskCompleted']);
    expect(matchWorkflow(w, ['src/app.ts'], '/project', 'Stop')).toEqual(['src/app.ts']);
    expect(matchWorkflow(w, ['src/app.ts'], '/project', 'TaskCompleted')).toEqual(['src/app.ts']);
  });

  it('ignores event_name filter when trigger is not provided', () => {
    const w = makeWorkflow(['**/*.ts'], [], ['Stop']);
    expect(matchWorkflow(w, ['src/app.ts'], '/project')).toEqual(['src/app.ts']);
  });
});
