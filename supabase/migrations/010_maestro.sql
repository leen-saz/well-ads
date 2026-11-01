-- 010: المايسترو = Paperclip. كل شركة عندنا لها شركة في Paperclip (إيجنتس، مهام، ميزانية، موافقات).
alter table public.companies add column if not exists paperclip_company_id text;
