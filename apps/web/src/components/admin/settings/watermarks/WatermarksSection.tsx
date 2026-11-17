'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';
import { FormField, Input } from '@repo/ui/input';
import { RadioCards } from '@repo/ui/radioCards';
import { Segmented } from '@repo/ui/segmented';
import { WATERMARK_FONTS } from '@repo/ui/theme/watermark';
import { Caption, Label, Text } from '@repo/ui/typography';

import { FormNote } from '@/components/admin/login/StepHeading';
import { readImageSize } from '@/lib/images/imageSize';
import { putToSignedUrl, type SignedUpload } from '@/lib/images/upload';
import { loadWatermarkAssets, type WatermarkAssets } from '@/lib/images/watermark';
import {
  cleanWatermarkText,
  DEFAULT_PLACEMENT,
  isWatermarkImageType,
  NO_WATERMARK,
  PLACEMENT_BOUNDS,
  WATERMARK_MAX_BYTES,
  WATERMARK_MAX_PX,
  WATERMARK_TEXT_MAX,
  type ImageWatermark,
  type Placement,
  type TextWatermark,
  type Watermark,
} from '@/lib/settings/parseWatermarkInput';

import { SettingsCard } from '../SettingsCard';
import { AnchorPicker } from './AnchorPicker';
import { WatermarkPreview, type SampleShape } from './WatermarkPreview';

type Kind = Watermark['kind'];
type ImageRef = Pick<ImageWatermark, 'key' | 'width' | 'height' | 'contentType'>;
type Upload = { status: 'idle' } | { status: 'uploading'; progress: number } | { status: 'ready' } | { status: 'error'; message: string };
type WatermarkView = { watermark: Watermark; imageUrl: string | null };

const KINDS = [
  { value: 'none', label: 'None' },
  { value: 'image', label: 'Image' },
  { value: 'text', label: 'Text' },
] as const;
const INKS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;
const SHAPES = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
] as const;
const SLIDERS: { field: 'size' | 'opacity' | 'margin'; label: string; hint: string }[] = [
  { field: 'size', label: 'Size', hint: "The watermark's width, as a share of the photo's long edge." },
  { field: 'opacity', label: 'Opacity', hint: 'How strongly it shows over the photo.' },
  { field: 'margin', label: 'Margin', hint: "The space from the edges, as a share of the photo's short edge." },
];
const NO_ASSETS: WatermarkAssets = { bitmap: null };

const placementOf = (w: Watermark): Placement => (w.kind === 'none' ? DEFAULT_PLACEMENT : { position: w.position, size: w.size, opacity: w.opacity, margin: w.margin });

/**
 * Settings → Watermarks (plan p04 D4.9–D4.14): one watermark, an image (uploaded on choice straight
 * to storage, saved with Save), a text, or none; where and how strongly it is drawn; and a live
 * preview drawn by the same function the upload pipeline bakes with. No mockup exists: built from
 * `SettingsCard`s (the owner reviews it at Verification 2).
 */
export function WatermarksSection({ initial, imageUrl, canUseImage }: { initial: Watermark; imageUrl: string | null; canUseImage: boolean }) {
  const router = useRouter();
  const ids = { position: useId(), font: useId() };
  const [kind, setKind] = useState<Kind>(initial.kind);
  const [placement, setPlacement] = useState<Placement>(placementOf(initial));
  const [text, setText] = useState(initial.kind === 'text' ? initial.text : '');
  const [font, setFont] = useState<TextWatermark['font']>(initial.kind === 'text' ? initial.font : 'sans');
  const [ink, setInk] = useState<TextWatermark['ink']>(initial.kind === 'text' ? initial.ink : 'light');
  const [image, setImage] = useState<ImageRef | null>(initial.kind === 'image' ? { key: initial.key, width: initial.width, height: initial.height, contentType: initial.contentType } : null);
  const [assets, setAssets] = useState<WatermarkAssets>(NO_ASSETS);
  const [upload, setUpload] = useState<Upload>({ status: 'idle' });
  const [shape, setShape] = useState<SampleShape>('landscape');
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const mint = useApi<{ key: string; upload: SignedUpload }>('/api/admin/settings/watermark/upload', { method: 'POST' });
  const save = useApi<WatermarkView>('/api/admin/settings/watermark', { method: 'PATCH' });

  // The saved image, for the preview (from the public media domain or the development route).
  useEffect(() => {
    if (initial.kind !== 'image' || !imageUrl) return;
    const controller = new AbortController();
    loadWatermarkAssets(initial, imageUrl, { signal: controller.signal })
      .then(setAssets)
      .catch(() => {});
    return () => controller.abort();
  }, [initial, imageUrl]);

  const draft: Watermark | null = useMemo(() => {
    if (kind === 'none') return NO_WATERMARK;
    if (kind === 'text') {
      const clean = cleanWatermarkText(text);
      return clean ? { kind: 'text', text: clean, font, ink, ...placement } : null;
    }
    return image ? { kind: 'image', ...image, ...placement } : null;
  }, [kind, text, font, ink, image, placement]);

  const uploading = upload.status === 'uploading';

  const onFile = async (file: File | undefined) => {
    setDone(null);
    if (!file) return;
    if (!isWatermarkImageType(file.type)) return setUpload({ status: 'error', message: 'Choose a PNG or WebP image (with a transparent background).' });
    if (file.size > WATERMARK_MAX_BYTES) return setUpload({ status: 'error', message: 'The image must be at most 2 MB.' });
    setUpload({ status: 'uploading', progress: 0 });
    let size: { w: number; h: number };
    try {
      size = await readImageSize(file);
    } catch {
      return setUpload({ status: 'error', message: 'This image could not be read. Try another file.' });
    }
    if (size.w > WATERMARK_MAX_PX || size.h > WATERMARK_MAX_PX) return setUpload({ status: 'error', message: `The image must be at most ${WATERMARK_MAX_PX} px on each side.` });
    const minted = await mint.execute({ contentType: file.type, size: file.size });
    if (minted.error || !minted.data) {
      const message = minted.error?.details?.message;
      return setUpload({ status: 'error', message: typeof message === 'string' ? message : 'Could not start the upload. Try again.' });
    }
    try {
      await putToSignedUrl(file, minted.data.upload, { onProgress: (progress) => setUpload({ status: 'uploading', progress }) });
    } catch {
      return setUpload({ status: 'error', message: 'The upload failed. Check your connection and try again.' });
    }
    setImage({ key: minted.data.key, width: size.w, height: size.h, contentType: file.type });
    setAssets(await createImageBitmap(file).then((bitmap) => ({ bitmap }), () => NO_ASSETS));
    setUpload({ status: 'ready' });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setDone(null);
    if (!draft) return;
    setError(null);
    const result = await save.execute(draft);
    if (result.error || !result.data) {
      if (result.error?.errorCode === 'ABORT_ERROR') return;
      const details = result.error?.details;
      return setError({
        field: typeof details?.field === 'string' ? details.field : undefined,
        message: typeof details?.message === 'string' ? details.message : 'Could not save the watermark. Please try again.',
      });
    }
    setDone(result.data.watermark.kind === 'none' ? 'Saved: no watermark.' : 'Saved. New galleries use this watermark.');
    router.refresh();
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
      <SettingsCard
        id="watermark"
        title="Watermark"
        description="Drawn into the previews of selection galleries when they are uploaded. Changing it later does not change galleries already created."
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <FormNote message={error && !error.field ? error.message : null} />
          <Segmented aria-label="Watermark" options={KINDS} value={kind} onValueChange={(v) => (setKind(v), setDone(null))} className="self-start" />

          {kind === 'image' ? (
            <div className="flex flex-col gap-2">
              {canUseImage ? null : (
                <FormNote tone="info" message="An image watermark needs the public media domain (see the deployment guide). A text watermark works meanwhile." />
              )}
              <FormField
                label="Image"
                hint="A PNG or WebP with a transparent background, at most 2 MB and 4000 px."
                error={upload.status === 'error' ? upload.message : error?.field === 'key' ? error.message : null}
              >
                {(fieldIds) => (
                  <input
                    {...fieldIds}
                    type="file"
                    accept="image/png,image/webp"
                    disabled={!canUseImage || uploading}
                    onChange={(e) => void onFile(e.target.files?.[0])}
                    className="font-sans text-body text-ink file:mr-3 file:min-h-11 file:rounded-button file:border file:border-line-control file:bg-surface file:px-4 file:font-semibold file:text-ink disabled:opacity-50"
                  />
                )}
              </FormField>
              <div aria-live="polite">
                {uploading ? <Caption>Uploading… {Math.round(upload.progress * 100)} %</Caption> : null}
                {upload.status === 'ready' ? <Caption>Uploaded. Save to use it.</Caption> : null}
                {upload.status === 'idle' && image ? <Caption>The current image is shown in the preview.</Caption> : null}
              </div>
            </div>
          ) : null}

          {kind === 'text' ? (
            <div className="flex flex-col gap-4">
              <FormField label="Text" hint={`Up to ${WATERMARK_TEXT_MAX} characters, e.g. © Northlight Studio.`} error={error?.field === 'text' ? error.message : null}>
                {(fieldIds) => <Input {...fieldIds} value={text} maxLength={WATERMARK_TEXT_MAX * 2} onChange={(e) => setText(e.target.value)} />}
              </FormField>
              <div className="flex flex-col gap-2">
                <Label id={ids.font}>Font</Label>
                <RadioCards
                  name="watermark-font"
                  aria-labelledby={ids.font}
                  value={font}
                  onChange={setFont}
                  options={[
                    { value: 'sans', label: 'Sans', preview: <span style={{ fontFamily: WATERMARK_FONTS.sans }} className="text-title">Aa</span> },
                    { value: 'serif', label: 'Serif', preview: <span style={{ fontFamily: WATERMARK_FONTS.serif }} className="text-title">Aa</span> },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Ink</Label>
                <Segmented aria-label="Ink" options={INKS} value={ink} onValueChange={setInk} className="self-start" />
              </div>
            </div>
          ) : null}

          {kind !== 'none' ? (
            <fieldset className="flex flex-col gap-4">
              <Text as="legend" size="body-sm" weight="semibold" id={ids.position} className="mb-2">
                Position
              </Text>
              <AnchorPicker labelledBy={ids.position} value={placement.position} onChange={(position) => setPlacement((p) => ({ ...p, position }))} />
              {SLIDERS.map(({ field, label, hint }) =>
                field === 'margin' && placement.position === 'tiled' ? null : (
                  <FormField key={field} label={`${label}: ${placement[field]} %`} hint={hint}>
                    {(fieldIds) => (
                      <input
                        {...fieldIds}
                        type="range"
                        min={PLACEMENT_BOUNDS[field][0]}
                        max={PLACEMENT_BOUNDS[field][1]}
                        value={placement[field]}
                        onChange={(e) => setPlacement((p) => ({ ...p, [field]: Number(e.target.value) }))}
                        className="min-h-11 w-full max-w-md accent-accent"
                      />
                    )}
                  </FormField>
                ),
              )}
            </fieldset>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={save.loading} disabled={!draft || uploading}>
              Save
            </Button>
            <div aria-live="polite">{done ? <Text tone="muted">{done}</Text> : null}</div>
          </div>
        </form>
      </SettingsCard>

      <SettingsCard
        id="watermark-preview"
        title="Preview"
        description="A sample photo with the watermark as it will be drawn into display copies."
        action={<Segmented aria-label="Sample photo" options={SHAPES} value={shape} onValueChange={setShape} />}
      >
        <WatermarkPreview watermark={draft ?? NO_WATERMARK} assets={assets} shape={shape} />
      </SettingsCard>
    </div>
  );
}
