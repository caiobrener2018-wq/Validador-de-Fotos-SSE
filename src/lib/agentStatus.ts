import { AgentData } from '@/types/analysis';

export type AgentStatus =
  | 'pending'
  | 'analyzing'
  | 'no_photos'
  | 'ai_generated'
  | 'duplicate'
  | 'no_business_person'
  | 'approved'
  | 'inconsistent';

const FINAL_STATUSES = new Set(['done', 'error', 'duplicate', 'ai_generated']);

export function getAgentStatus(agent: AgentData): AgentStatus {
  const photos = agent.photos;
  if (photos.length === 0) return 'no_photos';

  const allFinal = photos.every(p => FINAL_STATUSES.has(p.status));
  if (!allFinal) {
    return photos.some(p => p.status === 'analyzing') ? 'analyzing' : 'pending';
  }

  const donePhotos = photos.filter(p => p.status === 'done' && p.analysis);

  // Aprovado se QUALQUER foto satisfizer uma das condições:
  //   (a) agente + segunda pessoa (empresário/funcionário), OU
  //   (b) agente + contexto corporativo/fundo não vazio.
  // Também respeita `analysis.aprovada`, porque a Edge Function já normaliza
  // contradições do modelo (ex.: justificativa diz que aprovou, mas algum boolean veio errado).
  const anyApproved = donePhotos.some(p => {
    if (p.analysis!.aprovada) return true;
    const c = p.analysis!.criterios;
    if (!c.agente_sebrae) return false;
    return c.empresario_ou_funcionario || c.fachada || c.interior || c.fundo_valido;
  });
  if (anyApproved) return 'approved';

  // Sinalizações graves só prevalecem quando não houve aprovação
  if (photos.some(p => p.status === 'ai_generated')) return 'ai_generated';
  if (photos.some(p => p.status === 'duplicate')) return 'duplicate';

  return 'inconsistent';
}

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  pending: 'Pendente',
  analyzing: 'Analisando',
  no_photos: 'Sem fotos',
  ai_generated: 'IA',
  duplicate: 'Duplicada',
  no_business_person: 'Sem empresário',
  approved: 'Aprovado',
  inconsistent: 'Inconsistência',
};
