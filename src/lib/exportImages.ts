import JSZip from 'jszip';
import { AgentData } from '@/types/analysis';

const SUPABASE_URL = "https://kcuuymecihfjgqmvybzk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtjdXV5bWVjaWhmamdxbXZ5YnprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NTY2MDcsImV4cCI6MjA5MTMzMjYwN30.YMF3BIuGkfVRna2B02OlpOv64h9CCkqma7ZqQS41fBw";

async function fetchImageViaProxy(url: string): Promise<Blob | null> {
  // Try direct fetch first (faster, no edge function overhead)
  try {
    const r = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
    if (r.ok) {
      const b = await r.blob();
      if (b.size > 0) return b;
    }
  } catch {
    // fallthrough to proxy
  }
  try {
    const proxyUrl = `${SUPABASE_URL}/functions/v1/proxy-image?url=${encodeURIComponent(url)}&apikey=${SUPABASE_ANON}`;
    const r = await fetch(proxyUrl);
    if (r.ok) {
      const b = await r.blob();
      if (b.size > 0) return b;
    }
  } catch {
    // skip
  }
  return null;
}

function sanitize(name: string): string {
  return (name || 'Sem Nome').replace(/[\\/:*?"<>|]/g, '_').trim() || 'Sem Nome';
}

export async function exportImagesToZip(agents: AgentData[], onProgress?: (pct: number) => void) {
  const zip = new JSZip();
  const allPhotos: { folder: string; url: string; name: string }[] = [];

  for (const agent of agents) {
    const companyFolder = sanitize(agent.companyName || 'Sem Empresa');
    const subFolder = sanitize(`${agent.name} (Linha ${agent.excelRow})`);
    const folder = `${companyFolder}/${subFolder}`;
    agent.photos.forEach((photo, idx) => {
      allPhotos.push({ folder, url: photo.url, name: `foto_${idx + 1}.jpg` });
    });
  }

  if (allPhotos.length === 0) return;

  let done = 0;
  for (const item of allPhotos) {
    const blob = await fetchImageViaProxy(item.url);
    if (blob && blob.size > 0) {
      zip.file(`${item.folder}/${item.name}`, blob);
    }
    done++;
    onProgress?.(Math.round((done / allPhotos.length) * 100));
  }

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fotos_visitas.zip';
  a.click();
  URL.revokeObjectURL(url);
}

export { fetchImageViaProxy };
