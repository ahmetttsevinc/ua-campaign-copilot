import { z } from 'zod';
import type { ToolDefinition } from '../llm/provider.js';
import { TOOLS } from './index.js';

/**
 * JSON schemas for the LLM, generated from the same zod schemas runTool validates with.
 * Uses zod 4's built-in converter (zod-to-json-schema does not support zod 4).
 * `io: 'input'` describes what the caller may send, so fields with defaults are optional.
 */
export function toolDefinitions(): ToolDefinition[] {
  return TOOLS.map((t) => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(t.input, { io: 'input' }) as Record<string, unknown>;
    return { name: t.name, description: t.description, inputSchema: schema };
  });
}
