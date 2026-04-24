'use client';

import { useMemo, useState } from 'react';
import JSZip from 'jszip';
import {
  IMAGE_LABELS,
  type ImageLabel,
  type ScrapedImage,
  type ProcessResponse,
  type ManifestRow,
} from '@/lib/types';
import { computeLabelIndices } from '@/lib/seo';

type Step = 'input' | 'review' | 'processing' | 'done';

interface SelectedImage extends ScrapedImage {
  selected: boolean;
  label: ImageLabel;
  isHero: boolean;
  thumbBlobUrl?: string;
}

export default function Home() {
  const [step, setStep] = useState<Step>('input');
  const [communityName, setCommunityName] = useState('');
  const [city, setCity] = useState('');
  const [urlsText, setUrlsText] = useState('');
  const [manualFiles, setManualFiles] = useState<File[]>([]);

  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [images, setImages] = useState<SelectedImage[]>([]);

  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [processErrors, setProcessErrors] = useState<string[]>([]);
  const [zipBlobUrl, setZipBlobUrl] = useState<string | null>(null);
  const [zipFilename, setZipFilename] = useState<string>('images.zip');

  /* -------------------------------------------------------------- */
  /*  Step 1: Input → Scrape                                        */
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

      // Prepend manual uploads as synthetic ScrapedImages using object URLs.
      // We process these client-side by sending the blob URL up through... actually
      // we can't send local blob URLs to the server. So we treat them specially
      // and just skip them here — instead the user would upload directly into
      // a separate manual-upload flow. For now, we surface a warning that manual
      // uploads aren't fully wired up and focus on the scrape path.
      if (manualFiles.length > 0) {
        scrapeWarnings.push(
          `${manualFiles.length} manual upload(s) detected — manual upload is not yet wired through the processing pipeline. Use source URLs for now.`,
        );
      }

      const prepared: SelectedImage[] = scraped.map((img, i) => ({
        ...img,
        selected: true,
        label: img.suggestedLabel ?? 'other',
        isHero: i === 0 && img.isLikelyHero, // tentatively pick first likely-hero
      }));

      // If nothing was marked hero by the heuristic, mark the first one as hero
      if (prepared.length > 0 && !prepared.some((p) => p.isHero)) {
        prepared[0].isHero = true;
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

  const selectedCount = images.filter((i) => i.selected).length;
  const heroImage = images.find((i) => i.isHero && i.selected);

  function toggleSelect(idx: number) {
    setImages((imgs) =>
      imgs.map((img, i) => (i === idx ? { ...img, selected: !img.selected } : img)),
    );
  }

  function setImageLabel(idx: number, label: ImageLabel) {
    setImages((imgs) =>
      imgs.map((img, i) => (i === idx ? { ...img, label } : img)),
    );
  }

  function setHero(idx: number) {
    setImages((imgs) =>
      imgs.map((img, i) => ({ ...img, isHero: i === idx, selected: i === idx ? true : img.selected })),
    );
  }

  function selectAll(on: boolean) {
    setImages((imgs) => imgs.map((img) => ({ ...img, selected: on })));
  }

  /* -------------------------------------------------------------- */
  /*  Step 3: Process → ZIP                                         */
  /* -------------------------------------------------------------- */

  async function handleProcess() {
    if (!heroImage) {
      setProcessErrors(['Please select exactly one hero image before processing.']);
      return;
    }
    if (selectedCount < 2) {
      setProcessErrors(['Select at least one hero and one gallery image.']);
      return;
    }

    setStep('processing');
    setProcessErrors([]);

    const zip = new JSZip();
    const heroFolder = zip.folder('hero')!;
    const galleryFolder = zip.folder('gallery')!;

    const selected = images.filter((i) => i.selected);
    const gallery = selected.filter((i) => !i.isHero);

    // Compute per-label indices for the gallery so repeat labels become view-1, view-2
    const galleryIndices = computeLabelIndices(gallery.map((g) => g.label));

    setProgress({ done: 0, total: selected.length, label: '' });

    const manifest: ManifestRow[] = [];
    const altTextLines: string[] = [];
    const errors: string[] = [];

    // Process hero first: special rule — use label "condos" unless the user
    // explicitly chose aerial or exterior (which are similarly overview-y).
    const heroLabel: ImageLabel =
      heroImage.label === 'aerial' || heroImage.label === 'exterior'
        ? heroImage.label
        : 'condos';

    const heroResult = await processOne({
      imageUrl: heroImage.url,
      communityName,
      city,
      label: heroLabel,
      variant: 'hero',
      index: 0,
    });

    if ('error' in heroResult) {
      errors.push(heroResult.error);
    } else {
      heroFolder.file(heroResult.filename, base64ToUint8(heroResult.data));
      manifest.push({
        filename: `hero/${heroResult.filename}`,
        originalUrl: heroImage.url,
        width: heroResult.width,
        height: heroResult.height,
        fileSize: heroResult.byteLength,
        label: heroLabel,
        altText: heroResult.altText,
        variant: 'hero',
      });
      altTextLines.push(`${heroResult.filename}\t${heroResult.altText}`);
    }
    setProgress((p) => ({ ...p, done: p.done + 1, label: heroImage.url }));

    // Process gallery images in parallel batches. Pro plan has plenty of
    // serverless capacity, and each call is independent.
    const CONCURRENCY = 5;
    for (let i = 0; i < gallery.length; i += CONCURRENCY) {
      const batch = gallery.slice(i, i + CONCURRENCY);
      const batchIdx = galleryIndices.slice(i, i + CONCURRENCY);

      const results = await Promise.all(
        batch.map((img, k) =>
          processOne({
            imageUrl: img.url,
            communityName,
            city,
            label: img.label,
            variant: 'standard',
            index: batchIdx[k],
          }),
        ),
      );

      for (let k = 0; k < results.length; k++) {
        const r = results[k];
        const src = batch[k];
        if ('error' in r) {
          errors.push(r.error);
        } else {
          galleryFolder.file(r.filename, base64ToUint8(r.data));
          manifest.push({
            filename: `gallery/${r.filename}`,
            originalUrl: src.url,
            width: r.width,
            height: r.height,
            fileSize: r.byteLength,
            label: src.label,
            altText: r.altText,
            variant: 'standard',
          });
          altTextLines.push(`${r.filename}\t${r.altText}`);
        }
        setProgress((p) => ({ ...p, done: p.done + 1, label: src.url }));
      }
    }

    // Build manifest.csv
    const csvHeader = 'filename,original_url,width,height,file_size,label,alt_text,variant';
    const csvBody = manifest
      .map((r) =>
        [
          r.filename,
          csvEscape(r.originalUrl),
          r.width,
          r.height,
          r.fileSize,
          r.label,
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
    const slug = communityName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    setZipFilename(`${slug || 'community'}-images.zip`);
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
          warnings={warnings}
          communityName={communityName}
          city={city}
          selectedCount={selectedCount}
          onToggle={toggleSelect}
          onLabel={setImageLabel}
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
        <Field label="Community name" hint="e.g. Cityplace South Tower">
          <input
            className="input"
            value={props.communityName}
            onChange={(e) => props.setCommunityName(e.target.value)}
            placeholder="Olara"
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
          placeholder={`https://example.com/olara\nhttps://example.com/olara/amenities\nhttps://example.com/olara/gallery`}
        />
      </Field>

      <Field
        label="Optional: manual image upload"
        hint="Images you already have on disk. (Note: server-side processing of local files isn't wired yet — for now upload them to an accessible URL.)"
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
  warnings: string[];
  communityName: string;
  city: string;
  selectedCount: number;
  onToggle: (i: number) => void;
  onLabel: (i: number, l: ImageLabel) => void;
  onHero: (i: number) => void;
  onSelectAll: (on: boolean) => void;
  onBack: () => void;
  onProcess: () => void;
}) {
  // Duplicate groups (by fingerprint)
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

      <div className="rounded-md border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-700">
          Found <strong>{props.images.length}</strong> images across your sources.
          Pick a <strong>hero</strong> (will be cropped to 2560×895), confirm
          which images to keep in the gallery (566×500), and check labels. The
          hero will automatically be named with the{' '}
          <code className="rounded bg-slate-100 px-1">condos</code> descriptor per
          the Modern Living naming rule.
        </p>
        <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">
          Copyright reminder: images scraped from developer / third-party sites may
          be subject to copyright. Use only where you have rights or a Modern Living
          marketing agreement in place.
        </p>
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
        {props.images.map((img, idx) => (
          <ThumbCard
            key={`${img.fingerprint}-${idx}`}
            img={img}
            idx={idx}
            isDupe={dupeKeys.has(img.fingerprint)}
            onToggle={() => props.onToggle(idx)}
            onLabel={(l) => props.onLabel(idx, l)}
            onHero={() => props.onHero(idx)}
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
          disabled={props.selectedCount < 2}
        >
          Process {props.selectedCount} image{props.selectedCount === 1 ? '' : 's'}
        </button>
      </div>
    </section>
  );
}

function ThumbCard(props: {
  img: SelectedImage;
  idx: number;
  isDupe: boolean;
  onToggle: () => void;
  onLabel: (l: ImageLabel) => void;
  onHero: () => void;
}) {
  const { img } = props;
  return (
    <div
      className={`overflow-hidden rounded-lg border bg-white transition ${
        img.selected ? 'border-teal-600 shadow-sm' : 'border-slate-200 opacity-60'
      }`}
    >
      <div className="relative aspect-[4/3] bg-slate-100">
        {/* Using img tag directly so it works with arbitrary external URLs
            without needing to add domains to next.config.js */}
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

        <select
          value={img.label}
          onChange={(e) => props.onLabel(e.target.value as ImageLabel)}
          className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
        >
          {IMAGE_LABELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>

        <div className="truncate text-[10px] text-slate-400" title={img.url}>
          {img.width && img.height ? `${img.width}×${img.height} · ` : ''}
          {new URL(img.url).hostname}
        </div>
      </div>
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
        <code className="rounded bg-slate-100 px-1">/gallery</code>, plus{' '}
        <code className="rounded bg-slate-100 px-1">manifest.csv</code> and{' '}
        <code className="rounded bg-slate-100 px-1">alt-text.txt</code>.
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

async function processOne(
  body: {
    imageUrl: string;
    communityName: string;
    city: string;
    label: ImageLabel;
    variant: 'hero' | 'standard';
    index?: number;
  },
): Promise<ProcessResponse | { error: string }> {
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
