import * as path from 'node:path';

export interface TemplateContext {
  state: {
    changed_files: string[];
    changed_dirs: string[];
    trigger: string;
    session_id: string;
    cwd: string;
    prompt: string;
  };
  workflow: {
    name: string;
  };
  matched_files: string[];
  matched_dirs: string[];
  each: { value: string };
  steps: Record<string, { exit_code: number; stdout: string; stderr: string }>;
}

export function uniqueDirs(files: string[]): string[] {
  const dirs = new Set(
    files.map((f) => {
      const d = path.dirname(f);
      return d === '.' ? './' : d.endsWith('/') ? d : d + '/';
    }),
  );
  return [...dirs].sort();
}

const EXPR_RE = /\$\{\{\s*(.*?)\s*\}\}/g;

function resolveExpression(expr: string, ctx: TemplateContext): unknown {
  const parts = expr.split('.');
  let current: unknown = ctx;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function valueToString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) return val.join(' ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export function expandTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(EXPR_RE, (_match, expr: string) => {
    const val = resolveExpression(expr.trim(), ctx);
    return valueToString(val);
  });
}

function isTruthy(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (Array.isArray(val)) return val.length > 0;
  const s = String(val);
  return s !== '' && s !== 'false' && s !== '0';
}

function stripQuotes(s: string): string {
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  return s;
}

function resolveOperand(operand: string, ctx: TemplateContext): string {
  const trimmed = operand.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return stripQuotes(trimmed);
  }
  return valueToString(resolveExpression(trimmed, ctx));
}

export function evaluateCondition(expr: string, ctx: TemplateContext): boolean {
  let inner = expr.trim();
  // Strip ${{ }} wrapper if present
  const wrapped = inner.match(/^\$\{\{\s*(.*?)\s*\}\}$/);
  if (wrapped) {
    inner = wrapped[1]!;
  }

  // Check for != (must check before ==)
  const neqIdx = inner.indexOf('!=');
  if (neqIdx !== -1) {
    const left = resolveOperand(inner.slice(0, neqIdx), ctx);
    const right = resolveOperand(inner.slice(neqIdx + 2), ctx);
    return left !== right;
  }

  // Check for ==
  const eqIdx = inner.indexOf('==');
  if (eqIdx !== -1) {
    const left = resolveOperand(inner.slice(0, eqIdx), ctx);
    const right = resolveOperand(inner.slice(eqIdx + 2), ctx);
    return left === right;
  }

  // No operator: truthiness check
  const val = resolveExpression(inner, ctx);
  return isTruthy(val);
}
