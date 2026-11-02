-- 014: المعرفة. اللي يتعلمه الذكاء الاصطناعي من الشركة نفسها: صوت العلامة، الخدمات والأسعار، الادعاءات المعتمدة،
-- الكلمات والادعاءات الممنوعة، إعلانات نجحت، مراجع كتّاب ومنافسين نقلّد أسلوبهم، وملاحظات حرة. كل موديول ذكاء اصطناعي يقرا الفعّال منها قبل ما يكتب.
-- modules فاضي = لكل الموديولات. الإيقاف بدل الحذف عشان يبقى السجل.
-- source: manual = من النموذج، training = جواب في شات التدريب (topic = موضوع السؤال، question = السؤال نفسه).
create table if not exists public.knowledge (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  kind text not null check (kind in ('voice', 'service', 'claim', 'forbidden', 'winner', 'reference', 'note')),
  title text not null default '',
  body text not null,
  price numeric,
  modules text[] not null default '{}',
  active boolean not null default true,
  source text not null default 'manual' check (source in ('manual', 'training')),
  topic text,
  question text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists knowledge_company_idx on public.knowledge (company_id, active, kind);
alter table public.knowledge enable row level security;
revoke all on public.knowledge from anon, authenticated;
