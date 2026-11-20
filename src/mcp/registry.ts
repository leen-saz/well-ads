// Every Well MCP tool, by name. A new platform action is added here, never called directly from a page or a job (docs/PRD.md §3.0).
import type { Tool } from './types';
import { READ_TOOLS } from './tools/read';
import { socialPostCreate } from './tools/social';

export const TOOLS = new Map<string, Tool<never>>(([...READ_TOOLS, socialPostCreate] as Tool<never>[]).map(t => [t.name, t]));
