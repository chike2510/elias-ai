# Four standalone product idea previews

These four app experiences are separate Next.js routes in the existing ELIAS codebase; `/` and the current ELIAS task/chat behavior are unchanged.

- `/outfit` — sample closet, manual wardrobe additions, rule-based combinations, and saved looks. The current preview does not call an AI styling model.
- `/museum` — a small, ad-free collection with room filters, saved works, and short original wall notes. All four selected images are labelled public domain by their Commons file records; three works are also marked `is_public_domain: true` in the Art Institute of Chicago API. See [`public/idea-apps/artworks/credits.md`](../public/idea-apps/artworks/credits.md).
- `/budget` — sample transactions, manual expense entry, editable category limits, and a simple savings goal. No bank connection or financial account data is requested.
- `/screenshots` — import only the images a user selects, store image blobs and organizer details in browser IndexedDB, and search names, notes, categories, and tags locally. There is no cloud upload or OCR in this preview.

Outfit, budget, and museum preferences use browser local storage. Screenshot images and metadata remain in IndexedDB on the current browser. Clearing that browser's site data clears these local records. These are early validation prototypes, not evidence of demand or revenue.

## Run and verify

From the repository root:

```bash
npm install
npm run dev
```

Then open `http://localhost:3000/outfit`, `/museum`, `/budget`, or `/screenshots`. Existing verification commands also cover the new routes:

```bash
npm run typecheck
npm test
npm run build
```

No new environment variables, services, database, build configuration, or deployment behavior are required.
