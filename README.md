# Modern Living Image Prep

A web-based tool for preparing community page images: scrape source URLs, crop to Modern Living specs (hero 2560×895 / standard 566×500), compress + convert to WebP, rename using the SEO format `[community]-[descriptor]-[city].webp`, and export a ZIP with manifest and alt text.

## What it does

1. You enter a **community name**, **city**, and a list of **source URLs** (developer / building / community pages).
2. The server scrapes images from those pages — HTML `<img>`, `<source>` srcsets, Open Graph / Twitter cards, lazy-load attributes, anchor links to images, and CSS backgrounds. It filters out obvious junk (logos, floor-plan thumbs, tracking pixels, SVGs).
3. You get a **review grid**: pick your hero, (un)check images, fix labels (`pool`, `lobby`, `gym`, `view`, …), see duplicate warnings.
4. The server processes each image individually with Sharp (resize + attention-based smart crop + WebP encode + metadata strip).
5. The browser assembles everything into a ZIP:

   ```
   community-name-images.zip
   ├── hero/
   │   └── community-name-condos-city.webp      (2560×895)
   ├── gallery/
   │   ├── community-name-pool-city.webp        (566×500)
   │   ├── community-name-lobby-city.webp
   │   ├── community-name-view-1-city.webp
   │   └── community-name-view-2-city.webp
   ├── manifest.csv
   └── alt-text.txt
   ```

The hero is auto-named with the `condos` descriptor per the Modern Living special-rule (unless you explicitly chose `aerial` or `exterior`). Repeat labels get `-1`, `-2`, etc. suffixes automatically.

## Project structure

```
app/
  layout.tsx, page.tsx, globals.css     # UI (client)
  api/scrape/route.ts                   # URL → image list
  api/process/route.ts                  # image URL → WebP binary
lib/
  scraper.ts                            # Cheerio HTML parsing + heuristics
  image-processor.ts                    # Sharp resize/crop/encode
  seo.ts                                # slug, filename, alt text, label indices
  types.ts                              # shared TypeScript types
next.config.js, vercel.json, tsconfig.json, tailwind.config.js, postcss.config.js
```

## Local development

```bash
npm install
npm run dev
# open http://localhost:3000
```

Requires **Node.js 20+** (Sharp needs the native binary). On Apple Silicon and Linux x64 this Just Works™ — Sharp ships prebuilt binaries for both.

## Deploying to Vercel — what you need to set up

1. **Push to GitHub.** Create a new repo and push these files.
2. **Create a Vercel project.** New Project → Import Git Repository → select the repo. Leave framework as "Next.js" (auto-detected). No environment variables required. Deploy.

That's the whole setup. No database, no blob storage, no external APIs needed in the default configuration.

### Function tuning (Pro plan defaults)

The defaults in `vercel.json` are tuned for **Vercel Pro**:

- `scrape` endpoint: 30s timeout, 1 GB memory
- `process` endpoint: 60s timeout, 3 GB memory (Sharp needs headroom for large source images)

These give plenty of room for real-estate photography pipelines — a typical 8K developer hero image decodes to ~500 MB in memory before Sharp resizes it, so the 3 GB allocation matters. Per-page scrape timeout is 12s and per-image download timeout is 20s, both well inside the function budgets. Client-side concurrency is 5, so a 20-image gallery processes in ~4 waves.

If you ever want to run this on Hobby (free) instead, lower both `maxDuration` values to `10` in `vercel.json` and reduce `CONCURRENCY` in `app/page.tsx` to `3`. It'll still work for moderately-sized source images.

### Known limitations and when to upgrade

| Limitation | Workaround |
|---|---|
| **JS-rendered pages** (React SPAs with no SSR, dynamic galleries) return no images. | The UI warns you when this is detected. For now, point the tool at developer CDN URLs or `/media` / `/gallery` pages that render server-side. To fully support JS rendering, add [Browserless.io](https://www.browserless.io/) (~$5/mo) or Vercel's [@sparticuz/chromium](https://github.com/Sparticuz/chromium) — I can wire this up if you want. |
| **Manual image upload** is present in the UI but not piped through processing. | Add a third API route `/api/process-upload` that accepts multipart form data, runs Sharp on the uploaded buffer, and returns the same `ProcessResponse`. |
| **Perceptual duplicate detection** is URL-based (same CDN path at different sizes → detected). True pixel-similarity detection would need server-side hashing. | Good enough for most cases. Add `sharp-phash` on the server if you need true visual dedup. |
| **Copyright** — scraping third-party sites produces images that may be copyrighted. | The UI shows a copyright notice on the review screen. Legal responsibility for use is on the operator. |
| **Alt text is template-based**, not AI-generated. | Add `ANTHROPIC_API_KEY` as an env var and swap `buildAltText` in `lib/seo.ts` for a Claude API call. Costs pennies per batch. |

### Optional: Vercel Blob for large batches

If you ever want to process 50+ images in one go and skip client-side ZIP assembly (browser memory), add [Vercel Blob](https://vercel.com/storage/blob):

1. Vercel dashboard → Storage → Create → Blob → link to project (auto-populates `BLOB_READ_WRITE_TOKEN`).
2. Change the `/api/process` route to write each WebP to Blob instead of returning base64.
3. Add a new `/api/zip` route that streams blobs into an archive with `archiver` and returns a signed URL.

Not needed for the default workflow.

## SEO filename rules (implemented)

- Lowercase, hyphenated, no special characters.
- Format: `[community]-[descriptor]-[city].webp`
- Hero image: descriptor is `condos` (unless user picked `aerial` / `exterior` explicitly).
- Repeat labels get numeric suffixes: `view-1`, `view-2`, etc.
- Apostrophes are stripped without adding a hyphen (so "Maison d'Or" → `maison-dor`, not `maison-d-or`).

## Alt-text rules (implemented)

Template-based, matches the examples in the spec:

- `pool` → `"<Community> resort-style pool in <City>"`
- `gym` → `"<Community> fitness center amenity in <City>"`
- `condos` → `"<Community> condos in <City> exterior view"`
- …and so on. Full map is in `lib/seo.ts`.

## Security notes

- The scraper sends a descriptive User-Agent and respects redirects.
- No robots.txt enforcement — you should be the rights holder or have permission for any site you target.
- No authentication; if you deploy this publicly, protect it with [Vercel Password Protection](https://vercel.com/docs/deployment-protection) or add a simple auth middleware.
