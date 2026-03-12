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
max_retries: 3
triggers:
  path_pattern:
    include:
      - "**/*.go"
jobs:
  lint:
    command: "golangci-lint run ./..."
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows).toHaveLength(1);
    expect(workflows[0]!.name).toBe('Go Lint');
    expect(workflows[0]!.max_retries).toBe(3);
    expect(workflows[0]!.triggers.path_pattern!.include).toEqual(['**/*.go']);
    expect(workflows[0]!.triggers.path_pattern!.exclude).toEqual([]);
    expect(Object.keys(workflows[0]!.jobs)).toEqual(['lint']);
  });

  it('loads yml extension', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'test.yml'),
      `
name: "Test"
triggers:
  path_pattern:
    include:
      - "**/*.ts"
jobs:
  test:
    command: "npm test"
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows).toHaveLength(1);
  });

  it('supports single string for include', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'simple.yaml'),
      `
name: "Simple"
triggers:
  path_pattern:
    include: "**/*.go"
jobs:
  fmt:
    command: "gofmt -w ."
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows[0]!.triggers.path_pattern!.include).toEqual(['**/*.go']);
  });

  it('parses exclude patterns', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'with-exclude.yaml'),
      `
name: "With Exclude"
triggers:
  path_pattern:
    include:
      - "**/*.ts"
    exclude:
      - "**/*.test.ts"
      - "**/*.spec.ts"
jobs:
  check:
    command: "echo ok"
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows[0]!.triggers.path_pattern!.exclude).toEqual([
      '**/*.test.ts',
      '**/*.spec.ts',
    ]);
  });

  it('defaults max_retries to 0', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'no-retry.yaml'),
      `
name: "No Retry"
triggers:
  path_pattern:
    include: "*.ts"
jobs:
  check:
    command: "echo ok"
`,
    );

    const workflows = loadWorkflows(tmpDir);
    expect(workflows[0]!.max_retries).toBe(0);
  });

  it('skips files without triggers', () => {
    fs.writeFileSync(
      path.join(hookflowsDir, 'empty.yaml'),
      `
name: "Empty"
jobs:
  check:
    command: "echo ok"
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
  const makeWorkflow = (include: string[], exclude: string[] = []): Workflow => ({
    name: 'test',
    max_retries: 0,
    triggers: { path_pattern: { include, exclude } },
    jobs: {},
    _file: '/test.yaml',
  });

  it('matches glob patterns against changed files', () => {
    const w = makeWorkflow(['**/*.go']);
    const matched = matchWorkflow(w, ['src/main.go', 'pkg/app.go'], '/project');
    expect(matched).toEqual(['src/main.go', 'pkg/app.go']);
  });

  it('handles absolute file paths', () => {
    const w = makeWorkflow(['**/*.ts']);
    const matched = matchWorkflow(w, ['/project/src/index.ts'], '/project');
    expect(matched).toEqual(['src/index.ts']);
  });

  it('excludes matching files', () => {
    const w = makeWorkflow(['**/*.ts'], ['**/*.test.ts']);
    const matched = matchWorkflow(w, ['/project/src/app.ts', '/project/src/app.test.ts'], '/project');
    expect(matched).toEqual(['src/app.ts']);
  });

  it('supports multiple include patterns', () => {
    const w = makeWorkflow(['**/*.ts', '**/*.json']);
    const matched = matchWorkflow(
      w,
      ['/project/src/app.ts', '/project/package.json', '/project/README.md'],
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
});
