import { describe, expect, it } from 'vitest';
import { arabicOr, friendly, safeSrc, safeUrl } from '../../public/assets/safe.js';

describe('friendly: browser errors never reach the user', () => {
  it('replaces the usual browser messages with one Arabic sentence', () => {
    for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed', 'Unexpected token < in JSON at position 0',
      'Failed to fetch dynamically imported module: /x.js', 'The play() request was interrupted by a call to pause()', 'undefined', 'TypeError: x is not a function']) {
      expect(friendly(m)).toBe('صار خطأ، جرّب مرة ثانية');
      expect(friendly(new Error(m), 'غيره')).toBe('غيره');
    }
  });
  it('keeps a sentence of ours', () => {
    expect(friendly('ما قدرت أوصل للخادم. تأكد من الاتصال')).toBe('ما قدرت أوصل للخادم. تأكد من الاتصال');
    expect(friendly(new Error('الملف أكبر من 95 ميقا'))).toBe('الملف أكبر من 95 ميقا');
    expect(friendly('')).toBe('');
    expect(friendly(null)).toBe('');
  });
  it('an Arabic message that mentions a technical word still passes (it is ours)', () => {
    expect(friendly('ما انفتح، TypeError في الصفحة')).toContain('ما انفتح');
  });
});

describe('arabicOr: a stored error is shown only when it is Arabic', () => {
  it('uses the fallback for English or empty reasons', () => {
    expect(arabicOr('HTTP 500 Internal Server Error', 'فشل')).toBe('فشل');
    expect(arabicOr('', 'فشل')).toBe('فشل');
    expect(arabicOr(undefined, 'فشل')).toBe('فشل');
    expect(arabicOr('أوقفته', 'فشل')).toBe('أوقفته');
  });
});

describe('safeUrl / safeSrc: only plain web links are shown', () => {
  it('accepts http and https', () => {
    expect(safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeUrl(' http://example.com ')).toBe('http://example.com/');
  });
  it('refuses script, data, file and relative values', () => {
    for (const u of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html;base64,AAAA', 'vbscript:x', 'file:///etc/passwd', '/relative', '//evil.test', '', null, undefined, 42]) {
      expect(safeUrl(u as string)).toBe('');
    }
  });
  it('a picture may also be a path on this site, never a protocol-relative address', () => {
    expect(safeSrc('/m/cover.jpg')).toBe('/m/cover.jpg');
    expect(safeSrc('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(safeSrc('//evil.test/a.png')).toBe('');
    expect(safeSrc('javascript:alert(1)')).toBe('');
  });
});
