// receipts.js — receipt IMAGE upload and preview, stored client-side.
// The chosen image is resized (max 1280 px) and re-encoded as JPEG, then kept as a data URL in
// "exc:receipts" (separate from expenses so lists stay light). No server-side file storage.

import { createId, loadReceipts } from './storage.js';

export const RECEIPT_MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const RECEIPT_MAX_SIDE = 1280;
export const RECEIPT_QUALITY = 0.72;
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This image could not be read. Try a JPG or PNG file.'));
    image.src = src;
  });
}

// File → { ok, receipt: { dataUrl, fileName, mimeType, sizeBytes } } or { ok: false, error }.
export async function prepareReceipt(file) {
  if (!file) return { ok: false, error: 'Choose an image file.' };
  if (!RECEIPT_TYPES.includes(file.type)) return { ok: false, error: 'Receipts must be images (JPG, PNG, WEBP or GIF).' };
  if (file.size > RECEIPT_MAX_INPUT_BYTES) return { ok: false, error: 'The image is larger than 5 MB.' };

  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, RECEIPT_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; // JPEG has no transparency
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', RECEIPT_QUALITY);
    return {
      ok: true,
      receipt: { dataUrl, fileName: file.name.slice(0, 120), mimeType: 'image/jpeg', sizeBytes: dataUrlBytes(dataUrl) },
    };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function dataUrlBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1] ?? '';
  return Math.round((base64.length * 3) / 4);
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Adds the image to db.receipts (caller commits 'receipts') and returns the metadata stored on the expense.
export function attachReceipt(db, receipt) {
  db.receipts ??= loadReceipts();
  const id = createId('rcp');
  db.receipts[id] = receipt.dataUrl;
  return { id, fileName: receipt.fileName, mimeType: receipt.mimeType, sizeBytes: receipt.sizeBytes };
}

// The image for an expense the viewer is allowed to see (the caller checks permission first).
export function receiptImage(receiptMeta) {
  if (!receiptMeta) return null;
  return loadReceipts()[receiptMeta.id] ?? null;
}
