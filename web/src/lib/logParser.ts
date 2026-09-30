import type { LogLine } from '@capitania/shared';

export type Severity = 'debug' | 'info' | 'success' | 'warn' | 'error' | 'system';

export interface HttpRequest {
  method: string;
  path: string;
  status: number;
  ms: number;
}

export interface ParsedLog {
  seq: number;
  /** Hora local HH:MM:SS. */
  time: string;
  severity: Severity;
  kind: 'http' | 'ws' | 'text';
  /** Módulo que escribió la línea (`jwt_service`, `kyc_r2_service`...). */
  source: string | null;
  message: string;
  http?: HttpRequest;
  /** Línea que no aporta al seguir una prueba: OPTIONS, estáticos, DEBUG, duplicados. */
  noise: boolean;
}

/** Una línea visible, con cuántas veces se repitió seguida. */
export interface LogGroup {
  log: ParsedLog;
  count: number;
}

const ANSI = /\x1b\[[0-9;]*m/g;
/** Formato de logging de los proyectos Django: `[INFO] 23:51:55 modulo.funcion:120 - mensaje`. */
const DJANGO_LINE = /^\[(DEBUG|INFO|WARNING|ERROR|CRITICAL)\]\s+\d\d:\d\d:\d\d\s+([\w.]+?)(?:\.\w+)?:\d+\s+-\s+(.*)$/;
/** runserver/Daphne: `HTTP GET /api/v1/x/ 200 [0.05, 127.0.0.1:62281]`. */
const HTTP_LINE = /^HTTP (\w+) (\S+) (\d{3}) \[([\d.]+)/;
const WS_LINE = /^WebSocket (\w+) (\S+)/;
const STATIC_PATH = /^\/(static|media|assets)\/|^\/favicon\.ico/;
const ERROR_TEXT = /^Traceback|^\s+File "|^\w+(Error|Exception)\b|\bERROR\b|\bfailed\b/i;
const WARN_TEXT = /warning|deprecat|\bwarn\b/i;

const LEVEL: Record<string, Severity> = {
  DEBUG: 'debug',
  INFO: 'info',
  WARNING: 'warn',
  ERROR: 'error',
  CRITICAL: 'error',
};

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-PE', { hour12: false });
}

function httpSeverity(status: number): Severity {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'success';
}

export function parseLog(line: LogLine): ParsedLog {
  const text = line.text.replace(ANSI, '');
  const base = { seq: line.seq, time: localTime(line.at), source: null, noise: false };

  if (line.stream === 'system') {
    return { ...base, severity: 'system', kind: 'text', message: text };
  }

  const django = text.match(DJANGO_LINE);
  if (django) {
    const [, level, source, message] = django as unknown as [string, string, string, string];
    const http = message.match(HTTP_LINE);
    if (http) {
      const [, method, path, status, seconds] = http as unknown as [string, string, string, string, string];
      const code = Number(status);
      return {
        ...base,
        severity: httpSeverity(code),
        kind: 'http',
        source,
        message,
        http: { method, path, status: code, ms: Math.round(Number(seconds) * 1000) },
        noise: method === 'OPTIONS' || STATIC_PATH.test(path),
      };
    }
    const ws = message.match(WS_LINE);
    if (ws) {
      return { ...base, severity: 'info', kind: 'ws', source, message: `${ws[1]} ${ws[2]}` };
    }
    return {
      ...base,
      severity: LEVEL[level] ?? 'info',
      kind: 'text',
      source,
      message,
      // Django escribe "Not Found: /x" además de la línea HTTP 404: es un duplicado.
      noise: level === 'DEBUG' || source === 'log',
    };
  }

  const severity: Severity = ERROR_TEXT.test(text) ? 'error' : WARN_TEXT.test(text) ? 'warn' : 'info';
  return { ...base, severity, kind: 'text', message: text };
}

/** Junta líneas idénticas seguidas (el mismo aviso x6) en una sola con contador. */
export function groupRepeats(logs: ParsedLog[]): LogGroup[] {
  const groups: LogGroup[] = [];
  for (const log of logs) {
    const last = groups[groups.length - 1];
    if (last && last.log.kind === log.kind && last.log.message === log.message) last.count += 1;
    else groups.push({ log, count: 1 });
  }
  return groups;
}
