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

/**
 * Download an image and process it:
 *
 * - HERO:     cover-cropped to 2560x895 with CENTER positioning. Center is
 *             used (rather than sharp.strategy.attention) because attention-
 *             based cropping sometimes latches onto a bright reflection or
 *             person and produces an unpredictable slice. For a hero banner,
 *             the user pre-selected the image, so we trust the natural center.
 *
 * - STANDARD: resize so the LONGEST side equals 566px, preserving aspect
 *             ratio. No cropping. Landscape photos end up 566 wide; portraits
 *             end up 566 tall. Images smaller than 566 on every side are left
 *             alone (withoutEnlargement: true).
 *
 * Output is always WebP with EXIF/metadata stripped.
 */
export async function processImage(opts: ProcessOptions): Promise<ProcessResult> {
  const res = await fetch(opts.imageUrl, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  const input = Buffer.from(arrayBuf);

  let pipeline = sharp(input, { failOn: 'none' }).rotate(); // bake in EXIF orientation

  if (opts.variant === 'hero') {
    pipeline = pipeline.resize(2560, 895, {
      fit: 'cover',
      position: 'center',
      withoutEnlargement: false,
    });
  } else {
    // Longest side = 566, preserve aspect ratio, no crop
    pipeline = pipeline.resize({
      width: 566,
      height: 566,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  const quality = opts.variant === 'hero' ? 82 : 80;

  const buffer = await pipeline
    .webp({ quality, effort: 4, smartSubsample: true })
    .toBuffer();

  // Read back the final dimensions (variable for standard variant)
  const meta = await sharp(buffer).metadata();
  return { buffer, width: meta.width ?? 0, height: meta.height ?? 0 };
}
