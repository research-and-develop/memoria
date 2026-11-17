/**
 * PUT a file straight to a signed URL (a presigned R2 PUT in production, the development upload
 * route locally) with progress (plan p04 T4.5; Phase 5 reuses it for photos). Browser code. The
 * request sends exactly the signed headers: another Content-Type fails the signature (or the dev
 * token). `XMLHttpRequest` because `fetch` reports no upload progress.
 */
export type SignedUpload = { url: string; method: 'PUT'; headers: Record<string, string> };

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export function putToSignedUrl(
  file: Blob,
  upload: SignedUpload,
  { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Upload cancelled', 'AbortError'));
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadError(`Upload failed (HTTP ${xhr.status})`, xhr.status)));
    xhr.onerror = () => reject(new UploadError('Upload failed (network)', 0));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
