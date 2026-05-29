import { AgentData } from '@/types/analysis';
import { getAgentStatus } from '@/lib/agentStatus';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle, XCircle, Image, Users, Building2, AlertTriangle, Copy, Sparkles, UserX } from 'lucide-react';

interface Props {
  agents: AgentData[];
}

export function DashboardSummary({ agents }: Props) {
  const totalPhotos = agents.reduce((sum, a) => sum + a.photos.length, 0);

  let approvedCount = 0;
  let inconsistentCount = 0;
  let noPhotosCount = 0;
  let duplicateCount = 0;
  let aiCount = 0;
  let noBusinessCount = 0;

  for (const a of agents) {
    const s = getAgentStatus(a);
    if (s === 'approved') approvedCount++;
    else if (s === 'inconsistent') inconsistentCount++;
    else if (s === 'no_photos') noPhotosCount++;
    else if (s === 'duplicate') duplicateCount++;
    else if (s === 'ai_generated') aiCount++;
    else if (s === 'no_business_person') noBusinessCount++;
  }

  const companyCount = new Set(agents.map(a => a.companyName).filter(Boolean)).size;

  const stats = [
    { label: 'Empresas', value: companyCount, icon: Building2, color: 'text-primary' },
    { label: 'Atendimentos', value: agents.length, icon: Users, color: 'text-muted-foreground' },
    { label: 'Fotos', value: totalPhotos, icon: Image, color: 'text-muted-foreground' },
    { label: 'Aprovados', value: approvedCount, icon: CheckCircle, color: 'text-green-600' },
    { label: 'Inconsistências', value: inconsistentCount, icon: XCircle, color: 'text-destructive' },
    { label: 'Sem fotos', value: noPhotosCount, icon: AlertTriangle, color: 'text-amber-600' },
    { label: 'Duplicadas', value: duplicateCount, icon: Copy, color: 'text-orange-600' },
    { label: 'IA', value: aiCount, icon: Sparkles, color: 'text-purple-600' },
    { label: 'Sem empresário', value: noBusinessCount, icon: UserX, color: 'text-amber-700' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-4">
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
