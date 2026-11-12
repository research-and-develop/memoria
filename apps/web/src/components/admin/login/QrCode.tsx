'use client';

import { encode } from 'uqr';

/**
 * A QR code as one SVG path, dark modules on a light ground with the
 * standard 4-module quiet zone (scanners need dark on light). Loaded with
 * `next/dynamic` only on the enrolment screens. `label` is its accessible name.
 */
export function QrCode({ value, label, size = 200 }: { value: string; label: string; size?: number }) {
  const { data } = encode(value, { ecc: 'M', border: 4 });
  const modules = data.length;
  let d = '';
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    });
  });
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
      className="h-auto max-w-full shrink-0 rounded-control border border-line"
    >
      <rect width={modules} height={modules} className="fill-surface" />
      <path d={d} className="fill-ink" />
    </svg>
  );
}
