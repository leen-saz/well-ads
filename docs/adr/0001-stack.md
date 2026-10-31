# ADR-0001: التركيبة — Astro + Hono على Cloudflare Workers

**الحالة:** مقترح · 2026-10-31

**السياق:** الواجهة اليوم HTML يدوي (`template.html` 2,395 سطر) وموجّه API وبوابة مكتوبة يدوي على Vercel. الاستراتيجية (`eng-policies`) تفترض Cloudflare Workers للواجهة والـ API.

**القرار:** Astro للصفحات (TypeScript، قطع تفاعلية) و Hono للـ API والبوابة، في Worker واحد على Cloudflare. Astro مملوك لـ Cloudflare من يناير 2026 وباقي مفتوح المصدر (MIT).

**البدائل:** Next.js (أثقل ويحتاج محوّل OpenNext)، Retool (مدفوع ويحبس)، Refine (React للوحات الإدارة، أقرب لـ admin panels من لوحات بيانات).

**الأثر:** إعادة كتابة الواجهة صفحة صفحة (المراحل 2 إلى 6)، والموقع الحالي يبقى لين التحويل.
