

## Modificações no Validador de Fotos

### Resumo

Atualizar o sistema para: (1) ler empresa e segmento da planilha, (2) adicionar análise contextual de fundo baseada no segmento, (3) filtro por agente, (4) incluir guia de instalação local.

### Mudanças

**1. Tipos (`src/types/analysis.ts`)**
- Adicionar `companyName` e `segment` ao `AgentData`
- Adicionar novo critério `contexto_segmento` (boolean) e `fundo_valido` na análise
- Criar tipo para representar um "atendimento" (agente + empresa + segmento + fotos)

**2. Parser Excel (`src/lib/parseExcel.ts`)**
- Coluna 1: nome do agente, Coluna 2: nome da empresa, Coluna 3: segmento
- Colunas 4, 5, 6: URLs das fotos
- Ajustar detecção de header

**3. Edge Function (`supabase/functions/analyze-photo/index.ts`)**
- Receber `companyName` e `segment` além de `imageUrl`
- Atualizar o prompt da IA para:
  - Verificar se o fundo NÃO é parede lisa
  - Cruzar o conteúdo visual com o segmento (farmácia → remédios, loja de roupa → roupas, etc.)
  - Retornar novo critério `fundo_valido` e `contexto_segmento`
- Atualizar o schema de tool calling com os novos campos

**4. Componentes UI**
- `AgentCard.tsx`: exibir empresa e segmento, mostrar badges dos novos critérios
- `DashboardSummary.tsx`: manter estatísticas gerais
- `Index.tsx`: adicionar filtro por agente (dropdown/select com nomes únicos dos agentes)
- Atualizar a chamada `analyze-photo` para enviar empresa e segmento

**5. Exportação (`src/lib/exportResults.ts`)**
- Adicionar colunas Empresa e Segmento no relatório
- Incluir os novos critérios (fundo válido, contexto do segmento)

**6. Guia de instalação local**
- Após implementar, forneço um passo-a-passo detalhado no chat para rodar o projeto localmente (Node.js, git clone, npm install, variáveis de ambiente, etc.)

### Detalhes técnicos

- O prompt da IA será enriquecido com contexto: "A empresa é [nome], do segmento [segmento]. Verifique se o fundo da imagem contém elementos compatíveis com esse segmento."
- Filtro por agente usa um `Select` component com lista de agentes únicos extraídos da planilha
- Nenhuma alteração de banco de dados necessária (tudo client-side + edge function)

