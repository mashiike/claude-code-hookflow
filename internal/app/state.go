package app

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// State is the persistent state for a session.
type State struct {
	SessionID     string      `json:"session_id"`
	ChangedFiles  []string    `json:"changed_files"`
	CurrentPrompt *PromptInfo `json:"current_prompt,omitempty"`
	LastRun       *RunResult  `json:"last_run,omitempty"`
}

// PromptInfo holds information about the current user prompt.
type PromptInfo struct {
	Prompt    string    `json:"prompt"`
	StartedAt time.Time `json:"started_at"`
}

// RunResult holds the result of the last workflow run.
type RunResult struct {
	Trigger   string                    `json:"trigger"`
	Workflows map[string]WorkflowResult `json:"workflows,omitempty"`
	Retries   int                       `json:"retries"`
}

// WorkflowResult holds the result of a single workflow execution.
type WorkflowResult struct {
	Outcome    string `json:"outcome"`
	Conclusion string `json:"conclusion"`
}

// StatePathResolver returns the state file path for a given hook event.
// Default implementation derives the path from transcript_path.
type StatePathResolver func(event *HookEvent) string

// DefaultStatePathResolver returns the default state file path
// based on the transcript path directory.
// e.g. /path/to/.claude/projects/.../session-id.jsonl
//
//	-> /path/to/.claude/projects/.../session-id/hookflow/state.json
func DefaultStatePathResolver(event *HookEvent) string {
	dir := strings.TrimSuffix(event.TranscriptPath, filepath.Ext(event.TranscriptPath))
	return filepath.Join(dir, "hookflow", "state.json")
}

// NewStateReader returns an io.ReadCloser for the state file.
// Returns os.ErrNotExist if the state file does not exist.
func NewStateReader(event *HookEvent, resolver StatePathResolver) (io.ReadCloser, error) {
	if resolver == nil {
		resolver = DefaultStatePathResolver
	}
	statePath := resolver(event)
	return os.Open(statePath)
}

// NewStateWriter returns an io.WriteCloser for the state file.
// Creates parent directories if they do not exist.
func NewStateWriter(event *HookEvent, resolver StatePathResolver) (io.WriteCloser, error) {
	if resolver == nil {
		resolver = DefaultStatePathResolver
	}
	statePath := resolver(event)

	dir := filepath.Dir(statePath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}

	return os.Create(statePath)
}

// RemoveState removes the state file and its parent hookflow directory if empty.
func RemoveState(event *HookEvent, resolver StatePathResolver) error {
	if resolver == nil {
		resolver = DefaultStatePathResolver
	}
	statePath := resolver(event)

	if err := os.Remove(statePath); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}

	dir := filepath.Dir(statePath)
	_ = os.Remove(dir)

	return nil
}
