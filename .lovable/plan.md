# Aprimoramentos do Validador de Fotos

## 1. Detecção de fotos quase iguais (mesmo ambiente/pessoa)

Hoje a deduplicação é por SHA-256 — só pega bytes idênticos. Vou adicionar **perceptual hash (pHash 64-bit)** na edge function `analyze-photo`:

- Gerar pHash 8x8 DCT a partir da imagem já baixada (sem dependência externa, ~30 linhas de Deno).
- Retornar `perceptualHash` junto do `imageHash` atual.
- No `Index.tsx`, manter o mapa de hashes exatos **e** um índice de pHash. Para cada nova foto, calcular distância de Hamming contra os pHash já vistos; se `≤ 6 bits` de diferença → marcar como `duplicate` (com referência ao agente/empresa/linha original, igual hoje).
- Mantém deduplicação exata como atalho rápido antes de comparar perceptual.

## 2. Detecção de imagens geradas por IA

- Adicionar novo critério booleano `gerada_por_ia` ao schema de resposta do OpenAI.
- Ampliar o system prompt para instruir o modelo a procurar artefatos típicos de IA: mãos/dedos deformados, texto ilegível em placas/produtos, simetrias estranhas, iluminação inconsistente, fundo "plástico"/borrado anormal, olhos/orelhas assimétricos, repetição de padrões.
- Novo `status` no tipo `AgentPhoto`: `'ai_generated'`. Tem prioridade sobre `done`.
- Novo `FilterType`: `'ai_generated'` ("IA").
- Card e DashboardSummary ganham badge/contador "IA" (ícone `Sparkles` ou `Bot`, cor roxa).

## 3. Nova regra de aprovação do atendimento (bloco)

Lógica atual: qualquer foto com inconsistência derruba o atendimento. Nova lógica em `AgentCard` e nos filtros do `Index.tsx`:

```text
se alguma foto = ai_generated  → atendimento = "IA"          (prioridade máxima)
senão se alguma foto = duplicate → atendimento = "Duplicada"
senão se nenhuma foto tem empresário/funcionário → "Sem empresário"  (ver item 4)
senão se ao menos uma foto aprovada → "Aprovado"
senão → "Inconsistência"
```

Centralizar essa derivação numa função `getAgentStatus(agent)` em `src/lib/agentStatus.ts` para ser reusada por `AgentCard`, `DashboardSummary`, filtros e exports (`exportResults.ts`, `exportImages.ts`).

## 4. Novo filtro "Sem empresário"

Hoje o critério `empresario` mistura "agente + empresário". Vou desmembrar no prompt e schema:

- Novos campos em `criterios`: `agente_sebrae` (pessoa que parece ser o consultor/agente) e `empresario_ou_funcionario` (dono/funcionário do estabelecimento).
- Manter `empresario` como compatibilidade derivada (`agente_sebrae || empresario_ou_funcionario`) para não quebrar lógica antiga durante a transição — ou migrar tudo de uma vez (recomendo migrar).
- Atendimento marcado como **"Sem empresário"** quando: todas as fotos analisadas têm pessoas mas nenhuma tem `empresario_ou_funcionario = true` (só aparece o agente).
- Novo `FilterType`: `'no_business_person'`. Badge âmbar/laranja com ícone `UserX`.

## Detalhes técnicos

**Edge function `analyze-photo/index.ts`:**
- Acrescentar função `perceptualHash(bytes)`: decode JPEG/PNG via `Image` API do Deno? Deno não tem canvas nativo. Alternativa leve: usar `npm:sharp` não funciona no Edge Runtime. Vou usar **`npm:image-hash@5`** ou implementar pHash em JS puro processando os bytes via `npm:@jsquash/jpeg` + `@jsquash/png` (já WASM, suportados em Deno Edge). Se peso for problema, fallback: enviar a imagem 32x32 grayscale para o próprio GPT-4o-mini retornar o pHash junto — mas isso adiciona latência; preferimos WASM local.
- Expandir prompt e `response_format` (json_object) com os novos campos.
- Retornar `{ aprovada, criterios:{ fachada, agente_sebrae, empresario_ou_funcionario, interior, fundo_valido, contexto_segmento, gerada_por_ia }, justificativa, imageHash, perceptualHash }`.

**Tipos (`src/types/analysis.ts`):**
- `PhotoAnalysis.criterios` ganha `agente_sebrae`, `empresario_ou_funcionario`, `gerada_por_ia`.
- `AgentPhoto.status` ganha `'ai_generated'`.
- `AgentPhoto.perceptualHash?: string`.
- `FilterType` ganha `'ai_generated' | 'no_business_person'`.

**`src/pages/Index.tsx`:**
- Índice `perceptualHashes: Array<{ hash, agent, company, row }>` + função `hamming(a,b)`.
- Após receber resposta: se `gerada_por_ia` → status `'ai_generated'`; senão checar duplicado exato → perceptual ≤6 → senão `'done'`.
- Filtros e contadores usam `getAgentStatus`.

**Componentes:**
- `AgentCard`: novo badge "IA" (roxo) e "Sem empresário" (âmbar); exibir critério `gerada_por_ia` quando true; mostrar `agente_sebrae`/`empresario_ou_funcionario` como badges separados.
- `DashboardSummary`: dois novos cards — "IA" e "Sem empresário".
- Barra de filtros no `Index.tsx`: dois novos botões.

**Exports:**
- `exportResults.ts`: nova coluna "Status do Atendimento" usando `getAgentStatus`; coluna "Gerada por IA".
- `exportImages.ts`: pastas adicionais `/ia/` e `/sem_empresario/`.

## Pontos para confirmar antes de implementar

- **Limiar de near-duplicate**: `≤ 6 bits` em pHash de 64 bits é o padrão para "praticamente a mesma cena". Confirma ou prefere mais rígido (≤4) / mais frouxo (≤10)?
- **Distinguir agente Sebrae vs empresário visualmente**: a IA vai inferir pelo contexto (crachá Sebrae, postura de visita, roupas formais de consultor vs avental/uniforme do estabelecimento). Aceitável que possa haver alguma imprecisão? Se quiser sinal mais forte, podemos pedir que o usuário envie nome do agente para o prompt — hoje já temos `agent.name`.
