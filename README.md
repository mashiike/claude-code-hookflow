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

Create `.claude/hookflows/checks.yaml` in your project:

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
    continue: true
    steps:
      - run: npm run lint
  test:
    steps:
      - run: npm test
```

That's it. When Claude edits `.ts` files and tries to stop, hookflow runs the checks. If `typecheck` or `test` fails, Claude is blocked and told to fix it. `lint` has `continue: true`, so failures are reported but don't block.

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

### Failure Config Cascade

`continue` and `stop_reason` resolve in order: **step > job > workflow > default** (`continue: false`).

- `continue: false` (default) — failure blocks Claude from stopping
- `continue: true` — failure is reported but doesn't block

## Template Expressions

Use `${{ }}` in `run` and `working_dir` fields to reference runtime context.

```yaml
jobs:
  fmt:
    steps:
      - run: npx prettier --write ${{ matched_files }}
      - run: go test --short ${{ matched_dirs }}
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
| `continue` | boolean | no | `false` | Don't block on failure |
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
