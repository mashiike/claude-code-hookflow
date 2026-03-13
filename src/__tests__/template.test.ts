import { describe, it, expect } from 'vitest';
import { expandTemplate, evaluateCondition, uniqueDirs } from '../template.js';
import type { TemplateContext } from '../template.js';

function makeCtx(overrides?: Partial<TemplateContext>): TemplateContext {
  return {
    state: {
      changed_files: ['src/a.ts', 'src/b.ts'],
      changed_dirs: ['src/'],
      trigger: 'Stop',
      session_id: 'sess-123',
      cwd: '/tmp/project',
      prompt: 'fix the bug',
    },
    workflow: { name: 'test-workflow' },
    matched_files: ['src/a.ts'],
    matched_dirs: ['src/'],
    each: { value: '' },
    steps: {},
    ...overrides,
  };
}

describe('expandTemplate', () => {
  it('expands simple variable', () => {
    const ctx = makeCtx();
    expect(expandTemplate('trigger is ${{ state.trigger }}', ctx)).toBe('trigger is Stop');
  });

  it('expands array as space-separated', () => {
    const ctx = makeCtx();
    expect(expandTemplate('${{ state.changed_files }}', ctx)).toBe('src/a.ts src/b.ts');
  });

  it('expands matched_files', () => {
    const ctx = makeCtx();
    expect(expandTemplate('${{ matched_files }}', ctx)).toBe('src/a.ts');
  });

  it('expands workflow name', () => {
    const ctx = makeCtx();
    expect(expandTemplate('${{ workflow.name }}', ctx)).toBe('test-workflow');
  });

  it('expands step results', () => {
    const ctx = makeCtx({
      steps: { lint: { exit_code: 0, stdout: 'ok', stderr: '' } },
    });
    expect(expandTemplate('${{ steps.lint.exit_code }}', ctx)).toBe('0');
    expect(expandTemplate('${{ steps.lint.stdout }}', ctx)).toBe('ok');
  });

  it('returns empty string for unknown variable', () => {
    const ctx = makeCtx();
    expect(expandTemplate('${{ state.nonexistent }}', ctx)).toBe('');
  });

  it('returns empty string for deep unknown path', () => {
    const ctx = makeCtx();
    expect(expandTemplate('${{ steps.missing.stdout }}', ctx)).toBe('');
  });

  it('handles multiple expressions', () => {
    const ctx = makeCtx();
    expect(expandTemplate('${{ state.cwd }}/bin/${{ state.trigger }}', ctx)).toBe(
      '/tmp/project/bin/Stop',
    );
  });

  it('returns plain string unchanged', () => {
    const ctx = makeCtx();
    expect(expandTemplate('no expressions here', ctx)).toBe('no expressions here');
  });

  it('handles whitespace in expression', () => {
    const ctx = makeCtx();
    expect(expandTemplate('${{  state.trigger  }}', ctx)).toBe('Stop');
  });

  it('expands empty array as empty string', () => {
    const ctx = makeCtx({ matched_files: [] });
    expect(expandTemplate('files: ${{ matched_files }}', ctx)).toBe('files: ');
  });

  it('expands numeric values', () => {
    const ctx = makeCtx({
      steps: { build: { exit_code: 42, stdout: '', stderr: '' } },
    });
    expect(expandTemplate('code=${{ steps.build.exit_code }}', ctx)).toBe('code=42');
  });
});

describe('evaluateCondition', () => {
  it('equality with matching values', () => {
    const ctx = makeCtx();
    expect(evaluateCondition("${{ state.trigger == 'Stop' }}", ctx)).toBe(true);
  });

  it('equality with non-matching values', () => {
    const ctx = makeCtx();
    expect(evaluateCondition("${{ state.trigger == 'TaskCompleted' }}", ctx)).toBe(false);
  });

  it('inequality', () => {
    const ctx = makeCtx();
    expect(evaluateCondition("${{ state.trigger != 'Stop' }}", ctx)).toBe(false);
    expect(evaluateCondition("${{ state.trigger != 'TaskCompleted' }}", ctx)).toBe(true);
  });

  it('truthiness for non-empty string', () => {
    const ctx = makeCtx();
    expect(evaluateCondition('${{ state.prompt }}', ctx)).toBe(true);
  });

  it('falsy for empty string', () => {
    const ctx = makeCtx();
    ctx.state.prompt = '';
    expect(evaluateCondition('${{ state.prompt }}', ctx)).toBe(false);
  });

  it('truthiness for non-empty array', () => {
    const ctx = makeCtx();
    expect(evaluateCondition('${{ matched_files }}', ctx)).toBe(true);
  });

  it('falsy for empty array', () => {
    const ctx = makeCtx({ matched_files: [] });
    expect(evaluateCondition('${{ matched_files }}', ctx)).toBe(false);
  });

  it('works without ${{ }} wrapper', () => {
    const ctx = makeCtx();
    expect(evaluateCondition("state.trigger == 'Stop'", ctx)).toBe(true);
  });

  it('compares step exit_code', () => {
    const ctx = makeCtx({
      steps: { lint: { exit_code: 0, stdout: '', stderr: '' } },
    });
    expect(evaluateCondition("${{ steps.lint.exit_code == '0' }}", ctx)).toBe(true);
  });

  it('compares two variables', () => {
    const ctx = makeCtx();
    expect(evaluateCondition('${{ state.trigger == state.trigger }}', ctx)).toBe(true);
  });

  it('falsy for unknown variable', () => {
    const ctx = makeCtx();
    expect(evaluateCondition('${{ state.nonexistent }}', ctx)).toBe(false);
  });

  it('double-quoted strings', () => {
    const ctx = makeCtx();
    expect(evaluateCondition('${{ state.trigger == "Stop" }}', ctx)).toBe(true);
  });
});

describe('uniqueDirs', () => {
  it('extracts unique directories with trailing slash', () => {
    expect(uniqueDirs(['src/a.ts', 'src/b.ts', 'lib/c.ts'])).toEqual(['lib/', 'src/']);
  });

  it('returns ./ for root-level files', () => {
    expect(uniqueDirs(['a.ts'])).toEqual(['./']);
  });

  it('handles mixed depths', () => {
    expect(uniqueDirs(['a.ts', 'src/b.ts', 'src/sub/c.ts'])).toEqual(['./', 'src/', 'src/sub/']);
  });

  it('returns empty array for empty input', () => {
    expect(uniqueDirs([])).toEqual([]);
  });

  it('deduplicates same directory', () => {
    expect(uniqueDirs(['src/a.ts', 'src/b.ts', 'src/c.ts'])).toEqual(['src/']);
  });
});

describe('expandTemplate with dirs and each', () => {
  it('expands matched_dirs as space-separated', () => {
    const ctx = makeCtx({ matched_dirs: ['lib/', 'src/'] });
    expect(expandTemplate('go test --short ${{ matched_dirs }}', ctx)).toBe(
      'go test --short lib/ src/',
    );
  });

  it('expands changed_dirs', () => {
    const ctx = makeCtx();
    ctx.state.changed_dirs = ['src/', 'test/'];
    expect(expandTemplate('${{ state.changed_dirs }}', ctx)).toBe('src/ test/');
  });

  it('expands each.value', () => {
    const ctx = makeCtx({ each: { value: 'src/' } });
    expect(expandTemplate('terraform fmt ${{ each.value }}', ctx)).toBe('terraform fmt src/');
  });
});
