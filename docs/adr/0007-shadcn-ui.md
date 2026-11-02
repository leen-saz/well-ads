# ADR-0007: shadcn/ui (React + Tailwind) للقطع التفاعلية

**الحالة:** معتمد · 2026-11-02 · طلب لين: "نظفه بالكامل ثم ركبه".

**السياق:** الجداول والرسوم في اللوحة مكتوبة يدوي. قالب shadcn [dashboard-01](https://ui.shadcn.com/blocks#dashboard-01) فيه جدول (TanStack Table) فيه ترتيب وفلترة وصفحات، ورسوم تفاعلية (Recharts)، وكروت أرقام، مجانية ومفتوحة المصدر (MIT)، وتدعم العربي من يناير 2026.

**القرار:**
- React كقطع تفاعلية داخل Astro (`@astrojs/react`)، بس للصفحات اللي تحتاجها. باقي الصفحات تبقى بدون React.
- مكوّنات shadcn في `src/components/ui/`، بكلاسات منطقية (`ms-`/`pe-`/`start-`) للعربي، و`components.json` فيه `rtl: true`.
- Tailwind v4 في `src/styles/ui.css` بس: ألوان وِل بمتغيرات `--ui-*` (ما تتعارض مع `app.css`)، وبدون preflight، ويتحمّل في صفحات shadcn بس.
- أول تاب: «نظرة عامة» (`src/modules/overview/`).

**البدائل:** نكمل HTML يدوي (أبطأ ويتكرر)، أو React للموقع كامل (أثقل، ويتعارض مع المرحلة 4).

**الأثر:** حجم JavaScript أكبر في الصفحات اللي تستخدمه بس. أي مكوّن جديد: `npx shadcn@latest add <name>` وبعدها نتأكد إن الكلاسات منطقية.
