// Every Well MCP tool, by name. A new platform action is added here, never called directly from a page or a job (docs/PRD.md §3.0).
import type { Tool } from './types';
import { READ_TOOLS } from './tools/read';
import { socialPostCreate } from './tools/social';
import { TIKTOK_TOOLS } from './tools/tiktok';
import { ADS_TOOLS } from './tools/ads';
import { REPORT_TOOLS } from './tools/reports';

export const TOOLS = new Map<string, Tool<never>>(([...READ_TOOLS, ...TIKTOK_TOOLS, socialPostCreate, ...ADS_TOOLS, ...REPORT_TOOLS] as Tool<never>[]).map(t => [t.name, t]));
