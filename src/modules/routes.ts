// API routes of the live modules: /api/<key>/<action>. A new live module adds its routes here.
import * as maestro from './maestro/routes';
import * as social from './social/routes';
import * as journeys from './journeys/routes';
import * as content from './content/routes';
import * as debuggerRoutes from './debugger/routes';

export const ROUTES = { maestro, social, journeys, content, debugger: debuggerRoutes };
