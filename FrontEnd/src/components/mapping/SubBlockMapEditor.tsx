import { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Draw from 'ol/interaction/Draw';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import { fromLonLat, toLonLat } from 'ol/proj';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import Projection from 'ol/proj/Projection';
import { Button } from '@/components/ui/button';
import { X, Save, Trash2, MousePointer2, BoxSelect, Cpu, Check } from 'lucide-react';
import { getCachedMapImageUrl } from '@/lib/mapCache';
import { useDialog } from '@/components/ui/dialog-provider';

interface SubBlockMapEditorProps {
  field: {
    id: string;
    name: string;
    mapVisualUrl: string | null;
    mapBounds: number[][] | null;
  };
  existingPolygon?: any;
  devices: any[];
  selectedDeviceIds: string[];
  subBlockId?: string;
  isEmbankment?: boolean;
  existingSubBlocks?: any[];
  existingEmbankments?: any[];
  onSave: (geojson: any, devicePoints?: Record<string, { x: number; y: number }>, updatedDeviceIds?: string[]) => void;
  onClose: () => void;
}

export function SubBlockMapEditor({ 
  field, 
  existingPolygon, 
  devices, 
  selectedDeviceIds, 
  subBlockId, 
  isEmbankment = false,
  existingSubBlocks = [],
  existingEmbankments = [],
  onSave, 
  onClose 
}: SubBlockMapEditorProps) {
  const dialog = useDialog();
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const vectorSource = useRef(new VectorSource());
  const drawInteraction = useRef<Draw | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDrawingPoint, setIsDrawingPoint] = useState(false);
  const [activeDeviceId, setActiveDeviceId] = useState<string>('');
  const [localSelectedDeviceIds, setLocalSelectedDeviceIds] = useState<string[]>(selectedDeviceIds);
  const [mapWidth, setMapWidth] = useState(1000);
  const [mapHeight, setMapHeight] = useState(1000);

  const geoToMapCoords = (lon: number, lat: number, usePixels: boolean, imageWidth: number, imageHeight: number): number[] => {
    if (usePixels) {
      const bounds = field.mapBounds || [[ -6.2100, 106.8100], [-6.2110, 106.8110]];
      const lon_min = bounds[0][1];
      const lon_max = bounds[1][1];
      const lat_max = bounds[0][0];
      const lat_min = bounds[1][0];
      
      const px = ((lon - lon_min) / (lon_max - lon_min)) * imageWidth;
      const py = ((lat - lat_min) / (lat_max - lat_min)) * imageHeight;
      return [px, py];
    } else {
      return fromLonLat([lon, lat]);
    }
  };

  const mapToGeoCoords = (coords: number[], usePixels: boolean, imageWidth: number, imageHeight: number): [number, number] => {
    if (usePixels) {
      const bounds = field.mapBounds || [[ -6.2100, 106.8100], [-6.2110, 106.8110]];
      const lon_min = bounds[0][1];
      const lon_max = bounds[1][1];
      const lat_max = bounds[0][0];
      const lat_min = bounds[1][0];
      
      const px = coords[0];
      const py = coords[1];
      const lon = lon_min + (px / imageWidth) * (lon_max - lon_min);
      const lat = lat_min + (py / imageHeight) * (lat_max - lat_min);
      return [lon, lat];
    } else {
      const [lon, lat] = toLonLat(coords);
      return [lon, lat];
    }
  };

  useEffect(() => {
    if (!mapRef.current) return;

    let active = true;
    let initialMap: Map | null = null;

    const initMap = async () => {
      let imageUrl: string | null = null;
      let imageWidth = 1000;
      let imageHeight = 1000;

      if (field.mapVisualUrl) {
        imageUrl = await getCachedMapImageUrl(field.mapVisualUrl, field.name);
        if (imageUrl) {
          try {
            const dims = await new Promise<{ width: number; height: number }>((resolve) => {
              const img = new Image();
              img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
              img.onerror = () => resolve({ width: 1000, height: 1000 });
              img.src = imageUrl || '';
            });
            imageWidth = dims.width;
            imageHeight = dims.height;
            setMapWidth(dims.width);
            setMapHeight(dims.height);
          } catch (e) {
            console.error("Failed to load map image dimensions:", e);
          }
        }
      }

      if (!active) return;

      vectorSource.current.clear();
      const geojsonFormat = new GeoJSON();

      if (existingPolygon) {
        try {
          const geom = typeof existingPolygon === 'string' 
            ? JSON.parse(existingPolygon) 
            : existingPolygon;
            
          let geomToLoad = geom;
          if (imageUrl && geom.type === 'Polygon' && geom.coordinates && geom.coordinates[0]) {
            const bounds = field.mapBounds || [[ -6.2100, 106.8100], [-6.2110, 106.8110]];
            const lon_min = bounds[0][1];
            const lon_max = bounds[1][1];
            const lat_max = bounds[0][0];
            const lat_min = bounds[1][0];
            
            const geoCoords = geom.coordinates[0] as [number, number][];
            const pixelCoords = geoCoords.map(([lon, lat]) => {
              const px = ((lon - lon_min) / (lon_max - lon_min)) * imageWidth;
              const py = ((lat - lat_min) / (lat_max - lat_min)) * imageHeight;
              return [px, py];
            });
            geomToLoad = {
              ...geom,
              coordinates: [pixelCoords]
            };
          }
          
          const feature = geojsonFormat.readFeatures(
            {
              type: 'Feature',
              geometry: geomToLoad,
              properties: {},
            },
            imageUrl ? undefined : {
              dataProjection: 'EPSG:4326',
              featureProjection: 'EPSG:3857'
            }
          );
          vectorSource.current.addFeatures(Array.isArray(feature) ? feature : [feature]);
        } catch (e) {
          console.error("Failed to parse existing polygon in editor", e);
        }
      }

      // Load other existing sub-blocks
      if (existingSubBlocks) {
        existingSubBlocks.forEach((sb) => {
          if (sb.id === subBlockId) return;
          if (!sb.polygonGeom) return;
          
          try {
            const geom = typeof sb.polygonGeom === 'string'
              ? JSON.parse(sb.polygonGeom)
              : sb.polygonGeom;
              
            let geomToLoad = geom;
            if (imageUrl && geom.type === 'Polygon' && geom.coordinates && geom.coordinates[0]) {
              const bounds = field.mapBounds || [[ -6.2100, 106.8100], [-6.2110, 106.8110]];
              const lon_min = bounds[0][1];
              const lon_max = bounds[1][1];
              const lat_max = bounds[0][0];
              const lat_min = bounds[1][0];
              
              const geoCoords = geom.coordinates[0] as [number, number][];
              const pixelCoords = geoCoords.map(([lon, lat]) => {
                const px = ((lon - lon_min) / (lon_max - lon_min)) * imageWidth;
                const py = ((lat - lat_min) / (lat_max - lat_min)) * imageHeight;
                return [px, py];
              });
              geomToLoad = {
                ...geom,
                coordinates: [pixelCoords]
              };
            }
            
            const feature = geojsonFormat.readFeatures(
              {
                type: 'Feature',
                geometry: geomToLoad,
                properties: {
                  type: 'existing_sub_block',
                  id: sb.id,
                  name: sb.name
                }
              },
              imageUrl ? undefined : {
                dataProjection: 'EPSG:4326',
                featureProjection: 'EPSG:3857'
              }
            );
            vectorSource.current.addFeatures(feature);
          } catch (e) {
            console.error("Failed to parse existing sub-block geom in editor", e);
          }
        });
      }

      // Load other existing embankments
      if (existingEmbankments) {
        existingEmbankments.forEach((emb) => {
          if (emb.id === subBlockId) return;
          if (!emb.polygonGeom && !emb.polygon_geom) return;
          
          try {
            const polygonGeomRaw = emb.polygonGeom || emb.polygon_geom;
            const geom = typeof polygonGeomRaw === 'string'
              ? JSON.parse(polygonGeomRaw)
              : polygonGeomRaw;
              
            let geomToLoad = geom;
            if (imageUrl && geom.type === 'Polygon' && geom.coordinates && geom.coordinates[0]) {
              const bounds = field.mapBounds || [[ -6.2100, 106.8100], [-6.2110, 106.8110]];
              const lon_min = bounds[0][1];
              const lon_max = bounds[1][1];
              const lat_max = bounds[0][0];
              const lat_min = bounds[1][0];
              
              const geoCoords = geom.coordinates[0] as [number, number][];
              const pixelCoords = geoCoords.map(([lon, lat]) => {
                const px = ((lon - lon_min) / (lon_max - lon_min)) * imageWidth;
                const py = ((lat - lat_min) / (lat_max - lat_min)) * imageHeight;
                return [px, py];
              });
              geomToLoad = {
                ...geom,
                coordinates: [pixelCoords]
              };
            }
            
            const feature = geojsonFormat.readFeatures(
              {
                type: 'Feature',
                geometry: geomToLoad,
                properties: {
                  type: 'existing_embankment',
                  id: emb.id,
                  name: emb.name
                }
              },
              imageUrl ? undefined : {
                dataProjection: 'EPSG:4326',
                featureProjection: 'EPSG:3857'
              }
            );
            vectorSource.current.addFeatures(feature);
          } catch (e) {
            console.error("Failed to parse existing embankment geom in editor", e);
          }
        });
      }

      // Load existing device points
      devices.forEach((d: any) => {
        const currentSbId = d.subBlockId || d.sub_block_id;
        const isAssigned = (subBlockId && currentSbId === subBlockId) || selectedDeviceIds.includes(d.id);
        if (isAssigned) {
          let loc: { x: number; y: number } | null = null;
          
          if (d.coordinate) {
            try {
              const geom = typeof d.coordinate === 'string' ? JSON.parse(d.coordinate) : d.coordinate;
              if (geom && geom.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
                loc = { x: geom.coordinates[0], y: geom.coordinates[1] };
              }
            } catch (e) {
              console.error("Failed to parse device coordinate", e);
            }
          }
          
          if (!loc && d.notes) {
            try {
              const parsed = JSON.parse(d.notes);
              const l = parsed.location || (typeof parsed.x === 'number' ? parsed : null);
              if (l && typeof l.x === 'number' && typeof l.y === 'number') {
                loc = { x: l.x, y: l.y };
              }
            } catch (e) {
              // not JSON, ignore
            }
          }

          if (loc) {
            const coords = geoToMapCoords(loc.x, loc.y, !!imageUrl, imageWidth, imageHeight);
            const geojsonFormat = new GeoJSON();
            const feature = geojsonFormat.readFeatures({
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: coords
              },
              properties: {
                type: 'device_marker',
                deviceId: d.id,
                deviceCode: d.deviceCode
              }
            });
            vectorSource.current.addFeatures(feature);
          }
        }
      });

      if (!mapRef.current) return;

      const extent = [0, 0, imageWidth, imageHeight];
      const projection = new Projection({
        code: 'static-image',
        units: 'pixels',
        extent: extent
      });

      // Base Layers
      const layers: any[] = [];
      if (!imageUrl) {
        layers.push(new TileLayer({ source: new OSM() }));
      } else {
        layers.push(new ImageLayer({
          source: new ImageStatic({
            url: imageUrl,
            projection: projection,
            imageExtent: extent
          })
        }));
      }

      // Vector Layer for drawing
      layers.push(new VectorLayer({
        source: vectorSource.current,
        style: (feature) => {
          const geomType = feature.getGeometry()?.getType();
          const type = feature.get('type');

          if (geomType === 'Point') {
            if (type === 'device_marker') {
              return new Style({
                image: new CircleStyle({
                  radius: 6,
                  fill: new Fill({ color: '#3b82f6' }),
                  stroke: new Stroke({ color: '#fff', width: 2 })
                }),
                text: new Text({
                  text: feature.get('deviceCode') || 'Device',
                  font: 'bold 10px Inter, sans-serif',
                  offsetY: -12,
                  fill: new Fill({ color: '#1d4ed8' }),
                  stroke: new Stroke({ color: '#fff', width: 2 })
                })
              });
            }
          }

          if (type === 'existing_sub_block') {
            return new Style({
              fill: new Fill({ color: 'rgba(34, 197, 94, 0.08)' }),
              stroke: new Stroke({ color: 'rgba(22, 163, 74, 0.4)', width: 2, lineDash: [4, 4] }),
              text: new Text({
                text: feature.get('name'),
                font: 'italic bold 10px Inter, sans-serif',
                fill: new Fill({ color: 'rgba(21, 128, 61, 0.7)' }),
                stroke: new Stroke({ color: '#fff', width: 1.5 })
              })
            });
          }

          if (type === 'existing_embankment') {
            return new Style({
              fill: new Fill({ color: 'rgba(147, 51, 234, 0.08)' }),
              stroke: new Stroke({ color: 'rgba(147, 51, 234, 0.4)', width: 2, lineDash: [4, 4] }),
              text: new Text({
                text: feature.get('name'),
                font: 'italic bold 10px Inter, sans-serif',
                fill: new Fill({ color: 'rgba(107, 33, 168, 0.7)' }),
                stroke: new Stroke({ color: '#fff', width: 1.5 })
              })
            });
          }

          if (isEmbankment) {
            return new Style({
              fill: new Fill({ color: 'rgba(147, 51, 234, 0.3)' }),
              stroke: new Stroke({ color: '#9333ea', width: 3 })
            });
          }
          return new Style({
            fill: new Fill({ color: 'rgba(34, 197, 94, 0.3)' }),
            stroke: new Stroke({ color: '#16a34a', width: 3 })
          });
        }
      }));

      initialMap = new Map({
        target: mapRef.current,
        layers,
        view: imageUrl 
          ? new View({
              projection: projection,
              center: [imageWidth / 2, imageHeight / 2],
              zoom: 2,
              maxZoom: 8
            })
          : new View({
              center: fromLonLat([106.8456, -6.2088]),
              zoom: 18
            })
      });

      // Zoom to visual if exists
      if (imageUrl) {
          initialMap.getView().fit(extent, { padding: [50, 50, 50, 50] });
      }

      setMap(initialMap);
    };

    initMap();

    return () => {
      active = false;
      if (initialMap) {
        initialMap.setTarget(undefined);
      }
    };
  }, [field]);

  const toggleDrawing = () => {
    if (!map) return;
    
    // Clear any active point drawing interaction
    if (isDrawingPoint && drawInteraction.current) {
      map.removeInteraction(drawInteraction.current);
      setIsDrawingPoint(false);
      setActiveDeviceId('');
    }

    if (isDrawing) {
      if (drawInteraction.current) map.removeInteraction(drawInteraction.current);
      setIsDrawing(false);
    } else {
      // Clear previous polygons
      const features = vectorSource.current.getFeatures();
      features.forEach((f) => {
        if (f.getGeometry()?.getType() === 'Polygon') {
          vectorSource.current.removeFeature(f);
        }
      });

      const draw = new Draw({
        source: vectorSource.current,
        type: 'Polygon'
      });
      
      draw.on('drawend', () => {
        setIsDrawing(false);
        map.removeInteraction(draw);
      });
      
      map.addInteraction(draw);
      drawInteraction.current = draw;
      setIsDrawing(true);
    }
  };

  const startDrawingPoint = (deviceId: string, deviceCode: string) => {
    if (!map) return;
    
    // Remove any active drawing interaction
    if (drawInteraction.current) {
      map.removeInteraction(drawInteraction.current);
    }
    setIsDrawing(false);

    // Create Draw Point interaction
    const draw = new Draw({
      source: vectorSource.current,
      type: 'Point'
    });
    
    draw.on('drawend', async (event) => {
      const feature = event.feature;
      const coords = (feature.getGeometry() as any).getCoordinates();

      const currentPolygonFeature = vectorSource.current.getFeatures().find(
        f => f.getGeometry()?.getType() === 'Polygon' && 
             f.get('type') !== 'existing_sub_block' && 
             f.get('type') !== 'existing_embankment'
      );

      let inside = false;
      if (currentPolygonFeature) {
        inside = (currentPolygonFeature.getGeometry() as any).intersectsCoordinate(coords);
      }

      if (!inside) {
        await dialog.alert('Perangkat harus ditempatkan di dalam polygon sub-block yang sedang dibuat/diedit!');
        vectorSource.current.removeFeature(feature);
        setIsDrawingPoint(false);
        setActiveDeviceId('');
        map.removeInteraction(draw);
        return;
      }

      feature.set('type', 'device_marker');
      feature.set('deviceId', deviceId);
      feature.set('deviceCode', deviceCode);
      
      // Remove previous point feature for this device if any
      const existingFeatures = vectorSource.current.getFeatures();
      existingFeatures.forEach((f) => {
        if (f.get('deviceId') === deviceId && f !== feature) {
          vectorSource.current.removeFeature(f);
        }
      });
      
      // Automatically add to assigned list if not already
      setLocalSelectedDeviceIds(prev => {
        if (!prev.includes(deviceId)) {
          return [...prev, deviceId];
        }
        return prev;
      });
      
      setIsDrawingPoint(false);
      setActiveDeviceId('');
      map.removeInteraction(draw);
    });
    
    map.addInteraction(draw);
    drawInteraction.current = draw;
    setIsDrawingPoint(true);
  };

  const handleSave = async () => {
    const features = vectorSource.current.getFeatures();
    const polygonFeature = features.find(f => f.getGeometry()?.getType() === 'Polygon');
    if (!polygonFeature) {
      await dialog.alert('Silakan gambar poligon terlebih dahulu');
      return;
    }
    
    const format = new GeoJSON();
    let geojson: any;
    if (!field.mapVisualUrl) {
      geojson = format.writeGeometryObject(polygonFeature.getGeometry()!, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857'
      });
    } else {
      const geom = polygonFeature.getGeometry() as any;
      const rawCoords = (geom.getCoordinates ? geom.getCoordinates()[0] : []) as [number, number][];
      const convertedCoords = rawCoords.map((coord) => mapToGeoCoords(coord, true, mapWidth, mapHeight));
      geojson = {
        type: 'Polygon',
        coordinates: [convertedCoords]
      };
    }
    
    // Find all device markers
    const deviceMarkers = features.filter(f => f.get('type') === 'device_marker');
    
    // Map deviceId -> geographic coordinates
    const deviceCoords: Record<string, { x: number; y: number }> = {};
    deviceMarkers.forEach((m) => {
      const deviceId = m.get('deviceId');
      const pointGeom = m.getGeometry();
      if (deviceId && pointGeom) {
        const coords = (pointGeom as any).getCoordinates();
        // Convert map coords to geographic coords
        const [lon, lat] = mapToGeoCoords(coords, !!field.mapVisualUrl, mapWidth, mapHeight);
        deviceCoords[deviceId] = { x: lon, y: lat };
      }
    });
    
    onSave(geojson, deviceCoords, localSelectedDeviceIds);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      <div className="h-14 border-b flex items-center justify-between px-4 bg-card shadow-sm">
        <div className="flex items-center gap-4">
          <h2 className="font-bold text-foreground">Drawing Sub-block Polygon & Devices</h2>
          <div className="h-4 w-[1px] bg-border"></div>
          <p className="text-xs text-muted-foreground italic">Gunakan mouse klik kiri untuk menggambar titik, double klik untuk menutup poligon.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4 mr-2" /> Batal
          </Button>
          <Button size="sm" onClick={handleSave} className="bg-green-600 hover:bg-green-700 text-white">
            <Save className="h-4 w-4 mr-2" /> Simpan Poligon & Device
          </Button>
        </div>
      </div>
      
      <div className="flex-1 relative">
        <div ref={mapRef} className="w-full h-full" />
        
        <div className="absolute top-4 left-4 flex flex-col gap-2">
           <Button 
            variant={isDrawing ? "default" : "secondary"} 
            className="shadow-md h-12 w-12 p-0 rounded-full"
            onClick={toggleDrawing}
            title="Gambar Poligon Petak"
           >
             {isDrawing ? <MousePointer2 className="h-5 w-5" /> : <BoxSelect className="h-5 w-5" />}
           </Button>
           <Button 
            variant="secondary" 
            className="shadow-md h-12 w-12 p-0 rounded-full text-destructive"
            onClick={() => {
              const features = vectorSource.current.getFeatures();
              features.forEach((f) => {
                if (f.getGeometry()?.getType() === 'Polygon') {
                  vectorSource.current.removeFeature(f);
                }
              });
            }}
            title="Hapus Poligon"
           >
             <Trash2 className="h-5 w-5" />
           </Button>
        </div>

        {/* Floating panel for Device Assignment and Point mapping */}
        <div className="absolute top-4 right-4 z-20 w-80 bg-background/95 border shadow-lg rounded-xl p-4 space-y-4 max-h-[80vh] overflow-y-auto">
          <h3 className="font-bold text-sm flex items-center gap-1.5 border-b pb-2 text-foreground">
            <Cpu className="h-4 w-4 text-primary" /> Alokasi Perangkat
          </h3>
          
          <p className="text-[11px] text-muted-foreground leading-normal">
            Pilih device, aktifkan mode penempatan, lalu klik di dalam poligon sub-block untuk menempatkan alat.
          </p>

          {devices.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2 text-center bg-muted/20 rounded-lg">
              Tidak ada device terdaftar di lahan ini.
            </p>
          ) : (
            <div className="space-y-2">
              {devices.map((d) => {
                const currentSbId = d.subBlockId || d.sub_block_id;
                const isAssignedToOther = currentSbId && currentSbId !== subBlockId;
                const isAssignedHere = currentSbId && currentSbId === subBlockId;
                const isChecked = localSelectedDeviceIds.includes(d.id);
                const hasPoint = vectorSource.current.getFeatures().some(f => f.get('type') === 'device_marker' && f.get('deviceId') === d.id);
                
                return (
                  <div key={d.id} className="p-2 border rounded-lg bg-background flex flex-col gap-2 shadow-sm">
                    <div className="flex items-start gap-2">
                      <input 
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setLocalSelectedDeviceIds(prev => [...prev, d.id]);
                          } else {
                            setLocalSelectedDeviceIds(prev => prev.filter(id => id !== d.id));
                            // Remove point feature from map if unchecked
                            const existingFeatures = vectorSource.current.getFeatures();
                            existingFeatures.forEach((f) => {
                              if (f.get('deviceId') === d.id) {
                                vectorSource.current.removeFeature(f);
                              }
                            });
                          }
                        }}
                        className="mt-0.5 rounded border-gray-300 text-primary focus:ring-primary h-3.5 w-3.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-mono font-bold truncate text-foreground">{d.deviceCode}</p>
                          <span className="capitalize text-[10px] text-muted-foreground shrink-0">{d.deviceType.replace('_', ' ')}</span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-[10px]">
                          {isAssignedHere ? (
                            <span className="text-green-600 font-semibold">Terpasang di petak ini</span>
                          ) : isAssignedToOther ? (
                            <span className="text-amber-600 font-semibold truncate">
                              Terpasang di petak lain {isChecked && " (Akan dipindahkan)"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Tersedia</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {isChecked && (
                      <div className="flex items-center justify-between gap-2 border-t pt-2 mt-1">
                        <span className="text-[10px] font-medium flex items-center gap-1">
                          {hasPoint ? (
                            <span className="text-green-600 font-semibold flex items-center gap-0.5">
                              <Check className="h-3 w-3" /> Terpetakan
                            </span>
                          ) : (
                            <span className="text-amber-500">Belum ditempatkan</span>
                          )}
                        </span>
                        <Button 
                          type="button"
                          size="sm"
                          variant={isDrawingPoint && activeDeviceId === d.id ? "default" : "outline"}
                          className="h-7 text-[10px] px-2"
                          onClick={() => {
                            if (isDrawingPoint && activeDeviceId === d.id) {
                              if (drawInteraction.current) map?.removeInteraction(drawInteraction.current);
                              setIsDrawingPoint(false);
                              setActiveDeviceId('');
                            } else {
                              setActiveDeviceId(d.id);
                              startDrawingPoint(d.id, d.deviceCode);
                            }
                          }}
                        >
                          {isDrawingPoint && activeDeviceId === d.id ? "Membidik..." : hasPoint ? "Pindah Posisi" : "Tentukan Titik"}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {!field.mapVisualUrl && (
          <div className="absolute bottom-4 left-20 pointer-events-none flex items-center">
            <div className="bg-amber-500/10 border border-amber-500/20 backdrop-blur-md p-3 rounded-xl text-amber-600 max-w-sm text-center">
              <p className="text-xs font-bold">Peringatan: Peta Lahan Belum Tersedia</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
