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
  const uniqueFiles = [...new Set(agents.map(a => a.sourceFile))].sort();
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set(uniqueFiles));
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const toggleFile = (file: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      next.has(file) ? next.delete(file) : next.add(file);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedFiles(prev =>
      prev.size === uniqueFiles.length ? new Set() : new Set(uniqueFiles)
    );
  };

  const selectedAgents = agents.filter(a => selectedFiles.has(a.sourceFile));

  const handleExportExcel = () => {
    if (selectedAgents.length === 0) return;
    exportResultsToExcel(selectedAgents);
  };

  const handleExportImages = async () => {
    if (selectedAgents.length === 0) return;
    setExporting(true);
    setProgress(0);
    await exportImagesToZip(selectedAgents, (pct) => setProgress(pct));
    setExporting(false);
    onOpenChange(false);
  };

  // Reset selection when dialog opens
  const handleOpenChange = (val: boolean) => {
    if (val) setSelectedFiles(new Set(uniqueFiles));
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Exportar por Planilha</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-60 overflow-y-auto py-2">
          <div className="flex items-center gap-2 pb-2 border-b">
            <Checkbox
              checked={selectedFiles.size === uniqueFiles.length}
              onCheckedChange={toggleAll}
              id="select-all"
            />
            <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
              Selecionar todas ({uniqueFiles.length})
            </label>
          </div>

          {uniqueFiles.map(file => (
            <div key={file} className="flex items-center gap-2">
              <Checkbox
                checked={selectedFiles.has(file)}
                onCheckedChange={() => toggleFile(file)}
                id={`file-${file}`}
              />
              <label htmlFor={`file-${file}`} className="text-sm cursor-pointer truncate">
                {file}
              </label>
            </div>
          ))}
        </div>

        {exporting && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Baixando imagens... {progress}%</p>
            <Progress value={progress} />
          </div>
        )}

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handleExportExcel}
            disabled={selectedFiles.size === 0 || exporting}
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
          </Button>
          <Button
            onClick={handleExportImages}
            disabled={selectedFiles.size === 0 || exporting}
          >
            <ImageDown className="h-4 w-4 mr-2" /> Imagens (ZIP)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
