import JSZip from 'jszip';
import { AgentData } from '@/types/analysis';

export async function exportImagesToZip(agents: AgentData[], onProgress?: (pct: number) => void) {
  const zip = new JSZip();
  const allPhotos: { folder: string; url: string; name: string }[] = [];

  for (const agent of agents) {
    const folder = agent.companyName || agent.name;
    agent.photos.forEach((photo, idx) => {
      allPhotos.push({ folder, url: photo.url, name: `foto_${idx + 1}.jpg` });
    });
  }

  let done = 0;
  for (const item of allPhotos) {
    try {
      const response = await fetch(item.url);
      if (response.ok) {
        const blob = await response.blob();
        zip.file(`${item.folder}/${item.name}`, blob);
      }
    } catch {
      // skip failed downloads
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
