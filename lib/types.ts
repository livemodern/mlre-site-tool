export type Category =
  | 'HERO'
  | 'AMENITY'
  | 'FEATURE'
  | 'EXTERIOR'
  | 'INTERIOR'
  | 'FLOORPLAN'
  | 'LISTING'
  | 'LIFESTYLE'
  | 'GALLERY';

export const CATEGORIES: Category[] = [
  'HERO',
  'AMENITY',
  'FEATURE',
  'EXTERIOR',
  'INTERIOR',
  'FLOORPLAN',
  'LISTING',
  'LIFESTYLE',
  'GALLERY',
];

/**
 * Common descriptors for the dropdown. Free-text is also allowed via the
 * "custom..." override field. Each implies a Category (see inferCategory).
 */
export const COMMON_DESCRIPTORS: string[] = [
  'pool',
  'pool-aerial',
  'lap-pool',
  'rooftop-pool',
  'lobby',
  'lobby-interior',
  'entrance',
  'gym',
  'fitness-center',
  'spa',
  'spa-treatment-room',
  'kitchen',
  'kitchen-interior',
  'primary-bedroom',
  'bedroom',
  'bathroom',
  'primary-bathroom',
  'living-room',
  'dining-room',
  'private-dining-room',
  'bar',
  'lounge',
  'clubroom',
  'amenity-deck',
  'rooftop',
  'courtyard',
  'terrace',
  'waterfront-view',
  'skyline-view',
  'oceanfront-view',
  'intracoastal-view',
  'exterior',
  'exterior-aerial',
  'building-facade',
  'night-exterior',
];

export interface ScrapedImage {
  url: string;
  sourcePage: string;
  altText?: string;
  width?: number;
  height?: number;
  fingerprint: string;
  estimatedSize?: number;
  isLikelyHero: boolean;
  /** Heuristic descriptor guess based on alt text / filename */
  suggestedDescriptor?: string;
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
  state?: string;
  address?: string;
  category: Category;
  descriptor?: string;
  /** For duplicate descriptors, append -1, -2... */
  index?: number;
  /** For floorplans */
  unitId?: string;
  beds?: string;
  baths?: string;
  sqft?: string;
  variant: 'hero' | 'standard';
}

export interface ProcessResponse {
  filename: string;
  mimeType: 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
  byteLength: number;
  altText: string;
  data: string;
}

export interface ManifestRow {
  filename: string;
  originalUrl: string;
  width: number;
  height: number;
  fileSize: number;
  category: Category;
  descriptor: string;
  altText: string;
  variant: 'hero' | 'standard';
}
