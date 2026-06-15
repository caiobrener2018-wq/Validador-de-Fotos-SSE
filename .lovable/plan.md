
## Objetivo
Adaptar o validador para a nova planilha do SSE (mais colunas), passar a usar Bairro/Cidade/Lote/CNPJ como metadados/filtros, e gerar um relatório que espelha o arquivo original adicionando colunas de auditoria.

## 1. Novo parser de upload (`src/lib/parseExcel.ts`)

Mapeamento por cabeçalho (case-insensitive, com fallback por índice):

| Campo no app        | Cabeçalho                | Coluna |
|---------------------|--------------------------|--------|
| `agentName`         | Nome Atendente           | A (0)  |
| `agency`            | Empresa Habilitada       | B (1)  |
| `cpfRespondente`    | Cpf Respondente          | J (9)  |
| `companyName`       | Razao Social             | M (12) |
| `cnpj`              | Cnpj                     | N (13) |
| `bairro`            | Bairro Cnpj              | Q (16) |
| `cidade`            | Cidade Cnpj              | R (17) |
| `lote`              | lote                     | S (18) |
| `photos[0..2]`      | Fotos (3 colunas)        | AI/AJ/AK (34-36) |

Além disso, o parser passa a **guardar a linha original completa** (todas as colunas) em `rawRow: Record<string, unknown>` no `AgentData`, junto com a ordem original dos cabeçalhos (`rawHeaders: string[]`), para usar no export.

Detecção de duplicatas exatas por URL continua igual.

## 2. Tipos (`src/types/analysis.ts`)

Adicionar em `AgentData`:
- `cpfRespondente?: string`
- `bairro?: string`
- `cidade?: string`
- `lote?: string`
- `cnpj?: string`
- `rawRow?: Record<string, unknown>`
- `rawHeaders?: string[]`
- `cpfGroupNumber?: number` (preenchido no export quando o CPF aparece em ≥2 CNPJs distintos)

`segment` deixa de ser usado e é removido do fluxo (ou mantido opcional para retrocompat).

Tipo de filtro estendido para incluir `bairro`, `cidade`, `lote` (além dos já existentes `agency`, `agent`, `status`).

## 3. UI — Card e Dashboard

- `AgentCard.tsx`: exibir CNPJ, Bairro, Cidade e Lote no bloco de metadados (Razão Social continua, "Segmento" sai).
- `DashboardSummary.tsx` / página `Index.tsx`:
  - Filtros existentes (Agente, Agência, Status) **continuam**.
  - Novos filtros: **Bairro**, **Cidade**, **Lote** (selects populados dinamicamente a partir dos dados carregados).
  - Razão Social e CNPJ NÃO viram filtro.

Critério de validação do atendimento permanece como hoje (presença de empresário ao lado do agente é o principal sinal); nada muda na edge function `analyze-photo`.

## 4. Novo export Excel (`src/lib/exportResults.ts`)

Reescrita do gerador para:

1. Recriar a planilha com **todas as colunas originais na mesma ordem** (a partir de `rawHeaders` / `rawRow`). Fotos saem como **texto/URL** (hyperlink), não como imagem embutida — relatório fica leve.
2. Acrescentar ao final 3 colunas novas:
   - **Status**: `Consistente` | `Duplicada` | `IA` | `Sem empresário` | `Inconsistente`
   - **Justificativa**: texto curto, ex.:
     - Duplicada → `Duplicada de linha X (CNPJ Y)` ou `Cena duplicada de linha X`
     - Sem empresário → `Nenhum empresário/funcionário identificado nas fotos`
     - IA → `Traços de IA generativa detectados na foto N`
     - Inconsistente → motivo objetivo retornado pela análise
     - Consistente → vazio ou `OK`
   - **Grupo CPF**: número inteiro (1, 2, 3…) atribuído apenas quando o **Cpf Respondente** aparece em **≥ 2 CNPJs diferentes**. Linhas sem repetição ficam em branco.

3. **AutoFilter** habilitado em toda a faixa do cabeçalho (permite filtrar por Status, Grupo CPF, etc., no próprio Excel).
4. **Cor da linha por status** (fill aplicado a todas as células da linha):
   - Consistente → verde claro (`#E6F4EA`)
   - Duplicada → amarelo (`#FFF4CE`)
   - IA → roxo claro (`#EADCF8`)
   - Sem empresário → laranja (`#FCE5CD`)
   - Inconsistente → vermelho claro (`#FADBD8`)
5. Cabeçalho em negrito com fundo cinza, larguras de coluna ajustadas, freeze na primeira linha.

### Algoritmo do "Grupo CPF"
```
const byCpf = new Map<string, Set<string>>();          // cpf -> set de cnpj
agents.forEach(a => {
  if (!a.cpfRespondente || !a.cnpj) return;
  const set = byCpf.get(a.cpfRespondente) ?? new Set();
  set.add(a.cnpj);
  byCpf.set(a.cpfRespondente, set);
});
let n = 0;
const cpfGroup = new Map<string, number>();
for (const [cpf, cnpjs] of byCpf) if (cnpjs.size >= 2) cpfGroup.set(cpf, ++n);
// no export, agent.cpfGroupNumber = cpfGroup.get(agent.cpfRespondente)
```

## 5. Memória do projeto

Atualizar `mem://features/data-processing` e `mem://features/export-capabilities` refletindo:
- novas colunas lidas/exibidas (Bairro, Cidade, Lote, CNPJ, Cpf Respondente);
- export agora replica planilha original + 3 colunas extras + cor por status + Grupo CPF.

## Arquivos afetados
- `src/lib/parseExcel.ts` — novo mapeamento + `rawRow`/`rawHeaders`.
- `src/types/analysis.ts` — novos campos.
- `src/components/AgentCard.tsx` — exibir CNPJ/Bairro/Cidade/Lote.
- `src/components/DashboardSummary.tsx` + `src/pages/Index.tsx` — novos filtros Bairro/Cidade/Lote.
- `src/lib/exportResults.ts` — reescrita do export (espelho + colunas extras + cores + autofilter + Grupo CPF).
- `mem://features/data-processing`, `mem://features/export-capabilities` — atualização.

## Fora do escopo
- Nenhuma alteração na edge function `analyze-photo` nem nos workers.
- ZIP de imagens permanece como está.
