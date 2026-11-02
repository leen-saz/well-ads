// Compliance (الامتثال): checks ad copy against Saudi health-advertising rules (MOH / SFDA principles) and the
// platforms' health-ad policies. A notice only: it never blocks publishing. Rules are plain data, easy to extend.

export type Level = 'critical' | 'warn' | 'info';
export interface Rule { id: string; level: Level; title: string; why: string; fix: string; re: RegExp }
export interface Hit { rule: string; level: Level; title: string; why: string; fix: string; match: string }

// Arabic letters vary (ة/ه, أ/ا, ى/ي): patterns allow both where it matters.
export const RULES: Rule[] = [
  { id: 'guarantee', level: 'critical', title: 'وعد بنتيجة مضمونة',
    why: 'وزارة الصحة تمنع ضمان نتائج العلاج، وميتا وتيك توك يرفضون ادعاءات النتائج المضمونة.',
    fix: 'قل "النتائج تختلف من شخص لآخر" بدل الضمان.', re: /(مضمون[هة]?|نتائج مؤكد[هة]|100\s?%|١٠٠\s?٪|guarantee[ds]?)/i },
  { id: 'cure', level: 'critical', title: 'ادعاء شفاء أو علاج نهائي',
    why: 'ادعاء الشفاء أو العلاج النهائي ممنوع في الإعلان الصحي.',
    fix: 'اكتب الفائدة بدون ادعاء: "يساعد على…" أو "جلسات لدعم…".', re: /(علاج نهائي|يشفي|شفاء (تام|نهائي)|يقضي على|تخلص (نهائي|للأبد)|\bcures?\b)/i },
  { id: 'before_after', level: 'critical', title: 'قبل وبعد',
    why: 'صور أو عبارات "قبل وبعد" ممنوعة في إعلانات الصحة والتجميل عند ميتا وتيك توك.',
    fix: 'اعرض تجربة الخدمة نفسها بدل المقارنة.', re: /(قبل\s*و\s*بعد|before\s*(and|&|\/)\s*after)/i },
  { id: 'no_rx', level: 'critical', title: 'دواء بدون وصفة',
    why: 'الإعلان عن أدوية بوصفة أو صرفها بدون وصفة مخالف لأنظمة هيئة الغذاء والدواء.',
    fix: 'اذكر إن الخدمة بعد تقييم طبي.', re: /(بدون وصف[هة]|without (a )?prescription)/i },
  { id: 'weight', level: 'critical', title: 'وعد بنزول وزن محدد',
    why: 'الوعد بعدد كيلوات أو مدة محددة لنزول الوزن مرفوض في سياسات المنصات.',
    fix: 'تكلم عن البرنامج والمتابعة بدون أرقام وعود.', re: /(\d+|[٠-٩]+)\s*(كيلو|كجم|kg)/i },
  { id: 'superlative', level: 'warn', title: 'تفضيل مطلق بدون دليل',
    why: 'عبارات مثل "الأفضل" أو "رقم 1" تحتاج دليل موثق، وإلا تعتبر تضليل.',
    fix: 'اكتب ميزة محددة: "فريق طبي مرخّص يجيك البيت".', re: /(الأفضل|الأول في|رقم\s?(1|١|واحد)|أقوى|\bbest\b|#\s?1\b|number one)/i },
  { id: 'personal', level: 'warn', title: 'مخاطبة حالة صحية شخصية',
    why: 'ميتا تمنع الإعلان اللي يلمّح إنه يعرف حالة الشخص الصحية ("هل تعاني من…").',
    fix: 'خاطب الفئة بشكل عام: "للي يبون…" أو "إذا كنت تبحث عن…".', re: /(هل تعاني|تعاني من|عندك (تساقط|سكر|ضغط|سمن[هة])|are you suffering|do you have)/i },
  { id: 'speed', level: 'warn', title: 'وعد بنتيجة سريعة',
    why: 'مدة محددة للنتيجة ("خلال أسبوع") تعتبر ادعاء غير مثبت.',
    fix: 'احذف المدة أو اكتب "مع الجلسات المنتظمة".', re: /(خلال (يوم|يومين|أسبوع|اسبوع|ساع[هة]|أيام)|from the first session|in (one|1) week|overnight)/i },
  { id: 'refund', level: 'warn', title: 'ضمان استرجاع المبلغ',
    why: 'ضمان الاسترجاع على خدمة طبية يلمّح لنتيجة مضمونة.',
    fix: 'اكتب سياسة الإلغاء بدل ضمان النتيجة.', re: /(ضمان استرجاع|استرجاع (المبلغ|فلوسك)|money[- ]back)/i },
  { id: 'discount', level: 'info', title: 'خصم بدون شروط',
    why: 'نظام التجارة يطلب توضيح مدة العرض وشروطه.',
    fix: 'أضف المدة: "العرض لين نهاية الشهر" أو "لأول حجز".', re: /(خصم|تخفيض|عرض خاص|\d+\s?%\s?off|discount)/i },
  { id: 'fear', level: 'info', title: 'تخويف أو إحراج',
    why: 'أسلوب التخويف أو الإحراج يضعف الثقة وتعاقب عليه خوارزميات المنصات.',
    fix: 'ركز على الفائدة بدل الخوف.', re: /(محرج|لا تخلي .{0,20} يفضحك|خطر على حياتك|قبل لا يفوت الأوان)/i },
];

const SHOUT = /[!؟?]{3,}/;

export function check(text: string): Hit[] {
  const t = String(text || '').slice(0, 5000);
  const out: Hit[] = [];
  for (const r of RULES) {
    if (r.id === 'discount' && /(لين|حتى|ينتهي|لأول|لفترة|until|ends)/i.test(t)) continue; // the offer already has terms
    const m = t.match(r.re);
    if (m) out.push({ rule: r.id, level: r.level, title: r.title, why: r.why, fix: r.fix, match: m[0] });
  }
  if (SHOUT.test(t)) out.push({ rule: 'shout', level: 'info', title: 'علامات تعجب كثيرة', why: 'المنصات تقلل وصول النصوص المبالغ فيها.', fix: 'علامة وحدة تكفي.', match: (t.match(SHOUT) || [''])[0] });
  const rank: Record<Level, number> = { critical: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

export interface AdText { ad_key: string; platform: string; name?: string | null; live?: boolean | null; text?: string | null }
export function scan(ads: AdText[]): { ads: (AdText & { hits: Hit[]; worst: Level | null })[]; summary: Record<string, number>; checked: number } {
  const seen = new Set<string>();
  const out: (AdText & { hits: Hit[]; worst: Level | null })[] = [];
  let checked = 0;
  for (const a of ads) {
    const text = `${a.name || ''}\n${a.text || ''}`.trim();
    if (!a.text) continue;
    checked++;
    const key = `${a.platform}|${(a.text || '').trim()}`; // the same copy on many ads is reported once
    if (seen.has(key)) continue;
    seen.add(key);
    const hits = check(text);
    if (hits.length) out.push({ ...a, hits, worst: hits[0]?.level ?? null });
  }
  const rank: Record<string, number> = { critical: 0, warn: 1, info: 2 };
  out.sort((x, y) => (rank[x.worst || 'info'] ?? 3) - (rank[y.worst || 'info'] ?? 3) || Number(!!y.live) - Number(!!x.live));
  const summary = { critical: 0, warn: 0, info: 0 } as Record<string, number>;
  for (const a of out) summary[a.worst || 'info'] = (summary[a.worst || 'info'] || 0) + 1;
  return { ads: out, summary, checked };
}
