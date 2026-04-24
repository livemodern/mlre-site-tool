'use client';

import { useMemo, useState } from 'react';
import JSZip from 'jszip';
import {
  CATEGORIES,
  COMMON_DESCRIPTORS,
  type Category,
  type ScrapedImage,
  type ProcessResponse,
  type ManifestRow,
} from '@/lib/types';
import {
  buildFilename,
  computeDescriptorIndices,
  inferCategory,
  normalizeBuildingName,
  slugify,
} from '@/lib/seo';

type Step = 'input' | 'review' | 'processing' | 'done';

interface SelectedImage extends ScrapedImage {
  id: string; // stable unique ID for this image
  selected: boolean;
  descriptor: string;
  category: Category;
  isHero: boolean;
  // FLOORPLAN-only fields
  unitId?: string;
  beds?: string;
  baths?: string;
  sqft?: string;
}

export default function Home() {
  const [step, setStep] = useState<Step>('input');

  // Step 1 inputs
  const [communityName, setCommunityName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('FL');
  const [address, setAddress] = useState('');
  const [urlsText, setUrlsText] = useState('');
  const [manualFiles, setManualFiles] = useState<File[]>([]);

  // Scrape state
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [images, setImages] = useState<SelectedImage[]>([]);

  // Process state
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [processErrors, setProcessErrors] = useState<string[]>([]);
  const [zipBlobUrl, setZipBlobUrl] = useState<string | null>(null);
  const [zipFilename, setZipFilename] = useState<string>('images.zip');

  /* -------------------------------------------------------------- */
  /*  Step 1 -> Scrape                                              */
  /* -------------------------------------------------------------- */

  async function handleScrape() {
    setScrapeError(null);
    setWarnings([]);

    const urls = urlsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!communityName.trim() || !city.trim()) {
      setScrapeError('Community name and city are required.');
      return;
    }
    if (urls.length === 0 && manualFiles.length === 0) {
      setScrapeError('Add at least one source URL or upload an image.');
      return;
    }

    setScraping(true);
    try {
      let scraped: ScrapedImage[] = [];
      let scrapeWarnings: string[] = [];

      if (urls.length > 0) {
        const res = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          images: ScrapedImage[];
          warnings: string[];
        };
        scraped = data.images;
        scrapeWarnings = data.warnings;
      }

      if (manualFiles.length > 0) {
        scrapeWarnings.push(
          `${manualFiles.length} manual upload(s) detected — manual upload is not yet wired through the processing pipeline. Use source URLs for now.`,
        );
      }

      const prepared: SelectedImage[] = scraped.map((img, i) => {
        const descriptor = img.suggestedDescriptor ?? 'exterior';
        return {
          ...img,
          id: `img-${i}-${img.fingerprint}`,
          selected: true,
          descriptor,
          category: inferCategory(descriptor),
          isHero: i === 0 && img.isLikelyHero,
        };
      });

      // Guarantee exactly one hero is marked (radio-button invariant)
      if (prepared.length > 0) {
        const heroCount = prepared.filter((p) => p.isHero).length;
        if (heroCount === 0) prepared[0].isHero = true;
        if (heroCount > 1) {
          let seenFirst = false;
          for (const p of prepared) {
            if (p.isHero) {
              if (seenFirst) p.isHero = false;
              else seenFirst = true;
            }
          }
        }
      }

      setImages(prepared);
      setWarnings(scrapeWarnings);
      setStep('review');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setScrapeError(msg);
    } finally {
      setScraping(false);
    }
  }

  /* -------------------------------------------------------------- */
  /*  Step 2 helpers                                                */
  /* -------------------------------------------------------------- */

  const heroImage = useMemo(
    () => images.find((i) => i.isHero && i.selected),
    [images],
  );
  const selectedCount = images.filter((i) => i.selected).length;

  function toggleSelect(id: string) {
    setImages((imgs) =>
      imgs.map((img) =>
        img.id === id ? { ...img, selected: !img.selected } : img,
      ),
    );
  }

  function setDescriptor(id: string, descriptor: string) {
    setImages((imgs) =>
      imgs.map((img) => {
        if (img.id !== id) return img;
        // Only auto-update category from descriptor if current category was inferred
        // (keeps manual overrides). We detect auto mode by checking if the current
        // category matches inferCategory(previousDescriptor).
        const wasAuto = img.category === inferCategory(img.descriptor);
        return {
          ...img,
          descriptor,
          category: wasAuto ? inferCategory(descriptor) : img.category,
        };
      }),
    );
  }

  function setCategory(id: string, category: Category) {
    setImages((imgs) =>
      imgs.map((img) => (img.id === id ? { ...img, category } : img)),
    );
  }

  function setFloorplanField(
    id: string,
    field: 'unitId' | 'beds' | 'baths' | 'sqft',
    value: string,
  ) {
    setImages((imgs) =>
      imgs.map((img) => (img.id === id ? { ...img, [field]: value } : img)),
    );
  }

  function setHero(id: string) {
    setImages((imgs) =>
      imgs.map((img) => ({
        ...img,
        isHero: img.id === id,
        selected: img.id === id ? true : img.selected,
      })),
    );
  }

  function selectAll(on: boolean) {
    setImages((imgs) => imgs.map((img) => ({ ...img, selected: on })));
  }

  /* -------------------------------------------------------------- */
  /*  Step 3: Process → ZIP                                         */
  /* -------------------------------------------------------------- */

  async function handleProcess() {
    // Capture the exact image the user picked as hero at button-click time.
    const currentHero = images.find((i) => i.isHero && i.selected);

    if (!currentHero) {
      setProcessErrors([
        'Please select a hero image (radio button) and make sure it is checked as Included.',
      ]);
      return;
    }
    if (selectedCount < 1) {
      setProcessErrors(['Select at least one image.']);
      return;
    }

    setStep('processing');
    setProcessErrors([]);

    const zip = new JSZip();
    const heroFolder = zip.folder('hero')!;
    const galleryFolder = zip.folder('gallery')!;
    const floorplansFolder = zip.folder('floorplans')!;

    const selected = images.filter((i) => i.selected);
    const nonHero = selected.filter((i) => i.id !== currentHero.id);

    // Compute descriptor indices so duplicates get -1, -2, -3 suffixes.
    // Only applies to categories that use descriptors in filenames (everything
    // except HERO, FEATURE, FLOORPLAN).
    const indexableDescriptors = nonHero.map((img) =>
      img.category === 'FEATURE' || img.category === 'FLOORPLAN'
        ? `__${img.category}__` // don't index FEATURE/FLOORPLAN via this path
        : img.descriptor,
    );
    const nonHeroIndices = computeDescriptorIndices(indexableDescriptors);

    const total = 1 + nonHero.length;
    setProgress({ done: 0, total, label: currentHero.url });

    const manifest: ManifestRow[] = [];
    const altTextLines: string[] = [];
    const errors: string[] = [];

    // ---- Hero: ALWAYS goes to /hero/ with the URL the user picked ----
    const heroResult = await processOne({
      imageUrl: currentHero.url,
      communityName,
      city,
      state,
      address,
      category: 'HERO',
      variant: 'hero',
    });
    if ('error' in heroResult) {
      errors.push(heroResult.error);
    } else {
      heroFolder.file(heroResult.filename, base64ToUint8(heroResult.data));
      manifest.push({
        filename: `hero/${heroResult.filename}`,
        originalUrl: currentHero.url,
        width: heroResult.width,
        height: heroResult.height,
        fileSize: heroResult.byteLength,
        category: 'HERO',
        descriptor: 'hero',
        altText: heroResult.altText,
        variant: 'hero',
      });
      altTextLines.push(`${heroResult.filename}\t${heroResult.altText}`);
    }
    setProgress((p) => ({ ...p, done: p.done + 1 }));

    // ---- Non-hero images: parallel batches of 5 ----
    const CONCURRENCY = 5;
    for (let i = 0; i < nonHero.length; i += CONCURRENCY) {
      const batch = nonHero.slice(i, i + CONCURRENCY);
      const batchIdx = nonHeroIndices.slice(i, i + CONCURRENCY);

      const results = await Promise.all(
        batch.map((img, k) =>
          processOne({
            imageUrl: img.url,
            communityName,
            city,
            state,
            address,
            category: img.category,
            descriptor: img.descriptor,
            index: batchIdx[k],
            unitId: img.unitId,
            beds: img.beds,
            baths: img.baths,
            sqft: img.sqft,
            variant: 'standard',
          }),
        ),
      );

      for (let k = 0; k < results.length; k++) {
        const r = results[k];
        const src = batch[k];
        if ('error' in r) {
          errors.push(r.error);
        } else {
          const folder =
            src.category === 'FLOORPLAN' ? floorplansFolder : galleryFolder;
          folder.file(r.filename, base64ToUint8(r.data));
          manifest.push({
            filename: `${src.category === 'FLOORPLAN' ? 'floorplans' : 'gallery'}/${r.filename}`,
            originalUrl: src.url,
            width: r.width,
            height: r.height,
            fileSize: r.byteLength,
            category: src.category,
            descriptor: src.descriptor,
            altText: r.altText,
            variant: 'standard',
          });
          altTextLines.push(`${r.filename}\t${r.altText}`);
        }
        setProgress((p) => ({ ...p, done: p.done + 1, label: src.url }));
      }
    }

    // Manifest CSV
    const csvHeader =
      'filename,original_url,width,height,file_size,category,descriptor,alt_text,variant';
    const csvBody = manifest
      .map((r) =>
        [
          r.filename,
          csvEscape(r.originalUrl),
          r.width,
          r.height,
          r.fileSize,
          r.category,
          r.descriptor,
          csvEscape(r.altText),
          r.variant,
        ].join(','),
      )
      .join('\n');
    zip.file('manifest.csv', `${csvHeader}\n${csvBody}\n`);
    zip.file('alt-text.txt', altTextLines.join('\n') + '\n');

    if (errors.length > 0) zip.file('errors.txt', errors.join('\n') + '\n');

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const slug = slugify(communityName) || 'community';
    setZipFilename(`${slug}-images.zip`);
    setZipBlobUrl(url);
    setProcessErrors(errors);
    setStep('done');
  }

  function resetAll() {
    if (zipBlobUrl) URL.revokeObjectURL(zipBlobUrl);
    setStep('input');
    setImages([]);
    setWarnings([]);
    setScrapeError(null);
    setProcessErrors([]);
    setZipBlobUrl(null);
    setProgress({ done: 0, total: 0, label: '' });
  }

  /* -------------------------------------------------------------- */
  /*  Render                                                        */
  /* -------------------------------------------------------------- */

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Header step={step} />

      {step === 'input' && (
        <InputStep
          communityName={communityName}
          setCommunityName={setCommunityName}
          city={city}
          setCity={setCity}
          stateVal={state}
          setStateVal={setState}
          address={address}
          setAddress={setAddress}
          urlsText={urlsText}
          setUrlsText={setUrlsText}
          manualFiles={manualFiles}
          setManualFiles={setManualFiles}
          scraping={scraping}
          scrapeError={scrapeError}
          onScrape={handleScrape}
        />
      )}

      {step === 'review' && (
        <ReviewStep
          images={images}
          heroImage={heroImage}
          warnings={warnings}
          communityName={communityName}
          city={city}
          selectedCount={selectedCount}
          onToggle={toggleSelect}
          onDescriptor={setDescriptor}
          onCategory={setCategory}
          onFloorplanField={setFloorplanField}
          onHero={setHero}
          onSelectAll={selectAll}
          onBack={() => setStep('input')}
          onProcess={handleProcess}
        />
      )}

      {step === 'processing' && <ProcessingStep progress={progress} />}

      {step === 'done' && zipBlobUrl && (
        <DoneStep
          zipBlobUrl={zipBlobUrl}
          zipFilename={zipFilename}
          processErrors={processErrors}
          imagesProcessed={progress.done}
          onReset={resetAll}
        />
      )}
    </main>
  );
}

/* ================================================================= */
/*  Components                                                       */
/* ================================================================= */

function Header({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'input', label: '1 · Inputs' },
    { key: 'review', label: '2 · Review & Label' },
    { key: 'processing', label: '3 · Process' },
    { key: 'done', label: '4 · Download' },
  ];
  return (
    <header className="mb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Modern Living Image Prep
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Scrape → crop → WebP → SEO rename → ZIP.
          </p>
        </div>
        <nav className="flex gap-2 text-xs">
          {steps.map((s) => {
            const active = s.key === step;
            return (
              <span
                key={s.key}
                className={`rounded-full border px-3 py-1 ${
                  active
                    ? 'border-teal-700 bg-teal-700 text-white'
                    : 'border-slate-200 bg-white text-slate-500'
                }`}
              >
                {s.label}
              </span>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

function InputStep(props: {
  communityName: string;
  setCommunityName: (s: string) => void;
  city: string;
  setCity: (s: string) => void;
  stateVal: string;
  setStateVal: (s: string) => void;
  address: string;
  setAddress: (s: string) => void;
  urlsText: string;
  setUrlsText: (s: string) => void;
  manualFiles: File[];
  setManualFiles: (f: File[]) => void;
  scraping: boolean;
  scrapeError: string | null;
  onScrape: () => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid gap-6 md:grid-cols-2">
        <Field label="Community name" hint="e.g. The Bristol Palm Beach — the article 'The' is stripped automatically.">
          <input
            className="input"
            value={props.communityName}
            onChange={(e) => props.setCommunityName(e.target.value)}
            placeholder="CityPlace South Tower"
          />
        </Field>
        <Field label="City" hint="e.g. West Palm Beach">
          <input
            className="input"
            value={props.city}
            onChange={(e) => props.setCity(e.target.value)}
            placeholder="West Palm Beach"
          />
        </Field>
        <Field label="State" hint="Used in alt text only. Default: FL">
          <input
            className="input"
            value={props.stateVal}
            onChange={(e) => props.setStateVal(e.target.value)}
            placeholder="FL"
          />
        </Field>
        <Field
          label="Street address (optional)"
          hint="Used in HERO alt text: e.g. '1100 S Flagler Dr'"
        >
          <input
            className="input"
            value={props.address}
            onChange={(e) => props.setAddress(e.target.value)}
            placeholder="1100 S Flagler Dr"
          />
        </Field>
      </div>

      <Field
        label="Source URLs"
        hint="One per line. Developer sites, community pages, /media, /gallery."
        className="mt-6"
      >
        <textarea
          className="input h-40 font-mono text-sm"
          value={props.urlsText}
          onChange={(e) => props.setUrlsText(e.target.value)}
          placeholder={`https://example.com/bristol\nhttps://example.com/bristol/amenities\nhttps://example.com/bristol/gallery`}
        />
      </Field>

      <Field
        label="Optional: manual image upload"
        hint="Images you already have on disk. (Note: local-file processing is not yet wired — for now upload them to an accessible URL.)"
        className="mt-6"
      >
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => props.setManualFiles(Array.from(e.target.files ?? []))}
          className="text-sm"
        />
        {props.manualFiles.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {props.manualFiles.length} file(s) selected.
          </p>
        )}
      </Field>

      {props.scrapeError && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {props.scrapeError}
        </div>
      )}

      <div className="mt-8 flex justify-end">
        <button
          onClick={props.onScrape}
          disabled={props.scraping}
          className="btn-primary"
        >
          {props.scraping ? 'Scraping…' : 'Scan URLs for images'}
        </button>
      </div>

      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #e2e8f0;
          background: white;
          padding: 0.625rem 0.75rem;
          font-size: 0.9rem;
        }
        .input:focus {
          outline: 2px solid #0f766e;
          outline-offset: -1px;
          border-color: transparent;
        }
        .btn-primary {
          background: #0f766e;
          color: white;
          border-radius: 0.5rem;
          padding: 0.625rem 1.25rem;
          font-size: 0.9rem;
          font-weight: 500;
        }
        .btn-primary:hover {
          background: #115e59;
        }
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </section>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1 block text-sm font-medium text-slate-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function ReviewStep(props: {
  images: SelectedImage[];
  heroImage?: SelectedImage;
  warnings: string[];
  communityName: string;
  city: string;
  selectedCount: number;
  onToggle: (id: string) => void;
  onDescriptor: (id: string, d: string) => void;
  onCategory: (id: string, c: Category) => void;
  onFloorplanField: (
    id: string,
    f: 'unitId' | 'beds' | 'baths' | 'sqft',
    v: string,
  ) => void;
  onHero: (id: string) => void;
  onSelectAll: (on: boolean) => void;
  onBack: () => void;
  onProcess: () => void;
}) {
  const dupeKeys = useMemo(() => {
    const seen = new Map<string, number>();
    props.images.forEach((img) => {
      seen.set(img.fingerprint, (seen.get(img.fingerprint) ?? 0) + 1);
    });
    const dupes = new Set<string>();
    seen.forEach((count, key) => {
      if (count > 1) dupes.add(key);
    });
    return dupes;
  }, [props.images]);

  // Preview hero filename
  const heroFilename = props.heroImage
    ? buildFilename({
        communityName: props.communityName,
        city: props.city,
        category: 'HERO',
      })
    : '—';

  const normalized = props.communityName
    ? normalizeBuildingName(props.communityName, props.city)
    : '—';

  return (
    <section className="space-y-6">
      {props.warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="font-medium">Notes from the scraper</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {props.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <div>
          Found <strong>{props.images.length}</strong> images. Building slug:{' '}
          <code className="rounded bg-slate-100 px-1">{normalized}</code>
        </div>
        <div className="mt-2">
          Hero will be saved as{' '}
          <code className="rounded bg-slate-100 px-1">hero/{heroFilename}</code>{' '}
          at 2560×895. Other images are resized so the longest side is 566px
          (aspect preserved, no crop).
        </div>
        {props.heroImage && (
          <div className="mt-2 flex items-center gap-2 rounded bg-teal-50 p-2">
            <span className="inline-block h-2 w-2 rounded-full bg-teal-600" />
            <span className="text-xs text-teal-900">
              Hero source:{' '}
              <span className="break-all font-mono">{props.heroImage.url}</span>
            </span>
          </div>
        )}
        <div className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">
          Copyright reminder: images scraped from developer or third-party sites
          may be subject to copyright. Use only where Modern Living has rights.
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">
          <strong>{props.selectedCount}</strong> selected
        </div>
        <div className="flex gap-2 text-xs">
          <button className="underline" onClick={() => props.onSelectAll(true)}>
            Select all
          </button>
          <button className="underline" onClick={() => props.onSelectAll(false)}>
            Select none
          </button>
        </div>
      </div>

      <div className="thumb-grid">
        {props.images.map((img) => (
          <ThumbCard
            key={img.id}
            img={img}
            communityName={props.communityName}
            city={props.city}
            isDupe={dupeKeys.has(img.fingerprint)}
            onToggle={() => props.onToggle(img.id)}
            onDescriptor={(d) => props.onDescriptor(img.id, d)}
            onCategory={(c) => props.onCategory(img.id, c)}
            onFloorplanField={(f, v) => props.onFloorplanField(img.id, f, v)}
            onHero={() => props.onHero(img.id)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 pt-6">
        <button
          className="text-sm text-slate-600 hover:text-slate-900"
          onClick={props.onBack}
        >
          ← Back
        </button>
        <button
          onClick={props.onProcess}
          className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          disabled={props.selectedCount < 1 || !props.heroImage}
        >
          Process {props.selectedCount} image{props.selectedCount === 1 ? '' : 's'}
        </button>
      </div>
    </section>
  );
}

function ThumbCard(props: {
  img: SelectedImage;
  communityName: string;
  city: string;
  isDupe: boolean;
  onToggle: () => void;
  onDescriptor: (d: string) => void;
  onCategory: (c: Category) => void;
  onFloorplanField: (f: 'unitId' | 'beds' | 'baths' | 'sqft', v: string) => void;
  onHero: () => void;
}) {
  const { img } = props;

  const previewFilename = img.isHero
    ? buildFilename({
        communityName: props.communityName,
        city: props.city,
        category: 'HERO',
      })
    : buildFilename({
        communityName: props.communityName,
        city: props.city,
        category: img.category,
        descriptor: img.descriptor,
        unitId: img.unitId,
      });

  return (
    <div
      className={`overflow-hidden rounded-lg border bg-white transition ${
        img.selected ? 'border-teal-600 shadow-sm' : 'border-slate-200 opacity-60'
      }`}
    >
      <div className="relative aspect-[4/3] bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.url}
          alt={img.altText ?? ''}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.opacity = '0.2';
          }}
        />
        {img.isHero && (
          <span className="absolute left-2 top-2 rounded bg-teal-700 px-2 py-0.5 text-xs font-medium text-white">
            HERO
          </span>
        )}
        {props.isDupe && (
          <span className="absolute right-2 top-2 rounded bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">
            duplicate?
          </span>
        )}
      </div>

      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={img.selected}
            onChange={props.onToggle}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span className="text-xs text-slate-500">Include</span>

          <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
            <input
              type="radio"
              name="hero"
              checked={img.isHero}
              onChange={props.onHero}
              className="h-3.5 w-3.5"
            />
            Hero
          </label>
        </div>

        {!img.isHero && (
          <>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                Descriptor
              </span>
              <input
                list="common-descriptors"
                value={img.descriptor}
                onChange={(e) => props.onDescriptor(e.target.value)}
                className="mt-0.5 w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                placeholder="pool, lobby-interior, etc."
              />
            </label>

            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                Category
              </span>
              <select
                value={img.category}
                onChange={(e) => props.onCategory(e.target.value as Category)}
                className="mt-0.5 w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
              >
                {CATEGORIES.filter((c) => c !== 'HERO').map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            {img.category === 'FLOORPLAN' && (
              <div className="grid grid-cols-2 gap-1">
                <input
                  value={img.unitId ?? ''}
                  onChange={(e) => props.onFloorplanField('unitId', e.target.value)}
                  placeholder="Unit (e.g. A1)"
                  className="rounded border border-slate-200 px-2 py-1 text-xs"
                />
                <input
                  value={img.sqft ?? ''}
                  onChange={(e) => props.onFloorplanField('sqft', e.target.value)}
                  placeholder="SqFt"
                  className="rounded border border-slate-200 px-2 py-1 text-xs"
                />
                <input
                  value={img.beds ?? ''}
                  onChange={(e) => props.onFloorplanField('beds', e.target.value)}
                  placeholder="BR"
                  className="rounded border border-slate-200 px-2 py-1 text-xs"
                />
                <input
                  value={img.baths ?? ''}
                  onChange={(e) => props.onFloorplanField('baths', e.target.value)}
                  placeholder="BA"
                  className="rounded border border-slate-200 px-2 py-1 text-xs"
                />
              </div>
            )}
          </>
        )}

        <div className="truncate text-[10px] text-slate-400" title={previewFilename}>
          {previewFilename}
        </div>
      </div>

      <datalist id="common-descriptors">
        {COMMON_DESCRIPTORS.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </div>
  );
}

function ProcessingStep({
  progress,
}: {
  progress: { done: number; total: number; label: string };
}) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      <div className="text-sm text-slate-600">Processing images…</div>
      <div className="mx-auto mt-4 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full bg-teal-600 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-3 text-xs text-slate-500">
        {progress.done} of {progress.total} · {pct}%
      </div>
      {progress.label && (
        <div className="mt-2 truncate text-[11px] text-slate-400" title={progress.label}>
          {progress.label}
        </div>
      )}
    </section>
  );
}

function DoneStep(props: {
  zipBlobUrl: string;
  zipFilename: string;
  processErrors: string[];
  imagesProcessed: number;
  onReset: () => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      <div className="text-lg font-medium">ZIP ready</div>
      <p className="mt-1 text-sm text-slate-500">
        {props.imagesProcessed} images processed. Hero in{' '}
        <code className="rounded bg-slate-100 px-1">/hero</code>, gallery in{' '}
        <code className="rounded bg-slate-100 px-1">/gallery</code>, floor plans
        in <code className="rounded bg-slate-100 px-1">/floorplans</code>. Also
        includes <code className="rounded bg-slate-100 px-1">manifest.csv</code>{' '}
        and <code className="rounded bg-slate-100 px-1">alt-text.txt</code>.
      </p>

      <a
        href={props.zipBlobUrl}
        download={props.zipFilename}
        className="mt-6 inline-block rounded-lg bg-teal-700 px-6 py-3 text-sm font-medium text-white hover:bg-teal-800"
      >
        Download {props.zipFilename}
      </a>

      {props.processErrors.length > 0 && (
        <div className="mx-auto mt-6 max-w-xl rounded-md border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-800">
          <div className="font-medium">{props.processErrors.length} image(s) failed:</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {props.processErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <div className="mt-2 text-[11px] text-amber-700">
            (Error log also included in the ZIP as <code>errors.txt</code>.)
          </div>
        </div>
      )}

      <button
        onClick={props.onReset}
        className="mt-6 block w-full text-xs text-slate-500 underline hover:text-slate-900"
      >
        Start a new batch
      </button>
    </section>
  );
}

/* ================================================================= */
/*  Helpers                                                          */
/* ================================================================= */

async function processOne(body: {
  imageUrl: string;
  communityName: string;
  city: string;
  state?: string;
  address?: string;
  category: Category;
  descriptor?: string;
  index?: number;
  unitId?: string;
  beds?: string;
  baths?: string;
  sqft?: string;
  variant: 'hero' | 'standard';
}): Promise<ProcessResponse | { error: string }> {
  try {
    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { error: j.error ?? `HTTP ${res.status} processing ${body.imageUrl}` };
    }
    return (await res.json()) as ProcessResponse;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `${body.imageUrl}: ${msg}` };
  }
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
