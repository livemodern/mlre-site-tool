import { NextRequest, NextResponse } from 'next/server';
import { processImage } from '@/lib/image-processor';
import { buildAltText, buildFilename } from '@/lib/seo';
import type { ProcessRequest, ProcessResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: ProcessRequest;
  try {
    body = (await req.json()) as ProcessRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { imageUrl, communityName, city, label, variant, index } = body;

  if (!imageUrl || !communityName || !city || !label || !variant) {
    return NextResponse.json(
      {
        error:
          'Missing required fields. Need imageUrl, communityName, city, label, variant.',
      },
      { status: 400 },
    );
  }

  try {
    const { buffer, width, height } = await processImage({ imageUrl, variant });
    const filename = buildFilename({ communityName, city, label, index });
    const altText = buildAltText({ communityName, city, label, variant });

    const response: ProcessResponse = {
      filename,
      mimeType: 'image/webp',
      width,
      height,
      byteLength: buffer.byteLength,
      altText,
      data: buffer.toString('base64'),
    };
    return NextResponse.json(response);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to process ${imageUrl}: ${msg}` },
      { status: 500 },
    );
  }
}
