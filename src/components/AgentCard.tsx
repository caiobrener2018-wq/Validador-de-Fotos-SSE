import { useState, memo, type CSSProperties } from 'react';
import { AgentData } from '@/types/analysis';
import { getAgentStatus } from '@/lib/agentStatus';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { CheckCircle, XCircle, Loader2, AlertTriangle, Copy, Sparkles, UserX } from 'lucide-react';

interface Props {
  agent: AgentData;
}

const SUPABASE_URL = "https://kcuuymecihfjgqmvybzk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtjdXV5bWVjaWhmamdxbXZ5YnprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NTY2MDcsImV4cCI6MjA5MTMzMjYwN30.YMF3BIuGkfVRna2B02OlpOv64h9CCkqma7ZqQS41fBw";

function ProxyImg({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [errored, setErrored] = useState(false);
  const [useProxy, setUseProxy] = useState(false);
  if (errored) return <img src="/placeholder.svg" alt={alt} className={className} />;
  if (useProxy) {
    return (
      <img
        src={`${SUPABASE_URL}/functions/v1/proxy-image?url=${encodeURIComponent(src)}&apikey=${SUPABASE_ANON}`}
        alt={alt}
        className={className}
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      crossOrigin="anonymous"
      onError={() => setUseProxy(true)}
    />
  );
}

function AgentCardImpl({ agent }: Props) {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const renderHint = { contentVisibility: 'auto', containIntrinsicSize: '260px' } as CSSProperties;
  const status = getAgentStatus(agent);
  const isAnalyzing = status === 'analyzing';

  const borderClass =
    status === 'ai_generated' ? 'border-purple-500/60' :
    status === 'duplicate' ? 'border-orange-500/50' :
    status === 'no_business_person' ? 'border-amber-500/50' :
    status === 'inconsistent' ? 'border-destructive/50' :
    '';

  return (
    <>
      <Card className={borderClass} style={renderHint}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base">{agent.name}</CardTitle>
              {agent.agency && <p className="text-xs font-medium text-primary truncate">{agent.agency}</p>}
              <p className="text-sm text-muted-foreground truncate">{agent.companyName}{agent.segment ? ` • ${agent.segment}` : ''} <span className="text-muted-foreground/60">• Linha {agent.excelRow}</span></p>
            </div>
            {status === 'no_photos' && <Badge variant="outline" className="border-amber-500 text-amber-700"><AlertTriangle className="h-3 w-3 mr-1" />Não possui fotos</Badge>}
            {status === 'ai_generated' && <Badge variant="outline" className="border-purple-500 text-purple-700"><Sparkles className="h-3 w-3 mr-1" />IA</Badge>}
            {status === 'duplicate' && <Badge variant="outline" className="border-orange-500 text-orange-700"><Copy className="h-3 w-3 mr-1" />Duplicada</Badge>}
            {status === 'no_business_person' && <Badge variant="outline" className="border-amber-500 text-amber-700"><UserX className="h-3 w-3 mr-1" />Sem empresário</Badge>}
            {isAnalyzing && <Badge variant="secondary"><Loader2 className="h-3 w-3 animate-spin mr-1" />Analisando</Badge>}
            {status === 'approved' && <Badge className="bg-green-600 hover:bg-green-700 text-white">Aprovado</Badge>}
            {status === 'inconsistent' && <Badge variant="destructive">Inconsistência</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {status === 'no_photos' && (
            <div className="rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Este atendimento não possui fotos enviadas pelo agente.
            </div>
          )}
          {agent.photos.map((photo, idx) => (
            <div key={idx} className="flex gap-3 items-start rounded-md border p-3 bg-muted/30">
              <div
                className="w-20 h-20 rounded overflow-hidden bg-muted flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => setSelectedPhoto(photo.url)}
              >
                <ProxyImg
                  src={photo.url}
                  alt={`Foto ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground mb-1">Foto {idx + 1}</p>
                {photo.status === 'pending' && <p className="text-sm text-muted-foreground">Aguardando análise...</p>}
                {photo.status === 'duplicate' && (
                  <div className="flex items-start gap-1 text-sm text-orange-700">
                    <Copy className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <span>Foto duplicada{photo.duplicateOf ? ` (já enviada por ${photo.duplicateOf.agent} - ${photo.duplicateOf.company}, linha ${photo.duplicateOf.row})` : ''}</span>
                  </div>
                )}
                {photo.status === 'analyzing' && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Analisando...
                  </div>
                )}
                {photo.status === 'error' && (
                  <div className="flex items-center gap-1 text-sm text-destructive">
                    <AlertTriangle className="h-3 w-3" /> {photo.error || 'Erro na análise'}
                  </div>
                )}
                {photo.status === 'done' && photo.analysis && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      {photo.analysis.aprovada ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                      <span className={`text-sm font-medium ${photo.analysis.aprovada ? 'text-green-600' : 'text-destructive'}`}>
                        {photo.analysis.aprovada ? 'Aprovada' : 'Inconsistência'}
                      </span>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {photo.analysis.criterios.fachada && <Badge variant="outline" className="text-xs">Fachada</Badge>}
                      {photo.analysis.criterios.empresario && <Badge variant="outline" className="text-xs">Empresário</Badge>}
                      {photo.analysis.criterios.interior && <Badge variant="outline" className="text-xs">Interior</Badge>}
                      {photo.analysis.criterios.fundo_valido ? (
                        <Badge variant="outline" className="text-xs border-green-500 text-green-700">Fundo OK</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs border-destructive text-destructive">Fundo Inválido</Badge>
                      )}
                      {photo.analysis.criterios.contexto_segmento ? (
                        <Badge variant="outline" className="text-xs border-green-500 text-green-700">Segmento OK</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs border-destructive text-destructive">Segmento Incompatível</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{photo.analysis.justificativa}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
        <DialogContent className="max-w-3xl p-2">
          {selectedPhoto && (
            <ProxyImg src={selectedPhoto} alt="Foto ampliada" className="w-full max-h-[80vh] object-contain rounded" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export const AgentCard = memo(AgentCardImpl, (prev, next) => prev.agent === next.agent);
