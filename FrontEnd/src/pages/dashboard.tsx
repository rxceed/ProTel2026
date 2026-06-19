import { useEffect, useState } from 'react';
import { 
  Activity, 
  Map as MapIcon, 
  AlertTriangle, 
  Droplet,
  ArrowUpRight,
  Loader2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';

interface DashboardSummary {
  totalFields: number;
  monitoredSubBlocks: number;
  pendingRecommendations: number;
  systemAlerts: number;
  recentAlerts: Array<{
    id: string;
    field: string;
    issue: string;
    time: string;
    severity: string;
    createdAt: string;
  }>;
}

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const response = await apiClient.get('/dashboard/summary');
        setSummary(response.data.data);
      } catch (err: any) {
        setError(err.message || 'Failed to initialize dashboard');
      } finally {
        setLoading(false);
      }
    };
    fetchSummary();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-muted-foreground">
        <AlertTriangle className="h-10 w-10 text-destructive mb-4" />
        <p>Failed to load dashboard data: {error}</p>
        <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  const summaryMetrics = [
    {
      title: "Total Fields",
      value: summary.totalFields.toString(),
      description: "Active agricultural sites",
      icon: MapIcon,
      trend: "Monitoring",
      alert: false
    },
    {
      title: "Monitored Sub-blocks",
      value: summary.monitoredSubBlocks.toString(),
      description: "Across all fields",
      icon: Activity,
      trend: "Active",
      alert: false
    },
    {
      title: "Pending Recommendations",
      value: summary.pendingRecommendations.toString(),
      description: "Requires operator action",
      icon: Droplet,
      trend: summary.pendingRecommendations > 0 ? "Action Required" : "All cleared",
      alert: summary.pendingRecommendations > 0
    },
    {
      title: "System Alerts",
      value: summary.systemAlerts.toString(),
      description: "Unresolved issues",
      icon: AlertTriangle,
      trend: summary.systemAlerts > 0 ? "Critical" : "All systems normal",
      alert: summary.systemAlerts > 0
    }
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
          <p className="text-muted-foreground mt-1">
            Monitoring dashboard for Precision Irrigation System.
          </p>
        </div>
        <div className="flex gap-2">
          <Button>Generate Report</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {summaryMetrics.map((metric) => (
          <Card key={metric.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {metric.title}
              </CardTitle>
              <metric.icon className={`h-4 w-4 ${metric.alert ? 'text-destructive' : 'text-muted-foreground'}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {metric.description}
              </p>
              <div className="mt-4 flex items-center text-xs">
                <span className={metric.alert ? 'text-destructive font-medium' : 'text-primary font-medium'}>
                  {metric.trend}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Field Status Overview</CardTitle>
            <CardDescription>
              Current water level trends across major fields.
            </CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="flex h-[300px] w-full items-center justify-center rounded-md border border-dashed">
              <div className="text-center">
                <Activity className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
                <p className="mt-2 text-sm text-muted-foreground">Chart Data Visualization Area</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent Alerts</CardTitle>
            <CardDescription>
              System and field warnings requiring attention.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {summary.recentAlerts.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                   No recent alerts.
                </div>
              ) : summary.recentAlerts.map((alert) => (
                <div key={alert.id} className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className={`p-2 rounded-full ${alert.severity === 'destructive' ? 'bg-destructive/10' : 'bg-primary/10'}`}>
                      <AlertTriangle className={`h-4 w-4 ${alert.severity === 'destructive' ? 'text-destructive' : 'text-primary'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">{alert.field}</p>
                      <p className="text-sm text-muted-foreground mt-1 truncate max-w-[200px]" title={alert.issue}>{alert.issue}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-xs text-muted-foreground">
                      {new Date(alert.createdAt).toLocaleDateString()}
                    </div>
                    <Badge variant={alert.severity as any} className="text-[10px] px-1.5 py-0">Review</Badge>
                  </div>
                </div>
              ))}
            </div>
            {summary.recentAlerts.length > 0 && (
              <Button variant="outline" className="w-full mt-6" size="sm">
                View All Alerts
                <ArrowUpRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
