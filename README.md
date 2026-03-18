# claude-code-hookflow

> YAML-defined workflows triggered by Claude Code hooks — fmt, lint, test, and more.

Claude Code plugin that automatically runs YAML-defined workflows (typecheck, lint, test, fmt, etc.) when Claude stops or completes a task. If a check fails, Claude is blocked from stopping and receives feedback to fix the issue.

## Install

First, add the marketplace:

```
/plugin marketplace add mashiike/claude-code-hookflow
```

Then install the plugin:

```
/plugin install hookflow@claude-code-hookflow
```

## Quick Start

The easiest way to create a workflow is with the built-in skill:

```
/create-workflow
```

Claude will ask about your project's language and tools, then generate a workflow YAML for you.

You can also create `.claude/hookflows/checks.yaml` manually:

```yaml
name: "TypeScript Check"
stop_reason: "TypeScript checks failed, please fix before proceeding"

paths:
  - "src/**/*.ts"

jobs:
  typecheck:
    steps:
      - run: npm run typecheck
  lint:
    steps:
      - run: npm run lint
        continue: true
      - run: npm test
```

That's it. When Claude edits `.ts` files and tries to stop, hookflow runs the checks. If `typecheck` fails, its job fails. In the `lint` job, the first step (`npm run lint`) has `continue: true`, so its failure doesn't fail the job — the next step still runs. `npm test` has no `continue`, so its failure fails the job. Any job failure blocks Claude and tells it to fix the issues.

## How It Works

1. **UserPromptSubmit** — Resets tracking for the new prompt
2. **PostToolUse** (Write/Edit) — Records changed files
3. **Stop / TaskCompleted** — Matches changed files against workflow `paths`, runs matching jobs
4. **SessionEnd** — Cleans up state

### Failure Behavior

| Trigger | On failure | Effect |
|---------|-----------|--------|
| **Stop** | `{decision: "block", reason: "..."}` | Claude continues working to fix |
| **TaskCompleted** | exit 2 + stderr | Task stays incomplete, feedback to model |

If Claude stops without fixing the issues and the user sends a new prompt, the previous failure info is automatically injected as a system message so Claude can pick up where it left off.

### `continue` Semantics

`continue` resolves in order: **step > job > workflow > default** (`false`).

- **`continue: false`** (default) — step failure **fails the job** and stops remaining steps
- **`continue: true`** — step failure is **not treated as a failure**; the next step runs and the job does not fail because of this step

Job-level `continue` cascades to all steps in the job. As a side effect, if all steps have `continue: true`, the job never fails.

**Workflow result**: all jobs succeed → Claude proceeds. Any job fails → Claude is blocked.

### `stop_reason` Cascade

`stop_reason` resolves independently from `continue`, in order: **step > job > workflow**. This means you can set `stop_reason` on a step without setting `continue`.

## Template Expressions

Use `${{ }}` in `run` and `working_dir` fields to reference runtime context.

```yaml
jobs:
  fmt:
    steps:
      - run: npx prettier --write ${{ matched_files }}
      - run: golangci-lint run ${{ matched_dirs | prefixed './' }}
      - name: lint
        run: npm run lint
        continue: true
      - run: echo "lint exited ${{ steps.lint.exit_code }}"
        if: "${{ steps.lint.exit_code != '0' }}"
```

### Available context

| Expression | Description |
|-----------|-------------|
| `${{ state.changed_files }}` | All changed files (space-separated) |
| `${{ state.changed_dirs }}` | Unique directories of changed files (trailing `/`) |
| `${{ state.trigger }}` | `"Stop"` or `"TaskCompleted"` |
| `${{ state.cwd }}` | Working directory |
| `${{ state.prompt }}` | Current user prompt |
| `${{ matched_files }}` | Files matching this workflow's paths |
| `${{ matched_dirs }}` | Unique directories of matched files |
| `${{ each.value }}` | Current value in `each` loop |
| `${{ workflow.name }}` | Workflow name |
| `${{ steps.<name>.exit_code }}` | Previous named step's exit code |
| `${{ steps.<name>.stdout }}` | Previous named step's stdout |
| `${{ steps.<name>.stderr }}` | Previous named step's stderr |

### Pipe filters

Apply transformations to values with `| filter_name 'arg'`:

| Filter | Description | Example |
|--------|-------------|---------|
| `prefixed 'str'` | Add prefix to each element (skips if already present) | `${{ matched_dirs \| prefixed './' }}` |
| `suffixed 'str'` | Add suffix to each element (skips if already present) | `${{ matched_dirs \| suffixed '...' }}` |

Filters can be chained: `${{ matched_dirs | prefixed './' | suffixed '...' }}`. Works on both arrays and scalar values.

### Step conditions

```yaml
steps:
  - run: echo "only on Stop"
    if: "${{ state.trigger == 'Stop' }}"
```

Supports `==`, `!=` (string comparison), and bare truthiness check.

## Job `each` Loop

Iterate a job over changed files or directories:

```yaml
# Run terraform fmt in each changed directory
jobs:
  fmt:
    each: matched_dirs
    steps:
      - run: terraform fmt
        working_dir: ${{ each.value }}
```

Valid `each` values: `matched_files`, `matched_dirs`, `changed_files`, `changed_dirs`.

## Workflow YAML Reference

### Top-level fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Workflow display name |
| `on` | string / string[] | no | `[Stop, TaskCompleted]` | Trigger events |
| `paths` | string / string[] | yes | — | Glob patterns (minimatch) to match changed files |
| `paths-ignore` | string / string[] | no | `[]` | Glob patterns to exclude |
| `external_files` | boolean | no | `false` | Match files outside the project |
| `continue` | boolean | no | `false` | Step failures not treated as job failures |
| `stop_reason` | string | no | — | Message for Claude on failure |
| `jobs` | object | no | `{}` | Job definitions |

### Job fields

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `steps` | step[] | yes | — |
| `each` | string | no | — |
| `needs` | string / string[] | no | `[]` |
| `continue` | boolean | no | — |
| `stop_reason` | string | no | — |

### Step fields

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `run` | string | yes | — |
| `name` | string | no | — |
| `if` | string | no | — |
| `working_dir` | string | no | cwd |
| `continue` | boolean | no | — |
| `stop_reason` | string | no | — |

### File locations

- **Project**: `.claude/hookflows/*.yaml` (or `.yml`)
- **Global**: `~/.claude/hookflows/*.yaml`

Project files take precedence over global files with the same name.

## Development

```bash
npm install
npm run build      # esbuild → plugins/hookflow/dist/index.js
npm run typecheck   # tsc --noEmit
npm test           # vitest
```

### Local testing

```bash
task install-local   # Build + inject hooks into .claude/settings.local.json
task uninstall-local # Remove hooks
```

## License

MIT
