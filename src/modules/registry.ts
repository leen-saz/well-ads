// Every tab of the agents system, in sidebar order. Adding a tab = a folder with module.ts, then one line here.
// Meta only (no routes), so auth and the gate can read it without importing the modules' code.
import type { ModuleMeta } from './types';
// The sidebar groups: one list, defined next to the sidebar (public/assets/sidebar.js) and read here, by the Manager page and by the tests
import { GROUPS as SIDEBAR_GROUPS } from '../../public/assets/sidebar.js';
import { meta as maestroMeta } from './maestro/module';
import { meta as socialMeta } from './social/module';
import { meta as journeysMeta } from './journeys/module';
import { meta as contentMeta } from './content/module';
import { meta as debuggerMeta } from './debugger/module';
import { meta as complianceMeta } from './compliance/module';
import { meta as listeningMeta } from './listening/module';
import { meta as designMeta } from './design/module';
import { meta as voiceMeta } from './voice/module';
import { meta as copyMeta } from './copy/module';
import { meta as knowledgeMeta } from './knowledge/module';
import { meta as overviewMeta } from './overview/module';
import { meta as transcribeMeta } from './transcribe/module';
import { meta as visionMeta } from './vision/module';
import { meta as voiceoverMeta } from './voiceover/module';
import { meta as buyerMeta } from './buyer/module';
import { meta as videoMeta } from './video/module';

// Listed by sidebar group, in marketing order: produce, distribute, measure, optimize, system
export const MODULES: ModuleMeta[] = [overviewMeta, listeningMeta, designMeta, videoMeta, contentMeta, copyMeta, voiceMeta, voiceoverMeta, transcribeMeta, visionMeta, socialMeta, journeysMeta, maestroMeta, debuggerMeta, buyerMeta, knowledgeMeta, complianceMeta];
export const LIVE = MODULES.filter(m => m.status === 'live').map(m => m.key);
// The sections of a tab: the modules shown inside it (voiceover in voice, copy in content)
export const sectionsOf = (key: string): string[] => MODULES.filter(m => m.into === key).map(m => m.key);
export const isModule = (k: string): boolean => MODULES.some(m => m.key === k);

export const GROUPS: { key: string; ar: string; en: string }[] = (SIDEBAR_GROUPS as string[][]).map(([key, ar, en]) => ({ key: key!, ar: ar!, en: en! }));
