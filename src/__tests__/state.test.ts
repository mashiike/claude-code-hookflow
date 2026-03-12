import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HookEvent } from '../hook-event.js';
import {
  defaultStatePathResolver,
  readState,
  writeState,
  removeState,
} from '../state.js';
import type { State } from '../state.js';

function makeEvent(transcriptPath: string): HookEvent {
  return {
    session_id: 'sess-1',
    transcript_path: transcriptPath,
    cwd: '/tmp',
    hook_event_name: 'UserPromptSubmit',
    _raw: {},
  };
}

describe('defaultStatePathResolver', () => {
  it('derives path from transcript_path', () => {
    const event = makeEvent('/home/user/.claude/projects/abc/session-1.jsonl');
    const result = defaultStatePathResolver(event);
    expect(result).toBe('/home/user/.claude/projects/abc/session-1/hookflow/state.json');
  });

  it('handles path without extension', () => {
    const event = makeEvent('/tmp/session');
    const result = defaultStatePathResolver(event);
    expect(result).toBe('/tmp/session/hookflow/state.json');
  });
});

describe('readState / writeState / removeState', () => {
  let tmpDir: string;
  const resolver = (_event: HookEvent): string =>
    path.join(tmpDir, 'hookflow', 'state.json');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookflow-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for non-existent state', () => {
    const event = makeEvent('/tmp/test.jsonl');
    const state = readState(event, resolver);
    expect(state).toBeNull();
  });

  it('round-trips state through write and read', () => {
    const event = makeEvent('/tmp/test.jsonl');
    const state: State = {
      session_id: 'sess-1',
      cwd: '/tmp',
      changed_files: ['/tmp/foo.ts', '/tmp/bar.ts'],
      current_prompt: {
        prompt: 'test prompt',
        started_at: '2026-03-12T00:00:00.000Z',
      },
    };

    writeState(event, state, resolver);
    const loaded = readState(event, resolver);

    expect(loaded).toEqual(state);
  });

  it('removeState deletes state file and directory', () => {
    const event = makeEvent('/tmp/test.jsonl');
    const state: State = {
      session_id: 'sess-1',
      cwd: '/tmp',
      changed_files: [],
    };

    writeState(event, state, resolver);
    expect(readState(event, resolver)).not.toBeNull();

    removeState(event, resolver);
    expect(readState(event, resolver)).toBeNull();

    const hookflowDir = path.join(tmpDir, 'hookflow');
    expect(fs.existsSync(hookflowDir)).toBe(false);
  });

  it('removeState is idempotent', () => {
    const event = makeEvent('/tmp/test.jsonl');
    expect(() => removeState(event, resolver)).not.toThrow();
    expect(() => removeState(event, resolver)).not.toThrow();
  });
});
