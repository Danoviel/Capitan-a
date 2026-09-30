import type { LogLine, LogStream } from '@puertosview/shared';

const DEFAULT_CAPACITY = 2000;

/**
 * Buffer circular de logs por proyecto. Se guarda en memoria y acotado: un
 * `runserver` con autoreload puede escupir miles de líneas por hora y no
 * queremos que el panel se coma la RAM ni escriba en disco.
 */
export class LogBuffer {
  #lines = new Map<string, LogLine[]>();
  #capacity: number;
  #seq = 0;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.#capacity = capacity;
  }

  /** Parte un chunk de stdout/stderr en líneas y las almacena. */
  append(projectId: string, stream: LogStream, chunk: string): LogLine[] {
    const normalized = chunk.replace(/\r\n?/g, '\n');
    const parts = normalized.split('\n').filter((part) => part.length > 0);
    if (parts.length === 0) return [];

    const stored = this.#lines.get(projectId) ?? [];
    const created: LogLine[] = [];
    const at = new Date().toISOString();

    for (const text of parts) {
      const line: LogLine = { seq: ++this.#seq, projectId, stream, text, at };
      stored.push(line);
      created.push(line);
    }

    if (stored.length > this.#capacity) {
      stored.splice(0, stored.length - this.#capacity);
    }
    this.#lines.set(projectId, stored);
    return created;
  }

  get(projectId: string): LogLine[] {
    return this.#lines.get(projectId) ?? [];
  }

  clear(projectId: string): void {
    this.#lines.delete(projectId);
  }
}
