import { useEffect, useState } from 'react';
import { 
  CheckCircle, 
  XSquare, 
  Clock, 
  Loader2, 
  Droplets,
  Sprout,
  ShieldAlert,
  Bell
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/api/client';

interface Field {
  id: string;
  name: string;
}

interface Recommendation {
  id: string;
  recommendationType: 'irrigate' | 'drain' | 'maintain' | 'alert_only';
  commandText: string;
  reasonSummary: string;
  confidenceLevel: string;
  waterLevelCmAtDecision: string;
  priorityRank: number;
}

interface Alert {
  id: string;
  alertType: string;
  severity: 'critical' | 'warning' | 'info';
  alertMessage: string;
  triggeredAt: string;
}

export function DssPage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  
  const [loadingTop, setLoadingTop] = useState(false);
  const [lastEvaluated, setLastEvaluated] = useState<string | null>(null);

  // Load fields
  useEffect(() => {
    const fetchFields = async () => {
      try {
        const response = await apiClient.get('/fields');
        const fieldsData = response.data.data;
        setFields(fieldsData);
        if (fieldsData.length > 0) {
          setSelectedFieldId(fieldsData[0].id);
        }
      } catch (err) {
        console.error("Failed to load fields", err);
      }
    };
    fetchFields();
  }, []);

  // Fetch DSS and Alerts
  const fetchDssData = async (fieldId: string) => {
    if (!fieldId) return;
    try {
      setLoadingTop(true);
      
      const [recsRes, alertsRes] = await Promise.all([
        apiClient.get(`/fields/${fieldId}/recommendations`),
        apiClient.get(`/fields/${fieldId}/alerts?active=true`)
      ]);
      
      setRecommendations(recsRes.data.data || []);
      setLastEvaluated(recsRes.data.meta?.latestEvaluatedAt || null);
      setAlerts(alertsRes.data.data || []);
      
    } catch (err) {
      console.error('Failed to fetch DSS data:', err);
    } finally {
      setLoadingTop(false);
    }
  };

  useEffect(() => {
    if (selectedFieldId) fetchDssData(selectedFieldId);
  }, [selectedFieldId]);

  // Handle Action feedback
  const handleFeedback = async (recId: string, status: 'executed' | 'skipped' | 'deferred') => {
    try {
      await apiClient.post(`/recommendations/${recId}/feedback`, {
        feedback_status: status
      });
      // Refresh
      fetchDssData(selectedFieldId);
    } catch (err) {
      console.error('Failed to submit feedback', err);
      alert('Gagal memperbarui status rekomendasi.');
    }
  };

  const handleAcknowledgeAlert = async (alertId: string) => {
    try {
      await apiClient.post(`/alerts/${alertId}/acknowledge`);
      fetchDssData(selectedFieldId);
    } catch (err) {
      console.error('Failed to acknowledge alert', err);
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'irrigate': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'drain': return 'bg-red-500/10 text-red-500 border-red-500/20';
      case 'maintain': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'alert_only': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Active Engine Outputs</h2>
          <p className="text-muted-foreground mt-1">
            Memonitor rekomendasi irigasi dan sistem peringatan berbasis AI (Decision Support System).
          </p>
        </div>
      </div>

      {/* Filter Lahan */}
      <Card className="bg-muted/10 border-dashed">
        <CardContent className="py-4 flex gap-4 items-center">
          <label className="text-sm font-semibold uppercase text-muted-foreground whitespace-nowrap">
            Fokus Area:
          </label>
          <select 
            value={selectedFieldId}
            onChange={(e) => setSelectedFieldId(e.target.value)}
            className="w-full sm:w-64 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="" disabled>Pilih Lahan...</option>
            {fields.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>

          <Button variant="ghost" size="sm" onClick={() => fetchDssData(selectedFieldId)} disabled={loadingTop}>
            Refresh
          </Button>

          {lastEvaluated && (
            <span className="text-xs text-muted-foreground ml-auto hidden md:block">
              Update Terakhir: {new Date(lastEvaluated).toLocaleString()}
            </span>
          )}
        </CardContent>
      </Card>

      {!selectedFieldId ? (
         <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border rounded-lg">
           <Sprout className="h-8 w-8 mb-2 opacity-50" />
           <p>Pilih Lahan untuk melihat output engine.</p>
         </div>
      ) : loadingTop ? (
         <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border rounded-lg">
           <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
           <p>Sinkronisasi AI Engine...</p>
         </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Column: Recommendations */}
          <div className="col-span-1 lg:col-span-2 space-y-4">
            <h3 className="text-lg font-semibold flex items-center">
              <Droplets className="h-5 w-5 mr-2 text-primary" /> 
              Rekomendasi Operasional Aktif
              <Badge variant="outline" className="ml-2 font-mono">{recommendations.length}</Badge>
            </h3>

            {recommendations.length === 0 ? (
              <Card className="border-dashed h-40 flex flex-col items-center justify-center text-muted-foreground">
                <CheckCircle className="h-8 w-8 text-emerald-500 mb-2 opacity-80" />
                <p>Kondisi lahan saat ini stabil. Tidak ada intervensi yang diperlukan.</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {recommendations.map(rec => (
                  <Card key={rec.id} className="border border-border/50 shadow-sm overflow-hidden">
                    <div className="flex">
                      <div className={`w-2 shrink-0 ${
                        rec.recommendationType === 'irrigate' ? 'bg-blue-500' :
                        rec.recommendationType === 'drain' ? 'bg-red-500' : 'bg-emerald-500'
                      }`} />
                      <div className="flex-1">
                        <CardHeader className="py-4 pb-2">
                          <div className="flex justify-between items-start">
                            <Badge className={getActionColor(rec.recommendationType)}>
                               {rec.recommendationType.toUpperCase()}
                            </Badge>
                            <Badge variant="outline" className="opacity-80 text-xs">
                               Keyakinan: {rec.confidenceLevel}
                            </Badge>
                          </div>
                          <CardTitle className="text-lg mt-2 leading-snug">
                            {rec.commandText}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="py-2 text-sm text-muted-foreground">
                          {rec.reasonSummary}
                        </CardContent>
                        <CardFooter className="py-3 bg-muted/20 border-t flex gap-2 pt-3 mt-2">
                          <Button size="sm" variant="default" onClick={() => handleFeedback(rec.id, 'executed')}>
                            <CheckCircle className="h-4 w-4 mr-2" /> Eksekusi Sekarang
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleFeedback(rec.id, 'deferred')}>
                            <Clock className="h-4 w-4 mr-2" /> Tunda
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => handleFeedback(rec.id, 'skipped')}>
                            <XSquare className="h-4 w-4 mr-2" /> Abaikan
                          </Button>
                        </CardFooter>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Side Column: Alerts */}
          <div className="col-span-1 space-y-4">
            <h3 className="text-lg font-semibold flex items-center text-amber-500">
              <ShieldAlert className="h-5 w-5 mr-2" /> 
              Sistem Peringatan
              <Badge variant="destructive" className="ml-2 font-mono">{alerts.length}</Badge>
            </h3>

            {alerts.length === 0 ? (
               <Card className="border-dashed h-40 flex flex-col items-center justify-center text-muted-foreground">
                 <Bell className="h-8 w-8 mb-2 opacity-30" />
                 <p className="text-sm">Tidak ada alarm aktif.</p>
               </Card>
            ) : (
              <div className="space-y-3">
                {alerts.map(al => (
                  <Card key={al.id} className="border-red-500/20 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
                    <CardHeader className="p-4 pb-2">
                      <div className="flex justify-between items-start">
                        <span className="text-xs font-semibold uppercase text-red-500">{al.alertType.replace('_', ' ')}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(al.triggeredAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-1">
                      <p className="text-sm">{al.alertMessage}</p>
                      <Button size="sm" variant="outline" className="w-full mt-4 h-8 text-xs" onClick={() => handleAcknowledgeAlert(al.id)}>
                        Acknowledge (Tutup)
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
