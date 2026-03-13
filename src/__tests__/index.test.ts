import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

describe('dumpInput (via CLI)', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('creates dump file with correct format', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookflow-dump-test-'));
    const input = JSON.stringify({
      session_id: 'sess-1',
      transcript_path: path.join(tmpDir, 'test.jsonl'),
      cwd: tmpDir,
      hook_event_name: 'SessionStart',
    });

    execSync(`node plugins/hookflow/dist/index.js`, {
      input,
      cwd: process.cwd(),
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOOKFLOW_DEBUG: '1' },
    });

    const dumpDir = path.join(tmpDir, '.claude', 'hooks_dump');
    expect(fs.existsSync(dumpDir)).toBe(true);

    const files = fs.readdirSync(dumpDir);
    const dumpFiles = files.filter((f) => f.startsWith('dump_') && f.endsWith('.json'));
    expect(dumpFiles.length).toBeGreaterThanOrEqual(1);

    const content = fs.readFileSync(path.join(dumpDir, dumpFiles[0]!), 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.session_id).toBe('sess-1');
  });

  it('exits with error for invalid JSON', () => {
    expect(() => {
      execSync(`node plugins/hookflow/dist/index.js`, {
        input: 'not json',
        cwd: process.cwd(),
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }).toThrow();
  });
});
