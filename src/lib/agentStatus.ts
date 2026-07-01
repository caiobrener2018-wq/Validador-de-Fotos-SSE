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

  // Aprovado APENAS se tiver agente E empresário/funcionário (e não for IA)
  const anyApproved = donePhotos.some(p => {
    const c = p.analysis!.criterios;
    return c.agente_sebrae && c.empresario_ou_funcionario;
  });
  if (anyApproved) return 'approved';

  // Sinalizações graves só prevalecem quando não houve aprovação
  if (photos.some(p => p.status === 'ai_generated')) return 'ai_generated';
  if (photos.some(p => p.status === 'duplicate')) return 'duplicate';

  // Se há fotos analisadas mas nenhuma tem empresário/funcionário detectado,
  // marca como "sem empresário" — independente de o agente ter sido identificado ou não.
  // (Cobre o caso onde o modelo não identifica o agente por falta de referência,
  //  mas a foto claramente mostra apenas 1 pessoa.)
  if (donePhotos.length > 0 && donePhotos.every(p => !p.analysis!.criterios.empresario_ou_funcionario)) {
    return 'no_business_person';
  }

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

/** Retorna o status efetivo: override manual se definido, senão o status computado. */
export function getEffectiveStatus(agent: AgentData): AgentStatus {
  return agent.statusOverride ?? getAgentStatus(agent);
}

/** Status disponíveis para override manual pelo operador. */
export const EDITABLE_STATUSES: { value: AgentStatus; label: string }[] = [
  { value: 'approved', label: 'Aprovado' },
  { value: 'no_business_person', label: 'Sem empresário' },
  { value: 'inconsistent', label: 'Inconsistência' },
  { value: 'duplicate', label: 'Duplicada' },
  { value: 'ai_generated', label: 'IA' },
];
