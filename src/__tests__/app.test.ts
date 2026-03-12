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

  describe('UserPromptSubmit', () => {
    it('creates state with prompt info', () => {
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' }));

      const state = readState(
        { session_id: '', transcript_path: '', cwd: '', hook_event_name: '', _raw: {} },
        resolver,
      );
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

      const state = readState(
        { session_id: '', transcript_path: '', cwd: '', hook_event_name: '', _raw: {} },
        resolver,
      );
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

      const state = readState(
        { session_id: '', transcript_path: '', cwd: '', hook_event_name: '', _raw: {} },
        resolver,
      );
      expect(state!.changed_files).toEqual(['/tmp/a.ts']);
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

      const state = readState(
        { session_id: '', transcript_path: '', cwd: '', hook_event_name: '', _raw: {} },
        resolver,
      );
      expect(state!.changed_files).toEqual(['/tmp/a.ts']);
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

      const state = readState(
        { session_id: '', transcript_path: '', cwd: '', hook_event_name: '', _raw: {} },
        resolver,
      );
      expect(state!.changed_files).toEqual([]);
    });
  });

  describe('Stop', () => {
    it('skips when stop_hook_active is true', () => {
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'test' }));
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { file_path: '/tmp/a.ts' },
        }),
      );

      const stderr: string[] = [];
      const originalWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Buffer): boolean => {
        stderr.push(chunk.toString());
        return true;
      }) as typeof process.stderr.write;

      try {
        app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: true }));
        expect(stderr.join('')).not.toContain('file(s) changed');
      } finally {
        process.stderr.write = originalWrite;
      }
    });

    it('logs when files changed and stop_hook_active is false', () => {
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'test' }));
      app.run(
        makeInput({
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { file_path: '/tmp/a.ts' },
        }),
      );

      const stderr: string[] = [];
      const originalWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Buffer): boolean => {
        stderr.push(chunk.toString());
        return true;
      }) as typeof process.stderr.write;

      try {
        app.run(makeInput({ hook_event_name: 'Stop', stop_hook_active: false }));
        expect(stderr.join('')).toContain('1 file(s) changed');
      } finally {
        process.stderr.write = originalWrite;
      }
    });
  });

  describe('SessionEnd', () => {
    it('removes state file', () => {
      app.run(makeInput({ hook_event_name: 'UserPromptSubmit', prompt: 'test' }));

      const state = readState(
        { session_id: '', transcript_path: '', cwd: '', hook_event_name: '', _raw: {} },
        resolver,
      );
      expect(state).not.toBeNull();

      app.run(makeInput({ hook_event_name: 'SessionEnd' }));

      const stateAfter = readState(
        { session_id: '', transcript_path: '', cwd: '', hook_event_name: '', _raw: {} },
        resolver,
      );
      expect(stateAfter).toBeNull();
    });
  });

  describe('unknown event', () => {
    it('does nothing for unknown events', () => {
      expect(() => app.run(makeInput({ hook_event_name: 'UnknownEvent' }))).not.toThrow();
    });
  });
});
