import { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Fill, Stroke, Text, Circle as CircleStyle } from 'ol/style';
import { fromLonLat, transformExtent } from 'ol/proj';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiClient, gisProcClient } from '@/api/client';
import axios from 'axios';
import { getCachedMapImageUrl } from '@/lib/mapCache';
import { MapPin, Loader2, Info, X, Droplets, Battery, Thermometer, Layers, AlertTriangle, CheckCircle2, Activity, Route, GitMerge, ArrowRight } from 'lucide-react';

interface Field {
  id: string;
  name: string;
  mapVisualUrl?: string | null;
  mapBounds?: number[][] | null;
  irrigationEdges?: any[] | null;
  irrigationNodes?: any[] | null;
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

interface IrrigationPoint {
  id: string;
  fieldId: string;
  pointType: 'source' | 'drain';
  coordinatePoint: any;
  elevationM: string | null;
}

type RouteEntry = {
  target: number;
  path: number[];
  weight: number;
};

type MultiTargetResult = {
  source: number;
  routes: RouteEntry[];
};

type NodePosition = {
  id: string;
  name: string;
  x: number;
  y: number;
};

type BackgroundEdge = {
  from: NodePosition;
  to: NodePosition;
  fromIdx: number;
  toIdx: number;
  weight: number;
};

function getNodeCentroidWkt(node: any): string | null {
  if (!node) return null;
  if (node.centroid) return node.centroid;
  if (node.coordinatePoint) {
    const geom = typeof node.coordinatePoint === 'string'
      ? JSON.parse(node.coordinatePoint)
      : node.coordinatePoint;
    if (geom && geom.type === 'Point' && geom.coordinates) {
      return `POINT(${geom.coordinates[0]} ${geom.coordinates[1]})`;
    }
  }
  return null;
}

function IrrigationRouteGraph({
  matrixResult,
  subBlocks,
  sourceIndex,
  setSourceIndex,
  floydWarshallMatrix,
  irrigationPoints,
}: {
  matrixResult: MultiTargetResult;
  subBlocks: SubBlock[];
  sourceIndex: number;
  setSourceIndex: (v: number) => void;
  floydWarshallMatrix: any;
  irrigationPoints: IrrigationPoint[];
}) {
  const routes: RouteEntry[] = Array.isArray(matrixResult.routes) ? matrixResult.routes : [];

  const allNodes = [
    ...subBlocks,
    ...irrigationPoints.map(ip => ({
      id: ip.id,
      name: ip.pointType === 'source' ? 'SUMBER' : 'BUANG',
    }))
  ];

  if (routes.length === 0) {
    return (
      <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>Tidak ada rute yang dapat dijangkau dari sumber ini. Jalankan Floyd-Warshall untuk memperbarui visualisasi.</span>
      </div>
    );
  }

  const sortedRoutes = [...routes].sort((a, b) => a.weight - b.weight);

  const routeEdgeSet: Record<string, boolean> = {};
  const edgeRouteWeight: Record<string, number> = {};
  const routeNodeSet: Record<number, boolean> = {};

  sortedRoutes.forEach((route) => {
    route.path.forEach((nodeIdx) => { routeNodeSet[nodeIdx] = true; });
    for (let k = 0; k < route.path.length - 1; k++) {
      const key = `${route.path[k]}-${route.path[k + 1]}`;
      routeEdgeSet[key] = true;
      if (edgeRouteWeight[key] === undefined) {
        edgeRouteWeight[key] = route.weight;
      }
    }
  });

  const maxRouteWeight = Math.max(...sortedRoutes.map((r) => r.weight));
  const minRouteWeight = Math.min(...sortedRoutes.map((r) => r.weight));

  const isEdgeOnAnyRoute = (fromIdx: number, toIdx: number) =>
    !!routeEdgeSet[`${fromIdx}-${toIdx}`];

  const isNodeOnAnyRoute = (nodeIdx: number) => !!routeNodeSet[nodeIdx];

  const getEdgeColor = (fromIdx: number, toIdx: number) => {
    const key = `${fromIdx}-${toIdx}`;
    const weight = edgeRouteWeight[key];
    if (weight === undefined) return '#3b82f6';
    const range = maxRouteWeight - minRouteWeight;
    const ratio = range > 0 ? (weight - minRouteWeight) / range : 0;
    const r = Math.round(16 + ratio * (245 - 16));
    const g = Math.round(185 + ratio * (158 - 185));
    const b = Math.round(129 + ratio * (11 - 129));
    return `rgb(${r},${g},${b})`;
  };

  const svgSize = 340;
  const center = svgSize / 2;
  const radius = 105;

  const nodePositions: NodePosition[] = allNodes.map((node, idx) => {
    const angle = (2 * Math.PI * idx) / allNodes.length - Math.PI / 2;
    return {
      id: node.id,
      name: node.name,
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    };
  });

  const backgroundEdges: BackgroundEdge[] = [];
  try {
    if (floydWarshallMatrix) {
      const rawMatrix: number[][] | null =
        Array.isArray(floydWarshallMatrix) ? floydWarshallMatrix
        : Array.isArray(floydWarshallMatrix?.dist) ? floydWarshallMatrix.dist
        : Array.isArray(floydWarshallMatrix?.matrix) ? floydWarshallMatrix.matrix
        : null;
      if (rawMatrix) {
        for (let i = 0; i < rawMatrix.length; i++) {
          for (let j = 0; j < rawMatrix[i].length; j++) {
            if (i === j) continue;
            const num = Number(rawMatrix[i][j]);
            if (isFinite(num) && num > 0 && num < 999 && nodePositions[i] && nodePositions[j]) {
              backgroundEdges.push({
                from: nodePositions[i],
                to: nodePositions[j],
                fromIdx: i,
                toIdx: j,
                weight: num,
              });
            }
          }
        }
      }
    }
  } catch (_) {
  }  // ignore parse errors

  return (
    <div className="border-t pt-6 mt-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-emerald-500/10 p-2 rounded-lg">
          <Activity className="h-4 w-4 text-emerald-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-base font-bold tracking-tight text-foreground">Peta Rute Irigasi Terbaik</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Semua rute optimal dari sumber ke seluruh petak, ditampilkan dalam satu grafik. Warna lebih hijau = prioritas lebih tinggi.
          </p>
        </div>
      </div>

      {/* Source selection only */}
      <div className="bg-muted/40 p-4 rounded-xl border border-muted/50">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Asal (Source)</label>
          <select
            value={sourceIndex}
            onChange={(e) => setSourceIndex(parseInt(e.target.value))}
            className="w-full text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 focus:ring-2 focus:ring-primary focus:border-primary cursor-pointer text-slate-900 dark:text-slate-100 font-semibold outline-none shadow-sm"
          >
            {allNodes.map((node, idx) => (
              <option
                key={node.id}
                value={idx}
                className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium"
              >
                {idx + 1}. {node.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* All routes list sorted by weight */}
      <div className="space-y-2">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Semua Rute yang Ditemukan (urut prioritas)</span>
        <div className="space-y-1.5">
          {sortedRoutes.map((route, rIdx) => {
            const targetNode = allNodes[route.target];
            const range = maxRouteWeight - minRouteWeight;
            const ratio = range > 0 ? (route.weight - minRouteWeight) / range : 0;
            const badgeClass =
              ratio < 0.33 ? 'bg-emerald-500 text-white'
              : ratio < 0.66 ? 'bg-amber-400 text-white'
              : 'bg-rose-400 text-white';
            return (
              <div key={rIdx} className="bg-card border rounded-lg px-3 py-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-muted-foreground">#{rIdx + 1}</span>
                    <span className="text-xs font-semibold text-foreground">
                      → {targetNode ? targetNode.name : `Node ${route.target + 1}`}
                    </span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeClass}`}>
                    {route.weight.toFixed(1)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {route.path.map((nodeIdx, pIdx) => {
                    const node = allNodes[nodeIdx];
                    return (
                      <div key={pIdx} className="flex items-center gap-1">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary">
                          {node ? node.name : `N${nodeIdx + 1}`}
                        </span>
                        {pIdx < route.path.length - 1 && (
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Unified Circular Graph SVG */}
      <div className="flex justify-center bg-card/50 border rounded-xl p-4 relative overflow-visible">
        <svg width={svgSize} height={svgSize} className="overflow-visible">
          <defs>
            <marker
              id="arrow-bg"
              viewBox="0 0 10 10"
              refX="18"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 2 L 10 5 L 0 8 z" fill="#94a3b8" opacity="0.5" />
            </marker>
            {sortedRoutes.map((route, rIdx) => {
              const range = maxRouteWeight - minRouteWeight;
              const ratio = range > 0 ? (route.weight - minRouteWeight) / range : 0;
              const r = Math.round(16 + ratio * (245 - 16));
              const g = Math.round(185 + ratio * (158 - 185));
              const b = Math.round(129 + ratio * (11 - 129));
              const color = `rgb(${r},${g},${b})`;
              return (
                <marker
                  key={rIdx}
                  id={`arrow-route-${rIdx}`}
                  viewBox="0 0 10 10"
                  refX="18"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 2 L 10 5 L 0 8 z" fill={color} />
                </marker>
              );
            })}
          </defs>

          {/* Background edges (context) */}
          {backgroundEdges
            .filter((edge) => !isEdgeOnAnyRoute(edge.fromIdx, edge.toIdx))
            .map((edge, idx) => (
              <line
                key={`bg-${idx}`}
                x1={edge.from.x}
                y1={edge.from.y}
                x2={edge.to.x}
                y2={edge.to.y}
                stroke="#94a3b8"
                strokeWidth="1"
                strokeOpacity="0.2"
                markerEnd="url(#arrow-bg)"
              />
            ))
          }

          {/* Route edges rendered in reverse priority order (lowest weight on top) */}
          {[...sortedRoutes].reverse().flatMap((route, revIdx) => {
            const rIdx = sortedRoutes.length - 1 - revIdx;
            const range = maxRouteWeight - minRouteWeight;
            const ratio = range > 0 ? (route.weight - minRouteWeight) / range : 0;
            const strokeW = 3.5 - ratio * 1.5;
            const opacity = 1 - ratio * 0.4;
            return route.path.slice(0, -1).map((fromIdx, segIdx) => {
              const toIdx = route.path[segIdx + 1];
              const fromPos = nodePositions[fromIdx];
              const toPos = nodePositions[toIdx];
              if (!fromPos || !toPos) return null;
              const segColor = getEdgeColor(fromIdx, toIdx);
              return (
                <g key={`route-${rIdx}-seg-${segIdx}`}>
                  <line
                    x1={fromPos.x}
                    y1={fromPos.y}
                    x2={toPos.x}
                    y2={toPos.y}
                    stroke={segColor}
                    strokeWidth={strokeW}
                    strokeOpacity={opacity}
                    markerEnd={`url(#arrow-route-${rIdx})`}
                    className="transition-all"
                  />
                </g>
              );
            });
          })}

          {/* Node circles */}
          {nodePositions.map((node, idx) => {
            const onRoute = isNodeOnAnyRoute(idx);
            const isSource = idx === matrixResult.source;
            const actualNode = allNodes[idx];
            const isIrr = actualNode && 'isIrrigationPoint' in actualNode && (actualNode as any).isIrrigationPoint;
            const pointType = isIrr ? (actualNode as any).pointType : null;

            const nodeColor = isSource
              ? '#6366f1' // Selected source node in visualization
              : pointType === 'source'
              ? '#4f46e5' // Indigo for source points
              : pointType === 'drain'
              ? '#f43f5e' // Rose/Red for drains
              : onRoute
              ? '#10b981' // Green for other active route nodes
              : '#3b82f6'; // Blue for idle subblocks

            const nodeR = isSource ? 15 : onRoute ? 13 : 10;
            return (
              <g key={idx} className="cursor-pointer group">
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={nodeR}
                  fill={nodeColor}
                  stroke="#ffffff"
                  strokeWidth="2"
                  opacity={onRoute || isSource ? 1 : 0.4}
                  className="transition-transform group-hover:scale-110 duration-150"
                />
                <text
                  x={node.x}
                  y={node.y + 3.5}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="bold"
                  fill="#ffffff"
                >
                  {idx + 1}
                </text>
                <text
                  x={node.x}
                  y={node.y + (node.y > center ? 22 : -16)}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight={onRoute || isSource ? '700' : '500'}
                  fill={onRoute || isSource ? '#1e293b' : '#64748b'}
                  className="paint-order shadow-sm transition-opacity group-hover:opacity-100"
                >
                  {node.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground bg-muted/30 p-3 rounded-lg border">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#6366f1] inline-block" />
          <span>Sumber Terpilih</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#4f46e5] inline-block" />
          <span>Titik Sumber (Source)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#f43f5e] inline-block" />
          <span>Titik Pembuangan (Drain)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
          <span>Sub-Block Teririgasi</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-6 h-1 bg-emerald-500 inline-block rounded" />
          <span>Prioritas tinggi (jarak kecil)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-6 h-1 bg-amber-400 inline-block rounded" />
          <span>Prioritas sedang</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-6 h-1 bg-rose-400 inline-block rounded" />
          <span>Prioritas rendah</span>
        </div>
      </div>
    </div>
  );
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


  // subBlockConnections[sourceId] = [targetId, ...] — directed adjacency list (one-way edges)
  const [subBlockConnections, setSubBlockConnections] = useState<Record<string, string[]>>({});

  const [ruleProfiles, setRuleProfiles] = useState<RuleProfile[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [activeCropCycle, setActiveCropCycle] = useState<CropCycle | null>(null);
  const [loadingCycle, setLoadingCycle] = useState(false);
  const [resolvedRuleProfile, setResolvedRuleProfile] = useState<RuleProfile | null>(null);
  const [runningFloydWarshall, setRunningFloydWarshall] = useState(false);
  const [matrixResult, setMatrixResult] = useState<any>(null);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [sourceIndex, setSourceIndex] = useState<number>(0);
  const [floydWarshallMatrix, setFloydWarshallMatrix] = useState<any>(null);
  const [irrigationPoints, setIrrigationPoints] = useState<IrrigationPoint[]>([]);
  const [devices, setDevices] = useState<any[]>([]);

  const getNodeCentroidById = (id: string): string | null => {
    const sb = subBlocks.find(s => s.id === id);
    if (sb) return sb.centroid;
    const ip = irrigationPoints.find(p => p.id === id);
    if (ip) {
      return getNodeCentroidWkt(ip);
    }
    return null;
  };

  const saveConnectionsToLocalStorage = async (connections: Record<string, string[]>) => {
    const edges = Object.entries(connections).flatMap(
      ([fromId, toIds]) => toIds.map(toId => ({
        from:          fromId,
        to:            toId,
        from_centroid: getNodeCentroidById(fromId),
        to_centroid:   getNodeCentroidById(toId),
      }))
    );
    try {
      await apiClient.patch(`/fields/${selectedFieldId}`, {
        irrigation_edges: edges,
      });
      setFields(prev => prev.map(f => f.id === selectedFieldId ? { ...f, irrigationEdges: edges } : f));
    } catch (err) {
      console.error('Failed to save irrigation edges to database', err);
    }
  };

  const getEligibleTargets = (fromId: string, isIrrPoint: boolean) => {
    if (isIrrPoint) {
      const ip = irrigationPoints.find(p => p.id === fromId);
      if (ip && ip.pointType === 'drain') {
        return []; // Drain cannot route to anything
      }
    }

    const targets: { id: string; name: string }[] = [];

    // Add sub-blocks (excluding itself if fromId is a sub-block)
    subBlocks.forEach(sb => {
      if (sb.id !== fromId) {
        targets.push({ id: sb.id, name: sb.name });
      }
    });

    // Add drains (excluding itself if fromId is a drain)
    irrigationPoints.forEach(ip => {
      if (ip.pointType === 'drain' && ip.id !== fromId) {
        const elevText = ip.elevationM ? ` (${ip.elevationM} m)` : '';
        targets.push({ id: ip.id, name: `BUANG${elevText}` });
      }
    });

    return targets;
  };

  const fetchMatrixResult = async () => {
    try {
      if (!selectedFieldId) {
        setMatrixResult(null);
        return;
      }

      let matrixData = floydWarshallMatrix;
      if (!matrixData) {
        setLoadingMatrix(true);
        const response = await apiClient.get(`/fields/${selectedFieldId}/flow-paths`);
        const flowPath = response.data.data?.[0];
        if (flowPath && flowPath.floydWarshallMatrix) {
          matrixData = flowPath.floydWarshallMatrix;
          setFloydWarshallMatrix(matrixData);
        }
      }

      if (!matrixData) {
        setMatrixResult(null);
        return;
      }

      setLoadingMatrix(true);

      let matrix = matrixData;
      let successor = null;
      if (matrixData && !Array.isArray(matrixData)) {
        if (Array.isArray(matrixData.dist)) {
          matrix = matrixData.dist;
        } else if (Array.isArray(matrixData.matrix)) {
          matrix = matrixData.matrix;
        }

        if (Array.isArray(matrixData.successor)) {
          successor = matrixData.successor;
        } else if (Array.isArray(matrixData.successors)) {
          successor = matrixData.successors;
        }
      }

      // Construct the request body (no target for multi-target endpoint)
      const payload = {
        matrix: matrix,
        successor: successor,
        source: sourceIndex,
      };

      // Send the POST request to host/api/floydwarshall/matrix/multi-target
      const response = await gisProcClient.post('/api/floydwarshall/matrix/chained-routes', payload);
      setMatrixResult(response.data);
    } catch (err) {
      console.error('Failed to fetch matrix visualization data', err);
      setMatrixResult(null);
    } finally {
      setLoadingMatrix(false);
    }
  };

  // Refetch matrix result when source or selected field changes
  // Refetch matrix result when source or selected field changes
  useEffect(() => {
    if (subBlocks.length > 0 || irrigationPoints.length > 0) {
      fetchMatrixResult();
    } else {
      setMatrixResult(null);
    }
  }, [sourceIndex, selectedFieldId, floydWarshallMatrix]);

  // Reset source in bounds when subBlocks or irrigationPoints change
  useEffect(() => {
    if (subBlocks.length > 0 || irrigationPoints.length > 0) {
      setSourceIndex(0);
    }
  }, [subBlocks, irrigationPoints]);



  const handleRunFloydWarshall = async () => {
    if (!selectedFieldId || (subBlocks.length === 0 && irrigationPoints.length === 0)) return;
    try {
      setRunningFloydWarshall(true);

      // 1. Fetch latest states to get the current water level for each subblock
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

      // 2. Map nodes (both sub-blocks and irrigation points)
      const allNodes = [
        ...subBlocks,
        ...irrigationPoints.map(ip => ({
          id: ip.id,
          name: ip.pointType === 'source' ? 'SUMBER' : 'BUANG',
          pointType: ip.pointType,
          coordinatePoint: ip.coordinatePoint,
          elevationM: ip.elevationM,
          isIrrigationPoint: true,
          areaM2: 0.0001,
        }))
      ];

      const nodesPayload = allNodes.map(node => {
        let water_height = 0;
        let optimal_height = 0;
        let area = 0.0001;
        const elevation = node.elevationM !== null ? parseFloat(node.elevationM as string) : 0;

        const isIrrigation = 'isIrrigationPoint' in node && (node as any).isIrrigationPoint === true;
        if (!isIrrigation) {
          const sb = node as SubBlock;
          const waterHeightVal = stateMap[sb.id];
          water_height = waterHeightVal != null ? parseFloat(waterHeightVal) : 0;
          optimal_height = optimalHeight != null ? parseFloat(optimalHeight as any) : 0;
          area = sb.areaM2 !== null ? parseFloat(sb.areaM2 as any) : 0;
        } else {
          // Treat water level and optimal level as neutral (both value are the same)
          water_height = 0;
          optimal_height = 0;
          area = 0.0001;
        }

        return {
          area,
          water_height,
          optimal_height,
          elevation,
        };
      });

      // 3. Map edges (both sub-blocks and irrigation points)
      const edgesPayload = Object.entries(subBlockConnections).flatMap(
        ([fromId, toIds]) => {
          const u = allNodes.findIndex(node => node.id === fromId);
          if (u === -1) return [];

          const fromNode = allNodes[u];
          // If fromNode is a drain, it cannot route to anything
          if ('isIrrigationPoint' in fromNode && (fromNode as any).isIrrigationPoint && (fromNode as any).pointType === 'drain') {
            return [];
          }

          return toIds.map(toId => {
            const v = allNodes.findIndex(node => node.id === toId);
            if (v === -1) return null;

            const toNode = allNodes[v];
            // If toNode is a source, nothing can route to it
            if ('isIrrigationPoint' in toNode && (toNode as any).isIrrigationPoint && (toNode as any).pointType === 'source') {
              return null;
            }

            const centroid_u = getNodeCentroidWkt(fromNode) ?? "";
            const centroid_v = getNodeCentroidWkt(toNode) ?? "";

            return {
              u,
              v,
              centroid_u,
              centroid_v,
            };
          }).filter((edge): edge is NonNullable<typeof edge> => edge !== null);
        }
      );

      // 4. Construct payload
      const payload = {
        num_nodes: nodesPayload.length,
        nodes: nodesPayload,
        edges: edgesPayload,
        directed: true,
        direction: true,
      };

      // 5. POST request to host/api/floydwarshall/run
      const response = await gisProcClient.post('/api/floydwarshall/run', payload);

      // Save response to backend database instead of localStorage
      try {
        const fpListRes = await apiClient.get(`/fields/${selectedFieldId}/flow-paths`);
        const existingPath = fpListRes.data.data?.[0];

        if (existingPath) {
          await apiClient.patch(`/flow-paths/${existingPath.id}`, {
            floyd_warshall_matrix: response.data,
          });
        } else {
          await apiClient.post(`/fields/${selectedFieldId}/flow-paths`, {
            flow_type: 'natural',
            floyd_warshall_matrix: response.data,
            notes: 'Floyd-Warshall routing matrix',
          });
        }
      } catch (dbErr) {
        console.error('Failed to save Floyd-Warshall matrix to backend database', dbErr);
      }

      // Update state
      setFloydWarshallMatrix(response.data);

      // Fetch the matrix visualization result
      await fetchMatrixResult();
      
      alert('Floyd-Warshall routing run successfully and result saved to database!');
    } catch (err) {
      console.error('Failed to run Floyd-Warshall routing', err);
      alert('Gagal menjalankan Floyd-Warshall routing: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRunningFloydWarshall(false);
    }
  };

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
      if (feature && !feature.get('isDevice') && !feature.get('isIrrigationPoint')) {
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
            const isIrrPoint = feature.get('isIrrigationPoint');
            if (isIrrPoint) {
              const pointType = feature.get('pointType');
              const color = pointType === 'source' ? '#22c55e' : '#ef4444';
              const textColor = pointType === 'source' ? '#15803d' : '#b91c1c';
              return new Style({
                image: new CircleStyle({
                  radius: 8,
                  fill: new Fill({ color }),
                  stroke: new Stroke({ color: '#fff', width: 2 })
                }),
                text: new Text({
                  text: feature.get('name'),
                  font: 'bold 10px Inter, sans-serif',
                  offsetY: -14,
                  fill: new Fill({ color: textColor }),
                  stroke: new Stroke({ color: '#fff', width: 2 })
                })
              });
            }

            const isDevice = feature.get('isDevice');
            if (isDevice) {
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

  // 3b. Fetch Sub-blocks, Irrigation Points & Devices data for the irrigation management card
  useEffect(() => {
    if (!selectedFieldId) return;
    const fetchSubBlocksData = async () => {
      try {
        setLoadingSubBlocks(true);
        const [subBlocksRes, pointsRes, devicesRes] = await Promise.all([
          apiClient.get(`/fields/${selectedFieldId}/sub-blocks`),
          apiClient.get(`/fields/${selectedFieldId}/irrigation-points`),
          apiClient.get(`/fields/${selectedFieldId}/devices`)
        ]);
        setSubBlocks(subBlocksRes.data.data);
        setIrrigationPoints(pointsRes.data.data);
        setDevices(devicesRes.data.data || []);
      } catch (err) {
        console.error('Failed to fetch sub-blocks data', err);
      } finally {
        setLoadingSubBlocks(false);
      }
    };
    fetchSubBlocksData();
  }, [selectedFieldId]);

  // Load Floyd-Warshall matrix from backend database whenever selectedFieldId changes
  useEffect(() => {
    if (!selectedFieldId) {
      setFloydWarshallMatrix(null);
      return;
    }

    const fetchFloydWarshallMatrix = async () => {
      try {
        const response = await apiClient.get(`/fields/${selectedFieldId}/flow-paths`);
        const flowPath = response.data.data?.[0]; // Get the first active flow path
        if (flowPath && flowPath.floydWarshallMatrix) {
          setFloydWarshallMatrix(flowPath.floydWarshallMatrix);
        } else {
          setFloydWarshallMatrix(null);
        }
      } catch (err) {
        console.error('Failed to fetch Floyd-Warshall matrix from backend', err);
        setFloydWarshallMatrix(null);
      }
    };

    fetchFloydWarshallMatrix();
  }, [selectedFieldId]);

  // Reset connections whenever the sub-block list changes (e.g. different field selected)
  // unless there are saved edges in localStorage, which we prioritize.
  useEffect(() => {
    if (!selectedFieldId) {
      setSubBlockConnections({});
      return;
    }
    try {
      const field = fields.find(f => f.id === selectedFieldId);
      const edges = field?.irrigationEdges;
      if (Array.isArray(edges) && edges.length > 0) {
        const connections: Record<string, string[]> = {};
        edges.forEach(edge => {
          if (edge && edge.from && edge.to) {
            if (!connections[edge.from]) connections[edge.from] = [];
            if (!connections[edge.from].includes(edge.to)) connections[edge.from].push(edge.to);
          }
        });
        setSubBlockConnections(connections);
        return;
      }
    } catch (e) {
      console.error('Error loading subBlockConnections from database on subBlocks change', e);
    }
    setSubBlockConnections({});
  }, [subBlocks, irrigationPoints, selectedFieldId, fields]);



  // 3. Fetch & Render Sub-blocks, Irrigation Points & Devices for Selected Field
  useEffect(() => {
    if (!selectedFieldId || !map) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        const [subBlocksRes, pointsRes, devicesRes] = await Promise.all([
          apiClient.get(`/fields/${selectedFieldId}/sub-blocks`),
          apiClient.get(`/fields/${selectedFieldId}/irrigation-points`),
          apiClient.get(`/fields/${selectedFieldId}/devices`)
        ]);

        const subBlocks: SubBlock[] = subBlocksRes.data.data;
        const points: IrrigationPoint[] = pointsRes.data.data;
        const devicesData: any[] = devicesRes.data.data || [];

        vectorSource.current.clear();

        const geojsonFormat = new GeoJSON();
        const features: any[] = [];

        subBlocks.forEach((sb) => {
          if (!sb.polygonGeom) return;
          try {
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

        points.forEach((ip) => {
          if (!ip.coordinatePoint) return;
          try {
            const geom = typeof ip.coordinatePoint === 'string'
              ? JSON.parse(ip.coordinatePoint)
              : ip.coordinatePoint;

            if (!geom || !geom.coordinates || geom.coordinates.length === 0) return;

            const feature = geojsonFormat.readFeature(
              {
                type: 'Feature',
                geometry: geom,
                properties: { 
                  id: ip.id, 
                  name: ip.pointType === 'source' ? 'SUMBER' : 'BUANG',
                  isIrrigationPoint: true,
                  pointType: ip.pointType
                },
              },
              {
                dataProjection: 'EPSG:4326',
                featureProjection: 'EPSG:3857',
              }
            );
            features.push(feature);
          } catch (e) {
            console.error(`Invalid geometry for irrigation point ${ip.id}`, e);
          }
        });

        devicesData.forEach((d) => {
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
            try {
              const feature = geojsonFormat.readFeature(
                {
                  type: 'Feature',
                  geometry: {
                    type: 'Point',
                    coordinates: [loc.x, loc.y]
                  },
                  properties: {
                    id: d.id,
                    name: d.deviceCode || 'Device',
                    isDevice: true,
                    deviceCode: d.deviceCode
                  }
                },
                {
                  dataProjection: 'EPSG:4326',
                  featureProjection: 'EPSG:3857'
                }
              );
              features.push(feature);
            } catch (e) {
              console.error(`Invalid coordinates for device ${d.deviceCode}`, e);
            }
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
          
          // Fit view to sub-blocks and points
          const extent = vectorSource.current.getExtent();
          if (extent && extent[0] !== Infinity && extent[0] !== -Infinity) {
            map.getView().fit(extent, {
              padding: [50, 50, 50, 50],
              duration: 1000,
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch sub-blocks & points', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
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
                   <span>Device / Sensor (AWD) ({devices.length})</span>
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

                    {/* Connection editor — pick which targets this one flows into */}
                    {getEligibleTargets(sb.id, false).length > 0 && (
                      <div className="pt-2 border-t border-dashed border-current/10 space-y-1.5">
                        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
                          <ArrowRight className="h-3 w-3" />
                          <span>Alirkan ke</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {getEligibleTargets(sb.id, false).map(target => {
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
                                    const newConnections = { ...prev, [sb.id]: updated };
                                    saveConnectionsToLocalStorage(newConnections);
                                    return newConnections;
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

          {/* Section for Irrigation Points */}
          {irrigationPoints.length > 0 && (
            <div className="space-y-3 mt-6 border-t pt-4">
              <div className="flex items-center gap-2">
                <div className="bg-indigo-500/10 p-1.5 rounded-lg">
                  <Activity className="h-4 w-4 text-indigo-500" />
                </div>
                <h4 className="text-sm font-bold text-foreground">Daftar Titik Irigasi</h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {irrigationPoints.map((ip, idx) => {
                  const isSource = ip.pointType === 'source';
                  const accent = isSource
                    ? { border: 'border-indigo-500/30', bg: 'bg-indigo-500/5', text: 'text-indigo-600 dark:text-indigo-400', dot: 'bg-indigo-500', label: 'SUMBER' }
                    : { border: 'border-rose-500/30', bg: 'bg-rose-500/5', text: 'text-rose-600 dark:text-rose-400', dot: 'bg-rose-500', label: 'BUANG' };

                  return (
                    <div
                      key={ip.id}
                      className={`rounded-xl border ${accent.border} ${accent.bg} p-4 flex flex-col gap-3 hover:shadow-md transition-shadow`}
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${accent.dot}`} />
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isSource ? 'bg-indigo-500 text-white' : 'bg-rose-500 text-white'}`}>
                            {accent.label}
                          </span>
                          <span className="font-bold text-sm truncate text-foreground">
                            Titik {isSource ? 'Sumber' : 'Buang'} #{idx + 1}
                          </span>
                        </div>
                      </div>

                      {/* Info rows */}
                      <div className="space-y-1.5 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Elevasi</span>
                          <span className="font-semibold text-foreground">{ip.elevationM ? `${ip.elevationM} m` : '—'}</span>
                        </div>
                      </div>

                      {/* Connection editor */}
                      {isSource && getEligibleTargets(ip.id, true).length > 0 && (
                        <div className="pt-2 border-t border-dashed border-current/10 space-y-1.5">
                          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
                            <ArrowRight className="h-3 w-3" />
                            <span>Alirkan ke</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {getEligibleTargets(ip.id, true).map(target => {
                              const isConnected = (subBlockConnections[ip.id] ?? []).includes(target.id);
                              return (
                                <button
                                  key={target.id}
                                  onClick={() => {
                                    setSubBlockConnections(prev => {
                                      const current = prev[ip.id] ?? [];
                                      const updated = isConnected
                                        ? current.filter(id => id !== target.id)
                                        : [...current, target.id];
                                      const newConnections = { ...prev, [ip.id]: updated };
                                      saveConnectionsToLocalStorage(newConnections);
                                      return newConnections;
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
                    const fromSb = subBlocks.find(s => s.id === fromId) || irrigationPoints.find(ip => ip.id === fromId);
                    const toSb   = subBlocks.find(s => s.id === toId) || irrigationPoints.find(ip => ip.id === toId);
                    const isBidirectional = (subBlockConnections[toId] ?? []).includes(fromId);
                    const fromName = fromSb ? ('pointType' in fromSb ? (fromSb.pointType === 'source' ? 'SUMBER' : 'BUANG') : fromSb.name) : fromId;
                    const toName = toSb ? ('pointType' in toSb ? (toSb.pointType === 'source' ? 'SUMBER' : 'BUANG') : toSb.name) : toId;
                    return (
                      <span
                        key={idx}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold border border-primary/20"
                      >
                        {fromName}
                        <ArrowRight className="h-3 w-3" />
                        {toName}
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
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
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
              <Button
                onClick={handleRunFloydWarshall}
                disabled={runningFloydWarshall || (subBlocks.length === 0 && irrigationPoints.length === 0)}
                size="sm"
                className="gap-1.5"
              >
                {runningFloydWarshall ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Activity className="h-3.5 w-3.5" />
                    Jalankan Floyd-Warshall
                  </>
                )}
              </Button>
            </div>


            {/* Floyd-Warshall Multi-Target Graph Section */}
            {loadingMatrix ? (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground border border-dashed rounded-xl bg-muted/10">
                <Loader2 className="h-5 w-5 animate-spin text-primary mb-1.5" />
                <span className="text-xs">Memuat grafik rute irigasi...</span>
              </div>
            ) : matrixResult && typeof matrixResult === 'object' && Array.isArray(matrixResult.routes) ? (
              <IrrigationRouteGraph
                matrixResult={matrixResult as MultiTargetResult}
                subBlocks={subBlocks}
                sourceIndex={sourceIndex}
                setSourceIndex={setSourceIndex}
                floydWarshallMatrix={floydWarshallMatrix}
                irrigationPoints={irrigationPoints}
              />
            ) : matrixResult ? (
              <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Hasil tersimpan dalam format lama. Jalankan Floyd-Warshall untuk memperbarui visualisasi.</span>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

