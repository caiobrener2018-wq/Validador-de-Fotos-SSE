import * as XLSX from 'xlsx';
import { AgentData } from '@/types/analysis';

export function exportResultsToExcel(agents: AgentData[]) {
  const rows: any[][] = [
    ['Agente', 'Empresa', 'Segmento',
     'Foto 1 - URL', 'Foto 1 - Status', 'Foto 1 - Fachada', 'Foto 1 - Empresário', 'Foto 1 - Interior', 'Foto 1 - Fundo', 'Foto 1 - Segmento', 'Foto 1 - Justificativa',
     'Foto 2 - URL', 'Foto 2 - Status', 'Foto 2 - Fachada', 'Foto 2 - Empresário', 'Foto 2 - Interior', 'Foto 2 - Fundo', 'Foto 2 - Segmento', 'Foto 2 - Justificativa',
     'Foto 3 - URL', 'Foto 3 - Status', 'Foto 3 - Fachada', 'Foto 3 - Empresário', 'Foto 3 - Interior', 'Foto 3 - Fundo', 'Foto 3 - Segmento', 'Foto 3 - Justificativa']
  ];

  for (const agent of agents) {
    const row: any[] = [agent.name, agent.companyName, agent.segment];
    for (let i = 0; i < 3; i++) {
      const photo = agent.photos[i];
      if (photo && photo.analysis) {
        row.push(photo.url);
        row.push(photo.analysis.aprovada ? 'APROVADA' : 'INCONSISTÊNCIA');
        row.push(photo.analysis.criterios.fachada ? 'Sim' : 'Não');
        row.push(photo.analysis.criterios.empresario ? 'Sim' : 'Não');
        row.push(photo.analysis.criterios.interior ? 'Sim' : 'Não');
        row.push(photo.analysis.criterios.fundo_valido ? 'Válido' : 'Inválido');
        row.push(photo.analysis.criterios.contexto_segmento ? 'Compatível' : 'Incompatível');
        row.push(photo.analysis.justificativa);
      } else if (photo) {
        row.push(photo.url, photo.error || 'Não analisada', '', '', '', '', '', '');
      } else {
        row.push('', '', '', '', '', '', '', '');
      }
    }
    rows.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  
  ws['!cols'] = [
    { wch: 30 }, { wch: 30 }, { wch: 20 },
    ...Array(24).fill(null).map((_, i) => ({ wch: i % 8 === 0 ? 40 : i % 8 === 7 ? 50 : 15 }))
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
  XLSX.writeFile(wb, 'relatorio_validacao_fotos.xlsx');
}
