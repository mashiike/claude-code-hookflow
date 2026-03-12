import { parseHookEvent } from './hook-event.js';
import type { HookEvent } from './hook-event.js';
import { readState, writeState, removeState } from './state.js';
import type { State, StatePathResolver } from './state.js';

export class App {
  private statePathResolver?: StatePathResolver;

  constructor(statePathResolver?: StatePathResolver) {
    this.statePathResolver = statePathResolver;
  }

  run(input: Buffer | string): void {
    const event = parseHookEvent(input);

    switch (event.hook_event_name) {
      case 'UserPromptSubmit':
        this.handleUserPromptSubmit(event);
        break;
      case 'PostToolUse':
        this.handlePostToolUse(event);
        break;
      case 'Stop':
        this.handleStop(event);
        break;
      case 'SessionEnd':
        this.handleSessionEnd(event);
        break;
      default:
        break;
    }
  }

  private loadOrCreateState(event: HookEvent): State {
    let state: State | null = null;
    try {
      state = readState(event, this.statePathResolver);
    } catch {
      state = null;
    }
    return state ?? { session_id: event.session_id, cwd: event.cwd, changed_files: [] };
  }

  private handleUserPromptSubmit(event: HookEvent): void {
    const state = this.loadOrCreateState(event);

    const prompt = (event._raw as Record<string, unknown>).prompt;

    state.changed_files = [];
    state.current_prompt = {
      prompt: typeof prompt === 'string' ? prompt : '',
      started_at: new Date().toISOString(),
    };
    state.last_run = undefined;

    writeState(event, state, this.statePathResolver);
  }

  private handlePostToolUse(event: HookEvent): void {
    const filePath = event.tool_input?.file_path;
    if (!filePath) {
      return;
    }

    const state = this.loadOrCreateState(event);

    if (state.changed_files.includes(filePath)) {
      return;
    }
    state.changed_files.push(filePath);

    writeState(event, state, this.statePathResolver);
  }

  private handleStop(event: HookEvent): void {
    if (event.stop_hook_active) {
      return;
    }

    let state: State | null = null;
    try {
      state = readState(event, this.statePathResolver);
    } catch {
      return;
    }

    if (!state || state.changed_files.length === 0) {
      return;
    }

    // TODO: match changed files against workflow patterns and execute
    process.stderr.write(
      `hookflow: ${state.changed_files.length} file(s) changed, workflow execution not yet implemented\n`,
    );
  }

  private handleSessionEnd(event: HookEvent): void {
    removeState(event, this.statePathResolver);
  }
}
