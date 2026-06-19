import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useRef, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import GeoJSON from 'ol/format/GeoJSON';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import { transformExtent } from 'ol/proj';
import { apiClient } from '@/api/client';
import { getCachedMapImageUrl } from '@/lib/mapCache';

interface EntityDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  data: any;
}

export function EntityDetailModal({ isOpen, onClose, title, data }: EntityDetailModalProps) {
  const miniMapRef = useRef<HTMLDivElement>(null);
  const [fieldData, setFieldData] = useState<any>(null);

  useEffect(() => {
    if (isOpen && data?.fieldId) {
      apiClient.get(`/fields/${data.fieldId}`)
        .then(res => setFieldData(res.data.data))
        .catch(err => console.error("Failed to load field data in detail modal", err));
    }
  }, [isOpen, data?.fieldId]);

  useEffect(() => {
    if (!isOpen || !data?.polygonGeom || !miniMapRef.current) return;

    let active = true;
    let olMap: Map | null = null;
    const mapElement = miniMapRef.current;

    const initMap = async () => {
      let imageUrl: string | null = null;
      if (fieldData?.mapVisualUrl) {
        imageUrl = await getCachedMapImageUrl(fieldData.mapVisualUrl, fieldData.name);
      }

      if (!active) return;

      try {
        const geom = typeof data.polygonGeom === 'string'
          ? JSON.parse(data.polygonGeom)
          : data.polygonGeom;

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

        const vectorSource = new VectorSource({
          features: Array.isArray(feature) ? feature : [feature],
        });

        const layers: any[] = [];
        if (imageUrl) {
          const bounds = fieldData.mapBounds || [[ -6.2100, 106.8100], [-6.2110, 106.8110]];
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
        } else {
          layers.push(new TileLayer({
            source: new OSM(),
          }));
        }

        layers.push(new VectorLayer({
          source: vectorSource,
          style: new Style({
            stroke: new Stroke({
              color: '#16a34a',
              width: 3,
            }),
            fill: new Fill({
              color: 'rgba(34, 197, 94, 0.4)',
            }),
          }),
        }));

        olMap = new Map({
          target: mapElement,
          layers: layers,
          view: new View({
            center: [0, 0],
            zoom: 16,
          }),
        });

        const extent = vectorSource.getExtent();
        if (extent && extent[0] !== Infinity) {
          olMap.getView().fit(extent, { padding: [20, 20, 20, 20] });
        }
      } catch (e) {
        console.error("Failed to render mini map in EntityDetailModal", e);
      }
    };

    initMap();

    return () => {
      active = false;
      if (olMap) olMap.setTarget(undefined);
    };
  }, [isOpen, data, fieldData]);

  if (!isOpen || !data) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
      <div className="w-full max-w-2xl rounded-xl bg-card text-card-foreground shadow-lg border max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-4">
            {Object.entries(data)
              .filter(([key]) => key !== 'polygonGeom' && key !== 'centroid')
              .map(([key, value]) => (
                <div key={key} className="border-b pb-2">
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">{key.replace(/([A-Z])/g, ' $1')}</p>
                  <div className="text-sm font-medium">
                    {Array.isArray(value) ? (
                      value.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {value.map((item: any, i) => (
                            <span key={i} className="inline-block bg-muted px-2 py-0.5 rounded text-xs font-mono">
                              {typeof item === 'object' && item !== null ? (item.deviceCode || JSON.stringify(item)) : String(item)}
                            </span>
                          ))}
                        </div>
                      ) : '-'
                    ) : typeof value === 'object' ? (
                      value ? 'Object/Array' : 'null'
                    ) : (
                      String(value ?? '-')
                    )}
                  </div>
                </div>
              ))}
          </div>

          {data.polygonGeom && (
            <div className="mt-6 border rounded-xl overflow-hidden shadow-sm relative">
              <div className="bg-muted px-4 py-2 text-xs font-medium border-b flex items-center gap-2">
                <span>Pratinjau Batas Petak (Polygon)</span>
              </div>
              <div className="h-64 w-full bg-slate-100" ref={miniMapRef} />
            </div>
          )}
        </div>

        <div className="p-4 border-t flex justify-end">
          <Button onClick={onClose}>Tutup</Button>
        </div>
      </div>
    </div>
  );
}
