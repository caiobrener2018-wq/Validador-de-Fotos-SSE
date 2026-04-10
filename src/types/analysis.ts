export interface PhotoAnalysis {
  aprovada: boolean;
  criterios: {
    fachada: boolean;
    empresario: boolean;
    interior: boolean;
    fundo_valido: boolean;
    contexto_segmento: boolean;
  };
  justificativa: string;
}

export interface AgentPhoto {
  url: string;
  analysis?: PhotoAnalysis;
  status: 'pending' | 'analyzing' | 'done' | 'error';
  error?: string;
}

export interface AgentData {
  name: string;
  companyName: string;
  segment: string;
  photos: AgentPhoto[];
}

export type FilterType = 'all' | 'approved' | 'inconsistent';
