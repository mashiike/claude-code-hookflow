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
name: "Workflow Name"              # optional, defaults to filename
on: [Stop, TaskCompleted]          # optional, default: both
paths:                             # required, glob patterns (minimatch)
  - "src/**/*.ts"
paths-ignore:                      # optional
  - "src/**/*.test.ts"
external_files: false              # optional, default: false
continue: false                    # optional, default: false (block on failure)
stop_reason: "Fix message"         # optional, shown to Claude on failure

jobs:
  job-name:
    needs: other-job               # optional, string or array
    continue: true                 # optional, overrides workflow-level
    stop_reason: "Job message"     # optional
    steps:
      - run: "shell command"
        working_dir: "subdir"      # optional, relative to cwd
        continue: false            # optional, overrides job-level
        stop_reason: "Step msg"    # optional
```

For the full schema details, see [references/schema.md](references/schema.md).

## Workflow creation process

1. Ask what checks to run (lint, test, typecheck, fmt, build, etc.)
2. Identify which file patterns should trigger the workflow
3. Determine failure behavior: block Claude (`continue: false`, default) or warn only (`continue: true`)?
4. Write the YAML to `.claude/hookflows/<name>.yaml`

## Key behaviors

- **Triggers**: `Stop` (Claude finishes responding) and `TaskCompleted` (task marked done). Default: both.
- **Path matching**: minimatch globs against files changed since last user prompt.
- **Failure cascade**: `continue`/`stop_reason` resolve as step > job > workflow > default (`continue: false`).
- **Step execution**: Sequential shell commands. First `continue: false` failure stops the job.
- **Timeout**: 300 seconds per step.

## Examples

### TypeScript project

```yaml
name: "TypeScript Check"
stop_reason: "TypeScript checks failed, please fix"
paths:
  - "src/**/*.ts"
paths-ignore:
  - "src/**/*.test.ts"
jobs:
  typecheck:
    steps:
      - run: npm run typecheck
  lint:
    continue: true
    steps:
      - run: npm run lint
  test:
    needs: typecheck
    steps:
      - run: npm test
```

### Go project

```yaml
name: "Go Checks"
paths: "**/*.go"
paths-ignore: "**/*_test.go"
jobs:
  fmt:
    continue: true
    steps:
      - run: gofmt -l .
  vet:
    steps:
      - run: go vet ./...
  test:
    needs: vet
    steps:
      - run: go test ./...
```

### Python project

```yaml
name: "Python Checks"
paths: "**/*.py"
paths-ignore: "tests/**"
jobs:
  lint:
    continue: true
    steps:
      - run: ruff check .
  typecheck:
    steps:
      - run: mypy .
  test:
    needs: typecheck
    steps:
      - run: pytest
```
