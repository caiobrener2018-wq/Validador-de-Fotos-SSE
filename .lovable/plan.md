

## Melhorias no Validador de Fotos

### Resumo

Implementar upload múltiplo de planilhas, filtros por empresa/planilha, exportação separada de imagens e relatórios por empresa, melhorar resiliência da análise, e adicionar funcionalidades extras.

### 1. Upload múltiplo de planilhas

- `FileUpload.tsx`: aceitar `multiple` no input e processar múltiplos arquivos no drag & drop
- Cada planilha vira uma "fonte" com nome do arquivo
- `AgentData` ganha campo `sourceFile: string` para rastrear de qual planilha veio
- `parseExcel.ts`: receber nome do arquivo e incluir no resultado
- `Index.tsx`: acumular dados de múltiplas planilhas (não substituir, concatenar)

### 2. Filtro por empresa/planilha

- Novo Select para filtrar por `sourceFile` (nome da planilha)
- Novo Select para filtrar por `companyName`
- Ambos funcionam em conjunto com o filtro de agente e status existentes

### 3. Exportação separada

- **Dropdown de exportação** com opções:
  - Exportar relatório completo (Excel)
  - Exportar relatório da empresa/planilha filtrada
  - Exportar somente imagens (ZIP com as fotos organizadas por empresa)
  - Exportar imagens da empresa/planilha filtrada
- Para download de imagens: usar `JSZip` para criar ZIP no navegador, fazendo fetch de cada URL e organizando em pastas por empresa
- Instalar dependência `jszip`

### 4. Melhorar resiliência da análise (sem reduzir velocidade)

- **Retry com backoff exponencial** mais inteligente: começar com 2s, dobrar a cada retry, máximo 5 retries
- **Re-analisar apenas erros**: botão "Reanalisar falhas" que processa somente fotos com `status === 'error'`
- **Processamento paralelo controlado**: enviar 2-3 requisições simultâneas (concorrência limitada) em vez de 1 por vez, mantendo intervalo entre lotes para evitar rate limit
- **Timeout por requisição**: se a edge function não responder em 30s, abortar e marcar como erro para retry

### 5. Sugestões de melhorias adicionais

Estas são ideias que posso implementar agora ou em versões futuras:

- **Visualização em tabela**: além dos cards, uma view de tabela compacta para ver todos os resultados de uma vez
- **Estatísticas por agente**: dashboard mostrando taxa de aprovação por agente (quem tem mais inconsistências)
- **Ampliação de foto**: clicar na thumbnail abre a imagem em tamanho maior num modal
- **Persistência no banco**: salvar resultados no banco de dados para consulta posterior sem precisar re-analisar
- **Dark mode**: toggle claro/escuro

### Detalhes técnicos

**Tipos atualizados (`src/types/analysis.ts`)**:
- `AgentData` recebe `sourceFile: string`

**Novos arquivos**:
- `src/lib/exportImages.ts` — lógica de download de imagens em ZIP via JSZip

**Arquivos modificados**:
- `src/components/FileUpload.tsx` — aceitar múltiplos arquivos
- `src/lib/parseExcel.ts` — receber e incluir `sourceFile`
- `src/pages/Index.tsx` — filtros de empresa/planilha, dropdown de exportação, retry inteligente, concorrência controlada
- `src/lib/exportResults.ts` — aceitar filtro para exportar por empresa
- `src/components/DashboardSummary.tsx` — exibir contagem de planilhas carregadas

**Dependência nova**: `jszip` para geração de ZIP de imagens no browser

