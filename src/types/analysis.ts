export interface PhotoAnalysis {
  aprovada: boolean;
  criterios: {
    fachada: boolean;
    /** Pessoa que parece ser o consultor/agente Sebrae (visitante). */
    agente_sebrae: boolean;
    /** Empresário, sócio ou funcionário do estabelecimento visitado. */
    empresario_ou_funcionario: boolean;
    interior: boolean;
    fundo_valido: boolean;
    contexto_segmento: boolean;
    /** Indica indícios de imagem gerada/alterada por IA. */
    gerada_por_ia: boolean;
  };
  /** Descrição padronizada da cena, usada para detecção semântica de duplicatas. */
  scene_signature?: string;
  justificativa: string;
}

export interface AgentPhoto {
  url: string;
  analysis?: PhotoAnalysis;
  status: 'pending' | 'analyzing' | 'done' | 'error' | 'duplicate' | 'ai_generated';
  error?: string;
  duplicate?: boolean;
  duplicateOf?: { agent: string; company: string; row: number };
  /** Motivo da duplicação para exibir na UI. */
  duplicateReason?: 'exact' | 'near' | 'semantic';
  /** Hash exato do conteúdo (SHA-256). */
  imageHash?: string;
  /** Hash perceptual (aHash 256-bit em hex) para detectar fotos quase iguais. */
  perceptualHash?: string;
}

export interface AgentData {
  name: string;
  agency: string;
  companyName: string;
  /** Mantido opcional apenas para retrocompatibilidade. Não é mais lido. */
  segment: string;
  /** CPF do empresário/respondente (coluna J). */
  cpfRespondente?: string;
  /** CNPJ da empresa (coluna N). */
  cnpj?: string;
  bairro?: string;
  cidade?: string;
  lote?: string;
  sourceFile: string;
  excelRow: number;
  photos: AgentPhoto[];
  /** Linha completa da planilha original, mapeada por cabeçalho. */
  rawRow?: Record<string, unknown>;
  /** Cabeçalhos originais, em ordem, para reconstruir a planilha no export. */
  rawHeaders?: string[];
}

export type FilterType =
  | 'all'
  | 'approved'
  | 'inconsistent'
  | 'duplicate'
  | 'no_photos'
  | 'ai_generated'
  | 'no_business_person';
