import { useEffect, useState } from 'react';
import { Plus, Search, GitMerge, Loader2, AlertTriangle, ShieldCheck, Info, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/api/client';
import { CreateRuleModal } from './create-rule-modal';
import { EntityDetailModal } from '@/components/entity-detail-modal';
import { useDialog } from '@/components/ui/dialog-provider';

interface RuleProfile {
  id: string;
  name: string;
  description: string;
  bucketCode: string;
  phaseCode: string;
  awdUpperTargetCm: number;
  droughtAlertCm: number | null;
  rainDelayMm: number;
  priorityWeight: number;
  targetConfidence: string;
  isDefault: boolean;
  isActive: boolean;
}

export function RulesPage() {
  const dialog = useDialog();
  const [rules, setRules] = useState<RuleProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RuleProfile | null>(null);
  const [detailEntity, setDetailEntity] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchRules = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get('/rule-profiles');
      setRules(res.data.data);
    } catch {
      setError('Gagal memuat aturan DSS');
    } finally {
      setLoading(false);
    }
  };

  const filteredRules = rules.filter(r => 
    r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.phaseCode.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    fetchRules();
  }, []);

  const handleDelete = async (id: string) => {
    const confirmed = await dialog.confirm('Apakah Anda yakin ingin menghapus profil aturan ini?');
    if (!confirmed) return;
    try {
      await apiClient.delete(`/rule-profiles/${id}`);
      fetchRules();
    } catch (err: any) {
      await dialog.alert(err.response?.data?.message || 'Gagal menghapus aturan');
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">DSS Rule Profiles</h2>
          <p className="text-muted-foreground mt-1">
            Konfigurasi batas air, aturan fase, dan toleransi cuaca untuk sistem Irigasi Presisi.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Tambah Aturan
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 bg-muted/20 border-b">
          <div className="flex flex-col sm:flex-row items-center gap-4 justify-between">
            <div className="w-full sm:w-auto invisible">
              <label className="text-xs font-semibold uppercase text-muted-foreground mb-1 block">
                Filter Tipe
              </label>
            </div>
            
            <div className="flex bg-background border px-3 py-1.5 rounded-md items-center text-sm w-full sm:w-64 shadow-sm self-end">
              <Search className="h-4 w-4 text-muted-foreground mr-2 shrink-0" />
              <input 
                placeholder="Cari profil..." 
                className="bg-transparent border-none outline-none w-full text-foreground"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
              <p>Memuat konfigurasi engine...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-destructive">
              <AlertTriangle className="h-10 w-10 mb-4" />
              <p>{error}</p>
              <Button variant="outline" className="mt-4" onClick={() => fetchRules()}>Coba Lagi</Button>
            </div>
          ) : rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <GitMerge className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-medium">Belum ada profil konfigurasi</h3>
              <p className="text-muted-foreground max-w-sm mt-1 mb-6">
                Engine tidak memiliki aturan batas air untuk sub-block yang spesifik.
              </p>
              <Button onClick={() => setIsModalOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Tambah Profil Aturan
              </Button>
            </div>
          ) : filteredRules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Search className="h-8 w-8 mb-2 opacity-20" />
              <p>Tidak ada profil yang cocok dengan "{searchTerm}"</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-muted/50 text-muted-foreground uppercase text-xs border-b">
                  <tr>
                    <th className="px-6 py-3 font-medium">Nama Aturan</th>
                    <th className="px-6 py-3 font-medium">Fase Tanam</th>
                    <th className="px-6 py-3 font-medium text-right">Target Genangan</th>
                    <th className="px-6 py-3 font-medium text-right">Drought Alert</th>
                    <th className="px-6 py-3 font-medium text-center">Status</th>
                    <th className="px-6 py-3 font-medium text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredRules.map((rule) => (
                    <tr key={rule.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center font-bold text-foreground">
                          {rule.isDefault && <ShieldCheck className="h-4 w-4 text-primary mr-2" />}
                          {rule.name}
                        </div>
                      </td>
                      <td className="px-6 py-4 capitalize">{rule.phaseCode.replace('_', ' ')}</td>
                      <td className="px-6 py-4 text-right font-mono text-blue-500">{rule.awdUpperTargetCm} cm</td>
                      <td className="px-6 py-4 text-right font-mono text-amber-500">
                        {rule.droughtAlertCm !== null && rule.droughtAlertCm !== undefined ? `${rule.droughtAlertCm} cm` : `${rule.awdUpperTargetCm - 10} cm`}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <Badge variant={rule.isActive ? "default" : "secondary"}>
                          {rule.isActive ? 'Aktif' : 'Non-aktif'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-right flex justify-end gap-2">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => setDetailEntity(rule)}
                        >
                          <Info className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-primary"
                          onClick={() => {
                            setEditingRule(rule);
                            setIsModalOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" /> 
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-destructive"
                          onClick={() => handleDelete(rule.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateRuleModal 
        isOpen={isModalOpen} 
        initialData={editingRule}
        onClose={() => {
          setIsModalOpen(false);
          setEditingRule(null);
        }} 
        onSuccess={() => fetchRules()}
      />

      <EntityDetailModal 
        isOpen={!!detailEntity} 
        onClose={() => setDetailEntity(null)} 
        title="Detail Profil Aturan AWD"
        data={detailEntity}
      />
    </div>
  );
}
