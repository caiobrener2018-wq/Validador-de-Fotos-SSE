import { AgentData } from '@/types/analysis';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react';

interface Props {
  agent: AgentData;
}

export function AgentCard({ agent }: Props) {
  const allDone = agent.photos.every(p => p.status === 'done' || p.status === 'error');
  const hasInconsistency = agent.photos.some(p => p.analysis && !p.analysis.aprovada);
  const isAnalyzing = agent.photos.some(p => p.status === 'analyzing');

  return (
    <Card className={hasInconsistency && allDone ? 'border-destructive/50' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{agent.name}</CardTitle>
          {isAnalyzing && <Badge variant="secondary"><Loader2 className="h-3 w-3 animate-spin mr-1" />Analisando</Badge>}
          {allDone && !hasInconsistency && <Badge className="bg-green-600 hover:bg-green-700 text-white">Aprovado</Badge>}
          {allDone && hasInconsistency && <Badge variant="destructive">Inconsistência</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {agent.photos.map((photo, idx) => (
          <div key={idx} className="flex gap-3 items-start rounded-md border p-3 bg-muted/30">
            <div className="w-20 h-20 rounded overflow-hidden bg-muted flex-shrink-0">
              <img
                src={photo.url}
                alt={`Foto ${idx + 1}`}
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground mb-1">Foto {idx + 1}</p>
              {photo.status === 'pending' && <p className="text-sm text-muted-foreground">Aguardando análise...</p>}
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
                  </div>
                  <p className="text-xs text-muted-foreground">{photo.analysis.justificativa}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
