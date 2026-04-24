import type { Category } from './types';

/* -------------------------------------------------------------- */
/*  Slug helpers                                                   */
/* -------------------------------------------------------------- */

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
 * Normalize a building name for use in filenames per Modern Living SEO spec:
 *   1. Lowercase
 *   2. Strip leading article: "The Bristol Palm Beach" -> "bristol palm beach"
 *   3. Strip city tokens that would duplicate the city suffix:
 *        "bristol palm beach" + city "West Palm Beach" -> "bristol"
 *        "olara west palm beach" + city "West Palm Beach" -> "olara"
 *   4. Replace spaces with hyphens
 *
 * The city never appears inside the normalized building name; it is appended
 * once by the filename builders that need it (HERO, FEATURE).
 */
export function normalizeBuildingName(rawName: string, city: string): string {
  let slug = slugify(rawName).replace(/^the-/, '');

  const citySlug = slugify(city);
  const cityTokens = citySlug.split('-').filter(Boolean);

  // Remove a full consecutive run of city tokens wherever it appears
  if (cityTokens.length > 0) {
    const parts = slug.split('-');
    for (let i = 0; i <= parts.length - cityTokens.length; i++) {
      if (
        parts
          .slice(i, i + cityTokens.length)
          .every((p, j) => p === cityTokens[j])
      ) {
        parts.splice(i, cityTokens.length);
        break;
      }
    }
    slug = parts.filter(Boolean).join('-');
  }

  // Also strip trailing "palm-beach" if the city is "west-palm-beach" — this
  // handles "Bristol Palm Beach" + city "West Palm Beach" -> "bristol".
  // Only do this when the city ends with the trailing fragment.
  const trailingFragments = ['palm-beach', 'beach'];
  for (const frag of trailingFragments) {
    if (citySlug.endsWith(frag) && slug.endsWith('-' + frag)) {
      slug = slug.slice(0, slug.length - frag.length - 1);
    } else if (citySlug.endsWith(frag) && slug === frag) {
      slug = '';
    }
  }

  return slug || slugify(rawName); // fallback: never return empty
}

/**
 * Title-case a hyphenated slug for FLOORPLAN filenames.
 *   "bristol" -> "Bristol"
 *   "cityplace-south-tower" -> "Cityplace-South-Tower"
 *   "b-floors-5-17" -> "B-Floors-5-17"
 */
export function titleCaseSlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join('-');
}

/* -------------------------------------------------------------- */
/*  Category inference                                             */
/* -------------------------------------------------------------- */

/**
 * Infer a Category from a free-text descriptor slug. The HERO category is
 * never inferred — it is set explicitly when the user picks a hero image.
 */
export function inferCategory(descriptor: string | undefined): Category {
  if (!descriptor) return 'GALLERY';
  const d = descriptor.toLowerCase();

  if (/floor\s*plan|floorplan/.test(d)) return 'FLOORPLAN';
  if (/\b(aerial|exterior|facade|building|night-exterior)\b/.test(d)) {
    return 'EXTERIOR';
  }
  if (/\b(kitchen|bedroom|bathroom|living|dining|residence|interior|primary)\b/.test(d)) {
    return 'INTERIOR';
  }
  if (/\b(pool|gym|fitness|spa|lobby|entrance|amenity|rooftop|courtyard|terrace|bar|lounge|clubroom|club-room|deck|sauna)\b/.test(d)) {
    return 'AMENITY';
  }
  if (/\b(view|skyline|oceanfront|waterfront|intracoastal|vista|sunset|neighborhood)\b/.test(d)) {
    return 'LIFESTYLE';
  }
  return 'GALLERY';
}

/* -------------------------------------------------------------- */
/*  Filename builder                                               */
/* -------------------------------------------------------------- */

export interface FilenameOpts {
  communityName: string;
  city: string;
  category: Category;
  /** Required for all non-HERO/FEATURE categories */
  descriptor?: string;
  /** For duplicate descriptors: "pool", "pool-2", "pool-3" */
  index?: number;
  /** For FLOORPLAN only */
  unitId?: string;
}

export function buildFilename(opts: FilenameOpts): string {
  const building = normalizeBuildingName(opts.communityName, opts.city);
  const citySlug = slugify(opts.city);

  switch (opts.category) {
    case 'HERO':
      return `${building}-${citySlug}-hero.webp`;

    case 'FEATURE':
      return `${building}-${citySlug}-feature.webp`;

    case 'FLOORPLAN': {
      const unitSlug = opts.unitId ? slugify(opts.unitId) : 'unit';
      const bTC = titleCaseSlug(building);
      const uTC = titleCaseSlug(unitSlug);
      return `${bTC}-Floorplan-${uTC}.jpeg`;
    }

    case 'AMENITY':
    case 'EXTERIOR':
    case 'INTERIOR':
    case 'GALLERY':
    case 'LIFESTYLE':
    case 'LISTING':
    default: {
      const rawDesc = opts.descriptor?.trim();
      const descSlug = rawDesc ? slugify(rawDesc) : 'photo';
      const withIndex =
        opts.index !== undefined && opts.index > 0
          ? `${descSlug}-${opts.index}`
          : descSlug;
      return `${building}-${withIndex}.webp`;
    }
  }
}

/* -------------------------------------------------------------- */
/*  Alt text builder                                               */
/* -------------------------------------------------------------- */

export interface AltTextOpts {
  /** Display name, e.g. "The Bristol Palm Beach" or "CityPlace South Tower" */
  communityName: string;
  city: string;
  state?: string;
  address?: string;
  category: Category;
  descriptor?: string;
  unitId?: string;
  beds?: string;
  baths?: string;
  sqft?: string;
}

export function buildAltText(opts: AltTextOpts): string {
  const b = opts.communityName.trim();
  const city = opts.city.trim();
  const state = (opts.state || 'FL').trim();
  const addr = opts.address?.trim();
  const d = humanizeDescriptor(opts.descriptor);

  let text: string;

  switch (opts.category) {
    case 'HERO':
      text = addr ? `${b} ${city} | ${addr}` : `${b} ${city}`;
      break;

    case 'AMENITY':
      // Strong template: "{Amenity} at {Building} in {City}, {State}"
      text = d
        ? `${d} at ${b} in ${city}, ${state}`
        : `${b} in ${city}, ${state}`;
      break;

    case 'EXTERIOR':
      if (/aerial/i.test(opts.descriptor ?? '')) {
        text = `${b} ${city} Aerial View`;
      } else {
        text = `${b} Exterior in ${city}, ${state}`;
      }
      break;

    case 'INTERIOR':
      text = d
        ? `${d} Inside ${b} Condo, ${city} ${state}`
        : `${b} Condo Interior, ${city} ${state}`;
      break;

    case 'FEATURE':
      text = `${b} Condo ${city}`;
      break;

    case 'FLOORPLAN': {
      const unit = opts.unitId || '';
      let s = `Floor Plan ${unit} at ${b}`.replace(/\s+/g, ' ').trim();
      if (opts.beds && opts.baths) s += ` - ${opts.beds}BR/${opts.baths}BA`;
      if (opts.sqft) s += `, ${opts.sqft} Sqft`;
      text = s;
      break;
    }

    case 'LISTING':
      text = addr ? `${addr}, ${city}` : `${b} in ${city}`;
      break;

    case 'LIFESTYLE':
      text = d ? `${d} ${city}` : `${b} ${city}`;
      break;

    case 'GALLERY':
    default:
      text = d ? `${b} ${d} - ${city}, ${state}` : `${b} in ${city}, ${state}`;
      break;
  }

  // Hard cap: 125 chars. Truncate trailing state/comma if we overshoot.
  if (text.length > 125) text = text.slice(0, 125).replace(/[,\s-]+$/, '');
  return text;
}

/**
 * Convert a descriptor slug to a human-friendly phrase for use inside alt
 * text. Known patterns get hand-written forms; otherwise title-case the slug.
 */
export function humanizeDescriptor(desc?: string): string {
  if (!desc) return '';
  const map: Record<string, string> = {
    pool: 'Swimming Pool',
    'pool-aerial': 'Pool Aerial View',
    'lap-pool': 'Lap Pool',
    'rooftop-pool': 'Rooftop Pool',
    lobby: 'Lobby',
    'lobby-interior': 'Lobby Interior',
    entrance: 'Entrance',
    gym: 'Fitness Center',
    'fitness-center': 'Fitness Center',
    spa: 'Spa',
    'spa-treatment-room': 'Spa Treatment Room',
    kitchen: 'Kitchen',
    'kitchen-interior': 'Kitchen',
    bedroom: 'Bedroom',
    'primary-bedroom': 'Primary Bedroom',
    bathroom: 'Bathroom',
    'primary-bathroom': 'Primary Bathroom',
    'living-room': 'Living Room',
    'dining-room': 'Dining Room',
    'private-dining-room': 'Private Dining Room',
    bar: 'Bar',
    lounge: 'Lounge',
    clubroom: 'Club Room',
    'amenity-deck': 'Amenity Deck',
    rooftop: 'Rooftop',
    courtyard: 'Courtyard',
    terrace: 'Terrace',
    'waterfront-view': 'Waterfront View',
    'skyline-view': 'Skyline View',
    'oceanfront-view': 'Oceanfront View',
    'intracoastal-view': 'Intracoastal View',
    exterior: 'Exterior',
    'exterior-aerial': 'Exterior Aerial View',
    'building-facade': 'Building Facade',
    'night-exterior': 'Night Exterior',
  };
  if (map[desc]) return map[desc];
  return desc
    .split('-')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

/* -------------------------------------------------------------- */
/*  Descriptor indexing for duplicates                             */
/* -------------------------------------------------------------- */

/**
 * Given an ordered list of descriptors, return a parallel list of indices so
 * duplicates get suffixes: [pool, lobby, pool, pool] -> [1, 0, 2, 3].
 * Unique descriptors get 0 (no suffix).
 */
export function computeDescriptorIndices(descriptors: string[]): number[] {
  const totals: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const d of descriptors) totals[d] = (totals[d] || 0) + 1;

  const result: number[] = [];
  for (const d of descriptors) {
    if (totals[d] === 1) {
      result.push(0);
    } else {
      counts[d] = (counts[d] || 0) + 1;
      result.push(counts[d]);
    }
  }
  return result;
}
