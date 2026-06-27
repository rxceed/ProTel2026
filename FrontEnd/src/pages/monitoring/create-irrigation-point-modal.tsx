import { useState, useEffect } from 'react';
import { X, Loader2, Map, Check, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient, gisProcClient } from '@/api/client';
import { IrrigationPointMapEditor } from '@/components/mapping/IrrigationPointMapEditor';
import { toLonLat } from 'ol/proj';

interface CreateIrrigationPointModalProps {
  isOpen: boolean;
  fieldId: string | null;
  initialData?: any;
  onClose: () => void;
  onSuccess: () => void;
}

async function fetchGeoreferencePoints(fieldData: any): Promise<any[]> {
  if (!fieldData || !fieldData.name) return [];
  const fieldName = fieldData.name;
  
  // 1. Try to read from localStorage
  let georeferenceStr = localStorage.getItem(`${fieldName}_georeference`);
  if (georeferenceStr) {
    try {
      const parsed = JSON.parse(georeferenceStr);
      if (Array.isArray(parsed.points)) return parsed.points;
    } catch (e) {}
  }
  
  // 2. Fallback to localStorage keys for georeference metadata
  const geoDataStr = localStorage.getItem(fieldName) || localStorage.getItem(`map_headers_${fieldName}`);
  if (!geoDataStr) {
    console.warn(`[MapElevation] No georeferencing metadata found in localStorage for: ${fieldName}`);
    return [];
  }
  
  try {
    const geoData = JSON.parse(geoDataStr);
    const x_crs = geoData['x_crs'] || geoData['x-crs'] || '';
    const x_bounds = geoData['x_bounds'] || geoData['x-bounds'] || '';
    const x_transform = geoData['x_transform'] || geoData['x-transform'] || '';
    const max_resolution = geoData['max_resolution'] || geoData['max-resolution'] || '';
    
    let projectId = '';
    const mapUrl = fieldData.mapVisualUrl;
    if (mapUrl) {
      const match = mapUrl.match(/[?&]project_name=([^&]+)/);
      if (match) {
        projectId = decodeURIComponent(match[1]);
      }
    }
    
    if (!projectId) {
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        projectId = user.id;
      }
    }
    
    if (!projectId) {
      const authRes = await apiClient.get('/auth/me');
      projectId = authRes.data?.data?.id;
    }
    
    if (!projectId) return [];
    
    const res = await gisProcClient.get(`/webodm/projects/${projectId}/tasks/${fieldName}/dtm`, {
      params: {
        max_resolution,
        x_crs,
        x_bounds,
        x_transform
      }
    });
    
    if (res.data && Array.isArray(res.data.points)) {
      localStorage.setItem(`${fieldName}_georeference`, JSON.stringify(res.data));
      return res.data.points;
    }
  } catch (err) {
    console.error(`[MapElevation] Failed to fetch georeference DTM for ${fieldName}:`, err);
  }
  
  return [];
}

async function getPointElevation(point: [number, number], fieldData: any): Promise<number | null> {
  try {
    if (!point || !fieldData) return null;
    const points = await fetchGeoreferencePoints(fieldData);
    if (points.length === 0) return null;
    
    const [cx, cy] = point; // [lon, lat]
    
    // Convert geographic coordinates [cx, cy] to pixel coordinates [qx, qy]
    const bounds = fieldData.mapBounds || [[ -6.2100, 106.8100], [-6.2110, 106.8110]];
    const lon_min = bounds[0][1];
    const lon_max = bounds[1][1];
    const lat_max = bounds[0][0];
    const lat_min = bounds[1][0];
    
    const fieldHeaderStr = localStorage.getItem(fieldData.name) || localStorage.getItem(`map_headers_${fieldData.name}`);
    let imageWidth = 1000;
    let imageHeight = 1000;
    if (fieldHeaderStr) {
      try {
        const headerData = JSON.parse(fieldHeaderStr);
        imageWidth = parseFloat(headerData['x-width'] || headerData['x_width']) || 1000;
        imageHeight = parseFloat(headerData['x-height'] || headerData['x_height']) || 1000;
      } catch (e) {}
    }
    
    const qx = ((cx - lon_min) / (lon_max - lon_min)) * imageWidth;
    const qy = ((cy - lat_min) / (lat_max - lat_min)) * imageHeight;
    
    console.log(`[MapElevation] Matching point in pixel space: px=${qx}, py=${qy}`);
    
    let closestPoint: any = null;
    let minDistance = Infinity;

    points.forEach((p: any) => {
      const px = parseFloat(p.x);
      const py = parseFloat(p.y);
      
      if (!isNaN(px) && !isNaN(py) && typeof p.elevation === 'number') {
        const dist = Math.sqrt((px - qx) ** 2 + (py - qy) ** 2);
        if (dist < minDistance) {
          minDistance = dist;
          closestPoint = p;
        }
      }
    });
    
    return closestPoint ? closestPoint.elevation : null;
  } catch (err) {
    console.error("Failed to get point elevation", err);
    return null;
  }
}

function convertPixelPointToGeographic(coords: [number, number], fieldData: any, imageWidth: number, imageHeight: number): [number, number] {
  const bounds = fieldData.mapBounds || [[ -6.2100, 106.8100], [-6.2110, 106.8110]];
  const lon_min = bounds[0][1];
  const lon_max = bounds[1][1];
  const lat_max = bounds[0][0];
  const lat_min = bounds[1][0];
  
  const px = coords[0];
  const py = coords[1];
  const lon = lon_min + (px / imageWidth) * (lon_max - lon_min);
  const lat = lat_min + (py / imageHeight) * (lat_max - lat_min);
  return [lon, lat];
}

export function CreateIrrigationPointModal({ isOpen, fieldId, initialData, onClose, onSuccess }: CreateIrrigationPointModalProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [pointType, setPointType] = useState<'source' | 'drain'>(initialData?.pointType || 'source');
  const [elevationM, setElevationM] = useState<number | ''>(initialData?.elevationM || '');
  const [coordinatePoint, setCoordinatePoint] = useState<any>(initialData?.coordinatePoint || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isMapEditorOpen, setIsMapEditorOpen] = useState(false);
  const [fieldData, setFieldData] = useState<any>(null);
  const [subBlocks, setSubBlocks] = useState<any[]>([]);
  const [embankments, setEmbankments] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen && fieldId) {
      apiClient.get(`/fields/${fieldId}`).then(res => setFieldData(res.data.data));
      apiClient.get(`/fields/${fieldId}/sub-blocks`).then(res => setSubBlocks(res.data.data));
      apiClient.get(`/fields/${fieldId}/embankments`).then(res => setEmbankments(res.data.data)).catch(() => {});
    }
  }, [isOpen, fieldId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fieldId) {
      setError("Field ID tidak valid.");
      return;
    }
    
    setError('');
    setLoading(true);

    try {
      const payload = {
        name,
        point_type: pointType,
        coordinate_point: coordinatePoint,
        elevation_m: elevationM === '' ? undefined : elevationM
      };
      
      if (initialData?.id) {
        await apiClient.patch(`/irrigation-points/${initialData.id}`, payload);
      } else {
        await apiClient.post(`/fields/${fieldId}/irrigation-points`, payload);
      }
      
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Gagal menyimpan titik irigasi');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
      <div className="w-full max-w-md rounded-xl bg-card text-card-foreground shadow-lg border">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">
            {initialData ? 'Edit Titik Irigasi' : 'Tambah Titik Irigasi'}
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

          <div className="space-y-2">
            <label className="text-sm font-medium">Nama Titik Irigasi *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Cth: Pompa Utama / Saluran Primer"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Tipe Titik *</label>
            <select
              value={pointType}
              onChange={(e) => setPointType(e.target.value as 'source' | 'drain')}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="source">Sumber Air (Source)</option>
              <option value="drain">Saluran Buang (Drain)</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Ketinggian (Elevation - meter)</label>
            <input
              type="number"
              step="0.01"
              value={elevationM}
              onChange={(e) => setElevationM(e.target.value === '' ? '' : parseFloat(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Cth: 12.5"
            />
          </div>

          <div className="space-y-2 p-3 border border-dashed rounded-md bg-muted/20">
            <div className="flex justify-between items-center mb-2">
              <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <Layers className="h-3 w-3" /> Lokasi Titik (GeoJSON)
              </p>
              {coordinatePoint && (
                <span className="text-[10px] text-green-600 font-bold flex items-center gap-1">
                  <Check className="h-3 w-3" /> Terpetakan
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
              {coordinatePoint ? 'Ubah Posisi Titik' : 'Tentukan Posisi di Peta'}
            </Button>
            {coordinatePoint && (
              <p className="text-[10px] text-muted-foreground mt-1 text-center font-mono">
                [{coordinatePoint.coordinates[0].toFixed(6)}, {coordinatePoint.coordinates[1].toFixed(6)}]
              </p>
            )}
          </div>

          <div className="flex justify-end space-x-2 pt-4 border-t mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Batal
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan Titik
            </Button>
          </div>
        </form>

        {isMapEditorOpen && fieldData && (
          <IrrigationPointMapEditor
            field={fieldData}
            existingPoint={coordinatePoint}
            pointType={pointType}
            subBlocks={subBlocks}
            embankments={embankments}
            onClose={() => setIsMapEditorOpen(false)}
            onSave={async (coordsList, mapWidth, mapHeight) => {
              const isMulti = Array.isArray(coordsList[0]);
              
              if (fieldData.mapVisualUrl) {
                if (isMulti) {
                  const pts = (coordsList as [number, number][]).map(coords => 
                    convertPixelPointToGeographic(coords, fieldData, mapWidth, mapHeight)
                  );
                  setCoordinatePoint({
                    type: 'MultiPoint',
                    coordinates: pts
                  });
                  const elevation = await getPointElevation(pts[0], fieldData);
                  if (elevation !== null) setElevationM(elevation);
                } else {
                  const singleCoords = coordsList as [number, number];
                  const [lon, lat] = convertPixelPointToGeographic(singleCoords, fieldData, mapWidth, mapHeight);
                  setCoordinatePoint({
                    type: 'Point',
                    coordinates: [lon, lat]
                  });
                  const elevation = await getPointElevation([lon, lat], fieldData);
                  if (elevation !== null) setElevationM(elevation);
                }
              } else {
                if (isMulti) {
                  const pts = (coordsList as [number, number][]).map(coords => toLonLat(coords));
                  setCoordinatePoint({
                    type: 'MultiPoint',
                    coordinates: pts
                  });
                } else {
                  const singleCoords = coordsList as [number, number];
                  const [lon, lat] = toLonLat(singleCoords);
                  setCoordinatePoint({
                    type: 'Point',
                    coordinates: [lon, lat]
                  });
                }
              }
              setIsMapEditorOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
