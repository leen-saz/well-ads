# الرصد (listening)

Social listening: what people say about Well and its competitors, by keyword, from public sources, with a sentiment and a short Arabic reason for each mention.

- **Watch lists** (`listen_watch`, migration 013): our brand, competitors (name, keywords, handles, website), alert keywords. Edited on the page.
- **Sources**: news from Google News RSS, one quoted term per request (an OR of rare terms gives 0 there), or Bing News RSS the same way when Google gives nothing (both free, no key, both answer from Cloudflare; GDELT answers 429 there, so it is in the sources check only); Reddit search with a free "script" app (`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`: Reddit answers 403 to anonymous searches from servers); YouTube Data API (`YOUTUBE_API_KEY`, free quota); X through Grok's live X search (`XAI_API_KEY`, optional and **paid** per use: tokens plus each post fetched; `src/lib/llm.ts` `grokSearch`, never falls back to a model without search). With the key, Grok also scores the sentiment; without it Workers AI does. Instagram, Facebook and TikTok do not allow public keyword search; TikTok comes through the pipeline's MCP sign-in instead.
- **Sources check**: `GET /api/listening/probe` (open on staging, owner only on production; Actions > listening-probe runs it) fetches a sample watch with the free sources and each news source alone with a term that always has news, and shows the count or the refusal per source. Writes nothing.
- **Failures**: "Refresh now" says which source refused and with what status (e.g. Google 503), instead of an empty list.
- **Mentions** (`listen_mentions`): deduped by URL per company. Each watch is fetched at most once a day: the 5-minute cron takes one due watch per tick, and "Refresh now" takes the due watches whose outside calls fit 45 of the 50 subrequests a Worker request may make, at most 3 (`batch` in fetcher.ts). News searches the name and up to 4 keywords, one request each.
- **Sentiment**: Workers AI, one call for up to 20 unscored mentions.
- **Page**: share of voice (us vs each competitor, with the sentiment mix), our sentiment over 8 weeks, latest mentions with filters, alerts (negative share up 15 points week on week, or an alert keyword mentioned), Meta Ad Library link per competitor.
- **Second tab**: engagement on our own organic posts and the weekly CRM demand signal (the original version of this module).

Without migration 013 the page shows the SQL to run and everything else keeps working.
