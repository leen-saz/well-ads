// The live text of the copywriter is a draft: what gets copied is the reviewed variant, never the live box.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import client from '../../public/modules/copy/client.js?raw';
import page from '../../src/modules/copy/Page.astro?raw';


describe('copywriter live box', () => {
  it('is labelled as a draft that is checked when it ends, and the label is shown only while it writes', () => {
    expect(page).toContain('مسودة، تنفحص لما تخلص');
    expect(client).toMatch(/\$\('#liveTag'\)\.hidden = false/);
    expect(client).toMatch(/finally \{[^}]*\$\('#liveTag'\)\.hidden = true/);
  });
  it('copies the text of the reviewed variant (from the result event), and nothing reads the live box back', () => {
    expect(client).toContain('writeText(r.variants[x.dataset.copy].text)');
    expect(client).not.toMatch(/writeText\([^)]*live/);
    // the live box is only ever written to
    expect(client.replace(/live\.textContent = /g, '')).not.toContain('live.textContent');
  });
});
