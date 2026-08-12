# ELIAS architecture

Browser
  -> Next.js UI
  -> /api/chat or /api/research
  -> provider router
  -> configured OpenAI-compatible provider
  -> response

Provider routing is server-side. The browser never sees provider API keys.

Project files are currently local-first for the prototype:
  - code editing uses localStorage
  - ZIP generation runs in the browser

A production agent should move files into object storage + a database and give the server controlled tools for:
  - list/read/write/patch
  - git operations
  - tests/builds in a sandbox
  - web search
  - document extraction
