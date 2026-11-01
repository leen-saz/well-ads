const fs = require('fs');
const puppeteer = require('/tmp/pw/node_modules/puppeteer-core');

const [mainUrl, monthUrl, shotDir] = process.argv.slice(2);
const fails = [];

function num(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  const m = text.match(/^-?[\d,]+(?:\.\d+)?%?|^—/);
  return m ? m[0] : text;
}
function check(cond, msg, extra) {
  if (!cond) fails.push(msg + (extra ? ' :: ' + String(extra).replace(/\s+/g, ' ').slice(0, 400) : ''));
}

async function ready(page) {
  await page.waitForFunction(() => {
    const v = document.querySelector('#kpis .kpi .v');
    const line = document.querySelector('#metaLine');
    return v && v.textContent.trim() && line && !line.textContent.includes('جاري التحميل');
  });
  await new Promise(r => setTimeout(r, 400));
}
async function kpi(page, label) {
  return page.evaluate(label => {
    const el = [...document.querySelectorAll('#kpis .kpi')].find(k => k.querySelector('.l').textContent.trim() === label);
    if (!el) return null;
    return {
      raw: el.querySelector('.v').textContent.replace(/\s+/g, ' ').trim(),
      delta: (el.querySelector('.delta') ? el.querySelector('.delta').textContent : '').replace(/\s+/g, ' ').trim(),
    };
  }, label);
}
async function expectKpi(page, label, value, note) {
  const got = await kpi(page, label);
  check(got && num(got.raw) === value, (note || label) + ' expected ' + value, got && got.raw);
  return got;
}
async function setRange(page, from, to) {
  await page.evaluate((from, to) => {
    const f = document.querySelector('#from');
    const t = document.querySelector('#to');
    f.value = from;
    t.value = to;
    t.dispatchEvent(new Event('input', {bubbles: true}));
    t.dispatchEvent(new Event('change', {bubbles: true}));
  }, from, to);
  await page.waitForFunction((from, to) => document.querySelector('#from').value === from && document.querySelector('#to').value === to, {}, from, to);
}
async function click(page, sel) {
  await page.waitForSelector(sel);
  await page.click(sel);
}
async function dates(page) {
  return page.evaluate(() => ({from: document.querySelector('#from').value, to: document.querySelector('#to').value}));
}
async function text(page, sel) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }, sel);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.error('PAGE', err.message));
    page.on('console', msg => { if (msg.type() === 'error') console.error('CONSOLE', msg.text()); });
    await page.setViewport({width: 1280, height: 900});
    await page.evaluateOnNewDocument(() => localStorage.clear());
    await page.goto(mainUrl, {waitUntil: 'load'});
    await ready(page);

    let d = await dates(page);
    check(d.from === '2026-10-10' && d.to === '2026-10-16', '7-day preset must end on the last full day', JSON.stringify(d));
    await expectKpi(page, 'الصرف', '185', '7-day spend excludes partial today');
    await expectKpi(page, 'الليدز', '21.50', '7-day leads');

    await click(page, '#presets button[data-k="t"]');
    await ready(page);
    d = await dates(page);
    check(d.from === '2026-10-17' && d.to === '2026-10-17', 'today preset', JSON.stringify(d));
    const todaySpend = await expectKpi(page, 'الصرف', '8.00', 'today spend is the partial snap row');
    check(todaySpend && !todaySpend.delta.includes('عن الفترة السابقة') && !todaySpend.delta.includes('▼'), 'today delta suppressed while TikTok is missing', todaySpend && todaySpend.delta);
    const todayLabel = await text(page, '#rangeLabel');
    check(todayLabel.includes('بيانات ناقصة') && todayLabel.includes('تيك توك'), 'today says TikTok is missing', todayLabel);
    await page.evaluate(() => {
      const hit = document.querySelector('#chSpend .hit');
      const r = hit.getBoundingClientRect();
      hit.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: r.left + 4, clientY: r.top + 4}));
    });
    const todayTip = await text(page, '#chSpend .tip');
    check(/تيك توك\s*—/.test(todayTip) && todayTip.includes('ناقص'), 'today chart does not draw TikTok as zero', todayTip);
    if (shotDir) await page.screenshot({path: shotDir + '/today-missing-tiktok.png', fullPage: false});

    await click(page, '#presets button[data-k="y"]');
    await ready(page);
    d = await dates(page);
    check(d.from === '2026-10-16' && d.to === '2026-10-16', 'yesterday preset', JSON.stringify(d));
    await expectKpi(page, 'الصرف', '150', 'yesterday excludes today and the 15th');
    await expectKpi(page, 'الليدز', '14.50', 'yesterday leads keep the half lead');
    await expectKpi(page, 'تكلفة الليد', '11.11', 'yesterday CPL uses lead-goal leads only');
    const yLeads = await kpi(page, 'الليدز');
    check(yLeads && yLeads.delta.includes('383.3%'), 'yesterday compares with Oct 15 only', yLeads && yLeads.delta);

    await setRange(page, '2026-10-15', '2026-10-16');
    const label = await text(page, '#rangeLabel');
    check(label.includes('13 أكتوبر') && label.includes('14 أكتوبر'), 'previous period is the two days before, inclusive', label);
    check(!label.includes('بيانات ناقصة'), 'Oct 15–16 is inside TikTok coverage', label);
    await expectKpi(page, 'الصرف', '165', 'range spend keeps hidden-platform spend');
    await expectKpi(page, 'الليدز', '17.50', 'range leads');
    await expectKpi(page, 'تكلفة الليد', '8.67', 'CPL is lead spend over lead-goal leads');
    await expectKpi(page, 'محادثات واتساب وماسنجر', '3', 'conversations');
    await expectKpi(page, 'الظهور', '390', 'impressions');
    await expectKpi(page, 'نقرات الرابط والسوايب', '32', 'clicks');
    await expectKpi(page, 'نسبة النقر', '8.21%', 'CTR is sum of clicks over sum of impressions');
    const leads = await kpi(page, 'الليدز');
    check(leads && leads.delta.includes('337.5%'), 'lead delta versus Oct 13–14', leads && leads.delta);
    const spend = await kpi(page, 'الصرف');
    check(spend && spend.delta.includes('725.0%'), 'spend delta versus the previous 20', spend && spend.delta);
    const month = await text(page, '#tMonth');
    check(month.includes('165') && month.includes('17.50') && month.includes('8.67') && !month.includes('185'), 'month table follows the selected days', month);
    const pace = await text(page, '#pace');
    check(pace.includes('2 من 31') && pace.includes('2,558') && pace.includes('20.50'), 'pace uses the selected days inside the month', pace);
    check(pace.includes('— ليد أو محادثة'), 'previous month before the data start is missing, not zero', pace);
    const tree = await text(page, '#tTree');
    check(tree.includes('8.67') && !tree.includes('3.71'), 'drill-down CPL uses lead-goal leads', tree);
    const plat = await text(page, '#tPlat');
    check(!plat.includes('شبكة الجمهور') && !plat.includes('HIDDENAN'), 'hidden placement stays out of the platform table', plat);
    check(plat.includes('سناب شات') && plat.includes('تيك توك') && plat.includes('0.50'), 'platforms and the half lead are listed', plat);
    await page.evaluate(() => {
      const hit = document.querySelector('#chSpend .hit[data-i="1"]');
      const r = hit.getBoundingClientRect();
      hit.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: r.left + 4, clientY: r.top + 4}));
    });
    const tip = await text(page, '#chSpend .tip');
    check(/تيك توك\s*0\.00/.test(tip) && !tip.includes('ناقص'), 'covered day with no TikTok spend is zero', tip);
    if (shotDir) await page.screenshot({path: shotDir + '/range-oct-15-16.png', fullPage: true});

    await click(page, '#plats button[data-v="google"]');
    await expectKpi(page, 'الصرف', '4.00', 'google filter');
    await expectKpi(page, 'الليدز', '0.50', 'fractional google leads');
    await expectKpi(page, 'تكلفة الليد', '8.00', 'google CPL');
    const cpl = await text(page, '#chCpl');
    check(!cpl.includes('ما فيه ليدز') && cpl.includes('8.00'), 'half a lead still draws the CPL line', cpl);
    await click(page, '#plats button[data-v="all"]');

    await click(page, '#stat button[data-v="off"]');
    await expectKpi(page, 'الصرف', '4.00', 'paused filter keeps only the paused ad');
    await expectKpi(page, 'الليدز', '0.50', 'paused leads');
    await click(page, '#stat button[data-v="all"]');

    await page.select('#fGoal', 'messages');
    await expectKpi(page, 'الصرف', '100', 'messages objective');
    await expectKpi(page, 'الليدز', '10', 'message leads still count as leads');
    await expectKpi(page, 'تكلفة الليد', '—', 'message leads do not dilute CPL');
    await expectKpi(page, 'محادثات واتساب وماسنجر', '2', 'message conversations');
    await page.select('#fGoal', '');

    await page.select('#fCamp', 'facebook|IV Camp');
    await expectKpi(page, 'الصرف', '40.00', 'campaign filter');
    await expectKpi(page, 'تكلفة الليد', '13.33', 'campaign CPL');
    await page.select('#fCamp', '');

    await click(page, '#depts button[data-v="iv"]');
    await setRange(page, '2026-10-15', '2026-10-15');
    await expectKpi(page, 'الصرف', '15.00', 'department and one day');
    await expectKpi(page, 'الليدز', '3', 'department leads');
    const card = await page.evaluate(() => {
      const el = [...document.querySelectorAll('#deptCards button')].find(b => b.textContent.includes('المحاليل'));
      return el ? el.textContent.replace(/\s+/g, ' ') : '';
    });
    check(card.includes('15 أكتوبر') && !card.includes('16 أكتوبر') && !card.includes('17 أكتوبر'), 'last spend stays inside the range', card);
    await click(page, '#depts button[data-v=""]');
    await setRange(page, '2026-10-15', '2026-10-16');

    await click(page, '#presets button[data-k="m"]');
    d = await dates(page);
    check(d.from === '2026-10-01' && d.to === '2026-10-16', 'this month ends on the last full day', JSON.stringify(d));
    await expectKpi(page, 'الصرف', '185', 'this month excludes partial today');

    await click(page, '#presets button[data-k="90"]');
    d = await dates(page);
    check(d.from === '2026-10-01' && d.to === '2026-10-17', 'all-period includes partial today', JSON.stringify(d));
    await expectKpi(page, 'الصرف', '193', 'all-period spend');
    const allLabel = await text(page, '#rangeLabel');
    check(allLabel.includes('بيانات ناقصة'), 'all-period past TikTok coverage is marked missing', allLabel);

    await setRange(page, '2026-10-15', '2026-10-16');
    await click(page, '#mode button[data-v="organic"]');
    await page.waitForFunction(() => document.querySelector('#acctPage h2'));
    const body = await text(page, '#acctPage');
    check(!body.includes('999') && !body.includes('111') && !body.includes('91'), 'Instagram window total is not reused for another range', body);
    const fb = await page.evaluate(() => {
      const h = [...document.querySelectorAll('#acctPage h2')].find(el => el.textContent.includes('Well Care.'));
      const sec = h.closest('section');
      return Object.fromEntries([...sec.querySelectorAll('.kpi')].map(k => [k.querySelector('.l').textContent.trim(), k.querySelector('.v').textContent.replace(/\s+/g, ' ').trim()]));
    });
    check(num(fb['المتابعون الآن']) === '42,421', 'followers stay the current snapshot', fb['المتابعون الآن']);
    check(num(fb['المشاهدات في الفترة']) === '30', 'facebook views sum the selected days', fb['المشاهدات في الفترة']);
    check(num(fb['الوصول في الفترة']) === '—', 'facebook reach is not summed across days', fb['الوصول في الفترة']);
    check(num(fb['التفاعل في الفترة']) === '7', 'facebook engagement sums', fb['التفاعل في الفترة']);
    check(num(fb['المنشورات في الفترة']) === '2', 'undated and out-of-range posts are excluded', fb['المنشورات في الفترة']);
    const ga = await page.evaluate(() => {
      const h = [...document.querySelectorAll('#acctPage h2')].find(el => el.textContent.includes('GA4'));
      return h ? h.closest('section').textContent.replace(/\s+/g, ' ') : '';
    });
    check(ga.includes('13') && ga.includes('140') && ga.includes('تقسيم القنوات غير متاح') && !ga.includes('4,242'), 'GA sessions and views follow the days; channel mix does not', ga);
    check(/المستخدمون\s*—/.test(ga), 'GA users are not summed across days', ga);
    const posts = await text(page, '#ocards');
    check(posts.includes('POST IN RANGE') && posts.includes('20.00%'), 'engagement rate uses reach', posts);
    check(posts.includes('POST FOOT') && !posts.includes('UNDATED') && !posts.includes('POST OUT'), 'post list follows the date', posts);
    check(!posts.includes('10.00%'), 'missing reach does not become an engagement rate', posts);
    if (shotDir) await page.screenshot({path: shotDir + '/organic-range.png', fullPage: true});

    await click(page, '#depts button[data-v="iv"]');
    const postsIv = await text(page, '#orgCount');
    check(postsIv.includes('1'), 'post count follows the department', postsIv);
    const fbIv = await page.evaluate(() => {
      const h = [...document.querySelectorAll('#acctPage h2')].find(el => el.textContent.includes('Well Care.'));
      const sec = h.closest('section');
      const k = [...sec.querySelectorAll('.kpi')].find(el => el.querySelector('.l').textContent.includes('المنشورات'));
      return k.querySelector('.v').textContent.trim();
    });
    check(fbIv === '1', 'account post count follows the department', fbIv);

    await setRange(page, '2026-10-16', '2026-10-16');
    await click(page, '#depts button[data-v=""]');
    const one = await page.evaluate(() => {
      const h = [...document.querySelectorAll('#acctPage h2')].find(el => el.textContent.includes('Well Care.'));
      const sec = h.closest('section');
      return Object.fromEntries([...sec.querySelectorAll('.kpi')].map(k => [k.querySelector('.l').textContent.trim(), k.querySelector('.v').textContent.replace(/\s+/g, ' ').trim()]));
    });
    check(num(one['الوصول في الفترة']) === '7', 'one day shows that day’s reach', one['الوصول في الفترة']);
    check(num(one['المشاهدات في الفترة']) === '20', 'one day views', one['المشاهدات في الفترة']);
    const users = await page.evaluate(() => {
      const h = [...document.querySelectorAll('#acctPage h2')].find(el => el.textContent.includes('GA4'));
      const sec = h.closest('section');
      const k = [...sec.querySelectorAll('.kpi')].find(el => el.querySelector('.l').textContent.trim() === 'المستخدمون');
      return k.querySelector('.v').textContent.trim();
    });
    check(users === '9', 'one day shows that day’s users', users);

    await setRange(page, '2026-10-01', '2026-10-16');
    const ig = await page.evaluate(() => {
      const h = [...document.querySelectorAll('#acctPage h2')].find(el => el.textContent.includes('@wellcare.sa'));
      const sec = h.closest('section');
      return Object.fromEntries([...sec.querySelectorAll('.kpi')].map(k => [k.querySelector('.l').textContent.trim(), k.querySelector('.v').textContent.replace(/\s+/g, ' ').trim()]));
    });
    check(num(ig['المشاهدات في الفترة']) === '999', 'exact window uses the returned Instagram total', ig['المشاهدات في الفترة']);
    check(num(ig['الوصول في الفترة']) === '111', 'exact window reach', ig['الوصول في الفترة']);
    check(num(ig['التفاعل في الفترة']) === '91', 'exact window engagement', ig['التفاعل في الفترة']);
    const gaWindow = await page.evaluate(() => {
      const h = [...document.querySelectorAll('#acctPage h2')].find(el => el.textContent.includes('GA4'));
      return h.closest('section').textContent.replace(/\s+/g, ' ');
    });
    check(gaWindow.includes('4,242') && gaWindow.includes('Organic Search'), 'channel mix shows only for its own window', gaWindow);
    const fbWide = await page.evaluate(() => {
      const h = [...document.querySelectorAll('#acctPage h2')].find(el => el.textContent.includes('Well Care.'));
      const sec = h.closest('section');
      const k = [...sec.querySelectorAll('.kpi')].find(el => el.querySelector('.l').textContent.includes('المشاهدات'));
      return k.querySelector('.v').textContent.trim();
    });
    check(fbWide === '—', 'views stay missing when a day in the range has no row', fbWide);

    const monthPage = await browser.newPage();
    await monthPage.setViewport({width: 1280, height: 800});
    await monthPage.evaluateOnNewDocument(() => localStorage.clear());
    await monthPage.goto(monthUrl, {waitUntil: 'load'});
    await ready(monthPage);
    await click(monthPage, '#presets button[data-k="m"]');
    d = await dates(monthPage);
    check(d.from === '2026-11-01' && d.to === '2026-11-01', 'on the 1st, this month is that day', JSON.stringify(d));
    await expectKpi(monthPage, 'الصرف', '3.00', 'this month on the 1st');
    await click(monthPage, '#presets button[data-k="pm"]');
    d = await dates(monthPage);
    check(d.from === '2026-10-01' && d.to === '2026-10-31', 'last month on the 1st is the previous month', JSON.stringify(d));
    await expectKpi(monthPage, 'الصرف', '40.00', 'last month spend');
    if (shotDir) await monthPage.screenshot({path: shotDir + '/last-month-on-the-first.png', fullPage: false});
  } finally {
    await browser.close();
  }
  if (fails.length) {
    console.error(fails.map((f, i) => (i + 1) + '. ' + f).join('\n'));
    process.exit(1);
  }
  console.log('fixture ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
