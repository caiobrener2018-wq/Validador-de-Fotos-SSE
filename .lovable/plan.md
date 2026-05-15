## Objetivo

Substituir o Lovable AI Gateway pela API paga do OpenAI (segredo `API_CHAT_RENATINHA`) e remover o sistema de workers/concorrência fixa, permitindo throughput máximo limitado apenas pela própria API.

## Mudanças

### 1. `supabase/functions/analyze-photo/index.ts`
- Remover uso de `LOVABLE_API_KEY` e do endpoint `ai.gateway.lovable.dev`.
- Passar a usar `Deno.env.get("API_CHAT_RENATINHA")` chamando `https://api.openai.com/v1/chat/completions`.
- Modelo: `gpt-4o-mini` (rápido, multimodal, barato — ideal para alto volume de análise de imagens). Mantém o mesmo formato `image_url` que já está no código.
- Manter o cálculo de `sha256` para deduplicação e o mesmo schema de resposta JSON (aprovada/criterios/justificativa).
- Manter mapeamento de erros: 429 → `rate_limit`, 402/insufficient_quota → `credits_exhausted`.

### 2. `supabase/functions/get-key-count/index.ts`
- Sem função real agora; pode retornar `{ count: 1 }` (uma única API). Será usado apenas para compatibilidade.

### 3. `src/pages/Index.tsx` — remover sistema de workers
- Remover `PER_WORKER_CONCURRENCY`, `keyCount`, `slots` e o loop `Array.from({ length: slots }, worker)`.
- Substituir por um **pool dinâmico sem limite fixo de workers**: dispara TODAS as tarefas de uma vez em paralelo via `Promise.all(tasks.map(launch))`, deixando o navegador/fetch e a API do OpenAI ditarem o ritmo real.
  - Alternativa de segurança: limitar a um teto alto (ex.: 100 requisições simultâneas) para evitar travar o navegador com 40 mil fotos disparadas literalmente ao mesmo tempo. **Recomendo esse teto de 100** porque sem nenhum limite o browser pode estourar memória/conexões TCP com planilhas grandes — a API do OpenAI ainda será o gargalo, não o teto.
- Remover chamada a `get-key-count` e o estado `keyCount`.
- Remover `keyIndex` (já removido) e qualquer referência a "workers" na UI; mensagem de progresso passa a ser apenas `"Analisando fotos..."`.
- Manter pausar/cancelar, retry com backoff, throttle de re-render (FLUSH_INTERVAL), dedup por hash.

### 4. Retentativas
- Manter `analyzeWithRetry` com 8 tentativas e backoff exponencial — importante porque ao disparar 100 em paralelo, vamos bater 429 com frequência e o backoff naturalmente encontra o ritmo sustentável da API.

## Pontos técnicos

- **Modelo OpenAI**: `gpt-4o-mini` é o melhor custo/benefício para visão em volume. Se preferir mais precisão posso usar `gpt-4o`, mas é ~10x mais caro e mais lento. Posso deixar configurável via constante no topo do arquivo.
- **Limite de paralelismo**: 100 simultâneas é o teto sugerido. Se quiser mais agressivo (ex.: 500) ou totalmente sem limite, ajusto.
- A API do OpenAI tem rate limit por **TPM (tokens por minuto)** e **RPM (requests por minuto)** dependendo do tier da conta. O backoff exponencial nas retentativas vai se auto-ajustar ao limite da sua conta.

## Confirmações que preciso

1. Modelo: **gpt-4o-mini** (recomendado) ou **gpt-4o**?
2. Teto de paralelismo: **100** simultâneas (recomendado), outro valor, ou sem limite?
