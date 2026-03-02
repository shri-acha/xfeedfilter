
# xfeedfilter — Firefox Extension

A Firefox extension that uses AI to filter your X feed based on custom keywords. Irrelevant tweets are hidden automatically as you scroll.

---

## Features

- **Semantic filtering** — AI understands meaning, not just exact words. The keyword "AI" will match tweets about "machine learning", "LLMs", "neural networks", etc.
- **Exact match mode** — pure client-side substring matching, no API calls needed
- **Batched API calls** — tweets are queued and sent in groups of 10 to stay within free-tier rate limits
- **Smart caching** — each unique tweet is only classified once per session
- **Rate limit handling** — automatically backs off and retries when the API returns 429
- **Survives React re-renders** — uses CSS attribute selectors instead of inline styles, so X's virtual DOM can't undo the filtering
- **Two AI providers** — supports both Google Gemini and OpenAI

