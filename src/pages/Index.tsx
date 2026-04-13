import { useState, useCallback, useMemo } from 'react';
import { AgentData, FilterType } from '@/types/analysis';
import { parseExcelFile } from '@/lib/parseExcel';
import { exportResultsToExcel } from '@/lib/exportResults';
import { exportImagesToZip } from '@/lib/exportImages';
import { supabase } from '@/integrations/supabase/client';
import { FileUpload } from '@/components/FileUpload';
import { DashboardSummary } from '@/components/DashboardSummary';
import { AgentCard } from '@/components/AgentCard';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { Play, Download, Filter, RefreshCw, ImageDown } from 'lucide-react';

const CONCURRENCY = 2;

async function analyzeWithRetry(
  photo: { url: string; companyName: string; segment: string },
  maxRetries = 5
): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const { data } = await supabase.functions.invoke('analyze-photo', {
        body: { imageUrl: photo.url, companyName: photo.companyName, segment: photo.segment },
      });
      clearTimeout(timeout);

      if (data?.ok === false && data.error === 'rate_limit') {
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
          continue;
        }
        throw new Error('Rate limit excedido');
      }
      if (data?.ok === false) throw new Error(data.message || 'Erro na análise');

      const { ok, ...result } = data || {};
      return result;
    } catch (err: any) {
      clearTimeout(timeout);
      if (attempt >= maxRetries) throw err;
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
    }
  }
}

const Index = () => {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [filter, setFilter] = useState<FilterType>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [fileFilter, setFileFilter] = useState<string>('all');
  const { toast } = useToast();

  const uniqueAgentNames = useMemo(() => [...new Set(agents.map(a => a.name))].sort(), [agents]);
  const uniqueCompanies = useMemo(() => [...new Set(agents.map(a => a.companyName).filter(Boolean))].sort(), [agents]);
  const uniqueFiles = useMemo(() => [...new Set(agents.map(a => a.sourceFile))].sort(), [agents]);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    setIsLoadingFile(true);
    try {
      const results = await Promise.all(files.map(f => parseExcelFile(f)));
      const newAgents = results.flat();
      setAgents(prev => [...prev, ...newAgents]);
      const totalPhotos = newAgents.reduce((s, a) => s + a.photos.length, 0);
      toast({ title: `${files.length} planilha(s) carregada(s)`, description: `${newAgents.length} atendimentos, ${totalPhotos} fotos` });
    } catch {
      toast({ title: 'Erro ao ler planilhas', variant: 'destructive' });
    } finally {
      setIsLoadingFile(false);
    }
  }, [toast]);

  const runAnalysis = useCallback(async (targetAgents: AgentData[], onlyErrors = false) => {
    setIsAnalyzing(true);
    setProgress(0);

    const tasks: { agentIdx: number; photoIdx: number }[] = [];
    targetAgents.forEach((agent) => {
      const globalIdx = agents.indexOf(agent);
      agent.photos.forEach((photo, pIdx) => {
        if (!onlyErrors || photo.status === 'error') {
          tasks.push({ agentIdx: globalIdx, photoIdx: pIdx });
        }
      });
    });

    let done = 0;
    const total = tasks.length;
    const updated = [...agents];

    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      const batch = tasks.slice(i, i + CONCURRENCY);

      batch.forEach(t => {
        updated[t.agentIdx].photos[t.photoIdx].status = 'analyzing';
      });
      setAgents([...updated]);

      const promises = batch.map(async (t) => {
        try {
          const agent = updated[t.agentIdx];
          const result = await analyzeWithRetry({
            url: agent.photos[t.photoIdx].url,
            companyName: agent.companyName,
            segment: agent.segment,
          });
          updated[t.agentIdx].photos[t.photoIdx].analysis = result;
          updated[t.agentIdx].photos[t.photoIdx].status = 'done';
        } catch (err: any) {
          updated[t.agentIdx].photos[t.photoIdx].status = 'error';
          updated[t.agentIdx].photos[t.photoIdx].error = err?.message || 'Erro na análise';
        }
        done++;
        setProgress(Math.round((done / total) * 100));
        setAgents([...updated]);
      });

      await Promise.all(promises);

      if (i + CONCURRENCY < tasks.length) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    setIsAnalyzing(false);
    toast({ title: 'Análise concluída!', description: `${done} fotos processadas` });
  }, [agents, toast]);

  const filteredAgents = useMemo(() => agents.filter(agent => {
    if (agentFilter !== 'all' && agent.name !== agentFilter) return false;
    if (companyFilter !== 'all' && agent.companyName !== companyFilter) return false;
    if (fileFilter !== 'all' && agent.sourceFile !== fileFilter) return false;
    if (filter === 'all') return true;
    const allDone = agent.photos.every(p => p.status === 'done' || p.status === 'error');
    if (!allDone) return true;
    const hasInconsistency = agent.photos.some(p => p.analysis && !p.analysis.aprovada);
    return filter === 'inconsistent' ? hasInconsistency : !hasInconsistency;
  }), [agents, agentFilter, companyFilter, fileFilter, filter]);

  const hasResults = agents.some(a => a.photos.some(p => p.status === 'done'));
  const hasErrors = agents.some(a => a.photos.some(p => p.status === 'error'));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Sebrae na Sua Empresa</h1>
            <p className="text-sm text-muted-foreground">Validador de Fotos de Visita</p>
          </div>
          <div className="flex gap-2">
            {agents.length > 0 && (
              <FileUpload onFilesSelected={handleFilesSelected} isLoading={isLoadingFile} />
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {agents.length === 0 ? (
          <div className="max-w-xl mx-auto mt-12">
            <FileUpload onFilesSelected={handleFilesSelected} isLoading={isLoadingFile} />
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
              {!isAnalyzing && (
                <Button onClick={() => runAnalysis(agents)}>
                  <Play className="h-4 w-4 mr-2" /> {hasResults ? 'Re-analisar Tudo' : 'Iniciar Análise'}
                </Button>
              )}
              {hasErrors && !isAnalyzing && (
                <Button variant="outline" onClick={() => runAnalysis(agents, true)}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Reanalisar Falhas
                </Button>
              )}

              {hasResults && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      <Download className="h-4 w-4 mr-2" /> Exportar
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => exportResultsToExcel(agents)}>
                      Relatório Completo (Excel)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportResultsToExcel(filteredAgents)}>
                      Relatório Filtrado (Excel)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportImagesToZip(agents)}>
                      <ImageDown className="h-4 w-4 mr-2" /> Todas as Imagens (ZIP)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportImagesToZip(filteredAgents)}>
                      <ImageDown className="h-4 w-4 mr-2" /> Imagens Filtradas (ZIP)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <Select value={fileFilter} onValueChange={setFileFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Planilha" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as planilhas</SelectItem>
                  {uniqueFiles.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={companyFilter} onValueChange={setCompanyFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Empresa" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as empresas</SelectItem>
                  {uniqueCompanies.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Agente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os agentes</SelectItem>
                  {uniqueAgentNames.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-1 ml-auto">
                <Filter className="h-4 w-4 text-muted-foreground" />
                {(['all', 'approved', 'inconsistent'] as FilterType[]).map(f => (
                  <Button key={f} variant={filter === f ? 'default' : 'ghost'} size="sm" onClick={() => setFilter(f)}>
                    {f === 'all' ? 'Todas' : f === 'approved' ? 'Aprovadas' : 'Inconsistências'}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {filteredAgents.map((agent, idx) => (
                <AgentCard key={`${agent.sourceFile}-${idx}`} agent={agent} />
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
