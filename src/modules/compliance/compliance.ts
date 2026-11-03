// Compliance (الامتثال): the one list of health-advertising rules for every tab (social, campaigns, content, design,
// voice, journeys, copy). A notice only: it never blocks (Leen's rule). Each hit names the exact phrase and where it
// sits in the text, the rule, its source, and what to write instead. The company adds its own forbidden words in المعرفة.

export type Level = 'critical' | 'warn' | 'info';
export interface Source { name: string; ref: string; url?: string }
export interface Rule { id: string; level: Level; title: string; why: string; fix: string; safe?: string; source: Source[]; re: RegExp[] }
export interface Hit { rule: string; level: Level; title: string; why: string; fix: string; safe?: string; match: string; start: number; end: number; source: Source[] }

// Sources. MOH guide = "دليل ضوابط المحتوى الإعلاني في القطاع الصحي", appendix 10, article 7/4 (Well brand guide, section 10).
const MOH = (item: string): Source => ({ name: 'وزارة الصحة: دليل ضوابط المحتوى الإعلاني في القطاع الصحي', ref: `المرفق 10، المادة 7/4، ${item}` });
const M40: Source = { name: 'نظام المؤسسات الصحية الخاصة (م/40)', ref: 'المادة 31: الإعلان بموافقة الوزارة وبما لا يخالف أخلاق المهنة', url: 'https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/64e307c5-ac8c-49d8-9174-a9a700f285a0/1' };
const M95: Source = { name: 'نظام مزاولة المهن الصحية (م/95)', ref: 'المادة 10: لا دعاية تجارية للممارس' };
const SFDA: Source = { name: 'هيئة الغذاء والدواء', ref: 'اشتراطات الإعلان: كل ادعاء يعتمد من الهيئة ومسنود بدليل علمي، وبدون ادعاءات مضللة', url: 'https://www.sfda.gov.sa/en/news/sfda-compels-companies-abide-requirements-medical-devices-products-advertisement' };
const META: Source = { name: 'سياسة ميتا للإعلانات', ref: 'الصحة والمظهر: بدون قبل وبعد، وبدون تلميح لحالة الشخص الصحية', url: 'https://transparency.meta.com/policies/ad-standards/' };
const COMPANY: Source = { name: 'معرفة الشركة', ref: 'الكلمات الممنوعة في تاب المعرفة' };

// Arabic spelling varies: patterns and text are compared with diacritics and tatweel removed, أ/إ/آ = ا, ى = ي, ة = ه.
// One character in = one character out (except the removed ones), so positions map back to the original text.
const MARKS = /[ً-ْٰـ]/;
const fold = (c: string) => (c === 'أ' || c === 'إ' || c === 'آ' ? 'ا' : c === 'ى' ? 'ي' : c === 'ة' ? 'ه' : c === '٪' ? '%' : c);
export function normalize(text: string): { t: string; at: number[] } {
  let t = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (MARKS.test(c)) continue;
    t += fold(c).toLowerCase();
    at.push(i);
  }
  at.push(text.length);
  return { t, at };
}
const R = (src: string, flags = 'i') => new RegExp([...src].map(fold).join(''), flags);
// Arabic has no \b: a word starts after a non-letter
const W = '(?:^|[^\\p{L}])';

export const RULES: Rule[] = [
  { id: 'cure', level: 'critical', title: 'وعد بشفاء أو علاج نهائي',
    why: 'ادعاء الشفاء أو العلاج النهائي معلومة مضللة، وكل ادعاء علاجي يحتاج اعتماد ودليل علمي.',
    fix: 'اكتب الفائدة بدون وعد: "جلسات تساعد على…" أو "يدعم…"، بدون نهائي أو للأبد.', safe: 'يساعد على التخفيف',
    source: [MOH('د-3 و د-10'), SFDA],
    re: [R('(يعالج|تعالج|نعالج|يعالجك|تعالجك|علاج|علاجنا)[^.!؟?\\n]{0,40}?(نهائيا?|بشكل نهائي|للابد|جذريا?|بدون رجع[هت]|بلا رجع[هت]|تماما)'),
      R(`${W}(يشفي|تشفي|نشفي)(ك|كم)?|شفاء (تام|نهائي|كامل)|الشفاء التام`, 'iu'),
      R('(تخلص|تخلصي|ودع|ودعي|وداعا ل)[^.!؟?\\n]{0,40}?(للابد|نهائيا?|بدون رجع[هت]|بلا رجع[هت])'),
      R('(يقضي|تقضي|نقضي) على|يعالج ما فشل|ما فشلت (فيه|العلاجات)|(استعد|استعيد|ترجع لك|يرجع لك) صحتك كامل|cures?\\b')] },
  { id: 'disease', level: 'warn', title: 'ادعاء علاج مرض محدد',
    why: 'ذكر إن الخدمة تعالج مرض بالاسم ادعاء علاجي يحتاج دليل علمي واعتماد.',
    fix: 'اذكر الخدمة ومين يقدمها، واترك التشخيص والعلاج للطبيب: "بعد تقييم الطبيب".', safe: 'بعد تقييم الطبيب',
    source: [SFDA, MOH('د-3')],
    re: [R('(يعالج|تعالج|نعالج|علاج|يداوي)\\s+(ال)?(سكري|سكر|ضغط|سرطان|قولون|ربو|صداع|زكام|انفلونزا|كورونا|تعب المزمن|ارهاق المزمن|تعب والارهاق|تساقط الشعر|اكتئاب|قلق|عقم)')] },
  { id: 'prevent', level: 'warn', title: 'ادعاء وقاية من مرض',
    why: 'الوعد بالحماية من مرض ادعاء صحي ما ينكتب بدون دليل واعتماد.',
    fix: 'قل "يدعم صحتك" أو "جزء من روتين صحي"، بدون "يحميك من".', safe: 'يدعم صحتك',
    source: [SFDA, MOH('د-3')],
    re: [R('(يحميك|تحميك|يحمي|يقيك|يقي|يمنع|تمنع) (من )?(ال)?(اصاب[هة]|مرض|امراض|انفلونزا|زكام|عدوى|فيروس|كورونا|برد)'), R('مناع[هة] (حديد|خارق|100)')] },
  { id: 'guarantee', level: 'critical', title: 'وعد بنتيجة مضمونة',
    why: 'كلمة "مضمون" ضمن العبارات المبالغ فيها الممنوعة، ونتيجة العلاج تختلف من شخص لشخص.',
    fix: 'احذف الضمان واكتب "النتائج تختلف من شخص لآخر".', safe: 'النتائج تختلف من شخص لآخر',
    source: [MOH('د-10'), META],
    re: [R('مضمون[هة]?|نضمن لك|نتائج مؤكد[هة]|ضمان النتيج[هة]|(^|[^\\d])100\\s?%|guarantee[ds]?')] },
  { id: 'superlative', level: 'critical', title: 'تفضيل مطلق',
    why: 'عبارات مثل "الأفضل" و"الوحيد" و"الأمثل" ممنوعة في الإعلان الصحي، ولو فيه دليل.',
    fix: 'اكتب ميزة محددة تقدر تثبتها: "فريق طبي مرخّص يجيك البيت".', safe: 'فريق طبي مرخّص',
    source: [MOH('د-9'), M95],
    re: [R(`${W}(الافضل|الوحيد|الوحيده|الامثل|الاقوى|الارخص|الخبير|الاكثر (خبر[هة]|طلبا|ثق[هة]|امانا))`, 'iu'),
      R(`(الاول|رقم\\s?(1|١|واحد)) (في|ب)|${W}#\\s?1|لا مثيل|ما له مثيل|ما لها مثيل|\\bbest\\b|number one`, 'iu')] },
  { id: 'better', level: 'warn', title: 'مقارنة أو تفضيل',
    why: '"أفضل" بدون "ال" تبقى تفضيل ممكن ينفهم إنه انتقاص من غيرك.',
    fix: 'قارن نفسك بنفسك أو اذكر ميزة محددة.', source: [MOH('د-8 و د-9')],
    re: [R(`${W}(افضل|احسن) (طبيب|دكتور|مستشفى|عيادة|مركز|خدم[هة]|علاج|سعر)`, 'iu'), R('(بعكس|مو مثل|مب مثل|مش زي|احسن من) (غيرنا|المستشفيات|العيادات|باقي|المراكز)')] },
  { id: 'exaggeration', level: 'critical', title: 'عبارة مبالغ فيها',
    why: 'هذي من العبارات المبالغ فيها اللي ينص الدليل على منعها.',
    fix: 'احذفها، أو اكتب الحقيقة كما هي بدون تهويل.', source: [MOH('د-10'), SFDA],
    re: [R('مثبت[هة]? (علميا|سريريا)|نتائج مثبت[هة]|خضع (ل|الى) تجارب سريري[هة]|علاج (شامل|متكامل)|(علاج|نتيج[هة]|مفعول) فوري|شباب دائم|(يحسن|يزيد|يقوي|تحسن|تزيد) (الذاكر[هة]|الاداء|التركيز)|معجز[هة]|سحري')] },
  { id: 'testimonial', level: 'critical', title: 'تجربة أو شهادة مريض',
    why: 'شهادات المرضى أو تجاربهم ممنوعة تماماً، وكذلك أي بيانات تخص مريض بعينه.',
    fix: 'احذف التجربة، واعرض الخدمة نفسها وطريقة الحجز.', source: [MOH('د-4 و د-5')],
    re: [R('تجرب[هة] (مريض|مريضه|عميل|عميله|مراجع)|تجارب (ال)?(مرضى|مرضانا|عملائنا|عملاء|مراجعين)|شهاد[هة] (مريض|عميل|مراجع)|(اراء|آراء|تقييمات) (ال)?(مرضى|عملائنا|عملاء)|قص[هة] نجاح|(يقول|تقول|قالت|قال) (احد |وحده من )?(مرضانا|عملائنا|مراجعينا)|testimonial')] },
  { id: 'before_after', level: 'critical', title: 'قبل وبعد',
    why: 'مقارنة قبل وبعد تعرض حالة مريض وتلمّح لنتيجة، وميتا وتيك توك يرفضونها.',
    fix: 'اعرض تجربة الخدمة نفسها بدل المقارنة.', source: [MOH('د-4'), META],
    re: [R('قبل\\s*(و|&|/)\\s*بعد|before\\s*(and|&|/)\\s*after')] },
  { id: 'safety', level: 'critical', title: 'ادعاء إنه بدون أي ضرر',
    why: 'الدليل يطلب توضيح المخاطر والمضاعفات المحتملة، و"بدون أضرار" ينفيها.',
    fix: 'اكتب "بإشراف طبي" واذكر إن لكل إجراء مخاطر يشرحها الطبيب.', safe: 'بإشراف طبي',
    source: [MOH('ج-6 و ج-7'), SFDA],
    re: [R('(بدون|بلا|ما له|ما لها|خالي من) (ال)?(اضرار|اعراض جانبي[هة]|آثار جانبي[هة]|اثار جانبي[هة]|مضاعفات)|امن (تماما|100|١٠٠)|آمن (تماما|100)')] },
  { id: 'no_rx', level: 'critical', title: 'دواء بدون وصفة',
    why: 'الإعلان عن دواء بوصفة أو صرفه بدون وصفة مخالف.', fix: 'اذكر إن الخدمة بعد تقييم طبي.', safe: 'بعد تقييم طبي',
    source: [SFDA], re: [R('بدون وصف[هة]|without (a )?prescription')] },
  { id: 'weight', level: 'critical', title: 'وعد بنزول وزن محدد',
    why: 'الوعد بعدد كيلوات أو مدة لنزول الوزن مرفوض في سياسات المنصات ويعتبر مضلل.',
    fix: 'تكلم عن البرنامج والمتابعة بدون أرقام.', source: [META, MOH('د-3')],
    re: [R('(\\d+|[٠-٩]+)\\s*(كيلو|كجم|kg)')] },
  { id: 'overuse', level: 'warn', title: 'تشجيع على خدمة بدون حاجة طبية',
    why: 'الدليل يمنع تشجيع الاستخدام غير الضروري للخدمات الصحية.',
    fix: 'اربط الخدمة بتقييم الطبيب: "بعد استشارة الطبيب".', safe: 'بعد استشارة الطبيب', source: [MOH('د-7')],
    re: [R('(بدون|بلا|ما تحتاج) (استشار[هة]|تقييم|كشف|موعد) طبي|ما تحتاج (دكتور|طبيب)|كل ما (تعبت|حسيت)')] },
  { id: 'personal', level: 'warn', title: 'مخاطبة حالة صحية شخصية',
    why: 'ميتا تمنع الإعلان اللي يلمّح إنه يعرف حالة الشخص الصحية.',
    fix: 'خاطب الفئة بشكل عام: "للي يبون…" أو "إذا كنت تبحث عن…".', source: [META],
    re: [R('هل تعاني|تعاني من|عندك (تساقط|سكر|ضغط|سمن[هة]|اكتئاب)|are you suffering|do you have')] },
  { id: 'speed', level: 'warn', title: 'وعد بنتيجة سريعة',
    why: 'مدة محددة للنتيجة ادعاء غير مثبت.', fix: 'احذف المدة أو اكتب "مع الجلسات المنتظمة".', safe: 'مع الجلسات المنتظمة',
    source: [MOH('د-3 و د-10')],
    re: [R('(خلال|من) (يوم|يومين|اسبوع|ساع[هة]|ايام|جلس[هة] وحد[هة]|اول جلس[هة])|بجلس[هة] وحد[هة]|from the first session|in (one|1) week|overnight')] },
  { id: 'refund', level: 'warn', title: 'ضمان استرجاع المبلغ',
    why: 'ضمان الاسترجاع على خدمة طبية يلمّح لنتيجة مضمونة.', fix: 'اكتب سياسة الإلغاء بدل ضمان النتيجة.',
    source: [MOH('د-3')], re: [R('ضمان استرجاع|استرجاع (المبلغ|فلوسك)|money[- ]back')] },
  { id: 'price', level: 'warn', title: 'سعر بدون الإجمالي',
    why: 'الإعلان لازم يوضح إجمالي رسوم الخدمة بدون رسوم إضافية مخفية.',
    fix: 'اكتب "السعر شامل الضريبة ورسوم الزيارة" أو وضّح وش يشمل.', source: [MOH('ج-4')],
    re: [R('(\\d[\\d,.]*|[٠-٩]+)\\s*(ريال|ر\\.?\\s?س|sar|sr)(?!\\p{L})', 'iu')] },
  { id: 'discount', level: 'warn', title: 'خصم أو عرض بدون شروطه',
    why: 'العرض والخصم يحتاجون موافقة الشؤون الصحية مسبقاً، والإعلان يذكر القيمة والمدة واعتماد الوزارة.',
    fix: 'أضف قيمة الخصم ومدته ("لين نهاية الشهر")، وتأكد إن العرض معتمد من الشؤون الصحية.', source: [MOH('ب و ج-8'), M40],
    re: [R('خصم|تخفيض|عرض خاص|عروض|اثنين بسعر|\\d+\\s?%\\s?off|discount')] },
  { id: 'fear', level: 'info', title: 'تخويف أو إحراج',
    why: 'التخويف أو الإحراج استغلال لحاجة المريض، وتعاقب عليه المنصات.', fix: 'ركز على الفائدة بدل الخوف.',
    source: [MOH('د')], re: [R('محرج|يفضحك|خطر على حياتك|قبل لا يفوت الاوان')] },
  { id: 'shout', level: 'info', title: 'علامات تعجب كثيرة',
    why: 'المنصات تقلل وصول النصوص المبالغ فيها.', fix: 'علامة وحدة تكفي.', source: [META], re: [/[!؟?]{3,}/] },
];

const RANK: Record<Level, number> = { critical: 0, warn: 1, info: 2 };
const TERMS = R('(لين|حتى|ينتهي|لاول|لفتر[هة]|لمد[هة]|until|ends)');
const TOTAL = R('(شامل|يشمل|الاجمالي|اجمالي|بدون رسوم|مع الضريب[هة])');

// Company words (المعرفة → ممنوع): one phrase per line or between commas. A phrase matches as a whole word, never inside
// another one («سر» is not in «سريع»). Arabic writes some words joined to the next: و/ف, then ب/ل/ك, then ال may come
// in front («بالسر»، «والسر» match), and the hit starts at the phrase itself. Nothing is allowed after it («سرها» is not
// matched): a suffix list would bring back the false hits this fixes.
const CLITICS = '(?<=(?:^|[^\\p{L}\\p{N}])(?:[وف]?[بلك]?(?:ال)?))';
export function companyRules(phrases: string[]): Rule[] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...new Set(phrases.map(p => normalize(p.trim()).t).filter(p => p.length >= 2 && p.length <= 60))].map((p, i) => ({
    id: `company_${i + 1}`, level: 'critical' as const, title: 'كلمة ممنوعة عند الشركة', why: 'مكتوبة في الممنوع في تاب المعرفة.',
    fix: 'احذفها أو بدّلها بصياغة معتمدة.', source: [COMPANY], re: [new RegExp(`${CLITICS}${esc(p)}(?![\\p{L}\\p{N}])`, 'iu')],
  }));
}

export function check(text: string, extra: Rule[] = []): Hit[] {
  const raw = String(text || '').slice(0, 20000);
  const { t, at } = normalize(raw);
  const out: Hit[] = [];
  for (const r of [...RULES, ...extra]) {
    if (r.id === 'price' && TOTAL.test(t)) continue;
    let m: RegExpExecArray | null = null;
    for (const re of r.re) { m = re.exec(t); if (m) break; }
    if (!m) continue;
    // Patterns that open with a "not a letter" guard: the phrase itself starts after it
    const lead = m[0].length - m[0].replace(/^[^\p{L}\d#]+/u, '').length;
    const s = m.index + lead, e = m.index + m[0].length;
    const start = at[s] ?? 0, end = at[e] ?? raw.length;
    const level: Level = r.id === 'discount' && TERMS.test(t) ? 'info' : r.level;
    out.push({ rule: r.id, level, title: r.title, why: r.why, fix: r.fix, ...(r.safe ? { safe: r.safe } : {}), match: raw.slice(start, end), start, end, source: r.source });
  }
  return out.sort((a, b) => RANK[a.level] - RANK[b.level] || a.start - b.start);
}

// One line per hit, for places that show plain text notices (social, journeys)
export const notice = (h: Hit): string =>
  `امتثال${h.level === 'critical' ? ' (مخالفة)' : h.level === 'warn' ? ' (انتبه)' : ''}: ${h.title} «${h.match}». ${h.fix} المصدر: ${h.source.map(s => `${s.name}، ${s.ref}`).join(' / ')}.`;
export const worst = (hits: Hit[]): Level | null => hits[0]?.level ?? null;

export interface AdText { ad_key: string; platform: string; name?: string | null; live?: boolean | null; text?: string | null }
export function scan(ads: AdText[], extra: Rule[] = []): { ads: (AdText & { hits: Hit[]; worst: Level | null })[]; summary: Record<string, number>; checked: number } {
  const seen = new Set<string>();
  const out: (AdText & { hits: Hit[]; worst: Level | null })[] = [];
  let checked = 0;
  for (const a of ads) {
    if (!a.text) continue;
    checked++;
    const key = `${a.platform}|${a.text.trim()}`; // the same copy on many ads is reported once
    if (seen.has(key)) continue;
    seen.add(key);
    const hits = check(a.text, extra);
    if (hits.length) out.push({ ...a, hits, worst: worst(hits) });
  }
  out.sort((x, y) => (RANK[x.worst || 'info'] ?? 3) - (RANK[y.worst || 'info'] ?? 3) || Number(!!y.live) - Number(!!x.live));
  const summary = { critical: 0, warn: 0, info: 0 } as Record<string, number>;
  for (const a of out) summary[a.worst || 'info'] = (summary[a.worst || 'info'] || 0) + 1;
  return { ads: out, summary, checked };
}

// The AI rewrite: what it is told to fix. The caller checks the answer again before showing it.
export function rewritePrompt(text: string, hits: Hit[]): string {
  return `أعد كتابة هذا النص الإعلاني لشركة رعاية صحية في السعودية بحيث يلتزم بأنظمة الإعلان الصحي، وبنفس المعنى والطول تقريباً واللهجة.
صلّح هذي الملاحظات بالضبط:
${hits.map(h => `- «${h.match}»: ${h.title}. ${h.fix}`).join('\n')}
ممنوع: الوعد بالشفاء أو النتيجة، الأفضل/الوحيد/رقم 1، تجارب المرضى، قبل وبعد، "بدون أضرار"، أي سعر بدون الإجمالي.
رد بالنص الجديد بس، بدون شرح.

النص:
${text}`;
}
