import { useCallback } from 'react';
import { Upload } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface FileUploadProps {
  onFileSelected: (file: File) => void;
  isLoading: boolean;
}

export function FileUpload({ onFileSelected, isLoading }: FileUploadProps) {
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.xlsx')) onFileSelected(file);
  }, [onFileSelected]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
  }, [onFileSelected]);

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
            ou clique para selecionar um arquivo .xlsx
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
