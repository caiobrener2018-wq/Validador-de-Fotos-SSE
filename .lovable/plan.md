
## Atualização: Nova Estrutura da Planilha com Agências

### Resumo

Adicionar o campo "Agência SSE" como nova coluna na planilha, ajustar parser, filtros, exportação e relatório Excel para incluir e organizar por agência. Embutir as imagens diretamente no Excel exportado.

### Mudanças

**1. Nova estrutura da planilha (`src/lib/parseExcel.ts` + `src/types/analysis.ts`)**
- Adicionar campo `agency: string` em `AgentData`
- Atualizar parser para ler:
  - Col 1: Nome do Agente
  - Col 2: Nome da Agência SSE *(novo)*
  - Col 3: Razão Social da empresa
  - Col 4: Segmento
  - Cols 5, 6, 7: Fotos (antes eram 4, 5, 6)

**2. Novo filtro por Agência (`src/pages/Index.tsx`)**
- Substituir o filtro "Planilha" por filtro "Agência SSE" (já que agora é uma planilha única)
- Manter filtros por Agente e Empresa
- Atualizar lista de agências únicas

**3. Exportação separada por agência**
- Atualizar `ExportDialog.tsx`: trocar lista de "planilhas" por lista de "agências" com checkboxes
- `exportImagesToZip`: organizar pastas como `Agência / Empresa (Linha X) / foto_N.jpg`
- Permitir exportar Excel + ZIP filtrados por agência selecionada

**4. Relatório Excel com imagens embutidas (`src/lib/exportResults.ts`)**
- Nova estrutura de colunas:
  - Linha Excel | Agente | Agência SSE | Empresa | Segmento | Foto 1 | Foto 2 | Foto 3 | Status Geral | Justificativas
- Embutir imagens direto nas células usando `xlsx-js-style` ou abordagem com `ExcelJS` (que suporta `addImage`)
- **Nota técnica**: a lib `xlsx` atual não embute imagens. Precisaremos adicionar `exceljs` como dependência (mantendo `xlsx` para o parsing)
- Ajustar altura das linhas e largura das colunas para acomodar imagens (~120px)
- Status Geral: "APROVADA" se todas as fotos passaram, "INCONSISTÊNCIA" se alguma falhou
- Imagens baixadas via edge function `proxy-image` (já existente) para evitar CORS

**5. Dashboard e UI**
- `DashboardSummary.tsx`: trocar "planilhas carregadas" por "agências"
- `AgentCard.tsx`: exibir o nome da agência junto com a empresa
- `FileUpload.tsx`: voltar a aceitar apenas 1 planilha (remover `multiple`)
- Remover botão "+ Adicionar Planilhas" do header

**6. Manter intacto**
- Botão "Reanalisar Falhas" (já existente)
- Lógica de retry/concorrência atual
- Modal de ampliação de foto

### Arquivos afetados

- `src/types/analysis.ts` — adicionar `agency`, remover `sourceFile` (ou manter opcional)
- `src/lib/parseExcel.ts` — nova ordem de colunas
- `src/lib/exportResults.ts` — reescrita usando ExcelJS com imagens
- `src/lib/exportImages.ts` — agrupar por agência
- `src/components/ExportDialog.tsx` — filtro por agência
- `src/pages/Index.tsx` — filtros e estado
- `src/components/DashboardSummary.tsx` — contagem de agências
- `src/components/AgentCard.tsx` — exibir agência
- `src/components/FileUpload.tsx` — single file
- `package.json` — adicionar `exceljs`
