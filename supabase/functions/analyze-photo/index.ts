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

PRIMEIRO PASSO OBRIGATÓRIO — CONTE ROSTOS E PESSOAS:
Antes de qualquer outra análise, escaneie a imagem INTEIRA em busca de TODOS os rostos e corpos humanos visíveis.
Olhe especialmente:
  - Primeiro plano (quem está mais perto da câmera)
  - Segundo plano / fundo (pessoas atrás, parcialmente visíveis)
  - Bordas e cantos da foto (pessoas cortadas pela câmera — um ombro, metade do rosto, um braço)
  - Reflexos em espelhos ou vidros
  - Selfies: quem segura a câmera É uma pessoa + quem aparece ao lado/atrás É outra pessoa
Registre o total em \`num_pessoas\`. Este é o campo MAIS IMPORTANTE da sua resposta.

IDENTIFICAÇÃO DO AGENTE SEBRAE:
Polo branca e crachá NÃO são critérios-chave. O agente pode aparecer com agasalho, jaqueta, de lado, de costas, em selfie ou com a roupa parcialmente coberta. NÃO descarte alguém por não estar com polo branca.

Quando houver FOTOS DE REFERÊNCIA, elas são amostras de ATENDIMENTOS DIFERENTES enviadas pelo MESMO nome de agente: "${agentName || 'Não informado'}". A pessoa que se repete entre essas referências é, por definição, o agente Sebrae daquele nome.

PROCESSO de identificação por características físicas:

Passo 1 — Construa um PERFIL FÍSICO do agente a partir das referências:
  • Gênero aparente, faixa etária, tom/cor da pele
  • Cabelo: comprimento, cor, textura, barba/bigode
  • Uso de óculos (e estilo)
  • Compleição/porte físico
  Identifique qual pessoa SE REPETE nas referências — ESSA é o agente.

Passo 2 — Procure esse PERFIL na FOTO PRINCIPAL:
  • Compare características físicas. Se alguém combina com o perfil em pelo menos 3 características fortes, marque \`agente_sebrae\` = true.
  • Se a foto for selfie/close, dê peso máximo a: rosto, cabelo, óculos, barba, tom de pele.

Passo 3 — Fallback (sem referências úteis): use bom senso visual. Qualquer pessoa que pareça um visitante/consultor conta como agente.

REGRAS DE OURO:

A) \`empresario_ou_funcionario\` = true se \`num_pessoas\` >= 2. É SÓ ISSO.
   NÃO importa se você identificou o agente ou não.
   NÃO importa quem são as outras pessoas.
   NÃO classifique ninguém como "cliente", "consumidor" ou "visitante".
   Se há 2+ seres humanos visíveis na foto → empresario_ou_funcionario = true.

B) APROVAÇÃO. \`aprovada\` = true se: agente_sebrae E empresario_ou_funcionario. Segmento NÃO afeta.

C) INCONSISTENTE: só quando o agente não aparece na foto, OU aparece sozinho contra fundo 100% vazio.

Critérios booleanos:
1 fachada: fachada, marca, logo, placa, vitrine ou letreiro visível.
2 agente_sebrae: pessoa que bate com o perfil físico das referências. NÃO depende de polo branca.
3 empresario_ou_funcionario: TRUE se num_pessoas >= 2. Simples assim.
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
  "scene_signature": "Descrição da cena em 1 frase (~25 palavras): tipo de local, NÚMERO EXATO DE PESSOAS, características do agente, 2-3 objetos marcantes.",
  "justificativa": "1-2 frases: NÚMERO EXATO de pessoas encontradas (ex: 'Encontrei 2 pessoas'), perfil do agente e condição de aprovação."
}${contextInfo}`;
}

const PEOPLE_COUNT_PROMPT = `Você é um detector de pessoas em fotografias. Sua ÚNICA tarefa é contar quantas PESSOAS HUMANAS aparecem nesta foto.

Instruções:
1. Escaneie TODA a imagem pixel a pixel: primeiro plano, segundo plano, fundo, cantos, bordas.
2. Conte TODOS os seres humanos visíveis, incluindo:
   - Pessoas em primeiro plano (close, selfie)
   - Pessoas ao fundo ou parcialmente visíveis
   - Pessoas cortadas pela borda da foto (apenas ombro, braço, metade do rosto)
   - Rostos refletidos em espelhos ou vidros
   - A pessoa tirando a selfie (se for selfie, ela conta)
3. Na dúvida se é uma pessoa, CONTE como pessoa.
4. NÃO analise nada além de contagem de pessoas. Ignore objetos, cenário, identificação.

Responda APENAS com JSON:
{"num_pessoas": <número inteiro>, "descricao_pessoas": "Descreva brevemente a localização de cada pessoa na foto (ex: 'Pessoa 1: primeiro plano esquerdo, Pessoa 2: fundo direito')"}`;

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
      /\bcom\s+(uma?|o|a|al?gum[as]?)\s*(pessoa|empres[aá]ri[oa]|funcion[aá]ri[oa]|cliente|colaborador[a]?|atendente|senhor[a]?|homem|mulher|profissional|jovem|rapaz|mo[cç]a|crian[cç]a|garoto|garota)\b/.source,
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
      // "há um/uma [pessoa]" — captura "há um cliente", "há uma pessoa", "há um homem", etc.
      /\bh[aá]\s+(um|uma|\d+)\s*(pessoa|cliente|consumidor[a]?|empres[aá]ri[oa]|funcion[aá]ri[oa]|colaborador[a]?|homem|mulher|jovem|rapaz|mo[cç]a|senhor[a]?|garoto|garota|indiv[ií]duo|atendente|profissional|crian[cç]a)\b/.source,
      // "um/uma cliente ao fundo", "um homem ao lado", etc.
      /\b(um|uma)\s+(cliente|pessoa|empres[aá]ri[oa]|funcion[aá]ri[oa]|homem|mulher|jovem|rapaz|mo[cç]a|senhor[a]?)\s+(ao fundo|ao lado|atr[aá]s|na frente|pr[oó]xim[oa])\b/.source,
      // Menção direta de pessoa por papel (sem prefixo) — "cliente", "consumidor" mencionados no texto
      /\b(cliente|consumidor[a]?)\s+(ao fundo|ao lado|atr[aá]s|vis[ií]vel|presente|na foto|na imagem|na cena|aparece)\b/.source,
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

  // Correção 3: Usar campo num_pessoas da IA para determinar empresário (independente de identificar o agente)
  const numPessoas = typeof raw?.num_pessoas === "number" ? raw.num_pessoas : 0;
  if (numPessoas >= 2) {
    criterios.empresario_ou_funcionario = true;
  }

  // Safety net: regex sobre texto livre como fallback (independente de identificar o agente)
  if (mentionsTwoPeople) criterios.empresario_ou_funcionario = true;

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
    body.max_tokens = 600;
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

async function callPeopleCount(openaiKey: string, model: string, imageUrl: string) {
  const usesCompletionTokens = /^gpt-5/i.test(model) || /^o\d/i.test(model);
  const body: Record<string, unknown> = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PEOPLE_COUNT_PROMPT },
      { role: "user", content: [
        { type: "text", text: "Conte TODAS as pessoas humanas visíveis nesta foto. Escaneie cada canto, borda e fundo." },
        { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
      ] },
    ],
  };
  if (usesCompletionTokens) {
    body.max_completion_tokens = 300;
  } else {
    body.max_tokens = 200;
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return 0;
  const text = await response.text().catch(() => "");
  try {
    const data = JSON.parse(text);
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content);
    return typeof parsed.num_pessoas === "number" ? parsed.num_pessoas : 0;
  } catch {
    // Tenta extrair número do texto
    const m = text.match(/"num_pessoas"\s*:\s*(\d+)/);
    return m ? Number(m[1]) : 0;
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
    let result = parseJson(content);

    // SEGUNDA VERIFICAÇÃO: Se a primeira análise diz que há apenas 1 pessoa,
    // faz uma segunda chamada focada EXCLUSIVAMENTE em contar pessoas/rostos.
    if (!result.criterios.empresario_ou_funcionario) {
      console.log("[Re-scan] Primeira análise encontrou < 2 pessoas. Executando segunda verificação focada em contagem...");
      try {
        // Tenta com a URL original, senão com base64
        let recount = await callPeopleCount(openaiKey, model, imageUrl);
        if (recount === 0) {
          recount = await callPeopleCount(openaiKey, model, dataUrl);
        }
        console.log(`[Re-scan] Segunda verificação encontrou ${recount} pessoa(s).`);
        if (recount >= 2) {
          result.criterios.empresario_ou_funcionario = true;
          // Recalcular aprovação
          result.aprovada = result.criterios.agente_sebrae
            && result.criterios.empresario_ou_funcionario
            && !result.criterios.gerada_por_ia;
          result.justificativa += ` [Re-scan: ${recount} pessoas detectadas na segunda verificação]`;
        }
      } catch (e) {
        console.warn("[Re-scan] Falha na segunda verificação:", e);
      }
    }

    return respond(true, { ...result, imageHash, model });
  } catch (e) {
    console.error("Error:", e);
    return respond(false, { error: "unknown", message: e instanceof Error ? e.message : "Erro desconhecido" });
  }
});
