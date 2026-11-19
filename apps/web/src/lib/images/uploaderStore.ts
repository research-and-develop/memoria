import { notifyApiResponse } from '@repo/ui/hooks/apiEvents';

import { createImagePool, type ImagePool } from './imagePool';
import { probeFile } from './probe';
import { putToSignedUrl } from './upload';
import { createUploader, UploadApiError, type Uploader } from './uploader';

/**
 * One uploader per gallery for the page (plan p05: "a module-level store the manager subscribes to",
 * so switching sets or re-rendering keeps it running). Kept on `globalThis` (AGENTS.md → Workspace
 * rules). The worker pool is created on the first file and terminated when the queue drains.
 * Browser only.
 */

const KEY = '__memoriaUploaders';

/**
 * POST JSON to an admin route and unwrap the envelope (`useApi` speaks the same one). A failure's
 * sentence is `details.message` when the route gave one (an `AppError` whose message is its code),
 * else `error`; a 5xx never shows the server's text.
 */
export async function postJson<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal, credentials: 'same-origin' });
  notifyApiResponse({ url, method: 'POST', status: response.status, headers: response.headers });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw error;
  }
  const envelope = (json ?? {}) as { data?: T; error?: string; errorCode?: string; details?: { message?: unknown } };
  if (envelope.error) {
    const sentence = typeof envelope.details?.message === 'string' ? envelope.details.message : response.status < 500 && envelope.error !== envelope.errorCode ? envelope.error : 'Something went wrong. Try again.';
    throw new UploadApiError(sentence, response.status, envelope.errorCode ?? 'HTTP_ERROR');
  }
  if (!response.ok || !('data' in envelope)) throw new UploadApiError(`The server answered ${response.status}. Try again.`, response.status, 'HTTP_ERROR');
  return envelope.data as T;
}

function uploaders(): Map<string, Uploader> {
  const holder = globalThis as unknown as Record<string, Map<string, Uploader> | undefined>;
  holder[KEY] ??= new Map();
  return holder[KEY];
}

export function uploaderFor(galleryId: string): Uploader {
  const map = uploaders();
  let uploader = map.get(galleryId);
  if (!uploader) {
    let pool: ImagePool | null = null;
    uploader = createUploader({
      probe: probeFile,
      process: (file, options, run) => (pool ??= createImagePool()).process(file, options, run),
      post: postJson,
      put: putToSignedUrl,
      onIdle: () => {
        pool?.destroy();
        pool = null;
      },
    });
    map.set(galleryId, uploader);
  }
  return uploader;
}
