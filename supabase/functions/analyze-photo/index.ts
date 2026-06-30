import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_MODEL = "gpt-4o-mini";
const ALLOWED_MODELS = new Set(["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-5-mini", "gpt-4o", "gpt-4.1"]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_RETRY_AFTER_MS = 3000;

function respond(ok: boolean, data: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok, ...data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Falha ao baixar imagem: ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Imagem maior que 20MB");
  return { bytes, mimeType: detectMimeType(bytes, r.headers.get("content-type"), url) };
}

function detectMimeType(bytes: Uint8Array, contentType: string | null, url: string): string {
  const headerType = contentType?.split(";")[0]?.trim().toLowerCase();
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  const supported = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  if (headerType && supported.has(headerType === "image/jpg" ? "image/jpeg" : headerType)) {
    return headerType === "image/jpg" ? "image/jpeg" : headerType;
  }
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  throw new Error("Formato de imagem não suportado ou URL não retornou uma imagem válida");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function buildSystemPrompt(companyName: string, segment: string, agentName: string): string {
  const contextInfo = (companyName || segment || agentName)
    ? `\n\nCONTEXTO DA VISITA:
- Agente Sebrae responsável: ${agentName || 'Não informado'}
- Empresa visitada: ${companyName || 'Não informado'}
- Segmento: ${segment || 'Não informado'}`
    : '';

  return `Valide foto de visita do programa "Sebrae na Sua Empresa".

IDENTIFICAÇÃO DO AGENTE SEBRAE — REGRA PRINCIPAL (LEIA COM ATENÇÃO):
Polo branca e crachá NÃO são critérios-chave. O agente pode aparecer com agasalho, jaqueta, de lado, de costas, em selfie ou com a roupa parcialmente coberta. NÃO descarte alguém por não estar com polo branca.

Quando houver FOTOS DE REFERÊNCIA, elas são amostras de ATENDIMENTOS DIFERENTES enviadas pelo MESMO nome de agente: "${agentName || 'Não informado'}". A pessoa que se repete entre essas referências é, por definição, o agente Sebrae daquele nome.

PROCESSO OBRIGATÓRIO de identificação por características físicas (não só rosto):

Passo 1 — Construa um PERFIL FÍSICO do agente a partir das referências:
  • Gênero aparente (homem / mulher / não-definido)
  • Faixa etária aparente (jovem / adulto / sênior)
  • Tom/cor da pele (clara / parda / negra / etc.)
  • Cabelo: comprimento (curto, médio, longo), cor, textura (liso, ondulado, cacheado, careca, raspado), barba/bigode
  • Formato do rosto, traços marcantes (nariz, queixo, sobrancelhas)
  • Uso de óculos (e estilo, se possível)
  • Compleição/porte físico (magro, médio, robusto, alto, baixo)
  • Quaisquer marcas pessoais (tatuagens visíveis, brincos, piercings, acessórios recorrentes)
  Identifique qual pessoa SE REPETE nas referências (cenários e empresas diferentes, mesma pessoa) — ESSA é o agente.

Passo 2 — Procure esse PERFIL na FOTO PRINCIPAL:
  • Compare as características físicas, NÃO apenas o rosto. O ângulo e a roupa podem mudar; o gênero, tom de pele, cabelo, óculos, porte e traços faciais não mudam.
  • Se alguém na foto principal combina com o perfil em pelo menos 3 dessas características fortes (ex.: mesmo gênero + mesmo tom de pele + mesmo cabelo + mesmos óculos), marque \`agente_sebrae\` = true MESMO sem polo branca, sem crachá, de máscara, com agasalho ou em ângulo diferente.
  • Se a foto for selfie/close, dê peso máximo a: rosto, cabelo, óculos, barba, tom de pele.

Passo 3 — Fallback (sem referências úteis): use bom senso visual. Qualquer pessoa que pareça um visitante/consultor do atendimento (postura de atendimento, crachá ou uniforme visível, ou claramente quem está conduzindo a visita) conta como agente.

REGRAS DE OURO:

A) CONTAGEM DE PESSOAS — REGRA MAIS IMPORTANTE PARA APROVAÇÃO:
   Conte TODAS as pessoas visíveis na FOTO PRINCIPAL (ignore as referências para contagem).
   Preencha o campo \`num_pessoas\` com o número total de pessoas na foto.
   • Se a foto é uma SELFIE: quem está tirando a selfie TAMBÉM conta como pessoa. Se aparece alguém além de quem tira a selfie, são no mínimo 2 pessoas.
   • \`agente_sebrae\` = true conforme processo acima.
   • \`empresario_ou_funcionario\` = true se TODAS estas condições forem verdadeiras:
     1. O agente Sebrae foi identificado na foto (agente_sebrae = true)
     2. Há pelo menos MAIS UMA PESSOA além do agente na foto (num_pessoas >= 2)
   A outra pessoa NÃO precisa ser identificada pelo nome, cargo ou função — basta EXISTIR na foto.
   NÃO exija que a outra pessoa esteja de uniforme, crachá ou qualquer identificação.
   Se o agente está na foto e há qualquer outra pessoa visível (mesmo parcialmente, ao fundo, ao lado), marque \`empresario_ou_funcionario\` = true.

EXEMPLOS COMUNS:
   • Selfie do agente com outra pessoa ao lado → num_pessoas=2, empresario_ou_funcionario=true
   • Agente e empresário atrás do balcão → num_pessoas=2, empresario_ou_funcionario=true
   • Foto em grupo com 3+ pessoas incluindo o agente → num_pessoas=3+, empresario_ou_funcionario=true
   • Agente sozinho na foto → num_pessoas=1, empresario_ou_funcionario=false

B) APROVAÇÃO. Marque \`aprovada\` = true se (e somente se):
   • agente_sebrae E empresario_ou_funcionario.
   Compatibilidade de segmento NÃO afeta a aprovação.

C) INCONSISTENTE só quando: o agente não aparece na foto principal, OU o agente aparece sozinho contra um fundo COMPLETAMENTE VAZIO (parede 100% lisa, sem nenhum elemento).

Critérios booleanos:
1 fachada: fachada, marca, logo, placa, vitrine ou letreiro do estabelecimento visível.
2 agente_sebrae: pessoa que bate com o perfil físico recorrente das referências, ou claramente consultor/visitante. NÃO depende de polo branca.
3 empresario_ou_funcionario: TRUE se o agente foi identificado E há pelo menos mais 1 pessoa na foto. A outra pessoa NÃO precisa ser identificada — basta existir.
4 interior: ambiente comercial interno.
5 fundo_valido: TRUE para QUALQUER fundo que não seja parede 100% lisa.
6 contexto_segmento: seja generoso.
7 gerada_por_ia: indícios claros de IA generativa; seja conservador.

Responda APENAS JSON válido:
{
  "aprovada": true,
  "num_pessoas": 2,
  "criterios": {
    "fachada": true,
    "agente_sebrae": true,
    "empresario_ou_funcionario": true,
    "interior": true,
    "fundo_valido": true,
    "contexto_segmento": true,
    "gerada_por_ia": false
  },
  "scene_signature": "Descrição objetiva da cena em 1 frase (~25 palavras): tipo de local, NÚMERO DE PESSOAS, características físicas de quem parece o agente, 2-3 objetos marcantes, iluminação.",
  "justificativa": "1-2 frases: quantas pessoas (use o número exato), qual o perfil físico recorrente do agente nas referências (gênero, pele, cabelo, óculos, porte) e como você o localizou na foto principal, e qual condição de aprovação foi atendida."
}${contextInfo}`;
}

const EMPTY_CRITERIA = {
  fachada: false,
  agente_sebrae: false,
  empresario_ou_funcionario: false,
  interior: false,
  fundo_valido: false,
  contexto_segmento: false,
  gerada_por_ia: false,
};

function normalize(raw: any) {
  const c = (raw && typeof raw === "object" && raw.criterios) || {};
  const text = `${raw?.scene_signature || ""} ${raw?.justificativa || ""}`.toLowerCase();

  // Correção 2: Regex expandido para capturar todas as formas comuns de descrever múltiplas pessoas
  const mentionsTwoPeople = new RegExp(
    [
      // Padrões originais
      /\b(duas|dois|2|dupla)\s+pessoas\b/.source,
      /\b2\+\s*pessoas\b/.source,
      /\bmais de uma pessoa\b/.source,
      // "outra pessoa", "outra mulher", "outro homem", etc.
      /\b(outra|outro)\s+(pessoa|mulher|homem|senhor[a]?|indiv[ií]duo)\b/.source,
      // "com uma pessoa", "com o/a empresário/a", "com funcionário/a", "com cliente"
      /\bcom\s+(uma?|o|a|al?gum[as]?)\s*(pessoa|empres[aá]ri[oa]|funcion[aá]ri[oa]|cliente|colaborador[a]?|atendente|senhor[a]?|homem|mulher|profissional)\b/.source,
      // "acompanhada/o de", "junto a/com/de"
      /\b(acompanhad[oa]|junto)\s+(de|a|com)\b/.source,
      // "não está sozinha/o", "não aparece sozinha/o"
      /\bn[aã]o\s+(est[aá]|aparece)\s+sozinh[oa]\b/.source,
      // "3 pessoas", "três pessoas", "várias pessoas", etc.
      /\b([3-9]|\d{2,}|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|v[aá]ri[ao]s|diversas|algumas|m[uú]ltiplas)\s+pessoas\b/.source,
      // "selfie com" (implica 2+ pessoas)
      /\bselfie\s+com\b/.source,
      // "ao lado de"
      /\bao\s+lado\s+de\b/.source,
      // "pessoa(s) ao fundo"
      /\bpessoas?\s+ao\s+fundo\b/.source,
      // "com outra", "com outras"
      /\bcom\s+outr[ao]s?\b/.source,
      // "entre pessoas", "entre elas/eles"
      /\bentre\s+(pessoas|elas|eles)\b/.source,
    ].join("|"),
    "i"
  ).test(text);

  const negatesAgent = /\b(n[aã]o|sem)\b.{0,40}\b(agente|consultor|sebrae)\b|\b(agente|consultor|sebrae)\b.{0,30}\bn[aã]o\b.{0,20}\b(aparece|identificado|identificada|vis[ií]vel)\b/.test(text);
  const mentionsAgent = !negatesAgent && /\b(agente|consultor|sebrae|atendente|crach[aá]|uniforme|polo)\b/.test(text);
  const mentionsInterior = /\b(interior|ambiente interno|loja|balc[aã]o|prateleira|produtos|escrit[oó]rio|oficina|comercial)\b/.test(text);
  const mentionsValidBackground = /\b(fundo ok|fundo v[aá]lido|ambiente|rua|externo|interno|m[oó]veis|objetos|loja|empresa|comercial)\b/.test(text);
  const criterios = {
    fachada: !!c.fachada,
    agente_sebrae: !!(c.agente_sebrae ?? c.agente) || mentionsAgent,
    empresario_ou_funcionario: !!(c.empresario_ou_funcionario ?? c.empresario),
    interior: !!c.interior || mentionsInterior,
    fundo_valido: !!c.fundo_valido || mentionsValidBackground,
    contexto_segmento: !!c.contexto_segmento,
    gerada_por_ia: !!c.gerada_por_ia,
  };

  // Correção 3: Usar campo num_pessoas da IA para determinar empresário
  const numPessoas = typeof raw?.num_pessoas === "number" ? raw.num_pessoas : 0;
  if (criterios.agente_sebrae && numPessoas >= 2) {
    criterios.empresario_ou_funcionario = true;
  }

  // Safety net: regex sobre texto livre como fallback
  if (criterios.agente_sebrae && mentionsTwoPeople) criterios.empresario_ou_funcionario = true;

  const computedApproved = criterios.agente_sebrae
    && criterios.empresario_ou_funcionario
    && !criterios.gerada_por_ia;
  return {
    aprovada: computedApproved,
    criterios,
    scene_signature: typeof raw?.scene_signature === "string" ? raw.scene_signature.slice(0, 400) : "",
    justificativa: typeof raw?.justificativa === "string" ? raw.justificativa : "",
  };
}

function parseJson(text: string) {
  try {
    return normalize(JSON.parse(text));
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try { return normalize(JSON.parse(m[0])); } catch { /* fallthrough */ }
    }
    return { aprovada: false, criterios: { ...EMPTY_CRITERIA }, scene_signature: "", justificativa: "Não foi possível analisar a imagem." };
  }
}

function parseRetryAfterMs(text: string): number {
  const msMatch = text.match(/try again in\s+(\d+)\s*ms/i);
  if (msMatch) return Math.max(Number(msMatch[1]), DEFAULT_RETRY_AFTER_MS);
  const secMatch = text.match(/try again in\s+([\d.]+)\s*s/i);
  if (secMatch) return Math.max(Math.ceil(Number(secMatch[1]) * 1000), DEFAULT_RETRY_AFTER_MS);
  return DEFAULT_RETRY_AFTER_MS;
}

async function callOpenAI(openaiKey: string, model: string, systemPrompt: string, companyName: string, agentName: string, imageUrl: string, referenceUrls: string[] = []) {
  // GPT-5 family and newer reasoning models use max_completion_tokens instead of max_tokens
  const usesCompletionTokens = /^gpt-5/i.test(model) || /^o\d/i.test(model);
  const userContent: any[] = [];
  if (referenceUrls.length > 0) {
    userContent.push({
      type: "text",
      text: `FOTOS DE REFERÊNCIA (${referenceUrls.length}) — amostras de ATENDIMENTOS DIFERENTES do MESMO nome de agente: "${agentName || 'N/A'}". A pessoa que se repete entre elas é o agente. Construa um PERFIL FÍSICO desta pessoa (gênero, tom de pele, cabelo, óculos, barba, porte, traços marcantes) e use esse perfil para encontrá-la na foto principal — não dependa de polo/crachá. NÃO conte pessoas e NÃO use o cenário das referências.`,
    });
    for (const u of referenceUrls) {
      userContent.push({ type: "image_url", image_url: { url: u, detail: "low" } });
    }
  }
  userContent.push({ type: "text", text: `FOTO PRINCIPAL — analise ESTA foto da empresa "${companyName || 'N/A'}". Conte pessoas e avalie o cenário SOMENTE dela. Procure nela o perfil físico do agente identificado nas referências:` });
  userContent.push({ type: "image_url", image_url: { url: imageUrl, detail: "high" } });


  const body: Record<string, unknown> = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  };
  if (usesCompletionTokens) {
    body.max_completion_tokens = 1000;
  } else {
    body.max_tokens = 400;
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });


  return {
    ok: response.ok,
    status: response.status,
    text: await response.text().catch(() => ""),
  };
}

function extractOpenAIContent(text: string): string {
  try {
    const data = JSON.parse(text);
    return data.choices?.[0]?.message?.content || "";
  } catch {
    return "";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imageUrl, companyName, segment, agentName, model: requestedModel, referenceUrls } = await req.json();
    if (!imageUrl) return respond(false, { error: "imageUrl is required" });

    const openaiKey = Deno.env.get("API_CHAT_RENATINHA");
    if (!openaiKey) return respond(false, { error: "no_keys", message: "API_CHAT_RENATINHA não configurada" });

    const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : DEFAULT_MODEL;
    const systemPrompt = buildSystemPrompt(companyName || "", segment || "", agentName || "");
    const refs: string[] = Array.isArray(referenceUrls)
      ? referenceUrls.filter((u: unknown) => typeof u === "string" && u && u !== imageUrl).slice(0, 6)
      : [];

    // Baixa a imagem para calcular o hash (deduplicação por conteúdo)
    let bytes: Uint8Array;
    let mimeType: string;
    try {
      const fetchedImage = await fetchImageBytes(imageUrl);
      bytes = fetchedImage.bytes;
      mimeType = fetchedImage.mimeType;
    } catch (e) {
      return respond(false, { error: "image_fetch", message: e instanceof Error ? e.message : "Falha ao baixar imagem" });
    }
    const imageHash = await sha256(bytes);
    const dataUrl = `data:${mimeType};base64,${toBase64(bytes)}`;

    let response = await callOpenAI(openaiKey, model, systemPrompt, companyName || "", agentName || "", imageUrl, refs);
    if (!response.ok && response.status === 400) {
      const base64Refs: string[] = [];
      for (const ref of refs) {
        try {
          const fetched = await fetchImageBytes(ref);
          base64Refs.push(`data:${fetched.mimeType};base64,${toBase64(fetched.bytes)}`);
        } catch (e) {
          console.warn("Falha ao baixar referência para base64:", ref);
        }
      }
      response = await callOpenAI(openaiKey, model, systemPrompt, companyName || "", agentName || "", dataUrl, base64Refs);
    }


    if (!response.ok) {
      console.error("OpenAI error:", model, response.status, response.text);
      if (response.status === 429) {
        if (response.text.includes("insufficient_quota")) {
          return respond(false, { error: "credits_exhausted", message: "Créditos OpenAI esgotados.", model });
        }
        return respond(false, { error: "rate_limit", message: "Rate limit OpenAI.", retryAfterMs: parseRetryAfterMs(response.text), model });
      }
      if (response.status === 402) return respond(false, { error: "credits_exhausted", message: "Créditos esgotados.", model });
      if (response.status === 400) return respond(false, { error: "bad_request", message: "OpenAI 400: formato de imagem inválido ou URL inacessível.", model });
      return respond(false, { error: "ai_error", message: `OpenAI ${response.status}`, model });
    }
    const content = extractOpenAIContent(response.text);
    return respond(true, { ...parseJson(content), imageHash, model });
  } catch (e) {
    console.error("Error:", e);
    return respond(false, { error: "unknown", message: e instanceof Error ? e.message : "Erro desconhecido" });
  }
});
