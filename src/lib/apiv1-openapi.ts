// A small OpenAPI 3 description of /api/v1 (served at /api/v1/openapi.json, written out in docs/api-v1.md).
import { LIMIT_MINUTE } from './readkey';

const period = [
  { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'First day (default: 29 days before `to`).' },
  { name: 'to', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Last day (default: the last day with data).' },
];
const ok = (description: string) => ({ '200': { description, content: { 'application/json': { schema: { type: 'object' } } } }, '401': { $ref: '#/components/responses/Unauthorized' }, '429': { $ref: '#/components/responses/RateLimited' }, '503': { $ref: '#/components/responses/Unavailable' } });
const get = (summary: string, parameters: unknown[] = []) => ({ get: { summary, security: [{ bearer: [] }], parameters, responses: ok(summary) } });

export function openapi(origin: string): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: { title: 'Well dashboard API', version: '1.0.0', description: `Read-only. Send the key as "Authorization: Bearer wad_…". GET and HEAD only; ${LIMIT_MINUTE} requests per minute.` },
    servers: [{ url: `${origin}/api/v1` }],
    paths: {
      '/dash': get('Dashboard numbers (the overview data, CRM as totals only)'),
      '/overview': get('Totals and the marketing judge for a period', period),
      '/ads': get('Ads with status and metrics for a period', [...period,
        { name: 'platform', in: 'query', schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 2000, default: 500 } }]),
      '/decisions': get('Decision-board suggestions and recent outcomes'),
      '/campaigns': get('Ahlam campaigns and task status'),
      '/health': get('Data freshness and step status'),
      '/openapi.json': { get: { summary: 'This description', security: [{ bearer: [] }], responses: ok('OpenAPI 3 document') } },
    },
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'The read API key: wad_…' } },
      responses: {
        Unauthorized: { description: 'Missing or wrong key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
                RateLimited: { description: 'Over the per-minute limit, or too many wrong keys from one address (see Retry-After)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        Unavailable: { description: 'The limit counter is down or the server is not fully configured', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
      schemas: { Error: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } } },
    },
  };
}
