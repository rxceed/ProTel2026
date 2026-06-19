import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { Map, Check, Layers } from 'lucide-react';
import { SubBlockMapEditor } from '@/components/mapping/SubBlockMapEditor';
import { useEffect } from 'react';

interface SubBlockFormData {
  name: string;
  code: string;
  elevation_m: number | '';
  soil_type: string;
  display_order: number;
}

interface CreateSubBlockModalProps {
  isOpen: boolean;
  fieldId: string | null;
  initialData?: any;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateSubBlockModal({ isOpen, fieldId, initialData, onClose, onSuccess }: CreateSubBlockModalProps) {
  const [formData, setFormData] = useState<SubBlockFormData>({
    name: initialData?.name || '',
    code: initialData?.code || '',
    elevation_m: initialData?.elevationM || '',
    soil_type: initialData?.soilType || 'clay',
    display_order: initialData?.displayOrder || 1
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isMapEditorOpen, setIsMapEditorOpen] = useState(false);
  const [polygonGeom, setPolygonGeom] = useState<any>(initialData?.polygonGeom || null);
  const [fieldData, setFieldData] = useState<any>(null);

  useEffect(() => {
    if (isOpen && fieldId) {
      apiClient.get(`/fields/${fieldId}`).then(res => setFieldData(res.data.data));
    }
  }, [isOpen, fieldId]);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.type === 'number' ? parseFloat(e.target.value) : e.target.value;
    setFormData(prev => ({ ...prev, [e.target.name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fieldId) {
      setError("Field ID tidak valid.");
      return;
    }
    
    setError('');
    setLoading(true);

    try {
      let parsedGeom = polygonGeom;
      if (typeof polygonGeom === 'string') {
        try {
          parsedGeom = JSON.parse(polygonGeom);
        } catch (e) {
          console.error("Failed to parse polygon geom", e);
        }
      }

      const payload = {
        ...formData,
        elevation_m: formData.elevation_m === '' ? undefined : formData.elevation_m,
        polygon_geom: parsedGeom
      };
      
      if (initialData?.id) {
        await apiClient.patch(`/sub-blocks/${initialData.id}`, payload);
      } else {
        await apiClient.post(`/fields/${fieldId}/sub-blocks`, payload);
      }
      
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Gagal menyimpan sub-block');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
      <div className="w-full max-w-md rounded-xl bg-card text-card-foreground shadow-lg border">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">
            {initialData ? 'Edit Data Petak' : 'Tambah Petak Sub-block'}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 text-sm text-destructive-foreground bg-destructive rounded-md">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nama Petak *</label>
              <input 
                required
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Blok Utara 1"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Kode Petak</label>
              <input 
                name="code"
                value={formData.code}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Cth: BU-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Ketinggian (Elevation)</label>
              <input 
                name="elevation_m"
                type="number"
                step="0.01"
                value={formData.elevation_m}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
               />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipe Tanah</label>
              <input 
                name="soil_type"
                value={formData.soil_type}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Lempung"
              />
            </div>
          </div>

          <div className="space-y-2 p-3 border border-dashed rounded-md bg-muted/20">
            <div className="flex justify-between items-center mb-2">
              <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <Layers className="h-3 w-3" /> Area Mapping (GeoJSON)
              </p>
              {polygonGeom && (
                <span className="text-[10px] text-green-600 font-bold flex items-center gap-1">
                  <Check className="h-3 w-3" /> Tersedia
                </span>
              )}
            </div>
            
            <Button 
              type="button" 
              variant="outline" 
              size="sm" 
              className="w-full h-8 text-xs bg-background"
              onClick={() => setIsMapEditorOpen(true)}
            >
              <Map className="h-3 w-3 mr-2" />
              {polygonGeom ? 'Ubah Gambar Poligon' : 'Gambar Poligon di Peta'}
            </Button>
            <p className="text-[10px] text-muted-foreground mt-2 italic">
              Klik tombol di atas untuk menentukan batas petak sawah secara presisi di atas citra drone.
            </p>
          </div>

          <div className="flex justify-end space-x-2 pt-4 border-t mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Batal
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan Sub-block
            </Button>
          </div>
        </form>

        {isMapEditorOpen && fieldData && (
          <SubBlockMapEditor 
            field={fieldData}
            existingPolygon={polygonGeom}
            onClose={() => setIsMapEditorOpen(false)}
            onSave={(geojson) => {
              setPolygonGeom(geojson);
              setIsMapEditorOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
