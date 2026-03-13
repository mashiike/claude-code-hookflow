import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { minimatch } from 'minimatch';

export interface FailureConfig {
  continue?: boolean;
  stop_reason?: string;
}

export interface Step extends FailureConfig {
  run: string;
  working_dir?: string;
}

export interface JobDef extends FailureConfig {
  name?: string;
  steps: Step[];
  needs?: string[];
}

export interface Workflow extends FailureConfig {
  name: string;
  external_files: boolean;
  on: string[];
  paths: string[];
  paths_ignore: string[];
  jobs: Record<string, JobDef>;
  _file: string;
}

const DEFAULT_EVENT_NAMES = ['Stop', 'TaskCompleted'];

interface RawStep {
  run?: string;
  working_dir?: string;
  continue?: boolean;
  stop_reason?: string;
}

interface RawWorkflow {
  name?: string;
  external_files?: boolean;
  continue?: boolean;
  stop_reason?: string;
  on?: string | string[];
  paths?: string | string[];
  'paths-ignore'?: string | string[];
  jobs?: Record<
    string,
    {
      name?: string;
      continue?: boolean;
      stop_reason?: string;
      steps?: RawStep[];
      needs?: string | string[];
    }
  >;
}

function toStringArray(val: unknown): string[] {
  if (typeof val === 'string') return [val];
  if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string');
  return [];
}

function parseBool(val: unknown): boolean | undefined {
  if (typeof val === 'boolean') return val;
  return undefined;
}

function parseWorkflowFile(filePath: string): Workflow | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const raw = yaml.load(content) as RawWorkflow | null;
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const eventNames = toStringArray(raw.on);
  const on = eventNames.length > 0 ? eventNames : DEFAULT_EVENT_NAMES;

  const paths = toStringArray(raw.paths);
  if (paths.length === 0) {
    return null;
  }

  const pathsIgnore = toStringArray(raw['paths-ignore']);

  const jobs: Record<string, JobDef> = {};
  if (raw.jobs && typeof raw.jobs === 'object') {
    for (const [key, def] of Object.entries(raw.jobs)) {
      if (!def || !Array.isArray(def.steps)) {
        continue;
      }
      const steps: Step[] = [];
      for (const rawStep of def.steps) {
        if (rawStep && typeof rawStep.run === 'string') {
          steps.push({
            run: rawStep.run,
            working_dir: rawStep.working_dir,
            continue: parseBool(rawStep.continue),
            stop_reason: typeof rawStep.stop_reason === 'string' ? rawStep.stop_reason : undefined,
          });
        }
      }
      if (steps.length > 0) {
        jobs[key] = {
          name: def.name,
          steps,
          needs: toStringArray(def.needs),
          continue: parseBool(def.continue),
          stop_reason: typeof def.stop_reason === 'string' ? def.stop_reason : undefined,
        };
      }
    }
  }

  return {
    name: typeof raw.name === 'string' ? raw.name : path.basename(filePath, path.extname(filePath)),
    external_files: raw.external_files === true,
    continue: parseBool(raw.continue),
    stop_reason: typeof raw.stop_reason === 'string' ? raw.stop_reason : undefined,
    on,
    paths,
    paths_ignore: pathsIgnore,
    jobs,
    _file: filePath,
  };
}

function listYamlFiles(dir: string): string[] {
  try {
    const entries = fs.readdirSync(dir);
    return entries
      .filter((f) => /\.(ya?ml)$/.test(f))
      .map((f) => path.join(dir, f))
      .sort();
  } catch {
    return [];
  }
}

export function loadWorkflows(cwd: string): Workflow[] {
  const workflows: Workflow[] = [];
  const seen = new Set<string>();

  const projectDir = path.join(cwd, '.claude', 'hookflows');
  for (const file of listYamlFiles(projectDir)) {
    const w = parseWorkflowFile(file);
    if (w) {
      workflows.push(w);
      seen.add(path.basename(file));
    }
  }

  const globalDir = path.join(os.homedir(), '.claude', 'hookflows');
  for (const file of listYamlFiles(globalDir)) {
    if (seen.has(path.basename(file))) {
      continue;
    }
    const w = parseWorkflowFile(file);
    if (w) {
      workflows.push(w);
    }
  }

  return workflows;
}

export function resolveFailureConfig(
  step: FailureConfig,
  job: FailureConfig,
  workflow: FailureConfig,
): { continue: boolean; stop_reason?: string } {
  if (step.continue !== undefined) {
    return { continue: step.continue, stop_reason: step.stop_reason };
  }
  if (job.continue !== undefined) {
    return { continue: job.continue, stop_reason: job.stop_reason };
  }
  if (workflow.continue !== undefined) {
    return { continue: workflow.continue, stop_reason: workflow.stop_reason };
  }
  // default: block (continue: false), but still propagate stop_reason if set
  return { continue: false, stop_reason: workflow.stop_reason };
}

export function matchWorkflow(
  workflow: Workflow,
  changedFiles: string[],
  cwd: string,
  trigger?: string,
): string[] {
  if (trigger && !workflow.on.includes(trigger)) {
    return [];
  }

  const matched: string[] = [];

  for (const file of changedFiles) {
    // 絶対パス = cwd 外のファイル。external_files: false なら除外
    if (path.isAbsolute(file) && !workflow.external_files) {
      continue;
    }

    // cwd 内のファイルは既に相対パスで格納されている
    const relative = path.isAbsolute(file) ? path.relative(cwd, file) : file;

    const included = workflow.paths.some((pat) => minimatch(relative, pat));
    if (!included) continue;

    const excluded = workflow.paths_ignore.some((pat) => minimatch(relative, pat));
    if (excluded) continue;

    if (!matched.includes(relative)) {
      matched.push(relative);
    }
  }

  return matched;
}
