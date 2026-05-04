import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let count = 0;
  if (Deno.env.get("LOVABLE_API_KEY")) count++;
  for (let i = 2; i <= 10; i++) {
    if (Deno.env.get(`LOVABLE_API_KEY_${i}`)) count++;
  }

  return new Response(JSON.stringify({ count: Math.max(count, 1) }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
