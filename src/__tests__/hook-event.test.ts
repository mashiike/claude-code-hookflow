import { describe, it, expect } from 'vitest';
import { parseHookEvent } from '../hook-event.js';

const baseEvent = {
  session_id: 'sess-1',
  transcript_path: '/tmp/test.jsonl',
  cwd: '/tmp',
  hook_event_name: 'UserPromptSubmit',
};

describe('parseHookEvent', () => {
  it('parses valid input', () => {
    const input = JSON.stringify({ ...baseEvent, prompt: 'hello' });
    const event = parseHookEvent(input);

    expect(event.session_id).toBe('sess-1');
    expect(event.transcript_path).toBe('/tmp/test.jsonl');
    expect(event.cwd).toBe('/tmp');
    expect(event.hook_event_name).toBe('UserPromptSubmit');
    expect(event._raw.prompt).toBe('hello');
  });

  it('parses Buffer input', () => {
    const input = Buffer.from(JSON.stringify(baseEvent));
    const event = parseHookEvent(input);
    expect(event.session_id).toBe('sess-1');
  });

  it('parses tool_input', () => {
    const input = JSON.stringify({
      ...baseEvent,
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/foo.ts' },
    });
    const event = parseHookEvent(input);
    expect(event.tool_name).toBe('Write');
    expect(event.tool_input?.file_path).toBe('/tmp/foo.ts');
  });

  it('parses stop_hook_active', () => {
    const input = JSON.stringify({
      ...baseEvent,
      hook_event_name: 'Stop',
      stop_hook_active: true,
    });
    const event = parseHookEvent(input);
    expect(event.stop_hook_active).toBe(true);
  });

  it('throws on missing session_id', () => {
    const { session_id: _, ...rest } = baseEvent;
    expect(() => parseHookEvent(JSON.stringify(rest))).toThrow('session_id');
  });

  it('throws on missing transcript_path', () => {
    const { transcript_path: _, ...rest } = baseEvent;
    expect(() => parseHookEvent(JSON.stringify(rest))).toThrow('transcript_path');
  });

  it('throws on missing cwd', () => {
    const { cwd: _, ...rest } = baseEvent;
    expect(() => parseHookEvent(JSON.stringify(rest))).toThrow('cwd');
  });

  it('throws on missing hook_event_name', () => {
    const { hook_event_name: _, ...rest } = baseEvent;
    expect(() => parseHookEvent(JSON.stringify(rest))).toThrow('hook_event_name');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseHookEvent('not json')).toThrow();
  });
});
