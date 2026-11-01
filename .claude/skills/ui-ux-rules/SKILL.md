---
name: ui-ux-rules
description: UI/UX rule set for building, reviewing or fixing any interface in this repo (dashboard template, Astro pages, app.css). Accessibility, touch targets, layout, typography and colour, motion, forms, navigation and charts, ranked by priority, plus a pre-delivery checklist.
---

# UI/UX rules

From UI/UX Pro Max by Next Level Builder (MIT, see LICENSE; upstream https://github.com/nextlevelbuilder/ui-ux-pro-max-skill). Only the rule references are vendored here, not the search scripts or data.

Work through the categories in priority order and check the work against them before you call it done:

1. Accessibility (critical): text contrast 4.5:1, visible keyboard focus, labels on icon-only buttons, reduced motion respected.
2. Touch and interaction (critical): targets at least 44×44 px on touch, 8 px between targets, loading feedback, nothing hover-only.
3. Performance: reserve space for async content (no layout shift), lazy-load below the fold.
4. Style: one style applied consistently; vector icons, never emoji as icons.
5. Layout and responsive: mobile first, no horizontal page scroll, no fixed pixel containers.
6. Typography and colour: 16 px body, line height about 1.5, semantic colour tokens instead of raw hex.
7. Motion: timing that fits the distance and meaning; no animating width or height.
8. Forms and feedback: visible labels, errors next to the field.
9. Navigation: the current page is visibly marked, back works, the URL reflects the view.
10. Charts: legends, tooltips, never colour alone.

For the full rules read `references/quick-reference.md`. For the pre-delivery checklist read `references/pro-rules.md`.

Well's own rules come first: keep the brand fonts (Thmanyah) and the Well logo, use the palette in `public/assets/app.css`, keep the glass layer as built (blur only on large containers, solid fallback under prefers-reduced-transparency), and take screenshots at 1440 px and 390 px before opening a PR.
