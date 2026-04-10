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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imageUrl, companyName, segment } = await req.json();
    if (!imageUrl) return respond(false, { error: "imageUrl is required" });

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return respond(false, { error: "LOVABLE_API_KEY not configured" });

    const contextInfo = companyName || segment
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
5. CONTEXTO DO SEGMENTO: Os elementos visuais da foto são compatíveis com o segmento da empresa? Exemplos:
   - Farmácia → medicamentos, prateleiras de remédios, balcão de atendimento
   - Loja de roupas → araras, manequins, roupas expostas
   - Academia → aparelhos de musculação, tatames, pesos
   - Restaurante → mesas, cozinha, alimentos
   - Oficina mecânica → ferramentas, veículos, peças
   Se o segmento não foi informado, marque como true se houver elementos comerciais visíveis.
${contextInfo}

A foto é APROVADA se atender pelo menos 1 dos critérios (fachada, empresário ou interior) E o fundo for válido E o contexto do segmento for compatível.

Responda EXATAMENTE neste formato JSON:
{
  "aprovada": true ou false,
  "criterios": {
    "fachada": true ou false,
    "empresario": true ou false,
    "interior": true ou false,
    "fundo_valido": true ou false,
    "contexto_segmento": true ou false
  },
  "justificativa": "Explicação breve do que foi identificado na foto e por que foi aprovada ou reprovada"
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: `Analise esta foto de visita do agente à empresa "${companyName || 'N/A'}" (segmento: ${segment || 'N/A'}):` },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "photo_analysis",
              description: "Resultado da análise da foto de visita",
              parameters: {
                type: "object",
                properties: {
                  aprovada: { type: "boolean", description: "Se a foto atende os critérios de validação" },
                  criterios: {
                    type: "object",
                    properties: {
                      fachada: { type: "boolean" },
                      empresario: { type: "boolean" },
                      interior: { type: "boolean" },
                      fundo_valido: { type: "boolean", description: "Fundo não é parede lisa, tem elementos visuais" },
                      contexto_segmento: { type: "boolean", description: "Elementos visuais compatíveis com o segmento" },
                    },
                    required: ["fachada", "empresario", "interior", "fundo_valido", "contexto_segmento"],
                  },
                  justificativa: { type: "string", description: "Explicação breve" },
                },
                required: ["aprovada", "criterios", "justificativa"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "photo_analysis" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return respond(false, { error: "rate_limit", message: "Rate limit excedido. Tente novamente em alguns segundos." });
      }
      if (response.status === 402) {
        return respond(false, { error: "credits_exhausted", message: "Créditos insuficientes." });
      }
      const text = await response.text();
      console.error("AI error:", response.status, text);
      return respond(false, { error: "ai_error", message: "Erro na análise da IA" });
    }

    const data = await response.json();
    
    let result;
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      result = JSON.parse(toolCall.function.arguments);
    } else {
      const content = data.choices?.[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        result = { aprovada: false, criterios: { fachada: false, empresario: false, interior: false, fundo_valido: false, contexto_segmento: false }, justificativa: "Não foi possível analisar a imagem." };
      }
    }

    return respond(true, result);
  } catch (e) {
    console.error("Error:", e);
    return respond(false, { error: "unknown", message: e instanceof Error ? e.message : "Erro desconhecido" });
  }
});
