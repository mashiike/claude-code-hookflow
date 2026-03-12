package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	"github.com/mashiike/claude-code-hookflow/internal/app"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintf(os.Stderr, "hookflow: failed to read stdin: %v\n", err)
		os.Exit(1)
	}

	dumpInput(data)

	a := &app.App{}
	if err := a.Run(ctx, data); err != nil {
		fmt.Fprintf(os.Stderr, "hookflow: %v\n", err)
		os.Exit(1)
	}
}

func dumpInput(input []byte) {
	var parsed struct {
		CWD string `json:"cwd"`
	}
	if err := json.Unmarshal(input, &parsed); err != nil || parsed.CWD == "" {
		return
	}
	cwd := filepath.Clean(parsed.CWD)
	if !filepath.IsAbs(cwd) {
		return
	}
	dumpDir := filepath.Join(cwd, ".claude", "hookflow")
	if err := os.MkdirAll(dumpDir, 0o750); err != nil {
		fmt.Fprintf(os.Stderr, "hookflow: failed to create dump dir: %v\n", err)
		return
	}

	var pretty json.RawMessage
	if err := json.Unmarshal(input, &pretty); err != nil {
		pretty = input
	}
	formatted, err := json.MarshalIndent(pretty, "", "  ")
	if err != nil {
		formatted = input
	}

	filename := fmt.Sprintf("dump_%s.json", time.Now().Format("20060102_150405.000"))
	dumpPath := filepath.Join(dumpDir, filename)
	if err := os.WriteFile(dumpPath, formatted, 0o600); err != nil { //nolint:gosec // G703: cwd is provided by Claude Code hook system, not arbitrary user input
		fmt.Fprintf(os.Stderr, "hookflow: failed to write dump: %v\n", err)
		return
	}
	fmt.Fprintf(os.Stderr, "hookflow: dumped to %s\n", dumpPath)
}
