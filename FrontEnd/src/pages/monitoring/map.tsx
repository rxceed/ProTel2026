import { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Fill, Stroke, Text } from 'ol/style';
import { fromLonLat, transformExtent } from 'ol/proj';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiClient, gisProcClient } from '@/api/client';
import axios from 'axios';
import { getCachedMapImageUrl } from '@/lib/mapCache';
import { MapPin, Loader2, Info, X, Droplets, Battery, Thermometer, Layers, AlertTriangle, CheckCircle2, Activity, Route, TrendingUp, GitMerge, ArrowRight } from 'lucide-react';

interface Field {
  id: string;
  name: string;
  mapVisualUrl?: string | null;
  mapBounds?: number[][] | null;
}

interface IrrigationRoute {
  routeName: string | null;
  fromSubBlock: string;
  toSubBlock: string;
  weightScore: number; // 0–100
  estimatedDistance: number;
  notes?: string | null;
}

interface CropCycle {
  id: string;
  fieldId: string;
  subBlockId: string;
  bucketCode: string;
  varietyName: string;
  plantingDate: string;
  expectedHarvestDate: string | null;
  actualHarvestDate: string | null;
  currentPhaseCode: string;
  status: string;
}

interface RuleProfile {
  id: string;
  name: string;
  description: string;
  bucketCode: string;
  phaseCode: string;
  awdLowerThresholdCm: number;
  awdUpperTargetCm: number;
  droughtAlertCm: number | null;
  rainDelayMm: number;
  priorityWeight: number;
  targetConfidence: string;
  isDefault: boolean;
  isActive: boolean;
}

interface SubBlock {
  id: string;
  name: string;
  areaM2: number | null;
  code: string | null;
  elevationM: string | null;
  soilType: string | null;
  isActive: boolean;
  polygonGeom: string | null; // Stored as GeoJSON string in DB
  centroid: string | null;    // WKT POINT from PostGIS, e.g. "POINT(lng lat)"
}

export function MapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  
  const [selectedSubBlock, setSelectedSubBlock] = useState<{ id: string; name: string } | null>(null);
  const [telemetryHistory, setTelemetryHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [fieldHistory, setFieldHistory] = useState<any[]>([]);
  const [loadingFieldHistory, setLoadingFieldHistory] = useState(false);
  const [activeTab, setActiveTab] = useState<'water' | 'temp' | 'humidity'>('water');

  const [subBlocks, setSubBlocks] = useState<SubBlock[]>([]);
  const [loadingSubBlocks, setLoadingSubBlocks] = useState(false);

  const [irrigationRoutes, setIrrigationRoutes] = useState<IrrigationRoute[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);

  // subBlockConnections[sourceId] = [targetId, ...] — directed adjacency list (one-way edges)
  const [subBlockConnections, setSubBlockConnections] = useState<Record<string, string[]>>({});

  const [ruleProfiles, setRuleProfiles] = useState<RuleProfile[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [activeCropCycle, setActiveCropCycle] = useState<CropCycle | null>(null);
  const [loadingCycle, setLoadingCycle] = useState(false);
  const [resolvedRuleProfile, setResolvedRuleProfile] = useState<RuleProfile | null>(null);

  const vectorSource = useRef(new VectorSource());
  const imageLayer = useRef(new ImageLayer());
  const osmLayer = useRef(new TileLayer({ source: new OSM() }));

  // Fetch Field-wide history
  useEffect(() => {
    if (!selectedFieldId) return;
    const fetchFieldHistory = async () => {
      try {
        setLoadingFieldHistory(true);
        const res = await apiClient.get(`/telemetry/fields/${selectedFieldId}/history`);
        setFieldHistory(res.data.data);
      } catch (err) {
        console.error("Failed to fetch field telemetry history", err);
      } finally {
        setLoadingFieldHistory(false);
      }
    };
    fetchFieldHistory();
  }, [selectedFieldId]);

  // Listen to Map Clicks
  useEffect(() => {
    if (!map) return;
    const clickHandler = (evt: any) => {
      const feature = map.forEachFeatureAtPixel(evt.pixel, (feat) => feat);
      if (feature) {
        setSelectedSubBlock({
          id: feature.get('id'),
          name: feature.get('name')
        });
      }
    };
    map.on('click', clickHandler);
    return () => map.un('click', clickHandler);
  }, [map]);

  // Fetch Telemetry History on Selection
  useEffect(() => {
    if (!selectedSubBlock) return;
    const fetchHistory = async () => {
      try {
        setLoadingHistory(true);
        const res = await apiClient.get(`/telemetry/sub-blocks/${selectedSubBlock.id}/history`);
        setTelemetryHistory(res.data.data);
      } catch (err) {
        console.error("Failed to fetch telemetry history", err);
      } finally {
        setLoadingHistory(false);
      }
    };
    fetchHistory();
  }, [selectedSubBlock]);

  // 1. Initialize Map
  useEffect(() => {
    if (!mapRef.current) return;

    const initialMap = new Map({
      target: mapRef.current,
      layers: [
        osmLayer.current,
        imageLayer.current,
        new VectorLayer({
          source: vectorSource.current,
          style: (feature) => {
            return new Style({
              stroke: new Stroke({
                color: '#16a34a',
                width: 2,
              }),
              fill: new Fill({
                color: 'rgba(34, 197, 94, 0.2)',
              }),
              text: new Text({
                text: feature.get('name'),
                font: 'bold 12px Inter, sans-serif',
                fill: new Fill({ color: '#166534' }),
                stroke: new Stroke({ color: '#fff', width: 2 }),
              }),
            });
          },
        }),
      ],
      view: new View({
        center: fromLonLat([106.8456, -6.2088]), // Default center (Jakarta area approx)
        zoom: 12,
      }),
    });

    setMap(initialMap);

    return () => initialMap.setTarget(undefined);
  }, []);

  // 2. Fetch Fields
  useEffect(() => {
    const fetchFields = async () => {
      try {
        const response = await apiClient.get('/fields');
        const data = response.data.data;
        setFields(data);
        if (data.length > 0) {
          setSelectedFieldId(data[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch fields', err);
      }
    };
    fetchFields();
  }, []);

  // Fetch and save map visual headers to localStorage when mapVisualUrl changes
  useEffect(() => {
    const field = fields.find(f => f.id === selectedFieldId);
    if (!field || !field.mapVisualUrl) return;

    const getHeaderValue = (headers: any, targetKey: string) => {
      if (!headers) return undefined;
      if (typeof headers.get === 'function') {
        const val = headers.get(targetKey);
        if (val !== undefined && val !== null) return val;
      }
      const lowerTarget = targetKey.toLowerCase();
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lowerTarget) {
          return headers[key];
        }
      }
      return undefined;
    };

    const saveHeaders = (headers: any, fieldName: string) => {
      if (!headers) {
        console.warn("[MonitoringMap] No headers provided to saveHeaders");
        return;
      }
      console.log("[MonitoringMap] saveHeaders received headers:", headers);
      const targetHeaders = [
        'x-bounds',
        'x-crs',
        'x-height',
        'x-original-height',
        'x-original-width',
        'x-transform',
        'x-width'
      ];
      
      const savedData: Record<string, string> = { fieldName };
      
      targetHeaders.forEach(header => {
        const val = getHeaderValue(headers, header);
        console.log(`[MonitoringMap] Header key: ${header}, found value: ${val}`);
        if (val !== undefined && val !== null) {
          savedData[header] = String(val);
          localStorage.setItem(`${fieldName}_${header}`, String(val));
        }
      });
      
      if (Object.keys(savedData).length > 1) {
        console.log("[MonitoringMap] Saving map headers to localStorage for field:", fieldName, savedData);
        localStorage.setItem(`map_headers_${fieldName}`, JSON.stringify(savedData));
        localStorage.setItem(fieldName, JSON.stringify(savedData));
      } else {
        console.warn("[MonitoringMap] No target headers found in response headers. Not saving to localStorage.");
      }
    };

    const fetchHeaders = async (url: string, fieldName: string) => {
      console.log("[MonitoringMap] Requesting map URL:", url, "fieldName:", fieldName);
      try {
        const res = await axios.get(url);
        console.log("[MonitoringMap] Request succeeded. Status:", res.status, "Headers:", res.headers);
        saveHeaders(res.headers, fieldName);
      } catch (err) {
        console.error("[MonitoringMap] Request failed:", err);
      }
    };

    fetchHeaders(field.mapVisualUrl, field.name);
  }, [selectedFieldId, fields]);

  // Fetch rule profiles (global, fetched once)
  useEffect(() => {
    const fetchRuleProfiles = async () => {
      try {
        setLoadingRules(true);
        const response = await apiClient.get('/rule-profiles');
        const data: RuleProfile[] = response.data.data;
        setRuleProfiles(data);
      } catch (err) {
        console.error('Failed to fetch rule profiles', err);
      } finally {
        setLoadingRules(false);
      }
    };
    fetchRuleProfiles();
  }, []);

  // Fetch active crop cycle for selected field, then resolve matching rule profile
  useEffect(() => {
    if (!selectedFieldId || subBlocks.length === 0) {
      setActiveCropCycle(null);
      setResolvedRuleProfile(null);
      return;
    }

    const fetchActiveCropCycle = async () => {
      try {
        setLoadingCycle(true);
        let foundCycle: CropCycle | null = null;

        // Iterate sub-blocks to find the first one with an active crop cycle
        for (const sb of subBlocks) {
          const response = await apiClient.get(`/sub-blocks/${sb.id}/crop-cycles`);
          const cycles: CropCycle[] = response.data.data;
          const active = cycles.find(c => c.status === 'active');
          if (active) {
            foundCycle = active;
            break;
          }
        }

        setActiveCropCycle(foundCycle);
      } catch (err) {
        console.error('Failed to fetch active crop cycle', err);
        setActiveCropCycle(null);
      } finally {
        setLoadingCycle(false);
      }
    };

    fetchActiveCropCycle();
  }, [selectedFieldId, subBlocks]);

  // Resolve matching rule profile whenever activeCropCycle or ruleProfiles change
  useEffect(() => {
    if (!activeCropCycle || ruleProfiles.length === 0) {
      setResolvedRuleProfile(null);
      return;
    }

    const matched = ruleProfiles.find(
      r => r.bucketCode === activeCropCycle.bucketCode &&
           r.phaseCode === activeCropCycle.currentPhaseCode
    );
    setResolvedRuleProfile(matched ?? null);
  }, [activeCropCycle, ruleProfiles]);

  // 3b. Fetch Sub-blocks data for the irrigation management card
  useEffect(() => {
    if (!selectedFieldId) return;
    const fetchSubBlocksData = async () => {
      try {
        setLoadingSubBlocks(true);
        const response = await apiClient.get(`/fields/${selectedFieldId}/sub-blocks`);
        setSubBlocks(response.data.data);
      } catch (err) {
        console.error('Failed to fetch sub-blocks data', err);
      } finally {
        setLoadingSubBlocks(false);
      }
    };
    fetchSubBlocksData();
  }, [selectedFieldId]);

  // Reset connections whenever the sub-block list changes (e.g. different field selected)
  useEffect(() => {
    setSubBlockConnections({});
  }, [subBlocks]);

  // 3c. Fetch irrigation route recommendations
  useEffect(() => {
    if (!selectedFieldId || subBlocks.length === 0) return;
    const fetchIrrigationRoutes = async () => {
      try {
        setLoadingRoutes(true);

        // Fetch latest state (waterLevelCm) for each sub-block in parallel
        const stateResults = await Promise.all(
          subBlocks.map(sb =>
            apiClient
              .get(`/telemetry/sub-blocks/${sb.id}/states/latest`)
              .then(r => ({ subBlockId: sb.id, waterLevelCm: r.data.data?.waterLevelCm ?? null }))
              .catch(() => ({ subBlockId: sb.id, waterLevelCm: null }))
          )
        );
        const stateMap: Record<string, string | null> = {};
        stateResults.forEach(s => { stateMap[s.subBlockId] = s.waterLevelCm; });

        const optimalHeight = resolvedRuleProfile?.awdUpperTargetCm ?? null;

        const nodes = subBlocks.map(sb => ({
          area:           sb.areaM2,
          water_height:   stateMap[sb.id] != null ? parseFloat(stateMap[sb.id] as string) : null,
          optimal_height: optimalHeight,
          elevation:      sb.elevationM !== null ? parseFloat(sb.elevationM as string) : null,
        }));

        // Build directed edge list from the connection settings, including centroids
        const subBlockMap = new globalThis.Map(subBlocks.map(sb => [sb.id, sb]));
        const edges = Object.entries(subBlockConnections).flatMap(
          ([fromId, toIds]) => toIds.map(toId => ({
            from:          fromId,
            to:            toId,
            from_centroid: subBlockMap.get(fromId)?.centroid ?? null,
            to_centroid:   subBlockMap.get(toId)?.centroid ?? null,
          }))
        );

        //const response = await gisProcClient.post('/api/floydwarshall/reconstruct', { nodes: payload, edges });
        //setIrrigationRoutes(response.data);
        console.debug('[fetchIrrigationRoutes] payload:', nodes, 'edges:', edges);
      } catch (err) {
        console.error('Failed to fetch irrigation routes', err);
      } finally {
        setLoadingRoutes(false);
      }
    };
    fetchIrrigationRoutes();
  }, [selectedFieldId, subBlocks, resolvedRuleProfile, subBlockConnections]);

  // 3. Fetch & Render Sub-blocks for Selected Field
  useEffect(() => {
    if (!selectedFieldId || !map) return;

    const fetchSubBlocks = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get(`/fields/${selectedFieldId}/sub-blocks`);
        const subBlocks: SubBlock[] = response.data.data;

        vectorSource.current.clear();

        const geojsonFormat = new GeoJSON();
        const features: any[] = [];

        subBlocks.forEach((sb) => {
          if (!sb.polygonGeom) return;
          try {
            // Check if it's already an object or a string
            const geom = typeof sb.polygonGeom === 'string' 
              ? JSON.parse(sb.polygonGeom) 
              : sb.polygonGeom;
            
            if (!geom || !geom.coordinates || geom.coordinates.length === 0) return;
            
            const feature = geojsonFormat.readFeature(
              {
                type: 'Feature',
                geometry: geom,
                properties: { id: sb.id, name: sb.name },
              },
              {
                dataProjection: 'EPSG:4326',
                featureProjection: 'EPSG:3857',
              }
            );
            features.push(feature);
          } catch (e) {
            console.error(`Invalid geometry for sub-block ${sb.name}`, e);
          }
        });

        // Render Image Overlay if available
        const field = fields.find(f => f.id === selectedFieldId);
        if (field?.mapVisualUrl) {
          try {
            osmLayer.current.setVisible(false); // Sembunyikan base map jika ada drone imagery

            const bounds = field.mapBounds || [[ -6.2100, 106.8100], [-6.2110, 106.8110]];
            const extent = transformExtent(
              [bounds[0][1], bounds[1][0], bounds[1][1], bounds[0][0]],
              'EPSG:4326',
              'EPSG:3857'
            );
            
            const imageUrl = await getCachedMapImageUrl(field.mapVisualUrl);
            
            imageLayer.current.setSource(new ImageStatic({
              url: imageUrl,
              imageExtent: extent
            }));
            
            // Unconditionally fit to image bounds
            map.getView().fit(extent, { padding: [50, 50, 50, 50], duration: 1000 });
          } catch (e) {
            console.error("Failed to render image overlay", e);
          }
        } else {
          osmLayer.current.setVisible(true); // Tampilkan base map
          imageLayer.current.setSource(null);
        }

        if (features.length > 0) {
          vectorSource.current.addFeatures(features);
          
          // Fit view to sub-blocks
          const extent = vectorSource.current.getExtent();
          if (extent && extent[0] !== Infinity && extent[0] !== -Infinity) {
            map.getView().fit(extent, {
              padding: [50, 50, 50, 50],
              duration: 1000,
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch sub-blocks', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSubBlocks();
  }, [selectedFieldId, map]);

  return (
    <div className="flex flex-col min-h-[calc(100vh-140px)] gap-6 animate-in fade-in pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Peta Monitoring 2D</h2>
          <p className="text-muted-foreground mt-1">
            Visualisasi spasial petak sawah dan status irigasi.
          </p>
        </div>
        
        <div className="flex items-center gap-2 bg-card border rounded-lg px-3 py-2 shadow-sm">
          <MapPin className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Pilih Lokasi:</span>
          <select 
            value={selectedFieldId}
            onChange={(e) => setSelectedFieldId(e.target.value)}
            className="bg-transparent border-none focus:ring-0 text-sm font-semibold cursor-pointer outline-none min-w-[150px]"
          >
            {fields.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="relative h-[650px] rounded-xl border bg-card shadow-lg overflow-hidden group">
        <div 
          ref={mapRef} 
          className="w-full h-full"
        />

        {/* Slide-Out Analytics Drawer */}
        {selectedSubBlock && (
          <div className="absolute top-0 right-0 h-full w-96 bg-background/95 backdrop-blur-md border-l shadow-2xl z-30 animate-in slide-in-from-right duration-300 flex flex-col">
            {/* Drawer Header */}
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="font-bold text-lg text-foreground">{selectedSubBlock.name}</h3>
                <p className="text-xs text-muted-foreground">Insight historis data telemetri</p>
              </div>
              <button 
                onClick={() => setSelectedSubBlock(null)}
                className="p-1.5 hover:bg-muted rounded-full text-muted-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {loadingHistory ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
                  <span className="text-xs">Memuat riwayat metrik...</span>
                </div>
              ) : telemetryHistory.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-xs space-y-1">
                  <p>Belum ada data rekaman IoT</p>
                  <p className="text-[10px] opacity-75">Gunakan script generator untuk menyuntik data</p>
                </div>
              ) : (
                <>
                  {/* Grafik Tinggi Air (SVG) */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs font-semibold">
                      <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                        <Droplets className="h-4 w-4" />
                        <span>Ketinggian Air (cm)</span>
                      </div>
                      <span className="text-foreground">Ambang: ±20cm</span>
                    </div>

                    <div className="h-40 w-full bg-slate-900/5 dark:bg-slate-50/5 border rounded-lg p-2 flex items-center justify-center relative">
                      {telemetryHistory.length > 1 ? (
                        <svg className="w-full h-full overflow-visible" viewBox="0 0 320 120" preserveAspectRatio="none">
                          <defs>
                            <linearGradient id="waterGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.4" />
                              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
                            </linearGradient>
                          </defs>
                          {/* Zero Line (Garis Tengah) */}
                          <line x1="10" y1="60" x2="310" y2="60" stroke="rgba(148,163,184,0.3)" strokeDasharray="4" strokeWidth="1" />
                          
                          {/* Poligon Gradien */}
                          <polygon 
                            points={`10,110 ${telemetryHistory.map((d, i) => {
                              const x = 10 + (i / (telemetryHistory.length - 1)) * 300;
                              const val = parseFloat(d.waterLevelCm || 0);
                              const y = 60 - (val / 20) * 50; // Map range -20 ke +20 ke sumbu Y
                              return `${x},${Math.max(10, Math.min(110, y))}`;
                            }).join(' ')} 310,110`}
                            fill="url(#waterGrad)"
                          />
                          {/* Garis Utama */}
                          <polyline 
                            points={telemetryHistory.map((d, i) => {
                              const x = 10 + (i / (telemetryHistory.length - 1)) * 300;
                              const val = parseFloat(d.waterLevelCm || 0);
                              const y = 60 - (val / 20) * 50;
                              return `${x},${Math.max(10, Math.min(110, y))}`;
                            }).join(' ')}
                            fill="none"
                            stroke="#2563eb"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </svg>
                      ) : (
                        <span className="text-2xs text-muted-foreground">Butuh data berurutan untuk plot tren</span>
                      )}
                    </div>
                  </div>

                  {/* Ringkasan Parameter */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 border rounded-lg flex flex-col gap-1 bg-card/50">
                      <div className="flex items-center gap-1.5 text-orange-500">
                        <Thermometer className="h-4 w-4" />
                        <span>Suhu Rata-rata</span>
                      </div>
                      <span className="font-bold text-sm">
                        {telemetryHistory.reduce((acc, cur) => acc + parseFloat(cur.temperatureC || 0), 0) / telemetryHistory.length | 0} °C
                      </span>
                    </div>

                    <div className="p-3 border rounded-lg flex flex-col gap-1 bg-card/50">
                      <div className="flex items-center gap-1.5 text-emerald-500">
                        <Battery className="h-4 w-4" />
                        <span>Daya Baterai</span>
                      </div>
                      <span className="font-bold text-sm">
                        {parseFloat(telemetryHistory[telemetryHistory.length - 1]?.batteryPct || 100).toFixed(0)} %
                      </span>
                    </div>
                  </div>

                  {/* Raw Data List */}
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-muted-foreground">Log Pembacaan Terakhir</span>
                    <div className="border rounded-lg overflow-hidden text-[11px] divide-y max-h-48 overflow-y-auto bg-card/30">
                      {telemetryHistory.slice().reverse().map((rec, idx) => (
                        <div key={rec.id || idx} className="p-2 flex justify-between items-center hover:bg-muted/40 transition-colors">
                          <span className="text-muted-foreground font-mono">
                            {new Date(rec.eventTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className={`font-semibold ${parseFloat(rec.waterLevelCm) < -10 ? 'text-destructive' : parseFloat(rec.waterLevelCm) > 10 ? 'text-blue-500' : 'text-foreground'}`}>
                            {parseFloat(rec.waterLevelCm).toFixed(1)} cm
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        
        {loading && (
          <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm font-medium">Memuat data spasial...</span>
            </div>
          </div>
        )}

        <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
           <Card className="shadow-md bg-background/90 backdrop-blur">
             <CardContent className="p-3 text-xs space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-green-600 bg-green-500/20 rounded-sm"></div>
                  <span>Petak Sawah (Sub-block)</span>
                </div>
                <div className="flex items-center gap-2">
                   <div className="w-3 h-3 rounded-full bg-blue-500 shadow-sm border border-white"></div>
                   <span>Device / Sensor (AWD)</span>
                </div>
             </CardContent>
           </Card>
        </div>

        <div className="absolute bottom-4 left-4 z-20 pointer-events-none">
          <Card className="bg-background/90 backdrop-blur border-primary/20 shadow-xl max-w-xs transition-opacity duration-300 opacity-80 group-hover:opacity-100">
            <CardContent className="p-3 flex items-start gap-3">
              <div className="bg-primary/10 p-2 rounded-lg">
                <Info className="h-4 w-4 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Petunjuk</p>
                <p className="text-xs leading-relaxed">
                  Gunakan roda mouse untuk zoom. Klik pada petak untuk melihat detail telemetri.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Persistent Field Analytics Chart */}
      <Card className="shadow-lg border bg-card/60 backdrop-blur">
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h3 className="text-xl font-bold tracking-tight">Histori Data Input IoT</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Rangkuman log telemetri terintegrasi lintas petak sawah (24 Jam terakhir).
              </p>
            </div>
            {fieldHistory.length > 0 && (
              <Badge variant="outline" className="text-2xs bg-primary/5 text-primary border-primary/20">
                Data Terakhir: {new Date(fieldHistory[fieldHistory.length - 1].event_timestamp).toLocaleString()}
              </Badge>
            )}
          </div>

          {/* Tab Selector */}
          <div className="flex border-b text-sm gap-4 pb-0 mt-4 overflow-x-auto">
            <button 
              onClick={() => setActiveTab('water')}
              className={`pb-2 px-1 font-semibold transition-colors border-b-2 text-xs md:text-sm whitespace-nowrap ${activeTab === 'water' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              Tinggi Air (cm)
            </button>
            <button 
              onClick={() => setActiveTab('temp')}
              className={`pb-2 px-1 font-semibold transition-colors border-b-2 text-xs md:text-sm whitespace-nowrap ${activeTab === 'temp' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              Suhu Udara (°C)
            </button>
            <button 
              onClick={() => setActiveTab('humidity')}
              className={`pb-2 px-1 font-semibold transition-colors border-b-2 text-xs md:text-sm whitespace-nowrap ${activeTab === 'humidity' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              Kelembapan (%)
            </button>
          </div>

          {loadingFieldHistory ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
              <span className="text-sm font-medium">Menyusun kronologi data...</span>
            </div>
          ) : fieldHistory.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground space-y-1">
              <Droplets className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm font-semibold">Data Telemetri Kosong</p>
              <p className="text-xs opacity-75">Sistem belum menerima pancaran pembacaan dari lapangan.</p>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              {/* Plot SVG */}
              <div className="h-64 w-full bg-slate-950/5 dark:bg-slate-50/5 border rounded-xl p-4 flex items-center justify-center relative overflow-hidden">
                <svg className="w-full h-full overflow-visible" viewBox="0 0 600 200" preserveAspectRatio="none">
                  {/* Grid Lines */}
                  <line x1="30" y1="40" x2="580" y2="40" stroke="rgba(148,163,184,0.15)" strokeWidth="1" />
                  <line x1="30" y1="100" x2="580" y2="100" stroke="rgba(148,163,184,0.15)" strokeWidth="1" />
                  <line x1="30" y1="160" x2="580" y2="160" stroke="rgba(148,163,184,0.15)" strokeWidth="1" />

                  {/* Dynamic Axis Labels */}
                  {activeTab === 'water' && (
                    <>
                      <text x="5" y="45" className="text-[10px] fill-muted-foreground font-semibold font-mono">+15</text>
                      <text x="5" y="105" className="text-[10px] fill-muted-foreground font-semibold font-mono">0</text>
                      <text x="5" y="165" className="text-[10px] fill-muted-foreground font-semibold font-mono">-15</text>
                    </>
                  )}
                  {activeTab === 'temp' && (
                    <>
                      <text x="5" y="45" className="text-[10px] fill-muted-foreground font-semibold font-mono">35°</text>
                      <text x="5" y="105" className="text-[10px] fill-muted-foreground font-semibold font-mono">25°</text>
                      <text x="5" y="165" className="text-[10px] fill-muted-foreground font-semibold font-mono">15°</text>
                    </>
                  )}
                  {activeTab === 'humidity' && (
                    <>
                      <text x="5" y="45" className="text-[10px] fill-muted-foreground font-semibold font-mono">100%</text>
                      <text x="5" y="105" className="text-[10px] fill-muted-foreground font-semibold font-mono">70%</text>
                      <text x="5" y="165" className="text-[10px] fill-muted-foreground font-semibold font-mono">40%</text>
                    </>
                  )}

                  {/* Group Data By Sub-block */}
                  {Array.from(new Set(fieldHistory.map(d => d.sub_block_name))).map((sbName: any, idx) => {
                     const sbData = fieldHistory.filter(d => d.sub_block_name === sbName);
                     if (sbData.length < 2) return null;

                     const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899'];
                     const color = colors[idx % colors.length];

                     const points = sbData.map((d: any, i: number) => {
                       const x = 30 + (i / (sbData.length - 1)) * 550;
                       let val = 0;
                       let y = 100;

                       if (activeTab === 'water') {
                         val = parseFloat(d.water_level_cm || 0);
                         y = 100 - (val / 15) * 60; // range -15 ke +15
                       } else if (activeTab === 'temp') {
                         val = parseFloat(d.temperature_c || 25);
                         y = 100 - ((val - 25) / 10) * 60; // range 15 ke 35
                       } else if (activeTab === 'humidity') {
                         val = parseFloat(d.humidity_pct || 70);
                         y = 100 - ((val - 70) / 30) * 60; // range 40 ke 100
                       }

                       return `${x},${Math.max(20, Math.min(180, y))}`;
                     }).join(' ');

                     return (
                        <g key={sbName}>
                          <polyline 
                            points={points}
                            fill="none"
                            stroke={color}
                            strokeWidth="3"
                            strokeLinecap="round"
                            className="transition-all duration-300"
                          />
                        </g>
                     );
                  })}
                </svg>
              </div>

              {/* Legend & Summary Cards */}
              <div className="flex flex-wrap gap-4 items-center border-t pt-4">
                <span className="text-xs font-bold text-muted-foreground">Legenda Petak:</span>
                {Array.from(new Set(fieldHistory.map(d => d.sub_block_name))).map((sbName: any, idx) => {
                   const colors = ['bg-blue-600', 'bg-green-600', 'bg-amber-600', 'bg-pink-600'];
                   const colorClass = colors[idx % colors.length];
                   return (
                     <div key={sbName} className="flex items-center gap-2 text-xs font-semibold">
                       <div className={`w-3 h-3 rounded-full ${colorClass}`} />
                       <span>{sbName}</span>
                     </div>
                   );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manajemen dan Prediksi Irigasi Card */}
      <Card className="shadow-lg border bg-card/60 backdrop-blur">
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h3 className="text-xl font-bold tracking-tight">Manajemen dan Prediksi Irigasi</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Status dan informasi petak sawah untuk manajemen irigasi terpadu.
              </p>
            </div>
            {subBlocks.length > 0 && (
              <Badge variant="outline" className="text-2xs bg-primary/5 text-primary border-primary/20">
                {subBlocks.filter(sb => sb.isActive).length} dari {subBlocks.length} Petak Aktif
              </Badge>
            )}
          </div>

          {/* Rule Profile — auto-resolved from active crop cycle */}
          <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl border bg-muted/20">
            <div className="flex-1 min-w-0">
              <label className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 block">
                Profil Aturan Irigasi (Otomatis)
              </label>
              {loadingRules || loadingCycle ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Mendeteksi siklus tanam aktif...</span>
                </div>
              ) : !activeCropCycle ? (
                <p className="text-sm text-muted-foreground italic">Tidak ada siklus tanam aktif pada lahan ini.</p>
              ) : !resolvedRuleProfile ? (
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                    Aturan tidak ditemukan
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Tidak ada profil yang cocok untuk bucket <span className="font-mono font-semibold">{activeCropCycle.bucketCode}</span> fase <span className="font-mono font-semibold">{activeCropCycle.currentPhaseCode}</span>.
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-foreground">{resolvedRuleProfile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Musim: <span className="font-mono font-semibold">{activeCropCycle.bucketCode}</span> &bull; Fase: <span className="font-mono font-semibold">{activeCropCycle.currentPhaseCode.replace('_', ' ')}</span>
                  </p>
                </div>
              )}
            </div>

            {/* Resolved profile summary */}
            {resolvedRuleProfile && (
              <div className="flex flex-wrap gap-3 items-center sm:border-l sm:pl-4">
                <div className="text-center">
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground">Batas Bawah AWD</p>
                  <p className="text-sm font-bold text-red-500">{resolvedRuleProfile.awdLowerThresholdCm} cm</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground">Target Genangan</p>
                  <p className="text-sm font-bold text-blue-500">{resolvedRuleProfile.awdUpperTargetCm} cm</p>
                </div>
                {resolvedRuleProfile.droughtAlertCm && (
                  <div className="text-center">
                    <p className="text-[10px] uppercase font-semibold text-muted-foreground">Alert Kekeringan</p>
                    <p className="text-sm font-bold text-amber-500">{resolvedRuleProfile.droughtAlertCm} cm</p>
                  </div>
                )}
                <div className="text-center">
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground">Tunda Hujan</p>
                  <p className="text-sm font-bold text-foreground">{resolvedRuleProfile.rainDelayMm} mm</p>
                </div>
              </div>
            )}
          </div>

          {loadingSubBlocks ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
              <span className="text-sm font-medium">Memuat data petak...</span>
            </div>
          ) : subBlocks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Layers className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm font-semibold">Belum ada petak sub-block</p>
              <p className="text-xs opacity-70 mt-1">Pilih lahan atau tambahkan sub-block terlebih dahulu.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pt-2">
              {subBlocks.map((sb, idx) => {
                const accentColors = [
                  { border: 'border-blue-500/30', bg: 'bg-blue-500/5', text: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-500' },
                  { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
                  { border: 'border-amber-500/30', bg: 'bg-amber-500/5', text: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' },
                  { border: 'border-pink-500/30', bg: 'bg-pink-500/5', text: 'text-pink-600 dark:text-pink-400', dot: 'bg-pink-500' },
                ];
                const accent = accentColors[idx % accentColors.length];

                return (
                  <div
                    key={sb.id}
                    className={`rounded-xl border ${accent.border} ${accent.bg} p-4 flex flex-col gap-3 hover:shadow-md transition-shadow`}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${accent.dot}`} />
                        <span className={`font-bold text-sm truncate ${accent.text}`}>{sb.name}</span>
                      </div>
                      {sb.isActive ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                      )}
                    </div>

                    {/* Info rows */}
                    <div className="space-y-1.5 text-xs text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Kode</span>
                        <span className="font-mono font-semibold text-foreground">{sb.code || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Elevasi</span>
                        <span className="font-semibold text-foreground">{sb.elevationM ? `${sb.elevationM} m` : '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Jenis Tanah</span>
                        <span className="font-semibold text-foreground capitalize">{sb.soilType || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Peta</span>
                        <span className={`font-semibold ${sb.polygonGeom ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                          {sb.polygonGeom ? 'Terpetakan' : 'Belum dipetakan'}
                        </span>
                      </div>
                    </div>

                    {/* Status badge */}
                    <div className="pt-1 border-t border-dashed border-current/10 flex items-center gap-1.5">
                      <Activity className="h-3 w-3 text-muted-foreground" />
                      <span className={`text-[11px] font-semibold ${sb.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                        {sb.isActive ? 'Irigasi Aktif' : 'Non-aktif'}
                      </span>
                    </div>

                    {/* Connection editor — pick which sub-blocks this one flows into */}
                    {subBlocks.length > 1 && (
                      <div className="pt-2 border-t border-dashed border-current/10 space-y-1.5">
                        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
                          <ArrowRight className="h-3 w-3" />
                          <span>Alirkan ke</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {subBlocks
                            .filter(target => target.id !== sb.id)
                            .map(target => {
                              const isConnected = (subBlockConnections[sb.id] ?? []).includes(target.id);
                              return (
                                <button
                                  key={target.id}
                                  onClick={() => {
                                    setSubBlockConnections(prev => {
                                      const current = prev[sb.id] ?? [];
                                      const updated = isConnected
                                        ? current.filter(id => id !== target.id)
                                        : [...current, target.id];
                                      return { ...prev, [sb.id]: updated };
                                    });
                                  }}
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all duration-150 ${
                                    isConnected
                                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                      : 'bg-transparent text-muted-foreground border-muted-foreground/20 hover:border-primary/60 hover:text-foreground'
                                  }`}
                                >
                                  {target.name}
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Active connections summary */}
          {(() => {
            const allEdges = Object.entries(subBlockConnections).flatMap(
              ([fromId, toIds]) => toIds.map(toId => ({ fromId, toId }))
            );
            if (allEdges.length === 0) return null;
            return (
              <div className="border-t pt-4 mt-2 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <GitMerge className="h-4 w-4 text-primary" />
                  <span>Koneksi Saluran Aktif</span>
                  <span className="ml-auto text-xs text-muted-foreground font-normal">{allEdges.length} koneksi</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {allEdges.map(({ fromId, toId }, idx) => {
                    const fromSb = subBlocks.find(s => s.id === fromId);
                    const toSb   = subBlocks.find(s => s.id === toId);
                    const isBidirectional = (subBlockConnections[toId] ?? []).includes(fromId);
                    return (
                      <span
                        key={idx}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold border border-primary/20"
                      >
                        {fromSb?.name ?? fromId}
                        <ArrowRight className="h-3 w-3" />
                        {toSb?.name ?? toId}
                        {isBidirectional && (
                          <span className="ml-0.5 text-[9px] text-primary/60 font-normal">(2 arah)</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Rute Irigasi Paling Efektif */}
          <div className="border-t pt-6 mt-2 space-y-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-2 rounded-lg">
                <Route className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h4 className="text-base font-bold tracking-tight">Rute Irigasi Paling Efektif</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Rekomendasi urutan distribusi air berdasarkan efisiensi dan kondisi lapangan.
                </p>
              </div>
            </div>

            {loadingRoutes ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
                <span className="text-sm">Menghitung rute optimal...</span>
              </div>
            ) : irrigationRoutes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground border border-dashed rounded-xl bg-muted/20">
                <TrendingUp className="h-8 w-8 opacity-30" />
                <p className="text-sm font-semibold">Belum ada data rute irigasi</p>
                <p className="text-xs opacity-60">Data akan muncul setelah endpoint tersedia.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {irrigationRoutes.map((route, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-4 p-4 rounded-xl border bg-card/50 hover:shadow-sm transition-shadow"
                  >
                    {/* Route info */}
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-sm truncate">{route.routeName}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {route.fromSubBlock} → {route.toSubBlock}
                      </p>
                      {route.notes && (
                        <p className="text-[11px] text-muted-foreground/70 mt-1 italic">{route.notes}</p>
                      )}
                    </div>

                    {/* Metrics */}
                    <div className="shrink-0 text-right space-y-0.5">
                      <div className="flex items-center gap-1 justify-end">
                        <TrendingUp className="h-3 w-3 text-emerald-500" />
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                          {route.weightScore}%
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{route.estimatedDistance} m</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
