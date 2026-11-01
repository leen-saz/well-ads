// Every tab of the agents system, in sidebar order. Adding a tab = a folder with module.ts, then one line here.
// Meta only (no routes), so auth and the gate can read it without importing the modules' code.
import type { ModuleMeta } from './types';
import { meta as maestroMeta } from './maestro/module';
import { meta as socialMeta } from './social/module';
import { meta as journeysMeta } from './journeys/module';
import { meta as contentMeta } from './content/module';
import { meta as debuggerMeta } from './debugger/module';
import { meta as complianceMeta } from './compliance/module';
import { meta as listeningMeta } from './listening/module';
import { meta as designMeta } from './design/module';
import { meta as voiceMeta } from './voice/module';

export const MODULES: ModuleMeta[] = [maestroMeta, socialMeta, journeysMeta, contentMeta, debuggerMeta, complianceMeta, listeningMeta, designMeta, voiceMeta];
export const LIVE = MODULES.filter(m => m.status === 'live').map(m => m.key);
export const isModule = (k: string): boolean => MODULES.some(m => m.key === k);
