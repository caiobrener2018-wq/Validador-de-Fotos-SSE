import * as XLSX from 'xlsx';
import { AgentData } from '@/types/analysis';

export function parseExcelFile(file: File): Promise<AgentData[]> {
  const sourceFile = file.name;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        // Detect header row
        const firstCell = rows.length > 0 && typeof rows[0][0] === 'string' ? rows[0][0].toLowerCase() : '';
        const startIdx = (firstCell.includes('agente') || firstCell.includes('nome') || firstCell.includes('consultor')) ? 1 : 0;

        const agents: AgentData[] = [];
        for (let i = startIdx; i < rows.length; i++) {
          const row = rows[i];
          if (!row || !row[0]) continue;
          const name = String(row[0]).trim();
          if (!name) continue;

          const agency = row[1] ? String(row[1]).trim() : '';
          const companyName = row[2] ? String(row[2]).trim() : '';
          const segment = row[3] ? String(row[3]).trim() : '';

          const photos = [];
          for (let j = 4; j <= 6; j++) {
            const url = row[j] ? String(row[j]).trim() : '';
            if (url && (url.startsWith('http') || url.startsWith('www'))) {
              photos.push({ url: url.startsWith('www') ? `https://${url}` : url, status: 'pending' as const });
            }
          }

          if (photos.length > 0) {
            agents.push({ name, agency, companyName, segment, sourceFile, excelRow: i + 1, photos });
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
