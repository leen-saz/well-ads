// A small OpenAPI 3 description of /api/v1 (served at /api/v1/openapi.json, written out in docs/api-v1.md).
import { SCOPES, LIMIT_DAY, LIMIT_MINUTE } from './apikeys';

const period = [
  { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'First day (default: 29 days before `to`).' },
  { name: 'to', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Last day (default: the last day with data).' },
];
const ok = (description: string) => ({ '200': { description, content: { 'application/json': { schema: { type: 'object' } } } }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '429': { $ref: '#/components/responses/RateLimited' }, '503': { $ref: '#/components/responses/Unavailable' } });
const get = (scope: string, summary: string, parameters: unknown[] = []) => ({ get: { summary, description: `Needs the \`${scope}\` scope.`, security: [{ bearer: [] }], parameters, responses: ok(summary) } });

export function openapi(origin: string): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: { title: 'Well dashboard API', version: '1.0.0', description: `Read-only. Send a key as "Authorization: Bearer wad_…". GET and HEAD only; ${LIMIT_MINUTE} requests per minute and ${LIMIT_DAY} per day per key. Scopes: ${Object.keys(SCOPES).join(', ')}.` },
    servers: [{ url: `${origin}/api/v1` }],
    paths: {
      '/dash': get('dash', 'Dashboard numbers (the overview data, CRM as totals only)'),
      '/overview': get('dash', 'Totals and the marketing judge for a period', period),
      '/ads': get('ads', 'Ads with status and metrics for a period', [...period,
        { name: 'platform', in: 'query', schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 2000, default: 500 } }]),
      '/decisions': get('decisions', 'Decision-board suggestions and recent outcomes'),
      '/campaigns': get('campaigns', 'Ahlam campaigns and task status'),
      '/health': get('health', 'Data freshness and step status'),
      '/openapi.json': { get: { summary: 'This description', description: 'Any valid key.', security: [{ bearer: [] }], responses: ok('OpenAPI 3 document') } },
    },
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'API key made by the owner: wad_…' } },
      responses: {
        Unauthorized: { description: 'Missing, unknown, expired or revoked key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        Forbidden: { description: 'The key does not have the scope', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        RateLimited: { description: 'Over the per-minute or per-day limit (see Retry-After)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        Unavailable: { description: 'API keys are not set up on the server yet, or the counter is down', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
      schemas: { Error: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } } },
    },
  };
}
