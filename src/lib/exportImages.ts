import JSZip from 'jszip';
import { AgentData } from '@/types/analysis';
import { supabase } from '@/integrations/supabase/client';

async function fetchImageViaProxy(url: string): Promise<Blob | null> {
  try {
    const { data, error } = await supabase.functions.invoke('proxy-image', {
      body: { url },
    });
    if (error) throw error;
    if (data instanceof Blob && data.size > 0) return data;
    return null;
  } catch {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.blob();
    } catch {
      // skip
    }
    return null;
  }
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
