// حكم التسويق على رحلة العميل: كل خطوة مقابل هدف ثابت (افتراضي — عدّله، من pipeline/config/targets.json «funnel»)، مو مقابل
// نفسها. جدول قواعد واحد للوحة الرئيسية ولملخص الأداء (src/modules/overview/judge.ts يستورد هذا الملف نفسه)، والاختبار في
// src/modules/overview/judge.test.ts. ما فيه أي رقم يطلع من الصفحة. كل نص بالعربي والإنجليزي.
// The marketing judge: every step against an absolute target. One rules table for both funnels; plain script so the main
// page can inline it and Overview can import it (it sets globalThis.WELL_JUDGE).
const JUDGE = (function(){
  // Defaults, editable per viewer and in targets.json. Rates in %; cpl in SAR; costShare = the most a closing may cost as a
  // share of what it brings (0.33 = a third); roas in ×; maturityDays = how old a lead must be before its cohort counts.
  const DEFAULTS = { ctr:1, clickToLead:8, leadToClose:8, cpl:60, costShare:0.33, roas:3, maturityDays:30 };
  // The editable benchmark table, in this order
  const FIELDS = [
    {key:'ctr', unit:'%', label:['نسبة النقر','Click rate']},
    {key:'clickToLead', unit:'%', label:['من نقرة إلى ليد','Click to lead']},
    {key:'leadToClose', unit:'%', label:['من ليد إلى إقفالة','Lead to closing']},
    {key:'cpl', unit:'sar', label:['تكلفة الليد','Cost per lead']},
    {key:'costShare', unit:'share', label:['أقصى تكلفة للإقفالة من قيمتها','Most a closing may cost, of its value']},
    {key:'roas', unit:'x', label:['العائد على الصرف','Return on spend']},
    {key:'maturityDays', unit:'days', label:['عمر الليد قبل ما ينحكم عليه','Lead age before it is judged']},
  ];
  // Too few to judge firmly: under this, a step is at most «انتبه» and says «العينة صغيرة»
  const MIN = { clicks:200, leads:30 };
  // How far under target, as actual ÷ target (target ÷ actual for a cost): the first band whose min it reaches
  const BANDS = [ {min:1, sev:'fine'}, {min:0.8, sev:'watch'}, {min:0.5, sev:'problem'}, {min:0, sev:'disaster'} ];
  const RANK = { disaster:0, problem:1, watch:2, fine:3, na:4 };
  const SEV = { fine:['تمام','Fine'], watch:['انتبه','Watch'], problem:['مشكلة','Problem'], disaster:['كارثة','Disaster'], na:['ما ينحكم','Cannot judge'] };
  const BAND_RULE = { fine:['على الهدف أو أحسن','at or better than target'], watch:['تحت الهدف بأقل من 20%','under target by less than 20%'],
    problem:['تحت الهدف بـ 20% إلى 50%','20% to 50% under target'], disaster:['أقل من نص الهدف','less than half the target'] };
  // Coverage: the share of the ads' leads found in the CRM tied to their ad
  const COVER = { high:0.7, medium:0.3 };
  // Who owns each step; one table, edited in one place
  const OWNERS = {
    creative:{who:['الإنتاج / الكريتيف','Production / creative'], fix:['جدّد الافتتاحية والمادة والنص.','Refresh the hook, the creative and the copy.']},
    landing:{who:['الإنتاج + صفحة الهبوط / النموذج','Production + landing page / form'], fix:['راجع العرض وطول النموذج وسرعة الصفحة، ومع المشتري الإعلامي إذا الزوار مو الجمهور الصح.','Review the offer, the form length and the page speed; with the media buyer if the traffic is the wrong audience.']},
    sales:{who:['المبيعات','Sales'], fix:['سرّع الرد على الليد وتابع اللي ما ردوا.','Answer leads faster and follow up on the ones who did not reply.']},
    buyer:{who:['المشتري الإعلامي','Media buyer'], fix:['وسّع الجمهور أو غيّره، وبدّل المواد اللي طوّلت.','Widen or change the audience and replace long-running creatives.']},
    mgmt:{who:['التسويق / الإدارة','Marketing / management'], fix:['راجع العرض والتسعير وتوزيع الميزانية بين الأقسام.','Review the offer, the pricing and how the budget is split across departments.']},
    crm:{who:['نظام العملاء / العمليات','CRM / operations'], fix:['تأكد إن كل ليد ودفعة توصل ومعها رقم الإعلان.','Make sure every lead and payment arrives with its ad id.']},
  };
  // The rules table. kind: rate (higher is better, %), cost (lower is better, SAR), ratio (higher is better, ×).
  // link: where it sits on the band: the link index for a rate, the stage index for a cost or ratio.
  // sample: what must be big enough (clicks or leads). scope: top = the filtered ads; sale = the CRM side.
  const RULES = [
    {key:'click', kind:'rate', link:0, owner:'creative', target:'ctr', sample:'clicks', scope:'top', label:['نسبة النقر','Click rate'],
      advice:{t:['الإعلان ما يجيب نقرات كفاية','The ads get too few clicks'], w:['الإعلان ما يشد: الصورة أو أول سطر ما يوقف اللي يمرر.','The ad does not stop the scroll: the image or the first line.'], d:['جرّب مادة جديدة، وغيّر أول سطر والعنوان، وابدأ بالفايدة أو بسؤال يلمس المشكلة.','Try a new creative and a new first line and headline; lead with the benefit or a question about the problem.']}},
    {key:'lead', kind:'rate', link:1, owner:'landing', target:'clickToLead', sample:'clicks', scope:'top', label:['من نقرة إلى ليد أو محادثة','Click to lead or chat'],
      advice:{t:['النقرات ما تصير ليدز','Clicks are not becoming leads'], w:['الناس تضغط بس ما تكمل: النموذج طويل، أو الصفحة بطيئة، أو دخول الواتساب فيه خطوة زايدة.','People click but do not finish: a long form, a slow page, or an extra step into WhatsApp.'], d:['قصّر النموذج، وشيك على سرعة الصفحة من الجوال، وجرّب رسالة الواتساب الجاهزة بنفسك.','Shorten the form, check the page speed on a phone, and try the WhatsApp entry yourself.']}},
    {key:'sale', kind:'rate', link:2, owner:'sales', target:'leadToClose', sample:'leads', scope:'sale', label:['من ليد إلى إقفالة','Lead to closing'],
      advice:{t:['الليدز ما تصير إقفالات','Leads are not closing'], w:['المتابعة متأخرة، أو جودة الليدز نازلة.','Follow-up is slow, or lead quality dropped.'], d:['شيك كم ياخذ الفريق عشان يرد على الليد، وتابع اللي ما ردوا، وراجع أسئلة النموذج عشان تفلتر الجادين.','Check how long the team takes to answer a lead, follow up on the silent ones, and tighten the form questions.']}},
    {key:'cpl', kind:'cost', link:2, owner:'buyer', target:'cpl', sample:'leads', scope:'top', label:['تكلفة الليد','Cost per lead'],
      advice:{t:['الليد غالي','Leads cost too much'], w:['الجمهور تشبّع، أو المواد تعبت من كثر ما انعرضت.','The audience is saturated, or the creatives are worn out.'], d:['وسّع الجمهور أو غيّره، وبدّل المواد اللي صار لها فترة طويلة تنعرض.','Widen or change the audience, and replace creatives that have run for a long time.']}},
    {key:'cpa', kind:'cost', link:3, owner:'buyer', target:'cpa', sample:'leads', scope:'sale', label:['تكلفة الإقفالة','Cost per closing'],
      advice:{t:['الإقفالة تكلف أكثر من اللي تستاهله','A closing costs more than it is worth'], w:['الصرف على كل إقفالة أعلى من حصتها من قيمة الإقفالة.','The spend per closing is above its share of what a closing brings.'], d:['وقّف أو قلّل الصرف على اللي ما تجيب إقفالات، وحطه على اللي تجيب.','Cut spend that brings no closings and move it to what does.']}},
    {key:'roas', kind:'ratio', link:3, owner:'mgmt', target:'roas', sample:'leads', scope:'sale', label:['العائد على الصرف','Return on spend'],
      advice:{t:['العائد أقل من الهدف','Return is under target'], w:['المدفوع من نظام العملاء ما يغطي الصرف بالقدر المطلوب.','What the CRM shows as paid does not cover the spend by the target multiple.'], d:['راجع العرض والتسعير وتوزيع الميزانية بين الأقسام.','Review the offer, the pricing and how the budget is split across departments.']}},
  ];

  const pick = (l, x) => (l === 'en' ? x[1] : x[0]);
  const fin = v => typeof v === 'number' && isFinite(v);
  // A hair of tolerance so 1.2 ÷ 1.5 (0.7999…) lands on the 0.8 line it means
  const band = r => BANDS.find(b => r >= b.min - 1e-9).sev;
  const day = s => Date.UTC(+s.slice(0,4), +s.slice(5,7)-1, +s.slice(8,10));
  const addDays = (s, n) => new Date(day(s) + n*864e5).toISOString().slice(0,10);
  const median = xs => { if(!xs.length) return null; const s=[...xs].sort((a,b)=>a-b), m=s.length>>1; return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };

  // Targets: the defaults, then targets.json, then the viewer's own edits; anything not a positive number is ignored
  function targets(...layers){
    const out = { ...DEFAULTS };
    // costPerPayer (SAR) is optional: left out, the most a paying customer may cost comes from costShare × what a closing brings
    for(const t of layers) if(t && typeof t === 'object') { const c = Number(t.costPerPayer); if(t.costPerPayer != null && t.costPerPayer !== '' && isFinite(c) && c > 0) out.costPerPayer = c; }
    for(const t of layers) if(t && typeof t === 'object') for(const k of Object.keys(DEFAULTS)) { const v = Number(t[k]); if(t[k] != null && t[k] !== '' && isFinite(v) && v > 0) out[k] = v; }
    return out;
  }

  // Leads by the day they came in: the ones old enough to have closed (older than maturityDays at asOf) and the rest.
  // byDay: [[day, results]] of the ads; paid: [[leadDay, paidDay]] of every paid closing in the CRM.
  function cohort(byDay, paid, from, to, asOf, maturityDays){
    const cut = addDays(asOf, -maturityDays), last = cut < to ? cut : to;
    let mature = 0, young = 0, matureClosings = 0; const waits = [];
    for(const [d, n] of byDay) if(d >= from && d <= to) { if(d <= cut) mature += n; else young += n; }
    for(const [ld, pd] of paid){
      if(!ld || ld < from || ld > to) continue;
      if(ld <= last) matureClosings++;
      if(pd && pd >= ld) waits.push((day(pd) - day(ld)) / 864e5);
    }
    return { mature, young, matureClosings, medianDays: median(waits), cut };
  }

  // in: { top: {impr, clicks, results, spend, cpl}, sale: {crm, results, spend, closings, paid, adClosings, adLeads, wide},
  //       cohort: cohort() | null }. sale.wide: the CRM side covers more than the filtered ads (a platform filter).
  // f: { pct(v), sar(v), x(v), qty(v) } in the page's own formats.
  function judge(inp, T, l, f){
    const t = (ar, en) => (l === 'en' ? en : ar);
    const top = inp.top || {}, sale = inp.sale || {}, co = inp.cohort || null;
    const avg = sale.closings ? sale.paid / sale.closings : null;
    const tgt = { ...T, cpa: T.costPerPayer > 0 ? T.costPerPayer : avg != null ? avg * T.costShare : null };
    const coverage = sale.crm && sale.results ? Math.min(1, (sale.adLeads || 0) / sale.results) : null;
    const allRate = sale.crm && sale.results ? 100 * (sale.closings || 0) / sale.results : null;
    // Lead to closing on the leads old enough to have closed, when there are enough of them; else the whole period, said so
    const matureOk = co && co.mature >= MIN.leads;
    const early = !!(co && !matureOk && co.young > 0);
    const lc = fin(top.leadClicks) ? top.leadClicks : top.clicks;
    const now = {
      click: top.impr ? 100 * top.clicks / top.impr : null,
      lead: lc ? 100 * top.results / lc : null,
      sale: !sale.crm ? null : matureOk ? 100 * co.matureClosings / co.mature : allRate,
      cpl: fin(top.cpl) ? top.cpl : top.results ? top.spend / top.results : null,
      cpa: sale.crm && sale.closings ? sale.spend / sale.closings : null,
      roas: sale.crm && sale.spend ? (sale.paid || 0) / sale.spend : null,
    };
    // TikTok ads that open WhatsApp never report leads on the platform: they leave the click-to-lead and cost-per-lead math
    const waSpend = top.waSpend || 0, waOnly = waSpend > 0 && !(top.leadClicks > 0) && !(top.results > 0);
    const WA_NOTE = t('توجيه للواتساب، الليدز ما تنقاس من المنصة', 'Sent to WhatsApp, leads are not measured by the platform');
    const size = { clicks: top.clicks || 0, leadClicks: lc || 0, leads: (r) => (r.scope === 'sale' ? sale.results : top.results) || 0 };
    const fmtOf = r => (r.kind === 'rate' ? f.pct : r.kind === 'cost' ? f.sar : f.x);
    const rLead = fin(now.lead) ? now.lead : T.clickToLead, rSale = fin(now.sale) ? now.sale : T.leadToClose;

    // Without a CRM only the sale link shows (as not linked); the closing cost and the return have nothing to stand on
    const steps = RULES.filter(r => sale.crm || r.key === 'sale' || r.scope === 'top').map(r => {
      const v = now[r.key], target = tgt[r.target], fm = fmtOf(r), label = pick(l, r.label), owner = OWNERS[r.owner];
      const base = { key:r.key, kind:r.kind, link:r.link, label, now:v, target, ownerKey:r.owner, owner:pick(l, owner.who), fix:pick(l, owner.fix), unattributed:false };
      if(r.scope === 'sale' && !sale.crm){
        const o = OWNERS.crm;
        return { ...base, level:'na', score:null, ratio:null, small:false, sar:null, confidence:'low', unattributed: r.key === 'sale', owner:pick(l, o.who), fix:pick(l, o.fix),
          line:`${label}: ${t('ما ينحكم، نظام العملاء مو موصول بهالأرقام.', 'cannot be judged, the CRM is not connected to these numbers.')}`, evidence:'', rule:'', change:'', range:null };
      }
      if(waOnly && (r.key === 'lead' || r.key === 'cpl')) return { ...base, level:'na', score:null, ratio:null, small:false, sar:null, confidence:'low', waDest:true,
        line:`${label}: ${WA_NOTE}.`, evidence:'', rule:'', change:'', range:null };
      if(!fin(v) || !fin(target)) return { ...base, level:'na', score:null, ratio:null, small:false, sar:null, confidence:'low',
        line:`${label}: ${t('ما فيه أرقام كفاية.', 'not enough numbers.')}`, evidence:'', rule:'', change:'', range:null };
      const ratio = r.kind === 'cost' ? (v > 0 ? target / v : Infinity) : v / target;
      const n = r.sample === 'clicks' ? (r.key === 'lead' ? size.leadClicks : size.clicks) : size.leads(r), need = MIN[r.sample], small = n < need;
      let level = band(ratio);
      if(small && RANK[level] < RANK.watch) level = 'watch';
      // SAR at stake: what the gap to target costs, in closings × what a closing brings, or in overspend for a cost
      let sar = null;
      if(level !== 'fine'){
        if(r.key === 'click' && avg != null) sar = (target - v) / 100 * top.impr * rLead / 100 * rSale / 100 * avg;
        else if(r.key === 'lead' && avg != null) sar = (target - v) / 100 * lc * rSale / 100 * avg;
        else if(r.key === 'sale' && avg != null) sar = (target - v) / 100 * sale.results * avg;
        else if(r.key === 'cpl') sar = (v - target) * (top.results || 0);
        else if(r.key === 'cpa') sar = (v - target) * (sale.closings || 0);
        if(sar != null && !(sar > 0)) sar = null;
      }
      // Trust: the CRM side by how many of the ads' leads it ties to an ad; any step by its sample and the leads' age
      let confidence = small ? 'low' : 'high';
      if(r.scope === 'sale') confidence = small || coverage == null || coverage < COVER.medium ? 'low' : coverage < COVER.high || early ? 'medium' : 'high';
      // The range when the CRM side is not fully tied: worst = only the closings tied to an ad, best = every paid closing
      const worst = sale.results ? 100 * (sale.adClosings || 0) / sale.results : null;
      const range = r.key === 'sale' && confidence !== 'high' && worst != null && allRate != null && allRate - worst > 0.005 ? { worst, best: allRate } : null;
      const evidence = `${fm(v)} ${t('مقابل هدف', 'vs a target of')} ${fm(target)}`;
      const rule = `${label}: ${pick(l, BAND_RULE[band(ratio)])}${small ? t(` · العينة صغيرة (أقل من ${need} ${r.sample === 'clicks' ? 'نقرة' : 'ليد'}) ← أعلى حكم «انتبه»`, ` · small sample (under ${need} ${r.sample}) → at most «Watch»`) : ''}`;
      // What would change this verdict: the next band up, then the target itself
      const i = BANDS.findIndex(b => b.sev === level), up = i > 0 ? BANDS[i-1] : null;
      const at = m => (r.kind === 'cost' ? target / m : target * m);
      let change = level === 'fine'
        ? t(`لو ${r.kind === 'cost' ? 'طلع فوق' : 'نزل تحت'} ${fm(target)} يصير «انتبه».`, `It becomes «Watch» if it goes ${r.kind === 'cost' ? 'above' : 'below'} ${fm(target)}.`)
        : up && up.sev !== 'fine'
          ? t(`لو وصل ${fm(at(up.min))} يصير «${SEV[up.sev][0]}»، ولو وصل ${fm(target)} يصير «تمام».`, `At ${fm(at(up.min))} it becomes «${SEV[up.sev][1]}»; at ${fm(target)} it is «Fine».`)
          : t(`لو وصل ${fm(target)} يصير «تمام».`, `At ${fm(target)} it is «Fine».`);
      if(small) change += t(` ومع ${need} ${r.sample === 'clicks' ? 'نقرة' : 'ليد'} على الأقل ينحكم بثقة.`, ` With at least ${need} ${r.sample} it can be judged firmly.`);
      if(r.scope === 'sale' && confidence !== 'high' && !small) change += t(' ولو انربطت الليدز بإعلاناتها في نظام العملاء يصير الحكم أدق.', ' Tying the leads to their ads in the CRM makes it firmer.');
      const extra = [];
      if(small) extra.push(t(`العينة صغيرة (${f.qty(n)})`, `small sample (${f.qty(n)})`));
      if(range) extra.push(t(`بين ${f.pct(range.worst)} و${f.pct(range.best)} حسب الربط`, `between ${f.pct(range.worst)} and ${f.pct(range.best)} depending on attribution`));
      if(r.key === 'sale' && matureOk) extra.push(t(`على الليدز الناضجة (أقدم من ${T.maturityDays} يوم)`, `on mature leads (older than ${T.maturityDays} days)`));
      if(r.key === 'sale' && early) extra.push(t('الليدز لسه بدري، الحكم مبدئي', 'the leads are still young, so this is provisional'));
      if(r.scope === 'sale' && sale.wide) extra.push(t('من كل نظام العملاء، مو بس هالمنصة', 'across the whole CRM, not this platform only'));
      if(sar != null) extra.push(t(`≈ ${f.sar(sar)} على المحك`, `≈ ${f.sar(sar)} at stake`));
      const line = `${label} ${evidence}: ${pick(l, SEV[level])}${extra.length ? t('، ', ', ') + extra.join(t('، ', ', ')) : ''}.`;
      return { ...base, level, ratio, score: Math.min(1, ratio), small, sar, confidence, line, evidence, rule, change, range };
    });

    // End to end: closings per 100,000 impressions against the product of the three rate targets. Only when both ends
    // are the same ads (no platform filter): the CRM can't split closings by platform.
    let e2e = null;
    if(sale.crm && !sale.wide && top.impr){
      const per = 1e5 * (sale.closings || 0) / top.impr, tg = 1e5 * (T.ctr / 100) * (T.clickToLead / 100) * (T.leadToClose / 100), lv = band(per / tg);
      e2e = { now: per, target: tg, level: lv,
        line: t(`من الظهور للإقفالة: كل 100 ألف ظهور ← ${f.num(per, 1)} إقفالة مقابل هدف ${f.num(tg, 1)}: ${SEV[lv][0]}.`, `Impression to closing: ${f.num(per, 1)} closings per 100,000 impressions vs a target of ${f.num(tg, 1)}: ${SEV[lv][1]}.`) };
    }

    // SAR at stake by department, largest first
    const by = {};
    for(const s of steps) if(s.sar != null) by[s.ownerKey] = (by[s.ownerKey] || 0) + s.sar;
    const losses = Object.entries(by).map(([k, v]) => ({ key:k, owner:pick(l, OWNERS[k].who), sar:v })).sort((a, b) => b.sar - a.sar);
    const biggest = losses.length ? t(`أكبر خسارة: ${losses[0].owner} ≈ ${f.sar(losses[0].sar)}`, `Biggest loss: ${losses[0].owner} ≈ ${f.sar(losses[0].sar)}`) : null;

    const trust = sale.crm
      ? { coverage, confidence: steps.find(s => s.key === 'sale').confidence,
          line: coverage == null ? t('ما فيه ليدز في الفترة.', 'No leads in the period.')
            : t(`الربط بالإعلانات: ${f.pct(100 * coverage)} من الليدز موجودة في نظام العملاء ومربوطة بإعلانها ← ثقة ${({high:'عالية',medium:'متوسطة',low:'منخفضة'})[steps.find(s => s.key === 'sale').confidence]}.`,
                `Attribution: ${f.pct(100 * coverage)} of the leads are in the CRM tied to their ad → ${steps.find(s => s.key === 'sale').confidence} confidence.`) }
      : { coverage:null, confidence:'low', line: t('نظام العملاء مو موصول، فما فيه حكم على البيع.', 'The CRM is not connected, so the sale side is not judged.') };
    const coh = co ? { ...co, line: t(`ليدز ناضجة (أقدم من ${T.maturityDays} يوم): ${f.qty(co.mature)} · ليدز لسه بدري: ${f.qty(co.young)}${co.medianDays != null ? ` · وسيط أيام الإقفال: ${f.num(co.medianDays, 0)} يوم` : ''}`,
      `Mature leads (older than ${T.maturityDays} days): ${f.qty(co.mature)} · still young: ${f.qty(co.young)}${co.medianDays != null ? ` · median days to close: ${f.num(co.medianDays, 0)}` : ''}`) } : null;

    // The unlinked note: the sale side is still judged (CRM-wide); only the per-ad split is «غير مربوط»
    const unlinked = sale.crm && sale.results >= 10 && ((coverage != null && coverage < COVER.medium) || ((sale.closings || 0) > 0 && !(sale.adClosings > 0)))
      ? { owner: pick(l, OWNERS.crm.who),
          why: t('البيع محكوم عليه من كل نظام العملاء، بس أغلب الإقفالات ما توصل مربوطة بإعلاناتها، فما نقدر نقول أي إعلان أو منصة جابها.', 'Sales are judged on the whole CRM, but most closings arrive without their ads, so we cannot say which ad or platform brought them.'),
          todo: t('شيك على ربط نظام العملاء من صفحة الربط، وتأكد إن كل ليد يوصل ومعه رقم الإعلان.', 'Check the CRM link on the Connectors page and make sure every lead arrives with its ad id.') }
      : !sale.crm ? { owner: pick(l, OWNERS.crm.who), why: t('نظام العملاء مو موصول بهالأرقام، فما نعرف كم ليد صار إقفالة.', 'The CRM is not connected to these numbers, so we cannot tell how many leads closed.'),
          todo: t('شيك على ربط نظام العملاء من صفحة الربط.', 'Check the CRM link on the Connectors page.') } : null;

    // The verdict: the worst severity; among equals the most SAR at stake, then the furthest under target
    const judged = steps.filter(s => s.level !== 'na');
    const top1 = [...judged].sort((a, b) => RANK[a.level] - RANK[b.level] || (b.sar ?? -1) - (a.sar ?? -1) || a.ratio - b.ratio)[0];
    // The WhatsApp-destination ads: judged on clicks and cost per click, said plainly
    const wa = waSpend > 0 ? { spend: waSpend, clicks: top.waClicks || 0, cpc: top.waClicks ? waSpend / top.waClicks : null, only: waOnly,
      line: `${WA_NOTE}${top.waClicks ? t(`: نحكم عليها بالنقرات (${f.qty(top.waClicks)}) وتكلفة النقرة (${f.sar(waSpend / top.waClicks)})`, `: judged on clicks (${f.qty(top.waClicks)}) and cost per click (${f.sar(waSpend / top.waClicks)})`) : ''}.` } : null;
    // The headline: what one paying customer costs (spend ÷ paid closings) against its target. Not linked is not zero.
    const head = payer(sale, tgt.cpa, l, f);
    const common = { steps, e2e, losses, biggest, trust, cohort: coh, unlinked, targets: tgt, wa, payer: head };
    if(!top1) return { ...common, level:'na', step:null, stage:'', title:t('ما فيه أرقام كفاية للتحليل', 'Not enough numbers to judge'), owner:null, why:'', todo:'', evidence:'', sar:null, confidence:'low', rule:'', change:'' };
    if(top1.level === 'fine') return { ...common, level:'fine', step:null, stage:'', title:t('لا توجد مشكلة', 'No problem'), owner:null,
      why:t('كل خطوة على هدفها أو أحسن.', 'Every step meets its target.'), todo:t('كمّل على نفس الخطة.', 'Keep the plan.'), evidence:'', sar:null,
      confidence: judged.some(s => s.confidence === 'low') ? 'low' : judged.some(s => s.confidence === 'medium') ? 'medium' : 'high', rule:t('كل الخطوات على الهدف', 'all steps on target'), change:t('لو نزلت أي خطوة تحت هدفها يتغيّر الحكم.', 'Any step falling under its target changes this.') };
    const a = RULES.find(r => r.key === top1.key).advice;
    return { ...common, level:top1.level, step:top1.key, stage:top1.label, title:pick(l, a.t), owner:top1.owner, why:pick(l, a.w), todo:pick(l, a.d),
      evidence:top1.evidence, sar:top1.sar, confidence:top1.confidence, rule:top1.rule, change:top1.change };
  }

  // Cost per paying customer = spend ÷ paid closings. Never 0 or a made-up number: no CRM is «غير مربوط»; a CRM with no paid
  // closing in the period is «لا توجد إقفالات» (nothing to divide by, not a missing link).
  function payer(sale, target, l, f){
    const t = (ar, en) => (l === 'en' ? en : ar);
    const tgt = fin(target) ? target : null, n = sale && sale.closings || 0;
    if(!sale || !sale.crm)
      return { value:null, target:tgt, level:'na', text:t('غير مربوط', 'Not linked'), closings:n, note:t('نظام العملاء مو موصول بهالأرقام.', 'The CRM is not connected to these numbers.') };
    if(!(n > 0))
      return { value:null, target:tgt, level:'na', text:t('لا توجد إقفالات', 'No closings'), closings:0, note:t('ما فيه إقفالات مدفوعة في هالفترة.', 'No paid closings in this period.') };
    if(!(sale.spend > 0))
      return { value:null, target:tgt, level:'na', text:t('غير مربوط', 'Not linked'), closings:n, note:t('ما فيه صرف مربوط بهالإقفالات في هالفترة.', 'No spend is linked to these closings in this period.') };
    const v = sale.spend / sale.closings, ok = fin(target);
    const level = ok ? band(v > 0 ? target / v : Infinity) : 'na';
    return { value:v, target: ok ? target : null, level, text:f.sar(v), closings:sale.closings,
      note: ok ? `${t('الهدف', 'Target')} ${f.sar(target)}` : t('ما فيه هدف للتكلفة بعد.', 'No cost target yet.') };
  }
  return { payer, DEFAULTS, FIELDS, MIN, BANDS, RULES, OWNERS, SEV, RANK, targets, cohort, judge, pick };
})();
if(typeof globalThis !== 'undefined') globalThis.WELL_JUDGE = JUDGE;
