import * as cheerio from 'cheerio';
import type { ScrapedImage } from './types';

const USER_AGENT =
  'Mozilla/5.0 (compatible; ModernLivingImageBot/1.0; +https://modernliving.example)';

const BAD_FILENAME_PATTERNS = [
  /logo/i,
  /icon/i,
  /favicon/i,
  /sprite/i,
  /avatar/i,
  /headshot/i,
  /agent/i,
  /team/i,
  /floor[_-]?plan/i,
  /floorplan/i,
  /site[_-]?plan/i,
  /map/i,
  /google[_-]?map/i,
  /badge/i,
  /pixel\.(gif|png)/i,
  /spacer/i,
  /tracking/i,
  /1x1/i,
];

/** Extensions we care about */
const VALID_EXT = /\.(jpe?g|png|webp|avif)(\?|$|#)/i;

export interface ScrapeResult {
  images: ScrapedImage[];
  warnings: string[];
}

/**
 * Scrape image URLs from a list of source pages.
 * - Pulls from <img src>, <img srcset>, <source srcset>, <link rel=image_src>,
 *   og:image / twitter:image meta tags, data-* lazy attrs, inline style
 *   backgrounds, and anchor hrefs pointing to images.
 * - Filters out obvious icons, logos, floor plans.
 */
export async function scrapeImages(urls: string[]): Promise<ScrapeResult> {
  const warnings: string[] = [];
  const all: ScrapedImage[] = [];
  const seen = new Set<string>();

  for (const rawUrl of urls) {
    const pageUrl = rawUrl.trim();
    if (!pageUrl) continue;

    try {
      const res = await fetch(pageUrl, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
        redirect: 'follow',
        // 12s per page — on Pro plan we have a 30s function budget
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        warnings.push(`HTTP ${res.status} from ${pageUrl}`);
        continue;
      }
      const html = await res.text();
      const found = extractFromHtml(html, pageUrl);

      // Warn if the page looks JS-rendered (almost no images but has React/Next markers)
      if (
        found.length === 0 &&
        /__NEXT_DATA__|data-reactroot|__NUXT__/.test(html)
      ) {
        warnings.push(
          `${pageUrl} looks JS-rendered — no images found in static HTML. Try a developer CDN URL directly, a /media/ page, or paste individual image URLs.`,
        );
      }

      for (const img of found) {
        if (seen.has(img.fingerprint)) continue;
        seen.add(img.fingerprint);
        all.push(img);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to fetch ${pageUrl}: ${msg}`);
    }
  }

  return { images: all, warnings };
}

/* ------------------------------------------------------------------ */
/*  Extraction                                                        */
/* ------------------------------------------------------------------ */

function extractFromHtml(html: string, baseUrl: string): ScrapedImage[] {
  const $ = cheerio.load(html);
  const candidates = new Map<string, { url: string; alt?: string; width?: number; height?: number }>();

  const add = (raw: string | undefined, alt?: string, width?: number, height?: number) => {
    if (!raw) return;
    const absolute = safeResolve(raw, baseUrl);
    if (!absolute) return;
    if (!looksLikeImage(absolute)) return;
    if (isJunkImage(absolute)) return;
    const key = normalizeForDedup(absolute);
    const existing = candidates.get(key);
    if (!existing || (width && height && (existing.width ?? 0) < width)) {
      candidates.set(key, { url: absolute, alt, width, height });
    }
  };

  // Open Graph / Twitter meta images (usually the hero)
  $('meta[property="og:image"], meta[name="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"], meta[name="twitter:image:src"], link[rel="image_src"]').each(
    (_, el) => {
      const url = $(el).attr('content') ?? $(el).attr('href');
      add(url, 'Open Graph image');
    },
  );

  // <img> tags — handle src and all common lazy-load attributes
  $('img').each((_, el) => {
    const $el = $(el);
    const alt = $el.attr('alt') ?? undefined;
    const w = parseNum($el.attr('width'));
    const h = parseNum($el.attr('height'));

    const candidates = [
      $el.attr('src'),
      $el.attr('data-src'),
      $el.attr('data-lazy-src'),
      $el.attr('data-original'),
      $el.attr('data-hi-res-src'),
      $el.attr('data-fallback-src'),
    ];
    for (const c of candidates) add(c, alt, w, h);

    // srcset: pick the widest descriptor
    const srcset = $el.attr('srcset') ?? $el.attr('data-srcset');
    if (srcset) add(pickWidestFromSrcset(srcset), alt, w, h);
  });

  // <source srcset> inside <picture>
  $('source').each((_, el) => {
    const srcset = $(el).attr('srcset');
    if (srcset) add(pickWidestFromSrcset(srcset));
  });

  // Anchor tags that link directly to images (gallery lightboxes)
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (href && looksLikeImage(href)) add(href, $(el).attr('title') ?? undefined);
  });

  // Inline CSS background-image
  $('[style*="background"]').each((_, el) => {
    const style = $(el).attr('style') ?? '';
    const m = style.match(/background(?:-image)?\s*:\s*url\((['"]?)([^'")]+)\1\)/i);
    if (m) add(m[2]);
  });

  // <style> blocks background-image
  $('style').each((_, el) => {
    const css = $(el).text();
    const re = /url\((['"]?)([^'")]+\.(?:jpe?g|png|webp|avif)[^'")]*)\1\)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) add(m[2]);
  });

  // Build ScrapedImage results
  const results: ScrapedImage[] = [];
  for (const c of candidates.values()) {
    const w = c.width;
    const h = c.height;
    const isLikelyHero =
      (w !== undefined && w >= 1400) ||
      (c.url && /(hero|banner|cover|og-image|og_image)/i.test(c.url));
    results.push({
      url: c.url,
      sourcePage: baseUrl,
      altText: c.alt,
      width: w,
      height: h,
      fingerprint: normalizeForDedup(c.url),
      isLikelyHero: Boolean(isLikelyHero),
      suggestedDescriptor: guessDescriptor(c.url, c.alt),
    });
  }
  return results;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function safeResolve(raw: string, base: string): string | null {
  try {
    // Handle protocol-relative URLs
    if (raw.startsWith('//')) return 'https:' + raw;
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

function looksLikeImage(url: string): boolean {
  // Either a recognized extension, or a CDN URL with image hints in path
  if (VALID_EXT.test(url)) return true;
  if (/\/images?\//i.test(url) && !/\.(svg|gif)(\?|$|#)/i.test(url)) return true;
  if (/(cloudinary|imgix|akamaihd|cloudfront|wp-content\/uploads|cdn\.)/i.test(url))
    return true;
  return false;
}

function isJunkImage(url: string): boolean {
  if (/\.(svg|gif)(\?|$|#)/i.test(url)) return true; // svg is almost always a logo/icon
  return BAD_FILENAME_PATTERNS.some((re) => re.test(url));
}

function normalizeForDedup(url: string): string {
  // Strip common CDN resize query params so the same image at different sizes
  // is detected as a duplicate.
  try {
    const u = new URL(url);
    ['w', 'h', 'width', 'height', 'q', 'quality', 'fit', 'auto', 'fm', 'dpr'].forEach((p) =>
      u.searchParams.delete(p),
    );
    // Strip imgix-style path params like /image.jpg?w=500 handled above; also handle
    // path-embedded dimensions on WP: image-1024x768.jpg -> image.jpg
    u.pathname = u.pathname.replace(/-\d+x\d+(\.\w+)$/i, '$1');
    return u.origin + u.pathname; // ignore all query for fingerprint
  } catch {
    return url;
  }
}

function parseNum(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function pickWidestFromSrcset(srcset: string): string | undefined {
  const parts = srcset.split(',').map((s) => s.trim());
  let best: { url: string; width: number } | undefined;
  for (const p of parts) {
    const m = p.match(/^(\S+)\s+(\d+)(w|x)?$/);
    if (!m) continue;
    const w = parseInt(m[2], 10) * (m[3] === 'x' ? 1000 : 1);
    if (!best || w > best.width) best = { url: m[1], width: w };
  }
  return best?.url ?? parts[0]?.split(/\s+/)[0];
}

/** Heuristic descriptor guess from URL path + alt text */
function guessDescriptor(url: string, alt?: string): string | undefined {
  const hay = `${url} ${alt ?? ''}`.toLowerCase();
  const rules: [RegExp, string][] = [
    [/\b(aerial|drone|birds[-_ ]?eye)\b/, 'exterior-aerial'],
    [/\b(pool|cabana|sundeck)\b/, 'pool'],
    [/\b(lobby|reception|entry|entrance)\b/, 'lobby'],
    [/\b(gym|fitness|workout)\b/, 'fitness-center'],
    [/\b(spa|sauna|steam|wellness)\b/, 'spa'],
    [/\b(kitchen|culinary)\b/, 'kitchen'],
    [/\b(primary[-_ ]?suite|master[-_ ]?suite|primary[-_ ]?bedroom)\b/, 'primary-bedroom'],
    [/\b(bedroom)\b/, 'bedroom'],
    [/\b(bath(room)?|powder)\b/, 'bathroom'],
    [/\b(dining|restaurant)\b/, 'dining-room'],
    [/\b(bar|cocktail|lounge)\b/, 'lounge'],
    [/\b(clubroom|club[-_ ]?room|social[-_ ]?room)\b/, 'clubroom'],
    [/\b(amenity|amenities|deck|rooftop|terrace)\b/, 'amenity-deck'],
    [/\b(courtyard|garden|green[-_ ]?space)\b/, 'courtyard'],
    [/\b(oceanfront|waterfront)\b/, 'waterfront-view'],
    [/\b(intracoastal)\b/, 'intracoastal-view'],
    [/\b(skyline|cityscape)\b/, 'skyline-view'],
    [/\b(view|vista)\b/, 'waterfront-view'],
    [/\b(living[-_ ]?room)\b/, 'living-room'],
    [/\b(residence|unit|interior)\b/, 'living-room'],
    [/\b(night)\b/, 'night-exterior'],
    [/\b(hero|cover|banner|exterior|facade|building)\b/, 'exterior'],
  ];
  for (const [re, desc] of rules) if (re.test(hay)) return desc;
  return undefined;
}
