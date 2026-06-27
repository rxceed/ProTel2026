import { useState } from 'react';
import { X, Loader2, Cpu } from 'lucide-react';
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
    
    // Parse polygonGeom if it's a string
    const geom = typeof polygonGeom === 'string' ? JSON.parse(polygonGeom) : polygonGeom;
    console.log("[MapElevation] Parsed geometry:", geom);
    if (!geom || geom.type !== 'Polygon' || !geom.coordinates || !geom.coordinates[0]) {
      console.warn("[MapElevation] Geometry is not a valid Polygon or lacks coordinates");
      return null;
    }
    
    const coordinates = geom.coordinates[0] as [number, number][];
    console.log("[MapElevation] Polygon coordinates (first ring):", coordinates);
    
    // Fetch georeferencing points from localStorage
    let georeferenceStr = localStorage.getItem(`${fieldName}_georeference`);
    console.log(`[MapElevation] Attempting to load localStorage key: ${fieldName}_georeference. Found:`, !!georeferenceStr);
    
    if (!georeferenceStr) {
      // Try to find any key ending in _georeference as a fallback
      console.log("[MapElevation] Doing fallback search for keys ending in _georeference in localStorage...");
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.toLowerCase().endsWith('_georeference')) {
          console.log(`[MapElevation] Found fallback key: ${key}`);
          georeferenceStr = localStorage.getItem(key);
          break;
        }
      }
    }
    
    if (!georeferenceStr) {
      console.log("[MapElevation] No georeferencing data found in localStorage. Attempting to fetch from /georeference.json fallback...");
      try {
        const fetchRes = await fetch('/georeference.json');
        if (fetchRes.ok) {
          georeferenceStr = await fetchRes.text();
          console.log("[MapElevation] Successfully loaded fallback georeference.json from server");
        } else {
          console.warn("[MapElevation] Failed to fetch /georeference.json fallback:", fetchRes.status);
        }
      } catch (fetchErr) {
        console.error("[MapElevation] Error fetching fallback /georeference.json:", fetchErr);
      }
    }
    
    if (!georeferenceStr) {
      console.warn("[MapElevation] No georeferencing data found in localStorage or fallback");
      return null;
    }
    
    const georeference = JSON.parse(georeferenceStr);
    const points = georeference.points;
    if (!Array.isArray(points) || points.length === 0) {
      console.warn("[MapElevation] Georeference data has no points array or it is empty");
      return null;
    }
    
    console.log(`[MapElevation] Total georeference points to check: ${points.length}`);
    
    let sumElevation = 0;
    let countPoints = 0;
    
    // PIP check function using ray-casting algorithm
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
    
    // Loop through all points and check if inside the polygon using x and y coordinates
    points.forEach((p: any) => {
      if (typeof p.x === 'number' && typeof p.y === 'number' && typeof p.elevation === 'number') {
        if (isPointInPolygon([p.x, p.y], coordinates)) {
          sumElevation += p.elevation;
          countPoints++;
        }
      }
    });
    
    console.log(`[MapElevation] Found ${countPoints} points inside the polygon. Sum elevation: ${sumElevation}`);
    
    if (countPoints > 0) {
      const avg = sumElevation / countPoints;
      const result = Math.round(avg * 100) / 100;
      console.log(`[MapElevation] Computed average elevation: ${result}`);
      return result;
    } else {
      console.warn("[MapElevation] No points were found inside the drawn polygon boundaries");
    }
  } catch (error) {
    console.error("[MapElevation] Failed to calculate average elevation:", error);
  }
  return null;
}

function convertPixelPolygonToGeographic(polygonGeom: any, fieldData: any): any {
  console.log("[MapElevation] Converting pixel polygon to geographic for field:", fieldData?.name);
  try {
    if (!polygonGeom || !fieldData) return polygonGeom;
    if (!fieldData.mapVisualUrl) return polygonGeom;
    const geom = typeof polygonGeom === 'string' ? JSON.parse(polygonGeom) : polygonGeom;
    if (!geom || geom.type !== 'Polygon' || !geom.coordinates || !geom.coordinates[0]) {
      return polygonGeom;
    }
    
    // Retrieve width, height, and bounds
    const bounds = fieldData.mapBounds || [[ -6.2100, 106.8100], [-6.2110, 106.8110]];
    const lon_min = bounds[0][1];
    const lon_max = bounds[1][1];
    const lat_max = bounds[0][0];
    const lat_min = bounds[1][0];
    
    // Let's get the width and height of the image from localStorage headers
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
    
    console.log(`[MapElevation] Image dimensions used for conversion: width=${imageWidth}, height=${imageHeight}`);
    
    // Convert coordinate ring
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
    
    console.log("[MapElevation] Transformed geographic geometry:", transformedGeom);
    return typeof polygonGeom === 'string' ? JSON.stringify(transformedGeom) : transformedGeom;
  } catch (error) {
    console.error("[MapElevation] Failed to transform pixel polygon to geographic:", error);
    return polygonGeom;
  }
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
  const [allDevices, setAllDevices] = useState<any[]>([]);
  const [allSubBlocks, setAllSubBlocks] = useState<any[]>([]);
  const [allEmbankments, setAllEmbankments] = useState<any[]>([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [pendingDeviceCoords, setPendingDeviceCoords] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    if (isOpen && fieldId) {
      apiClient.get(`/fields/${fieldId}`).then(res => setFieldData(res.data.data));
      
      // Fetch all devices in field
      apiClient.get(`/fields/${fieldId}/devices`)
        .then(res => setAllDevices(res.data.data))
        .catch(err => console.error("Failed to load devices", err));

      // Fetch all sub-blocks in field
      apiClient.get(`/fields/${fieldId}/sub-blocks`)
        .then(res => setAllSubBlocks(res.data.data))
        .catch(err => console.error("Failed to load sub-blocks", err));

      // Fetch all embankments in field
      apiClient.get(`/fields/${fieldId}/embankments`)
        .then(res => setAllEmbankments(res.data.data))
        .catch(err => console.error("Failed to load embankments", err));
    }
  }, [isOpen, fieldId]);

  useEffect(() => {
    if (initialData?.devices) {
      setSelectedDeviceIds(initialData.devices.map((d: any) => d.id));
    } else {
      setSelectedDeviceIds([]);
    }
  }, [initialData]);

  const getSubBlockName = (sbId: string | null) => {
    if (!sbId) return null;
    const sb = allSubBlocks.find(s => s.id === sbId);
    return sb ? sb.name : 'Petak Lain';
  };

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
      
      let subBlockId = initialData?.id;
      if (initialData?.id) {
        await apiClient.patch(`/sub-blocks/${initialData.id}`, payload);
      } else {
        const response = await apiClient.post(`/fields/${fieldId}/sub-blocks`, payload);
        subBlockId = response.data.data.id;
      }

      // Process device assignments
      const initialDeviceIds = initialData?.devices?.map((d: any) => d.id) || [];
      const toAssign = selectedDeviceIds.filter((id: string) => !initialDeviceIds.includes(id));
      const toUnassign = initialDeviceIds.filter((id: string) => !selectedDeviceIds.includes(id));
      
      await Promise.all([
        ...toAssign.map((id: string) => apiClient.post(`/devices/${id}/assign`, { sub_block_id: subBlockId })),
        ...toUnassign.map((id: string) => apiClient.post(`/devices/${id}/unassign`))
      ]);

      // Update coordinates for all currently selected devices
      await Promise.all(
        selectedDeviceIds.map(async (id: string) => {
          const coord = pendingDeviceCoords[id];
          if (coord) {
            const geojsonPoint = {
              type: 'Point',
              coordinates: [coord.x, coord.y]
            };
            await apiClient.patch(`/devices/${id}`, { coordinate: geojsonPoint });
          }
        })
      );

      // Clear coordinates for unassigned devices
      await Promise.all(
        toUnassign.map(async (id: string) => {
          await apiClient.patch(`/devices/${id}`, { coordinate: null });
        })
      );
      
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

          <div className="space-y-2 border p-3 rounded-md bg-muted/10">
            <label className="text-xs font-semibold flex items-center gap-1.5 text-foreground uppercase tracking-wide">
              <Cpu className="h-3.5 w-3.5 text-primary" /> Alokasi Device / Sensor
            </label>
            <p className="text-[10px] text-muted-foreground leading-normal">
              Pilih satu atau lebih device untuk dialokasikan ke petak ini. Satu device hanya bisa terpasang pada satu petak.
            </p>
            {allDevices.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-1 text-center bg-background rounded border border-dashed">
                Tidak ada device tersedia di lahan ini.
              </p>
            ) : (
              <div className="max-h-40 overflow-y-auto space-y-1 border rounded-md p-1.5 bg-background mt-2">
                {allDevices.map((d) => {
                  const currentSbId = d.subBlockId || d.sub_block_id;
                  const isAssignedToOther = currentSbId && currentSbId !== initialData?.id;
                  const isAssignedHere = currentSbId && currentSbId === initialData?.id;
                  const isChecked = selectedDeviceIds.includes(d.id);
                  
                  return (
                    <label key={d.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer transition-colors border border-transparent hover:border-muted text-xs">
                      <input 
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedDeviceIds(prev => [...prev, d.id]);
                          } else {
                            setSelectedDeviceIds(prev => prev.filter(id => id !== d.id));
                          }
                        }}
                        className="rounded border-gray-300 text-primary focus:ring-primary h-3.5 w-3.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-bold text-foreground truncate">{d.deviceCode}</span>
                          <span className="capitalize text-[10px] text-muted-foreground font-medium shrink-0">{d.deviceType.replace('_', ' ')}</span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-[10px]">
                          {isAssignedHere ? (
                            <span className="text-green-600 font-semibold">Terpasang di petak ini</span>
                          ) : isAssignedToOther ? (
                            <span className="text-amber-600 font-semibold truncate">
                              Terpasang di: {getSubBlockName(currentSbId)} {isChecked && " (Akan dipindahkan)"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Tersedia</span>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
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
            devices={allDevices}
            selectedDeviceIds={selectedDeviceIds}
            subBlockId={initialData?.id}
            existingSubBlocks={allSubBlocks}
            existingEmbankments={allEmbankments}
            onClose={() => setIsMapEditorOpen(false)}
            onSave={async (geojson, deviceCoords, updatedDeviceIds) => {
              // Calculate average elevation using the pixel coordinates first
              const avgElevation = await calculateAverageElevation(geojson, fieldData.name);
              if (avgElevation !== null) {
                setFormData(prev => ({
                  ...prev,
                  elevation_m: avgElevation
                }));
              }
              
              setPolygonGeom(geojson);
              if (deviceCoords) {
                setPendingDeviceCoords(prev => ({ ...prev, ...deviceCoords }));
              }
              if (updatedDeviceIds) {
                setSelectedDeviceIds(updatedDeviceIds);
              }
              setIsMapEditorOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
