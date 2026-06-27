import { useEffect, useState } from 'react';
import { Plus, Search, Map, Loader2, AlertTriangle, Pencil, Info, Trash2, Image as ImageIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/api/client';
import { CreateFieldModal } from './create-field-modal';
import { EntityDetailModal } from '@/components/entity-detail-modal';
import { MapVisualManager } from '@/components/mapping/MapVisualManager';

interface Field {
  id: string;
  name: string;
  description: string;
  adm4Code: string;
  waterSourceType: string;
  areaHectares: number | null;
  isActive: boolean;
  isSourceDepleted: boolean;
  mapVisualUrl: string | null;
  mapBounds: number[][] | null;
  assignedFileName?: string | null;
  createdAt: string;
}

export function FieldsPage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [detailEntity, setDetailEntity] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [managingMapFieldId, setManagingMapFieldId] = useState<string | null>(null);

  const fetchFields = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/fields');

      setFields(response.data.data); // data is rows, maybe there is meta
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Gagal memuat data lahan');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFields();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus lahan ini?')) return;
    try {
      await apiClient.delete(`/fields/${id}`);
      fetchFields();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Gagal menghapus lahan');
    }
  };
  const filteredFields = fields.filter(f => 
    f.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (f.description && f.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );




  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Master Data: Fields</h2>
          <p className="text-muted-foreground mt-1">
            Manejemen daftar lahan sawah dan properti utamanya.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Tambah Lahan
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Daftar Lahan Aktif</CardTitle>
            </div>
            <div className="flex bg-background border px-3 py-1.5 rounded-md items-center text-sm w-64 shadow-sm">
              <Search className="h-4 w-4 text-muted-foreground mr-2 shrink-0" />
              <input 
                placeholder="Cari lahan..." 
                className="bg-transparent border-none outline-none w-full text-foreground"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
              <p>Memuat data lahan...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-destructive">
              <AlertTriangle className="h-10 w-10 mb-4" />
              <p>{error}</p>
              <Button variant="outline" className="mt-4" onClick={fetchFields}>Coba Lagi</Button>
            </div>
          ) : fields.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center border-dashed border-2 rounded-lg bg-muted/20">
              <Map className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-medium">Belum ada data lahan</h3>
              <p className="text-muted-foreground max-w-sm mt-1 mb-6">
                Mulai dengan menambahkan lahan sawah pertama Anda untuk keperluan monitoring presisi.
              </p>
              <Button onClick={() => setIsModalOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Tambah Lahan Pertama
              </Button>
            </div>
          ) : filteredFields.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Search className="h-8 w-8 mb-2 opacity-20" />
              <p>Tidak ada lahan yang cocok dengan pencarian "{searchTerm}"</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-muted/50 text-muted-foreground uppercase text-xs">
                  <tr>
                    <th className="px-6 py-3 font-medium">Nama Lahan</th>
                    <th className="px-6 py-3 font-medium">Kode Area (ADM4)</th>
                    <th className="px-6 py-3 font-medium">Luas Area</th>
                    <th className="px-6 py-3 font-medium">Water Source</th>
                    <th className="px-6 py-3 font-medium text-center">Status</th>
                    <th className="px-6 py-3 font-medium text-center">Sungai / Sumber</th>
                    <th className="px-6 py-3 font-medium text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredFields.map((field) => (
                    <div key={field.id} className="contents">
                      <tr className="hover:bg-muted/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-medium text-foreground">{field.name}</div>
                          <div className="text-xs text-muted-foreground max-w-[200px] truncate">
                            {field.description || "Tidak ada deskripsi"}
                          </div>
                        </td>
                        <td className="px-6 py-4 code font-mono text-xs">{field.adm4Code}</td>
                        <td className="px-6 py-4">
                          {field.areaHectares ? `${field.areaHectares} Ha` : '-'}
                        </td>
                        <td className="px-6 py-4 capitalize">{field.waterSourceType}</td>
                        <td className="px-6 py-4 text-center">
                          <Badge variant={field.isActive ? "default" : "secondary"}>
                            {field.isActive ? 'Aktif' : 'Non-aktif'}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button
                            onClick={async () => {
                              try {
                                await apiClient.patch(`/fields/${field.id}/drought-status`, {
                                  is_source_depleted: !field.isSourceDepleted
                                });
                                fetchFields();
                              } catch (e) {
                                alert('Gagal mengubah status sungai');
                              }
                            }}
                            className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                              field.isSourceDepleted 
                                ? 'bg-red-100 text-red-800 border-red-200 border' 
                                : 'bg-green-100 text-green-800 border-green-200 border'
                            }`}
                          >
                            {field.isSourceDepleted ? 'Kering / Darurat' : 'Normal / Mengalir'}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-right flex justify-end gap-2">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className={managingMapFieldId === field.id ? "h-8 w-8 text-primary bg-primary/10" : "h-8 w-8 text-muted-foreground"}
                            onClick={() => setManagingMapFieldId(managingMapFieldId === field.id ? null : field.id)}
                          >
                            <ImageIcon className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground"
                            onClick={() => setDetailEntity(field)}
                          >
                            <Info className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-primary"
                            onClick={() => {
                              setEditingField(field);
                              setIsModalOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-destructive"
                            onClick={() => handleDelete(field.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                      {managingMapFieldId === field.id && (
                        <tr key={`${field.id}-map-row`} className="bg-muted/5 animate-in slide-in-from-top-1 duration-200">
                          <td colSpan={7} className="px-6 py-4 border-y">
                            <MapVisualManager 
                              fieldId={field.id}
                              fieldName={field.name}
                              initialVisualUrl={field.mapVisualUrl || undefined}
                              initialBounds={field.mapBounds || undefined}
                              initialAssignedFileName={field.assignedFileName || undefined}
                              onSuccess={() => {
                                fetchFields();
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </div>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateFieldModal 
        isOpen={isModalOpen} 
        initialData={editingField}
        onClose={() => {
          setIsModalOpen(false);
          setEditingField(null);
        }} 
        onSuccess={() => {
          fetchFields();
        }}
      />

      <EntityDetailModal 
        isOpen={!!detailEntity} 
        onClose={() => setDetailEntity(null)} 
        title="Detail Lahan (Field)"
        data={detailEntity}
        excludeKeys={[
          'id', 
          'operatorCountDefault', 
          'operator_count_default', 
          'notes', 
          'mapVisualUrl', 
          'map_visual_url', 
          'mapBounds', 
          'map_bounds',
          'irrigationEdges',
          'irrigation_edges',
          'irrigationNodes',
          'irrigation_nodes'
        ]}
      />
    </div>
  );
}
