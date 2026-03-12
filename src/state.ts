import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HookEvent } from './hook-event.js';

export interface PromptInfo {
  prompt: string;
  started_at: string;
}

export interface WorkflowResult {
  outcome: string;
  conclusion: string;
}

export interface RunResult {
  trigger: string;
  workflows?: Record<string, WorkflowResult>;
  retries: number;
}

export interface State {
  session_id: string;
  cwd: string;
  changed_files: string[];
  current_prompt?: PromptInfo;
  last_run?: RunResult;
}

export type StatePathResolver = (event: HookEvent) => string;

export function defaultStatePathResolver(event: HookEvent): string {
  const parsed = path.parse(event.transcript_path);
  const dir = path.join(parsed.dir, parsed.name);
  return path.join(dir, 'hookflow', 'state.json');
}

export function readState(event: HookEvent, resolver?: StatePathResolver): State | null {
  const resolve = resolver ?? defaultStatePathResolver;
  const statePath = resolve(event);

  try {
    const data = fs.readFileSync(statePath, 'utf-8');
    return JSON.parse(data) as State;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

export function writeState(event: HookEvent, state: State, resolver?: StatePathResolver): void {
  const resolve = resolver ?? defaultStatePathResolver;
  const statePath = resolve(event);

  const dir = path.dirname(statePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

export function removeState(event: HookEvent, resolver?: StatePathResolver): void {
  const resolve = resolver ?? defaultStatePathResolver;
  const statePath = resolve(event);

  try {
    fs.unlinkSync(statePath);
  } catch (err: unknown) {
    if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
      throw err;
    }
  }

  const dir = path.dirname(statePath);
  try {
    fs.rmdirSync(dir);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err.code === 'ENOENT' || err.code === 'ENOTEMPTY')
    ) {
      return;
    }
    process.stderr.write(
      `hookflow: warning: failed to remove state directory: ${dir}: ${err}\n`,
    );
  }
}
