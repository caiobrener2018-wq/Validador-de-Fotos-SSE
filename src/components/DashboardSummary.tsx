import { AgentData } from '@/types/analysis';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle, XCircle, Image, Users } from 'lucide-react';

interface Props {
  agents: AgentData[];
}

export function DashboardSummary({ agents }: Props) {
  const totalPhotos = agents.reduce((sum, a) => sum + a.photos.length, 0);
  const analyzed = agents.reduce((sum, a) => sum + a.photos.filter(p => p.status === 'done').length, 0);
  const approved = agents.reduce((sum, a) => sum + a.photos.filter(p => p.analysis?.aprovada).length, 0);
  const inconsistent = analyzed - approved;

  const stats = [
    { label: 'Agentes', value: agents.length, icon: Users, color: 'text-primary' },
    { label: 'Fotos', value: totalPhotos, icon: Image, color: 'text-muted-foreground' },
    { label: 'Aprovadas', value: approved, icon: CheckCircle, color: 'text-green-600' },
    { label: 'Inconsistências', value: inconsistent, icon: XCircle, color: 'text-destructive' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="flex items-center gap-3 p-4">
            <stat.icon className={`h-8 w-8 ${stat.color}`} />
            <div>
              <p className="text-2xl font-bold text-foreground">{stat.value}</p>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
