/** The pixel size of an image file, decoded by the browser (the bitmap is released at once). */
export async function readImageSize(file: Blob): Promise<{ w: number; h: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    return { w: bitmap.width, h: bitmap.height };
  } finally {
    bitmap.close();
  }
}
