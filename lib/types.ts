export type ImageLabel =
  | 'condos'
  | 'exterior'
  | 'aerial'
  | 'pool'
  | 'lobby'
  | 'gym'
  | 'view'
  | 'residence'
  | 'kitchen'
  | 'amenity-deck'
  | 'clubroom'
  | 'spa'
  | 'dining'
  | 'bar'
  | 'courtyard'
  | 'bedroom'
  | 'bathroom'
  | 'lounge'
  | 'other';

export const IMAGE_LABELS: ImageLabel[] = [
  'condos',
  'exterior',
  'aerial',
  'pool',
  'lobby',
  'gym',
  'view',
  'residence',
  'kitchen',
  'amenity-deck',
  'clubroom',
  'spa',
  'dining',
  'bar',
  'courtyard',
  'bedroom',
  'bathroom',
  'lounge',
  'other',
];

export interface ScrapedImage {
  /** Original source URL of the image */
  url: string;
  /** Source page the image came from */
  sourcePage: string;
  /** alt attribute if present on the page */
  altText?: string;
  /** Width/height if available from HTML attributes */
  width?: number;
  /** Width/height if available from HTML attributes */
  height?: number;
  /** Perceptual-ish fingerprint for duplicate detection (URL-based) */
  fingerprint: string;
  /** Estimated file size if reported by Content-Length header */
  estimatedSize?: number;
  /** Whether the image looks promising (large enough, not an icon) */
  isLikelyHero: boolean;
  /** Heuristic label guess based on alt text / filename */
  suggestedLabel?: ImageLabel;
}

export interface ScrapeRequest {
  urls: string[];
}

export interface ScrapeResponse {
  images: ScrapedImage[];
  warnings: string[];
}

export interface ProcessRequest {
  imageUrl: string;
  communityName: string;
  city: string;
  label: ImageLabel;
  variant: 'hero' | 'standard';
  /** Optional index if there are multiple images with the same label (view-1, view-2) */
  index?: number;
}

export interface ProcessResponse {
  filename: string;
  mimeType: 'image/webp';
  width: number;
  height: number;
  byteLength: number;
  altText: string;
  /** Base64-encoded binary */
  data: string;
}

export interface ManifestRow {
  filename: string;
  originalUrl: string;
  width: number;
  height: number;
  fileSize: number;
  label: string;
  altText: string;
  variant: 'hero' | 'standard';
}
