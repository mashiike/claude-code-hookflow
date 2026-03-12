import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { minimatch } from 'minimatch';

export interface PathPattern {
  include: string[];
  exclude: string[];
}

export interface Triggers {
  path_pattern?: PathPattern;
}

export interface JobDef {
  name?: string;
  command: string;
  working_dir?: string;
  depends_on?: string[];
}

export interface Workflow {
  name: string;
  max_retries: number;
  triggers: Triggers;
  jobs: Record<string, JobDef>;
  _file: string;
}

interface RawWorkflow {
  name?: string;
  max_retries?: number;
  triggers?: {
    path_pattern?: {
      include?: string | string[];
      exclude?: string | string[];
    };
  };
  jobs?: Record<string, { name?: string; command?: string; working_dir?: string; depends_on?: string[] }>;
}

function toStringArray(val: unknown): string[] {
  if (typeof val === 'string') return [val];
  if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string');
  return [];
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

  const triggers: Triggers = {};

  if (raw.triggers?.path_pattern) {
    const include = toStringArray(raw.triggers.path_pattern.include);
    if (include.length === 0) {
      return null;
    }
    triggers.path_pattern = {
      include,
      exclude: toStringArray(raw.triggers.path_pattern.exclude),
    };
  }

  if (!triggers.path_pattern) {
    return null;
  }

  const jobs: Record<string, JobDef> = {};
  if (raw.jobs && typeof raw.jobs === 'object') {
    for (const [key, def] of Object.entries(raw.jobs)) {
      if (def && typeof def.command === 'string') {
        jobs[key] = {
          name: def.name,
          command: def.command,
          working_dir: def.working_dir,
          depends_on: def.depends_on,
        };
      }
    }
  }

  return {
    name: typeof raw.name === 'string' ? raw.name : path.basename(filePath, path.extname(filePath)),
    max_retries: typeof raw.max_retries === 'number' ? raw.max_retries : 0,
    triggers,
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

export function matchWorkflow(workflow: Workflow, changedFiles: string[], cwd: string): string[] {
  const pp = workflow.triggers.path_pattern;
  if (!pp) {
    return [];
  }

  const matched: string[] = [];

  for (const file of changedFiles) {
    const relative = path.isAbsolute(file) ? path.relative(cwd, file) : file;

    const included = pp.include.some((pat) => minimatch(relative, pat));
    if (!included) continue;

    const excluded = pp.exclude.some((pat) => minimatch(relative, pat));
    if (excluded) continue;

    if (!matched.includes(relative)) {
      matched.push(relative);
    }
  }

  return matched;
}
