import { parseHookEvent } from './hook-event.js';

import type { HookEvent } from './hook-event.js';
import { readState, writeState, removeState } from './state.js';
import type { State, StatePathResolver, RunRecord, WorkflowExecution, JobExecution } from './state.js';
import { loadWorkflows, matchWorkflow } from './workflow.js';
import type { Workflow } from './workflow.js';

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
      case 'TaskCompleted':
        this.handleTaskCompleted(event);
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

    state.session_id = event.session_id;
    state.cwd = event.cwd;

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
    this.runWorkflows(event, 'Stop');
  }

  private handleTaskCompleted(event: HookEvent): void {
    this.runWorkflows(event, 'TaskCompleted');
  }

  private runWorkflows(event: HookEvent, trigger: string): void {
    let state: State | null = null;
    try {
      state = readState(event, this.statePathResolver);
    } catch {
      return;
    }

    if (!state || state.changed_files.length === 0) {
      return;
    }

    const cwd = state.cwd || event.cwd;
    const workflows = loadWorkflows(cwd);

    if (workflows.length === 0) {
      process.stderr.write(
        `hookflow: ${state.changed_files.length} file(s) changed, no workflows defined\n`,
      );
      return;
    }

    const matched = new Map<string, { workflow: Workflow; files: string[] }>();
    for (const w of workflows) {
      const files = matchWorkflow(w, state.changed_files, cwd);
      if (files.length > 0) {
        matched.set(w.name, { workflow: w, files });
      }
    }

    if (matched.size === 0) {
      process.stderr.write(
        `hookflow: ${state.changed_files.length} file(s) changed, no workflows matched\n`,
      );
      return;
    }

    const previousAttempt = state.last_run?.trigger === trigger ? state.last_run.attempt : 0;

    const maxRetries = Math.max(...[...matched.values()].map((m) => m.workflow.max_retries));

    const run: RunRecord = {
      trigger,
      attempt: previousAttempt + 1,
      max_retries: maxRetries,
      started_at: new Date().toISOString(),
      workflows: {},
    };

    for (const [name, { workflow, files }] of matched) {
      const workflowExec: WorkflowExecution = {
        file: workflow._file,
        status: 'success',
        matched_files: files,
        jobs: {},
      };

      for (const [jobKey, _jobDef] of Object.entries(workflow.jobs)) {
        const jobExec: JobExecution = {
          status: 'success',
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          exit_code: 0,
        };
        workflowExec.jobs[jobKey] = jobExec;
      }

      run.workflows[name] = workflowExec;
    }

    run.finished_at = new Date().toISOString();

    state.last_run = run;
    writeState(event, state, this.statePathResolver);

    const workflowNames = [...matched.keys()].join(', ');
    process.stderr.write(
      `hookflow: executed ${matched.size} workflow(s): ${workflowNames} (attempt ${run.attempt})\n`,
    );
  }

  private handleSessionEnd(event: HookEvent): void {
    removeState(event, this.statePathResolver);
  }
}
