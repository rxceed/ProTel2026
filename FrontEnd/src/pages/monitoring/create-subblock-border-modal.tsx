import { useState, useEffect } from 'react';
import { X, Loader2, Map, Check, Fence, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SubBlockMapEditor } from '@/components/mapping/SubBlockMapEditor';
import { apiClient } from '@/api/client';

interface EmbankmentFormData {
  name: string;
  code: string;
  elevation_m: number | '';
  soil_type: string;
  display_order: number;
  notes: string;
}

interface CreateSubBlockBorderModalProps {
  isOpen: boolean;
  fieldId: string | null;
  initialData?: any;
  onClose: () => void;
  onSuccess: () => void;
}

async function calculateAverageElevation(polygonGeom: any, fieldName: string): Promise<number | null> {
  console.log("[MapElevation] calculateAverageElevation starting for field:", fieldName);
  try {
    if (!polygonGeom) {
      console.warn("[MapElevation] polygonGeom is empty");
      return null;
    }
    if (!fieldName) {
      console.warn("[MapElevation] fieldName is empty");
      return null;
    }
    
    const geom = typeof polygonGeom === 'string' ? JSON.parse(polygonGeom) : polygonGeom;
    if (!geom || geom.type !== 'Polygon' || !geom.coordinates || !geom.coordinates[0]) {
      return null;
    }
    
    const coordinates = geom.coordinates[0] as [number, number][];
    
    let georeferenceStr = localStorage.getItem(`${fieldName}_georeference`);
    if (!georeferenceStr) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.toLowerCase().endsWith('_georeference')) {
          georeferenceStr = localStorage.getItem(key);
          break;
        }
      }
    }
    
    if (!georeferenceStr) {
      try {
        const fetchRes = await fetch('/georeference.json');
        if (fetchRes.ok) {
          georeferenceStr = await fetchRes.text();
        }
      } catch (fetchErr) {
        console.error("[MapElevation] Error fetching fallback /georeference.json:", fetchErr);
      }
    }
    
    if (!georeferenceStr) return null;
    
    const georeference = JSON.parse(georeferenceStr);
    const points = georeference.points;
    if (!Array.isArray(points) || points.length === 0) return null;
    
    let sumElevation = 0;
    let countPoints = 0;
    
    const isPointInPolygon = (point: [number, number], vs: [number, number][]) => {
      const x = point[0], y = point[1];
      let inside = false;
      for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i][0], yi = vs[i][1];
        const xj = vs[j][0], yj = vs[j][1];
        const intersect = ((yi > y) !== (yj > y))
          && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };
    
    points.forEach((p: any) => {
      if (typeof p.x === 'number' && typeof p.y === 'number' && typeof p.elevation === 'number') {
        if (isPointInPolygon([p.x, p.y], coordinates)) {
          sumElevation += p.elevation;
          countPoints++;
        }
      }
    });
    
    if (countPoints > 0) {
      return Math.round((sumElevation / countPoints) * 100) / 100;
    }
  } catch (error) {
    console.error("[MapElevation] Failed to calculate average elevation:", error);
  }
  return null;
}

function convertPixelPolygonToGeographic(polygonGeom: any, fieldData: any): any {
  try {
    if (!polygonGeom || !fieldData) return polygonGeom;
    if (!fieldData.mapVisualUrl) return polygonGeom;
    const geom = typeof polygonGeom === 'string' ? JSON.parse(polygonGeom) : polygonGeom;
    if (!geom || geom.type !== 'Polygon' || !geom.coordinates || !geom.coordinates[0]) {
      return polygonGeom;
    }
    
    const bounds = fieldData.mapBounds || [[ -6.2100, 106.8100], [-6.2110, 106.8110]];
    const lon_min = bounds[0][1];
    const lon_max = bounds[1][1];
    const lat_max = bounds[0][0];
    const lat_min = bounds[1][0];
    
    const fieldHeaderStr = localStorage.getItem(fieldData.name);
    let imageWidth = 1000;
    let imageHeight = 1000;
    if (fieldHeaderStr) {
      try {
        const headerData = JSON.parse(fieldHeaderStr);
        imageWidth = parseFloat(headerData['x-width']) || 1000;
        imageHeight = parseFloat(headerData['x-height']) || 1000;
      } catch (e) {}
    }
    
    const pixelCoords = geom.coordinates[0] as [number, number][];
    const geoCoords = pixelCoords.map(([px, py]) => {
      const lon = lon_min + (px / imageWidth) * (lon_max - lon_min);
      const lat = lat_min + (py / imageHeight) * (lat_max - lat_min);
      return [lon, lat];
    });
    
    const transformedGeom = {
      ...geom,
      coordinates: [geoCoords]
    };
    
    return typeof polygonGeom === 'string' ? JSON.stringify(transformedGeom) : transformedGeom;
  } catch (error) {
    console.error("[MapElevation] Failed to transform pixel polygon to geographic:", error);
    return polygonGeom;
  }
}

export function CreateSubBlockBorderModal({
  isOpen,
  fieldId,
  initialData,
  onClose,
  onSuccess,
}: CreateSubBlockBorderModalProps) {
  const [formData, setFormData] = useState<EmbankmentFormData>({
    name: initialData?.name || '',
    code: initialData?.code || '',
    elevation_m: initialData?.elevationM || '',
    soil_type: initialData?.soilType || 'clay',
    display_order: initialData?.displayOrder || 1,
    notes: initialData?.notes || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isMapEditorOpen, setIsMapEditorOpen] = useState(false);
  const [polygonGeom, setPolygonGeom] = useState<any>(initialData?.polygonGeom || null);
  const [fieldData, setFieldData] = useState<any>(null);
  const [allSubBlocks, setAllSubBlocks] = useState<any[]>([]);
  const [allEmbankments, setAllEmbankments] = useState<any[]>([]);
  const [selectedSubBlockIds, setSelectedSubBlockIds] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen && fieldId) {
      apiClient.get(`/fields/${fieldId}`).then(res => setFieldData(res.data.data));
      apiClient.get(`/fields/${fieldId}/sub-blocks`)
        .then(res => setAllSubBlocks(res.data.data))
        .catch(err => console.error("Failed to load sub-blocks", err));
      apiClient.get(`/fields/${fieldId}/embankments`)
        .then(res => setAllEmbankments(res.data.data))
        .catch(err => console.error("Failed to load embankments", err));
    }
  }, [isOpen, fieldId]);

  useEffect(() => {
    if (initialData?.connectedSubBlocks) {
      setSelectedSubBlockIds(initialData.connectedSubBlocks);
    } else if (initialData?.connected_sub_blocks) {
      setSelectedSubBlockIds(initialData.connected_sub_blocks);
    } else {
      setSelectedSubBlockIds([]);
    }
  }, [initialData]);

  if (!isOpen) return null;

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const value = e.target.type === 'number' ? parseFloat(e.target.value) : e.target.value;
    setFormData((prev) => ({ ...prev, [e.target.name]: value }));
  };

  const handleSubBlockToggle = (sbId: string) => {
    setSelectedSubBlockIds(prev => 
      prev.includes(sbId) ? prev.filter(id => id !== sbId) : [...prev, sbId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fieldId) {
      setError('Field ID tidak valid.');
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
        polygon_geom: parsedGeom,
        connected_sub_blocks: selectedSubBlockIds,
      };

      if (initialData?.id) {
        await apiClient.patch(`/embankments/${initialData.id}`, payload);
      } else {
        await apiClient.post(`/fields/${fieldId}/embankments`, payload);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Gagal menyimpan pematang');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
      <div className="w-full max-w-md rounded-xl bg-card text-card-foreground shadow-lg border">
        {/* Header */}
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Fence className="h-5 w-5 text-primary" />
            {initialData ? 'Edit Pematang Sawah' : 'Tambah Pematang Sawah'}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-full"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 text-sm text-destructive-foreground bg-destructive rounded-md">
              {error}
            </div>
          )}

          {/* Name & Code */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nama Pematang *</label>
              <input
                required
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Cth: Pematang Utara"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Kode Pematang</label>
              <input
                name="code"
                value={formData.code}
                onChange={handleChange}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Cth: PM-1"
              />
            </div>
          </div>

          {/* Elevation & Soil Type */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Elevasi (Meter)</label>
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

          {/* Connected Sub Blocks */}
          <div className="space-y-2 border p-3 rounded-md bg-muted/10">
            <label className="text-xs font-semibold flex items-center gap-1.5 text-foreground uppercase tracking-wide">
              Koneksi Sub-block
            </label>
            <p className="text-[10px] text-muted-foreground leading-normal mb-2">
              Pilih satu atau lebih sub-block yang berbatasan/terhubung dengan pematang ini.
            </p>
            {allSubBlocks.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-1 text-center bg-background rounded border border-dashed">
                Tidak ada sub-block tersedia di lahan ini.
              </p>
            ) : (
              <div className="max-h-32 overflow-y-auto space-y-1 border rounded-md p-1.5 bg-background">
                {allSubBlocks.map((sb) => {
                  const isChecked = selectedSubBlockIds.includes(sb.id);
                  return (
                    <label key={sb.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer transition-colors border border-transparent text-xs">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleSubBlockToggle(sb.id)}
                        className="rounded border-gray-300 text-primary focus:ring-primary h-3.5 w-3.5"
                      />
                      <span className="font-medium text-foreground truncate">{sb.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Description / Notes */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Keterangan</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={2}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              placeholder="Deskripsi opsional..."
            />
          </div>

          {/* Map drawing section */}
          <div className="space-y-2 p-3 border border-dashed rounded-md bg-muted/20">
            <div className="flex justify-between items-center mb-2">
              <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <Layers className="h-3 w-3" /> Area Pematang (GeoJSON)
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
              Klik tombol di atas untuk menggambar batas pematang sawah secara presisi di atas
              citra drone (menggunakan warna ungu).
            </p>
          </div>

          {/* Footer buttons */}
          <div className="flex justify-end space-x-2 pt-4 border-t mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Batal
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan Pematang
            </Button>
          </div>
        </form>

        {/* Map editor overlay — sets isEmbankment={true} for purple styling */}
        {isMapEditorOpen && fieldData && (
          <SubBlockMapEditor
            field={fieldData}
            existingPolygon={polygonGeom}
            devices={[]}
            selectedDeviceIds={[]}
            subBlockId={initialData?.id}
            isEmbankment={true}
            existingSubBlocks={allSubBlocks}
            existingEmbankments={allEmbankments}
            onClose={() => setIsMapEditorOpen(false)}
            onSave={async (geojson) => {
              const avgElevation = await calculateAverageElevation(geojson, fieldData.name);
              if (avgElevation !== null) {
                setFormData((prev) => ({
                  ...prev,
                  elevation_m: avgElevation,
                }));
              }

              setPolygonGeom(geojson);
              setIsMapEditorOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
