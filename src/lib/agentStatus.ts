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

  // Regra principal: se QUALQUER foto mostra o agente acompanhado de um
  // empresário/funcionário num contexto válido (frente ou interior da empresa),
  // o atendimento é Aprovado — mesmo que outras fotos sejam ruins, duplicadas
  // ou marcadas como IA.
  const anyApproved = donePhotos.some(p => {
    const c = p.analysis!.criterios;
    const validContext = c.fachada || c.interior;
    return c.agente_sebrae && c.empresario_ou_funcionario && validContext;
  });
  if (anyApproved) return 'approved';

  // Sem aprovação: sinalizações graves
  if (photos.some(p => p.status === 'ai_generated')) return 'ai_generated';
  if (photos.some(p => p.status === 'duplicate')) return 'duplicate';

  if (donePhotos.length === 0) return 'inconsistent';

  // "Sem empresário": agente aparece no local, mas sem outra pessoa.
  const anyAgentOnSite = donePhotos.some(p => {
    const c = p.analysis!.criterios;
    return c.agente_sebrae && (c.fachada || c.interior);
  });
  if (anyAgentOnSite) return 'no_business_person';

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
