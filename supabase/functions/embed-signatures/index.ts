import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EMBED_MODEL = "text-embedding-3-small"; // 1536 dims, ~3000 RPM, baixíssimo custo
const MAX_BATCH = 200;

function respond(ok: boolean, data: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok, ...data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { texts } = await req.json();
    if (!Array.isArray(texts) || texts.length === 0) {
      return respond(false, { error: "bad_request", message: "texts (array) é obrigatório" });
    }
    if (texts.length > MAX_BATCH) {
      return respond(false, { error: "bad_request", message: `máximo ${MAX_BATCH} por requisição` });
    }
    const openaiKey = Deno.env.get("API_CHAT_RENATINHA");
    if (!openaiKey) return respond(false, { error: "no_keys", message: "API_CHAT_RENATINHA não configurada" });

    // OpenAI rejeita strings vazias — substitui por placeholder para manter o índice
    const cleaned = texts.map((t: unknown) => {
      const s = typeof t === "string" ? t.trim() : "";
      return s.length > 0 ? s.slice(0, 2000) : "vazio";
    });

    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: cleaned }),
    });
    const text = await r.text().catch(() => "");
    if (!r.ok) {
      console.error("OpenAI embeddings error:", r.status, text);
      if (r.status === 429) return respond(false, { error: "rate_limit", message: "Rate limit embeddings", retryAfterMs: 3000 });
      if (r.status === 402) return respond(false, { error: "credits_exhausted", message: "Créditos esgotados." });
      return respond(false, { error: "embed_error", message: `OpenAI ${r.status}` });
    }
    const data = JSON.parse(text);
    const embeddings: number[][] = (data.data || []).map((d: any) => d.embedding);
    return respond(true, { embeddings, model: EMBED_MODEL });
  } catch (e) {
    console.error("Error:", e);
    return respond(false, { error: "unknown", message: e instanceof Error ? e.message : "Erro desconhecido" });
  }
});
