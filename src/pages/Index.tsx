import { useState, useCallback, useMemo } from 'react';
import { AgentData, FilterType } from '@/types/analysis';
import { parseExcelFile } from '@/lib/parseExcel';
import { exportResultsToExcel } from '@/lib/exportResults';
import { supabase } from '@/integrations/supabase/client';
import { FileUpload } from '@/components/FileUpload';
import { DashboardSummary } from '@/components/DashboardSummary';
import { AgentCard } from '@/components/AgentCard';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Play, Download, Filter } from 'lucide-react';

const Index = () => {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [filter, setFilter] = useState<FilterType>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const { toast } = useToast();

  const uniqueAgentNames = useMemo(() => {
    const names = [...new Set(agents.map(a => a.name))];
    return names.sort();
  }, [agents]);

  const handleFileSelected = useCallback(async (file: File) => {
    setIsLoadingFile(true);
    try {
      const parsed = await parseExcelFile(file);
      setAgents(parsed);
      toast({ title: `${parsed.length} atendimentos carregados`, description: `${parsed.reduce((s, a) => s + a.photos.length, 0)} fotos encontradas` });
    } catch {
      toast({ title: 'Erro ao ler planilha', variant: 'destructive' });
    } finally {
      setIsLoadingFile(false);
    }
  }, [toast]);

  const analyzeAll = useCallback(async () => {
    setIsAnalyzing(true);
    setProgress(0);

    const totalPhotos = agents.reduce((s, a) => s + a.photos.length, 0);
    let done = 0;

    const updatedAgents = [...agents];

    for (let i = 0; i < updatedAgents.length; i++) {
      for (let j = 0; j < updatedAgents[i].photos.length; j++) {
        updatedAgents[i].photos[j].status = 'analyzing';
        setAgents([...updatedAgents]);

        try {
          const { data, error } = await supabase.functions.invoke('analyze-photo', {
            body: {
              imageUrl: updatedAgents[i].photos[j].url,
              companyName: updatedAgents[i].companyName,
              segment: updatedAgents[i].segment,
            },
          });

          if (error) throw error;

          updatedAgents[i].photos[j].analysis = data;
          updatedAgents[i].photos[j].status = 'done';
        } catch (err: any) {
          updatedAgents[i].photos[j].status = 'error';
          updatedAgents[i].photos[j].error = err?.message || 'Erro na análise';
        }

        done++;
        setProgress(Math.round((done / totalPhotos) * 100));
        setAgents([...updatedAgents]);

        if (done < totalPhotos) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }

    setIsAnalyzing(false);
    toast({ title: 'Análise concluída!', description: `${done} fotos analisadas` });
  }, [agents, toast]);

  const filteredAgents = agents.filter(agent => {
    if (agentFilter !== 'all' && agent.name !== agentFilter) return false;
    if (filter === 'all') return true;
    const allDone = agent.photos.every(p => p.status === 'done' || p.status === 'error');
    if (!allDone) return true;
    const hasInconsistency = agent.photos.some(p => p.analysis && !p.analysis.aprovada);
    return filter === 'inconsistent' ? hasInconsistency : !hasInconsistency;
  });

  const hasResults = agents.some(a => a.photos.some(p => p.status === 'done'));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Sebrae na Sua Empresa</h1>
            <p className="text-sm text-muted-foreground">Validador de Fotos de Visita</p>
          </div>
          {hasResults && (
            <Button variant="outline" onClick={() => exportResultsToExcel(agents)}>
              <Download className="h-4 w-4 mr-2" /> Exportar Relatório
            </Button>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {agents.length === 0 ? (
          <div className="max-w-xl mx-auto mt-12">
            <FileUpload onFileSelected={handleFileSelected} isLoading={isLoadingFile} />
          </div>
        ) : (
          <>
            <DashboardSummary agents={agents} />

            {isAnalyzing && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Analisando fotos...</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              {!isAnalyzing && !hasResults && (
                <Button onClick={analyzeAll}>
                  <Play className="h-4 w-4 mr-2" /> Iniciar Análise
                </Button>
              )}
              {hasResults && !isAnalyzing && (
                <Button variant="outline" onClick={analyzeAll}>
                  <Play className="h-4 w-4 mr-2" /> Re-analisar
                </Button>
              )}

              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Filtrar por agente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os agentes</SelectItem>
                  {uniqueAgentNames.map(name => (
                    <SelectItem key={name} value={name}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-1 ml-auto">
                <Filter className="h-4 w-4 text-muted-foreground" />
                {(['all', 'approved', 'inconsistent'] as FilterType[]).map(f => (
                  <Button
                    key={f}
                    variant={filter === f ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setFilter(f)}
                  >
                    {f === 'all' ? 'Todas' : f === 'approved' ? 'Aprovadas' : 'Inconsistências'}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {filteredAgents.map((agent, idx) => (
                <AgentCard key={idx} agent={agent} />
              ))}
            </div>

            {filteredAgents.length === 0 && (
              <p className="text-center text-muted-foreground py-8">Nenhum atendimento encontrado com esse filtro.</p>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default Index;
