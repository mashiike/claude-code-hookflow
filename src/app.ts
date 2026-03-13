import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { parseHookEvent } from './hook-event.js';

import type { HookEvent } from './hook-event.js';
import { readState, writeState, removeState, defaultStatePathResolver } from './state.js';
import type {
  State,
  StatePathResolver,
  RunRecord,
  WorkflowExecution,
  JobExecution,
  StepExecution,
} from './state.js';
import { loadWorkflows, matchWorkflow, resolveFailureConfig } from './workflow.js';
import type { Workflow, JobDef } from './workflow.js';

export interface RunResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

function truncate(s: string | undefined, max: number = 4096): string | undefined {
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) + '\n... (truncated)' : s;
}

export class App {
  private statePathResolver?: StatePathResolver;

  constructor(statePathResolver?: StatePathResolver) {
    this.statePathResolver = statePathResolver;
  }

  run(input: Buffer | string): RunResult | undefined {
    const event = parseHookEvent(input);

    switch (event.hook_event_name) {
      case 'UserPromptSubmit':
        this.handleUserPromptSubmit(event);
        return undefined;
      case 'PostToolUse':
        this.handlePostToolUse(event);
        return undefined;
      case 'Stop':
        return this.handleStop(event);
      case 'TaskCompleted':
        return this.handleTaskCompleted(event);
      case 'SessionEnd':
        this.handleSessionEnd(event);
        return undefined;
      default:
        return undefined;
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
    const cwd = state.cwd || event.cwd;

    // cwd 配下のファイルは相対パスで記録、それ以外は絶対パスのまま
    let normalized = filePath;
    if (path.isAbsolute(filePath) && cwd) {
      const rel = path.relative(cwd, filePath);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        normalized = rel;
      }
    }

    if (state.changed_files.includes(normalized)) {
      return;
    }
    state.changed_files.push(normalized);

    writeState(event, state, this.statePathResolver);
  }

  private handleStop(event: HookEvent): RunResult | undefined {
    if (event.stop_hook_active) {
      return undefined;
    }
    return this.runWorkflows(event, 'Stop');
  }

  private handleTaskCompleted(event: HookEvent): RunResult | undefined {
    return this.runWorkflows(event, 'TaskCompleted');
  }

  private runWorkflows(event: HookEvent, trigger: string): RunResult | undefined {
    let state: State | null = null;
    try {
      state = readState(event, this.statePathResolver);
    } catch {
      return undefined;
    }

    if (!state || state.changed_files.length === 0) {
      return undefined;
    }

    const cwd = state.cwd || event.cwd;
    const workflows = loadWorkflows(cwd);

    if (workflows.length === 0) {
      process.stderr.write(
        `hookflow: ${state.changed_files.length} file(s) changed, no workflows defined\n`,
      );
      return undefined;
    }

    const matched = new Map<string, { workflow: Workflow; files: string[] }>();
    for (const w of workflows) {
      const files = matchWorkflow(w, state.changed_files, cwd, trigger);
      if (files.length > 0) {
        matched.set(w.name, { workflow: w, files });
      }
    }

    if (matched.size === 0) {
      process.stderr.write(
        `hookflow: ${state.changed_files.length} file(s) changed, no workflows matched\n`,
      );
      return undefined;
    }

    const run: RunRecord = {
      trigger,
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

      for (const [jobKey, jobDef] of Object.entries(workflow.jobs)) {
        const jobExec: JobExecution = this.executeJob(jobDef, workflow, cwd);
        workflowExec.jobs[jobKey] = jobExec;
      }

      const hasFailure = Object.values(workflowExec.jobs).some((j) => j.status === 'failure');
      if (hasFailure) {
        workflowExec.status = 'failure';
      }

      run.workflows[name] = workflowExec;
    }

    run.finished_at = new Date().toISOString();

    state.last_run = run;
    writeState(event, state, this.statePathResolver);

    const workflowNames = [...matched.keys()].join(', ');
    process.stderr.write(
      `hookflow: executed ${matched.size} workflow(s): ${workflowNames}\n`,
    );

    return this.buildRunResult(event, run);
  }

  private executeJob(jobDef: JobDef, workflow: Workflow, cwd: string): JobExecution {
    const startedAt = new Date().toISOString();
    const stepResults: StepExecution[] = [];
    let jobExitCode = 0;
    let jobStatus: 'success' | 'failure' = 'success';

    for (const step of jobDef.steps) {
      const stepStart = new Date().toISOString();
      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      const workingDir = step.working_dir ? path.resolve(cwd, step.working_dir) : cwd;

      try {
        const result = execSync(step.run, {
          cwd: workingDir,
          timeout: 300_000,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        stdout = typeof result === 'string' ? result : '';
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'status' in err) {
          const execErr = err as { status: number | null; stdout: string; stderr: string };
          exitCode = execErr.status ?? 1;
          stdout = execErr.stdout ?? '';
          stderr = execErr.stderr ?? '';
        } else {
          exitCode = 1;
          stderr = err instanceof Error ? err.message : String(err);
        }
      }

      const stepExec: StepExecution = {
        command: step.run,
        status: exitCode === 0 ? 'success' : 'failure',
        exit_code: exitCode,
        stdout: truncate(stdout) || undefined,
        stderr: truncate(stderr) || undefined,
        started_at: stepStart,
        finished_at: new Date().toISOString(),
      };

      if (exitCode !== 0) {
        const failureConfig = resolveFailureConfig(step, jobDef, workflow);
        stepExec.continue = failureConfig.continue;
        stepExec.stop_reason = failureConfig.stop_reason;

        stepResults.push(stepExec);

        if (!failureConfig.continue) {
          jobExitCode = exitCode;
          jobStatus = 'failure';
          break;
        }
        // continue: true — record failure but proceed to next step
        jobExitCode = exitCode;
        jobStatus = 'failure';
      } else {
        stepResults.push(stepExec);
      }
    }

    return {
      status: jobStatus,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: jobExitCode,
      steps: stepResults,
    };
  }

  private resolveStatePath(event: HookEvent): string {
    const resolve = this.statePathResolver ?? defaultStatePathResolver;
    return resolve(event);
  }

  private buildRunResult(event: HookEvent, run: RunRecord): RunResult | undefined {
    const failureLines: string[] = [];
    let hasBlockingFailure = false;

    for (const [wfName, wfExec] of Object.entries(run.workflows)) {
      if (wfExec.status !== 'failure') continue;

      const jobLines: string[] = [];
      for (const [jobKey, jobExec] of Object.entries(wfExec.jobs)) {
        if (jobExec.status !== 'failure' || !jobExec.steps) continue;

        for (const step of jobExec.steps) {
          if (step.status !== 'failure') continue;

          const isContinue = step.continue === true;
          const suffix = isContinue ? ' [continue]' : '';
          if (!isContinue) {
            hasBlockingFailure = true;
          }

          let line = `  ${jobKey}: exit ${step.exit_code} - ${step.command}${suffix}`;
          if (step.stop_reason) {
            line += `\n    stop_reason: "${step.stop_reason}"`;
          }
          jobLines.push(line);
        }
      }

      if (jobLines.length > 0) {
        failureLines.push(`hookflow: "${wfName}" failed`);
        failureLines.push(...jobLines);
      }
    }

    if (failureLines.length === 0) {
      return undefined;
    }

    const statePath = this.resolveStatePath(event);
    failureLines.push(`See: ${statePath}`);
    const message = failureLines.join('\n');

    if (!hasBlockingFailure) {
      // All failures have continue: true — don't block, just inform
      return {
        exitCode: 0,
        stdout: JSON.stringify({ continue: true, systemMessage: message }),
        stderr: message,
      };
    }

    // Blocking failure: output format depends on trigger
    if (run.trigger === 'Stop') {
      // Stop hook: exit 0 + {decision: "block", reason: "..."}
      // Claude receives `reason` and continues working to fix issues
      return {
        exitCode: 0,
        stdout: JSON.stringify({ decision: 'block', reason: message }),
        stderr: message,
      };
    }

    // TaskCompleted: exit 2 + stderr feedback
    // Task is not marked as completed, stderr is fed back to the model
    return {
      exitCode: 2,
      stderr: message,
    };
  }

  private handleSessionEnd(event: HookEvent): void {
    removeState(event, this.statePathResolver);
  }
}
