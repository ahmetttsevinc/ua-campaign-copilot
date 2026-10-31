import { EventEmitter } from 'node:events';
import type { AgentEvent } from '@copilot/shared';

/**
 * In-process pub/sub between the agent loop and SSE connections. Enough for one API process;
 * multiple instances would need Postgres LISTEN/NOTIFY or Redis instead.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // One listener per open SSE connection; the default cap of 10 would warn spuriously.
    this.emitter.setMaxListeners(0);
  }

  emit(event: AgentEvent): void {
    this.emitter.emit(event.runId, event);
  }

  subscribe(runId: string, listener: (event: AgentEvent) => void): () => void {
    this.emitter.on(runId, listener);
    return () => this.emitter.off(runId, listener);
  }
}
