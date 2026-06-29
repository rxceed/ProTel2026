import { useEffect, useState } from 'react';
import { Plus, Search, MapPin, Loader2, AlertTriangle, Layers, Info, Pencil, Trash2, Fence, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/api/client';
import { CreateSubBlockModal } from './create-subblock-modal';
import { CreateIrrigationPointModal } from './create-irrigation-point-modal';
import { CreateSubBlockBorderModal } from './create-subblock-border-modal';
import { EntityDetailModal } from '@/components/entity-detail-modal';
import { useDialog } from '@/components/ui/dialog-provider';

interface Field {
  id: string;
  name: string;
}

interface DeviceInfo {
  id: string;
  deviceCode: string;
  deviceType: string;
}

interface SubBlock {
  id: string;
  fieldId: string;
  name: string;
  code: string | null;
  elevationM: string | null;
  elevationCalibration?: string | number | null;
  soilType: string | null;
  isActive: boolean;
  polygonGeom?: any;
  devices?: DeviceInfo[];
}

interface IrrigationPoint {
  id: string;
  fieldId: string;
  pointType: 'source' | 'drain';
  coordinatePoint: any;
  elevationM: string | null;
  callibratedElevation?: string | number | null;
  name?: string | null;
  assignedSubBlocks?: string[] | null;
}

export function SubBlocksPage() {
  const dialog = useDialog();
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  
  const [subBlocks, setSubBlocks] = useState<SubBlock[]>([]);
  const [irrigationPoints, setIrrigationPoints] = useState<IrrigationPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recalibrating, setRecalibrating] = useState(false);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSubBlock, setEditingSubBlock] = useState<SubBlock | null>(null);
  
  const [isPointModalOpen, setIsPointModalOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState<IrrigationPoint | null>(null);
  
  const [detailEntity, setDetailEntity] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isBorderModalOpen, setIsBorderModalOpen] = useState(false);
  const [editingBorder, setEditingBorder] = useState<any>(null);
  const [embankments, setEmbankments] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'sub-blocks' | 'irrigation-points' | 'pematang-borders'>('sub-blocks');

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

  // 2. Fetch sub-blocks, irrigation points & embankments when field is selected
  const fetchSubBlocks = async (fieldId: string) => {
    if (!fieldId) return;
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get(`/fields/${fieldId}/sub-blocks`);
      setSubBlocks(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Gagal memuat data sub-blocks');
    } finally {
      setLoading(false);
    }
  };

  const fetchIrrigationPoints = async (fieldId: string) => {
    if (!fieldId) return;
    try {
      const response = await apiClient.get(`/fields/${fieldId}/irrigation-points`);
      setIrrigationPoints(response.data.data);
    } catch (err) {
      console.error("Failed to load irrigation points", err);
    }
  };

  const fetchEmbankments = async (fieldId: string) => {
    if (!fieldId) return;
    try {
      const response = await apiClient.get(`/fields/${fieldId}/embankments`);
      setEmbankments(response.data.data);
    } catch (err) {
      console.error("Failed to load embankments", err);
    }
  };

  useEffect(() => {
    if (selectedFieldId) {
      fetchSubBlocks(selectedFieldId);
      fetchIrrigationPoints(selectedFieldId);
      fetchEmbankments(selectedFieldId);
    } else {
      setSubBlocks([]);
      setIrrigationPoints([]);
      setEmbankments([]);
    }
  }, [selectedFieldId]);

  const handleDelete = async (id: string) => {
    const confirmed = await dialog.confirm('Apakah Anda yakin ingin menghapus petak ini?');
    if (!confirmed) return;
    try {
      await apiClient.delete(`/sub-blocks/${id}`);
      if (selectedFieldId) fetchSubBlocks(selectedFieldId);
    } catch (err: any) {
      await dialog.alert(err.response?.data?.message || 'Gagal menghapus petak');
    }
  };

  const handleRecalibrate = async () => {
    if (!selectedFieldId) return;
    try {
      setRecalibrating(true);
      await apiClient.post(`/fields/${selectedFieldId}/recalibrate-elevations`);
      await dialog.alert('Kalibrasi elevasi sub-block berhasil diperbarui!');
      fetchSubBlocks(selectedFieldId);
    } catch (err: any) {
      console.error(err);
      await dialog.alert(err.response?.data?.message || 'Gagal melakukan rekalibrasi elevasi');
    } finally {
      setRecalibrating(false);
    }
  };

  const handleDeletePoint = async (id: string) => {
    const confirmed = await dialog.confirm('Apakah Anda yakin ingin menghapus titik irigasi ini?');
    if (!confirmed) return;
    try {
      await apiClient.delete(`/irrigation-points/${id}`);
      if (selectedFieldId) fetchIrrigationPoints(selectedFieldId);
    } catch (err: any) {
      await dialog.alert(err.response?.data?.message || 'Gagal menghapus titik irigasi');
    }
  };

  const handleDeleteEmbankment = async (id: string) => {
    const confirmed = await dialog.confirm('Apakah Anda yakin ingin menghapus pematang ini?');
    if (!confirmed) return;
    try {
      await apiClient.delete(`/embankments/${id}`);
      if (selectedFieldId) fetchEmbankments(selectedFieldId);
    } catch (err: any) {
      await dialog.alert(err.response?.data?.message || 'Gagal menghapus pematang');
    }
  };

  const filteredSubBlocks = subBlocks.filter(sb => 
    sb.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (sb.code && sb.code.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const filteredPoints = irrigationPoints.filter(ip => 
    ip.pointType.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredEmbankments = embankments.filter(emb => 
    emb.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (emb.code && emb.code.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getConnectedSubBlockNames = (connectedIds: string[] | null) => {
    if (!connectedIds || !Array.isArray(connectedIds) || connectedIds.length === 0) return '-';
    return connectedIds.map(id => {
      const sb = subBlocks.find(s => s.id === id);
      return sb ? sb.name : 'Sub-block tidak diketahui';
    }).join(', ');
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Master Data: Lahan & Irigasi</h2>
          <p className="text-muted-foreground mt-1">
            Manajemen petak sawah (sub-block) dan titik irigasi (source & drain) pada Lahan.
          </p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'sub-blocks' && (
            <>
              <Button
                variant="outline"
                onClick={handleRecalibrate}
                disabled={!selectedFieldId || recalibrating}
              >
                {recalibrating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Rekalibrasi Elevasi
              </Button>
              <Button
                onClick={() => setIsModalOpen(true)}
                disabled={!selectedFieldId}
              >
                <Plus className="mr-2 h-4 w-4" /> Tambah Sub-block
              </Button>
            </>
          )}
          {activeTab === 'irrigation-points' && (
            <Button
              onClick={() => setIsPointModalOpen(true)}
              disabled={!selectedFieldId}
            >
              <Plus className="mr-2 h-4 w-4" /> Tambah Titik Irigasi
            </Button>
          )}
          {activeTab === 'pematang-borders' && (
            <Button
              onClick={() => setIsBorderModalOpen(true)}
              disabled={!selectedFieldId}
            >
              <Plus className="mr-2 h-4 w-4" /> Tambah Pematang
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 bg-muted/20 border-b">
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center gap-4 justify-between">
              <div className="w-full sm:w-auto">
                <label className="text-xs font-semibold uppercase text-muted-foreground mb-1 block">
                  Filter Lokasi Lahan
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
                  placeholder={activeTab === 'sub-blocks' ? "Cari sub-block..." : "Cari tipe titik..."}
                  className="bg-transparent border-none outline-none w-full text-foreground"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            {/* Tab selector */}
            <div className="flex gap-4 border-b pb-1">
              <button
                onClick={() => {
                  setActiveTab('sub-blocks');
                  setSearchTerm('');
                }}
                className={`pb-2 text-sm font-semibold border-b-2 transition-all ${
                  activeTab === 'sub-blocks'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Sub-blocks ({subBlocks.length})
              </button>
              <button
                onClick={() => {
                  setActiveTab('irrigation-points');
                  setSearchTerm('');
                }}
                className={`pb-2 text-sm font-semibold border-b-2 transition-all ${
                  activeTab === 'irrigation-points'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Titik Irigasi ({irrigationPoints.length})
              </button>
              <button
                onClick={() => {
                  setActiveTab('pematang-borders');
                  setSearchTerm('');
                }}
                className={`pb-2 text-sm font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
                  activeTab === 'pematang-borders'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Fence className="h-3.5 w-3.5" />
                Pematang Sawah ({embankments.length})
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!selectedFieldId ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <MapPin className="h-8 w-8 mb-2 opacity-50" />
              <p>Pilih Lahan (Field) di atas untuk melihat data.</p>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
              <p>Memuat data...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-destructive">
              <AlertTriangle className="h-10 w-10 mb-4" />
              <p>{error}</p>
              <Button variant="outline" className="mt-4" onClick={() => fetchSubBlocks(selectedFieldId)}>Coba Lagi</Button>
            </div>
          ) : activeTab === 'sub-blocks' ? (
            // SUB-BLOCKS TABLE
            subBlocks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Layers className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
                <h3 className="text-lg font-medium">Belum ada petak sub-block</h3>
                <p className="text-muted-foreground max-w-sm mt-1 mb-6">
                  Mulai dengan menambahkan sub-block pertama Anda pada lahan ini.
                </p>
                <Button onClick={() => setIsModalOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Tambah Sub-block
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left whitespace-nowrap">
                  <thead className="bg-muted/50 text-muted-foreground uppercase text-xs border-b">
                    <tr>
                      <th className="px-6 py-3 font-medium">Nama Petak</th>
                      <th className="px-6 py-3 font-medium">Kode</th>
                      <th className="px-6 py-3 font-medium">Elevasi</th>
                      <th className="px-6 py-3 font-medium">Tipe Tanah</th>
                      <th className="px-6 py-3 font-medium">Device Terpasang</th>
                      <th className="px-6 py-3 font-medium text-center">Status</th>
                      <th className="px-6 py-3 font-medium text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredSubBlocks.map((sb) => (
                      <tr key={sb.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-6 py-4 font-medium text-foreground flex items-center gap-2">
                          {sb.name}
                          {sb.polygonGeom ? (
                            <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/20 py-0 px-1 h-5 flex items-center gap-0.5">
                              <MapPin className="h-3 w-3" /> Terpetakan
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20 py-0 px-1 h-5 flex items-center gap-0.5">
                              <AlertTriangle className="h-3 w-3" /> No Map
                            </Badge>
                          )}
                        </td>
                        <td className="px-6 py-4 code font-mono text-xs">{sb.code || '-'}</td>
                        <td className="px-6 py-4">
                          {(() => {
                            if (sb.elevationCalibration !== null && sb.elevationCalibration !== undefined) {
                              const cal = parseFloat(sb.elevationCalibration.toString());
                              return `${cal.toFixed(2)} m`;
                            }
                            return sb.elevationM ? `${parseFloat(sb.elevationM).toFixed(2)} m` : '-';
                          })()}
                        </td>
                        <td className="px-6 py-4 capitalize">{sb.soilType || '-'}</td>
                        <td className="px-6 py-4">
                          {sb.devices && sb.devices.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {sb.devices.map((d) => (
                                <Badge 
                                  key={d.id} 
                                  variant="outline" 
                                  className="text-[10px] font-mono bg-blue-500/10 text-blue-600 border-blue-500/20 py-0.5 px-1.5"
                                  title={d.deviceType.replace('_', ' ').toUpperCase()}
                                >
                                  {d.deviceCode}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <Badge variant={sb.isActive ? "default" : "secondary"}>
                            {sb.isActive ? 'Aktif' : 'Non-aktif'}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-right flex justify-end gap-2">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground"
                            onClick={() => setDetailEntity(sb)}
                          >
                            <Info className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-primary"
                            onClick={() => {
                              setEditingSubBlock(sb);
                              setIsModalOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" /> 
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-destructive"
                            onClick={() => handleDelete(sb.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : activeTab === 'pematang-borders' ? (
            // PEMATANG BORDERS — Real UI
            embankments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Fence className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
                <h3 className="text-lg font-medium">Belum ada pematang sawah</h3>
                <p className="text-muted-foreground max-w-sm mt-1 mb-6">
                  Tambahkan batas pematang (galengan) antar petak sawah pada lahan ini.
                </p>
                <Button onClick={() => setIsBorderModalOpen(true)} disabled={!selectedFieldId}>
                  <Plus className="mr-2 h-4 w-4" /> Tambah Pematang
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left whitespace-nowrap">
                  <thead className="bg-muted/50 text-muted-foreground uppercase text-xs border-b">
                    <tr>
                      <th className="px-6 py-3 font-medium">Nama Pematang</th>
                      <th className="px-6 py-3 font-medium">Kode</th>
                      <th className="px-6 py-3 font-medium">Koneksi Sub-block</th>
                      <th className="px-6 py-3 font-medium text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredEmbankments.map((emb) => (
                      <tr key={emb.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-6 py-4 font-medium text-foreground flex items-center gap-2">
                          {emb.name}
                          {emb.polygonGeom || emb.polygon_geom ? (
                            <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-600 border-purple-500/20 py-0 px-1 h-5 flex items-center gap-0.5">
                              <MapPin className="h-3 w-3" /> Terpetakan
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20 py-0 px-1 h-5 flex items-center gap-0.5">
                              <AlertTriangle className="h-3 w-3" /> No Map
                            </Badge>
                          )}
                        </td>
                        <td className="px-6 py-4 code font-mono text-xs">{emb.code || '-'}</td>
                        <td className="px-6 py-4 text-xs text-muted-foreground truncate max-w-xs" title={getConnectedSubBlockNames(emb.connectedSubBlocks || emb.connected_sub_blocks)}>
                          {getConnectedSubBlockNames(emb.connectedSubBlocks || emb.connected_sub_blocks)}
                        </td>
                        <td className="px-6 py-4 text-right flex justify-end gap-2">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground"
                            onClick={() => setDetailEntity(emb)}
                          >
                            <Info className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-primary"
                            onClick={() => {
                              setEditingBorder(emb);
                              setIsBorderModalOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" /> 
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-destructive"
                            onClick={() => handleDeleteEmbankment(emb.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            // IRRIGATION POINTS TABLE
            irrigationPoints.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <MapPin className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
                <h3 className="text-lg font-medium">Belum ada titik irigasi</h3>
                <p className="text-muted-foreground max-w-sm mt-1 mb-6">
                  Mulai dengan memetakan titik sumber air atau saluran pembuangan lahan Anda.
                </p>
                <Button onClick={() => setIsPointModalOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Tambah Titik Irigasi
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left whitespace-nowrap">
                  <thead className="bg-muted/50 text-muted-foreground uppercase text-xs border-b">
                    <tr>
                      <th className="px-6 py-3 font-medium">Nama</th>
                      <th className="px-6 py-3 font-medium">Tipe Titik</th>
                      <th className="px-6 py-3 font-medium">Sub-blok Terhubung</th>
                      <th className="px-6 py-3 font-medium">Elevasi</th>
                      <th className="px-6 py-3 font-medium text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredPoints.map((ip) => {
                      return (
                        <tr key={ip.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-6 py-4 font-semibold text-sm">{ip.name || '-'}</td>
                          <td className="px-6 py-4">
                            {ip.pointType === 'source' ? (
                              <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 py-0.5 px-2">
                                Sumber Air (Source)
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 py-0.5 px-2">
                                Saluran Buang (Drain)
                              </Badge>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm">
                            {(() => {
                              const assigned = ip.assignedSubBlocks ?? [];
                              if (assigned.length === 0) return <span className="text-muted-foreground">—</span>;
                              return assigned
                                .map(id => subBlocks.find(sb => sb.id === id)?.name || id)
                                .join(', ');
                            })()}
                          </td>
                          <td className="px-6 py-4">
                            {(() => {
                              const elev = ip.callibratedElevation !== null && ip.callibratedElevation !== undefined
                                ? ip.callibratedElevation
                                : ip.elevationM;
                              return elev ? `${parseFloat(elev.toString()).toFixed(2)} m` : '-';
                            })()}
                          </td>
                          <td className="px-6 py-4 text-right flex justify-end gap-2">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-primary"
                              onClick={() => {
                                setEditingPoint(ip);
                                setIsPointModalOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" /> 
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleDeletePoint(ip.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </CardContent>
      </Card>

      {isModalOpen && (
        <CreateSubBlockModal 
          isOpen={isModalOpen} 
          fieldId={selectedFieldId}
          initialData={editingSubBlock}
          onClose={() => {
            setIsModalOpen(false);
            setEditingSubBlock(null);
          }} 
          onSuccess={() => {
            if (selectedFieldId) fetchSubBlocks(selectedFieldId);
          }}
        />
      )}

      {isPointModalOpen && (
        <CreateIrrigationPointModal 
          isOpen={isPointModalOpen}
          fieldId={selectedFieldId}
          initialData={editingPoint}
          onClose={() => {
            setIsPointModalOpen(false);
            setEditingPoint(null);
          }}
          onSuccess={() => {
            if (selectedFieldId) fetchIrrigationPoints(selectedFieldId);
          }}
        />
      )}

      {isBorderModalOpen && (
        <CreateSubBlockBorderModal
          isOpen={isBorderModalOpen}
          fieldId={selectedFieldId}
          initialData={editingBorder}
          onClose={() => {
            setIsBorderModalOpen(false);
            setEditingBorder(null);
          }}
          onSuccess={() => {
            if (selectedFieldId) fetchEmbankments(selectedFieldId);
          }}
        />
      )}

      <EntityDetailModal 
        isOpen={!!detailEntity} 
        onClose={() => setDetailEntity(null)} 
        title={detailEntity?.polygonGeom && !detailEntity?.devices ? "Detail Pematang Sawah" : "Detail Petak (Sub-block)"}
        data={detailEntity}
      />
    </div>
  );
}
