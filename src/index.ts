import * as fs from 'node:fs';
import * as path from 'node:path';
import { App } from './app.js';

function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${y}${mo}${d}_${h}${mi}${s}.${ms}`;
}

function dumpInput(input: Buffer): void {
  if (process.env.HOOKFLOW_DEBUG !== '1') {
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(input.toString('utf-8')) as Record<string, unknown>;
  } catch {
    return;
  }

  const rawCwd = parsed.cwd;
  if (typeof rawCwd !== 'string' || rawCwd === '') {
    return;
  }

  const cwd = path.resolve(rawCwd);
  if (!path.isAbsolute(cwd)) {
    return;
  }

  const dumpDir = path.join(cwd, '.claude', 'hooks_dump');
  try {
    fs.mkdirSync(dumpDir, { recursive: true, mode: 0o750 });
  } catch (err) {
    process.stderr.write(`hookflow: failed to create dump dir: ${err}\n`);
    return;
  }

  let formatted: string;
  try {
    formatted = JSON.stringify(parsed, null, 2);
  } catch {
    formatted = input.toString('utf-8');
  }

  const filename = `dump_${formatTimestamp(new Date())}.json`;
  const dumpPath = path.join(dumpDir, filename);
  try {
    fs.writeFileSync(dumpPath, formatted + '\n', { mode: 0o600 });
  } catch (err) {
    process.stderr.write(`hookflow: failed to write dump: ${err}\n`);
    return;
  }
  process.stderr.write(`hookflow: dumped to ${dumpPath}\n`);
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  const data = Buffer.concat(chunks);

  dumpInput(data);

  const app = new App();
  const result = app.run(data);

  if (result) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.exitCode !== 0) {
      process.exit(result.exitCode);
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`hookflow: ${err}\n`);
  process.exit(1);
});
