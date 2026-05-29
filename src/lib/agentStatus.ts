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

  // Prioridade máxima: qualquer foto gerada por IA derruba o atendimento.
  if (photos.some(p => p.status === 'ai_generated')) return 'ai_generated';
  // Em seguida: qualquer foto duplicada.
  if (photos.some(p => p.status === 'duplicate')) return 'duplicate';

  const donePhotos = photos.filter(p => p.status === 'done' && p.analysis);
  if (donePhotos.length === 0) return 'inconsistent';

  // "Sem empresário": nenhuma foto válida mostra empresário/funcionário.
  const anyHasBusinessPerson = donePhotos.some(p => p.analysis!.criterios.empresario_ou_funcionario);
  if (!anyHasBusinessPerson) return 'no_business_person';

  // Aprovado se ao menos uma foto for considerada aprovada pela IA.
  const anyApproved = donePhotos.some(p => p.analysis!.aprovada);
  return anyApproved ? 'approved' : 'inconsistent';
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
