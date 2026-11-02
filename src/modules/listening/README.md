# الرصد (listening)

Social listening: what people say about Well and its competitors, by keyword, from public sources, with a sentiment and a short Arabic reason for each mention.

- **Watch lists** (`listen_watch`, migration 013): our brand, competitors (name, keywords, handles, website), alert keywords. Edited on the page.
- **Sources**: Google News RSS and Reddit search (free, no key); YouTube Data API (`YOUTUBE_API_KEY`, free quota); X through Grok (`XAI_API_KEY`, optional and paid per use). Instagram, Facebook and TikTok do not allow public keyword search; TikTok comes through the pipeline's MCP sign-in instead.
- **Mentions** (`listen_mentions`): deduped by URL per company. Each watch is fetched at most once a day: the 5-minute cron takes one due watch per tick, and "Refresh now" takes up to 3.
- **Sentiment**: Workers AI, one call for up to 20 unscored mentions.
- **Page**: share of voice (us vs each competitor, with the sentiment mix), our sentiment over 8 weeks, latest mentions with filters, alerts (negative share up 15 points week on week, or an alert keyword mentioned), Meta Ad Library link per competitor.
- **Second tab**: engagement on our own organic posts and the weekly CRM demand signal (the original version of this module).

Without migration 013 the page shows the SQL to run and everything else keeps working.
