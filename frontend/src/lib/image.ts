/** Compression d'image côté client (capture mobile) avant upload.
 *  Redimensionne au plus grand côté `max` et ré-encode en JPEG qualité `q`. */
export async function compressImage(
  source: Blob,
  max = 1280,
  q = 0.8,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return source;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", q),
  );
  return blob ?? source;
}
