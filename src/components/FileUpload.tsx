import { useCallback } from 'react';
import { Upload } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  isLoading: boolean;
}

export function FileUpload({ onFilesSelected, isLoading }: FileUploadProps) {
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'));
    if (files.length > 0) onFilesSelected([files[0]]);
  }, [onFilesSelected]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) onFilesSelected([files[0]]);
  }, [onFilesSelected]);

  return (
    <Card
      className="border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 transition-colors cursor-pointer"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="rounded-full bg-primary/10 p-4">
          <Upload className="h-8 w-8 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">
            {isLoading ? 'Carregando planilha...' : 'Arraste sua planilha aqui'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            ou clique para selecionar o arquivo .xlsx
          </p>
          <p className="text-xs text-muted-foreground/70 mt-2">
            Colunas: Agente · Agência SSE · Empresa · Segmento · Foto 1 · Foto 2 · Foto 3
          </p>
        </div>
        <label className="cursor-pointer">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleChange}
            className="hidden"
            disabled={isLoading}
          />
          <span className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-6 py-2 text-sm font-medium hover:bg-primary/90 transition-colors">
            Selecionar Arquivo
          </span>
        </label>
      </CardContent>
    </Card>
  );
}
