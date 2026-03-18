# Hookflow Workflow YAML Schema

## Top-level fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | **yes** | — | Display name for the workflow |
| `on` | string or string[] | no | `[Stop, TaskCompleted]` | Trigger events. Valid values: `Stop`, `TaskCompleted` |
| `paths` | string or string[] | **yes** | — | Glob patterns (minimatch) to match changed files. Workflow is skipped if no paths defined |
| `paths-ignore` | string or string[] | no | `[]` | Glob patterns to exclude from matching |
| `external_files` | boolean | no | `false` | When `true`, also match files outside the project directory (absolute paths) |
| `continue` | boolean | no | `false` | When `true`, step failures are not treated as job failures. Cascades to all jobs/steps unless overridden |
| `stop_reason` | string | no | — | Message shown to Claude when the workflow fails and `continue` is `false` |
| `jobs` | object | no | `{}` | Map of job definitions |

## Job fields

Each key under `jobs` is the job identifier (e.g., `lint`, `test`, `build`).

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | no | — | Display name for the job |
| `each` | string | no | — | Loop source: `matched_files`, `matched_dirs`, `changed_files`, or `changed_dirs`. Job runs once per item, with `${{ each.value }}` set to current item |
| `needs` | string or string[] | no | `[]` | Job dependencies (not yet enforced in execution order) |
| `continue` | boolean | no | — | Overrides workflow-level `continue`. Cascades to all steps in this job |
| `stop_reason` | string | no | — | Message shown to Claude when a step in this job fails |
| `steps` | step[] | **yes** | — | List of steps to execute sequentially |

## Step fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | no | — | Step identifier for `${{ steps.<name>.* }}` references |
| `run` | string | **yes** | — | Shell command to execute. Supports `${{ }}` template expressions |
| `if` | string | no | — | Condition expression. Step is skipped when it evaluates to false |
| `working_dir` | string | no | cwd | Working directory, relative to project root. Supports `${{ }}` template expressions |
| `continue` | boolean | no | — | When `true`, this step's failure is not treated as a job failure. Overrides job-level `continue` |
| `stop_reason` | string | no | — | Message shown to Claude when this step fails |

## Template expressions

Use `${{ }}` in `run` and `working_dir` fields to interpolate runtime context.

### Available context

| Expression | Type | Description |
|-----------|------|-------------|
| `state.changed_files` | string[] | All files changed since last prompt (space-separated when interpolated) |
| `state.trigger` | string | `"Stop"` or `"TaskCompleted"` |
| `state.session_id` | string | Current session ID |
| `state.cwd` | string | Working directory |
| `state.prompt` | string | Current user prompt text |
| `matched_files` | string[] | Files matching this workflow's `paths` (space-separated when interpolated) |
| `matched_dirs` | string[] | Unique directories of matched files, with trailing `/` (space-separated) |
| `state.changed_dirs` | string[] | Unique directories of all changed files, with trailing `/` (space-separated) |
| `each.value` | string | Current value in `each` loop (empty string outside loop) |
| `workflow.name` | string | Workflow display name |
| `steps.<name>.exit_code` | number | Exit code of a previously executed named step |
| `steps.<name>.stdout` | string | Standard output of a previously executed named step |
| `steps.<name>.stderr` | string | Standard error of a previously executed named step |

- Unknown variables resolve to empty string `""`.
- Arrays are joined with spaces.
- Numeric values are converted to string.

### Pipe filters

Transformations can be applied to values with `| filter_name 'arg'`:

| Filter | Description | Example |
|--------|-------------|---------|
| `prefixed 'str'` | Add prefix to each element (skips if already present) | `${{ matched_dirs \| prefixed './' }}` |
| `suffixed 'str'` | Add suffix to each element (skips if already present) | `${{ matched_dirs \| suffixed '...' }}` |

Filters can be chained: `${{ matched_dirs | prefixed './' | suffixed '...' }}`. Works on both arrays and scalar values.

### Conditions (`if` field)

The `if` field supports:

- **Equality**: `${{ state.trigger == 'Stop' }}` — string comparison
- **Inequality**: `${{ steps.lint.exit_code != '0' }}`
- **Truthiness**: `${{ state.prompt }}` — true if non-empty, non-"false", non-"0"

Both `${{ expr }}` wrapped and bare `expr` forms are accepted. String literals can use single or double quotes.

## Failure configuration cascade

### `continue` resolution

Resolves in order: **step > job > workflow > default** (`false`).

- **`continue: false`** (default) — step failure **fails the job** and stops remaining steps in the job.
- **`continue: true`** — step failure is **not treated as a failure**. The next step runs, and the job does not fail because of this step.
- Job-level `continue` cascades to all steps in the job. Side effect: if all steps have `continue: true`, the job never fails.
- **Workflow result**: all jobs succeed → Claude proceeds. Any job fails → Claude is blocked.

### `stop_reason` resolution

Resolves **independently** from `continue`, in order: **step > job > workflow**. You can set `stop_reason` on a step without setting `continue`.

### Resolution examples

```yaml
stop_reason: "Fix errors"
jobs:
  lint:
    steps:
      - run: eslint --fix .
        continue: true      # failure not treated as job failure, next step runs
      - run: npm test        # inherits workflow continue: false → failure fails the job
                             # stop_reason: "Fix errors" (from workflow)
```

```yaml
jobs:
  check:
    continue: true           # cascades to all steps → job never fails
    steps:
      - run: step1           # inherits job continue: true → failure not a job failure
      - run: step2
        continue: false      # overrides job → this step's failure fails the job
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
- On first `continue: false` failure, remaining steps in the job are skipped and the job is marked as failed.
- On `continue: true` failure, execution proceeds to the next step. The step is not treated as a failure for the job.
- Skipped steps (via `if` condition) are recorded with `status: "skipped"`.
- Step context (`steps.<name>.*`) is scoped per job and reset between jobs.
- Jobs with `each` run once per item. All iteration steps are merged into a single job result. If any iteration fails, the job status is `failure`.

## File loading priority

1. Project: `<cwd>/.claude/hookflows/*.yaml` / `*.yml`
2. Global: `~/.claude/hookflows/*.yaml` / `*.yml`

If a project file and global file share the same basename, the project file wins and the global file is skipped.
