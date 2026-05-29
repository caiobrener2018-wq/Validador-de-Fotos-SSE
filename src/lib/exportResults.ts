import { AgentData } from '@/types/analysis';
import { fetchImageViaProxy } from './exportImages';
import { getAgentStatus, AGENT_STATUS_LABEL } from './agentStatus';

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function detectExt(blob: Blob): 'jpeg' | 'png' {
  const t = (blob.type || '').toLowerCase();
  if (t.includes('png')) return 'png';
  return 'jpeg';
}

export async function exportResultsToExcel(agents: AgentData[], onProgress?: (pct: number) => void) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Resultados');

  ws.columns = [
    { header: 'Linha Excel', key: 'row', width: 12 },
    { header: 'Agente', key: 'agent', width: 28 },
    { header: 'Agência SSE', key: 'agency', width: 24 },
    { header: 'Empresa', key: 'company', width: 30 },
    { header: 'Segmento', key: 'segment', width: 22 },
    { header: 'Foto 1', key: 'p1', width: 22 },
    { header: 'Foto 2', key: 'p2', width: 22 },
    { header: 'Foto 3', key: 'p3', width: 22 },
    { header: 'Status Geral', key: 'status', width: 18 },
    { header: 'Justificativas', key: 'just', width: 60 },
  ];

  // Header style
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 22;

  // Pre-count all photos for progress
  const totalImages = agents.reduce((s, a) => s + a.photos.length, 0);
  let processed = 0;

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const rowNum = i + 2;
    const row = ws.getRow(rowNum);
    row.height = 110;

    const status = getAgentStatus(agent);
    const statusLabel = AGENT_STATUS_LABEL[status].toUpperCase();

    const justificativas = agent.photos
      .map((p, idx) => {
        if (p.status === 'ai_generated') {
          return `Foto ${idx + 1}: GERADA POR IA${p.analysis?.justificativa ? ` — ${p.analysis.justificativa}` : ''}`;
        }
        if (p.status === 'duplicate') {
          return `Foto ${idx + 1}: DUPLICADA${p.duplicateOf ? ` (já enviada por ${p.duplicateOf.agent} - ${p.duplicateOf.company}, linha ${p.duplicateOf.row})` : ''}`;
        }
        if (p.analysis) return `Foto ${idx + 1}: ${p.analysis.justificativa}`;
        if (p.error) return `Foto ${idx + 1}: ${p.error}`;
        return '';
      })
      .filter(Boolean)
      .join('\n') || (status === 'no_photos' ? 'Agente não enviou fotos para este atendimento.' : '');

    row.getCell('row').value = agent.excelRow;
    row.getCell('agent').value = agent.name;
    row.getCell('agency').value = agent.agency;
    row.getCell('company').value = agent.companyName;
    row.getCell('segment').value = agent.segment;
    row.getCell('status').value = statusLabel;
    row.getCell('just').value = justificativas;
    row.getCell('just').alignment = { wrapText: true, vertical: 'top' };
    row.alignment = { vertical: 'middle' };

    // Status color
    const statusCell = row.getCell('status');
    statusCell.alignment = { horizontal: 'center', vertical: 'middle' };
    statusCell.font = { bold: true };
    const palette: Record<string, { bg: string; fg: string }> = {
      approved: { bg: 'FFD1FAE5', fg: 'FF065F46' },
      inconsistent: { bg: 'FFFEE2E2', fg: 'FF991B1B' },
      no_photos: { bg: 'FFFEF3C7', fg: 'FF92400E' },
      duplicate: { bg: 'FFFFEDD5', fg: 'FF9A3412' },
      ai_generated: { bg: 'FFEDE9FE', fg: 'FF5B21B6' },
      no_business_person: { bg: 'FFFEF3C7', fg: 'FF92400E' },
    };
    const colors = palette[status];
    if (colors) {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.bg } };
      statusCell.font = { bold: true, color: { argb: colors.fg } };
    }

    // Embed photos in cells (Foto 1, Foto 2, Foto 3 -> columns 6,7,8)
    for (let idx = 0; idx < 3; idx++) {
      const photo = agent.photos[idx];
      if (!photo) {
        processed++;
        continue;
      }
      try {
        const blob = await fetchImageViaProxy(photo.url);
        if (blob && blob.size > 0) {
          const base64 = await blobToBase64(blob);
          const ext = detectExt(blob);
          const imageId = wb.addImage({ base64, extension: ext });
          const colIdx = 5 + idx; // 0-based column index for Foto 1 (col 6 = index 5)
          ws.addImage(imageId, {
            tl: { col: colIdx + 0.05, row: (rowNum - 1) + 0.05 },
            ext: { width: 140, height: 140 },
            editAs: 'oneCell',
          });
        } else {
          row.getCell(`p${idx + 1}`).value = photo.url;
        }
      } catch {
        row.getCell(`p${idx + 1}`).value = photo.url;
      }
      processed++;
      if (totalImages > 0) onProgress?.(Math.round((processed / totalImages) * 100));
    }
  }

  // Borders for clean look
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      };
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'relatorio_validacao_fotos.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}
