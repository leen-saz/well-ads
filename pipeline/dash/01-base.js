let LANG = (function(){
  const q = new URLSearchParams(location.search).get('lang');
  if(q==='en' || q==='ar') return q;
  try{ const s=localStorage.getItem('well-ads-lang'); if(s==='en'||s==='ar') return s; }catch(e){}
  return 'ar';
})();
const EN = {
  'لوحة إعلانات Well':'Well ads',
  'لوحة أداء الإعلانات':'Ads performance',
  'ميتا · جوجل · سناب شات · تيك توك — كل المبالغ بالريال السعودي':'Meta · Google · Snapchat · TikTok — amounts in Saudi riyals',
  'ميتا · سناب شات · تيك توك — كل المبالغ بالريال السعودي':'Meta · Snapchat · TikTok — amounts in Saudi riyals',
  'قارن جنب بعض':'Compare side by side',
  'الاقفالات (مدفوعة)':'Closings (paid)',
  'المدفوع':'Paid',
  'النتيجة':'Outcome',
  'فلاتر أكثر':'More filters',
  'صفحات اللوحة':'Dashboard pages',
  'نظرة عامة':'Overview',
  'المنصات والحملات':'Platforms and campaigns',
  'طريقة الحساب':'How it is calculated',
  'شخصيات الجمهور':'Audience personas',
  'من تفاصيل المشاهدين لكل إعلان في الفترة والفلاتر المختارة (ميتا وسناب وتيك توك). العمر داخل كل جنس من ميتا بس (ترجعهم مع بعض)، والمنصات الثانية ما تقسمه. المنطقة والجهاز والوقت لكل المشاهدين. النتايج = الليدز والمحادثات.':'From each ad\'s audience detail in the chosen period and filters (Meta, Snap and TikTok). Age within each gender comes from Meta only (it reports them together); other platforms do not split it. Region, device and time are for everyone. Results = leads and chats.',
  'فلاتر أقل':'Fewer filters',
  'رحلة العميل':'Customer journey',
  'العائد على الصرف':'Return on spend',
  'تكلفة العميل':'Cost per customer',
  'الوعي':'Awareness',
  'الاهتمام':'Interest',
  'التحويل':'Conversion',
  'البيع':'Sale',
  'كم شخص شاف الإعلان':'How many saw the ad',
  'كم واحد ضغط':'How many clicked',
  'كم واحد ترك بياناته أو راسلنا':'How many left details or messaged us',
  'كم واحد دفع':'How many paid',
  'نظام العملاء مو موصول بهالأرقام':'The CRM is not connected to these numbers',
  'مرحلة البيع فاضية لأن أرقام نظام العملاء ما وصلت لهالنسخة من اللوحة. أول ما توصل تطلع الاقفالات هنا.':'The sale stage is empty because the CRM numbers did not reach this copy of the dashboard. Closings show here as soon as they do.',
  'اقفالات مدفوعة':'Paid closings',
  'العائد من الإعلانات':'ROAS from ads',
  'من نقرة إلى ليد':'Click to lead',
  'من ليد إلى اقفالة':'Lead to closing',
  'الاقفالات والمدفوع من كل المصادر في نظام العملاء (مدفوعات ميسّر). العائد على الصرف = المدفوع ÷ الصرف. تكلفة العميل = الصرف ÷ الاقفالات.':'Closings and paid come from every source in the CRM (Moyasar payments). Return on spend = paid ÷ spend. Cost per customer = spend ÷ closings.',
  'اقفالات من الإعلانات':'Closings from ads',
  'العائد على الإعلان':'ROAS',
  'الاقفالات (كل المصادر)':'Closings (all sources)',
  'المدفوع (كل المصادر)':'Paid (all sources)',
  'الاقفالات حسب':'Closings by',
  'يوم الليد':'Lead day',
  'يوم الدفع':'Payment day',
  'تكلفة الاقفالة':'Cost per closing',
  'نسبة الاقفال':'Close rate',
  'الاقفالات':'Closings',
  'مسح':'Clear',
  'صفحات فيسبوك · إنستغرام · تيك توك · تحليلات الموقع':'Facebook · Instagram · TikTok pages · site analytics',
  'العرض':'View',
  'الفلاتر':'Filters',
  'الإعلانات':'Ads',
  'العضوي':'Organic',
  'من':'From',
  'إلى':'To',
  'القسم':'Department',
  'يصفّي المنشورات حسب نصها':'Filters posts by their text',
  'جوجل':'Google',
  'كل الإعلانات':'All ads',
  'النشطة الآن':'Active now',
  'الحملة':'Campaign',
  'كل الحملات':'All campaigns',
  'الهدف':'Objective',
  'كل الأهداف':'All objectives',
  'الصيغة':'Format',
  'كل الصيغ':'All formats',
  'الأقسام':'Departments',
  'اضغط على القسم لفتح صفحته':'Click a department to open it',
  'الاتجاه':'Trend',
  'تلقائي':'Auto',
  'يومي':'Daily',
  'أسبوعي':'Weekly',
  'شهري':'Monthly',
  'اضغط على أي عمود عشان تركّز الفترة عليه.':'Click a bar to focus the range on it.',
  'الصرف (ر.س)':'Spend (SAR)',
  'الليدز':'Leads',
  'تكلفة الليد حسب المنصة (ر.س)':'Cost per lead by platform (SAR)',
  'تحليل الأداء':'Performance',
  'القمع: من الظهور إلى الليد':'Funnel: impressions to leads',
  'حصة كل منصة من الصرف ومن النتايج':'Each platform’s share of spend and results',
  'النتايج = الليدز والمحادثات. لما تكون حصة النتايج أكبر من حصة الصرف، المنصة تجيب أكثر من نصيبها.':'Results = leads and conversations. When a platform’s share of results beats its share of spend, it brings more than its share.',
  'لما تكون حصة الليدز أكبر من حصة الصرف، المنصة تجيب أكثر من نصيبها.':'When the lead share is higher than the spend share, the platform is pulling more than its weight.',
  'وتيرة الشهر الحالي وتوقع نهايته':'This month’s pace and month-end forecast',
  'التوقع = المعدل اليومي لهذا الشهر × عدد أيامه، وما يحسب اليوم الحالي لأنه ناقص.':'Forecast = this month’s daily average × its days. Today is left out because it is incomplete.',
  'تكلفة الليد حسب يوم الأسبوع':'Cost per lead by weekday',
  'الأغمق = الأغلى.':'Darker means more expensive.',
  'بطاقات الأقسام':'Department cards',
  'القسم × المنصة':'Department × platform',
  'الصرف · الليدز · تكلفة الليد':'Spend · leads · cost per lead',
  'المنصات':'Platforms',
  'الحملات':'Campaigns',
  'هدف تكلفة الليد':'Cost-per-lead target',
  'ر.س':'SAR',
  'تصدير Excel (CSV)':'Export Excel (CSV)',
  'اضغط على أي حملة عشان تفلتر اللوحة كاملة عليها.':'Click a campaign to filter the whole report.',
  'شهر بشهر':'Month by month',
  'الصرف والليدز وتكلفة الليد لكل منصة':'Spend, leads, and cost per lead by platform',
  'تفصيل هرمي':'Breakdown',
  'فتح الكل':'Expand all',
  'طي الكل':'Collapse all',
  'المنصة ◂ الحملة ◂ المجموعة ◂ الإعلان. اضغط على ▸ عشان تفتح المستوى اللي تحته.':'Platform ◂ campaign ◂ ad set ◂ ad. Click ▸ to open the level below.',
  'المواد الإعلانية':'Creatives',
  'وش يعني كل كرت؟':'What does each card mean?',
  'كل كرت = فكرة وحدة: نفس المادة الإعلانية مجمّعة من كل المنصات والحملات والنسخ (copy، spark…)، وأرقامه مجموعها. اضغط على الكرت عشان تشوف كل إعلان منها لحاله. تفاصيل كل إعلان موجودة في لوحة التحليلات.':'Each card = one idea: the same creative grouped across platforms, campaigns and copies (copy, spark…), with its numbers summed. Click the card to see each ad on its own. Per-ad detail lives in the analytics dashboard.',
  'متحمس تعرف؟ اضغط زر «عرض المادة الإعلانية» لمعرفته':'Curious? Press «View creative» to see it',
  'الكل':'All',
  'فعّال':'Active',
  'متوقف':'Paused',
  'ترتيب':'Sort',
  'الأعلى صرفاً':'Highest spend',
  'الأكثر نتائج (ليدز ومحادثات)':'Most results (leads and conversations)',
  'الأقل تكلفة لليد':'Lowest cost per lead',
  'الأعلى نسبة نقر':'Highest CTR',
  'الأكثر ظهوراً':'Most impressions',
  'عرض المزيد':'Show more',
  'كيف تنحسب الأرقام':'How the numbers are calculated',
  'تكلفة الليد':'Cost per lead',
  'صرف إعلانات الليدز فقط ÷ عدد الليدز.':'Spend on lead ads only ÷ number of leads.',
  'ميتا':'Meta',
  'فيسبوك وإنستغرام منفصلان، والدولار يُحسب بـ 3.75.':'Facebook and Instagram are separate. Dollars convert at 3.75.',
  'يتقسم حسب نوع الحملة. سناب وتيك توك كما هما.':'Split by campaign type. Snapchat and TikTok stay as they are.',
  'المقارنة':'Comparison',
  'الفترة السابقة بنفس عدد الأيام، بتوقيت الرياض.':'The previous period has the same number of days, in Riyadh time.',
  'تيك توك':'TikTok',
  'يأتي من فرع tiktok-data، والليد من حملات الليدز.':'Comes from the tiktok-data branch. Leads come from lead campaigns.',
  'المنشورات':'Posts',
  'الأحدث':'Newest',
  'الأكثر مشاهدة':'Most views',
  'الأعلى وصولاً':'Highest reach',
  'الأعلى نسبة تفاعل':'Highest engagement rate',
  'الأكثر إعجاباً':'Most likes',
  'الأكثر تعليقاً':'Most comments',
  'الأكثر مشاركة':'Most shares',
  'الأكثر حفظاً':'Most saves',
  'كيف تنحسب أرقام العضوي':'How organic numbers are calculated',
  'مشاهدات ووصول':'Views and reach',
  'من رؤى الصفحة والمنشور، والمتابعون رقم حالي.':'From page and post insights. Followers are the current count.',
  'نسبة التفاعل':'Engagement rate',
  'الإعجاب والتعليقات والمشاركات والحفظ ÷ الوصول.':'Likes, comments, shares, and saves ÷ reach.',
  'يُستنتج من نص المنشور، وحيوية الشعر ضمن المحاليل.':'Inferred from the post text. Hair vitality stays with IV drips.',
  'بانتظار':'Waiting',
  'إذا نقص المصدر تظهر جملة بما ينقص، ولا يتوقف سحب الإعلانات.':'If a source is missing, a short line says what is missing. The ads fetch keeps going.',
  'اليوم (جزئي)':'Today (partial)',
  'أمس':'Yesterday',
  '٧ أيام':'7 days',
  '١٤ يوم':'14 days',
  '٣٠ يوم':'30 days',
  'هذا الشهر':'This month',
  'الشهر الماضي':'Last month',
  'سنة':'Year',
  'كل الفترة':'All time',
  'كل المنصات':'All platforms',
  'كل الأقسام':'All departments',
  'فيسبوك':'Facebook',
  'إنستغرام':'Instagram',
  'ماسنجر':'Messenger',
  'سناب شات':'Snapchat',
  'جوجل · بحث':'Google · Search',
  'جوجل · أداء أقصى':'Google · Performance Max',
  'جوجل · شبكة العرض':'Google · Display',
  'جوجل · يوتيوب':'Google · YouTube',
  'جوجل · توليد الطلب':'Google · Demand Gen',
  'الصرف':'Spend',
  'الظهور':'Impressions',
  'النقرات':'Clicks',
  'محادثات':'Conversations',
  'محادثات واتساب وماسنجر':'WhatsApp and Messenger conversations',
  'نقرات الرابط والسوايب':'Link clicks and swipes',
  'نسبة النقر':'CTR',
  'تكلفة النقرة':'CPC',
  'تكلفة الألف ظهور':'CPM',
  'تكلفة المحادثة':'Cost per conversation',
  'المنصة':'Platform',
  'الحصة':'Share',
  'تكلفة الليد قبل':'Previous cost per lead',
  'إعلانات صرفت':'Ads with spend',
  'نشط / صرف':'Active / spending',
  'المجموع':'Total',
  'ليدز':'Leads',
  'شهر':'Month',
  'الاسم':'Name',
  'الإعلان':'Ad',
  'المجموعة':'Ad set',
  'الحالة':'Status',
  'القناة':'Channel',
  'جلسات':'Sessions',
  'مستخدمون':'Users',
  'مشاهدات':'Views',
  'وصول':'Reach',
  'إعجاب':'Likes',
  'تعليقات':'Comments',
  'مشاركات':'Shares',
  'حفظ':'Saves',
  'المتابعون الآن':'Followers now',
  'المشاهدات في الفترة':'Views in range',
  'الوصول في الفترة':'Reach in range',
  'التفاعل في الفترة':'Engagement in range',
  'المنشورات في الفترة':'Posts in range',
  'المستخدمون':'Users',
  'الجلسات':'Sessions',
  'مشاهدات الصفحات':'Page views',
  'بانتظار البيانات':'Waiting for data',
  'بانتظار تحديث':'Waiting for an update',
  'بانتظار بيانات المنشورات':'Waiting for posts',
  'بانتظار الصلاحية':'Awaiting permission',
  'مصادر ناقصة':'Missing sources',
  'إغلاق':'Close',
  'تحليلات المواد الإعلانية':'Creative analytics',
  'تحليلات المواد الإعلانية · Well':'Well creative analytics',
  'رجوع':'Back',
  'نشط':'Active',
  'بحث':'Search',
  'فيديو':'Video',
  'صورة':'Image',
  'أخرى':'Other',
  'ليدز':'Leads',
  'محادثات':'Conversations',
  'زيارات البروفايل':'Profile visits',
  'زيارات الموقع':'Website visits',
  '— لا مقارنة':'— no comparison',
  '● ثابت':'● flat',
  'عن الفترة السابقة':'vs previous period',
  'اليوم الحالي جزئي':'Today is partial',
  'الأرقام للإعلانات النشطة الآن فقط':'Numbers are for ads active now',
  'الأرقام للإعلانات المتوقفة فقط':'Numbers are for paused ads only',
  'عرض المادة الإعلانية':'View creative',
  'لا توجد فترة سابقة كاملة للمقارنة':'No full previous period to compare',
  'مقارنة بـ':'compared with',
  'الفترة:':'Range:',
  'يوم':'day',
  'فلترة على هذي المنصة':'Filter to this platform',
  'فلترة على هذي الحملة':'Filter to this campaign',
  'لا توجد بيانات.':'No data.',
  'لا توجد بيانات في هذه الفترة.':'No data in this range.',
  'ما فيه ليدز في هذي الفترة.':'No leads in this range.',
  'لا توجد مادة إعلانية تطابق الفلاتر في هذه الفترة.':'No creative matches the filters in this range.',
  'لا يوجد منشور يطابق البحث أو الفلاتر في هذه الفترة.':'No post matches the search or filters in this range.',
  'لا توجد حملات.':'No campaigns.',
  'لا توجد إعلانات صرفت.':'No ads with spend.',
  'مسح الكل':'Clear all',
  'آخر تحديث لميتا وسناب وجوجل:':'Last update for Meta, Snap, and Google:',
  'بتوقيت الرياض':'Riyadh time',
  'تيك توك: جاري التحميل…':'TikTok: loading…',
  'جاري تحميل تيك توك':'Loading TikTok',
  'تيك توك غير متاح':'TikTok is unavailable',
  'تحميل تيك توك':'Load TikTok',
  'مشاهدة الفيديو':'Watch video',
  'صفحة الهبوط':'Landing page',
  'فتح المنشور':'Open post',
  'فتح الحساب':'Open profile',
  'فتح في مدير الإعلانات':'Open in Ads Manager',
  'من اسم الإعلان':'from the ad name',
  'من اسم الحملة':'from the campaign name',
  'من نص المنشور':'from the post text',
  'افتراضي':'default',
  'كيف تنقسم الأقسام':'How departments are split',
  'براندينق':'Branding',
  'هذه حملات براندينق، وتبقى ضمن الحملات والمنصات بدون قسم.':'These are branding campaigns, kept within campaigns and platforms with no department.',
  'يحتاج توكن ميتا بصلاحيات المحتوى':'Needs a Meta token with content permissions',
  'يحتاج بيانات تيك توك العضوي':'Needs TikTok organic data',
  'يحتاج ربط تحليلات جوجل':'Needs Google Analytics connected',
  'ابحث باسم الإعلان أو الحملة':'Search by ad or campaign name',
  'ابحث في نص المنشور':'Search post text',
  'بحث':'Search',
  'بحث في المنشورات':'Search posts',
  'الفترة':'Range',
  'المنصة':'Platform',
  'نوع حملة جوجل':'Google campaign type',
  'حالة الإعلان':'Ad status',
  'حالة المواد الإعلانية':'Creative status',
  'التجميع':'Grouping',
  'الفلاتر':'Filters',
  'الملخص':'Summary',
  'صفحة القسم':'Department',
  'الحسابات':'Accounts',
  'ملاحظات البيانات':'Data notes',
  'تصنيف الأقسام':'Department rules',
  'طريقة حساب العضوي':'How organic numbers work',
  'الإعلانات أو العضوي':'Ads or organic',
  'Language':'Language',
  'النص لا يحدد القسم':'The text does not identify a department',
  'معاينة الفيديو':'Video preview',
  'الصرف اليومي':'Daily spend',
  'الليدز اليومية':'Daily leads',
  'الصرف اليومي للإعلان':'Daily spend for this ad',
  'تكلفة الليد حسب المنصة':'Cost per lead by platform',
  'الصرف اليومي في الفترة المختارة':'Daily spend in the selected range',
  'منشور':'Post',
  'تفاصيل':'Details',
  'نقرات':'Clicks',
  'الصرف اليومي':'Daily spend',
  'الصرف اليومي (ر.س)':'Daily spend (SAR)',
  'الصرف الأسبوعي (ر.س)':'Weekly spend (SAR)',
  'الصرف الشهري (ر.س)':'Monthly spend (SAR)',
  'الليدز اليومية':'Daily leads',
  'الليدز الأسبوعية':'Weekly leads',
  'الليدز الشهرية':'Monthly leads',
  'الليدز والمحادثات':'Leads and conversations',
  'مثلاً 15':'e.g. 15',
  'تعذّر تحديث':'Update failed',
  'بيانات تيك توك غير متوفرة':'TikTok data is unavailable',
  'المحادثات':'Conversations',
  'نسبة النقر %':'CTR %',
  'يناير':'January','فبراير':'February','مارس':'March','أبريل':'April','مايو':'May','يونيو':'June','يوليو':'July','أغسطس':'August','سبتمبر':'September','أكتوبر':'October','نوفمبر':'November','ديسمبر':'December',
  'الأحد':'Sunday','الاثنين':'Monday','الثلاثاء':'Tuesday','الأربعاء':'Wednesday','الخميس':'Thursday','الجمعة':'Friday','السبت':'Saturday',
  'آخر صرف':'Last spend',
  'صورة':'Image',
  'ملخص الحسابات':'Account summary',
  'صرف سابق':'Previous spend',
  'ليدز سابقة':'Previous leads',
  'تكلفة ليد سابقة':'Previous cost per lead',
  'مقارنة الفترة السابقة':'Previous period',
  'أفضل الإعلانات':'Top ads',
  'الشهر':'Month',
  'بحث نصي':'Text search',
  'أداء أقصى':'Performance Max',
  'توليد الطلب':'Demand Gen',
  'تسوق':'Shopping',
  'تطبيق':'App',
  'إعلان':'Ad'
};
function tr(s){
  if(LANG!=='en' || s==null) return s;
  const v=EN[s];
  return v==null?s:v;
}
function ui(ar,en){ return LANG==='en'?en:ar; }
function localizeRoot(root){
  if(!root) return;
  const walk=node=>{
    if(node.nodeType===1){
      const tag=node.tagName;
      if(tag==='SCRIPT'||tag==='STYLE') return;
      if(node.classList && (node.classList.contains('nm')||node.classList.contains('name'))) return;
      if(tag==='PRE' || node.id==='dlgTitle') return;
      if(tag==='OPTION' && node.value && node.parentElement && node.parentElement.id==='fCamp') return;
      for(const attr of ['placeholder','title','aria-label']){
        if(!node.hasAttribute(attr)) continue;
        const key='__src_'+attr;
        if(node[key]==null) node[key]=node.getAttribute(attr);
        const src=node[key];
        node.setAttribute(attr, LANG==='en'?(EN[src]||src):src);
      }
      for(const c of node.childNodes) walk(c);
      return;
    }
    if(node.nodeType!==3) return;
    if(node.__src==null) node.__src=node.nodeValue;
    const src=node.__src;
    if(LANG!=='en'){ node.nodeValue=src; return; }
    const core=src.trim();
    if(!core || !EN[core]) return;
    node.nodeValue=src.replace(core, EN[core]);
  };
  walk(root);
}
function localize(){
  const wrap=document.querySelector('.wrap');
  const lang=LANG==='en'?'en':'ar', dir=LANG==='en'?'ltr':'rtl';
  document.documentElement.lang=lang; document.documentElement.dir=dir;
  if(wrap){ wrap.dir=dir; wrap.lang=lang; }
  const title = CREATIVE_ONLY ? 'تحليلات المواد الإعلانية · Well' : 'لوحة إعلانات Well';
  document.title=LANG==='en'?EN[title]:title;
  const ht=document.getElementById('headTitle'); if(ht && CREATIVE_ONLY) ht.textContent = LANG==='en' ? EN['تحليلات المواد الإعلانية'] : 'تحليلات المواد الإعلانية';
  localizeRoot(wrap);
  localizeRoot(document.getElementById('dlg'));
  document.querySelectorAll('#lang button').forEach(b=>b.setAttribute('aria-pressed', b.dataset.v===LANG));
}
function syncLangUrl(){
  try{ localStorage.setItem('well-ads-lang', LANG); }catch(e){}
  const url=new URL(location.href);
  if(LANG==='en') url.searchParams.set('lang','en'); else url.searchParams.delete('lang');
  const next=url.pathname+url.search+url.hash;
  if(location.pathname+location.search+location.hash!==next) history.replaceState({lang:LANG}, '', next);
}
const DEP_EN={iv:'IV Drips', midwife:'Midwifery / Maternity', foot:'Foot Alignment', renan:'Renan Child Health'};
const PL_EN={facebook:'Facebook',instagram:'Instagram',messenger:'Messenger',threads:'Threads',meta:'Meta',snap:'Snapchat',tiktok:'TikTok',google:'Google',google_search:'Google · Search',google_pmax:'Google · Performance Max',google_display:'Google · Display',google_video:'Google · YouTube',google_demand_gen:'Google · Demand Gen',google_shopping:'Google · Shopping',google_app:'Google · App',google_smart:'Google · Smart',google_local:'Google · Local',google_hotel:'Google · Hotel',google_travel:'Google · Travel'};
const GOAL_EN={lead:'Leads',messages:'Conversations',profile:'Profile visits',traffic:'Website visits',other:'Other'};
function depName(k){
  if(!k || HIDDEN_DEPT.has(k) || !DEP[k]) return '';
  return LANG==='en' && DEP_EN[k] ? DEP_EN[k] : DEP[k].ar;
}
function platName(p){
  if(!p || HIDDEN_PLAT.has(p)) return '';
  if(LANG==='en' && PL_EN[p]) return PL_EN[p];
  return (PL[p]&&PL[p].ar) || '';
}
function goalName(g){
  if(LANG==='en' && GOAL_EN[g]) return GOAL_EN[g];
  return (D.goals||{})[g] || (LANG==='en'?'Other':'أخرى');
}
function money(){ return LANG==='en'?'SAR':'ر.س'; }
function pendingCopy(kind){
  if(kind==='tiktok') return LANG==='en'?EN['يحتاج بيانات تيك توك العضوي']:'يحتاج بيانات تيك توك العضوي';
  if(kind==='ga4') return LANG==='en'?EN['يحتاج ربط تحليلات جوجل']:'يحتاج ربط تحليلات جوجل';
  return LANG==='en'?EN['يحتاج توكن ميتا بصلاحيات المحتوى']:'يحتاج توكن ميتا بصلاحيات المحتوى';
}
// The main dashboard keeps its data in /dash.json (cached by the browser, revalidated with an ETag, warmed by the
// app's sidebar); department and creative pages still carry theirs inline.
const D = await (async () => {
  const t = document.getElementById('data').textContent.trim();
  if (t) return JSON.parse(t);
  const r = await fetch('/dash.json', { credentials: 'same-origin' });
  if (!r.ok) { document.getElementById('metaLine').textContent = 'ما قدرت أحمّل البيانات (' + r.status + '). حدّث الصفحة.'; throw new Error('dash.json ' + r.status); }
  return r.json();
})();
// Spring Rose0406 (شركة زهرة الربيع) حساب تيك توك منفصل: لا يُحسب في الصرف ولا التاريخ.
const TT_EXCLUDED_ID = '6948010864247046146';
function ttExcludedAccount(id, name){
  const n = String(name||'').replace(/\s+/g,' ').trim().toLowerCase();
  if(String(id||'')===TT_EXCLUDED_ID) return true;
  return n.includes('spring rose0406') || n.includes('زهرة الربيع');
}
function ttExcludedAd(a){
  if(!a || (a.platform && a.platform!=='tiktok')) return false;
  if(ttExcludedAccount(a.advertiser_id, a.advertiser_name||a.account)) return true;
  const blob = `${a.name||''} ${a.campaign||''} ${a.group||''} ${a.text||''} ${a.ad_name||''} ${a.campaign_name||''} ${a.adgroup_name||''} ${a.ad_text||''}`;
  return /spring\s*rose/i.test(blob) || blob.includes('زهرة الربيع') || /zr_nd96/i.test(blob) || /sr\s*\|\s*ios14/i.test(blob);
}
const ORG_FB_HIDDEN = new Set(['Well Home Care','Well Women Health']);
if(D.organic && Array.isArray(D.organic.facebook)){
  D.organic.facebook = D.organic.facebook.filter(p=>p && !ORG_FB_HIDDEN.has(p.name));
}
(function dropExcludedTikTok(){
  const gone = new Set();
  for(const [k,a] of Object.entries(D.ads||{})) if(ttExcludedAd(a)) gone.add(k);
  if(!gone.size) return;
  for(const k of gone) delete D.ads[k];
  if(Array.isArray(D.rows)) D.rows = D.rows.filter(r=>!gone.has(r[0]));
})();
const DEP_CFG = D.departments || {default:'brand', order:['iv','midwife','foot','renan','brand'], departments:{
  iv:{ar:'المحاليل الوريدية',color:'--d-iv'}, midwife:{ar:'القبالة / رعاية الحمل',color:'--d-midwife'}, foot:{ar:'تقويم القدم',color:'--d-foot'},
  renan:{ar:'رينان لصحة الطفل',color:'--d-renan'}, brand:{ar:'العلامة التجارية / الوعي',color:'--d-brand'}}, signals:[]};
const DEP = DEP_CFG.departments || {};
// واتساب وشبكة الجمهور يبقيان في الإجمالي بلا شريحة أو صف أو اسم. العلامة التجارية بلا قسم: تظهر كحملات داخل المنصة فقط.
const HIDDEN_PLAT = new Set(['audience_network','meta_whatsapp']);
const HIDDEN_DEPT = new Set(['brand']);
const DORDER = (DEP_CFG.order || Object.keys(DEP)).filter(k=>DEP[k] && !HIDDEN_DEPT.has(k));
const CH = (D.channels && D.channels.platforms) ? D.channels : {order:['facebook','instagram','messenger','snap','tiktok','google_search','google_pmax','google_display','google_video','google_demand_gen','google','meta'], platforms:{}};
const PL = {};
function syncPL(){
  for(const [k,v] of Object.entries(CH.platforms||{})) PL[k]={ar:v.ar,c:v.color||'--s-meta',family:v.family||k};
  const fallback={facebook:['فيسبوك','--s-fb','meta'],instagram:['إنستغرام','--s-ig','meta'],messenger:['ماسنجر','--s-msg','meta'],audience_network:['شبكة الجمهور','--s-an','meta'],threads:['ثريدز','--s-threads','meta'],meta:['ميتا','--s-meta','meta'],snap:['سناب شات','--s-snap','snap'],tiktok:['تيك توك','--s-tiktok','tiktok'],google:['جوجل','--s-google','google'],google_search:['جوجل · بحث','--s-gs','google'],google_pmax:['جوجل · أداء أقصى','--s-gp','google'],google_display:['جوجل · شبكة العرض','--s-gd','google'],google_video:['جوجل · يوتيوب','--s-gv','google'],google_demand_gen:['جوجل · توليد الطلب','--s-gg','google']};
  for(const [k,v] of Object.entries(fallback)) if(!PL[k]) PL[k]={ar:v[0],c:v[1],family:v[2]};
  for(const a of Object.values(D.ads||{})) if(a.platform && !PL[a.platform]) PL[a.platform]={ar:a.platform,c:'--s-google',family:a.family||a.platform};
}
syncPL();
let ORDER = [];
function refreshOrder(){
  const present=new Set(Object.values(D.ads||{}).map(a=>a.platform).filter(p=>p && !HIDDEN_PLAT.has(p)));
  ORDER=(CH.order||Object.keys(PL)).filter(p=>present.has(p));
  for(const p of present) if(!ORDER.includes(p)) ORDER.push(p);
}
const family = p => (PL[p]&&PL[p].family) || (String(p||'').startsWith('google')?'google':String(p||'').startsWith('meta')?'meta':p);
function classifyText(name, campaign){
  const hit = t => { const s=(t||'').toLowerCase(); for(const x of DEP_CFG.signals||[]){ try{ if(new RegExp(x.pattern).test(s)) return x.id; }catch(e){} } return null; };
  let s=hit(name); if(s) return [s,'ad'];
  s=hit(campaign); if(s) return [s,'campaign'];
  return [DEP_CFG.default||'brand','default'];
}
function cleanStatus(s){
  let t=String(s||'').replaceAll('ميزانية الحساب أو الحملة خلصت','حد صرف الحملة خلص').replaceAll('ميزانية المجموعة خلصت','حد صرف المجموعة خلص');
  if(/رصيد|سداد|مستحق|شحن|فوتر|فاتور|billing|unpaid|top-?up|payment|account balance/i.test(t)) return 'متوقف';
  return t;
}
function stamp(a){
  if(!a) return a;
  a.family = a.family || family(a.platform);
  if(a.status) a.status = cleanStatus(a.status);
  if(!a.dept){ const [d,src]=classifyText(a.name,a.campaign); a.dept=d; a.dsrc=src; }
  return a;
}
const depCell = k => (DEP[k] && !HIDDEN_DEPT.has(k)) ? `<span class="pill"><span class="dot" style="background:var(${DEP[k].color})"></span>${depName(k)}</span>` : '';
const sar2 = n => n==null||!isFinite(n) ? '—' : fmt(n,2);
const $ = s => document.querySelector(s);
const fmt = (n,d=0) => n==null||!isFinite(n) ? '—' : n.toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d});
const qty = n => { if(n==null||!isFinite(n)) return '—'; const r=Math.round(n*100)/100; return Math.abs(r-Math.round(r))<1e-9 ? fmt(r,0) : fmt(r,2); };
const sar = n => n==null ? '—' : fmt(n, n<100?2:0);
const pct = n => n==null||!isFinite(n) ? '—' : fmt(n,2)+'%';
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

