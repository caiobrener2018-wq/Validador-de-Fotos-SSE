import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // 10 slots no total. Slot 4 (token Gemini com 403) usa Lovable AI.
  let count = 0;
  for (let i = 1; i <= 10; i++) {
    if (i === 4) {
      if (Deno.env.get("LOVABLE_API_KEY")) count++;
    } else if (Deno.env.get(`GEMINI_API_KEY_${i}`)) {
      count++;
    }
  }
  if (count === 0 && Deno.env.get("LOVABLE_API_KEY")) count = 1;

  return new Response(JSON.stringify({ count: Math.max(count, 1) }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
