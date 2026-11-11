import { describe, expect, it } from 'vitest';
import { staleText, ownerText } from '../../public/assets/freshness.js';
import { TECH_WORDS } from '../shared/tech-words';

const st = (warnings: string[], h: number | null = 8) => ({ level: warnings.includes('data_very_old') || warnings.includes('no_data') ? 'stale' : 'warn', warnings, dash_age_hours: h });

describe('stale notice wording', () => {
  it('says nothing when the data is fine or unknown', () => {
    expect(staleText({ level: 'ok', warnings: [] })).toEqual([]);
    expect(staleText({ level: 'unknown', warnings: [] })).toEqual([]);
    expect(staleText(null)).toEqual([]);
  });
  it('old data is a plain sentence with an age band, and a 3-hour delay is not a banner for users', () => {
    expect(staleText(st(['data_very_old'], 8))[0]).toContain('أكثر من ٦ ساعات');
    expect(staleText(st(['data_very_old'], 30))[0]).toContain('أكثر من يوم');
    expect(staleText(st(['data_old'], 4))).toEqual([]);
  });
  it('a missing CRM part is said honestly', () => { expect(staleText(st(['crm_missing']))[0]).toContain('غير مربوطة'); });
  it('a failed start is for the owner page only', () => {
    expect(staleText(st(['dispatch_failed']))).toEqual([]);
    expect(ownerText(st(['dispatch_failed'])).length).toBe(1);
    expect(ownerText(st(['data_old'], 4))[0]).toContain('كل ساعة');
  });
  it('the words shown to normal users carry no technical term', () => {
    const all = staleText(st(['no_data', 'data_very_old', 'crm_missing', 'crm_old']));
    for (const t of all) expect(TECH_WORDS.test(t)).toBe(false);
  });
});
