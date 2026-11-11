// The media buyer's playbook as data: the thresholds the rule engine (buyer.ts) uses, and the catalogue of rules with
// their reason, risk, success metric and source. The prose version, per platform, is docs/media-buyer/*.md; a test keeps
// every rule id here present in those docs. Generic public knowledge only: no business figure and no campaign name live in
// this repo. Every number below is a DEFAULT; the company's own limits and campaign names come from the database.

export type Plat = 'meta' | 'tiktok' | 'snapchat' | 'google';
export const PLATS: Plat[] = ['meta', 'tiktok', 'snapchat', 'google'];
export const PLAT_AR: Record<Plat, string> = { meta: 'ميتا', tiktok: 'تيك توك', snapchat: 'سناب شات', google: 'جوجل' };

// Per platform: results a campaign needs before it leaves the learning phase, and how long that takes. null = the
// platform publishes no such number. `verified` = checked against the platform's own help page (docs/media-buyer/sources.md).
export interface PlatFacts { learningEvents: number | null; learningDays: number | null; verified: boolean }
export const PLATFORM_FACTS: Record<Plat, PlatFacts> = {
  meta: { learningEvents: 50, learningDays: 7, verified: true },
  tiktok: { learningEvents: 50, learningDays: 7, verified: true },
  // Snapchat: 30-50 conversions and a 1-7 day learning phase on its help page; we take the low end
  snapchat: { learningEvents: 30, learningDays: 7, verified: true },
  // Google: no event minimum; Learning lasts at most 7 days, and budget or target edits do not restart it
  google: { learningEvents: null, learningDays: 7, verified: true },
};

// Engine thresholds (defaults, in one place so the learning loop can propose a change as a PR on this file only)
export const T = {
  windowDays: 7,                // current window; the one before it is the comparison
  scaleStepMax: 0.2,            // the most a budget goes up in one step (fraction of the current daily spend)
  scaleStepMin: 0.1,            // under this a step is not worth recommending
  scaleDaysAtTarget: 3,         // CPL at or under target for this many days in a row before scaling
  pauseCplMultiple: 1.5,        // CPL at this multiple of the target (or the company's stop line) is a stop
  minLeadsToDecide: 10,         // fewer leads than this in the window: no pause/scale on a campaign
  zeroLeadSpendMultiple: 3,     // spend of this many target CPLs with 0 leads in the window
  fatigueCtrDrop: 0.25,         // CTR fell by this share versus the window before
  fatigueCplRise: 0.2,          // and CPL rose by this share
  fatigueMinImpressions: 5000,  // each window needs this many impressions
  lowCtrOfTarget: 0.5,          // CTR under this share of the target
  clickToLeadFloor: 0.5,        // clicks→lead under this share of the target (page / form problem)
  minClicksForPage: 200,        // the judge's own minimum
  platformGap: 1.5,             // one platform's CPL over another's by this multiple → move budget
  platformMinLeads: 30,         // each platform needs this many leads in the window to be compared
  shiftShare: 0.2,              // the most to move between platforms or placements at once
  placementGap: 1.5,            // Meta: one placement's cost per result over the other's by this multiple
  placementMinResults: 10,      // results each placement needs in the window
  dowGap: 1.4,                  // worst weekday CPL over the best weekday's
  dowMinLeads: 10,              // leads per weekday needed, over 4 weeks
  dowWeeks: 4,
  checkAfterDays: [3, 7] as const, // when the loop measures the outcome
};

export type RuleId = 'learning_hold' | 'scale_up' | 'stop_cpl' | 'zero_leads' | 'fatigue' | 'low_ctr' | 'page_leak' | 'shift_budget' | 'placement_gap' | 'weekday_gap' | 'few_creatives' | 'company';
export interface PlaybookRule {
  id: RuleId;
  topic: 'budget' | 'stop' | 'creative' | 'cpl' | 'schedule' | 'audience' | 'learning' | 'page';
  ar: string;       // the rule in one line
  why: string;      // the reason (Arabic, masculine)
  risk: string;
  success: string;  // how success is measured
  kinds: ('resume' | 'pause' | 'budget_up' | 'budget_down' | 'refresh_creative' | 'hold' | 'review' | 'shift_budget' | 'schedule')[];
  platforms: Plat[] | 'all';
}

export const RULES: PlaybookRule[] = [
  { id: 'learning_hold', topic: 'learning', ar: 'حملة في مرحلة التعلّم: لا تغيّر فيها', platforms: 'all', kinds: ['hold'],
    why: 'التعديل الكبير في الميزانية أو الجمهور أو الإعلان أثناء التعلّم يعيد المنصة للتعلّم من جديد، والأرقام ما تكفي للحكم.',
    risk: 'الانتظار ممكن يكلّف صرف على إعلان ضعيف، بس الحكم المبكر أسوأ.', success: 'توصل الحملة لعدد النتائج المطلوب ويثبت الـ CPL.' },
  { id: 'scale_up', topic: 'budget', ar: 'وسّع الميزانية بخطوة صغيرة لما الـ CPL تحت الهدف أيام متتالية', platforms: 'all', kinds: ['budget_up'],
    why: 'الحملة تجيب ليدز بتكلفة تحت الهدف، والتوسيع التدريجي يحافظ على التكلفة ولا يضغط المنصة بقفزة تعيدها للتعلّم.',
    risk: 'كل زيادة ترفع الـ CPL غالباً. لو قفز فوق الهدف بعد الزيادة ارجع للميزانية السابقة.', success: 'الـ CPL يبقى تحت الهدف بعد 3 أيام من الزيادة، والليدز تزيد بنسبة قريبة من الزيادة.' },
  { id: 'stop_cpl', topic: 'stop', ar: 'أوقف أو خفّض الحملة لما الـ CPL يتجاوز حد الإيقاف بعينة كافية', platforms: 'all', kinds: ['pause', 'budget_down'],
    why: 'تكلفة الليد فوق الحد الذي يحتمله العمل، والعينة كافية عشان ما يكون تذبذب يوم واحد.',
    risk: 'الإيقاف يخسر ما تعلّمته المنصة. الأفضل تخفيض الميزانية أول، والإيقاف لو بقي فوق الحد 3 أيام.', success: 'الصرف يتحول لحملات تحت الحد، والـ CPL الإجمالي ينزل خلال 7 أيام.' },
  { id: 'zero_leads', topic: 'stop', ar: 'صرف بدون ولا ليد: افحص التتبع قبل ما تحكم على الإعلان', platforms: 'all', kinds: ['review', 'pause'],
    why: 'صرف يعادل عدة ليدز بدون ولا ليد غالباً يعني إن حدث التحويل ما يوصل، أو إن الإعلان ما يشتغل.',
    risk: 'لو المشكلة بالتتبع، إيقاف الإعلان يوقف إعلان سليم.', success: 'يرجع الليد يوصل خلال 48 ساعة من الإصلاح، أو تتوقف الحملة لو التتبع سليم.' },
  { id: 'fatigue', topic: 'creative', ar: 'تعب المادة: الـ CTR نزل والـ CPL طلع، بدّل المادة', platforms: 'all', kinds: ['refresh_creative'],
    why: 'نزول نسبة النقر وارتفاع التكلفة معاً مقارنة بالأسبوع اللي قبله علامة إن الجمهور شاف المادة كثير.',
    risk: 'مادة جديدة تعيد التعلّم لو بدّلت كل شي مرة وحدة. أضف مادة جديدة جنب الحالية وبدّل تدريجياً.', success: 'الـ CTR يرجع لمستواه السابق والـ CPL ينزل خلال 7 أيام من تشغيل المادة الجديدة.' },
  { id: 'low_ctr', topic: 'creative', ar: 'نسبة النقر ضعيفة: الإعلان ما يشد', platforms: 'all', kinds: ['refresh_creative'],
    why: 'نسبة النقر أقل من نص الهدف بعينة كافية: أول لقطة أو أول سطر ما يوقف اللي يمرر.',
    risk: 'التغيير بدون اختبار مضبوط ما يعرّفك وش اللي حسّن.', success: 'النسخة الجديدة تتجاوز نسبة نقر القديمة خلال 7 أيام بعينة كافية.' },
  { id: 'page_leak', topic: 'page', ar: 'النقرات كثيرة والليدز قليلة: المشكلة بعد الإعلان', platforms: 'all', kinds: ['review'],
    why: 'الناس تضغط وما تكمل: نموذج طويل، صفحة بطيئة، أو خطوة زايدة قبل الواتساب. تغيير الإعلان ما يعالجها.',
    risk: 'تعديل الصفحة أثناء حملة شغالة يربك المقارنة؛ سجّل تاريخ التغيير.', success: 'نسبة النقرة إلى ليد ترتفع خلال 7 أيام بدون تغيير الجمهور.' },
  { id: 'shift_budget', topic: 'budget', ar: 'انقل جزء من الميزانية من المنصة الأغلى للأرخص', platforms: 'all', kinds: ['shift_budget'],
    why: 'فرق واضح في تكلفة الليد بين منصتين بعينة كافية في كل وحدة منهما.',
    risk: 'المنصة الأرخص ما تتحمّل دايماً ضعف الصرف بنفس التكلفة، لذلك الخطوة صغيرة. وجودة الليد تختلف: راجع الإقفال بالـ CRM قبل النقل الكبير.', success: 'الـ CPL الإجمالي ينزل والليدز الإجمالية ما تنقص خلال 7 أيام.' },
  { id: 'placement_gap', topic: 'budget', ar: 'مواضع ميتا: انقل الميزانية للموضع الأرخص', platforms: ['meta'], kinds: ['shift_budget'],
    why: 'نفس الهدف يكلّف أكثر بوضوح على موضع (فيسبوك أو انستقرام) من الثاني بعينة كافية في كل واحد.',
    risk: 'جودة المحادثات تختلف بين المواضع، والموضع الأرخص قد لا يتحمل ضعف الصرف.', success: 'تكلفة النتيجة الإجمالية في ميتا تنزل والنتائج ما تنقص خلال 7 أيام.' },
  { id: 'weekday_gap', topic: 'schedule', ar: 'أيام الأسبوع تختلف بالتكلفة: وزّع الصرف عليها', platforms: 'all', kinds: ['schedule'],
    why: 'أسوأ يوم بالأسبوع أغلى بوضوح من أفضل يوم على مدى أربعة أسابيع كاملة.',
    risk: 'الأنماط الأسبوعية تتغير بالمواسم (رمضان، اليوم الوطني). لا تبني عليها بعد تغيّر الموسم.', success: 'الـ CPL الأسبوعي ينزل بعد أسبوعين من تعديل التوزيع.' },
  { id: 'few_creatives', topic: 'creative', ar: 'مادة وحدة تاخذ كل الصرف: أضف مواد للاختبار', platforms: 'all', kinds: ['refresh_creative'],
    why: 'لما إعلان وحيد ياخذ معظم الصرف ما فيه بديل جاهز لو تعب، وما تعرف لو فيه أفضل منه.',
    risk: 'مواد جديدة تقسم الصرف وتبطّئ التعلّم أول أيام.', success: 'مادة ثانية تاخذ حصة من الصرف بـ CPL قريب أو أقل خلال 7 أيام.' },
  { id: 'company', topic: 'budget', ar: 'قاعدة الشركة: أسماء وحدود من قاعدة البيانات', platforms: 'all', kinds: ['budget_up', 'budget_down', 'pause', 'resume', 'refresh_creative'],
    why: 'قرار الشركة المكتوب في إعدادات الميديا باير، مو من الريبو.', risk: 'يعتمد على صحة الحدود في الإعدادات، وراجعها لو تغيّر الوضع.', success: 'حسب مقياس كل توصية.' },
];
export const RULE = Object.fromEntries(RULES.map(r => [r.id, r])) as Record<RuleId, PlaybookRule>;
