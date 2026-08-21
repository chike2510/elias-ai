# Web-search diagnosis — 2026-08-21

## Reproduced production query
Prompt: Use live web search to verify whether Hull City vs Manchester United has an official competitive fixture scheduled for tomorrow, August 22, 2026. Do not rely on memory. Return the current date and time used, the exact fixture date if one exists, competition, venue, source URLs, and a short confidence note.

Production response incorrectly stated:
- Current verification date/time: 2024-06-13 14:28 UTC.
- No fixture exists for August 22, 2026.
- It claimed fixtures were not published and recommended checking June 2026.
- It said search results were irrelevant dictionary pages.

Browser performance resources for the reproduced chat included `/api/chat` but no `/api/web/search` or `/api/web/open` call. This indicates the normal chat path did not invoke a separate web-search endpoint during the response.

## Independent current evidence
1. Manchester United official fixture article: https://www.manutd.com/en/news/key-manchester-united-dates-in-august-2026
   - States: Premier League matchday one, Saturday 22 August — Hull City (A, Premier League).
   - Describes United’s campaign starting away at Hull City on the opening weekend.

2. ESPN match preview: https://www.espn.co.uk/football/story/_/id/49671843/hull-city-vs-manchester-united-2026-27-premier-league-tv-channel-how-watch-kick-live-stream-referee-injury-predicted-lineups
   - States Hull City host Manchester United in the 2026-27 Premier League opener.
   - Date: Saturday Aug 22; UK kickoff 12:30 p.m. BST.
   - Venue: MKM Stadium, Kingston upon Hull.

3. Sky Sports fixture page: https://www.skysports.com/football-scores-fixtures/2026-08-22
   - Search result states Hull City are scheduled to play Manchester United on Saturday 22 August.

4. Search result dated Aug 20, 2026: https://sports.yahoo.com/articles/preview-hull-city-vs-manchester-114000290.html
   - Describes Hull City hosting Manchester United on Saturday for round one of the Premier League.

## Conclusion
The web search capability is not reliable in the normal `/api/chat` route. The reproduced answer used a stale internal date and did not surface current evidence, while independent current sources confirm the fixture exists. The route’s `allowedTools` includes `web.search`, but the production request did not visibly invoke `/api/web/search`; investigate `runElias` tool execution/dispatch and date injection before claiming live search works.
