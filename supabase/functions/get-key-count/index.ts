import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let count = 0;
  for (let i = 1; i <= 10; i++) {
    if (Deno.env.get(`GEMINI_API_KEY_${i}`)) count++;
  }
  // Fallback: keep at least 1 so the client can still process sequentially via Lovable AI Gateway
  if (count === 0 && Deno.env.get("LOVABLE_API_KEY")) count = 1;

  return new Response(JSON.stringify({ count: Math.max(count, 1) }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
