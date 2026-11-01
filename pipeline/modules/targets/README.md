# targets

تكلفة الليد المستهدفة لكل منصة.

- **يقرا:** `config/targets.json` (هدف مكتوب)، و`data.json` (لحساب متوسط 30 يوم إذا ما فيه هدف).
- **يرجع:** `compute(data)` ← `{platform: {cpl, source}}`، والمصدر `written` أو `avg30`.
- **يستخدمه:** `suggest` و`critic`. والمصدر ينكتب مع كل اقتراح ويطلع في اللوحة.
