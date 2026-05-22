import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
import { ExportDialog } from '@/components/ExportDialog';
import { Play, Download, Filter, RefreshCw, ImageDown, FileSpreadsheet, Pause, X } from 'lucide-react';

// Fila contínua adaptativa para OpenAI: respeita ~500 RPM sem formar lotes.
const OPENAI_RPM_LIMIT = 480;
const START_INTERVAL_MS = Math.ceil(60_000 / OPENAI_RPM_LIMIT);
const MIN_CONCURRENCY = 8;
const INITIAL_CONCURRENCY = 28;
const MAX_CONCURRENCY = 48;
const INITIAL_VISIBLE_AGENTS = 120;
const LOAD_MORE_AGENTS = 120;

async function analyzeOnce(
  photo: { url: string; companyName: string; segment: string }
): Promise<any> {
  const { data } = await supabase.functions.invoke('analyze-photo', {
    body: { imageUrl: photo.url, companyName: photo.companyName, segment: photo.segment },
  });
  if (data?.ok === false && data.error === 'rate_limit') {
    const err: any = new Error('rate_limit');
    err.rateLimit = true;
    err.retryAfterMs = Number(data.retryAfterMs) || 3000;
    throw err;
  }
  if (data?.ok === false && data.error === 'credits_exhausted') {
    const err: any = new Error('credits_exhausted'); err.credits = true; throw err;
  }
  if (data?.ok === false) throw new Error(data.message || data.error || 'Erro na análise');
  const { ok, ...result } = data || {};
  return result;
}

async function analyzeWithRetry(
  photo: { url: string; companyName: string; segment: string },
  shouldStop: () => boolean,
  waitIfPaused: () => Promise<void>,
  onRateLimit: (retryAfterMs: number) => void,
  waitForStartSlot: () => Promise<void>,
  maxRetries = 8
): Promise<any> {
  const controlledDelay = async (ms: number) => {
    let remaining = ms;
    while (remaining > 0) {
      await waitIfPaused();
      if (shouldStop()) { const e: any = new Error('cancelled'); e.cancelled = true; throw e; }
      const step = Math.min(remaining, 250);
      await new Promise(r => setTimeout(r, step));
      remaining -= step;
    }
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await waitIfPaused();
    if (shouldStop()) { const e: any = new Error('cancelled'); e.cancelled = true; throw e; }
    try {
      await waitForStartSlot();
      return await analyzeOnce(photo);
    } catch (err: any) {
      if (err?.cancelled) throw err;
      if (attempt >= maxRetries) throw err;
      if (err?.rateLimit) onRateLimit(Number(err.retryAfterMs) || 3000);
      const base = err?.rateLimit ? Math.max(Number(err.retryAfterMs) || 3000, 3000) : 1500;
      const jitter = Math.floor(Math.random() * 500);
      await controlledDelay(base * Math.pow(1.45, attempt) + jitter);
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
  const [agencyFilter, setAgencyFilter] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_AGENTS);
  const { toast } = useToast();
  const agentsRef = useRef<AgentData[]>([]);
  agentsRef.current = agents;
  const pausedRef = useRef(false);
  const cancelledRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);

  const uniqueAgentNames = useMemo(() => [...new Set(agents.map(a => a.name))].sort(), [agents]);
  const uniqueAgencies = useMemo(() => [...new Set(agents.map(a => a.agency).filter(Boolean))].sort(), [agents]);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    setIsLoadingFile(true);
    try {
      const newAgents = await parseExcelFile(files[0]);
      setAgents(newAgents);
      const totalPhotos = newAgents.reduce((s, a) => s + a.photos.length, 0);
      toast({ title: 'Planilha carregada', description: `${newAgents.length} atendimentos, ${totalPhotos} fotos` });
    } catch {
      toast({ title: 'Erro ao ler planilha', variant: 'destructive' });
    } finally {
      setIsLoadingFile(false);
    }
  }, [toast]);

  const runAnalysis = useCallback(async (targetAgents: AgentData[], onlyErrors = false) => {
    pausedRef.current = false;
    cancelledRef.current = false;
    setIsPaused(false);
    setIsAnalyzing(true);
    setProgress(0);

    const shouldStop = () => cancelledRef.current;
    const waitIfPaused = async () => {
      while (pausedRef.current && !cancelledRef.current) {
        await new Promise(r => setTimeout(r, 250));
      }
    };
    let nextStartAt = 0;
    let startQueue = Promise.resolve();
    const pacedDelay = async (ms: number) => {
      let remaining = ms;
      while (remaining > 0) {
        await waitIfPaused();
        if (shouldStop()) { const e: any = new Error('cancelled'); e.cancelled = true; throw e; }
        const step = Math.min(remaining, 100);
        await new Promise(r => setTimeout(r, step));
        remaining -= step;
      }
    };
    const waitForStartSlot = () => {
      const turn = startQueue.then(async () => {
        const waitMs = Math.max(0, nextStartAt - Date.now());
        if (waitMs > 0) await pacedDelay(waitMs);
        nextStartAt = Date.now() + START_INTERVAL_MS;
      });
      startQueue = turn.catch(() => undefined);
      return turn;
    };

    // Clone top-level array; agent objects are cloned on update for memo to work
    const updated = agentsRef.current.map(a => a);
    const targetSet = new Set(targetAgents);

    // Throttle React updates to avoid freezing UI with thousands of photos
    let dirty = false;
    let lastFlush = 0;
    const FLUSH_INTERVAL = 400;
    const flush = () => {
      dirty = false;
      lastFlush = Date.now();
      setAgents(updated.slice());
    };
    const scheduleFlush = () => {
      dirty = true;
      const now = Date.now();
      if (now - lastFlush >= FLUSH_INTERVAL) flush();
    };
    const flushTimer = setInterval(() => { if (dirty) flush(); }, FLUSH_INTERVAL);

    // Build task queue
    const tasks: { agentIdx: number; photoIdx: number }[] = [];
    updated.forEach((agent, aIdx) => {
      if (!targetSet.has(agent)) return;
      agent.photos.forEach((photo, pIdx) => {
        if (photo.duplicate) return;
        if (onlyErrors && photo.status !== 'error') return;
        tasks.push({ agentIdx: aIdx, photoIdx: pIdx });
      });
    });

    const total = tasks.length;
    if (total === 0) {
      setIsAnalyzing(false);
      return;
    }

    // Mark all as analyzing upfront
    tasks.forEach(t => { updated[t.agentIdx].photos[t.photoIdx].status = 'analyzing'; });
    setAgents(updated.slice());

    // Hash map for AI-based dedup (built incrementally)
    const hashMap = new Map<string, { agent: string; company: string; row: number }>();
    // Pre-populate from already-done photos with hash
    updated.forEach(a => a.photos.forEach(p => {
      if (p.imageHash && p.status === 'done') {
        if (!hashMap.has(p.imageHash)) {
          hashMap.set(p.imageHash, { agent: a.name, company: a.companyName, row: a.excelRow });
        }
      }
    }));

    let done = 0;
    let cursor = 0;
    const inflight = new Set<Promise<void>>();
    let currentConcurrency = INITIAL_CONCURRENCY;
    let stableCompletions = 0;
    let lastProgress = -1;

    const onRateLimit = (retryAfterMs: number) => {
      currentConcurrency = Math.max(MIN_CONCURRENCY, Math.floor(currentConcurrency * 0.65));
      stableCompletions = 0;
      console.info(`OpenAI rate limit: reduzindo paralelismo para ${currentConcurrency}. Retry em ${retryAfterMs}ms.`);
    };

    const launch = async (task: { agentIdx: number; photoIdx: number }) => {
      const agent = updated[task.agentIdx];
      const photo = agent.photos[task.photoIdx];
      try {
        const result = await analyzeWithRetry({
          url: photo.url,
          companyName: agent.companyName,
          segment: agent.segment,
        }, shouldStop, waitIfPaused, onRateLimit, waitForStartSlot);
        stableCompletions++;
        if (stableCompletions >= 30 && currentConcurrency < MAX_CONCURRENCY) {
          currentConcurrency++;
          stableCompletions = 0;
        }

        // AI-based dedup via image hash
        const hash = result.imageHash as string | undefined;
        if (hash) {
          photo.imageHash = hash;
          const existing = hashMap.get(hash);
          if (existing && !(existing.agent === agent.name && existing.row === agent.excelRow && agent.photos.indexOf(photo) === task.photoIdx)) {
            photo.status = 'duplicate';
            photo.duplicate = true;
            photo.duplicateOf = existing;
          } else {
            hashMap.set(hash, { agent: agent.name, company: agent.companyName, row: agent.excelRow });
            const { imageHash, ...analysis } = result;
            photo.analysis = analysis;
            photo.status = 'done';
          }
        } else {
          photo.analysis = result;
          photo.status = 'done';
        }
      } catch (err: any) {
        if (err?.cancelled) {
          photo.status = 'pending';
        } else {
          photo.status = 'error';
          photo.error = err?.message || 'Erro na análise';
        }
      }
      updated[task.agentIdx] = { ...agent, photos: agent.photos.slice() };
      done++;
      const nextProgress = Math.round((done / total) * 100);
      if (nextProgress !== lastProgress || done === total) {
        lastProgress = nextProgress;
        setProgress(nextProgress);
      }
      scheduleFlush();
    };

    // Pool dinâmico: dispara até currentConcurrency simultâneas; assim que uma
    // termina, outra é iniciada imediatamente — sem esperar lotes.
    while (cursor < tasks.length || inflight.size > 0) {
      while (inflight.size < currentConcurrency && cursor < tasks.length && !cancelledRef.current) {
        const task = tasks[cursor++];
        const p = launch(task).finally(() => { inflight.delete(p); });
        inflight.add(p);
      }
      if (inflight.size === 0) break;
      await Promise.race(inflight);
    }
    clearInterval(flushTimer);
    flush();

    const wasCancelled = cancelledRef.current;
    setIsAnalyzing(false);
    setIsPaused(false);
    pausedRef.current = false;
    cancelledRef.current = false;
    toast({
      title: wasCancelled ? 'Análise cancelada' : 'Análise concluída!',
      description: `${done} fotos processadas`,
    });
  }, [toast]);

  const handlePauseToggle = useCallback(() => {
    pausedRef.current = !pausedRef.current;
    setIsPaused(pausedRef.current);
  }, []);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    pausedRef.current = false;
    setIsPaused(false);
  }, []);

  const filteredAgents = useMemo(() => agents.filter(agent => {
    if (agentFilter !== 'all' && agent.name !== agentFilter) return false;
    if (agencyFilter !== 'all' && agent.agency !== agencyFilter) return false;
    if (filter === 'all') return true;
    const noPhotos = agent.photos.length === 0;
    if (filter === 'no_photos') return noPhotos;
    if (filter === 'duplicate') return agent.photos.some(p => p.status === 'duplicate');
    const allDone = !noPhotos && agent.photos.every(p => p.status === 'done' || p.status === 'error' || p.status === 'duplicate');
    if (!noPhotos && !allDone) return true;
    const hasInconsistency = noPhotos || agent.photos.some(p => (p.analysis && !p.analysis.aprovada) || p.status === 'duplicate');
    return filter === 'inconsistent' ? hasInconsistency : !hasInconsistency;
  }), [agents, agentFilter, agencyFilter, filter]);
  const visibleAgents = useMemo(() => filteredAgents.slice(0, visibleCount), [filteredAgents, visibleCount]);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_AGENTS);
  }, [agents, agentFilter, agencyFilter, filter]);

  const [exportDialogOpen, setExportDialogOpen] = useState(false);
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
          {agents.length > 0 && (
            <label className="cursor-pointer">
              <input type="file" accept=".xlsx,.xls" onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                if (files.length > 0) handleFilesSelected(files);
                e.target.value = '';
              }} className="hidden" disabled={isLoadingFile} />
              <span className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">
                Trocar Planilha
              </span>
            </label>
          )}
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
                  <span>{isPaused ? 'Pausado' : 'Analisando fotos... (fila contínua até 500 RPM)'}</span>
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
              {isAnalyzing && (
                <>
                  <Button variant="outline" onClick={handlePauseToggle}>
                    {isPaused ? (<><Play className="h-4 w-4 mr-2" /> Retomar</>) : (<><Pause className="h-4 w-4 mr-2" /> Pausar</>)}
                  </Button>
                  <Button variant="destructive" onClick={handleCancel}>
                    <X className="h-4 w-4 mr-2" /> Cancelar
                  </Button>
                </>
              )}

              {agents.length > 0 && (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">
                        <Download className="h-4 w-4 mr-2" /> Exportar
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => exportResultsToExcel(agents)}>
                        <FileSpreadsheet className="h-4 w-4 mr-2" /> Relatório Completo (Excel)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportResultsToExcel(filteredAgents)}>
                        <FileSpreadsheet className="h-4 w-4 mr-2" /> Relatório Filtrado (Excel)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportImagesToZip(agents)}>
                        <ImageDown className="h-4 w-4 mr-2" /> Todas as Imagens (ZIP)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportImagesToZip(filteredAgents)}>
                        <ImageDown className="h-4 w-4 mr-2" /> Imagens Filtradas (ZIP)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setExportDialogOpen(true)}>
                        <Download className="h-4 w-4 mr-2" /> Selecionar Agências...
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <ExportDialog open={exportDialogOpen} onOpenChange={setExportDialogOpen} agents={agents} />
                </>
              )}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <Select value={agencyFilter} onValueChange={setAgencyFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Agência" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as agências</SelectItem>
                  {uniqueAgencies.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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

              <div className="flex items-center gap-1 ml-auto flex-wrap">
                <Filter className="h-4 w-4 text-muted-foreground" />
                {([
                  { v: 'all', label: 'Todas' },
                  { v: 'approved', label: 'Aprovadas' },
                  { v: 'inconsistent', label: 'Inconsistências' },
                  { v: 'duplicate', label: 'Duplicadas' },
                  { v: 'no_photos', label: 'Sem fotos' },
                ] as { v: FilterType; label: string }[]).map(f => (
                  <Button key={f.v} variant={filter === f.v ? 'default' : 'ghost'} size="sm" onClick={() => setFilter(f.v)}>
                    {f.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {visibleAgents.map((agent, idx) => (
                <AgentCard key={`${agent.excelRow}-${idx}`} agent={agent} />
              ))}
            </div>

            {visibleCount < filteredAgents.length && (
              <div className="flex justify-center">
                <Button variant="outline" onClick={() => setVisibleCount(count => count + LOAD_MORE_AGENTS)}>
                  Carregar mais atendimentos ({filteredAgents.length - visibleCount} restantes)
                </Button>
              </div>
            )}

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
