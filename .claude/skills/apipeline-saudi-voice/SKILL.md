---
name: apipeline-saudi-voice
description: House voice for Apipeline public pages (landing, company profile, security, ads, social). Saudi white dialect for headlines and short lines, light MSA for proof, FAQ and anything legal or regulated. Use whenever writing or reviewing Arabic copy for Apipeline or its clients, including "اكتب نص", "صياغة سعودية", "كوبي", "لاندنق", "بروفايل", "محتوى سعودي".
---

# Apipeline: the Saudi voice

Built on the vendored skills `arabic-copywriting-craft` (one idea, one benefit, honest proof, one action),
`arabic-copywriting-dialects` (dialect is high-risk copy: keep claims in light MSA) and `arabic-ready` (RTL QA).
This file is the house layer on top of them.

## Who we talk to

Saudi founders, marketing managers and CTOs. Busy, numerate, allergic to agency talk.
They read on a phone between meetings. Write for that.

## The register: two layers

| Layer | Where | Sounds like |
| --- | --- | --- |
| **Saudi white dialect** (اللهجة البيضاء) | Hero, section titles, buttons, short promises | «الأرقام تتكلم. والقرار لك.» · «وش يصير بعد ما توافق؟» |
| **Light MSA** | Proof, process detail, FAQ, security scope, anything legal, health or financial | «نوثّق كل ثغرة بخطوات إعادة إنتاجها ودرجة خطورتها.» |

Never mix the two inside one sentence. A dialect title can sit over an MSA paragraph.

## Saudi words we use, and the ones we avoid

| Use | Not |
| --- | --- |
| وش، ليش، كذا، يمديك، ما يحتاج، على طول، لحاله، يطلع لك | شو، ليه، هيك، إزاي، دلوقتي (Levantine / Egyptian) |
| نقترح، نراجع، تعتمد | نضمن لك، أفضل، الأول في المملكة، رقم ١ |
| ليد، كرييتف، داشبورد (as the market says them) | translating every term into stiff MSA («عميل محتمل مؤهل تسويقيًا») |
| ريال، ر.س | $ or "dollar" |

Mixed Arabic-English terms are fine when that is what the Saudi buyer says (Meta، Google، ليدز). Brand and platform names stay Latin.

## Rules that do not bend

1. **No claim without proof on the page.** No superlatives, no testimonials, no client logos, no numbers we cannot show.
   Demo numbers carry the label «بيانات تجريبية».
2. **MOH and platform rules** (health clients): no cure or result promises, no before/after. The compliance agent flags; a human approves.
3. **Security copy**: never promise «حماية ١٠٠٪» or «اختراق مستحيل». Promise process: scope, test, evidence, fix, retest.
   Name frameworks we map to (OWASP, NCA ECC, PDPL) without claiming certification we do not hold.
4. **One CTA per section**, a verb the reader does: «اطلب فحص», «جرّب اللوحة», «حمّل البروفايل».
5. **Numbers**: Arabic-Indic digits in Arabic body copy (٨٤٠ ر.س), Latin in code and dashboards. Percent as ٪.
6. **Respect**: no fear selling, no religious or national symbols as decoration, no gendered assumptions; address the reader in the masculine-neutral default the market uses, or restructure to avoid gender.

## Shape of a section

```
Eyebrow (2–4 words, dialect)      → «كيف يشتغل»
Title (one idea, ≤ 9 words)       → «دورة وحدة تمشي كل ساعة»
Body (≤ 2 lines, light MSA ok)    → what happens + what the reader keeps control of
Proof (thing on screen, not adjective)
CTA (one verb)
```

## Review before shipping

- Read it out loud as a Riyadh founder would. Anything that sounds translated gets rewritten, not polished.
- Check every Arabic string has its English pair in `public/assets/i18n-en-site.js` (the language switch).
- Screenshot RTL at 375px and 1280px (`arabic-ready` → references/web.md).
- Copy that targets a paid campaign or a regulated sector is `draft/native_review_required` until a Saudi reviewer signs it off.
