export interface PhotoAnalysis {
  aprovada: boolean;
  criterios: {
    fachada: boolean;
    empresario: boolean;
    interior: boolean;
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
  photos: AgentPhoto[];
}

export type FilterType = 'all' | 'approved' | 'inconsistent';
