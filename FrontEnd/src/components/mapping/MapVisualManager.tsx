import { useEffect, useRef, useState } from 'react';
import { Upload, Map as MapIcon, Check, Loader2, Video, ChevronDown, RefreshCw, Clapperboard, Globe, AlertTriangle, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { videoOpsApi, VideoEntry, ParsedVideoEntry, JobLogEntry } from '@/api/gisProc';
import axios from 'axios';
import { getCachedMapImageUrl } from '@/lib/mapCache';

interface WebodmSseProgress {
  status: string;
  stage: string;
  webodmPercent: number | null;
}

const DEFAULT_WEBODM_PROGRESS: WebodmSseProgress = {
  status: '',
  stage: '',
  webodmPercent: null,
};

interface MapVisualManagerProps {
  fieldId: string;
  fieldName: string;
  initialVisualUrl?: string;
  initialBounds?: number[][];
  initialAssignedFileName?: string;
  onSuccess: () => void;
}

export function MapVisualManager({ 
  fieldId, 
  fieldName, 
  initialVisualUrl, 
  initialBounds, 
  initialAssignedFileName,
  onSuccess 
}: MapVisualManagerProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // Video source selector state
  const [videos, setVideos] = useState<VideoEntry[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosError, setVideosError] = useState<string | null>(null);

  // SRT upload state
  const [localSrtFile, setLocalSrtFile] = useState<File | null>(null);
  const [uploadingSrt, setUploadingSrt] = useState(false);
  const [uploadSrtError, setUploadSrtError] = useState<string | null>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);

  // Parse options state
  const [frameIntervalSec, setFrameIntervalSec] = useState<number>(1);
  const [startSec, setStartSec] = useState<number>(0);
  const [endSec, setEndSec] = useState<number | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // SSE job state
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [sseStatus, setSseStatus] = useState<string>('');
  const [sseDone, setSseDone] = useState(false);
  const [sseError, setSseError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Parsed videos state
  const [parsedVideos, setParsedVideos] = useState<ParsedVideoEntry[]>([]);
  const [parsedVideosLoading, setParsedVideosLoading] = useState(false);
  const [parsedVideosError, setParsedVideosError] = useState<string | null>(null);

  // WebODM upload state
  const [webodmUploading, setWebodmUploading] = useState(false);
  const [webodmError, setWebodmError] = useState<string | null>(null);
  const [webodmJobId, setWebodmJobId] = useState<string | null>(null);
  const [webodmSseProgress, setWebodmSseProgress] = useState<WebodmSseProgress>(DEFAULT_WEBODM_PROGRESS);
  const [webodmSseDone, setWebodmSseDone] = useState(false);
  const [webodmSseError, setWebodmSseError] = useState<string | null>(null);
  const webodmEventSourceRef = useRef<EventSource | null>(null);

  // Check if map visual returns 404
  const [mapNotFound, setMapNotFound] = useState(false);
  const [checkingMap, setCheckingMap] = useState(false);
  const [cachedUrl, setCachedUrl] = useState<string>('');

  useEffect(() => {
    if (initialVisualUrl) {
      getCachedMapImageUrl(initialVisualUrl).then(url => {
        setCachedUrl(url);
      });
    } else {
      setCachedUrl('');
    }
  }, [initialVisualUrl]);

  useEffect(() => {
    if (!initialVisualUrl) {
      setMapNotFound(false);
      return;
    }

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

    const saveHeaders = (headers: any) => {
      if (!headers) {
        console.warn("[MapVisualManager] No headers provided to saveHeaders");
        return;
      }
      console.log("[MapVisualManager] saveHeaders received headers:", headers);
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
        console.log(`[MapVisualManager] Header key: ${header}, found value: ${val}`);
        if (val !== undefined && val !== null) {
          savedData[header] = String(val);
          localStorage.setItem(`${fieldName}_${header}`, String(val));
        }
      });
      
      if (Object.keys(savedData).length > 1) {
        console.log("[MapVisualManager] Saving map headers to localStorage for field:", fieldName, savedData);
        localStorage.setItem(`map_headers_${fieldName}`, JSON.stringify(savedData));
        localStorage.setItem(fieldName, JSON.stringify(savedData));
      } else {
        console.warn("[MapVisualManager] No target headers found in response headers. Not saving to localStorage.");
      }
    };

    const checkMapUrl = async () => {
      setCheckingMap(true);
      console.log("[MapVisualManager] Requesting map URL:", initialVisualUrl);
      try {
        const res = await axios.get(initialVisualUrl);
        console.log("[MapVisualManager] Request succeeded. Status:", res.status, "Headers:", res.headers);
        setMapNotFound(false);
        saveHeaders(res.headers);
      } catch (err: any) {
        console.error("[MapVisualManager] Request failed:", err);
        if (err.response?.status === 404) {
          setMapNotFound(true);
        } else {
          setMapNotFound(false);
        }
      } finally {
        setCheckingMap(false);
      }
    };

    checkMapUrl();
  }, [initialVisualUrl, fieldName]);

  // Default select video based on initialAssignedFileName
  const [hasDefaultSelected, setHasDefaultSelected] = useState(false);

  useEffect(() => {
    setHasDefaultSelected(false);
  }, [initialAssignedFileName]);

  useEffect(() => {
    if (initialAssignedFileName && videos.length > 0 && !hasDefaultSelected) {
      const matchedVideo = videos.find(v => v.filename === initialAssignedFileName);
      if (matchedVideo) {
        setHasDefaultSelected(true);
        if (selectedVideoId !== matchedVideo._id) {
          handleVideoSelect(matchedVideo._id);
        }
      }
    }
  }, [initialAssignedFileName, videos, hasDefaultSelected, selectedVideoId]);

  const bounds = initialBounds ? JSON.stringify(initialBounds) : '[[ -6.2100, 106.8100], [-6.2110, 106.8110]]';

  const fetchVideos = async () => {
    setVideosLoading(true);
    setVideosError(null);
    try {
      const meRes = await apiClient.get('/auth/me');
      const ownerId: string = meRes.data.data.id;
      const videosRes = await videoOpsApi.getVideos(ownerId);
      setVideos(videosRes.data.video ?? []);
    } catch (err: any) {
      setVideosError(err.response?.data?.message || err.message || 'Gagal memuat video');
    } finally {
      setVideosLoading(false);
    }
  };

  const handleLocalSrtSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    let file = e.target.files?.[0] ?? null;
    const selectedVideo = videos.find((v) => v._id === selectedVideoId);
    if (file && selectedVideo) {
      const dotIndex = selectedVideo.filename.lastIndexOf('.');
      const baseName = dotIndex !== -1 ? selectedVideo.filename.substring(0, dotIndex) : selectedVideo.filename;
      file = new File([file], `${baseName}.srt`, { type: file.type });
    }
    setLocalSrtFile(file);
    setUploadSrtError(null);
  };

  const handleUploadSrt = async () => {
    const selectedVideo = videos.find((v) => v._id === selectedVideoId);
    if (!localSrtFile || !selectedVideo) return;
    setUploadingSrt(true);
    setUploadSrtError(null);
    try {
      const meRes = await apiClient.get('/auth/me');
      const ownerId: string = meRes.data.data.id;

      const dotIndex = selectedVideo.filename.lastIndexOf('.');
      const baseName = dotIndex !== -1 ? selectedVideo.filename.substring(0, dotIndex) : selectedVideo.filename;
      const normalizedSrtFile = new File([localSrtFile], `${baseName}.srt`, { type: localSrtFile.type });

      await videoOpsApi.updateSrt(selectedVideo._id, ownerId, normalizedSrtFile);
      
      const srtText = await normalizedSrtFile.text();
      setVideos(prev => prev.map(v => v._id === selectedVideo._id ? { ...v, srtContent: srtText } : v));
      setLocalSrtFile(null);
    } catch (err: any) {
      setUploadSrtError(err.response?.data?.message || err.message || 'Gagal mengunggah file SRT');
    } finally {
      setUploadingSrt(false);
    }
  };

  useEffect(() => {
    fetchVideos();
  }, []);

  const parseWebodmSseData = (raw: string): WebodmSseProgress => {
    try {
      const parsed = JSON.parse(raw);
      return {
        status: parsed.status ?? '',
        stage: parsed.stage ?? '',
        webodmPercent: typeof parsed.webodm_percent === 'number' ? parsed.webodm_percent : null,
      };
    } catch {
      return { status: raw, stage: '', webodmPercent: null };
    }
  };

  const subscribeToWebodmJob = (jobId: string) => {
    webodmEventSourceRef.current?.close();
    setWebodmJobId(jobId);
    setWebodmSseProgress(DEFAULT_WEBODM_PROGRESS);
    setWebodmSseDone(false);
    setWebodmSseError(null);

    const baseUrl = import.meta.env.VITE_GISPROC_API_BASE_URI as string;
    const es = new EventSource(`${baseUrl}/api/video-ops/jobs/${jobId}/stream`);
    webodmEventSourceRef.current = es;

    es.onmessage = (event) => {
      setWebodmSseProgress(parseWebodmSseData(event.data));
    };

    es.addEventListener('done', (event) => {
      const data = (event as MessageEvent).data;
      if (data) {
        setWebodmSseProgress(parseWebodmSseData(data));
      }
      setWebodmSseDone(true);
      es.close();
      onSuccess();
    });

    es.addEventListener('error_event', (event) => {
      setWebodmSseError((event as MessageEvent).data || 'Terjadi kesalahan pada upload WebODM');
      es.close();
    });

    es.onerror = () => {
      setWebodmSseDone((done) => {
        if (!done) setWebodmSseError('Koneksi SSE terputus');
        return done;
      });
      es.close();
    };
  };

  const handleVideoSelect = async (videoId: string) => {
    setSelectedVideoId(videoId);
    setParsedVideos([]);
    setParsedVideosError(null);

    // Reset WebODM SSE state when switching videos
    webodmEventSourceRef.current?.close();
    setWebodmJobId(null);
    setWebodmSseProgress(DEFAULT_WEBODM_PROGRESS);
    setWebodmSseDone(false);
    setWebodmSseError(null);

    if (!videoId) return;

    const selectedVideo = videos.find((v) => v._id === videoId);
    if (!selectedVideo) return;

    setParsedVideosLoading(true);
    try {
      const meRes = await apiClient.get('/auth/me');
      const ownerId: string = meRes.data.data.id;
      const res = await videoOpsApi.getParsedVideos(ownerId, selectedVideo.filename);
      setParsedVideos(res.data.images ?? []);

      // Check for existing in-progress WebODM job for this video
      try {
        const jobLogsRes = await videoOpsApi.getJobLogsByTask('process_webodm_video');
        const jobLogs: JobLogEntry[] = jobLogsRes.data.logs ?? [];

        const matchingJob = jobLogs.find(
          (log) =>
            log.jobArgs?.filename === selectedVideo.filename &&
            log.jobArgs?.owner_id === ownerId
        );

        if (matchingJob) {
          subscribeToWebodmJob(matchingJob.jobId);
        }
      } catch {
        // Silently ignore job-logs lookup failures
      }
    } catch (err: any) {
      setParsedVideosError(err.response?.data?.message || err.message || 'Gagal memuat parsed video');
    } finally {
      setParsedVideosLoading(false);
    }
  };

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      webodmEventSourceRef.current?.close();
    };
  }, []);

  const subscribeToJob = (jobId: string) => {
    eventSourceRef.current?.close();
    setSseStatus('');
    setSseDone(false);
    setSseError(null);
    setActiveJobId(jobId);

    const baseUrl = import.meta.env.VITE_GISPROC_API_BASE_URI as string;
    const es = new EventSource(`${baseUrl}/api/video-ops/jobs/${jobId}/stream`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      setSseStatus(event.data);
    };

    es.addEventListener('done', (event) => {
      setSseStatus((event as MessageEvent).data || 'Selesai');
      setSseDone(true);
      es.close();
      if (selectedVideoId) {
        handleVideoSelect(selectedVideoId);
      }
    });

    es.addEventListener('error_event', (event) => {
      setSseError((event as MessageEvent).data || 'Terjadi kesalahan pada job');
      es.close();
    });

    es.onerror = () => {
      setSseDone((done) => {
        if (!done) setSseError('Koneksi SSE terputus');
        return done;
      });
      es.close();
    };
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');

    try {
      // 1. Get presigned URL
      const { data: { data: { uploadUrl, storageKey } } } = await apiClient.post(`/fields/${fieldId}/map-visual/upload-url`, {
        filename: file.name,
        content_type: file.type
      });

      // 2. Upload to R2 directly
      await axios.put(uploadUrl, file, {
        headers: { 'Content-Type': file.type }
      });

      // 3. Finalize
      await apiClient.post(`/fields/${fieldId}/map-visual/finalize`, {
        storage_key: storageKey
      });

      // 4. Update Bounds
      let parsedBounds;
      try {
        parsedBounds = JSON.parse(bounds);
      } catch (e) {
        throw new Error('Format koordinat tidak valid. Gunakan format: [[lat, lng], [lat, lng]]');
      }

      await apiClient.patch(`/fields/${fieldId}/map-visual/bounds`, {
        bounds: parsedBounds
      });

      setFile(null);
      onSuccess();
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.message || err.message || 'Gagal mengupload visual');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4 p-4 border rounded-xl bg-muted/10">

      {/* Video Source Selector */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Video className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Sumber Video</h3>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={fetchVideos}
            disabled={videosLoading}
            title="Refresh daftar video"
          >
            <RefreshCw className={`h-3 w-3 ${videosLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {videosError ? (
          <p className="text-xs text-destructive">{videosError}</p>
        ) : (
          <div className="relative">
            <select
              className="w-full appearance-none border rounded-md bg-background px-3 py-2 text-sm pr-8 text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed"
              value={selectedVideoId}
              onChange={(e) => handleVideoSelect(e.target.value)}
              disabled={videosLoading || videos.length === 0}
            >
              <option value="">
                {videosLoading
                  ? 'Memuat video...'
                  : videos.length === 0
                  ? 'Tidak ada video tersedia'
                  : '-- Pilih sumber video --'}
              </option>
              {videos.filter((v) => v.filename.toLowerCase().endsWith('.mp4')).map((video) => (
                <option key={video._id} value={video._id}>
                  {video.filename}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        )}

        {/* SRT Upload/Reupload option under video selection */}
        {selectedVideoId && (
          <div className="mt-2 space-y-2 border-t pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                File GPS SRT: {(() => {
                  const selectedVideo = videos.find((v) => v._id === selectedVideoId);
                  return selectedVideo?.srtContent ? (
                    <span className="text-green-600 font-semibold">Tersedia</span>
                  ) : (
                    <span className="text-amber-600 font-semibold">Belum tersedia</span>
                  );
                })()}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs flex items-center gap-1.5"
                onClick={() => srtInputRef.current?.click()}
              >
                Pilih File SRT
              </Button>
              <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                {localSrtFile ? localSrtFile.name : 'Pilih file .srt'}
              </span>
              {localSrtFile && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleUploadSrt}
                  disabled={uploadingSrt}
                >
                  {uploadingSrt ? <Loader2 className="h-3 w-3 animate-spin" /> : (() => {
                    const selectedVideo = videos.find((v) => v._id === selectedVideoId);
                    return selectedVideo?.srtContent ? 'Reupload' : 'Upload';
                  })()}
                </Button>
              )}
            </div>
            <input
              ref={srtInputRef}
              type="file"
              accept=".srt"
              className="hidden"
              onChange={handleLocalSrtSelect}
            />
            {uploadSrtError && <p className="text-[10px] text-destructive">{uploadSrtError}</p>}
          </div>
        )}

      </div>

      {/* Parse to Frames */}
      {selectedVideoId && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Olah Video</h3>
          </div>

          {/* Parsed videos status */}
          {parsedVideosLoading && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Memeriksa hasil pengolahan...
            </p>
          )}
          {!parsedVideosLoading && parsedVideosError && (
            <p className="text-xs text-destructive">{parsedVideosError}</p>
          )}
          {!parsedVideosLoading && parsedVideos.length > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2">
              <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
              <p className="text-xs text-green-700 dark:text-green-400">
                Video sudah diolah — <span className="font-semibold">{parsedVideos.reduce((sum, entry) => sum + entry.imageFrames.length, 0)} frame</span> tersedia
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            {/* Frame Interval in Seconds */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Interval Frame (detik)</label>
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={frameIntervalSec}
                onChange={(e) => setFrameIntervalSec(parseFloat(e.target.value))}
                className="border rounded-md bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Start Second */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Mulai (detik)</label>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline leading-none"
                  onClick={() => setStartSec(0)}
                >
                  Dari Awal
                </button>
              </div>
              <input
                type="number"
                min={0}
                step={1}
                value={startSec}
                onChange={(e) => setStartSec(parseFloat(e.target.value))}
                className="border rounded-md bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* End Second */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Akhir (detik)</label>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline leading-none"
                  onClick={() => setEndSec(null)}
                >
                  Sampai Akhir
                </button>
              </div>
              <input
                type="number"
                min={0}
                step={1}
                value={endSec ?? ''}
                placeholder="Sampai akhir"
                onChange={(e) => setEndSec(e.target.value === '' ? null : parseFloat(e.target.value))}
                className="border rounded-md bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
              />
            </div>
          </div>

          {parseError && <p className="text-xs text-destructive">{parseError}</p>}

          {/* SSE Progress Panel — shown while a job is active */}
          {activeJobId && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                {!sseDone && !sseError && (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                    <p className="text-xs text-foreground flex-1 truncate">
                      {sseStatus || 'Menunggu...'}
                    </p>
                  </>
                )}
                {sseDone && (
                  <>
                    <Check className="h-4 w-4 text-green-600 shrink-0" />
                    <p className="text-xs text-green-600 font-medium flex-1">
                      {sseStatus || 'Selesai'}
                    </p>
                  </>
                )}
                {sseError && (
                  <p className="text-xs text-destructive flex-1">{sseError}</p>
                )}
              </div>

              {(sseDone || sseError) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-7 text-xs"
                  onClick={() => {
                    setActiveJobId(null);
                    setSseStatus('');
                    setSseDone(false);
                    setSseError(null);
                  }}
                >
                  Parse Baru
                </Button>
              )}
            </div>
          )}

          {/* Parse button — hidden while job is active */}
          {!activeJobId && (
            <Button
              className="w-full"
              variant="secondary"
              disabled={parsing}
              onClick={async () => {
                setParseError(null);
                setParsing(true);
                try {
                  const meRes = await apiClient.get('/auth/me');
                  const ownerId: string = meRes.data.data.id;

                  const selectedVideo = videos.find((v) => v._id === selectedVideoId);
                  if (!selectedVideo) throw new Error('Video tidak ditemukan');

                  const frameInterval = Math.round(frameIntervalSec * selectedVideo.fps);

                  let srtFileToSend: File | null = null;
                  if (localSrtFile) {
                    const dotIndex = selectedVideo.filename.lastIndexOf('.');
                    const baseName = dotIndex !== -1 ? selectedVideo.filename.substring(0, dotIndex) : selectedVideo.filename;
                    srtFileToSend = new File([localSrtFile], `${baseName}.srt`, { type: localSrtFile.type });
                  } else if (selectedVideo.srtContent) {
                    const dotIndex = selectedVideo.filename.lastIndexOf('.');
                    const baseName = dotIndex !== -1 ? selectedVideo.filename.substring(0, dotIndex) : selectedVideo.filename;
                    srtFileToSend = new File([selectedVideo.srtContent], `${baseName}.srt`, { type: 'application/x-subrip' });
                  }

                  const res = await videoOpsApi.parseVideo({
                    owner_id: ownerId,
                    filename: selectedVideo.filename,
                    frame_interval: frameInterval,
                    start: startSec,
                    end: endSec,
                    srt_file: srtFileToSend,
                  });

                  // Assign assigned_file_name in field record
                  await apiClient.patch(`/fields/${fieldId}`, {
                    assigned_file_name: selectedVideo.filename
                  });

                  const jobId: string = res.data.job_id;
                  subscribeToJob(jobId);
                } catch (err: any) {
                  setParseError(err.response?.data?.message || err.message || 'Gagal parse video');
                } finally {
                  setParsing(false);
                }
              }}
            >
              {parsing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Clapperboard className="h-4 w-4 mr-2" />}
              Olah Video
            </Button>
          )}
        </div>
      )}

      {/* Upload to WebODM */}
      {selectedVideoId && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Upload ke WebODM</h3>
          </div>

          {/* Warning when video is not yet parsed */}
          {!parsedVideosLoading && parsedVideos.length === 0 && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Video belum diolah. Olah video terlebih dahulu sebelum upload ke WebODM.
              </p>
            </div>
          )}

          {/* WebODM SSE Progress Panel */}
          {webodmJobId && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              {/* Status Banner */}
              <div className={`flex items-center gap-2 rounded-md px-3 py-2 ${
                webodmSseError
                  ? 'border border-red-500/30 bg-red-500/10'
                  : webodmSseDone
                  ? 'border border-green-500/30 bg-green-500/10'
                  : 'border border-blue-500/30 bg-blue-500/10'
              }`}>
                {!webodmSseDone && !webodmSseError && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400 shrink-0" />
                )}
                {webodmSseDone && (
                  <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
                )}
                {webodmSseError && (
                  <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0" />
                )}
                <span className={`text-xs font-semibold ${
                  webodmSseError
                    ? 'text-red-700 dark:text-red-400'
                    : webodmSseDone
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-blue-700 dark:text-blue-400'
                }`}>
                  {webodmSseError
                    ? 'Gagal'
                    : webodmSseDone
                    ? 'Selesai'
                    : webodmSseProgress.status || 'Memproses...'}
                </span>
              </div>

              {/* Error detail */}
              {webodmSseError && (
                <p className="text-xs text-destructive">{webodmSseError}</p>
              )}

              {/* Stage & Progress */}
              {!webodmSseError && (
                <div className="space-y-1.5">
                  {webodmSseProgress.stage && (
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        Tahap: <span className="font-medium text-foreground">{webodmSseProgress.stage}</span>
                      </p>
                      {webodmSseProgress.webodmPercent !== null && (
                        <span className="text-xs font-semibold text-foreground">
                          {Math.round(webodmSseProgress.webodmPercent)}%
                        </span>
                      )}
                    </div>
                  )}

                  {/* Progress Bar */}
                  <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                    {webodmSseProgress.webodmPercent !== null ? (
                      <div
                        className={`h-full rounded-full transition-all duration-500 ease-out ${
                          webodmSseDone ? 'bg-green-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, webodmSseProgress.webodmPercent))}%` }}
                      />
                    ) : (
                      !webodmSseDone && (
                        <div className="h-full w-1/3 rounded-full bg-blue-500/60 animate-pulse" />
                      )
                    )}
                  </div>
                </div>
              )}

              {(webodmSseDone || webodmSseError) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-7 text-xs"
                  onClick={() => {
                    setWebodmJobId(null);
                    setWebodmSseProgress(DEFAULT_WEBODM_PROGRESS);
                    setWebodmSseDone(false);
                    setWebodmSseError(null);
                  }}
                >
                  Tutup
                </Button>
              )}
            </div>
          )}

          {webodmError && <p className="text-xs text-destructive">{webodmError}</p>}

          {/* Upload button */}
          {!webodmJobId && (
            <Button
              className="w-full"
              variant="secondary"
              disabled={parsedVideos.length === 0 || parsedVideosLoading || webodmUploading}
              onClick={async () => {
                setWebodmError(null);
                setWebodmUploading(true);
                try {
                  const meRes = await apiClient.get('/auth/me');
                  const ownerId: string = meRes.data.data.id;

                  const selectedVideo = videos.find((v) => v._id === selectedVideoId);
                  if (!selectedVideo) throw new Error('Video tidak ditemukan');

                  const res = await videoOpsApi.uploadToWebODM({
                    owner_id: ownerId,
                    filename: selectedVideo.filename,
                    project_name: ownerId,
                    task_name: fieldName,
                  });

                  // Assign assigned_file_name in field record
                  await apiClient.patch(`/fields/${fieldId}`, {
                    assigned_file_name: selectedVideo.filename
                  });

                  const jobId: string = res.data.job_id;
                  subscribeToWebodmJob(jobId);
                } catch (err: any) {
                  setWebodmError(err.response?.data?.message || err.message || 'Gagal upload ke WebODM');
                } finally {
                  setWebodmUploading(false);
                }
              }}
            >
              {webodmUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Globe className="h-4 w-4 mr-2" />}
              Upload ke WebODM
            </Button>
          )}
        </div>
      )}

      <div className="border-t border-border/50" />

      {/* Drone Imagery (2D Visual) */}
      <div className="flex items-center gap-2 mb-2">
        <MapIcon className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-sm">Drone Imagery (2D Visual)</h3>
      </div>

      {initialVisualUrl && !file && (
        checkingMap ? (
          <div className="relative aspect-video rounded-lg overflow-hidden border bg-background flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : mapNotFound ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex flex-col items-center justify-center gap-2 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-600 shrink-0" />
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Peta Belum Diproses
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 max-w-sm">
              Peta belum dirender/diproses. Anda harus mengunggah video yang telah diolah/diproses ke WebODM terlebih dahulu.
            </p>
          </div>
        ) : (
          <div className="relative aspect-video rounded-lg overflow-hidden border bg-background group">
            <img 
              src={cachedUrl || initialVisualUrl} 
              alt="Map Visual" 
              className="w-full h-full object-cover"
              onError={() => setMapNotFound(true)}
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Button variant="secondary" size="sm" onClick={() => setFile(null)}>Ganti Gambar</Button>
            </div>
          </div>
        )
      )}

      <div className="space-y-4">
        {!initialVisualUrl || file || mapNotFound ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-center w-full">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-muted/5 hover:bg-muted/10 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-8 h-8 mb-2 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    {file ? file.name : "Upload Orthophoto (PNG/JPG/JPEG/TIF)"}
                  </p>
                </div>
                <input 
                  type="file" 
                  className="hidden" 
                  accept="image/png,image/jpeg,image/jpg,image/tiff,image/x-tiff,.tif,.tiff"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <Button 
              className="w-full" 
              onClick={handleUpload} 
              disabled={!file || uploading}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
              Simpan Visual Lahan
            </Button>
          </div>
        ) : (
          <div className="flex justify-between items-center bg-background p-2 rounded border">
            <span className="text-xs font-medium text-green-600 flex items-center gap-1">
              <Check className="h-3 w-3" /> Visual Aktif
            </span>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={async () => {
              if(confirm('Hapus visual peta ini?')) {
                await apiClient.delete(`/fields/${fieldId}/map-visual`);
                onSuccess();
              }
            }}>Hapus</Button>
          </div>
        )}
      </div>
    </div>
  );
}
