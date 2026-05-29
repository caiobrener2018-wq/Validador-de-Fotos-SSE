// Hash perceptual (aHash) calculado no browser para detectar fotos quase iguais
// (mesmo ambiente / mesma pessoa, com pequenas diferenças de enquadramento).
// 16x16 grayscale = 256 bits, codificados como 64 caracteres hex.

const SUPABASE_URL = "https://kcuuymecihfjgqmvybzk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtjdXV5bWVjaWhmamdxbXZ5YnprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NTY2MDcsImV4cCI6MjA5MTMzMjYwN30.YMF3BIuGkfVRna2B02OlpOv64h9CCkqma7ZqQS41fBw";

const HASH_SIZE = 16; // 16x16 = 256 bits
const PIXELS = HASH_SIZE * HASH_SIZE;

async function fetchImageBlob(url: string): Promise<Blob | null> {
  try {
    const r = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
    if (r.ok) {
      const b = await r.blob();
      if (b.size > 0) return b;
    }
  } catch { /* fallthrough */ }
  try {
    const proxy = `${SUPABASE_URL}/functions/v1/proxy-image?url=${encodeURIComponent(url)}&apikey=${SUPABASE_ANON}`;
    const r = await fetch(proxy);
    if (r.ok) {
      const b = await r.blob();
      if (b.size > 0) return b;
    }
  } catch { /* ignore */ }
  return null;
}

export async function computePerceptualHash(url: string): Promise<string | null> {
  try {
    const blob = await fetchImageBlob(url);
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(HASH_SIZE, HASH_SIZE);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = HASH_SIZE;
      canvas.height = HASH_SIZE;
    }
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) { bitmap.close?.(); return null; }
    ctx.drawImage(bitmap, 0, 0, HASH_SIZE, HASH_SIZE);
    const { data } = ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE);
    bitmap.close?.();

    const gray = new Float32Array(PIXELS);
    let sum = 0;
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      gray[j] = g;
      sum += g;
    }
    const mean = sum / PIXELS;

    // 256 bits -> 64 nibbles (4 bits cada)
    let hex = '';
    for (let n = 0; n < PIXELS; n += 4) {
      let v = 0;
      for (let k = 0; k < 4; k++) v = (v << 1) | (gray[n + k] > mean ? 1 : 0);
      hex += v.toString(16);
    }
    return hex;
  } catch {
    return null;
  }
}

const POPCOUNT = new Uint8Array(16);
for (let i = 0; i < 16; i++) {
  let c = 0, v = i;
  while (v) { c += v & 1; v >>= 1; }
  POPCOUNT[i] = c;
}

export function hammingHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    dist += POPCOUNT[(parseInt(a[i], 16) ^ parseInt(b[i], 16)) & 0xf];
  }
  return dist;
}

/** Limiar em bits para considerar duas fotos como "praticamente a mesma cena". */
export const NEAR_DUPLICATE_THRESHOLD = 10; // sobre 256 bits (~4%)
