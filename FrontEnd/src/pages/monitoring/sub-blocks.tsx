import { useEffect, useState } from 'react';
import { Plus, Search, MapPin, Loader2, AlertTriangle, Layers, Info, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/api/client';
import { CreateSubBlockModal } from './create-subblock-modal';
import { EntityDetailModal } from '@/components/entity-detail-modal';

interface Field {
  id: string;
  name: string;
}

interface SubBlock {
  id: string;
  fieldId: string;
  name: string;
  code: string | null;
  elevationM: string | null;
  soilType: string | null;
  isActive: boolean;
  polygonGeom?: any;
}

export function SubBlocksPage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  
  const [subBlocks, setSubBlocks] = useState<SubBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSubBlock, setEditingSubBlock] = useState<SubBlock | null>(null);
  const [detailEntity, setDetailEntity] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');

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

  useEffect(() => {
    if (selectedFieldId) {
      fetchSubBlocks(selectedFieldId);
    } else {
      setSubBlocks([]);
    }
  }, [selectedFieldId]);

  const handleDelete = async (id: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus petak ini?')) return;
    try {
      await apiClient.delete(`/sub-blocks/${id}`);
      if (selectedFieldId) fetchSubBlocks(selectedFieldId);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Gagal menghapus petak');
    }
  };

  const filteredSubBlocks = subBlocks.filter(sb => 
    sb.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (sb.code && sb.code.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="flex flex-col gap-6 animate-in fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Master Data: Sub-blocks</h2>
          <p className="text-muted-foreground mt-1">
            Manejemen petak sawah dan poligon untuk setiap Lahan.
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => setIsModalOpen(true)} 
            disabled={!selectedFieldId}
          >
            <Plus className="mr-2 h-4 w-4" /> Tambah Sub-block
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 bg-muted/20 border-b">
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
                placeholder="Cari sub-block..." 
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
              <MapPin className="h-8 w-8 mb-2 opacity-50" />
              <p>Pilih Lahan (Field) di atas untuk melihat Sub-blocks.</p>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
              <p>Memuat data petak...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-destructive">
              <AlertTriangle className="h-10 w-10 mb-4" />
              <p>{error}</p>
              <Button variant="outline" className="mt-4" onClick={() => fetchSubBlocks(selectedFieldId)}>Coba Lagi</Button>
            </div>
          ) : subBlocks.length === 0 ? (
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
                      <td className="px-6 py-4">{sb.elevationM ? `${sb.elevationM} m` : '-'}</td>
                      <td className="px-6 py-4 capitalize">{sb.soilType || '-'}</td>
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

      <EntityDetailModal 
        isOpen={!!detailEntity} 
        onClose={() => setDetailEntity(null)} 
        title="Detail Petak (Sub-block)"
        data={detailEntity}
      />
    </div>
  );
}
