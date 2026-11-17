'use client';

import { useEffect, useRef } from 'react';

import { applyWatermark, type WatermarkAssets } from '@/lib/images/watermark';
import { drawSamplePhoto } from '@/lib/images/samplePhoto';
import type { Watermark } from '@/lib/settings/parseWatermarkInput';

export type SampleShape = 'landscape' | 'portrait';
const SIZES: Record<SampleShape, { w: number; h: number }> = { landscape: { w: 1600, h: 1067 }, portrait: { w: 1067, h: 1600 } };

/**
 * The live preview: the generated sample photo with the watermark drawn by `applyWatermark`, the
 * same function Phase 5's upload worker bakes with. Redrawn 100 ms after the last change. The canvas
 * keeps the photo's full size (so the geometry is the real one) and is scaled down by CSS.
 */
export function WatermarkPreview({ watermark, assets, shape }: { watermark: Watermark; assets: WatermarkAssets; shape: SampleShape }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { w, h } = SIZES[shape];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const ctx = ref.current?.getContext('2d');
      if (!ctx) return; // jsdom, or a browser without canvas: the form still works
      drawSamplePhoto(ctx, w, h);
      if (watermark.kind !== 'none') applyWatermark(ctx, { w, h }, watermark, assets);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [watermark, assets, w, h]);

  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      role="img"
      aria-label={`A ${shape} sample photo with the watermark as it will be drawn`}
      className={shape === 'landscape' ? 'h-auto w-full rounded-control' : 'mx-auto h-auto w-2/3 rounded-control sm:w-1/2'}
    />
  );
}
