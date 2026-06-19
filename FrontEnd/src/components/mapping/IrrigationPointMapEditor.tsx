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
import { Style, Circle as CircleStyle, Fill, Stroke, Text } from 'ol/style';
import { fromLonLat } from 'ol/proj';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import Projection from 'ol/proj/Projection';
import { Button } from '@/components/ui/button';
import { X, Save, Trash2, MapPin } from 'lucide-react';
import { getCachedMapImageUrl } from '@/lib/mapCache';

interface IrrigationPointMapEditorProps {
  field: {
    id: string;
    name: string;
    mapVisualUrl: string | null;
    mapBounds: number[][] | null;
  };
  existingPoint?: any;
  pointType: 'source' | 'drain';
  onSave: (coordinates: [number, number], imageWidth: number, imageHeight: number) => void;
  onClose: () => void;
}

export function IrrigationPointMapEditor({
  field,
  existingPoint,
  pointType,
  onSave,
  onClose
}: IrrigationPointMapEditorProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const vectorSource = useRef(new VectorSource());
  const drawInteraction = useRef<Draw | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
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

      // Load existing point if exists
      if (existingPoint) {
        try {
          const geom = typeof existingPoint === 'string'
            ? JSON.parse(existingPoint)
            : existingPoint;
          
          let coordsToLoad = geom.coordinates;
          if (imageUrl && geom.type === 'Point') {
            coordsToLoad = geoToMapCoords(geom.coordinates[0], geom.coordinates[1], true, imageWidth, imageHeight);
          } else if (!imageUrl && geom.type === 'Point') {
            coordsToLoad = fromLonLat(geom.coordinates);
          }

          const geojsonFormat = new GeoJSON();
          const feature = geojsonFormat.readFeatures({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: coordsToLoad
            },
            properties: {}
          });
          vectorSource.current.clear();
          vectorSource.current.addFeatures(Array.isArray(feature) ? feature : [feature]);
        } catch (e) {
          console.error("Failed to parse existing point in editor", e);
        }
      }

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
        style: () => {
          return new Style({
            image: new CircleStyle({
              radius: 8,
              fill: new Fill({ color: pointType === 'source' ? '#22c55e' : '#ef4444' }),
              stroke: new Stroke({ color: '#fff', width: 2 })
            }),
            text: new Text({
              text: pointType === 'source' ? 'SUMBER' : 'SALURAN BUANG',
              font: 'bold 10px Inter, sans-serif',
              offsetY: -14,
              fill: new Fill({ color: pointType === 'source' ? '#15803d' : '#b91c1c' }),
              stroke: new Stroke({ color: '#fff', width: 2 })
            })
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
  }, [field, pointType]);

  const toggleDrawing = () => {
    if (!map) return;

    if (isDrawing) {
      if (drawInteraction.current) map.removeInteraction(drawInteraction.current);
      setIsDrawing(false);
    } else {
      // Clear previous features (only 1 point allowed)
      vectorSource.current.clear();

      const draw = new Draw({
        source: vectorSource.current,
        type: 'Point'
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

  const handleSave = () => {
    const features = vectorSource.current.getFeatures();
    const pointFeature = features.find(f => f.getGeometry()?.getType() === 'Point');
    if (!pointFeature) return alert('Silakan tentukan titik di peta terlebih dahulu');

    const coords = (pointFeature.getGeometry() as any).getCoordinates();
    onSave(coords, mapWidth, mapHeight);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      <div className="h-14 border-b flex items-center justify-between px-4 bg-card shadow-sm">
        <div className="flex items-center gap-4">
          <h2 className="font-bold text-foreground">
            Tentukan Lokasi {pointType === 'source' ? 'Sumber Air' : 'Saluran Buang'}
          </h2>
          <div className="h-4 w-[1px] bg-border"></div>
          <p className="text-xs text-muted-foreground italic">
            Klik tombol Pin, lalu klik sekali di peta untuk menempatkan titik.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4 mr-2" /> Batal
          </Button>
          <Button size="sm" onClick={handleSave} className="bg-green-600 hover:bg-green-700 text-white">
            <Save className="h-4 w-4 mr-2" /> Simpan Posisi Titik
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
            title="Tentukan Titik Baru"
          >
            <MapPin className="h-5 w-5" />
          </Button>
          <Button
            variant="secondary"
            className="shadow-md h-12 w-12 p-0 rounded-full text-destructive"
            onClick={() => vectorSource.current.clear()}
            title="Hapus Titik"
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
