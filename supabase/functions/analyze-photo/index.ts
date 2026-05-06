import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function respond(ok: boolean, data: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok, ...data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Provider list: 10 slots. Slot 4 (index 3) is intentionally Lovable AI (Gemini token 4 está com 403).
function getProviders(): Array<{ type: "gemini" | "lovable"; key?: string }> {
  const providers: Array<{ type: "gemini" | "lovable"; key?: string }> = [];
  for (let i = 1; i <= 10; i++) {
    if (i === 4) {
      providers.push({ type: "lovable" });
    } else {
      const k = Deno.env.get(`GEMINI_API_KEY_${i}`);
      if (k) providers.push({ type: "gemini", key: k });
    }
  }
  return providers;
}

async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Falha ao baixar imagem: ${r.status}`);
  const mimeType = r.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  return { bytes: new Uint8Array(await r.arrayBuffer()), mimeType };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function buildSystemPrompt(companyName: string, segment: string): string {
  const contextInfo = (companyName || segment)
    ? `\n\nCONTEXTO DA VISITA:
- Empresa: ${companyName || 'Não informado'}
- Segmento: ${segment || 'Não informado'}

Use essas informações para verificar se o conteúdo visual da foto é compatível com o segmento da empresa.`
    : '';

  return `Você é um validador de fotos para o programa "Sebrae na Sua Empresa". 
Agentes terceirizados visitam empresas e devem enviar fotos como prova da visita.

Analise a imagem e verifique TODOS os seguintes critérios:

1. FACHADA/MARCA: A foto mostra a fachada ou marca/logotipo de uma empresa ou estabelecimento comercial?
2. EMPRESÁRIO: A foto mostra pessoas (agente com empresário) em contexto profissional/reunião?
3. INTERIOR: A foto foi tirada dentro de um estabelecimento comercial (loja, escritório, oficina, etc.)?
4. FUNDO VÁLIDO: O fundo da imagem NÃO é uma parede lisa/branca sem informação. Deve haver elementos visuais que identifiquem o ambiente (produtos, equipamentos, decoração comercial, estantes, balcão, etc.). Uma parede lisa sem nenhum elemento contextual = fundo inválido.
5. CONTEXTO DO SEGMENTO: Os elementos visuais da foto são compatíveis com o segmento da empresa?
${contextInfo}

A foto é APROVADA se atender pelo menos 1 dos critérios (fachada, empresário ou interior) E o fundo for válido E o contexto do segmento for compatível.

Responda APENAS com um JSON válido neste formato exato:
{
  "aprovada": true,
  "criterios": {
    "fachada": true,
    "empresario": false,
    "interior": true,
    "fundo_valido": true,
    "contexto_segmento": true
  },
  "justificativa": "Explicação breve"
}`;
}

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {
      aprovada: false,
      criterios: { fachada: false, empresario: false, interior: false, fundo_valido: false, contexto_segmento: false },
      justificativa: "Não foi possível analisar a imagem.",
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imageUrl, companyName, segment, keyIndex } = await req.json();
    if (!imageUrl) return respond(false, { error: "imageUrl is required" });

    const systemPrompt = buildSystemPrompt(companyName || "", segment || "");

    // Sempre baixar a imagem para calcular o hash (deduplicação por conteúdo)
    let bytes: Uint8Array;
    let mimeType: string;
    try {
      const r = await fetchImageBytes(imageUrl);
      bytes = r.bytes;
      mimeType = r.mimeType;
    } catch (e) {
      return respond(false, { error: "image_fetch", message: e instanceof Error ? e.message : "Falha ao baixar imagem" });
    }
    const imageHash = await sha256(bytes);

    const providers = getProviders();
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const provider = providers.length > 0
      ? providers[((keyIndex ?? 0) % providers.length + providers.length) % providers.length]
      : { type: "lovable" as const };

    // ===== Provider Gemini direto =====
    if (provider.type === "gemini" && provider.key) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${provider.key}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{
            role: "user",
            parts: [
              { text: `Analise esta foto de visita do agente à empresa "${companyName || 'N/A'}" (segmento: ${segment || 'N/A'}). Responda apenas com o JSON solicitado.` },
              { inline_data: { mime_type: mimeType, data: bytesToBase64(bytes) } },
            ],
          }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error("Gemini error:", resp.status, text);
        if (resp.status === 429) return respond(false, { error: "rate_limit", message: "Rate limit Gemini." });
        if (resp.status === 403) return respond(false, { error: "forbidden", message: `Gemini 403: ${text.slice(0, 200)}` });
        return respond(false, { error: "ai_error", message: `Gemini ${resp.status}` });
      }

      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("") || "";
      return respond(true, { ...parseJson(text), imageHash });
    }

    // ===== Provider Lovable AI Gateway =====
    if (!lovableKey) return respond(false, { error: "no_keys", message: "Nenhuma chave configurada" });

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: [
            { type: "text", text: `Analise esta foto da empresa "${companyName || 'N/A'}":` },
            { type: "image_url", image_url: { url: imageUrl } },
          ] },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return respond(false, { error: "rate_limit" });
      if (response.status === 402) return respond(false, { error: "credits_exhausted" });
      return respond(false, { error: "ai_error" });
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    return respond(true, { ...parseJson(content), imageHash });
  } catch (e) {
    console.error("Error:", e);
    return respond(false, { error: "unknown", message: e instanceof Error ? e.message : "Erro desconhecido" });
  }
});
