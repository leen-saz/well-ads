# قوالب إيميلات الدخول (Supabase)

**ليش؟** رابط الإيميل الافتراضي يُستهلك بمجرد فتحه، وماسحات الإيميل (Gmail، Outlook، معاينة الروابط) تفتحه قبل الشخص، فتطلع صفحة «هذا الرابط انتهى».
القوالب الجديدة تحط `token_hash` في رابط للوحة نفسها. الصفحة ما تستهلكه عند الفتح، بس عند ضغط «احفظ».

## الخطوات (تسويها Leen في Supabase)

1. **Authentication → URL Configuration**
   - **Site URL**: `https://well-ads.pages.dev`
   - **Redirect URLs**: أضف `https://well-ads.pages.dev/**`
2. **Authentication → Emails → Templates → Reset password**: الصق الموضوع والمحتوى تحت (قالب 1) واحفظ.
3. **Authentication → Emails → Templates → Invite user**: الصق قالب 2 واحفظ.
4. **Authentication → Providers → Email**: خلّ **Email OTP Expiration** على `86400` (24 ساعة).
5. (موصى به) **Authentication → Emails → SMTP Settings**: فعّل SMTP مخصص (مثل Resend). السيرفر الافتراضي من Supabase محدود جداً بعدد الإيميلات بالساعة، وإذا انتهى الحد ما يوصل أي إيميل (`over_email_send_rate_limit`). اللوحة ترد دائماً «انرسل» عشان ما تكشف الحسابات، لكنها تسجل السبب في سجل النشاط تحت `password_reset_email_failed` وفي لوقات السيرفر.

> الروابط القديمة (اللي انرسلت قبل التغيير) تظل تشتغل لو ما انتهت.

## قالب 1: Reset password

**الموضوع:** `باسوورد جديد لحسابك في Well`

```html
<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.7;color:#1c1c1c">
  <h2 style="margin:0 0 12px">Well</h2>
  <p>طلبت باسوورد جديد لحسابك.</p>
  <p><a href="{{ .SiteURL }}/reset/?token_hash={{ .TokenHash }}&type=recovery"
        style="display:inline-block;background:#1c1c1c;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none">حدد الباسوورد الجديد</a></p>
  <p style="color:#666;font-size:14px">الرابط صالح 24 ساعة. إذا ما طلبته، تجاهل الرسالة.</p>
</div>
```

نص بديل (Plain text، إن طلبه Supabase):

```text
Well
طلبت باسوورد جديد لحسابك. افتح الرابط وحدده:
{{ .SiteURL }}/reset/?token_hash={{ .TokenHash }}&type=recovery
الرابط صالح 24 ساعة. إذا ما طلبته، تجاهل الرسالة.
```

## قالب 2: Invite user

**الموضوع:** `دعوة لحسابك في Well`

```html
<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.7;color:#1c1c1c">
  <h2 style="margin:0 0 12px">Well</h2>
  <p>انضفت لوحة Well. حدد باسووردك وادخل.</p>
  <p><a href="{{ .SiteURL }}/reset/?token_hash={{ .TokenHash }}&type=invite"
        style="display:inline-block;background:#1c1c1c;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none">حدد الباسوورد</a></p>
  <p style="color:#666;font-size:14px">الرابط صالح 24 ساعة.</p>
</div>
```

نص بديل:

```text
Well
انضفت لوحة Well. حدد باسووردك وادخل:
{{ .SiteURL }}/reset/?token_hash={{ .TokenHash }}&type=invite
الرابط صالح 24 ساعة.
```

## كيف يشتغل

- `/reset/?token_hash=…&type=recovery|invite` يعرض النموذج بدون أي طلب للسيرفر، والعنوان ينظف فوراً (`history.replaceState`).
- عند «احفظ»: `POST /api/auth/reset` بـ `{token_hash, type, password}` ← السيرفر يتحقق من الباسوورد أولاً (الضعيف ما يستهلك الرابط)، ثم `POST /auth/v1/verify`، ثم `PUT /auth/v1/user`.
- `type` لازم يكون `recovery` أو `invite` بالضبط.
