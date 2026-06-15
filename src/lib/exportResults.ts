import { AgentData } from '@/types/analysis';
import { getAgentStatus, AGENT_STATUS_LABEL, AgentStatus } from './agentStatus';

/**
 * Exporta um relatório espelhando a planilha original (todas as colunas, na mesma ordem)
 * e acrescenta 3 colunas finais: Status, Justificativa e Grupo CPF.
 *
 * Fotos saem como TEXTO/URL (não imagem embutida) para manter o arquivo leve.
 * Linhas são coloridas por status; o cabeçalho recebe AutoFilter para permitir
 * filtragem nativa pelo Excel.
 */
export async function exportResultsToExcel(agents: AgentData[], onProgress?: (pct: number) => void) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Resultados');

  // Calcula numeração "Grupo CPF": apenas Cpf Respondente que aparece em ≥ 2 CNPJs distintos.
  const cnpjsByCpf = new Map<string, Set<string>>();
  for (const a of agents) {
    if (!a.cpfRespondente || !a.cnpj) continue;
    let set = cnpjsByCpf.get(a.cpfRespondente);
    if (!set) {
      set = new Set();
      cnpjsByCpf.set(a.cpfRespondente, set);
    }
    set.add(a.cnpj);
  }
  const cpfGroup = new Map<string, number>();
  let groupCounter = 0;
  for (const [cpf, cnpjs] of cnpjsByCpf) {
    if (cnpjs.size >= 2) cpfGroup.set(cpf, ++groupCounter);
  }

  // Cabeçalho: prefere os cabeçalhos da planilha original; cai num fallback se ausentes.
  const firstWithHeaders = agents.find(a => a.rawHeaders && a.rawHeaders.length > 0);
  const baseHeaders: string[] = firstWithHeaders?.rawHeaders?.slice() ?? [
    'Nome Atendente', 'Empresa Habilitada', 'Cpf Respondente',
    'Razao Social', 'Cnpj', 'Bairro Cnpj', 'Cidade Cnpj', 'lote',
    'Foto 1', 'Foto 2', 'Foto 3',
  ];
  const extraHeaders = ['Status', 'Justificativa', 'Grupo CPF'];
  const headers = [...baseHeaders, ...extraHeaders];

  ws.addRow(headers);
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  headerRow.height = 22;

  // Larguras razoáveis (sem inflar): URL e textos longos ganham mais.
  headers.forEach((h, idx) => {
    const col = ws.getColumn(idx + 1);
    const nh = h.toLowerCase();
    if (nh.includes('foto')) col.width = 55;
    else if (nh.includes('justificativa')) col.width = 60;
    else if (nh.includes('anotac') || nh.includes('orientac') || nh.includes('devolutiva') || nh.includes('soluc')) col.width = 50;
    else if (nh.includes('status')) col.width = 18;
    else if (nh.includes('grupo')) col.width = 12;
    else if (nh.includes('cnpj') || nh.includes('cpf')) col.width = 20;
    else col.width = Math.max(14, Math.min(30, h.length + 2));
  });

  // Paleta por status — linha inteira recebe a cor de fundo.
  const palette: Record<AgentStatus, string | null> = {
    approved: 'FFE6F4EA',
    inconsistent: 'FFFADBD8',
    duplicate: 'FFFFF4CE',
    ai_generated: 'FFEADCF8',
    no_business_person: 'FFFCE5CD',
    no_photos: 'FFFEF3C7',
    pending: null,
    analyzing: null,
  };

  const total = agents.length || 1;
  let processed = 0;

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const status = getAgentStatus(agent);
    const statusLabel = AGENT_STATUS_LABEL[status];

    // Valores na ordem dos cabeçalhos originais
    const rowValues: unknown[] = baseHeaders.map(h => {
      if (agent.rawRow && Object.prototype.hasOwnProperty.call(agent.rawRow, h)) {
        const v = agent.rawRow[h];
        return v === undefined || v === null ? '' : v;
      }
      // Fallback simples se a planilha não tinha o cabeçalho
      const nh = h.toLowerCase();
      if (nh.includes('nome atendente') || nh === 'agente') return agent.name;
      if (nh.includes('habilitada') || nh.includes('agencia') || nh.includes('agência')) return agent.agency;
      if (nh.includes('razao') || nh.includes('razão')) return agent.companyName;
      if (nh.includes('cnpj')) return agent.cnpj ?? '';
      if (nh.includes('cpf respondente')) return agent.cpfRespondente ?? '';
      if (nh.includes('bairro')) return agent.bairro ?? '';
      if (nh.includes('cidade')) return agent.cidade ?? '';
      if (nh === 'lote') return agent.lote ?? '';
      if (nh.startsWith('foto 1')) return agent.photos[0]?.url ?? '';
      if (nh.startsWith('foto 2')) return agent.photos[1]?.url ?? '';
      if (nh.startsWith('foto 3')) return agent.photos[2]?.url ?? '';
      return '';
    });

    // Justificativa breve e direta
    const justificativa = buildJustification(agent, status);
    const grupoCpf = agent.cpfRespondente ? cpfGroup.get(agent.cpfRespondente) ?? '' : '';

    rowValues.push(statusLabel, justificativa, grupoCpf);

    const row = ws.addRow(rowValues);
    row.alignment = { vertical: 'middle', wrapText: true };

    // Pinta a linha inteira com a cor do status
    const fillArgb = palette[status];
    if (fillArgb) {
      for (let c = 1; c <= headers.length; c++) {
        const cell = row.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
      }
    }

    // Hyperlink nas colunas de foto + força CNPJ/CPF como texto (preserva máscara)
    headers.forEach((h, idx) => {
      const cell = row.getCell(idx + 1);
      const nh = h.toLowerCase();
      const value = cell.value;
      if (nh.includes('foto') && typeof value === 'string' && /^https?:\/\//i.test(value)) {
        cell.value = { text: value, hyperlink: value };
        cell.font = { color: { argb: 'FF1D4ED8' }, underline: true };
      }
      if ((nh.includes('cnpj') || nh.includes('cpf')) && value !== null && value !== undefined && value !== '') {
        cell.numFmt = '@';
        cell.value = String(value);
      }
    });

    // Coluna de Status em negrito
    const statusCell = row.getCell(baseHeaders.length + 1);
    statusCell.font = { bold: true };
    statusCell.alignment = { horizontal: 'center', vertical: 'middle' };

    processed++;
    if (processed % 50 === 0) onProgress?.(Math.round((processed / total) * 100));
  }

  // AutoFilter sobre toda a faixa de dados
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: ws.rowCount, column: headers.length },
  };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  onProgress?.(100);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'relatorio_validacao_fotos.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

function buildJustification(agent: AgentData, status: AgentStatus): string {
  if (status === 'no_photos') return 'Nenhuma foto enviada.';

  if (status === 'duplicate') {
    const dup = agent.photos.find(p => p.status === 'duplicate');
    if (!dup) return 'Foto duplicada.';
    const reason =
      dup.duplicateReason === 'semantic' ? 'Cena duplicada (mesma situação fotografada novamente)' :
      dup.duplicateReason === 'near' ? 'Foto quase idêntica a outra' :
      'Foto idêntica a outra';
    if (dup.duplicateOf) {
      return `${reason} — original: linha ${dup.duplicateOf.row} (${dup.duplicateOf.agent} / ${dup.duplicateOf.company}).`;
    }
    return `${reason}.`;
  }

  if (status === 'ai_generated') {
    const ai = agent.photos.find(p => p.status === 'ai_generated');
    const idx = ai ? agent.photos.indexOf(ai) + 1 : 0;
    return `Traços de IA generativa detectados${idx ? ` na foto ${idx}` : ''}.`;
  }

  if (status === 'no_business_person') {
    return 'Nenhuma das fotos apresenta empresário/funcionário ao lado do agente.';
  }

  if (status === 'inconsistent') {
    const reasons = agent.photos
      .map((p, i) => {
        if (p.status === 'error') return `Foto ${i + 1}: ${p.error || 'erro na análise'}`;
        if (p.analysis && !p.analysis.aprovada) return `Foto ${i + 1}: ${p.analysis.justificativa}`;
        return '';
      })
      .filter(Boolean)
      .slice(0, 2)
      .join(' | ');
    return reasons || 'Inconsistência identificada nas fotos.';
  }

  if (status === 'approved') return 'OK';
  return '';
}
