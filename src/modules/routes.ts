// API routes of the live modules: /api/<key>/<action>. A new live module adds its routes here.
import * as maestro from './maestro/routes';
import * as social from './social/routes';
import * as journeys from './journeys/routes';
import * as content from './content/routes';
import * as debuggerRoutes from './debugger/routes';
import * as compliance from './compliance/routes';
import * as listening from './listening/routes';
import * as design from './design/routes';
import * as voice from './voice/routes';
import * as copy from './copy/routes';
import * as knowledge from './knowledge/routes';
import * as overview from './overview/routes';
import * as transcribe from './transcribe/routes';
import * as vision from './vision/routes';
import * as voiceover from './voiceover/routes';
import * as video from './video/routes';

export const ROUTES = { maestro, social, journeys, content, debugger: debuggerRoutes, compliance, listening, design, voice, copy, knowledge, overview, transcribe, vision, voiceover, video };
