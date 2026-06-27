import { useCallback, useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import WKB from 'ol/format/WKB';
import { Style, Fill, Stroke, Text, Circle as CircleStyle } from 'ol/style';
import { fromLonLat, transformExtent } from 'ol/proj';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiClient, gisProcClient } from '@/api/client';
import axios from 'axios';
import { getCachedMapImageUrl, clearMapCache } from '@/lib/mapCache';
import { MapPin, Loader2, Info, X, Droplets, Battery, Thermometer, Layers, AlertTriangle, CheckCircle2, Activity, Route, GitMerge, ArrowRight, RefreshCw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

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
  elevationCalibration?: string | number | null;
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
  name?: string | null;
  assignedSubBlocks?: string[] | null;
}

interface Embankment {
  id: string;
  name: string;
  code: string | null;
  polygonGeom: any;
  connectedSubBlocks: string[];
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




function getNodeCentroidWkt(node: any): string | null {
  if (!node) return null;
  if (node.centroid) return node.centroid;
  if (node.coordinatePoint) {
    const geom = typeof node.coordinatePoint === 'string'
      ? JSON.parse(node.coordinatePoint)
      : node.coordinatePoint;
    if (geom) {
      if (geom.type === 'Point' && geom.coordinates) {
        return `POINT(${geom.coordinates[0]} ${geom.coordinates[1]})`;
      }
      if (geom.type === 'MultiPoint' && Array.isArray(geom.coordinates) && geom.coordinates[0]) {
        return `POINT(${geom.coordinates[0][0]} ${geom.coordinates[0][1]})`;
      }
    }
  }
  return null;
}

// Parse a WKT POINT string into [lng, lat]
function parseWktPoint(wkt: string | null): [number, number] | null {
  if (!wkt) return null;
  const match = wkt.match(/POINT\s*\(\s*([\d.eE+\-]+)\s+([\d.eE+\-]+)\s*\)/i);
  if (!match) return null;
  return [parseFloat(match[1]), parseFloat(match[2])];
}

// Parse a GeoJSON polygon string into coordinate rings
function parsePolygonCoords(geomStr: string | null): [number, number][][] | null {
  if (!geomStr) return null;
  try {
    const geom = typeof geomStr === 'string' ? JSON.parse(geomStr) : geomStr;
    if (!geom) return null;
    if (geom.type === 'Polygon') return geom.coordinates as [number, number][][];
    if (geom.type === 'MultiPolygon') return geom.coordinates[0] as [number, number][][];
  } catch (_) {}
  return null;
}

// Build SVG polygon points string from geo-coordinates using a projection function
function geoRingToSvgPoints(
  ring: [number, number][],
  project: (lng: number, lat: number) => [number, number]
): string {
  return ring.map(([lng, lat]) => {
    const [sx, sy] = project(lng, lat);
    return `${sx},${sy}`;
  }).join(' ');
}

function IrrigationRouteGraph({
  matrixResult,
  subBlocks,
  sourceIndex,
  setSourceIndex,
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
      name: ip.name || (ip.pointType === 'source' ? 'SUMBER' : 'BUANG'),
      pointType: ip.pointType,
      coordinatePoint: ip.coordinatePoint,
      polygonGeom: null as string | null,
      centroid: getNodeCentroidWkt(ip),
      isIrrigationPoint: true,
    }))
  ];

  if (routes.length === 0) {
    return (
      <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>Belum ada data rute. Jalankan Analisis Aliran Air untuk melihat visualisasi.</span>
      </div>
    );
  }

  const sortedRoutes = [...routes].sort((a, b) => a.weight - b.weight);
  const maxRouteWeight = Math.max(...sortedRoutes.map((r) => r.weight));
  const minRouteWeight = Math.min(...sortedRoutes.map((r) => r.weight));

  // Build set of node indices on any route
  const routeNodeSet: Record<number, boolean> = {};
  sortedRoutes.forEach((route) => {
    route.path.forEach((nodeIdx) => { routeNodeSet[nodeIdx] = true; });
  });

  // ── Geo-projection setup ────────────────────────────────────────────
  const allGeoPoints: [number, number][] = [];
  allNodes.forEach((node) => {
    const rings = parsePolygonCoords((node as any).polygonGeom ?? null);
    if (rings) {
      rings[0].forEach(pt => allGeoPoints.push(pt));
    } else {
      const wkt = (node as any).centroid ?? getNodeCentroidWkt(node as any) ?? null;
      const pt = parseWktPoint(wkt);
      if (pt) allGeoPoints.push(pt);
    }
  });

  const hasGeoData = allGeoPoints.length > 0;
  const SVG_W = 360;
  const SVG_H = 300;
  const PAD = 28;

  let project: (lng: number, lat: number) => [number, number];
  if (hasGeoData) {
    const lngs = allGeoPoints.map(p => p[0]);
    const lats = allGeoPoints.map(p => p[1]);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const geoW = maxLng - minLng || 1e-9;
    const geoH = maxLat - minLat || 1e-9;
    const scaleX = (SVG_W - PAD * 2) / geoW;
    const scaleY = (SVG_H - PAD * 2) / geoH;
    const scale = Math.min(scaleX, scaleY);
    const offX = PAD + ((SVG_W - PAD * 2) - geoW * scale) / 2;
    const offY = PAD + ((SVG_H - PAD * 2) - geoH * scale) / 2;
    project = (lng, lat) => [
      offX + (lng - minLng) * scale,
      SVG_H - (offY + (lat - minLat) * scale), // invert Y (SVG is top-down, lat is bottom-up)
    ];
  } else {
    // Fallback: circular layout
    project = (lng, lat) => {
      const angle = (2 * Math.PI * lng) / (lat || 1) - Math.PI / 2;
      const r = Math.min(SVG_W, SVG_H) / 2 - PAD - 10;
      return [SVG_W / 2 + r * Math.cos(angle), SVG_H / 2 + r * Math.sin(angle)];
    };
  }

  // Compute centroid position in SVG space for each node
  interface NodeSvgInfo {
    idx: number;
    id: string;
    name: string;
    cx: number;
    cy: number;
    polygonSvgPoints: string | null;
    isIrrigationPoint: boolean;
    pointType?: string;
    onRoute: boolean;
    isSource: boolean;
  }

  const nodeSvgInfos: NodeSvgInfo[] = allNodes.map((node, idx) => {
    const isIrr = !!(node as any).isIrrigationPoint;
    const onRoute = !!routeNodeSet[idx];
    const isSource = idx === matrixResult.source;

    let cx = SVG_W / 2;
    let cy = SVG_H / 2;
    let polygonSvgPoints: string | null = null;

    const rings = parsePolygonCoords((node as any).polygonGeom ?? null);
    if (rings && rings[0] && rings[0].length > 0) {
      polygonSvgPoints = geoRingToSvgPoints(rings[0], project);
      const projected = rings[0].map(p => project(p[0], p[1]));
      cx = projected.reduce((a, b) => a + b[0], 0) / projected.length;
      cy = projected.reduce((a, b) => a + b[1], 0) / projected.length;
    } else {
      const wkt = (node as any).centroid ?? getNodeCentroidWkt(node as any) ?? null;
      const pt = parseWktPoint(wkt);
      if (pt) {
        [cx, cy] = project(pt[0], pt[1]);
      } else if (!hasGeoData) {
        const angle = (2 * Math.PI * idx) / allNodes.length - Math.PI / 2;
        const r = Math.min(SVG_W, SVG_H) / 2 - PAD - 10;
        cx = SVG_W / 2 + r * Math.cos(angle);
        cy = SVG_H / 2 + r * Math.sin(angle);
      }
    }

    return {
      idx,
      id: (node as any).id,
      name: (node as any).name,
      cx,
      cy,
      polygonSvgPoints,
      isIrrigationPoint: isIrr,
      pointType: (node as any).pointType,
      onRoute,
      isSource,
    };
  });

  const getRoutePriorityColor = (ratio: number): string => {
    if (ratio < 0.33) return '#10b981';
    if (ratio < 0.66) return '#f59e0b';
    return '#f43f5e';
  };

  const getPriorityLabel = (ratio: number): string => {
    if (ratio < 0.33) return 'Tinggi';
    if (ratio < 0.66) return 'Sedang';
    return 'Rendah';
  };

  // Collect all unique animated flow edges
  const flowEdges: Array<{
    key: string;
    x1: number; y1: number; x2: number; y2: number;
    color: string;
    animDuration: number;
  }> = [];
  const seenEdgeKeys = new Set<string>();

  sortedRoutes.forEach((route) => {
    const range = maxRouteWeight - minRouteWeight;
    const ratio = range > 0 ? (route.weight - minRouteWeight) / range : 0;
    const color = getRoutePriorityColor(ratio);
    const animDuration = 1.2 + ratio * 1.4;

    for (let k = 0; k < route.path.length - 1; k++) {
      const fromIdx = route.path[k];
      const toIdx = route.path[k + 1];
      const edgeKey = `${fromIdx}-${toIdx}`;
      if (seenEdgeKeys.has(edgeKey)) continue;
      seenEdgeKeys.add(edgeKey);
      const fromInfo = nodeSvgInfos[fromIdx];
      const toInfo = nodeSvgInfos[toIdx];
      if (!fromInfo || !toInfo) continue;
      flowEdges.push({
        key: edgeKey,
        x1: fromInfo.cx, y1: fromInfo.cy,
        x2: toInfo.cx, y2: toInfo.cy,
        color,
        animDuration,
      });
    }
  });

  // ── Pan / Zoom state ────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  // Pinch-zoom tracking
  const lastPinchDist = useRef<number | null>(null);
  // Tooltip state
  const [tooltip, setTooltip] = useState<{ nodeIdx: number; svgX: number; svgY: number } | null>(null);
  const svgContainerRef = useRef<SVGSVGElement>(null);

  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 6;
  const ZOOM_STEP = 1.25;

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  // Zoom toward a point in SVG-content coordinates
  const zoomToward = useCallback((newZoom: number, svgX: number, svgY: number) => {
    setZoom(prev => {
      const clamped = clampZoom(newZoom);
      const scale = clamped / prev;
      setPan(p => ({
        x: svgX - scale * (svgX - p.x),
        y: svgY - scale * (svgY - p.y),
      }));
      return clamped;
    });
  }, []);

  // Get SVG-space coordinates from a DOM mouse/touch event
  const getSvgPoint = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const el = svgContainerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const ratioX = SVG_W / rect.width;
    const ratioY = SVG_H / rect.height;
    return {
      x: (clientX - rect.left) * ratioX,
      y: (clientY - rect.top) * ratioY,
    };
  }, [SVG_W, SVG_H]);

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const pt = getSvgPoint(e.clientX, e.clientY);
    const delta = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    zoomToward(zoom * delta, pt.x, pt.y);
  }, [zoom, getSvgPoint, zoomToward]);

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.style.cursor = 'grabbing';
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    // Convert screen delta to SVG space
    const el = svgContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratioX = SVG_W / rect.width;
    const ratioY = SVG_H / rect.height;
    setPan(p => ({ x: p.x + dx * ratioX, y: p.y + dy * ratioY }));
  }, [SVG_W, SVG_H]);

  const handleMouseUp = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    isDragging.current = false;
    e.currentTarget.style.cursor = 'grab';
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 1) {
      isDragging.current = true;
      lastPointer.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastPinchDist.current = null;
    } else if (e.touches.length === 2) {
      isDragging.current = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.hypot(dx, dy);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging.current) {
      const dx = e.touches[0].clientX - lastPointer.current.x;
      const dy = e.touches[0].clientY - lastPointer.current.y;
      lastPointer.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      const el = svgContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPan(p => ({ x: p.x + dx * (SVG_W / rect.width), y: p.y + dy * (SVG_H / rect.height) }));
    } else if (e.touches.length === 2 && lastPinchDist.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / lastPinchDist.current;
      lastPinchDist.current = dist;
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const pt = getSvgPoint(midX, midY);
      zoomToward(zoom * scale, pt.x, pt.y);
    }
  }, [SVG_W, SVG_H, zoom, getSvgPoint, zoomToward]);

  const handleTouchEnd = useCallback(() => {
    isDragging.current = false;
    lastPinchDist.current = null;
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setTooltip(null);
  }, []);

  // Build route info per node for tooltip
  const nodeRouteInfo = (nodeIdx: number): { priority: number; label: string; color: string } | null => {
    const rIdx = sortedRoutes.findIndex(r => r.target === nodeIdx);
    if (rIdx === -1) return null;
    const route = sortedRoutes[rIdx];
    const range = maxRouteWeight - minRouteWeight;
    const ratio = range > 0 ? (route.weight - minRouteWeight) / range : 0;
    return { priority: rIdx + 1, label: getPriorityLabel(ratio), color: getRoutePriorityColor(ratio) };
  };

  const handleNodeClick = useCallback((nodeIdx: number, cx: number, cy: number) => {
    setTooltip(prev => (prev?.nodeIdx === nodeIdx ? null : { nodeIdx, svgX: cx, svgY: cy }));
  }, []);

  // Compute tooltip position in SVG space (above the node)
  const tooltipNode = tooltip !== null ? nodeSvgInfos[tooltip.nodeIdx] : null;
  const tooltipRouteInfo = tooltip !== null ? nodeRouteInfo(tooltip.nodeIdx) : null;

  return (
    <div className="border-t pt-6 mt-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-blue-500/10 p-2 rounded-lg">
          <Droplets className="h-4 w-4 text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-base font-bold tracking-tight text-foreground">Peta Aliran Air</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tata letak petak sawah sesuai posisi di lapangan. Animasi menunjukkan jalur air mengalir.
          </p>
        </div>
      </div>

      {/* Source selector */}
      <div className="bg-muted/40 p-4 rounded-xl border border-muted/50">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Sumber Air</label>
          <select
            value={sourceIndex}
            onChange={(e) => setSourceIndex(parseInt(e.target.value))}
            className="w-full text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 focus:ring-2 focus:ring-primary focus:border-primary cursor-pointer text-slate-900 dark:text-slate-100 font-semibold outline-none shadow-sm"
          >
            {allNodes.map((node, idx) => (
              <option
                key={(node as any).id}
                value={idx}
                className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium"
              >
                {idx + 1}. {(node as any).name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Geo-based water flow SVG — interactive pan/zoom */}
      <div className="relative bg-sky-950/10 dark:bg-sky-950/30 border border-sky-400/20 rounded-xl overflow-hidden select-none">
        {/* Water texture background */}
        <div className="absolute inset-0 opacity-5 pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="water-grid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M0,10 Q5,5 10,10 Q15,15 20,10" stroke="#38bdf8" strokeWidth="0.5" fill="none"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#water-grid)" />
          </svg>
        </div>

        {/* Zoom + pan hint */}
        <div className="absolute top-2 left-2 text-[9px] text-sky-400/70 font-medium pointer-events-none select-none flex items-center gap-1">
          <span>🖱 Scroll = zoom &nbsp;·&nbsp; Seret = geser</span>
        </div>

        {/* Zoom controls */}
        <div className="absolute top-2 right-2 flex flex-col gap-1 z-10">
          <button
            onClick={() => zoomToward(zoom * ZOOM_STEP, SVG_W / 2, SVG_H / 2)}
            className="w-7 h-7 rounded-md bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 shadow flex items-center justify-center hover:bg-white dark:hover:bg-slate-700 transition-colors"
            title="Perbesar"
          >
            <ZoomIn className="h-3.5 w-3.5 text-slate-700 dark:text-slate-200" />
          </button>
          <button
            onClick={() => zoomToward(zoom / ZOOM_STEP, SVG_W / 2, SVG_H / 2)}
            className="w-7 h-7 rounded-md bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 shadow flex items-center justify-center hover:bg-white dark:hover:bg-slate-700 transition-colors"
            title="Perkecil"
          >
            <ZoomOut className="h-3.5 w-3.5 text-slate-700 dark:text-slate-200" />
          </button>
          <button
            onClick={resetView}
            className="w-7 h-7 rounded-md bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 shadow flex items-center justify-center hover:bg-white dark:hover:bg-slate-700 transition-colors"
            title="Reset tampilan"
          >
            <Maximize2 className="h-3.5 w-3.5 text-slate-700 dark:text-slate-200" />
          </button>
        </div>

        {/* Zoom level badge */}
        <div className="absolute bottom-2 left-2 text-[9px] font-bold text-sky-400/60 pointer-events-none">
          {Math.round(zoom * 100)}%
        </div>

        <svg
          ref={svgContainerRef}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full"
          style={{ maxHeight: 340, cursor: 'grab', display: 'block', touchAction: 'none' }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={() => setTooltip(null)}
        >
          <defs>
            {flowEdges.map((edge) => (
              <marker
                key={`marker-${edge.key}`}
                id={`flow-arrow-${edge.key}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto"
              >
                <path d="M 0 2 L 9 5 L 0 8 z" fill={edge.color} />
              </marker>
            ))}
          </defs>

          {/* Pannable / zoomable content group */}
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Hidden paths for animateMotion mpath references */}
            {flowEdges.map((edge) => (
              <path
                key={`path-${edge.key}`}
                id={`path-${edge.key}`}
                d={`M ${edge.x1} ${edge.y1} L ${edge.x2} ${edge.y2}`}
                fill="none"
                stroke="none"
              />
            ))}

            {/* Background flow lines (static, dashed) */}
            {flowEdges.map((edge) => (
              <line
                key={`line-${edge.key}`}
                x1={edge.x1} y1={edge.y1}
                x2={edge.x2} y2={edge.y2}
                stroke={edge.color}
                strokeWidth={2.5 / zoom}
                strokeOpacity="0.25"
                strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                markerEnd={`url(#flow-arrow-${edge.key})`}
              />
            ))}

            {/* Animated water droplets */}
            {flowEdges.map((edge) => (
              <g key={`anim-${edge.key}`}>
                <circle r={4 / zoom} fill={edge.color} opacity="0.9">
                  <animateMotion dur={`${edge.animDuration}s`} repeatCount="indefinite" begin="0s">
                    <mpath href={`#path-${edge.key}`} />
                  </animateMotion>
                </circle>
                <circle r={3 / zoom} fill={edge.color} opacity="0.6">
                  <animateMotion dur={`${edge.animDuration}s`} repeatCount="indefinite" begin={`${edge.animDuration * 0.5}s`}>
                    <mpath href={`#path-${edge.key}`} />
                  </animateMotion>
                </circle>
              </g>
            ))}

            {/* Sub-block polygons */}
            {nodeSvgInfos.map((info) => {
              if (info.isIrrigationPoint) return null;
              const isHovered = tooltip?.nodeIdx === info.idx;
              const fillColor = info.isSource ? '#6366f1' : info.onRoute ? '#10b981' : '#94a3b8';
              const fillOpacity = isHovered ? 0.85 : info.onRoute || info.isSource ? 0.55 : 0.18;
              const strokeColor = isHovered ? '#f59e0b' : info.isSource ? '#6366f1' : info.onRoute ? '#059669' : '#64748b';
              const strokeOpacity = info.onRoute || info.isSource ? 0.9 : 0.4;

              return (
                <g
                  key={info.id}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); handleNodeClick(info.idx, info.cx, info.cy); }}
                >
                  {info.polygonSvgPoints ? (
                    <polygon
                      points={info.polygonSvgPoints}
                      fill={fillColor}
                      fillOpacity={fillOpacity}
                      stroke={strokeColor}
                      strokeWidth={(isHovered ? 3 : info.isSource ? 2.5 : 1.5) / zoom}
                      strokeOpacity={strokeOpacity}
                    />
                  ) : (
                    <rect
                      x={info.cx - 14} y={info.cy - 10}
                      width={28} height={20} rx={4}
                      fill={fillColor} fillOpacity={fillOpacity}
                      stroke={strokeColor} strokeWidth={(isHovered ? 3 : info.isSource ? 2.5 : 1.5) / zoom}
                      strokeOpacity={strokeOpacity}
                    />
                  )}
                  <text
                    x={info.cx} y={info.cy + 1}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={8 / zoom} fontWeight="700"
                    fill={info.onRoute || info.isSource ? '#ffffff' : '#64748b'}
                    style={{ pointerEvents: 'none' }}
                  >
                    {info.name.length > 10 ? info.name.slice(0, 9) + '\u2026' : info.name}
                  </text>
                </g>
              );
            })}

            {/* Priority number badges on destination sub-blocks */}
            {sortedRoutes.map((route, rIdx) => {
              const range = maxRouteWeight - minRouteWeight;
              const ratio = range > 0 ? (route.weight - minRouteWeight) / range : 0;
              const color = getRoutePriorityColor(ratio);
              const targetInfo = nodeSvgInfos[route.target];
              if (!targetInfo) return null;
              const badgeR = 8 / zoom;
              return (
                <g key={`badge-${rIdx}`} style={{ pointerEvents: 'none' }}>
                  <circle cx={targetInfo.cx + 10} cy={targetInfo.cy - 10} r={badgeR} fill={color} stroke="#fff" strokeWidth={1.5 / zoom} />
                  <text x={targetInfo.cx + 10} y={targetInfo.cy - 10} textAnchor="middle" dominantBaseline="middle" fontSize={7 / zoom} fontWeight="800" fill="#ffffff">
                    {rIdx + 1}
                  </text>
                </g>
              );
            })}

            {/* Irrigation point icons */}
            {nodeSvgInfos.map((info) => {
              if (!info.isIrrigationPoint) return null;
              const isWaterSource = info.pointType === 'source';
              const bgColor = isWaterSource ? '#3b82f6' : '#f43f5e';
              const isSelectedSource = info.idx === matrixResult.source;
              const isHovered = tooltip?.nodeIdx === info.idx;
              return (
                <g
                  key={info.id}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); handleNodeClick(info.idx, info.cx, info.cy); }}
                >
                  {isSelectedSource && (
                    <circle cx={info.cx} cy={info.cy} r={18 / zoom} fill="none" stroke="#6366f1" strokeWidth={2 / zoom} strokeDasharray={`${3 / zoom} ${2 / zoom}`} opacity="0.7">
                      <animateTransform
                        attributeName="transform" attributeType="XML" type="rotate"
                        from={`0 ${info.cx} ${info.cy}`} to={`360 ${info.cx} ${info.cy}`}
                        dur="6s" repeatCount="indefinite"
                      />
                    </circle>
                  )}
                  <circle cx={info.cx} cy={info.cy} r={13 / zoom} fill={bgColor} stroke={isHovered ? '#f59e0b' : '#ffffff'} strokeWidth={2 / zoom} opacity="0.95" />
                  <text x={info.cx} y={info.cy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={9 / zoom} fontWeight="700" fill="#ffffff">
                    {isWaterSource ? '\ud83d\udca7' : '\u2193'}
                  </text>
                  <text x={info.cx} y={info.cy + 20 / zoom} textAnchor="middle" fontSize={7.5 / zoom} fontWeight="700" fill={bgColor}>
                    {info.name.length > 8 ? info.name.slice(0, 7) + '\u2026' : info.name}
                  </text>
                </g>
              );
            })}

            {/* Tooltip bubble */}
            {tooltip !== null && tooltipNode && (() => {
              const tx = tooltipNode.cx;
              const ty = tooltipNode.cy - 24 / zoom;
              const routeInfo = tooltipRouteInfo;
              const isIrr = tooltipNode.isIrrigationPoint;
              const lines: string[] = [tooltipNode.name];
              if (routeInfo) lines.push(`Urutan: #${routeInfo.priority} (${routeInfo.label})`);
              else if (!isIrr) lines.push('Tidak dalam rute aktif');
              if (isIrr) lines.push(tooltipNode.pointType === 'source' ? 'Sumber Air' : 'Titik Buang');
              const bubbleW = 100 / zoom;
              const lineH = 11 / zoom;
              const bubbleH = (lines.length * lineH) + 12 / zoom;
              const bubbleFill = routeInfo ? routeInfo.color : '#1e293b';
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <rect
                    x={tx - bubbleW / 2}
                    y={ty - bubbleH}
                    width={bubbleW}
                    height={bubbleH}
                    rx={6 / zoom}
                    fill={bubbleFill}
                    fillOpacity="0.92"
                  />
                  {/* caret */}
                  <polygon
                    points={`${tx - 5 / zoom},${ty} ${tx + 5 / zoom},${ty} ${tx},${ty + 6 / zoom}`}
                    fill={bubbleFill}
                    fillOpacity="0.92"
                  />
                  {lines.map((line, li) => (
                    <text
                      key={li}
                      x={tx}
                      y={ty - bubbleH + 8 / zoom + li * lineH}
                      textAnchor="middle"
                      fontSize={7 / zoom}
                      fontWeight={li === 0 ? '800' : '500'}
                      fill="#ffffff"
                    >
                      {line}
                    </text>
                  ))}
                </g>
              );
            })()}
          </g>
        </svg>
      </div>

      {/* Farmer-friendly route list — clicking a row highlights the target on map */}
      <div className="space-y-2">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Urutan Pengairan (Prioritas)</span>
        <div className="space-y-1.5">
          {sortedRoutes.map((route, rIdx) => {
            const targetNode = allNodes[route.target] as any;
            const range = maxRouteWeight - minRouteWeight;
            const ratio = range > 0 ? (route.weight - minRouteWeight) / range : 0;
            const color = getRoutePriorityColor(ratio);
            const label = getPriorityLabel(ratio);
            const badgeBg = ratio < 0.33 ? 'bg-emerald-500' : ratio < 0.66 ? 'bg-amber-400' : 'bg-rose-400';
            const pathNames = route.path.map(nodeIdx => {
              const n = allNodes[nodeIdx] as any;
              return n ? n.name : `Petak ${nodeIdx + 1}`;
            });
            const isHighlighted = tooltip?.nodeIdx === route.target;
            return (
              <div
                key={rIdx}
                className={`bg-card border rounded-lg px-3 py-2.5 space-y-1.5 cursor-pointer transition-shadow ${
                  isHighlighted ? 'ring-2 ring-offset-1 shadow-md' : 'hover:shadow-sm'
                }`}

                onClick={() => {
                  const info = nodeSvgInfos[route.target];
                  if (info) handleNodeClick(route.target, info.cx, info.cy);
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0" style={{ backgroundColor: color }}>
                    {rIdx + 1}
                  </span>
                  <span className="text-xs font-semibold text-foreground flex-1">
                    {targetNode ? targetNode.name : `Petak ${route.target + 1}`}
                  </span>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full text-white ${badgeBg}`}>{label}</span>
                </div>
                <div className="flex items-center gap-1 flex-wrap pl-7">
                  <Droplets className="h-3 w-3 text-blue-400 shrink-0" />
                  {pathNames.map((name, pIdx) => (
                    <span key={pIdx} className="flex items-center gap-1">
                      <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-semibold">{name}</span>
                      {pIdx < pathNames.length - 1 && <ArrowRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground bg-muted/30 p-3 rounded-lg border">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
          <span>Sumber Air</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-rose-400 inline-block" />
          <span>Titik Buang</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
          <span>Petak diairi</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-6 h-1.5 rounded inline-block" style={{ background: 'linear-gradient(to right, #10b981, #f59e0b, #f43f5e)' }} />
          <span>Hijau = Prioritas tinggi</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">1</span>
          <span>= Urutan pengairan</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-amber-400 font-bold">✦</span>
          <span>Klik petak = info detail</span>
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
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshMap = async () => {
    const field = fields.find(f => f.id === selectedFieldId);
    if (!field) return;

    try {
      setRefreshing(true);
      if (field.mapVisualUrl) {
        await clearMapCache(field.mapVisualUrl, field.name);
      }
      setRefreshKey(prev => prev + 1);
    } catch (err) {
      console.error('Failed to refresh map cache', err);
    } finally {
      setRefreshing(false);
    }
  };

  
  const [selectedSubBlock, setSelectedSubBlock] = useState<{ id: string; name: string } | null>(null);
  const [telemetryHistory, setTelemetryHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const handleMouseLeave = () => {
    setHoveredIndex(null);
  };


  const [fieldHistory, setFieldHistory] = useState<any[]>([]);
  const [loadingFieldHistory, setLoadingFieldHistory] = useState(false);
  const [activeTab, setActiveTab] = useState<'water' | 'temp'>('water');
  const [fieldHoveredPct, setFieldHoveredPct] = useState<number | null>(null);

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
  const [embankments, setEmbankments] = useState<Embankment[]>([]);
  const [devices, setDevices] = useState<any[]>([]);

  // Telemetry Heatmap State & Refs
  const [subBlockTelemetryMap, setSubBlockTelemetryMap] = useState<Record<string, any>>({});
  const subBlockTelemetryMapRef = useRef<Record<string, any>>({});
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  // Auto-fetch latest telemetry state when subblocks load
  useEffect(() => {
    if (subBlocks.length === 0) {
      setSubBlockTelemetryMap({});
      subBlockTelemetryMapRef.current = {};
      return;
    }
    Promise.all(
      subBlocks.map(sb =>
        apiClient.get(`/telemetry/sub-blocks/${sb.id}/states/latest`)
          .then(r => ({ id: sb.id, telem: r.data.data }))
          .catch(() => ({ id: sb.id, telem: null }))
      )
    ).then(results => {
      const mapData: Record<string, any> = {};
      results.forEach(res => { if (res.telem) mapData[res.id] = res.telem; });
      subBlockTelemetryMapRef.current = mapData;
      setSubBlockTelemetryMap(mapData);
      vectorSource.current?.changed();
    });
  }, [subBlocks]);

  useEffect(() => {
    vectorSource.current?.changed();
  }, [activeTab]);

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
          name: ip.name || (ip.pointType === 'source' ? 'SUMBER' : 'BUANG'),
          pointType: ip.pointType,
          coordinatePoint: ip.coordinatePoint,
          elevationM: ip.elevationM,
          isIrrigationPoint: true,
          areaM2: 0.0001,
        }))
      ];

      // Find field-wide calibration offset if any sub-block has it
      // Find field-wide calibration offset if any sub-block has it
      const subBlockWithCal = subBlocks.find(sb => sb.elevationCalibration !== null && sb.elevationCalibration !== undefined && sb.elevationM !== null && sb.elevationM !== undefined);
      const fieldCalOffset = subBlockWithCal && subBlockWithCal.elevationCalibration && subBlockWithCal.elevationM
        ? parseFloat(subBlockWithCal.elevationCalibration.toString()) - parseFloat(subBlockWithCal.elevationM.toString())
        : 0;

      const nodesPayload = allNodes.map(node => {
        let water_height = 0;
        let optimal_height = 0;
        let area = 0.0001;

        const isIrrigation = 'isIrrigationPoint' in node && (node as any).isIrrigationPoint === true;
        let elevation = 0;
        if (!isIrrigation) {
          const sb = node as SubBlock;
          if (sb.elevationCalibration !== null && sb.elevationCalibration !== undefined) {
            elevation = parseFloat(sb.elevationCalibration.toString());
          } else {
            elevation = sb.elevationM !== null ? parseFloat(sb.elevationM as string) : 0;
          }

          const waterHeightVal = stateMap[sb.id];
          water_height = waterHeightVal != null ? parseFloat(waterHeightVal) : 0;
          optimal_height = optimalHeight != null ? parseFloat(optimalHeight as any) : 0;
          area = sb.areaM2 !== null ? parseFloat(sb.areaM2 as any) : 0;
        } else {
          const base = node.elevationM !== null ? parseFloat(node.elevationM as string) : 0;
          elevation = base + fieldCalOffset;
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
    setHoveredIndex(null);
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

            const isEmbankment = feature.get('isEmbankment');
            if (isEmbankment) {
              return new Style({
                stroke: new Stroke({
                  color: '#9333ea',
                  width: 2.5,
                }),
                fill: new Fill({
                  color: 'rgba(147, 51, 234, 0.2)',
                }),
                text: new Text({
                  text: feature.get('name'),
                  font: 'bold 11px Inter, sans-serif',
                  fill: new Fill({ color: '#6b21a8' }),
                  stroke: new Stroke({ color: '#fff', width: 2 }),
                }),
              });
            }

            const sbId = feature.get('id');
            const telem = subBlockTelemetryMapRef.current[sbId];
            let color = 'rgba(34, 197, 94, 0.25)'; // Default green
            let strokeColor = '#16a34a';
            let textColor = '#166534';

            if (telem) {
              const tab = activeTabRef.current;
              if (tab === 'water' && telem.waterLevelCm !== null && telem.waterLevelCm !== undefined) {
                const wl = parseFloat(telem.waterLevelCm);
                if (wl > 5) {
                  color = 'rgba(59, 130, 246, 0.45)'; // Biru (Tergenang)
                  strokeColor = '#2563eb';
                  textColor = '#1e40af';
                } else if (wl >= -5) {
                  color = 'rgba(34, 197, 94, 0.45)'; // Hijau (Optimal AWD)
                  strokeColor = '#16a34a';
                  textColor = '#166534';
                } else if (wl >= -15) {
                  color = 'rgba(245, 158, 11, 0.45)'; // Kuning (Warning Kering)
                  strokeColor = '#d97706';
                  textColor = '#92400e';
                } else {
                  color = 'rgba(239, 68, 68, 0.5)'; // Merah (Kritis)
                  strokeColor = '#dc2626';
                  textColor = '#991b1b';
                }
              } else if (tab === 'temp' && (telem.temperatureC !== null || telem.tempC !== null)) {
                const tc = parseFloat(telem.temperatureC ?? telem.tempC ?? 28);
                if (tc > 32) {
                  color = 'rgba(239, 68, 68, 0.45)'; // Panas
                  strokeColor = '#dc2626';
                  textColor = '#991b1b';
                } else if (tc > 28) {
                  color = 'rgba(245, 158, 11, 0.45)'; // Normal Hangat
                  strokeColor = '#d97706';
                  textColor = '#92400e';
                } else {
                  color = 'rgba(59, 130, 246, 0.45)'; // Sejuk
                  strokeColor = '#2563eb';
                  textColor = '#1e40af';
                }
              } else if (tab === 'humidity' && (telem.humidityPct !== null || telem.humidity !== null)) {
                const hm = parseFloat(telem.humidityPct ?? telem.humidity ?? 70);
                if (hm < 60) {
                  color = 'rgba(245, 158, 11, 0.45)'; // Kering
                  strokeColor = '#d97706';
                  textColor = '#92400e';
                } else {
                  color = 'rgba(16, 185, 129, 0.45)'; // Lembab
                  strokeColor = '#059669';
                  textColor = '#065f46';
                }
              }
            }

            return new Style({
              stroke: new Stroke({
                color: strokeColor,
                width: 2.5,
              }),
              fill: new Fill({
                color,
              }),
              text: new Text({
                text: feature.get('name'),
                font: 'bold 12px Inter, sans-serif',
                fill: new Fill({ color: textColor }),
                stroke: new Stroke({ color: '#fff', width: 2.5 }),
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
  }, [selectedFieldId, fields, refreshKey]);

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

  // 3b. Fetch Sub-blocks, Irrigation Points, Embankments & Devices data for the irrigation management card
  useEffect(() => {
    if (!selectedFieldId) return;
    const fetchSubBlocksData = async () => {
      try {
        setLoadingSubBlocks(true);
        const [subBlocksRes, pointsRes, embankmentsRes, devicesRes] = await Promise.all([
          apiClient.get(`/fields/${selectedFieldId}/sub-blocks`),
          apiClient.get(`/fields/${selectedFieldId}/irrigation-points`),
          apiClient.get(`/fields/${selectedFieldId}/embankments`).catch(() => ({ data: { data: [] } })),
          apiClient.get(`/fields/${selectedFieldId}/devices`)
        ]);
        setSubBlocks(subBlocksRes.data.data);
        setIrrigationPoints(pointsRes.data.data);
        setEmbankments(embankmentsRes.data.data || []);
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

  // Derive sub-block connections from embankments' connectedSubBlocks.
  // Each embankment lists the sub-blocks it borders — all pairs within that list
  // become bidirectional edges (water can flow between adjacent sub-blocks).
  useEffect(() => {
    if (!selectedFieldId) {
      setSubBlockConnections({});
      return;
    }

    const connections: Record<string, string[]> = {};

    const addEdge = (fromId: string, toId: string) => {
      if (!connections[fromId]) connections[fromId] = [];
      if (!connections[fromId].includes(toId)) connections[fromId].push(toId);
    };

    // Build bidirectional edges from embankments' connectedSubBlocks
    for (const emb of embankments) {
      const connected = emb.connectedSubBlocks ?? [];
      // Every pair of sub-blocks sharing the same embankment can flow to each other
      for (let i = 0; i < connected.length; i++) {
        for (let j = i + 1; j < connected.length; j++) {
          addEdge(connected[i], connected[j]);
          addEdge(connected[j], connected[i]);
        }
      }
    }

    // Add edges for irrigation points based on assignedSubBlocks
    for (const ip of irrigationPoints) {
      const assigned = ip.assignedSubBlocks ?? [];
      for (const sbId of assigned) {
        if (ip.pointType === 'source') {
          addEdge(ip.id, sbId);
        } else {
          addEdge(sbId, ip.id);
        }
      }
    }

    // Fallback: if no embankment-derived edges, try loading from saved irrigationEdges
    if (Object.keys(connections).length === 0) {
      try {
        const field = fields.find(f => f.id === selectedFieldId);
        const edges = field?.irrigationEdges;
        if (Array.isArray(edges) && edges.length > 0) {
          edges.forEach(edge => {
            if (edge && edge.from && edge.to) {
              addEdge(edge.from, edge.to);
            }
          });
        }
      } catch (e) {
        console.error('Error loading subBlockConnections fallback from irrigationEdges', e);
      }
    }

    setSubBlockConnections(connections);
  }, [subBlocks, irrigationPoints, embankments, selectedFieldId, fields]);



  // 3. Fetch & Render Sub-blocks, Irrigation Points & Devices for Selected Field
  useEffect(() => {
    if (!selectedFieldId || !map) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        const [subBlocksRes, pointsRes, devicesRes, embankmentsRes] = await Promise.all([
          apiClient.get(`/fields/${selectedFieldId}/sub-blocks`),
          apiClient.get(`/fields/${selectedFieldId}/irrigation-points`),
          apiClient.get(`/fields/${selectedFieldId}/devices`),
          apiClient.get(`/fields/${selectedFieldId}/embankments`).catch(() => ({ data: { data: [] } }))
        ]);

        const subBlocks: SubBlock[] = subBlocksRes.data.data;
        const points: IrrigationPoint[] = pointsRes.data.data;
        const devicesData: any[] = devicesRes.data.data || [];
        const embankments: any[] = embankmentsRes.data.data || [];

        vectorSource.current.clear();

        const geojsonFormat = new GeoJSON();
        const wkbFormat = new WKB();
        const parseGeomData = (rawGeom: any) => {
          if (!rawGeom) return null;
          if (typeof rawGeom === 'string') {
            if (rawGeom.startsWith('01') || rawGeom.startsWith('00')) {
              try {
                const olGeom = wkbFormat.readGeometry(rawGeom);
                return geojsonFormat.writeGeometryObject(olGeom);
              } catch (e) {
                return null;
              }
            }
            try { return JSON.parse(rawGeom); } catch (e) { return null; }
          }
          return rawGeom;
        };

        const features: any[] = [];

        subBlocks.forEach((sb) => {
          if (!sb.polygonGeom) return;
          try {
            const geom = parseGeomData(sb.polygonGeom);
            
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

        embankments.forEach((emb) => {
          const raw = emb.polygonGeom || emb.polygon_geom;
          if (!raw) return;
          try {
            const geom = parseGeomData(raw);
            
            if (!geom || !geom.coordinates || geom.coordinates.length === 0) return;
            
            const feature = geojsonFormat.readFeature(
              {
                type: 'Feature',
                geometry: geom,
                properties: { 
                  id: emb.id, 
                  name: emb.name,
                  isEmbankment: true
                },
              },
              {
                dataProjection: 'EPSG:4326',
                featureProjection: 'EPSG:3857',
              }
            );
            features.push(feature);
          } catch (e) {
            console.error(`Invalid geometry for embankment ${emb.name}`, e);
          }
        });

        points.forEach((ip) => {
          if (!ip.coordinatePoint) return;
          try {
            const geom = parseGeomData(ip.coordinatePoint);

            if (!geom || !geom.coordinates || geom.coordinates.length === 0) return;

            const feature = geojsonFormat.readFeature(
              {
                type: 'Feature',
                geometry: geom,
                properties: { 
                  id: ip.id, 
                  name: ip.name || (ip.pointType === 'source' ? 'SUMBER' : 'BUANG'),
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
              const geom = parseGeomData(d.coordinate);
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
            
            const imageUrl = await getCachedMapImageUrl(field.mapVisualUrl, field.name);
            
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
  }, [selectedFieldId, map, refreshKey]);

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

        {/* Interactive Telemetry Heatmap Legend */}
        <div className="absolute bottom-4 left-4 z-20 bg-background/85 backdrop-blur-md border border-white/20 rounded-xl p-3 shadow-2xl max-w-xs transition-all duration-300">
          <div className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5 border-b pb-1.5">
            <Layers className="w-3.5 h-3.5 text-primary animate-pulse" />
            <span>Legenda Heatmap ({activeTab === 'water' ? 'Tinggi Air' : activeTab === 'temp' ? 'Suhu' : 'Kelembaban'})</span>
          </div>
          <div className="flex flex-col gap-1.5 text-[11px] font-medium">
            {activeTab === 'water' && (
              <>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-blue-500/80 border border-blue-600 shadow-sm" /><span>Tergenang / Full (&gt; +5 cm)</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-green-500/80 border border-green-600 shadow-sm" /><span>Optimal AWD (-5 s.d. +5 cm)</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-amber-500/80 border border-amber-600 shadow-sm" /><span>Peringatan Kering (-15 s.d. -5 cm)</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-red-500/80 border border-red-600 shadow-sm" /><span>Kering Kritis (&lt; -15 cm)</span></div>
              </>
            )}
            {activeTab === 'temp' && (
              <>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-blue-500/80 border border-blue-600 shadow-sm" /><span>Sejuk (&lt; 28°C)</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-amber-500/80 border border-amber-600 shadow-sm" /><span>Normal Hangat (28 s.d. 32°C)</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-red-500/80 border border-red-600 shadow-sm" /><span>Panas (&gt; 32°C)</span></div>
              </>
            )}
            {activeTab === 'humidity' && (
              <>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-amber-500/80 border border-amber-600 shadow-sm" /><span>Kering (&lt; 60%)</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-emerald-500/80 border border-emerald-600 shadow-sm" /><span>Lembab (&gt; 60%)</span></div>
              </>
            )}
          </div>
        </div>

        {/* Slide-Out Analytics Drawer */}
        {selectedSubBlock && (
          <div className="absolute top-0 right-0 h-full w-96 bg-background/95 backdrop-blur-md border-l shadow-2xl z-30 animate-in slide-in-from-right duration-300 flex flex-col">
            {/* Drawer Header */}
            <div className="flex flex-col p-4 border-b gap-3">
              <div className="flex items-center justify-between">
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
              <div className="flex gap-2">
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="w-full text-xs"
                  onClick={async () => {
                    if (confirm('Laporkan pematang untuk kotak ini telah diperbaiki?')) {
                      try {
                        await apiClient.post(`/sub-blocks/${selectedSubBlock.id}/resolve-embankment`);
                        alert('Status darurat dicabut');
                      } catch (e) {
                        alert('Gagal mencabut status darurat');
                      }
                    }
                  }}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1 text-green-500" />
                  Pematang Diperbaiki
                </Button>
              </div>
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
                  {(() => {
                    // ── Chart layout constants ─────────────────────────
                    const VW = 320;   // viewBox width
                    const VH = 130;   // viewBox height
                    const LEFT = 38;  // left margin for Y-axis labels
                    const RIGHT = 8;  // right margin
                    const TOP = 12;   // top margin
                    const BOT = 22;   // bottom margin for time labels
                    const CW = VW - LEFT - RIGHT;  // chart width
                    const CH = VH - TOP - BOT;     // chart height

                    // ── Water: absolute min = 0, max = data max + 15% padding ─
                    const waterVals = telemetryHistory.map((d: any) => Math.max(0, parseFloat(d.waterLevelCm || 0)));
                    const waterMax = Math.max(...waterVals, 10);
                    // Add 10% headroom so line doesn't hug the top
                    const waterAxisMax = waterMax * 1.15;
                    const waterAxisMin = 0;
                    const waterAxisRange = waterAxisMax - waterAxisMin;

                    // ── Temp: normalized to data range ± comfortable padding ─
                    const tempVals = telemetryHistory.map((d: any) => parseFloat(d.temperatureC || 0));
                    const tempDataMin = Math.min(...tempVals);
                    const tempDataMax = Math.max(...tempVals);
                    const tempDataRange = Math.max(tempDataMax - tempDataMin, 1);
                    // Padding = 20% of range, minimum 1°C each side
                    const tempPad = Math.max(tempDataRange * 0.2, 1);
                    const tempAxisMin = tempDataMin - tempPad;
                    const tempAxisMax = tempDataMax + tempPad;
                    const tempAxisRange = tempAxisMax - tempAxisMin;

                    // ── Projection helpers ─────────────────────────────
                    const xOf = (i: number) => LEFT + (i / (telemetryHistory.length - 1)) * CW;
                    const yOfWater = (v: number) => TOP + CH - ((Math.max(waterAxisMin, Math.min(waterAxisMax, v)) - waterAxisMin) / waterAxisRange) * CH;
                    const yOfTemp = (v: number) => TOP + CH - ((Math.max(tempAxisMin, Math.min(tempAxisMax, v)) - tempAxisMin) / tempAxisRange) * CH;

                    // ── Grid Y-values (3 lines: max, mid, min) ─────────
                    const waterGridLines = [waterAxisMin, waterAxisMin + waterAxisRange / 2, waterAxisMax];
                    const tempGridLines  = [tempAxisMin,  tempAxisMin + tempAxisRange / 2,  tempAxisMax];

                    // ── Build polyline points string ───────────────────
                    const buildPoints = (yFn: (v: number) => number, vals: number[]) =>
                      vals.map((v, i) => `${xOf(i)},${yFn(v)}`).join(' ');

                    const buildAreaPoints = (yFn: (v: number) => number, vals: number[], baseline: number) => {
                      const first = `${xOf(0)},${yFn(baseline)}`;
                      const last  = `${xOf(vals.length - 1)},${yFn(baseline)}`;
                      return `${first} ${vals.map((v, i) => `${xOf(i)},${yFn(v)}`).join(' ')} ${last}`;
                    };

                    // ── Time-axis labels (start, mid, end) ─────────────
                    const n = telemetryHistory.length;
                    const timeLabelIdxs = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : [0, n - 1];
                    const fmtTime = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                    // ── Hover state ────────────────────────────────────
                    const hoverIdx = hoveredIndex;
                    const hoverX = hoverIdx !== null && n > 1 ? xOf(hoverIdx) : null;

                    const hoverWater = hoverIdx !== null ? waterVals[hoverIdx] : null;
                    const hoverTemp  = hoverIdx !== null ? tempVals[hoverIdx]  : null;
                    const hoverTs    = hoverIdx !== null ? telemetryHistory[hoverIdx]?.eventTimestamp : null;

                    // ── Shared SVG mouse handler ───────────────────────
                    const svgMoveHandler = (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
                      if (n <= 1) return;
                      const svg = e.currentTarget;
                      const rect = svg.getBoundingClientRect();
                      let clientX: number;
                      if ('touches' in e) {
                        if (e.touches.length === 0) return;
                        clientX = e.touches[0].clientX;
                      } else {
                        clientX = (e as React.MouseEvent).clientX;
                      }
                      const rawX = ((clientX - rect.left) / rect.width) * VW;
                      const pct = (rawX - LEFT) / CW;
                      const idx = Math.round(pct * (n - 1));
                      setHoveredIndex(Math.max(0, Math.min(n - 1, idx)));
                    };

                    // ── Tooltip bubble renderer ────────────────────────
                    const TooltipBubble = ({
                      x, y, value, unit, color,
                    }: { x: number; y: number; value: string; unit: string; color: string }) => {
                      const bw = 62; const bh = 20; const br = 4;
                      const bx = Math.min(Math.max(x - bw / 2, LEFT), VW - RIGHT - bw);
                      const by = y - bh - 6;
                      return (
                        <g style={{ pointerEvents: 'none' }}>
                          <rect x={bx} y={by} width={bw} height={bh} rx={br} fill={color} opacity="0.92" />
                          <polygon
                            points={`${x - 4},${by + bh} ${x + 4},${by + bh} ${x},${by + bh + 5}`}
                            fill={color} opacity="0.92"
                          />
                          <text x={bx + bw / 2} y={by + bh / 2 + 1} textAnchor="middle" dominantBaseline="middle"
                            fontSize="9" fontWeight="700" fill="#fff">
                            {value} {unit}
                          </text>
                        </g>
                      );
                    };

                    return (
                      <div className="space-y-5">
                        {/* ── Timestamp header when hovering ── */}
                        <div className={`h-7 flex items-center justify-center transition-opacity ${hoverIdx !== null ? 'opacity-100' : 'opacity-0'}`}>
                          <span className="bg-primary/8 border border-primary/20 text-primary text-[11px] font-semibold px-3 py-1 rounded-full">
                            {hoverTs ? new Date(hoverTs).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : ''}
                          </span>
                        </div>

                        {/* ── Water Height Chart ── */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-xs font-semibold">
                            <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                              <Droplets className="h-3.5 w-3.5" />
                              <span>Ketinggian Air</span>
                            </div>
                            <span className="font-mono bg-blue-500/10 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded text-[11px] font-bold tabular-nums">
                              {hoverWater !== null
                                ? `${hoverWater.toFixed(1)} cm`
                                : `${waterVals[n - 1]?.toFixed(1) ?? '—'} cm (Terbaru)`}
                            </span>
                          </div>

                          <div className="w-full bg-slate-900/5 dark:bg-slate-50/5 border rounded-xl overflow-hidden select-none">
                            {n > 1 ? (
                              <svg
                                viewBox={`0 0 ${VW} ${VH}`}
                                preserveAspectRatio="xMidYMid meet"
                                className="w-full h-auto cursor-crosshair"
                                style={{ maxHeight: 120 }}
                                onMouseMove={svgMoveHandler}
                                onTouchMove={svgMoveHandler}
                                onMouseLeave={handleMouseLeave}
                                onTouchEnd={handleMouseLeave}
                              >
                                <defs>
                                  <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#2563eb" stopOpacity="0.35" />
                                    <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
                                  </linearGradient>
                                  <clipPath id="wClip">
                                    <rect x={LEFT} y={TOP} width={CW} height={CH} />
                                  </clipPath>
                                </defs>

                                {/* Y-axis grid lines + labels */}
                                {waterGridLines.map((gv, gi) => {
                                  const gy = yOfWater(gv);
                                  return (
                                    <g key={gi}>
                                      <line x1={LEFT} y1={gy} x2={LEFT + CW} y2={gy}
                                        stroke="rgba(148,163,184,0.2)"
                                        strokeWidth={gi === 0 ? 1.5 : 1}
                                        strokeDasharray={gi === 1 ? '3 3' : undefined}
                                      />
                                      <text x={LEFT - 3} y={gy} textAnchor="end" dominantBaseline="middle"
                                        fontSize="8" fill="rgba(148,163,184,0.9)" fontFamily="monospace">
                                        {gv.toFixed(0)}
                                      </text>
                                    </g>
                                  );
                                })}
                                {/* Unit label */}
                                <text x={LEFT - 3} y={TOP - 4} textAnchor="end" fontSize="7" fill="rgba(148,163,184,0.7)">cm</text>

                                {/* Area fill */}
                                <polygon
                                  points={buildAreaPoints(yOfWater, waterVals, waterAxisMin)}
                                  fill="url(#wGrad)"
                                  clipPath="url(#wClip)"
                                />
                                {/* Line */}
                                <polyline
                                  points={buildPoints(yOfWater, waterVals)}
                                  fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                  clipPath="url(#wClip)"
                                />

                                {/* Time labels on X-axis */}
                                {timeLabelIdxs.map(ti => (
                                  <text key={ti} x={xOf(ti)} y={VH - 4}
                                    textAnchor={ti === 0 ? 'start' : ti === n - 1 ? 'end' : 'middle'}
                                    fontSize="8" fill="rgba(148,163,184,0.8)" fontFamily="monospace">
                                    {fmtTime(telemetryHistory[ti]?.eventTimestamp)}
                                  </text>
                                ))}

                                {/* Hover crosshair + tooltip */}
                                {hoverX !== null && hoverWater !== null && hoverIdx !== null && (
                                  <>
                                    <line x1={hoverX} y1={TOP} x2={hoverX} y2={TOP + CH}
                                      stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 2" />
                                    <circle
                                      cx={hoverX} cy={yOfWater(hoverWater)}
                                      r="4.5" fill="#2563eb" stroke="#fff" strokeWidth="2"
                                    />
                                    <TooltipBubble
                                      x={hoverX} y={yOfWater(hoverWater)}
                                      value={hoverWater.toFixed(1)} unit="cm" color="#2563eb"
                                    />
                                  </>
                                )}
                              </svg>
                            ) : (
                              <div className="h-[130px] flex items-center justify-center text-xs text-muted-foreground">
                                Butuh minimal 2 data untuk menampilkan grafik
                              </div>
                            )}
                          </div>
                        </div>

                        {/* ── Temperature Chart ── */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-xs font-semibold">
                            <div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
                              <Thermometer className="h-3.5 w-3.5" />
                              <span>Suhu Udara</span>
                            </div>
                            <span className="font-mono bg-orange-500/10 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded text-[11px] font-bold tabular-nums">
                              {hoverTemp !== null
                                ? `${hoverTemp.toFixed(1)} °C`
                                : `${tempVals[n - 1]?.toFixed(1) ?? '—'} °C (Terbaru)`}
                            </span>
                          </div>

                          <div className="w-full bg-slate-900/5 dark:bg-slate-50/5 border rounded-xl overflow-hidden select-none">
                            {n > 1 ? (
                              <svg
                                viewBox={`0 0 ${VW} ${VH}`}
                                preserveAspectRatio="xMidYMid meet"
                                className="w-full h-auto cursor-crosshair"
                                style={{ maxHeight: 120 }}
                                onMouseMove={svgMoveHandler}
                                onTouchMove={svgMoveHandler}
                                onMouseLeave={handleMouseLeave}
                                onTouchEnd={handleMouseLeave}
                              >
                                <defs>
                                  <linearGradient id="tGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#ea580c" stopOpacity="0.35" />
                                    <stop offset="100%" stopColor="#ea580c" stopOpacity="0.02" />
                                  </linearGradient>
                                  <clipPath id="tClip">
                                    <rect x={LEFT} y={TOP} width={CW} height={CH} />
                                  </clipPath>
                                </defs>

                                {/* Y-axis grid lines + labels */}
                                {tempGridLines.map((gv, gi) => {
                                  const gy = yOfTemp(gv);
                                  return (
                                    <g key={gi}>
                                      <line x1={LEFT} y1={gy} x2={LEFT + CW} y2={gy}
                                        stroke="rgba(148,163,184,0.2)"
                                        strokeWidth={gi === 0 ? 1.5 : 1}
                                        strokeDasharray={gi === 1 ? '3 3' : undefined}
                                      />
                                      <text x={LEFT - 3} y={gy} textAnchor="end" dominantBaseline="middle"
                                        fontSize="8" fill="rgba(148,163,184,0.9)" fontFamily="monospace">
                                        {gv.toFixed(1)}
                                      </text>
                                    </g>
                                  );
                                })}
                                <text x={LEFT - 3} y={TOP - 4} textAnchor="end" fontSize="7" fill="rgba(148,163,184,0.7)">°C</text>

                                {/* Area fill */}
                                <polygon
                                  points={buildAreaPoints(yOfTemp, tempVals, tempAxisMin)}
                                  fill="url(#tGrad)"
                                  clipPath="url(#tClip)"
                                />
                                {/* Line */}
                                <polyline
                                  points={buildPoints(yOfTemp, tempVals)}
                                  fill="none" stroke="#ea580c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                  clipPath="url(#tClip)"
                                />

                                {/* Time labels on X-axis */}
                                {timeLabelIdxs.map(ti => (
                                  <text key={ti} x={xOf(ti)} y={VH - 4}
                                    textAnchor={ti === 0 ? 'start' : ti === n - 1 ? 'end' : 'middle'}
                                    fontSize="8" fill="rgba(148,163,184,0.8)" fontFamily="monospace">
                                    {fmtTime(telemetryHistory[ti]?.eventTimestamp)}
                                  </text>
                                ))}

                                {/* Hover crosshair + tooltip */}
                                {hoverX !== null && hoverTemp !== null && hoverIdx !== null && (
                                  <>
                                    <line x1={hoverX} y1={TOP} x2={hoverX} y2={TOP + CH}
                                      stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 2" />
                                    <circle
                                      cx={hoverX} cy={yOfTemp(hoverTemp)}
                                      r="4.5" fill="#ea580c" stroke="#fff" strokeWidth="2"
                                    />
                                    <TooltipBubble
                                      x={hoverX} y={yOfTemp(hoverTemp)}
                                      value={hoverTemp.toFixed(1)} unit="°C" color="#ea580c"
                                    />
                                  </>
                                )}
                              </svg>
                            ) : (
                              <div className="h-[130px] flex items-center justify-center text-xs text-muted-foreground">
                                Butuh minimal 2 data untuk menampilkan grafik
                              </div>
                            )}
                          </div>
                        </div>

                        {/* ── Summary cards ── */}
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="p-3 border rounded-lg flex flex-col gap-1 bg-card/50">
                            <div className="flex items-center gap-1.5 text-orange-500">
                              <Thermometer className="h-4 w-4" />
                              <span>Suhu Rata-rata</span>
                            </div>
                            <span className="font-bold text-sm">
                              {(tempVals.reduce((a: number, b: number) => a + b, 0) / tempVals.length).toFixed(1)} °C
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

                        {/* ── Recent log ── */}
                        <div className="space-y-2">
                          <span className="text-xs font-semibold text-muted-foreground">Log Pembacaan Terakhir</span>
                          <div className="border rounded-lg overflow-hidden text-[11px] divide-y max-h-48 overflow-y-auto bg-card/30">
                            {telemetryHistory.slice().reverse().map((rec: any, idx: number) => (
                              <div key={rec.id || idx} className="p-2 flex justify-between items-center hover:bg-muted/40 transition-colors">
                                <span className="text-muted-foreground font-mono">
                                  {new Date(rec.eventTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span className={`font-semibold ${parseFloat(rec.waterLevelCm) < 0 ? 'text-destructive' : parseFloat(rec.waterLevelCm) > 10 ? 'text-blue-500' : 'text-foreground'}`}>
                                  {Math.max(0, parseFloat(rec.waterLevelCm)).toFixed(1)} cm
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

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
           <Card className="shadow-md bg-background/90 backdrop-blur min-w-[200px]">
             <CardContent className="p-3 text-xs space-y-2">
                <div className="font-bold text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                   Menu & Legenda
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-green-600 bg-green-500/20 rounded-sm"></div>
                  <span>Petak Sawah (Sub-block)</span>
                </div>
                <div className="flex items-center gap-2">
                   <div className="w-3 h-3 rounded-full bg-blue-500 shadow-sm border border-white"></div>
                   <span>Device / Sensor (AWD) ({devices.length})</span>
                </div>
                <div className="border-t border-slate-200 dark:border-slate-800 pt-2 mt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-[10px] h-8 flex items-center justify-center gap-1.5 transition-transform active:scale-95 duration-100"
                    onClick={handleRefreshMap}
                    disabled={refreshing}
                  >
                    {refreshing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Update Peta
                  </Button>
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
              {/* Plot SVG — normalized, interactive */}
              {(() => {
                // ── Chart layout constants ─────────────────────────────────
                const VW = 600;
                const VH = 180;
                const LEFT = 40;  // Y-axis label margin
                const RIGHT = 10;
                const TOP = 14;
                const BOT = 24;   // X-axis time labels
                const CW = VW - LEFT - RIGHT;
                const CH = VH - TOP - BOT;

                const subBlockNames: string[] = Array.from(new Set(fieldHistory.map((d: any) => d.sub_block_name)));
                const lineColors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899'];

                // ── Compute axis bounds across ALL sub-blocks for the active tab ──
                const allVals: number[] = fieldHistory.map((d: any) =>
                  activeTab === 'water'
                    ? Math.max(0, parseFloat(d.water_level_cm || 0))
                    : parseFloat(d.temperature_c || 0)
                );

                let axisMin: number, axisMax: number;
                if (activeTab === 'water') {
                  const dataMax = Math.max(...allVals, 10);
                  axisMin = 0;
                  axisMax = dataMax * 1.15;
                } else {
                  const dataMin = Math.min(...allVals);
                  const dataMax = Math.max(...allVals);
                  const pad = Math.max((dataMax - dataMin) * 0.2, 1);
                  axisMin = dataMin - pad;
                  axisMax = dataMax + pad;
                }
                const axisRange = axisMax - axisMin;

                // ── Shared projection ──────────────────────────────────────
                const yOf = (v: number) => TOP + CH - ((Math.max(axisMin, Math.min(axisMax, v)) - axisMin) / axisRange) * CH;

                // ── Grid lines (3) ─────────────────────────────────────────
                const gridVals = [axisMin, axisMin + axisRange / 2, axisMax];

                // ── Hover crosshair position ───────────────────────────────
                const hoverX = fieldHoveredPct !== null ? LEFT + fieldHoveredPct * CW : null;

                // ── SVG move handler ──────────────────────────────────────
                const onSvgMove = (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
                  const el = e.currentTarget;
                  const rect = el.getBoundingClientRect();
                  let cx: number;
                  if ('touches' in e) {
                    if (e.touches.length === 0) return;
                    cx = e.touches[0].clientX;
                  } else {
                    cx = (e as React.MouseEvent).clientX;
                  }
                  const rawX = ((cx - rect.left) / rect.width) * VW;
                  const pct = Math.max(0, Math.min(1, (rawX - LEFT) / CW));
                  setFieldHoveredPct(pct);
                };

                // ── Tooltip bubble (inline) ──────────────────────────────
                const FieldTooltipBubble = ({ x, y, value, unit, color }: { x: number; y: number; value: string; unit: string; color: string }) => {
                  const bw = 66; const bh = 20; const br = 4;
                  const bx = Math.min(Math.max(x - bw / 2, LEFT), VW - RIGHT - bw);
                  const by = y - bh - 6;
                  return (
                    <g style={{ pointerEvents: 'none' }}>
                      <rect x={bx} y={by} width={bw} height={bh} rx={br} fill={color} opacity="0.93" />
                      <polygon points={`${x - 4},${by + bh} ${x + 4},${by + bh} ${x},${by + bh + 5}`} fill={color} opacity="0.93" />
                      <text x={bx + bw / 2} y={by + bh / 2 + 1} textAnchor="middle" dominantBaseline="middle"
                        fontSize="9" fontWeight="700" fill="#fff">
                        {value} {unit}
                      </text>
                    </g>
                  );
                };

                const unit = activeTab === 'water' ? 'cm' : '°C';

                return (
                  <div className="w-full bg-slate-950/5 dark:bg-slate-50/5 border rounded-xl overflow-hidden select-none">
                    <svg
                      viewBox={`0 0 ${VW} ${VH}`}
                      preserveAspectRatio="xMidYMid meet"
                      className="w-full h-auto cursor-crosshair"
                      style={{ maxHeight: 175 }}
                      onMouseMove={onSvgMove}
                      onTouchMove={onSvgMove}
                      onMouseLeave={() => setFieldHoveredPct(null)}
                      onTouchEnd={() => setFieldHoveredPct(null)}
                    >
                      <defs>
                        <clipPath id="fClip">
                          <rect x={LEFT} y={TOP} width={CW} height={CH} />
                        </clipPath>
                      </defs>

                      {/* Y-axis grid lines + labels */}
                      {gridVals.map((gv, gi) => {
                        const gy = yOf(gv);
                        return (
                          <g key={gi}>
                            <line x1={LEFT} y1={gy} x2={LEFT + CW} y2={gy}
                              stroke="rgba(148,163,184,0.2)"
                              strokeWidth={gi === 0 ? 1.5 : 1}
                              strokeDasharray={gi === 1 ? '4 4' : undefined}
                            />
                            <text x={LEFT - 4} y={gy} textAnchor="end" dominantBaseline="middle"
                              fontSize="9" fill="rgba(148,163,184,0.9)" fontFamily="monospace">
                              {activeTab === 'water' ? gv.toFixed(0) : gv.toFixed(1)}
                            </text>
                          </g>
                        );
                      })}
                      <text x={LEFT - 4} y={TOP - 4} textAnchor="end" fontSize="8" fill="rgba(148,163,184,0.7)">{unit}</text>

                      {/* Per-sub-block lines */}
                      {subBlockNames.map((sbName, idx) => {
                        const sbData = fieldHistory.filter((d: any) => d.sub_block_name === sbName);
                        if (sbData.length < 2) return null;
                        const color = lineColors[idx % lineColors.length];

                        const xOfSb = (i: number) => LEFT + (i / (sbData.length - 1)) * CW;
                        const points = sbData.map((d: any, i: number) => {
                          const v = activeTab === 'water'
                            ? Math.max(0, parseFloat(d.water_level_cm || 0))
                            : parseFloat(d.temperature_c || 0);
                          return `${xOfSb(i)},${yOf(v)}`;
                        }).join(' ');

                        // Hover snap: find nearest point by pct
                        const hoverSnapIdx = fieldHoveredPct !== null
                          ? Math.round(fieldHoveredPct * (sbData.length - 1))
                          : null;
                        const hSnapX = hoverSnapIdx !== null ? xOfSb(hoverSnapIdx) : null;
                        const hSnapVal = hoverSnapIdx !== null
                          ? (activeTab === 'water'
                              ? Math.max(0, parseFloat(sbData[hoverSnapIdx]?.water_level_cm || 0))
                              : parseFloat(sbData[hoverSnapIdx]?.temperature_c || 0))
                          : null;

                        return (
                          <g key={sbName}>
                            <polyline
                              points={points}
                              fill="none" stroke={color} strokeWidth="2.5"
                              strokeLinecap="round" strokeLinejoin="round"
                              clipPath="url(#fClip)"
                            />
                            {hSnapX !== null && hSnapVal !== null && (
                              <>
                                <circle cx={hSnapX} cy={yOf(hSnapVal)} r="4" fill={color} stroke="#fff" strokeWidth="2" />
                                <FieldTooltipBubble
                                  x={hSnapX} y={yOf(hSnapVal)}
                                  value={hSnapVal.toFixed(1)} unit={unit} color={color}
                                />
                              </>
                            )}
                          </g>
                        );
                      })}

                      {/* Hover crosshair */}
                      {hoverX !== null && (
                        <line x1={hoverX} y1={TOP} x2={hoverX} y2={TOP + CH}
                          stroke="rgba(148,163,184,0.5)" strokeWidth="1" strokeDasharray="3 2" />
                      )}

                      {/* X-axis time labels: use the longest sub-block series for reference */}
                      {(() => {
                        const longestSb = subBlockNames
                          .map(n => fieldHistory.filter((d: any) => d.sub_block_name === n))
                          .reduce((a, b) => a.length >= b.length ? a : b, []);
                        if (longestSb.length < 2) return null;
                        const xOfRef = (i: number) => LEFT + (i / (longestSb.length - 1)) * CW;
                        const fmtT = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const labelIdxs = longestSb.length > 2
                          ? [0, Math.floor((longestSb.length - 1) / 2), longestSb.length - 1]
                          : [0, longestSb.length - 1];
                        return labelIdxs.map(ti => (
                          <text key={ti} x={xOfRef(ti)} y={VH - 5}
                            textAnchor={ti === 0 ? 'start' : ti === longestSb.length - 1 ? 'end' : 'middle'}
                            fontSize="9" fill="rgba(148,163,184,0.8)" fontFamily="monospace">
                            {fmtT(longestSb[ti]?.event_timestamp)}
                          </text>
                        ));
                      })()}
                    </svg>
                  </div>
                );
              })()}

              {/* Legend */}
              <div className="flex flex-wrap gap-4 items-center border-t pt-3">
                <span className="text-xs font-bold text-muted-foreground">Legenda Petak:</span>
                {Array.from(new Set(fieldHistory.map((d: any) => d.sub_block_name))).map((sbName: any, idx) => {
                  const legendColors = ['bg-blue-600', 'bg-green-600', 'bg-amber-600', 'bg-pink-600'];
                  return (
                    <div key={sbName} className="flex items-center gap-2 text-xs font-semibold">
                      <div className={`w-3 h-3 rounded-full ${legendColors[idx % legendColors.length]}`} />
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
                        <span className="font-semibold text-foreground">
                          {(() => {
                            if (sb.elevationCalibration !== null && sb.elevationCalibration !== undefined) {
                              const cal = parseFloat(sb.elevationCalibration.toString());
                              return `${cal.toFixed(2)} m`;
                            }
                            return sb.elevationM ? `${parseFloat(sb.elevationM).toFixed(2)} m` : '—';
                          })()}
                        </span>
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

                    {/* Connection editor removed — connections are derived automatically */}
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
                            {ip.name || `Titik ${isSource ? 'Sumber' : 'Buang'} #${idx + 1}`}
                          </span>
                        </div>
                      </div>
 
                      {/* Info rows */}
                      <div className="space-y-1.5 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Elevasi</span>
                          <span className="font-semibold text-foreground">{ip.elevationM ? `${ip.elevationM} m` : '—'}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span>Terhubung ke Sub-blok:</span>
                          <span className="font-semibold text-foreground">
                            {(() => {
                              const assigned = ip.assignedSubBlocks ?? [];
                              if (assigned.length === 0) return 'Tidak terhubung';
                              return assigned
                                .map(id => subBlocks.find(sb => sb.id === id)?.name || id)
                                .join(', ');
                            })()}
                          </span>
                        </div>
                      </div>
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
                    const fromName = fromSb ? ('pointType' in fromSb ? (fromSb.name || (fromSb.pointType === 'source' ? 'SUMBER' : 'BUANG')) : fromSb.name) : fromId;
                    const toName = toSb ? ('pointType' in toSb ? (toSb.name || (toSb.pointType === 'source' ? 'SUMBER' : 'BUANG')) : toSb.name) : toId;
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

