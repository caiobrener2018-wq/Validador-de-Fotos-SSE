import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imageUrl } = await req.json();
    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "imageUrl is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `Você é um validador de fotos para o programa "Sebrae na Sua Empresa". 
Agentes terceirizados visitam empresas e devem enviar fotos como prova da visita.

Analise a imagem e verifique se ela atende a PELO MENOS UM dos seguintes critérios:
1. FACHADA/MARCA: A foto mostra a fachada ou marca/logotipo de uma empresa ou estabelecimento comercial?
2. EMPRESÁRIO: A foto mostra pessoas (agente com empresário) em contexto profissional/reunião?
3. INTERIOR: A foto foi tirada dentro de um estabelecimento comercial (loja, escritório, oficina, etc.)?

Responda EXATAMENTE neste formato JSON:
{
  "aprovada": true ou false,
  "criterios": {
    "fachada": true ou false,
    "empresario": true ou false, 
    "interior": true ou false
  },
  "justificativa": "Explicação breve do que foi identificado na foto"
}

Se a imagem não puder ser carregada ou não for uma foto válida, marque aprovada como false e explique na justificativa.`;

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
              { type: "text", text: "Analise esta foto de visita de agente:" },
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
                  aprovada: { type: "boolean", description: "Se a foto atende pelo menos 1 critério" },
                  criterios: {
                    type: "object",
                    properties: {
                      fachada: { type: "boolean" },
                      empresario: { type: "boolean" },
                      interior: { type: "boolean" },
                    },
                    required: ["fachada", "empresario", "interior"],
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
        return new Response(JSON.stringify({ error: "Rate limit excedido. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes. Adicione créditos no workspace." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI error:", response.status, text);
      return new Response(JSON.stringify({ error: "Erro na análise da IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    
    let result;
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      result = JSON.parse(toolCall.function.arguments);
    } else {
      // Fallback: try parsing from content
      const content = data.choices?.[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        result = { aprovada: false, criterios: { fachada: false, empresario: false, interior: false }, justificativa: "Não foi possível analisar a imagem." };
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
