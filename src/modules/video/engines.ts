// The engines this tab can use. One today; a second one is a new file and one line here.
import type { Engine } from './engine';
import { higgsfield } from './higgsfield';

export const ENGINES: Engine[] = [higgsfield];
export const DEFAULT_ENGINE = higgsfield.id;
export const engineOf = (id: unknown): Engine | undefined => ENGINES.find(e => e.id === id);
