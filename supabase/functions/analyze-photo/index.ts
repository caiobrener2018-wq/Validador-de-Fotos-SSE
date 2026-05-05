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

function collectGeminiKeys(): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const k = Deno.env.get(`GEMINI_API_KEY_${i}`);
    if (k) keys.push(k);
  }
  return keys;
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Falha ao baixar imagem: ${r.status}`);
  const mimeType = r.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const buf = new Uint8Array(await r.arrayBuffer());
  // base64 encode
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return { data: btoa(binary), mimeType };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imageUrl, companyName, segment, keyIndex } = await req.json();
    if (!imageUrl) return respond(false, { error: "imageUrl is required" });

    const contextInfo = (companyName || segment)
      ? `\n\nCONTEXTO DA VISITA:
- Empresa: ${companyName || 'Não informado'}
- Segmento: ${segment || 'Não informado'}

Use essas informações para verificar se o conteúdo visual da foto é compatível com o segmento da empresa.`
      : '';

    const systemPrompt = `Você é um validador de fotos para o programa "Sebrae na Sua Empresa". 
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

    const geminiKeys = collectGeminiKeys();

    // ===== Tenta Gemini direto (rotacionando entre as chaves fornecidas) =====
    if (geminiKeys.length > 0) {
      const idx = ((keyIndex ?? 0) % geminiKeys.length + geminiKeys.length) % geminiKeys.length;
      const apiKey = geminiKeys[idx];

      let imagePart: { inline_data: { mime_type: string; data: string } };
      try {
        const { data, mimeType } = await fetchImageAsBase64(imageUrl);
        imagePart = { inline_data: { mime_type: mimeType, data } };
      } catch (e) {
        return respond(false, { error: "image_fetch", message: e instanceof Error ? e.message : "Falha ao baixar imagem" });
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{
            role: "user",
            parts: [
              { text: `Analise esta foto de visita do agente à empresa "${companyName || 'N/A'}" (segmento: ${segment || 'N/A'}). Responda apenas com o JSON solicitado.` },
              imagePart,
            ],
          }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error("Gemini error:", resp.status, text);
        if (resp.status === 429) {
          return respond(false, { error: "rate_limit", message: "Rate limit excedido nesta chave Gemini." });
        }
        return respond(false, { error: "ai_error", message: `Gemini ${resp.status}` });
      }

      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("") || "";
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        const m = text.match(/\{[\s\S]*\}/);
        result = m ? JSON.parse(m[0]) : {
          aprovada: false,
          criterios: { fachada: false, empresario: false, interior: false, fundo_valido: false, contexto_segmento: false },
          justificativa: "Não foi possível analisar a imagem.",
        };
      }
      return respond(true, result);
    }

    // ===== Fallback: Lovable AI Gateway =====
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return respond(false, { error: "no_keys", message: "Nenhuma chave Gemini ou Lovable configurada" });

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
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
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {
      aprovada: false,
      criterios: { fachada: false, empresario: false, interior: false, fundo_valido: false, contexto_segmento: false },
      justificativa: "Não foi possível analisar.",
    };
    return respond(true, result);
  } catch (e) {
    console.error("Error:", e);
    return respond(false, { error: "unknown", message: e instanceof Error ? e.message : "Erro desconhecido" });
  }
});
