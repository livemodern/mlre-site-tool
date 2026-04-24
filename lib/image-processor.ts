import sharp from 'sharp';

const USER_AGENT =
  'Mozilla/5.0 (compatible; ModernLivingImageBot/1.0; +https://modernliving.example)';

export interface ProcessOptions {
  imageUrl: string;
  variant: 'hero' | 'standard';
}

export interface ProcessResult {
  buffer: Buffer;
  width: number;
  height: number;
}

const TARGETS = {
  hero: { width: 2560, height: 895 },
  standard: { width: 566, height: 500 },
};

/**
 * Download an image and process it to the Modern Living target dimensions:
 *   - Hero: 2560 x 895 (wide)
 *   - Standard: 566 x 500
 *
 * Uses Sharp's "cover" fit with attention-based cropping, which automatically
 * finds the most visually salient region — this avoids decapitating buildings,
 * cropping out pools, etc. better than a naive center crop.
 *
 * Output is WebP with strip-metadata enabled.
 */
export async function processImage(opts: ProcessOptions): Promise<ProcessResult> {
  const res = await fetch(opts.imageUrl, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*' },
    redirect: 'follow',
    // 20s — big 8K source images from developer CDNs can be slow to deliver
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  const input = Buffer.from(arrayBuf);

  const { width, height } = TARGETS[opts.variant];

  // Quality tuned for web: hero gets slightly higher quality since it's the
  // focal image; standard gets more aggressive compression.
  const quality = opts.variant === 'hero' ? 82 : 78;

  // Sharp strips metadata by default — do NOT call withMetadata() or EXIF/ICC
  // profiles will be re-embedded. .rotate() above bakes orientation into pixels.
  const buffer = await sharp(input, { failOn: 'none' })
    .rotate() // respect EXIF orientation before stripping metadata
    .resize(width, height, {
      fit: 'cover',
      position: sharp.strategy.attention,
      withoutEnlargement: false,
    })
    .webp({
      quality,
      effort: 4, // encoding effort: 0-6. 4 is a good quality/speed balance for serverless
      smartSubsample: true,
    })
    .toBuffer();

  return { buffer, width, height };
}
