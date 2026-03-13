# Hookflow Workflow YAML Schema

## Top-level fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | **yes** | — | Display name for the workflow |
| `on` | string or string[] | no | `[Stop, TaskCompleted]` | Trigger events. Valid values: `Stop`, `TaskCompleted` |
| `paths` | string or string[] | **yes** | — | Glob patterns (minimatch) to match changed files. Workflow is skipped if no paths defined |
| `paths-ignore` | string or string[] | no | `[]` | Glob patterns to exclude from matching |
| `external_files` | boolean | no | `false` | When `true`, also match files outside the project directory (absolute paths) |
| `continue` | boolean | no | `false` | When `true`, failures don't block Claude from stopping. Applies to all jobs/steps unless overridden |
| `stop_reason` | string | no | — | Message shown to Claude when the workflow fails and `continue` is `false` |
| `jobs` | object | no | `{}` | Map of job definitions |

## Job fields

Each key under `jobs` is the job identifier (e.g., `lint`, `test`, `build`).

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | no | — | Display name for the job |
| `needs` | string or string[] | no | `[]` | Job dependencies (not yet enforced in execution order) |
| `continue` | boolean | no | — | Overrides workflow-level `continue` for this job |
| `stop_reason` | string | no | — | Overrides workflow-level `stop_reason` for this job |
| `steps` | step[] | **yes** | — | List of steps to execute sequentially |

## Step fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `run` | string | **yes** | — | Shell command to execute |
| `working_dir` | string | no | cwd | Working directory, relative to project root |
| `continue` | boolean | no | — | Overrides job-level `continue` for this step |
| `stop_reason` | string | no | — | Overrides job-level `stop_reason` for this step |

## Failure configuration cascade

`continue` and `stop_reason` resolve in order: **step > job > workflow > default**.

- Default `continue` is `false` (failures block Claude).
- `stop_reason` propagates from workflow level even when `continue` is not explicitly set.

### Resolution examples

```yaml
# Workflow-level continue: false (default), stop_reason set
stop_reason: "Fix errors"
jobs:
  lint:
    continue: true          # overrides workflow → lint failures don't block
    steps:
      - run: eslint .
  test:                     # inherits workflow continue: false
    steps:
      - run: npm test       # failure blocks, stop_reason: "Fix errors"
```

```yaml
jobs:
  check:
    continue: true
    steps:
      - run: step1          # inherits job continue: true → doesn't block
      - run: step2
        continue: false     # overrides job → this step blocks on failure
```

## Trigger events

| Event | When it fires | Behavior on failure |
|-------|--------------|-------------------|
| `Stop` | Claude finishes responding | `{decision: "block", reason: "..."}` — Claude continues working |
| `TaskCompleted` | Task marked as done | exit 2 + stderr — task stays incomplete, feedback to model |

## Path matching

- Uses [minimatch](https://github.com/isaacs/minimatch) glob syntax.
- Matches against files changed since the last `UserPromptSubmit` event.
- Files inside cwd are stored as relative paths; files outside cwd are absolute.
- `external_files: false` (default) skips absolute-path files.
- Both `paths` and `paths-ignore` accept a single string or an array.

### Common patterns

| Pattern | Matches |
|---------|---------|
| `**/*.ts` | All TypeScript files |
| `src/**/*.go` | Go files under src/ |
| `*.py` | Python files in root only |
| `**/*.{ts,tsx}` | TypeScript and TSX files |
| `Dockerfile` | Dockerfile in root |

## Execution details

- Steps execute sequentially within a job via `child_process.execSync`.
- Each step has a **300-second timeout**.
- stdout and stderr are captured and truncated to **4096 characters** in state.
- On first `continue: false` failure, remaining steps in the job are skipped.
- On `continue: true` failure, execution proceeds to the next step.

## File loading priority

1. Project: `<cwd>/.claude/hookflows/*.yaml` / `*.yml`
2. Global: `~/.claude/hookflows/*.yaml` / `*.yml`

If a project file and global file share the same basename, the project file wins and the global file is skipped.
