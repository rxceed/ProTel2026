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
import { Style, Fill, Stroke } from 'ol/style';
import { transformExtent, fromLonLat } from 'ol/proj';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import { Button } from '@/components/ui/button';
import { X, Save, Trash2, MousePointer2, BoxSelect } from 'lucide-react';
import { getCachedMapImageUrl } from '@/lib/mapCache';

interface SubBlockMapEditorProps {
  field: {
    id: string;
    mapVisualUrl: string | null;
    mapBounds: number[][] | null;
  };
  existingPolygon?: any;
  onSave: (geojson: any) => void;
  onClose: () => void;
}

export function SubBlockMapEditor({ field, existingPolygon, onSave, onClose }: SubBlockMapEditorProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const vectorSource = useRef(new VectorSource());
  const drawInteraction = useRef<Draw | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    if (!mapRef.current) return;

    let active = true;
    let initialMap: Map | null = null;

    const initMap = async () => {
      if (existingPolygon) {
        try {
          const geom = typeof existingPolygon === 'string' 
            ? JSON.parse(existingPolygon) 
            : existingPolygon;
            
          const geojsonFormat = new GeoJSON();
          const feature = geojsonFormat.readFeatures(
            {
              type: 'Feature',
              geometry: geom,
              properties: {},
            },
            {
              dataProjection: 'EPSG:4326',
              featureProjection: 'EPSG:3857',
            }
          );
          vectorSource.current.clear();
          vectorSource.current.addFeatures(Array.isArray(feature) ? feature : [feature]);
        } catch (e) {
          console.error("Failed to parse existing polygon in editor", e);
        }
      }
      if (!mapRef.current) return;

      let imageUrl: string | null = null;
      if (field.mapVisualUrl) {
        imageUrl = await getCachedMapImageUrl(field.mapVisualUrl);
      }

      if (!active) return;

      // Base Layers
      const layers: any[] = [];
      if (!imageUrl) {
        layers.push(new TileLayer({ source: new OSM() }));
      }

      // Image Layer
      if (imageUrl) {
        const bounds = field.mapBounds || [[ -6.2100, 106.8100], [-6.2110, 106.8110]];
        const extent = transformExtent(
          [bounds[0][1], bounds[1][0], bounds[1][1], bounds[0][0]],
          'EPSG:4326',
          'EPSG:3857'
        );
        layers.push(new ImageLayer({
          source: new ImageStatic({
            url: imageUrl,
            imageExtent: extent
          })
        }));
      }

      // Vector Layer for drawing
      layers.push(new VectorLayer({
        source: vectorSource.current,
        style: new Style({
          fill: new Fill({ color: 'rgba(34, 197, 94, 0.3)' }),
          stroke: new Stroke({ color: '#16a34a', width: 3 })
        })
      }));

      initialMap = new Map({
        target: mapRef.current,
        layers,
        view: new View({
          center: fromLonLat([106.8456, -6.2088]),
          zoom: 18
        })
      });

      // Zoom to visual if exists
      if (imageUrl) {
          const bounds = field.mapBounds || [[ -6.2100, 106.8100], [-6.2110, 106.8110]];
          const extent = transformExtent(
              [bounds[0][1], bounds[1][0], bounds[1][1], bounds[0][0]],
              'EPSG:4326',
              'EPSG:3857'
          );
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
    
    if (isDrawing) {
      if (drawInteraction.current) map.removeInteraction(drawInteraction.current);
      setIsDrawing(false);
    } else {
      vectorSource.current.clear(); // Only allow drawing ONE sub-block at a time for this modal
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

  const handleSave = () => {
    const features = vectorSource.current.getFeatures();
    if (features.length === 0) return alert('Silakan gambar poligon terlebih dahulu');
    
    const format = new GeoJSON();
    const geojson = format.writeGeometry(features[0].getGeometry()!, {
        featureProjection: 'EPSG:3857',
        dataProjection: 'EPSG:4326'
    });
    
    onSave(geojson);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      <div className="h-14 border-b flex items-center justify-between px-4 bg-card shadow-sm">
        <div className="flex items-center gap-4">
          <h2 className="font-bold">Drawing Sub-block Polygon</h2>
          <div className="h-4 w-[1px] bg-border"></div>
          <p className="text-xs text-muted-foreground italic">Gunakan mouse klik kiri untuk menggambar titik, double klik untuk menutup poligon.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4 mr-2" /> Batal</Button>
          <Button size="sm" onClick={handleSave} className="bg-green-600 hover:bg-green-700 text-white"><Save className="h-4 w-4 mr-2" /> Simpan Poligon</Button>
        </div>
      </div>
      
      <div className="flex-1 relative">
        <div ref={mapRef} className="w-full h-full" />
        
        <div className="absolute top-4 left-4 flex flex-col gap-2">
           <Button 
            variant={isDrawing ? "default" : "secondary"} 
            className="shadow-md h-12 w-12 p-0 rounded-full"
            onClick={toggleDrawing}
           >
             {isDrawing ? <MousePointer2 className="h-5 w-5" /> : <BoxSelect className="h-5 w-5" />}
           </Button>
           <Button 
            variant="secondary" 
            className="shadow-md h-12 w-12 p-0 rounded-full text-destructive"
            onClick={() => vectorSource.current.clear()}
           >
             <Trash2 className="h-5 w-5" />
           </Button>
        </div>
        
        {!field.mapVisualUrl && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="bg-amber-500/10 border border-amber-500/20 backdrop-blur-md p-4 rounded-xl text-amber-600 max-w-sm text-center">
              <p className="font-bold">Peringatan: Drone Imagery Belum Tersedia</p>
              <p className="text-xs">Disarankan untuk mengupload visual citra drone terlebih dahulu pada Master Lahan agar penggambaran poligon lebih presisi.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
