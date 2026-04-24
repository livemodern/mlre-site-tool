import type { ImageLabel } from './types';

/**
 * Convert any string to a clean, lowercase, hyphenated slug.
 * - Removes diacritics
 * - Strips special characters
 * - Collapses whitespace and hyphens
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/['’`]/g, '') // drop apostrophes without adding a hyphen
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Build the SEO filename in the required format:
 *   [community-name]-[descriptor]-[city].webp
 *
 * For multiple images with the same label, append `-N` (view-1, view-2, ...).
 * The special "condos" label is applied by the caller (usually the hero / aerial image).
 */
export function buildFilename(opts: {
  communityName: string;
  city: string;
  label: ImageLabel;
  index?: number;
}): string {
  const community = slugify(opts.communityName);
  const city = slugify(opts.city);
  const descriptor =
    opts.index !== undefined && opts.index > 0
      ? `${opts.label}-${opts.index}`
      : opts.label;
  return `${community}-${descriptor}-${city}.webp`;
}

/**
 * Build SEO-friendly alt text.
 * Example: "Cityplace South Tower resort-style pool in West Palm Beach"
 */
export function buildAltText(opts: {
  communityName: string;
  city: string;
  label: ImageLabel;
  variant: 'hero' | 'standard';
}): string {
  const { communityName, city, label, variant } = opts;
  const phrases: Record<ImageLabel, string> = {
    condos: `${communityName} condos in ${city} exterior view`,
    exterior: `${communityName} building exterior in ${city}`,
    aerial: `${communityName} aerial view in ${city}`,
    pool: `${communityName} resort-style pool in ${city}`,
    lobby: `${communityName} lobby in ${city}`,
    gym: `${communityName} fitness center amenity in ${city}`,
    view: `${communityName} waterfront view from residence in ${city}`,
    residence: `${communityName} residence interior in ${city}`,
    kitchen: `${communityName} residence kitchen in ${city}`,
    'amenity-deck': `${communityName} amenity deck in ${city}`,
    clubroom: `${communityName} resident clubroom in ${city}`,
    spa: `${communityName} spa amenity in ${city}`,
    dining: `${communityName} dining room in ${city}`,
    bar: `${communityName} bar and lounge in ${city}`,
    courtyard: `${communityName} courtyard in ${city}`,
    bedroom: `${communityName} residence bedroom in ${city}`,
    bathroom: `${communityName} residence bathroom in ${city}`,
    lounge: `${communityName} resident lounge in ${city}`,
    other: `${communityName} in ${city}`,
  };
  const base = phrases[label];
  if (variant === 'hero' && label !== 'condos') {
    return `${communityName} condos in ${city} — ${base}`;
  }
  return base;
}

/**
 * Given a list of labels being assigned, compute the per-label index
 * so repeated labels become view-1, view-2, etc.
 *
 * Returns indices aligned to the input array. Unique labels get index 0 (no suffix).
 */
export function computeLabelIndices(labels: ImageLabel[]): number[] {
  const counts: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const l of labels) totals[l] = (totals[l] || 0) + 1;

  const result: number[] = [];
  for (const l of labels) {
    if (totals[l] === 1) {
      result.push(0);
    } else {
      counts[l] = (counts[l] || 0) + 1;
      result.push(counts[l]);
    }
  }
  return result;
}
