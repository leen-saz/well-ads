// مهارات الكوبي رايتر: كل نوع طلب (إعلان، هوك، سكربت، صفحة هبوط، واتساب...) بمدخلاته، والأسئلة اللي يسألها
// إذا نقص شي، وخطوات التفكير، وشكل المخرج بنسخه، وقائمة المراجعة. المواصفات الكاملة بمصادرها في docs/copywriter-skills/.
// هنا الشكل اللي يقراه الكود: يبني الطلب للنموذج، ويقرا الجواب، ويراجع كل نسخة (اللهجة والامتثال والأطوال).
import { analyze } from '../voice/voice';
import { check, type Rule } from '../compliance/compliance';
import type { Project, StyleCard } from './copy';

export interface Field {
  key: string; ar: string; type: 'text' | 'area' | 'select'; max?: number; required?: boolean;
  ask?: string; placeholder?: string; options?: [string, string][];
}
// One field of the output. max = characters that show uncut (0 = no limit). many = a list of up to that many items.
export interface Part { key: string; ar: string; max?: number; many?: number; hint?: string }
export interface Skill {
  key: string; ar: string; does: string; example: string; doc: string;
  inputs: Field[]; steps: string[]; frameworks: string[]; checks: string[];
  parts: Part[] | ((i: Inputs) => Part[]); count: [number, number]; tokens: number;
}
export type Inputs = Record<string, string>;

// ---- Shared inputs
const GOAL: Field = { key: 'goal', ar: 'الهدف', type: 'select', options: [['lead', 'حجز أو تواصل'], ['awareness', 'يعرفون الخدمة'], ['retention', 'عميل يرجع']] };
// Schwartz, Breakthrough Advertising: how much the reader already knows decides where the copy starts
const AWARE: Field = { key: 'awareness', ar: 'وش يعرف القارئ', type: 'select', options: [
  ['problem', 'يحس بالمشكلة، ما يعرف الحل'], ['unaware', 'ما يدري إن عنده مشكلة'], ['solution', 'يعرف إن فيه حل، ما يعرفنا'],
  ['product', 'يعرفنا، ما قرر'], ['most', 'جاهز، يبي العرض بس']] };
const ANGLE: Field = { key: 'angle', ar: 'زاوية تبيها', type: 'text', max: 200, placeholder: 'مثلاً: الوقت، الخصوصية، العائلة' };
const DISCLOSE: Part = { key: 'disclosure', ar: 'الإفصاح', max: 200, hint: 'أنه إعلان، واسم المعلن، وطريقة التواصل، والسعر الإجمالي إذا فيه سعر' };

// ---- Ad copy per platform (fields and lengths from each platform's ad specs: docs/copywriter-skills/01-ad-copy.md)
export const AD_PLATFORMS: Record<string, { ar: string; parts: Part[] }> = {
  meta: { ar: 'ميتا (فيسبوك وانستقرام)', parts: [
    { key: 'primary', ar: 'النص الأساسي', max: 125, hint: 'سطرين أو ثلاثة، والباقي ينقص تحت «المزيد»: الهوك في أولها' },
    { key: 'headline', ar: 'العنوان', max: 40, hint: '27 حرف يبان كامل في الفيد' }, { key: 'description', ar: 'الوصف', max: 25 }, { key: 'cta', ar: 'زر الإعلان', max: 20 }] },
  snap: { ar: 'سناب شات', parts: [{ key: 'headline', ar: 'العنوان', max: 34 }, { key: 'overlay', ar: 'نص على التصميم', max: 60, hint: 'الرسالة من أول لحظة' }, { key: 'cta', ar: 'زر الإعلان', max: 20 }] },
  tiktok: { ar: 'تيك توك', parts: [{ key: 'text', ar: 'نص الإعلان', max: 100 }, { key: 'overlay', ar: 'نص على الفيديو', max: 60, hint: 'الفكرة في أول 3 ثواني' }, { key: 'cta', ar: 'زر الإعلان', max: 20 }] },
  google: { ar: 'قوقل (بحث)', parts: [
    { key: 'headlines', ar: 'العناوين', max: 30, many: 15, hint: '15 عنوان مختلف: الكلمة المفتاحية، الفائدة، العرض، الثقة، الدعوة' },
    { key: 'descriptions', ar: 'الأوصاف', max: 90, many: 4 }, { key: 'path', ar: 'مسار الرابط', max: 15, many: 2 }] },
  x: { ar: 'إكس', parts: [{ key: 'post', ar: 'نص التغريدة', max: 280 }, { key: 'headline', ar: 'عنوان البطاقة', max: 70 }] },
};

const MOH = [
  'بدون «الأفضل» و«الوحيد» و«الأول» و«الأكثر» و«الخبير» وأي تفضيل مطلق، وبدون مقارنة تنقص من غيرنا',
  'بدون «مضمون» و«نتيجة مضمونة» و«علاج فوري» و«شفاء» و«علاج نهائي» و«شباب دائم» و«يحسّن الذاكرة أو الأداء»',
  'بدون تجارب أو شهادات مرضى، وبدون قبل وبعد، وبدون بيانات أو صور مريض بعينه',
  'بدون تخويف أو إحراج، وبدون مخاطبة حالة صحية شخصية («عندك نقص فيتامين؟»)، وبدون تشجيع على خدمة بدون حاجة',
  'أي خصم أو عرض: قيمته ومدته (60 يوم بالكثير) وشروطه، ومعتمد من الوزارة قبل النشر. أي سعر: الإجمالي بدون رسوم مخفية',
  'لا تخترع سعر ولا رقم ولا إحصائية ولا اعتماد: اللي مو في المعرفة أو المدخلات اكتب مكانه [تأكد]',
];

const opt = (o: [string, string][]) => o;
export const SKILLS: Skill[] = [
  { key: 'ad', ar: 'إعلان مدفوع', doc: '01-ad-copy.md', does: 'نصوص إعلان بحقول المنصة وأطوالها: ميتا، سناب، تيك توك، قوقل، إكس',
    example: 'إعلان ميتا لجلسة المحاليل في البيت، هدفه حجز، والقارئ يحس بالتعب وما يعرف الحل',
    inputs: [{ key: 'platform', ar: 'المنصة', type: 'select', required: true, ask: 'أي منصة؟', options: Object.entries(AD_PLATFORMS).map(([k, v]) => [k, v.ar] as [string, string]) },
      GOAL, AWARE, ANGLE, { key: 'keyword', ar: 'الكلمة المفتاحية (قوقل)', type: 'text', max: 80, placeholder: 'محاليل وريدية في البيت' }],
    steps: ['حدد مستوى الوعي، وابدأ منه: اللي ما يعرف المشكلة تبدأ بالموقف، واللي جاهز تبدأ بالعرض',
      'اختر زاوية مختلفة لكل نسخة: الألم، الراحة، الوقت، العائلة، العرض، سؤال',
      'اكتب الهوك أول: أول سطر لازم يوقف التمرير بدون الصورة',
      'فائدة قبل الميزة، وكل ادعاء محدد ويقدر أحد يتأكد منه',
      'دعوة واحدة واضحة تناسب الهدف', 'راجع الطول: اللي يزيد عن حد المنصة ينقص'],
    frameworks: ['مستويات الوعي (شوارتز)', 'PAS', 'AIDA', '4U للعناوين', 'قوقل: عناوين تشتغل لحالها بأي ترتيب'],
    checks: ['كل نسخة بزاوية مختلفة', 'الهوك يوقف التمرير لحاله', 'الطول داخل حد المنصة', 'دعوة وحدة واضحة'],
    parts: i => AD_PLATFORMS[i.platform || 'meta']?.parts ?? AD_PLATFORMS.meta!.parts, count: [3, 5], tokens: 1600 },

  { key: 'hooks', ar: 'هوكات وافتتاحيات', doc: '02-hooks-video.md', does: 'أول سطر أو أول 3 ثواني: هوكات كثيرة بأنواع مختلفة تختار منها',
    example: 'عشر هوكات لفيديو عن الرعاية المنزلية لكبار السن',
    inputs: [{ key: 'format', ar: 'وين ينحط', type: 'select', options: opt([['video', 'أول 3 ثواني من فيديو'], ['text', 'أول سطر في نص'], ['static', 'عنوان على تصميم']]) }, AWARE, ANGLE],
    steps: ['اكتب من موقف يعيشه الجمهور، مو من الخدمة', 'نوّع الأنواع: سؤال، موقف، رقم، خرافة شائعة، «لو كنت…»، مقارنة بالطريقة القديمة، فضول',
      'كل هوك أقل من 12 كلمة، ويتخيله القارئ', 'شيل أي هوك يقدر أي منافس يقوله بنفس الكلام', 'لا تخوّف ولا تشخّص القارئ'],
    frameworks: ['فضول + تحديد', 'قواعد Marketing Examples الثلاث: تتخيله، تتأكد منه، ما يقوله غيرك'],
    checks: ['أنواع مختلفة', 'أقل من 12 كلمة', 'بدون تشخيص ولا تخويف'],
    parts: [{ key: 'hook', ar: 'الهوك', max: 80 }, { key: 'type', ar: 'نوعه', max: 30 }], count: [10, 15], tokens: 1200 },

  { key: 'video', ar: 'سكربت فيديو', doc: '02-hooks-video.md', does: 'سكربت UGC أو إعلان 15 أو 30 ثانية: المشهد والكلام والنص على الشاشة',
    example: 'سكربت UGC مدته 30 ثانية لأم تحجز قابلة في البيت، بدون تجربة مريض',
    inputs: [{ key: 'length', ar: 'المدة', type: 'select', options: opt([['15', '15 ثانية'], ['30', '30 ثانية'], ['60', '60 ثانية']]) },
      { key: 'style', ar: 'الأسلوب', type: 'select', options: opt([['ugc', 'UGC: شخص يكلم الكاميرا'], ['demo', 'خطوات الخدمة'], ['story', 'قصة قصيرة'], ['text', 'نصوص على الشاشة بس']]) },
      { key: 'platform', ar: 'المنصة', type: 'select', options: opt([['tiktok', 'تيك توك'], ['reels', 'ريلز'], ['snap', 'سناب']]) }, ANGLE],
    steps: ['الثواني 0-3: الهوك بالصورة والكلام والنص على الشاشة مع بعض', '3-10: المشكلة أو الموقف بكلام الناس', '10-25: كيف تشتغل الخدمة خطوة خطوة (بدون وعود نتيجة)',
      'آخر 5 ثواني: الدعوة والعرض', 'اكتب الكلام للسماع: جمل قصيرة، والنص على الشاشة يكفي بدون صوت',
      'UGC: الشخص يحكي عن الخدمة وتجربة الحجز، مو عن نتيجة علاجه. لا ممارس صحي يروّج'],
    frameworks: ['هوك، مشكلة، حل، دليل، دعوة', 'إرشادات تيك توك وميتا: عمودي، أول 3 ثواني، نص على الشاشة'],
    checks: ['المدة تطابق عدد الكلمات (تقريباً كلمتين بالثانية)', 'يفهم بدون صوت', 'بدون شهادة مريض ولا قبل وبعد'],
    parts: [{ key: 'hook', ar: 'الهوك (0-3 ث)', max: 80 }, { key: 'scenes', ar: 'المشاهد', many: 8, hint: 'كل سطر: الوقت | المشهد | الكلام | النص على الشاشة' },
      { key: 'cta', ar: 'الدعوة', max: 60 }, { key: 'caption', ar: 'الكابشن', max: 150 }], count: [2, 3], tokens: 2200 },

  { key: 'landing', ar: 'صفحة هبوط', doc: '03-landing-page.md', does: 'صفحة لهدف واحد: العنوان، الأقسام، الأسئلة، الدعوة، والإفصاح',
    example: 'صفحة هبوط لباقة الرعاية المنزلية، والزائر جاي من إعلان سناب',
    inputs: [GOAL, AWARE, { key: 'source', ar: 'من وين جاي الزائر', type: 'text', max: 120, placeholder: 'إعلان سناب عن…' },
      { key: 'objections', ar: 'وش يخوّفه أو يأخره', type: 'area', max: 600, ask: 'وش أكثر شي يأخر العميل عن الحجز؟ (السعر، الثقة، الوقت…)', required: true }],
    steps: ['هدف واحد ودعوة وحدة في الصفحة كلها', 'العنوان يكمّل وعد الإعلان اللي جاب الزائر بنفس الكلام', 'تحت العنوان: لمين الخدمة ووش يستفيد',
      'رد على كل اعتراض بقسم: السعر، الثقة (الترخيص، الفريق)، الوقت، الخصوصية', 'كيف تشتغل: 3 خطوات', 'الأسئلة الشائعة من كلام العملاء الحقيقي', 'الدعوة تتكرر بنفس النص'],
    frameworks: ['تصميم يركّز على التحويل: هدف واحد', 'PAS', 'صوت العميل (Copyhackers)', 'StoryBrand: العميل هو البطل'],
    checks: ['دعوة وحدة', 'العنوان يطابق الإعلان', 'كل اعتراض له رد', 'الإفصاح والسعر الإجمالي'],
    parts: [{ key: 'headline', ar: 'العنوان', max: 60 }, { key: 'subhead', ar: 'تحت العنوان', max: 140 }, { key: 'bullets', ar: 'الفوائد', many: 5, max: 90 },
      { key: 'sections', ar: 'الأقسام', many: 6, hint: 'كل قسم: العنوان: النص' }, { key: 'steps', ar: 'كيف تشتغل', many: 4, max: 90 },
      { key: 'faq', ar: 'الأسئلة', many: 6, hint: 'السؤال؟ الجواب' }, { key: 'cta', ar: 'الدعوة', max: 25 }, DISCLOSE], count: [1, 2], tokens: 3200 },

  { key: 'whatsapp', ar: 'رسالة واتساب', doc: '04-whatsapp-sms.md', does: 'قالب واتساب: تسويقي أو تذكير أو متابعة، بأزرار وطريقة إيقاف',
    example: 'تذكير قبل موعد الزيارة بيوم، وبعده رسالة متابعة',
    inputs: [{ key: 'type', ar: 'نوع الرسالة', type: 'select', required: true, ask: 'تسويقية ولا تذكير ولا متابعة؟', options: opt([['marketing', 'تسويقية (لعميل وافق يستقبل)'], ['utility', 'تذكير أو تأكيد موعد'], ['followup', 'متابعة بعد الخدمة']]) },
      { key: 'moment', ar: 'متى توصله', type: 'text', max: 160, placeholder: 'قبل الموعد بيوم' }, { key: 'vars', ar: 'المتغيرات', type: 'text', max: 160, placeholder: '{{1}} الاسم، {{2}} الوقت' }],
    steps: ['رسالة وحدة لغرض واحد', 'التذكير ما فيه تسويق (واتساب يصنفه تسويقي لو فيه)', 'أول سطر يقول ليش وصلته الرسالة', 'المتغيرات بين {{ }}',
      'أزرار قصيرة (3 بالكثير)', 'التسويقية فيها طريقة إيقاف واضحة', 'المتابعة تسأل عن الخدمة والتجربة، ولا تطلب تقييم علني ولا شهادة'],
    frameworks: ['تصنيفات قوالب واتساب: تسويقي، خدمي، توثيق', 'الوضوح قبل الإقناع'],
    checks: ['الغرض واضح من أول سطر', 'الأزرار أقل من 20 حرف', 'التسويقية فيها إيقاف', 'بدون بيانات صحية حساسة في الرسالة'],
    parts: [{ key: 'message', ar: 'الرسالة', max: 1024 }, { key: 'buttons', ar: 'الأزرار', many: 3, max: 20 }, { key: 'footer', ar: 'التذييل', max: 60, hint: 'طريقة الإيقاف في التسويقية' }], count: [2, 3], tokens: 1200 },

  { key: 'sms', ar: 'رسالة SMS', doc: '04-whatsapp-sms.md', does: 'رسالة قصيرة: مقطع أو مقطعين عربي، باسم المرسل وطريقة الإيقاف',
    example: 'رسالة لعملاء سابقين عن خصم معتمد على جلسات المحاليل',
    inputs: [{ key: 'type', ar: 'نوع الرسالة', type: 'select', options: opt([['promo', 'ترويجية'], ['reminder', 'تذكير'], ['info', 'معلومة أو تأكيد']]) },
      { key: 'link', ar: 'الرابط', type: 'text', max: 100, placeholder: 'رابط كامل من دومين Well، بدون اختصار' }],
    steps: ['العربي 70 حرف للمقطع: الأفضل مقطع، وبالكثير مقطعين', 'الفكرة والدعوة في أول 70 حرف', 'اسم Well في الرسالة', 'الترويجية فيها طريقة الإيقاف، واسم مرسل ترويجي ينتهي بـ -AD، وما تنرسل من 10 الليل لين 9 الصباح', 'بدون اختصارات تشوّه الكلام'],
    frameworks: ['رسالة وحدة، فعل واحد'],
    checks: ['أقل من 140 حرف', 'الدعوة في أول 70 حرف', 'الترويجية فيها إيقاف'],
    parts: [{ key: 'message', ar: 'الرسالة', max: 140 }, { key: 'optout', ar: 'الإيقاف', max: 30 }], count: [3, 5], tokens: 800 },

  { key: 'email', ar: 'إيميل', doc: '05-email.md', does: 'العنوان والمقدمة والنص والدعوة: ترحيب، عرض، تذكير، نشرة',
    example: 'إيميل ترحيب لعميل سجّل ولا حجز',
    inputs: [{ key: 'type', ar: 'نوع الإيميل', type: 'select', required: true, ask: 'وش نوع الإيميل؟', options: opt([['welcome', 'ترحيب'], ['promo', 'عرض'], ['reminder', 'تذكير أو رجعة'], ['newsletter', 'نشرة توعية']]) },
      GOAL, { key: 'point', ar: 'الفكرة الوحدة', type: 'text', max: 200, required: true, ask: 'وش الشي الواحد اللي تبيه يسويه أو يعرفه؟' }],
    steps: ['فكرة وحدة ودعوة وحدة', 'العنوان يقول وش داخل الإيميل، بدون خداع، أقل من 50 حرف', 'المقدمة (preheader) تكمل العنوان ما تكرره',
      'أول سطر يدخل في الموضوع', 'فقرات قصيرة', 'الدعوة زر واحد بفعل واضح', 'رابط إلغاء الاشتراك موجود دايم'],
    frameworks: ['AIDA', 'BAB', 'إيميل واحد = فكرة وحدة'],
    checks: ['العنوان صادق وأقل من 50 حرف', 'المقدمة ما تكرر العنوان', 'دعوة وحدة', 'إلغاء الاشتراك'],
    parts: [{ key: 'subject', ar: 'العنوان', max: 50 }, { key: 'preheader', ar: 'المقدمة', max: 90 }, { key: 'body', ar: 'النص', max: 1200 },
      { key: 'cta', ar: 'الزر', max: 25 }, { key: 'ps', ar: 'ملاحظة أخيرة', max: 140 }], count: [2, 3], tokens: 1800 },

  { key: 'caption', ar: 'كابشن سوشال', doc: '06-social-captions.md', does: 'كابشن لمنشور: انستقرام، تيك توك، إكس، سناب، لينكدإن',
    example: 'كابشن لمنشور توعوي عن شرب الماء في الصيف',
    inputs: [{ key: 'platform', ar: 'المنصة', type: 'select', options: opt([['instagram', 'انستقرام'], ['tiktok', 'تيك توك'], ['x', 'إكس'], ['snap', 'سناب'], ['linkedin', 'لينكدإن']]) },
      { key: 'topic', ar: 'المنشور عن وش', type: 'area', max: 500, required: true, ask: 'وش في المنشور (الصورة أو الفيديو) وعن وش؟' },
      { key: 'tone', ar: 'النبرة', type: 'select', options: opt([['marketing', 'تسويقي: حيوي'], ['education', 'توعوي: مشجّع'], ['brand', 'براند: دافي']]) }],
    steps: ['أول سطر يكمّل الصورة، ما يوصفها', 'التوعية: معلومة وحدة صحيحة وعامة، بدون تشخيص', 'سؤال أو دعوة للتفاعل أو للحجز حسب النبرة', 'الهاشتاقات قليلة ومحددة', 'إكس: أقل من 280'],
    frameworks: ['قيمة أولاً', 'نبرة حسب السياق في دليل Well'],
    checks: ['أول سطر قوي', 'معلومة عامة بدون تشخيص', '5 هاشتاقات بالكثير'],
    parts: [{ key: 'caption', ar: 'الكابشن', max: 600 }, { key: 'hashtags', ar: 'الهاشتاقات', many: 5, max: 30 }], count: [3, 4], tokens: 1200 },

  { key: 'offer', ar: 'عرض وترويج', doc: '07-offers.md', does: 'صياغة عرض أو خصم: اسمه، قيمته ومدته وشروطه، ونصوصه، مع شرط اعتماد الوزارة',
    example: 'خصم 20% على باقة 3 جلسات لين نهاية الشهر',
    inputs: [{ key: 'deal', ar: 'العرض', type: 'area', max: 400, required: true, ask: 'وش العرض بالضبط: الخدمة، القيمة، السعر قبل وبعد؟' },
      { key: 'until', ar: 'المدة', type: 'text', max: 80, required: true, ask: 'لين متى العرض؟' },
      { key: 'approval', ar: 'اعتماد الوزارة', type: 'select', required: true, ask: 'العرض معتمد من الشؤون الصحية؟', options: opt([['pending', 'قيد الاعتماد'], ['approved', 'معتمد'], ['no', 'ما قدّمنا للحين']]) }],
    steps: ['وضّح القيمة بالأرقام اللي في المدخلات بس', 'المدة والشروط مكتوبة بوضوح', 'الاستعجال حقيقي (المدة الفعلية) مو مصطنع', 'اسم قصير للعرض يسهل تذكره',
      'إذا مو معتمد: نبّه إنه ما ينشر قبل الاعتماد', 'لا تشجع على خدمة بدون حاجة («احجز أكثر توفر أكثر» ممنوعة)'],
    frameworks: ['القيمة، المدة، السبب، الدعوة', 'عرض لا يُرفض (Hormozi) بدون مبالغة'],
    checks: ['القيمة والمدة والشروط', 'تنبيه الاعتماد', 'بدون استعجال وهمي', 'السعر الإجمالي'],
    parts: [{ key: 'name', ar: 'اسم العرض', max: 30 }, { key: 'headline', ar: 'العنوان', max: 40 }, { key: 'terms', ar: 'القيمة والمدة والشروط', max: 200 },
      { key: 'ad', ar: 'نص إعلان قصير', max: 125 }, { key: 'message', ar: 'رسالة واتساب أو SMS', max: 140 }, DISCLOSE], count: [2, 3], tokens: 1400 },

  { key: 'naming', ar: 'اسم وشعار', doc: '08-naming-taglines.md', does: 'أسماء لخدمة أو باقة أو حملة، وشعارات قصيرة، مع سبب كل اسم',
    example: 'اسم لباقة متابعة كبار السن الشهرية، وشعار لها',
    inputs: [{ key: 'what', ar: 'وش نسمي', type: 'text', max: 200, required: true, ask: 'وش الشي اللي نسميه؟ (خدمة، باقة، حملة)' },
      { key: 'feel', ar: 'الإحساس اللي نبيه', type: 'text', max: 200, placeholder: 'دافي، عائلي، واثق' }, { key: 'avoid', ar: 'تجنّب', type: 'text', max: 200 }],
    steps: ['اكتب أسماء كثيرة بأنواع: وصفي، يوحي، كلمة مركبة، كلمة من البيت والعائلة', 'كل اسم يتقال بسهولة ويتكتب بطريقة وحدة', 'جرّبه: سهل يتهجى؟ له معنى سيء بلهجة ثانية أو بالإنجليزي؟',
      'تأكد إنه ما يوعد بنتيجة («شفاء»، «صحة دائمة»)', 'الشعار أقل من 6 كلمات، يقول الوعد بدون تفضيل'],
    frameworks: ['SMILE و SCRATCH (ألكسندرا واتكنز)', 'أنواع الأسماء (Igor)'],
    checks: ['يتقال ويتكتب بسهولة', 'بدون معنى سيء', 'بدون وعد طبي', 'يتماشى مع «Well |» إذا كان علامة فرعية'],
    parts: [{ key: 'name', ar: 'الاسم', max: 25 }, { key: 'tagline', ar: 'الشعار', max: 45 }, { key: 'why', ar: 'ليش', max: 160 }], count: [8, 12], tokens: 1400 },

  { key: 'service', ar: 'وصف خدمة أو منتج', doc: '09-service-descriptions.md', does: 'وصف قصير وطويل للموقع أو التطبيق: وش تشمل، لمين، كيف تشتغل، الأسئلة',
    example: 'وصف خدمة القابلة المنزلية في التطبيق',
    inputs: [{ key: 'includes', ar: 'وش تشمل', type: 'area', max: 800, required: true, ask: 'وش تشمل الخدمة بالضبط؟ ومين يقدمها؟ وكم تاخذ وقت؟' },
      { key: 'price', ar: 'السعر', type: 'text', max: 80, placeholder: 'السعر الإجمالي إذا تبيه ينكتب' },
      { key: 'where', ar: 'وين ينعرض', type: 'select', options: opt([['app', 'التطبيق'], ['web', 'الموقع'], ['store', 'متجر أو قائمة']]) }],
    steps: ['أول جملة: لمين ووش يستفيد', 'وش تشمل بالتحديد (من المدخلات بس)', 'كيف تشتغل: من الحجز لين الزيارة', 'مين يقدمها (فريق مرخّص) بدون تفضيل',
      'الأسئلة اللي يسألها العميل قبل ما يحجز', 'السعر الإجمالي إذا موجود، والإفصاح'],
    frameworks: ['فائدة، ميزة، دليل', 'كتابة للمسح السريع: عناوين ونقاط'],
    checks: ['كل معلومة من المدخلات أو المعرفة', 'الوصف القصير أقل من 160 حرف', 'السعر الإجمالي'],
    parts: [{ key: 'title', ar: 'الاسم', max: 40 }, { key: 'short', ar: 'وصف قصير', max: 160 }, { key: 'long', ar: 'الوصف', max: 900 },
      { key: 'includes', ar: 'تشمل', many: 8, max: 80 }, { key: 'steps', ar: 'كيف تشتغل', many: 4, max: 90 }, { key: 'faq', ar: 'الأسئلة', many: 5, hint: 'السؤال؟ الجواب' }, DISCLOSE], count: [1, 2], tokens: 2200 },

  { key: 'seo', ar: 'مقال SEO', doc: '10-seo-articles.md', does: 'مقال يجاوب سؤال الناس في قوقل: العنوان والوصف والهيكل والمقال والأسئلة',
    example: 'مقال عن «وش الفرق بين المحاليل الوريدية والمكملات» للي يبحث قبل ما يحجز',
    inputs: [{ key: 'keyword', ar: 'الكلمة المفتاحية', type: 'text', max: 100, required: true, ask: 'وش الكلمة أو السؤال اللي يكتبه الناس في قوقل؟' },
      { key: 'intent', ar: 'وش يبي الباحث', type: 'select', options: opt([['info', 'يفهم ويتعلم'], ['compare', 'يقارن قبل ما يقرر'], ['local', 'يبي خدمة قريبة منه']]) },
      { key: 'words', ar: 'الطول', type: 'select', options: opt([['800', '800 كلمة'], ['1200', '1200 كلمة'], ['1800', '1800 كلمة']]) }],
    steps: ['جاوب السؤال في أول فقرة', 'الهيكل من الأسئلة اللي يسألها الناس فعلاً', 'معلومة طبية عامة وصحيحة، وكل معلومة تحتاج مصدر اكتب جنبها [مصدر]',
      'المقال يراجعه ممارس صحي قبل النشر (صحة = YMYL)', 'الخدمة تنذكر في مكانها الطبيعي، مو كل فقرة', 'العنوان أقل من 60 حرف والوصف أقل من 155'],
    frameworks: ['محتوى مفيد للناس أولاً (قوقل)', 'E-E-A-T', 'هرم مقلوب'],
    checks: ['الجواب في أول فقرة', '[مصدر] جنب كل معلومة طبية', 'مراجعة ممارس صحي', 'بدون تشخيص ولا وعد علاج'],
    parts: [{ key: 'title', ar: 'العنوان', max: 60 }, { key: 'meta', ar: 'وصف قوقل', max: 155 }, { key: 'slug', ar: 'الرابط', max: 60 },
      { key: 'outline', ar: 'الهيكل', many: 10 }, { key: 'article', ar: 'المقال' }, { key: 'faq', ar: 'الأسئلة', many: 5, hint: 'السؤال؟ الجواب' }], count: [1, 1], tokens: 6000 },

  { key: 'rewrite', ar: 'إعادة صياغة ونسخ A/B', doc: '11-rewrites-ab.md', does: 'تحسين نص موجود أو نسخ اختبار، كل نسخة تغيّر شي واحد وفرضيته',
    example: 'نسختين A/B من إعلان شغال، نغير الهوك بس',
    inputs: [{ key: 'original', ar: 'النص الأصلي', type: 'area', max: 3000, required: true, ask: 'الصق النص اللي تبي تحسنه' },
      { key: 'change', ar: 'وش تبي', type: 'select', options: opt([['ab', 'نسخ A/B'], ['shorter', 'أقصر'], ['clearer', 'أوضح'], ['saudi', 'أقرب للهجة'], ['hook', 'هوك أقوى'], ['safer', 'أسلم من ناحية الامتثال']]) },
      { key: 'variable', ar: 'وش نختبر', type: 'select', options: opt([['hook', 'الهوك'], ['angle', 'الزاوية'], ['cta', 'الدعوة'], ['offer', 'طريقة عرض السعر'], ['length', 'الطول']]) }],
    steps: ['افهم وش يحاول يسوي النص الأصلي، وحافظ على المعنى والحقائق', 'A/B: كل نسخة تغيّر متغير واحد بس عشان تعرف وش اللي فرق', 'اكتب الفرضية: «لو غيرنا … بيزيد … لأن …»',
      'لا تضيف ادعاء أو رقم مو في الأصل', 'إذا الأصل فيه مخالفة: صحّحها وقل وش غيرت'],
    frameworks: ['متغير واحد لكل اختبار', 'اختبار بحجم عينة كافي قبل الحكم'],
    checks: ['متغير واحد', 'الفرضية مكتوبة', 'المعنى والحقائق نفسها'],
    parts: [{ key: 'text', ar: 'النص', max: 3000 }, { key: 'changed', ar: 'وش تغيّر', max: 200 }, { key: 'hypothesis', ar: 'الفرضية', max: 200 }], count: [3, 4], tokens: 2000 },

  { key: 'localize', ar: 'تعريب وتسعيد', doc: '12-localization.md', does: 'نص إنجليزي أو فصحى يصير سعودي طبيعي: نفس الفكرة بكلام أهل البلد، مو ترجمة',
    example: 'إعلان إنجليزي لخدمة الطبيب عن بعد يصير بلهجة سعودية',
    inputs: [{ key: 'source', ar: 'النص', type: 'area', max: 3000, required: true, ask: 'الصق النص اللي تبيه يتحول' },
      { key: 'from', ar: 'لغته', type: 'select', options: opt([['en', 'إنجليزي'], ['msa', 'فصحى'], ['other', 'لهجة ثانية']]) },
      { key: 'register', ar: 'المستوى', type: 'select', options: opt([['white', 'سعودي أبيض'], ['najdi', 'نجدي قريب'], ['light', 'فصحى خفيفة']]) }],
    steps: ['افهم الفكرة والإحساس، وانسَ ترتيب الكلمات', 'بدّل الأمثلة والمواقف بمواقف سعودية (الدوام، الزحمة، العائلة، رمضان)', 'كلام يقوله الناس فعلاً، بدون كلمات منطقة وحدة تقفل على الباقين',
      'المصطلحات الطبية بالعربي اللي يفهمه الناس، والإنجليزي بين قوسين إذا لازم', 'الأرقام والأسعار بالريال', 'ادعاء الأصل يمر على قواعد الوزارة: اللي ما يصلح هنا يتشال'],
    frameworks: ['ترانس كريشن: نقل الإحساس مو الكلمات'],
    checks: ['يقراه سعودي كأنه انكتب له', 'بدون ترجمة حرفية', 'الادعاءات تمر على قواعد الوزارة'],
    parts: [{ key: 'text', ar: 'النص', max: 3000 }, { key: 'notes', ar: 'وش غيّرت وليش', many: 5, max: 160 }], count: [2, 3], tokens: 2000 },

  { key: 'claims', ar: 'صياغة ادعاء صحي آمن', doc: '13-compliant-claims.md', does: 'ادعاء تبيه يصير جملة تقدر تنشرها: البديل الآمن، والقاعدة، ووش تحتاج من دليل أو اعتماد',
    example: '«المحاليل تقوي المناعة وتنشطك فوراً» تصير جملة آمنة',
    inputs: [{ key: 'claim', ar: 'الادعاء', type: 'area', max: 600, required: true, ask: 'وش الجملة أو الادعاء اللي تبي تقوله؟' },
      { key: 'evidence', ar: 'وش عندك يثبته', type: 'text', max: 300, placeholder: 'دراسة، اعتماد هيئة، ادعاء معتمد في المعرفة' }],
    steps: ['حدد وش في الجملة يخالف: وعد، تفضيل، علاج، سرعة، أمان مطلق، تشخيص', 'افصل الحقيقة اللي تقدر تثبتها عن الوعد', 'اكتب عن الخدمة نفسها (وش تشمل، مين يقدمها، الراحة) بدل النتيجة',
      'اربطها بتقييم الطبيب إذا لازم', 'إذا فيه ادعاء معتمد في المعرفة: استخدمه بنصه', 'قل وش يحتاج الادعاء الأصلي عشان ينشر (دليل، اعتماد)'],
    frameworks: ['دليل ضوابط المحتوى الإعلاني في القطاع الصحي', 'اشتراطات هيئة الغذاء والدواء', 'سياسة ميتا للصحة'],
    checks: ['البديل يعدي الفاحص', 'القاعدة مذكورة', 'وش يحتاج الأصل'],
    parts: [{ key: 'safe', ar: 'البديل الآمن', max: 200 }, { key: 'rule', ar: 'القاعدة', max: 200 }, { key: 'needs', ar: 'وش يحتاج الأصل', max: 200 }], count: [3, 4], tokens: 1000 },
];

export const SKILL = Object.fromEntries(SKILLS.map(k => [k.key, k])) as Record<string, Skill>;
export const partsOf = (k: Skill, i: Inputs): Part[] => (typeof k.parts === 'function' ? k.parts(i) : k.parts);

// What the page sends -> the skill's inputs only, trimmed; a select keeps a known option or falls back to its first
const cut = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
export function cleanInputs(k: Skill, raw: Record<string, unknown>): Inputs {
  const out: Inputs = {};
  for (const f of k.inputs) {
    const v = cut(raw[f.key], f.max ?? 200);
    if (f.type === 'select') out[f.key] = f.options!.some(([o]) => o === v) ? v : f.required && !v ? '' : f.options![0]![0];
    else if (v) out[f.key] = v;
  }
  return out;
}
// The questions for what is still missing (the page asks them before anything is written)
export const missing = (k: Skill, i: Inputs) => k.inputs.filter(f => f.required && !i[f.key]).map(f => ({ key: f.key, ask: f.ask || f.ar }));

const label = (f: Field, v: string) => (f.type === 'select' ? f.options!.find(([o]) => o === v)?.[1] ?? v : v);
const partLine = (p: Part) => {
  const len = p.max ? ` (${p.many ? 'كل وحدة ' : ''}أقل من ${p.max} حرف)` : '';
  return `- "${p.key}": ${p.ar}${p.many ? `، قائمة لين ${p.many}` : ''}${len}${p.hint ? `. ${p.hint}` : ''}`;
};
const cardLine = (name: string, c: StyleCard) => `- ${name}: متوسط ${c.avgWords} كلمة، والجملة ${c.avgSentence} كلمة، وأسئلة في ${c.questions}% من النصوص، وإيموجي ${c.emojiPer} لكل نص`
  + `${c.openers.length ? `، وافتتاحياتهم: ${c.openers.map(o => `«${o.text}»`).join('، ')}` : ''}${c.dialect.length ? `، وكلماتهم السعودية: ${c.dialect.map(d => d.word).join('، ')}` : ''}`
  + `${c.ctas.length ? `، ودعوتهم: ${c.ctas.map(x => x.word).join('، ')}` : ''}.`;

// The request to the model for one skill. The company knowledge goes in the system message (withKnowledge), not here.
export function skillPrompt(k: Skill, i: Inputs, p: Project, count: number, cards: { name: string; card: StyleCard }[] = [], hooks: string[] = []): string {
  const parts = partsOf(k, i);
  const given = k.inputs.filter(f => i[f.key]).map(f => `- ${f.ar}: ${label(f, i[f.key]!)}`);
  const shape = `{${parts.map(x => `"${x.key}":${x.many ? '["…"]' : '"…"'}`).join(',')}}`;
  return [
    `أنت كاتب إعلانات ومحتوى سعودي محترف (أداء وبراند). المهمة: «${k.ar}»: ${k.does}. اكتب ${count} نسخ مختلفة، كل نسخة بزاوية مختلفة.`,
    'اللغة: لهجة سعودية بيضاء واضحة، قريبة ومهنية، جمل قصيرة، وخاطب القارئ بصيغة المذكر.',
    `## المشروع\n- الاسم: ${p.name}\n- الخدمة: ${p.service || '—'}\n- الجمهور: ${p.audience || 'عام في السعودية'}\n- العرض: ${p.offer || '—'}\n- الدعوة: ${p.cta || 'احجز'}${p.voice ? `\n- صوت العلامة: ${p.voice}` : ''}`,
    given.length ? `## الطلب\n${given.join('\n')}` : '',
    `## فكّر بهالخطوات (بينك وبين نفسك، ولا تكتبها)\n${k.steps.map((x, n) => `${n + 1}. ${x}`).join('\n')}`,
    `## الأطر اللي تشتغل فيها\n${k.frameworks.join('، ')}`,
    cards.length ? `## مراجع أسلوب من منافسين: خذ الإيقاع والطول ونوع الافتتاحية والدعوة بس. لا تنسخ جملهم ولا ادعاءاتهم ولا أسعارهم ولا أسماءهم\n${cards.map(c => cardLine(c.name, c.card)).join('\n')}` : '',
    hooks.length ? `## افتتاحيات نجحت عندنا (أرخص ليد)\n${hooks.slice(0, 5).map(h => `- «${h}»`).join('\n')}` : '',
    `## ممنوع (وزارة الصحة وسياسات المنصات)\n${MOH.map(x => `- ${x}`).join('\n')}${p.banned.length ? `\n- كلمات المشروع الممنوعة: ${p.banned.join('، ')}` : ''}`,
    `## راجع كل نسخة قبل ما ترجعها\n${[...k.checks, 'تمر على الممنوع كله', 'صوت Well: دافي، واثق، واضح، محترم'].map(x => `- ${x}`).join('\n')}`,
    `## الحقول\n${parts.map(partLine).join('\n')}\n- "angle": الزاوية بكلمتين\n- "why": ليش هالنسخة تشتغل، بجملة`,
    `رجّع JSON بس، بدون أي كلام قبله أو بعده: {"variants":[${shape.slice(0, -1)},"angle":"…","why":"…"}]}`,
  ].filter(Boolean).join('\n\n');
}

export interface Variant { angle: string; why: string; parts: Record<string, string | string[]> }
// The model's answer -> variants with the skill's fields only. Takes {"variants":[…]} or a bare […], with text around it.
export function parseVariants(raw: string, parts: Part[], count: number): Variant[] {
  const t = String(raw || '').replace(/```(?:json)?/gi, '');
  const at = t.search(/[[{]/);
  if (at < 0) return [];
  let j: unknown;
  for (const end of [t.lastIndexOf('}'), t.lastIndexOf(']')].sort((a, b) => b - a)) {
    if (end <= at) continue;
    try { j = JSON.parse(t.slice(at, end + 1)); break; } catch { /* try the other closer */ }
  }
  const list = Array.isArray(j) ? j : Array.isArray((j as { variants?: unknown })?.variants) ? (j as { variants: unknown[] }).variants : [];
  const str = (v: unknown, max: number) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');
  return list.map(x => (x || {}) as Record<string, unknown>).map(x => {
    const out: Variant = { angle: str(x.angle, 80), why: str(x.why, 300), parts: {} };
    for (const p of parts) {
      const cap = p.max ? p.max * 3 : 12_000;
      const v = x[p.key];
      if (p.many) out.parts[p.key] = (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : []).map(y => str(y, cap)).filter(Boolean).slice(0, p.many);
      else out.parts[p.key] = Array.isArray(v) ? v.map(y => str(y, cap)).filter(Boolean).join('\n') : str(v, cap);
    }
    return out;
  }).filter(v => Object.values(v.parts).some(y => (Array.isArray(y) ? y.length : y))).slice(0, count);
}

// Each field against its length; the voice checks, the compliance rules (plus the knowledge's forbidden words) and the
// project's banned words over the whole variant. Notices only: nothing is blocked (Leen's rule).
export function reviewVariant(v: Variant, parts: Part[], p: Project, extra: Rule[] = []) {
  const over: { field: string; len: number; max: number; n?: number }[] = [];
  for (const x of parts) {
    const val = v.parts[x.key];
    if (!x.max || val == null) continue;
    if (Array.isArray(val)) val.forEach((y, n) => { if (y.length > x.max!) over.push({ field: x.ar, len: y.length, max: x.max!, n: n + 1 }); });
    else if (val.length > x.max) over.push({ field: x.ar, len: val.length, max: x.max });
  }
  const text = parts.map(x => v.parts[x.key]).map(y => (Array.isArray(y) ? y.join('\n') : y || '')).filter(Boolean).join('\n');
  const a = analyze(text);
  return { ...v, text, score: a.score, dialect: a.dialect, checks: a.checks, compliance: check(text, extra), banned: p.banned.filter(w => text.includes(w)), over };
}

// What the page needs to draw the picker and each skill's form (no functions)
export const catalog = () => SKILLS.map(k => ({ key: k.key, ar: k.ar, does: k.does, example: k.example, doc: k.doc, inputs: k.inputs, checks: k.checks, count: k.count,
  parts: typeof k.parts === 'function' ? null : k.parts }));
