package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"slices"
	"time"
)

// App is the main application.
type App struct {
	StatePathResolver StatePathResolver
}

// Run processes a hook event.
func (app *App) Run(ctx context.Context, input []byte) error {
	event, err := ParseHookEvent(input)
	if err != nil {
		return err
	}

	switch event.HookEventName {
	case "UserPromptSubmit":
		return app.handleUserPromptSubmit(ctx, event)
	case "PostToolUse":
		return app.handlePostToolUse(ctx, event)
	case "Stop":
		return app.handleStop(ctx, event)
	case "SessionEnd":
		return app.handleSessionEnd(ctx, event)
	default:
		return nil
	}
}

func (app *App) handleUserPromptSubmit(_ context.Context, event *HookEvent) error {
	state, err := app.loadState(event)
	if err != nil {
		state = nil
	}
	if state == nil {
		state = &State{SessionID: event.SessionID, CWD: event.CWD}
	}

	var detail struct {
		Prompt string `json:"prompt"`
	}
	if err := event.Unmarshal(&detail); err != nil {
		return fmt.Errorf("failed to unmarshal UserPromptSubmit: %w", err)
	}

	state.ChangedFiles = nil
	state.CurrentPrompt = &PromptInfo{
		Prompt:    detail.Prompt,
		StartedAt: time.Now(),
	}
	state.LastRun = nil

	return app.saveState(event, state)
}

func (app *App) handlePostToolUse(_ context.Context, event *HookEvent) error {
	filePath := event.ToolInput.FilePath
	if filePath == "" {
		return nil
	}

	state, err := app.loadState(event)
	if err != nil {
		state = nil
	}
	if state == nil {
		state = &State{SessionID: event.SessionID, CWD: event.CWD}
	}

	if slices.Contains(state.ChangedFiles, filePath) {
		return nil
	}
	state.ChangedFiles = append(state.ChangedFiles, filePath)

	return app.saveState(event, state)
}

func (app *App) handleStop(_ context.Context, event *HookEvent) error {
	if event.StopHookActive {
		return nil
	}

	state, err := app.loadState(event)
	if err != nil {
		return nil
	}

	if len(state.ChangedFiles) == 0 {
		return nil
	}

	// TODO: match changed files against workflow patterns and execute
	fmt.Fprintf(os.Stderr, "hookflow: %d file(s) changed, workflow execution not yet implemented\n", len(state.ChangedFiles))

	return nil
}

func (app *App) handleSessionEnd(_ context.Context, event *HookEvent) error {
	return RemoveState(event, app.StatePathResolver)
}

func (app *App) loadState(event *HookEvent) (_ *State, retErr error) {
	r, err := NewStateReader(event, app.StatePathResolver)
	if err != nil {
		return nil, err
	}
	defer func() {
		if cErr := r.Close(); cErr != nil && retErr == nil {
			retErr = cErr
		}
	}()

	data, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}

	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	return &state, nil
}

func (app *App) saveState(event *HookEvent, state *State) (retErr error) {
	w, err := NewStateWriter(event, app.StatePathResolver)
	if err != nil {
		return err
	}
	defer func() {
		if cErr := w.Close(); cErr != nil && retErr == nil {
			retErr = cErr
		}
	}()

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}

	_, err = w.Write(data)
	return err
}
