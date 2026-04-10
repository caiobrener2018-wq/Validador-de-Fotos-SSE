import * as XLSX from 'xlsx';
import { AgentData } from '@/types/analysis';

export function parseExcelFile(file: File): Promise<AgentData[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        const startIdx = rows.length > 0 && typeof rows[0][0] === 'string' &&
          (rows[0][0].toLowerCase().includes('agente') || rows[0][0].toLowerCase().includes('nome') || rows[0][0].toLowerCase().includes('consultor'))
          ? 1 : 0;

        const agents: AgentData[] = [];
        for (let i = startIdx; i < rows.length; i++) {
          const row = rows[i];
          if (!row || !row[0]) continue;
          const name = String(row[0]).trim();
          if (!name) continue;

          const companyName = row[1] ? String(row[1]).trim() : '';
          const segment = row[2] ? String(row[2]).trim() : '';

          const photos = [];
          for (let j = 3; j <= 5; j++) {
            const url = row[j] ? String(row[j]).trim() : '';
            if (url && (url.startsWith('http') || url.startsWith('www'))) {
              photos.push({ url: url.startsWith('www') ? `https://${url}` : url, status: 'pending' as const });
            }
          }

          if (photos.length > 0) {
            agents.push({ name, companyName, segment, photos });
          }
        }

        resolve(agents);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
    reader.readAsArrayBuffer(file);
  });
}
