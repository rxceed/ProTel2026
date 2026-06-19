import { useEffect, useState } from 'react';
import { Search, Loader2, AlertTriangle, Droplets, CheckCircle, Clock, XSquare } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/api/client';

interface Field {
  id: string;
  name: string;
}

interface RecHistory {
  id: string;
  recommendationType: string;
  commandText: string;
  reasonSummary: string;
  feedbackStatus: 'executed' | 'skipped' | 'deferred';
  operatorNotes: string | null;
  feedbackAt: string | null;
  createdAt: string;
}

export function RecommendationsHistoryPage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  
  const [history, setHistory] = useState<RecHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFields = async () => {
      try {
        const response = await apiClient.get('/fields');
        const fieldsData = response.data.data;
        setFields(fieldsData);
        if (fieldsData.length > 0) setSelectedFieldId(fieldsData[0].id);
      } catch (err) {
        console.error("Failed to load fields", err);
      }
    };
    fetchFields();
  }, []);

  const fetchHistory = async (fieldId: string) => {
    if (!fieldId) return;
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get(`/fields/${fieldId}/recommendations/history`);
      setHistory(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Gagal memuat history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedFieldId) fetchHistory(selectedFieldId);
    else setHistory([]);
  }, [selectedFieldId]);

  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'executed': return <CheckCircle className="h-4 w-4 text-emerald-500 mr-2" />;
      case 'deferred': return <Clock className="h-4 w-4 text-amber-500 mr-2" />;
      case 'skipped':  return <XSquare className="h-4 w-4 text-red-500 mr-2" />;
      default: return null;
    }
  };

  const [searchTerm, setSearchTerm] = useState('');

  const filteredHistory = history.filter(item => 
    item.commandText.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.recommendationType.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6 animate-in fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center">
            Log Evaluasi Irigasi
          </h2>
          <p className="text-muted-foreground mt-1">
            Riwayat instruksi yang telah diberikan AI dan respon (Feedback) operator di lapangan.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 bg-muted/20 border-b">
          <div className="flex flex-col sm:flex-row items-center gap-4 justify-between">
            <div className="w-full sm:w-auto">
              <label className="text-xs font-semibold uppercase text-muted-foreground mb-1 block">
                Filter Rekaman Lahan
              </label>
              <select 
                value={selectedFieldId}
                onChange={(e) => setSelectedFieldId(e.target.value)}
                className="w-full sm:w-64 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="" disabled>Pilih Lahan...</option>
                {fields.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            
            <div className="flex bg-background border px-3 py-1.5 rounded-md items-center text-sm w-full sm:w-64 shadow-sm self-end">
              <Search className="h-4 w-4 text-muted-foreground mr-2 shrink-0" />
              <input 
                placeholder="Cari histori..." 
                className="bg-transparent border-none outline-none w-full text-foreground"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!selectedFieldId ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p>Pilih Lahan untuk melihat riwayat keputusan di lokasi tersebut.</p>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
              <p>Memuat rekam jejak sistem...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-destructive">
              <AlertTriangle className="h-10 w-10 mb-4" />
              <p>{error}</p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Droplets className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-medium">Belum ada riwayat</h3>
              <p className="text-muted-foreground max-w-sm mt-1 mb-6">
                {searchTerm ? 'Tidak ada hasil pencarian yang cocok.' : 'Riwayat akan muncul ketika ada rekomendasi DSS yang telah direspons oleh operator.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-muted/50 text-muted-foreground uppercase text-xs border-b">
                  <tr>
                    <th className="px-6 py-3 font-medium">Tanggal Dihasilkan</th>
                    <th className="px-6 py-3 font-medium">Saran Aksi</th>
                    <th className="px-6 py-3 font-medium">Command</th>
                    <th className="px-6 py-3 font-medium">Keputusan Operator</th>
                    <th className="px-6 py-3 font-medium">Tanggal Feedback</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredHistory.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-4 text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant="outline" className="uppercase font-mono text-[10px]">
                          {item.recommendationType}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-foreground max-w-sm truncate" title={item.commandText}>
                          {item.commandText}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center capitalize font-medium">
                           {getStatusIcon(item.feedbackStatus)}
                           {item.feedbackStatus}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {item.feedbackAt ? new Date(item.feedbackAt).toLocaleString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
