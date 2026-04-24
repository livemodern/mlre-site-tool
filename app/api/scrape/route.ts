import { NextRequest, NextResponse } from 'next/server';
import { scrapeImages } from '@/lib/scraper';
import type { ScrapeRequest } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: ScrapeRequest;
  try {
    body = (await req.json()) as ScrapeRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.urls) || body.urls.length === 0) {
    return NextResponse.json(
      { error: 'urls must be a non-empty array of source URLs' },
      { status: 400 },
    );
  }

  // Cap to keep total scrape under the 30s function budget (Pro plan)
  const urls = body.urls.slice(0, 15);

  try {
    const result = await scrapeImages(urls);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
