import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const OPENAI_MODEL = "gpt-4o-mini";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

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
  if (headerType?.startsWith("image/")) return headerType === "image/jpg" ? "image/jpeg" : headerType;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
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
    const { imageUrl, companyName, segment } = await req.json();
    if (!imageUrl) return respond(false, { error: "imageUrl is required" });

    const openaiKey = Deno.env.get("API_CHAT_RENATINHA");
    if (!openaiKey) return respond(false, { error: "no_keys", message: "API_CHAT_RENATINHA não configurada" });

    const systemPrompt = buildSystemPrompt(companyName || "", segment || "");

    // Baixa a imagem para calcular o hash (deduplicação por conteúdo)
    let bytes: Uint8Array;
    try {
      bytes = await fetchImageBytes(imageUrl);
    } catch (e) {
      return respond(false, { error: "image_fetch", message: e instanceof Error ? e.message : "Falha ao baixar imagem" });
    }
    const imageHash = await sha256(bytes);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
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
      const text = await response.text().catch(() => "");
      console.error("OpenAI error:", response.status, text);
      if (response.status === 429) {
        if (text.includes("insufficient_quota")) {
          return respond(false, { error: "credits_exhausted", message: "Créditos OpenAI esgotados." });
        }
        return respond(false, { error: "rate_limit", message: "Rate limit OpenAI." });
      }
      if (response.status === 402) return respond(false, { error: "credits_exhausted", message: "Créditos esgotados." });
      return respond(false, { error: "ai_error", message: `OpenAI ${response.status}` });
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    return respond(true, { ...parseJson(content), imageHash });
  } catch (e) {
    console.error("Error:", e);
    return respond(false, { error: "unknown", message: e instanceof Error ? e.message : "Erro desconhecido" });
  }
});
