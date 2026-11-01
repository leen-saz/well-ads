# الموديولات

كل تاب في نظام الإيجنتس موديول مستقل. المطوّر يشتغل على موديوله بس، بدون ما يلمس الباقي.

## ملفات الموديول
| المكان | وش فيه |
|---|---|
| `src/modules/<key>/module.ts` | الاسم بالعربي والإنجليزي، الأيقونة، المجموعة، الحالة (`live` / `soon`)، ووش يسوي |
| `src/modules/<key>/routes.ts` | الـ API: `/api/<key>/<action>` |
| `src/modules/<key>/*.ts` | منطق الموديول |
| `src/modules/<key>/Page.astro` | الصفحة (`/<key>/`)، و`src/pages/<key>/index.astro` سطرين يستوردها بس |
| `public/modules/<key>/client.js` | سكربت الصفحة (`export default async function mount()`) |
| `src/modules/<key>/<key>.test.ts` | التستات |
| `supabase/migrations/NNN_<key>.sql` | جداول الموديول، وكل جدول فيه `company_id` |

## موديول جديد
1. مجلد `src/modules/<key>/` فيه `module.ts` بحالة `soon`، وسطر في `src/modules/registry.ts`.
2. لما يجهز: `status: 'live'`، و`routes.ts`، وسطر في `src/modules/routes.ts`، والصفحة والسكربت.
3. الصلاحيات والقائمة الجانبية والقفل لكل شركة تشتغل لحالها من السجل.

## القواعد
- كل استعلام يمر على `scoped()` (`src/lib/tenant.ts`): بيانات كل شركة معزولة.
- القراءة `requireUser(request, e, '<key>')`، والكتابة `{ write: true }`.
- الشركة تقدر تقفل أي موديول من الإعدادات ← الموديولات، والمقفل يرجع 403 حتى للمالكة.
- أي تنفيذ حساس له وضعين: يدوي (بموافقة) أو تلقائي (مع تنبيه).
