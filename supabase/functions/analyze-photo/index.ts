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
- Segmento: ${segment || 'Não informado'}

Use essas informações para verificar se o conteúdo visual é compatível com o segmento da empresa.`
    : '';

  return `Valide foto de visita do programa "Sebrae na Sua Empresa".

IDENTIFICAÇÃO DO AGENTE SEBRAE — REGRA PRINCIPAL:
NÃO use camisa polo branca como critério-chave. Roupa/crachá são apenas pistas fracas, pois o agente pode usar agasalho, estar em selfie, de lado, de costas ou com a roupa parcialmente oculta.

Quando houver FOTOS DE REFERÊNCIA, elas são amostras de ATENDIMENTOS DIFERENTES enviados pelo MESMO nome de agente da planilha: "${agentName || 'Não informado'}".
A pessoa que se repete visualmente nessas referências é definitivamente o agente Sebrae daquele nome.

Você DEVE cruzar a FOTO PRINCIPAL com as referências assim:
   • Primeiro, encontre nas referências qual rosto/pessoa aparece repetido em atendimentos diferentes.
   • Depois, procure esse mesmo rosto/pessoa na FOTO PRINCIPAL.
   • Se uma pessoa da FOTO PRINCIPAL coincide com a pessoa recorrente das referências, marque \`agente_sebrae\` = true, mesmo sem polo branca, sem crachá ou com agasalho.
   • Compare rosto, cabelo, óculos, barba, formato do rosto, postura e aparência geral. Dê mais peso à repetição da pessoa entre atendimentos do que à roupa.
   • Se as referências forem insuficientes, use fallback visual amplo: pessoa que aparenta ser visitante/consultor tirando foto de atendimento, com postura de agente, crachá/uniforme quando existir, ou pessoa recorrente em selfies de visitas.

REGRAS DE OURO (siga nesta ordem, sem exceção):

A) IDENTIFIQUE O AGENTE E CONTE AS PESSOAS na FOTO PRINCIPAL (ignore as referências para contagem).
   • \`agente_sebrae\` = true se: (i) alguém coincide com a pessoa recorrente das referências, OU (ii) claramente é um consultor/visitante do atendimento. Polo branca/crachá NÃO são obrigatórios.
   • \`empresario_ou_funcionario\` = true SOMENTE quando houver 2+ pessoas na foto principal E uma delas for o agente. Ter 2 pessoas sem agente identificado NÃO conta. Ter apenas o agente sozinho NÃO conta.

B) APROVAÇÃO. Marque \`aprovada\` = true se QUALQUER uma destas condições for verdadeira (e não houver IA):
   • agente_sebrae E empresario_ou_funcionario, OU
   • agente_sebrae E fachada, OU
   • agente_sebrae E interior, OU
   • agente_sebrae E fundo_valido (qualquer fundo que NÃO seja parede totalmente lisa/vazia).
   Compatibilidade de segmento NÃO afeta a aprovação.

C) INCONSISTENTE só quando: o agente não aparece na foto principal, OU o agente aparece sozinho contra um fundo COMPLETAMENTE VAZIO (parede 100% lisa, sem nenhum elemento).

Critérios booleanos (true/false):
1 fachada: fachada, marca, logo, placa, vitrine ou letreiro do estabelecimento visível.
2 agente_sebrae: pessoa recorrente nas referências do mesmo nome de agente, ou claramente consultor/visitante. Não depende de polo branca.
3 empresario_ou_funcionario: TRUE se há 2+ pessoas E o agente está entre elas. FALSE se há só 1 pessoa, se não há agente identificado, ou se há 2 pessoas mas nenhuma parece ser o agente.
4 interior: ambiente comercial interno (produtos, balcão, prateleiras, escritório, oficina).
5 fundo_valido: TRUE para QUALQUER fundo que não seja parede totalmente lisa/vazia. Rua, ambiente externo, espaço com móveis ou objetos quaisquer = TRUE. FALSE APENAS para parede 100% lisa sem nenhum elemento.
6 contexto_segmento: TRUE se plausivelmente compatível com o segmento. Seja generoso.
7 gerada_por_ia: indícios claros de IA generativa. Conservador.

Aprovada = (regra B acima) E NÃO gerada_por_ia.

Responda APENAS JSON válido:
{
  "aprovada": true,
  "criterios": {
    "fachada": true,
    "agente_sebrae": true,
    "empresario_ou_funcionario": true,
    "interior": true,
    "fundo_valido": true,
    "contexto_segmento": true,
    "gerada_por_ia": false
  },
  "scene_signature": "Descrição objetiva da cena em 1 frase (~25 palavras): tipo de local, NÚMERO DE PESSOAS, quem parece o agente (polo branca/crachá?), 2-3 objetos marcantes, iluminação.",
  "justificativa": "Explicação breve em 1-2 frases: quantas pessoas, quem é o agente (por repetição nas referências ou outro motivo), e qual condição de aprovação foi atendida."
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
  const mentionsTwoPeople = /\b(duas|dois|2|dupla)\s+pessoas\b|\b2\+\s*pessoas\b|\bmais de uma pessoa\b/.test(text);
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
  if (criterios.agente_sebrae && mentionsTwoPeople) criterios.empresario_ou_funcionario = true;
  const computedApproved = criterios.agente_sebrae
    && (criterios.empresario_ou_funcionario || criterios.fachada || criterios.interior || criterios.fundo_valido)
    && !criterios.gerada_por_ia;
  return {
    aprovada: (!!raw?.aprovada || computedApproved) && !criterios.gerada_por_ia,
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

async function callOpenAI(openaiKey: string, model: string, systemPrompt: string, companyName: string, imageUrl: string, referenceUrls: string[] = []) {
  // GPT-5 family and newer reasoning models use max_completion_tokens instead of max_tokens
  const usesCompletionTokens = /^gpt-5/i.test(model) || /^o\d/i.test(model);
  const userContent: any[] = [];
  if (referenceUrls.length > 0) {
    userContent.push({
      type: "text",
      text: `FOTOS DE REFERÊNCIA (${referenceUrls.length}) — amostras de ATENDIMENTOS DIFERENTES do MESMO nome de agente: "${agentName || 'N/A'}". A pessoa que se repete nessas imagens é o agente. Use-as APENAS para reconhecer essa pessoa/rosto; NÃO conte pessoas delas e NÃO use o cenário delas:`,
    });
    for (const u of referenceUrls) {
      userContent.push({ type: "image_url", image_url: { url: u, detail: "high" } });
    }
  }
  userContent.push({ type: "text", text: `FOTO PRINCIPAL — analise ESTA foto da empresa "${companyName || 'N/A'}". Conte pessoas e avalie o cenário SOMENTE dela:` });
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

    let response = await callOpenAI(openaiKey, model, systemPrompt, companyName || "", imageUrl, refs);
    if (!response.ok && response.status === 400) {
      response = await callOpenAI(openaiKey, model, systemPrompt, companyName || "", dataUrl, refs);
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
