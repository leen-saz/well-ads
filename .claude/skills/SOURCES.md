# Skills in this repo

Project skills Claude Code loads from `.claude/skills/`. Third-party skills are vendored **Markdown only**: no scripts, binaries or assets were copied, and each folder keeps its upstream LICENSE. Pulled 2026-11-09.

## Web design and scroll storytelling

| Skill | Upstream | Licence | Commit |
| --- | --- | --- | --- |
| `gsap-core` | [greensock/gsap-skills](https://github.com/greensock/gsap-skills/tree/aed9cfd/skills/gsap-core) | MIT | `aed9cfd` |
| `gsap-scrolltrigger` | [greensock/gsap-skills](https://github.com/greensock/gsap-skills/tree/aed9cfd/skills/gsap-scrolltrigger) | MIT | `aed9cfd` |
| `gsap-timeline` | [greensock/gsap-skills](https://github.com/greensock/gsap-skills/tree/aed9cfd/skills/gsap-timeline) | MIT | `aed9cfd` |
| `gsap-performance` | [greensock/gsap-skills](https://github.com/greensock/gsap-skills/tree/aed9cfd/skills/gsap-performance) | MIT | `aed9cfd` |
| `gsap-plugins` | [greensock/gsap-skills](https://github.com/greensock/gsap-skills/tree/aed9cfd/skills/gsap-plugins) | MIT | `aed9cfd` |
| `gsap-utils` | [greensock/gsap-skills](https://github.com/greensock/gsap-skills/tree/aed9cfd/skills/gsap-utils) | MIT | `aed9cfd` |
| `gsap-frameworks` | [greensock/gsap-skills](https://github.com/greensock/gsap-skills/tree/aed9cfd/skills/gsap-frameworks) | MIT | `aed9cfd` |
| `gsap-react` | [greensock/gsap-skills](https://github.com/greensock/gsap-skills/tree/aed9cfd/skills/gsap-react) | MIT | `aed9cfd` |
| `scroll-experience` | [omer-metin/skills-for-antigravity](https://github.com/omer-metin/skills-for-antigravity/tree/e8dcf4e/skills/scroll-experience) | Apache-2.0 | `e8dcf4e` |
| `web-design-scroll-story` | [xiaopu-ai/web-design](https://github.com/xiaopu-ai/web-design/tree/22a4f48/.) | MIT | `22a4f48` |
| `silk-design` | [bendrape1-byte/silk-design](https://github.com/bendrape1-byte/silk-design/tree/0f530f0/.) | MIT | `0f530f0` |
| `taste-gpt` | [tasteskill/tasteskill](https://github.com/tasteskill/tasteskill/tree/37c8c37/tasteskill/gpt-taste) | MIT | `37c8c37` |
| `taste-minimalist` | [tasteskill/tasteskill](https://github.com/tasteskill/tasteskill/tree/37c8c37/tasteskill/minimalist) | MIT | `37c8c37` |

## Arabic and Saudi copy

| Skill | Upstream | Licence | Commit |
| --- | --- | --- | --- |
| `arabic-copywriting-dialects` | [ArabAgentSkills/Skills](https://github.com/ArabAgentSkills/Skills/tree/8b97dcf/skills/arabic-copywriting-dialects) | MIT | `8b97dcf` |
| `arabic-ad-copy` | [salmandev/arabic-skills-library](https://github.com/salmandev/arabic-skills-library/tree/8e94cd0/skills/media/arabic-ad-copy) | MIT | `8e94cd0` |
| `arabic-social-post` | [salmandev/arabic-skills-library](https://github.com/salmandev/arabic-skills-library/tree/8e94cd0/skills/media/arabic-social-post) | MIT | `8e94cd0` |
| `arabic-content-writer` | [vantaflow/claude-skills-collection](https://github.com/vantaflow/claude-skills-collection/tree/f88a34d/arabic-skills/arabic-content-writer) | MIT | `f88a34d` |
| `arabic-ready` | [jubyuhanna-create/arabic-ready](https://github.com/jubyuhanna-create/arabic-ready/tree/3e1ebb5/skills/arabic-ready) | MIT | `3e1ebb5` |
| `arabic-uiux-master` | [theonlym7md/arabic-ai-skills](https://github.com/theonlym7md/arabic-ai-skills/tree/3bb721b/skills/arabic-uiux-master) | MIT | `3bb721b` |
| `arabic-copywriting-craft` | [specailm5/arabic-copywriting-skill](https://github.com/specailm5/arabic-copywriting-skill/tree/d3ea951/.claude/skills/arabic-copywriting-skill) | MIT | `d3ea951` |
| `arabic-copy-arabkit` | [asasemahmed/arabkit](https://github.com/asasemahmed/arabkit/tree/e980db3/shared/skills/arabic-copy) | MIT | `e980db3` |

## Our own

| Skill | What |
| --- | --- |
| `apipeline-saudi-voice` | House voice for Apipeline public pages: Saudi white dialect for titles, light MSA for proof; no unproven claims. Read this first for any Arabic copy. |
| `frontend-design`, `ui-ux-rules` | Already in the repo before this pull. |

## Left out on purpose

- `pbakaus/impeccable` (Apache-2.0): its first run downloads and executes a binary.
- `salmandev/arabic-skills-library` → `arabic-saudi-dialect`, `arabic-copywriting`: empty templates upstream ("اكتب هنا فقرة…").
- `xiaopu-ai/web-design` → `references/design-systems/`: copies of other brands' identities; not something we build from.
- Repos with no licence (`openai/plugins`, `paulirish/dotfiles`, `Hadeer0Mohamed/haderyaat-skills`) were not copied.

To refresh one: re-clone the upstream at a newer commit, copy only `*.md` + `LICENSE`, read the diff before committing.
