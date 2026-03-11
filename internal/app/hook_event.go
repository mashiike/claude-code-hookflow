package app

import (
	"encoding/json"
	"fmt"
)

// HookEvent represents the common fields of a Claude Code hook event.
// Event-specific fields can be extracted from RawMessage.
type HookEvent struct {
	SessionID      string `json:"session_id"`
	TranscriptPath string `json:"transcript_path"`
	CWD            string `json:"cwd"`
	HookEventName  string `json:"hook_event_name"`

	ToolName       string          `json:"tool_name,omitempty"`
	ToolInput      ToolInput       `json:"tool_input,omitzero"`
	StopHookActive bool            `json:"stop_hook_active,omitempty"`
	RawMessage     json.RawMessage `json:"-"`
}

// ToolInput represents the tool_input field of PostToolUse events.
type ToolInput struct {
	FilePath string `json:"file_path,omitempty"`
}

// ParseHookEvent parses raw JSON into a HookEvent.
func ParseHookEvent(data []byte) (*HookEvent, error) {
	var event HookEvent
	if err := json.Unmarshal(data, &event); err != nil {
		return nil, fmt.Errorf("failed to parse hook event: %w", err)
	}
	event.RawMessage = json.RawMessage(data)

	if event.SessionID == "" {
		return nil, fmt.Errorf("session_id is required")
	}
	if event.TranscriptPath == "" {
		return nil, fmt.Errorf("transcript_path is required")
	}

	return &event, nil
}

// Unmarshal extracts event-specific fields from RawMessage into the given target.
func (e *HookEvent) Unmarshal(target any) error {
	if e.RawMessage == nil {
		return fmt.Errorf("no raw message available")
	}
	return json.Unmarshal(e.RawMessage, target)
}
