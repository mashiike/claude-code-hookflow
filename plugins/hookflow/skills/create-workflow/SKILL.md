---
name: create-workflow
description: Create and edit hookflow workflow YAML files. Use when the user wants to add a new workflow, modify an existing workflow, set up automated checks (lint, test, fmt, build), or asks about hookflow YAML syntax. Also trigger when the user says "create workflow", "add a check", "set up hookflow", or similar.
---

# Hookflow Workflow Creator

Create workflow YAML files for the claude-code-hookflow plugin. Workflows define automated checks (fmt, lint, test, build, etc.) that run when Claude Code stops or completes a task.

## Workflow file locations

- **Project**: `.claude/hookflows/<name>.yaml` (or `.yml`)
- **Global**: `~/.claude/hookflows/<name>.yaml`
- Project takes precedence over global with the same filename.

## Quick reference

```yaml
name: "Workflow Name"              # required
on: [Stop, TaskCompleted]          # optional, default: both
paths:                             # required, glob patterns (minimatch)
  - "src/**/*.ts"
paths-ignore:                      # optional
  - "vendor/**"
external_files: false              # optional, default: false
continue: false                    # optional, default: false (block on failure)
stop_reason: "Fix message"         # optional, shown to Claude on failure

jobs:
  job-name:
    each: matched_dirs             # optional, loop over: matched_files/matched_dirs/changed_files/changed_dirs
    needs: other-job               # optional, string or array
    continue: true                 # optional, overrides workflow-level
    stop_reason: "Job message"     # optional
    steps:
      - name: step-id             # optional, for ${{ steps.<name>.* }} reference
        run: "shell command"
        working_dir: "subdir"      # optional, relative to cwd
        if: "${{ expr }}"          # optional, skip step if false
        continue: false            # optional, overrides job-level
        stop_reason: "Step msg"    # optional
```

For the full schema details, see [references/schema.md](references/schema.md).

## Template expressions

Use `${{ }}` syntax in `run` and `working_dir` fields to reference runtime context.

### Available context

| Expression | Type | Description |
|-----------|------|-------------|
| `${{ state.changed_files }}` | string[] | All files changed since last prompt (space-separated) |
| `${{ state.trigger }}` | string | `"Stop"` or `"TaskCompleted"` |
| `${{ state.session_id }}` | string | Current session ID |
| `${{ state.cwd }}` | string | Working directory |
| `${{ state.prompt }}` | string | Current user prompt text |
| `${{ matched_files }}` | string[] | Files that matched this workflow's paths (space-separated) |
| `${{ matched_dirs }}` | string[] | Unique directories of matched files, with trailing `/` |
| `${{ state.changed_dirs }}` | string[] | Unique directories of all changed files, with trailing `/` |
| `${{ each.value }}` | string | Current value in `each` loop (empty outside loop) |
| `${{ workflow.name }}` | string | Workflow name |
| `${{ steps.<name>.exit_code }}` | number | Previous step's exit code |
| `${{ steps.<name>.stdout }}` | string | Previous step's stdout |
| `${{ steps.<name>.stderr }}` | string | Previous step's stderr |

Arrays are joined with spaces when interpolated. Unknown variables resolve to empty string.

### Pipe filters

Apply transformations to values with `| filter_name 'arg'`:

| Filter | Description | Example |
|--------|-------------|---------|
| `prefixed 'str'` | Add prefix to each element (skips if already present) | `${{ matched_dirs \| prefixed './' }}` |
| `suffixed 'str'` | Add suffix to each element (skips if already present) | `${{ matched_dirs \| suffixed '...' }}` |

Filters can be chained: `${{ matched_dirs | prefixed './' | suffixed '...' }}`. Works on both arrays and scalar values.

### Conditions (`if`)

Steps can have an `if` field to conditionally execute:

```yaml
steps:
  - run: echo "only on Stop"
    if: "${{ state.trigger == 'Stop' }}"
  - name: lint
    run: npm run lint
    continue: true
  - run: echo "lint failed"
    if: "${{ steps.lint.exit_code != '0' }}"
```

Supported: `==`, `!=` (string comparison), or bare expression (truthiness check).

## Workflow creation process

1. Ask what checks to run (lint, test, typecheck, fmt, build, etc.)
2. Identify which file patterns should trigger the workflow
3. Determine failure behavior: block Claude (`continue: false`, default) or warn only (`continue: true`)?
4. Write the YAML to `.claude/hookflows/<name>.yaml`

## Key behaviors

- **Triggers**: `Stop` (Claude finishes responding) and `TaskCompleted` (task marked done). Default: both.
- **Path matching**: minimatch globs against files changed since last user prompt.
- **`continue` cascade**: resolves as step > job > workflow > default (`false`).
  - `continue: false` (default): step failure **fails the job** and stops remaining steps.
  - `continue: true`: step failure is **not treated as a failure**; next step runs, job doesn't fail because of this step.
  - Job-level `continue` cascades to all steps in the job.
  - Side effect: if all steps in a job have `continue: true`, the job never fails.
- **`stop_reason` cascade**: resolves independently from `continue`, as step > job > workflow.
- **Workflow result**: all jobs succeed → Claude proceeds. Any job fails → Claude is blocked.
- **Failed run recovery**: if Claude stops without fixing, the failure info is injected as a system message on the next user prompt.
- **Step execution**: Sequential shell commands. First `continue: false` failure stops the job.
- **Timeout**: 300 seconds per step.

## Examples

### TypeScript project

```yaml
name: "TypeScript Check"
stop_reason: "TypeScript checks failed, please fix"
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
jobs:
  typecheck:
    steps:
      - run: npm run typecheck
  lint:
    steps:
      - run: npm run lint
        continue: true
        stop_reason: "ESLint reported issues"
      - run: npm test
```

In this example, `npm run lint` has `continue: true` — if it fails, the failure is reported but the job doesn't fail because of it and `npm test` still runs. If `npm test` fails, the `lint` job fails and blocks Claude.

### Go project

```yaml
name: "Go Checks"
stop_reason: "Go checks failed. Please fix the issues above."
paths: "**/*.go"
paths-ignore:
  - "**/*.gen.go"
jobs:
  lint:
    steps:
      - run: goimports -w ${{ matched_files }}
        continue: true
      - run: golangci-lint run ${{ matched_dirs | prefixed './' }}
        stop_reason: "golangci-lint reported issues. Please fix them."
  test:
    steps:
      - run: go test --short ${{ matched_dirs | prefixed './' }}
```

In `lint`, `goimports -w` auto-fixes formatting and has `continue: true` (its failure doesn't fail the job). `golangci-lint` is the real gate — if it fails, the job fails. The `| prefixed './'` filter adds `./` to directory paths for Go tool compatibility.

### Python project

```yaml
name: "Python Checks"
stop_reason: "Python checks failed. Please fix the issues above."
paths: "**/*.py"
paths-ignore: "docs/**"
jobs:
  lint:
    steps:
      - run: ruff check --fix ${{ matched_files }}
        continue: true
      - run: mypy ${{ matched_files }}
        stop_reason: "mypy reported type errors"
  test:
    steps:
      - run: pytest
```

`ruff check --fix` auto-fixes and has `continue: true`. `mypy` is the gate for the `lint` job.

### Using template expressions and pipe filters

```yaml
name: "Format Changed Files"
paths:
  - "**/*.ts"
jobs:
  fmt:
    steps:
      - name: prettier
        run: npx prettier --check ${{ matched_files }}
        continue: true
      - run: echo "prettier exit code: ${{ steps.prettier.exit_code }}"
        if: "${{ steps.prettier.exit_code != '0' }}"
```

```yaml
# Use pipe filters for Go tooling compatibility
name: "Go Vet"
paths: "**/*.go"
jobs:
  vet:
    steps:
      - run: go vet ${{ matched_dirs | prefixed './' | suffixed '...' }}
```

### Using `each` loop

```yaml
# Run terraform fmt in each changed directory
name: "Terraform Format"
paths:
  - "**/*.tf"
jobs:
  fmt:
    each: matched_dirs
    steps:
      - run: terraform fmt
        working_dir: ${{ each.value }}
```
