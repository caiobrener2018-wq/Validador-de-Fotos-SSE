import * as XLSX from 'xlsx';
import { AgentData } from '@/types/analysis';

/** Normaliza cabeçalho: minúsculo, sem acentos, sem espaços extras. */
function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Mapeamento dos campos do app -> possíveis cabeçalhos (em ordem de preferência) + índice fallback. */
const FIELD_MAP: { key: string; headers: string[]; fallbackIdx: number }[] = [
  { key: 'agentName',       headers: ['nome atendente', 'agente', 'nome agente'],            fallbackIdx: 0 },
  { key: 'agency',          headers: ['empresa habilitada', 'agencia sse', 'agência sse'],    fallbackIdx: 1 },
  { key: 'cpfRespondente',  headers: ['cpf respondente'],                                     fallbackIdx: 9 },
  { key: 'companyName',     headers: ['razao social', 'razão social'],                        fallbackIdx: 12 },
  { key: 'cnpj',            headers: ['cnpj'],                                                fallbackIdx: 13 },
  { key: 'bairro',          headers: ['bairro cnpj', 'bairro'],                               fallbackIdx: 16 },
  { key: 'cidade',          headers: ['cidade cnpj', 'cidade'],                               fallbackIdx: 17 },
  { key: 'lote',            headers: ['lote'],                                                fallbackIdx: 18 },
];

const PHOTO_FALLBACK_IDXS = [34, 35, 36];

function findColumn(headers: string[], candidates: string[], fallbackIdx: number): number {
  const normalized = headers.map(norm);
  for (const cand of candidates) {
    const idx = normalized.indexOf(norm(cand));
    if (idx !== -1) return idx;
  }
  return fallbackIdx;
}

function findPhotoColumns(headers: string[]): number[] {
  // Procura todas as colunas cujo cabeçalho contenha "foto"
  const indices: number[] = [];
  headers.forEach((h, i) => {
    if (norm(h).includes('foto')) indices.push(i);
  });
  if (indices.length >= 1) {
    // Pega no máximo 3
    return indices.slice(0, 3);
  }
  return PHOTO_FALLBACK_IDXS;
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') {
    // Evita notação científica para CNPJs/CEPs/telefones grandes
    if (Number.isInteger(v) && Math.abs(v) > 1e9) return String(Math.trunc(v));
    return String(v);
  }
  return String(v).trim();
}

export function parseExcelFile(file: File): Promise<AgentData[]> {
  const sourceFile = file.name;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
        if (rows.length === 0) {
          resolve([]);
          return;
        }

        // Header = primeira linha (a planilha sempre vem com cabeçalhos)
        const headerRow = (rows[0] as unknown[]).map(v => cellToString(v));
        const startIdx = 1;

        const idxOf: Record<string, number> = {};
        for (const f of FIELD_MAP) {
          idxOf[f.key] = findColumn(headerRow, f.headers, f.fallbackIdx);
        }
        const photoIdxs = findPhotoColumns(headerRow);

        const agents: AgentData[] = [];
        for (let i = startIdx; i < rows.length; i++) {
          const row = rows[i] as unknown[];
          if (!row) continue;
          const name = cellToString(row[idxOf.agentName]);
          if (!name) continue;

          const rawRow: Record<string, unknown> = {};
          headerRow.forEach((h, j) => {
            // Mantém todas as colunas mesmo com cabeçalho vazio (usa índice como chave)
            const key = h || `__col_${j}`;
            rawRow[key] = row[j];
          });

          const photos = [] as AgentData['photos'];
          for (const j of photoIdxs) {
            const url = cellToString(row[j]);
            if (url && (url.startsWith('http') || url.startsWith('www'))) {
              photos.push({
                url: url.startsWith('www') ? `https://${url}` : url,
                status: 'pending' as const,
              });
            }
          }

          agents.push({
            name,
            agency: cellToString(row[idxOf.agency]),
            companyName: cellToString(row[idxOf.companyName]),
            segment: '',
            cpfRespondente: cellToString(row[idxOf.cpfRespondente]),
            cnpj: cellToString(row[idxOf.cnpj]),
            bairro: cellToString(row[idxOf.bairro]),
            cidade: cellToString(row[idxOf.cidade]),
            lote: cellToString(row[idxOf.lote]),
            sourceFile,
            excelRow: i + 1,
            photos,
            rawRow,
            rawHeaders: headerRow,
          });
        }

        // Detect duplicate photo URLs across all agents (mesma URL exata)
        const urlMap = new Map<string, { agent: string; company: string; row: number }>();
        agents.forEach(a => {
          a.photos.forEach(p => {
            const key = p.url.trim().toLowerCase();
            const existing = urlMap.get(key);
            if (existing) {
              p.duplicate = true;
              p.status = 'duplicate';
              p.duplicateOf = existing;
              p.duplicateReason = 'exact';
            } else {
              urlMap.set(key, { agent: a.name, company: a.companyName, row: a.excelRow });
            }
          });
        });

        resolve(agents);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
    reader.readAsArrayBuffer(file);
  });
}
