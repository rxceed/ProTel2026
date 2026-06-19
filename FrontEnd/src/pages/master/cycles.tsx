import { useEffect, useState } from 'react';
import { Play, MapPin, Loader2, AlertTriangle, Layers, Calendar, CheckCircle, ChevronRight, Trash2, Info } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/api/client';
import { CreateCycleModal } from './create-cycle-modal';
import { AdvancePhaseModal } from './advance-phase-modal';
import { EntityDetailModal } from '@/components/entity-detail-modal';

interface Field { id: string; name: string; }
interface SubBlock { id: string; name: string; code: string | null; }
interface CropCycle {
  id: string;
  fieldId: string;
  subBlockId: string;
  bucketCode: string;
  varietyName: string;
  plantingDate: string;
  expectedHarvestDate: string | null;
  actualHarvestDate: string | null;
  currentPhaseCode: string;
  status: string;
}

export function CyclesPage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState('');
  
  const [subBlocks, setSubBlocks] = useState<SubBlock[]>([]);
  const [selectedSubBlockId, setSelectedSubBlockId] = useState('');

  const [cycles, setCycles] = useState<CropCycle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [activeCycle, setActiveCycle] = useState<CropCycle | null>(null);
  const [detailEntity, setDetailEntity] = useState<any>(null);

  // 1. Fetch available fields on mount
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

  // 2. Fetch sub-blocks when field is selected
  useEffect(() => {
    const fetchSubBlocks = async () => {
      if (!selectedFieldId) return;
      try {
        const response = await apiClient.get(`/fields/${selectedFieldId}/sub-blocks`);
        const sbData = response.data.data;
        setSubBlocks(sbData);
        if (sbData.length > 0) {
          setSelectedSubBlockId(sbData[0].id);
        } else {
          setSelectedSubBlockId('');
        }
      } catch (err) {
        console.error("Failed to load subblocks", err);
      }
    };
    fetchSubBlocks();
  }, [selectedFieldId]);

  // 3. Fetch crop cycles when sub-block is selected
  const fetchCycles = async () => {
    if (!selectedSubBlockId) return;
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get(`/sub-blocks/${selectedSubBlockId}/crop-cycles`);
      setCycles(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Gagal memuat data musim tanam');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedSubBlockId) {
      fetchCycles();
    } else {
      setCycles([]);
    }
  }, [selectedSubBlockId]);

  const ongoingCycle = cycles.find(c => c.status === 'active');

  const handleDeleteCycle = async (id: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus data musim tanam ini?')) return;
    try {
      setLoading(true);
      await apiClient.delete(`/crop-cycles/${id}`);
      fetchCycles();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Gagal menghapus data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Musim Tanam Padi</h2>
          <p className="text-muted-foreground mt-1">
            Konfigurasi varietas dan pengawasan siklus per petak.
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => setIsCreateModalOpen(true)} 
            disabled={!selectedSubBlockId || !!ongoingCycle}
          >
            <Play className="mr-2 h-4 w-4" /> Mulai Musim Baru
          </Button>
        </div>
      </div>

      {/* FILTER SECTION */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-muted/10">
          <CardContent className="p-4 flex gap-4 items-center">
            <MapPin className="h-8 w-8 text-muted-foreground opacity-50 shrink-0" />
            <div className="w-full">
              <label className="text-xs font-semibold uppercase text-muted-foreground mb-1 block">Lahan Sawah</label>
              <select 
                value={selectedFieldId}
                onChange={(e) => setSelectedFieldId(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="" disabled>Pilih Lahan...</option>
                {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-muted/10">
          <CardContent className="p-4 flex gap-4 items-center">
            <Layers className="h-8 w-8 text-muted-foreground opacity-50 shrink-0" />
            <div className="w-full">
              <label className="text-xs font-semibold uppercase text-muted-foreground mb-1 block">Petak / Sub-block</label>
              <select 
                value={selectedSubBlockId}
                onChange={(e) => setSelectedSubBlockId(e.target.value)}
                disabled={!selectedFieldId || subBlocks.length === 0}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="" disabled>{subBlocks.length === 0 ? 'Pilih Lahan Dulu / Tidak ada petak' : 'Pilih Petak...'}</option>
                {subBlocks.map(sb => <option key={sb.id} value={sb.id}>{sb.name}</option>)}
              </select>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* CURRENT ONGOING CYCLE CARD (Occupies 1 column) */}
        <div className="lg:col-span-1 space-y-4">
          <h3 className="font-semibold text-lg flex items-center">
            <Badge variant="outline" className="mr-2 bg-primary/10 text-primary uppercase text-[10px]">Aktif</Badge>
            Musim Ini
          </h3>
          <Card className="h-[300px] flex flex-col relative overflow-hidden bg-gradient-to-br from-card to-muted/20">
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !selectedSubBlockId ? (
              <div className="flex-1 flex items-center justify-center text-center p-6 text-muted-foreground">
                Pilih petak sawah terlebih dahulu.
              </div>
            ) : ongoingCycle ? (
              <>
                <div className="absolute top-0 left-0 w-1 bg-primary h-full"></div>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-xl">{ongoingCycle.varietyName || ongoingCycle.bucketCode}</h4>
                      <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">Varietas / Durasi</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="flex flex-col bg-muted/40 p-3 rounded-md">
                      <span className="text-xs text-muted-foreground uppercase mb-1">Fase Sekarang</span>
                      <span className="font-semibold text-primary capitalize flex items-center">
                        <ChevronRight className="h-4 w-4 mr-1 text-primary" />
                        {ongoingCycle.currentPhaseCode.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="bg-background/50 border p-2 rounded">
                        <span className="block text-[10px] text-muted-foreground uppercase">Tgl Tanam</span>
                        <span className="font-medium">{new Date(ongoingCycle.plantingDate).toLocaleDateString('id-ID')}</span>
                      </div>
                      <div className="bg-background/50 border p-2 rounded">
                        <span className="block text-[10px] text-muted-foreground uppercase">Est. Panen</span>
                        <span className="font-medium text-amber-600 dark:text-amber-400">
                          {ongoingCycle.expectedHarvestDate ? new Date(ongoingCycle.expectedHarvestDate).toLocaleDateString('id-ID') : '-'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="pt-4 grid grid-cols-2 gap-2">
                    <Button 
                      variant="outline" 
                      className="w-full text-xs" 
                      onClick={() => {
                        setActiveCycle(ongoingCycle);
                        setIsAdvanceModalOpen(true);
                      }}
                    >
                      Maju Fase
                    </Button>
                    <Button 
                      className="w-full text-xs"
                      onClick={async () => {
                        if (confirm('Panen sudah selesai?')) {
                          try {
                            setLoading(true);
                            await apiClient.post(`/crop-cycles/${ongoingCycle.id}/complete`);
                            fetchCycles();
                          } catch (err: any) {
                            alert(err.response?.data?.message || 'Gagal memproses panen');
                          } finally {
                            setLoading(false);
                          }
                        }
                      }}
                    >
                      <CheckCircle className="mr-1 h-3 w-3" /> Panen
                    </Button>
                  </div>
                </CardContent>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
                <Calendar className="h-10 w-10 mb-3 opacity-20" />
                <p className="text-sm">Sawah sedang kosong atau belum ada musim tanam yang berjalan.</p>
                <Button variant="link" onClick={() => setIsCreateModalOpen(true)} className="mt-2 text-primary">
                  Klik di sini untuk memulai
                </Button>
              </div>
            )}
          </Card>
        </div>

        {/* HISTORY TABLE (Occupies 2 columns) */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="font-semibold text-lg">Riwayat Musim Tanam</h3>
          <Card className="min-h-[300px]">
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                   <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-12 text-destructive">
                  <AlertTriangle className="h-10 w-10 mb-4" />
                  <p>{error}</p>
                </div>
              ) : cycles.filter(c => c.status !== 'active').length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Calendar className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
                  <p className="text-muted-foreground">Belum ada riwayat tanam sebelumnya.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-muted-foreground uppercase text-xs border-b">
                      <tr>
                        <th className="px-6 py-3 font-medium">Varietas / Durasi</th>
                        <th className="px-6 py-3 font-medium">Tgl Tanam</th>
                        <th className="px-6 py-3 font-medium">Panen Realita</th>
                        <th className="px-6 py-3 font-medium text-center">Durasi (Hari)</th>
                        <th className="px-6 py-3 font-medium text-center">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {cycles.filter(c => c.status !== 'active').map((c) => {
                        const start = new Date(c.plantingDate).getTime();
                        const end = c.actualHarvestDate ? new Date(c.actualHarvestDate).getTime() : new Date().getTime();
                        const days = Math.floor((end - start)/(1000*3600*24));
                        
                        return (
                          <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-6 py-4">
                              <span className="font-medium text-foreground block">{c.varietyName || '-'}</span>
                              <span className="text-xs text-muted-foreground">{c.bucketCode}</span>
                            </td>
                            <td className="px-6 py-4">{new Date(c.plantingDate).toLocaleDateString('id-ID')}</td>
                            <td className="px-6 py-4 font-medium text-primary">
                              {c.actualHarvestDate ? new Date(c.actualHarvestDate).toLocaleDateString('id-ID') : '-'}
                            </td>
                            <td className="px-6 py-4 text-center">
                              {days} hr
                            </td>
                             <td className="px-6 py-4 text-center">
                               <div className="flex justify-center gap-2">
                                 <Button 
                                   variant="ghost" 
                                   size="icon" 
                                   className="h-8 w-8 text-muted-foreground"
                                   onClick={() => setDetailEntity(c)}
                                 >
                                   <Info className="h-4 w-4" />
                                 </Button>
                                 <Button 
                                   variant="ghost" 
                                   size="icon" 
                                   className="h-8 w-8 text-destructive"
                                   onClick={() => handleDeleteCycle(c.id)}
                                 >
                                   <Trash2 className="h-4 w-4" />
                                 </Button>
                               </div>
                             </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <CreateCycleModal 
        isOpen={isCreateModalOpen} 
        subBlockId={selectedSubBlockId}
        onClose={() => setIsCreateModalOpen(false)} 
        onSuccess={() => fetchCycles()}
      />
      <AdvancePhaseModal 
        isOpen={isAdvanceModalOpen}
        cycleId={activeCycle?.id || null}
        currentPhase={activeCycle?.currentPhaseCode || ''}
        onClose={() => setIsAdvanceModalOpen(false)}
        onSuccess={() => fetchCycles()}
      />

      <EntityDetailModal 
        isOpen={!!detailEntity} 
        onClose={() => setDetailEntity(null)} 
        title="Detail Siklus Tanam (History)"
        data={detailEntity}
      />
    </div>
  );
}
