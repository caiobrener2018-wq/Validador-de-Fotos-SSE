

## Sebrae na Sua Empresa — Validador de Fotos

### O que será construído

Um aplicativo web onde você faz upload da planilha Excel, e a IA analisa automaticamente cada foto dos agentes verificando se atendem aos critérios exigidos.

### Funcionalidades

**1. Upload e leitura da planilha**
- Tela de upload para arquivo .xlsx
- Leitura automática das colunas (agente + até 3 links de fotos)
- Exibição da lista de agentes com suas fotos em cards

**2. Análise automática por IA (visão computacional)**
- Para cada foto, a IA verifica os 3 critérios:
  - ✅ Mostra a marca/fachada da empresa?
  - ✅ O agente aparece com o empresário?
  - ✅ A foto é dentro do estabelecimento?
- Cada foto recebe um status: **Aprovada** (atende pelo menos 1 critério) ou **Inconsistência** (não atende nenhum)
- Justificativa da IA para cada classificação

**3. Dashboard de resultados**
- Resumo geral: total de agentes, fotos analisadas, aprovadas vs inconsistências
- Lista filtrável por status (todas / só inconsistências / só aprovadas)
- Visualização das fotos com os resultados da análise lado a lado

**4. Relatório para download**
- Geração de relatório Excel com os resultados da análise
- Colunas: Agente, Foto 1/2/3, Status de cada foto, Justificativa da IA
- Destaque em vermelho para inconsistências

### Tecnologia
- Frontend React com interface limpa e profissional
- Supabase Edge Function + Lovable AI (Gemini com visão) para análise das imagens
- Processamento com barra de progresso (100+ agentes = pode levar alguns minutos)
- Leitura do Excel no navegador com biblioteca xlsx

