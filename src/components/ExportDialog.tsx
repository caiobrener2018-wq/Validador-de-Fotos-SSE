import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AgentData } from '@/types/analysis';
import { exportResultsToExcel } from '@/lib/exportResults';
import { exportImagesToZip } from '@/lib/exportImages';
import { ImageDown, FileSpreadsheet } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: AgentData[];
}

export function ExportDialog({ open, onOpenChange, agents }: ExportDialogProps) {
  const uniqueAgencies = [...new Set(agents.map(a => a.agency || 'Sem Agência'))].sort();
  const [selected, setSelected] = useState<Set<string>>(new Set(uniqueAgencies));
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');

  const toggle = (item: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(item) ? next.delete(item) : next.add(item);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev =>
      prev.size === uniqueAgencies.length ? new Set() : new Set(uniqueAgencies)
    );
  };

  const selectedAgents = agents.filter(a => selected.has(a.agency || 'Sem Agência'));

  const handleExportExcel = async () => {
    if (selectedAgents.length === 0) return;
    setExporting(true);
    setProgress(0);
    setProgressLabel('Gerando relatório Excel com imagens...');
    await exportResultsToExcel(selectedAgents, (pct) => setProgress(pct));
    setExporting(false);
    onOpenChange(false);
  };

  const handleExportImages = async () => {
    if (selectedAgents.length === 0) return;
    setExporting(true);
    setProgress(0);
    setProgressLabel('Baixando imagens...');
    await exportImagesToZip(selectedAgents, (pct) => setProgress(pct));
    setExporting(false);
    onOpenChange(false);
  };

  const handleOpenChange = (val: boolean) => {
    if (val) setSelected(new Set(uniqueAgencies));
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Exportar por Agência</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-60 overflow-y-auto py-2">
          <div className="flex items-center gap-2 pb-2 border-b">
            <Checkbox
              checked={selected.size === uniqueAgencies.length}
              onCheckedChange={toggleAll}
              id="select-all"
            />
            <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
              Selecionar todas ({uniqueAgencies.length})
            </label>
          </div>

          {uniqueAgencies.map(agency => (
            <div key={agency} className="flex items-center gap-2">
              <Checkbox
                checked={selected.has(agency)}
                onCheckedChange={() => toggle(agency)}
                id={`agency-${agency}`}
              />
              <label htmlFor={`agency-${agency}`} className="text-sm cursor-pointer truncate">
                {agency}
              </label>
            </div>
          ))}
        </div>

        {exporting && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{progressLabel} {progress}%</p>
            <Progress value={progress} />
          </div>
        )}

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handleExportExcel}
            disabled={selected.size === 0 || exporting}
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
          </Button>
          <Button
            onClick={handleExportImages}
            disabled={selected.size === 0 || exporting}
          >
            <ImageDown className="h-4 w-4 mr-2" /> Imagens (ZIP)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
