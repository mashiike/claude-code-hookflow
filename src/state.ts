import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HookEvent } from './hook-event.js';

export interface PromptInfo {
  prompt: string;
  started_at: string;
}

export interface StepExecution {
  name?: string;
  command: string;
  status: 'success' | 'failure' | 'skipped';
  exit_code: number;
  continue?: boolean;
  stop_reason?: string;
  stdout?: string;
  stderr?: string;
  started_at: string;
  finished_at: string;
}

export interface JobExecution {
  status: 'success' | 'failure' | 'skipped';
  started_at?: string;
  finished_at?: string;
  exit_code?: number;
  steps?: StepExecution[];
}

export interface WorkflowExecution {
  file: string;
  status: 'success' | 'failure' | 'skipped';
  matched_files: string[];
  jobs: Record<string, JobExecution>;
}

export interface RunRecord {
  trigger: string;
  started_at: string;
  finished_at?: string;
  workflows: Record<string, WorkflowExecution>;
}

export interface State {
  session_id: string;
  cwd: string;
  changed_files: string[];
  current_prompt?: PromptInfo;
  last_run?: RunRecord;
  parent_changed_files?: string[];
  agent_id?: string;
  agent_type?: string;
}

export type StatePathResolver = (event: HookEvent) => string;

export function defaultStatePathResolver(event: HookEvent): string {
  const parsed = path.parse(event.transcript_path);
  const dir = path.join(parsed.dir, parsed.name);
  return path.join(dir, 'hookflow', 'state.json');
}

export function subagentStatePath(basePath: string, agentId: string): string {
  const dir = path.dirname(basePath);
  const subDir = path.join(dir, 'subagents');
  const resolved = path.resolve(subDir, agentId, 'state.json');
  if (!resolved.startsWith(path.resolve(subDir) + path.sep)) {
    throw new Error(`Invalid agent_id: path traversal detected`);
  }
  return resolved;
}

export function subagentsDir(basePath: string): string {
  return path.join(path.dirname(basePath), 'subagents');
}

export function lastFailedRunPath(statePath: string): string {
  return path.join(path.dirname(statePath), 'last_failed_run.json');
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

export function saveFailedRun(event: HookEvent, state: State, resolver?: StatePathResolver): string {
  const resolve = resolver ?? defaultStatePathResolver;
  const statePath = resolve(event);
  const failedPath = lastFailedRunPath(statePath);

  const dir = path.dirname(failedPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  fs.writeFileSync(failedPath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  return failedPath;
}

export function readFailedRun(event: HookEvent, resolver?: StatePathResolver): State | null {
  const resolve = resolver ?? defaultStatePathResolver;
  const statePath = resolve(event);
  const failedPath = lastFailedRunPath(statePath);

  try {
    const data = fs.readFileSync(failedPath, 'utf-8');
    return JSON.parse(data) as State;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

export function removeFailedRun(event: HookEvent, resolver?: StatePathResolver): void {
  const resolve = resolver ?? defaultStatePathResolver;
  const statePath = resolve(event);
  const failedPath = lastFailedRunPath(statePath);

  try {
    fs.unlinkSync(failedPath);
  } catch (err: unknown) {
    if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
      throw err;
    }
  }
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
