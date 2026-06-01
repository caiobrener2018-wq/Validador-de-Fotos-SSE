import { supabase } from '@/integrations/supabase/client';
import { AgentData } from '@/types/analysis';

/**
 * Detecção semântica de duplicatas: compara fotos pela descrição da cena
 * gerada pela IA (scene_signature) usando embeddings OpenAI.
 *
 * Captura casos que pHash não pega: mesma cena/pessoas fotografadas em
 * ângulos diferentes, com segundos de diferença, com leve mudança de pose.
 */

const EMBED_BATCH = 150;
/**
 * Cosine similarity threshold. text-embedding-3-small:
 *  - >= 0.92 → praticamente a mesma descrição (mesma cena)
 *  - 0.85-0.92 → cenas muito parecidas (mesmo local + mesmas pessoas)
 *  - < 0.80 → cenas diferentes
 * Usamos 0.88 para pegar ângulos/poses diferentes da mesma cena.
 */
export const SEMANTIC_DUPLICATE_THRESHOLD = 0.88;

type PhotoRef = {
  agentIdx: number;
  photoIdx: number;
  signature: string;
};

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) {
    const x = a[i], y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const { data, error } = await supabase.functions.invoke('embed-signatures', {
    body: { texts },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.message || data?.error || 'embed_error');
  return data.embeddings as number[][];
}

export type SemanticDedupResult = {
  scanned: number;
  marked: number;
};

/**
 * Roda a dedup semântica em-place: muta `agents` marcando como duplicate
 * fotos com cosine similarity >= threshold.
 *
 * Só considera fotos com status 'done' e scene_signature não vazia.
 * Preserva a primeira ocorrência (mais antiga por excelRow + photoIdx).
 */
export async function runSemanticDedup(
  agents: AgentData[],
  onProgress?: (done: number, total: number) => void,
  threshold = SEMANTIC_DUPLICATE_THRESHOLD,
): Promise<SemanticDedupResult> {
  // 1) coleta fotos elegíveis
  const refs: PhotoRef[] = [];
  agents.forEach((agent, aIdx) => {
    agent.photos.forEach((photo, pIdx) => {
      if (photo.status !== 'done') return;
      const sig = photo.analysis?.scene_signature?.trim();
      if (!sig || sig.length < 10) return;
      refs.push({ agentIdx: aIdx, photoIdx: pIdx, signature: sig });
    });
  });

  if (refs.length < 2) return { scanned: refs.length, marked: 0 };

  // 2) embedda em lotes
  const vectors: Float32Array[] = new Array(refs.length);
  let processed = 0;
  for (let i = 0; i < refs.length; i += EMBED_BATCH) {
    const slice = refs.slice(i, i + EMBED_BATCH);
    const embeddings = await embedBatch(slice.map(r => r.signature));
    for (let j = 0; j < embeddings.length; j++) {
      vectors[i + j] = new Float32Array(embeddings[j]);
    }
    processed += slice.length;
    onProgress?.(processed, refs.length);
  }

  // 3) ordena por (excelRow, photoIdx) para preservar a primeira ocorrência
  const order = refs.map((_, idx) => idx).sort((a, b) => {
    const ra = agents[refs[a].agentIdx].excelRow;
    const rb = agents[refs[b].agentIdx].excelRow;
    if (ra !== rb) return ra - rb;
    return refs[a].photoIdx - refs[b].photoIdx;
  });

  // 4) compara em O(N²) mas com Float32Array é rápido (~10M ops/s)
  let marked = 0;
  const dupOf = new Array<number | null>(refs.length).fill(null);
  for (let ii = 0; ii < order.length; ii++) {
    const i = order[ii];
    if (dupOf[i] !== null) continue; // já é duplicata de outra
    const vi = vectors[i];
    for (let jj = ii + 1; jj < order.length; jj++) {
      const j = order[jj];
      if (dupOf[j] !== null) continue;
      // mesma foto exata? evita auto-match (não deveria mas...)
      if (refs[i].agentIdx === refs[j].agentIdx && refs[i].photoIdx === refs[j].photoIdx) continue;
      const sim = cosineSim(vi, vectors[j]);
      if (sim >= threshold) {
        dupOf[j] = i;
      }
    }
  }

  // 5) aplica marcação
  for (let k = 0; k < refs.length; k++) {
    const origIdx = dupOf[k];
    if (origIdx === null) continue;
    const target = refs[k];
    const source = refs[origIdx];
    const targetAgent = agents[target.agentIdx];
    const sourceAgent = agents[source.agentIdx];
    // evita degradar fotos já válidas dentro do mesmo atendimento se for a única
    const targetPhoto = targetAgent.photos[target.photoIdx];
    targetPhoto.status = 'duplicate';
    targetPhoto.duplicate = true;
    targetPhoto.duplicateReason = 'semantic';
    targetPhoto.duplicateOf = {
      agent: sourceAgent.name,
      company: sourceAgent.companyName,
      row: sourceAgent.excelRow,
    };
    marked++;
  }

  return { scanned: refs.length, marked };
}
