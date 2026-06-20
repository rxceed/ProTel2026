import { gisProcClient } from './client';

export interface VideoResolution {
  width: number;
  height: number;
}

export interface VideoEntry {
  _id: string;
  gridfsFileId: string;
  ownerId: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  durationSec: number;
  fps: number;
  resolution: VideoResolution;
  codec: string;
  srtContent?: string | null;
}

interface GetVideosResponse {
  status: string;
  message: string;
  video: VideoEntry[];
}

export interface ParseVideoRequest {
  owner_id: string;
  filename: string;
  frame_interval: number;
  start: number;
  end: number | null;
  srt_file?: File | null;
}

export interface ImageFrame {
  gridfsFileId: string;
  frameIndex: number;
}

export interface ParsedVideoEntry {
  ownerId: string;
  filename: string;
  imageFrames: ImageFrame[];
}

interface GetParsedVideosResponse {
  status: string;
  message: string;
  images: ParsedVideoEntry[];
}

export interface WebODMUploadRequest {
  owner_id: string;
  filename: string;
  project_name: string;
  task_name: string;
}

interface WebODMUploadResponse {
  status: string;
  message: string;
  job_id: string;
}

export interface JobLogArgs {
  owner_id: string;
  filename: string;
  project_name: string;
  odm_task_name: string;
  options: unknown;
}

export interface JobLogEntry {
  jobId: string;
  task: string;
  startedAt: string;
  jobArgs: JobLogArgs;
}

interface GetJobLogsResponse {
  status: string;
  logs: JobLogEntry[];
}

export const videoOpsApi = {
  uploadVideo: (ownerId: string, file: File, srtFile?: File | null) => {
    const formData = new FormData();
    formData.append('owner_id', ownerId);
    formData.append('file', file);
    if (srtFile) {
      formData.append('srt_file', srtFile);
    }

    return gisProcClient.post('/api/video-ops/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  getVideos: (ownerId: string) => {
    return gisProcClient.get<GetVideosResponse>(`/api/video-ops/get/${ownerId}`);
  },

  parseVideo: (body: ParseVideoRequest) => {
    const formData = new FormData();
    formData.append('owner_id', body.owner_id);
    formData.append('filename', body.filename);
    formData.append('frame_interval', body.frame_interval.toString());
    formData.append('start', body.start.toString());
    if (body.end !== null && body.end !== undefined) {
      formData.append('end', body.end.toString());
    }
    if (body.srt_file) {
      formData.append('srt_file', body.srt_file);
    }

    return gisProcClient.post('/api/video-ops/parse', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  updateSrt: (videoId: string, ownerId: string, srtFile: File) => {
    const formData = new FormData();
    formData.append('owner_id', ownerId);
    formData.append('srt_file', srtFile);

    return gisProcClient.put(`/api/video-ops/videos/${videoId}/srt`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  getParsedVideos: (ownerId: string, filename: string) => {
    return gisProcClient.get<GetParsedVideosResponse>('/api/video-ops/parsed', {
      params: { owner_id: ownerId, filename },
    });
  },

  uploadToWebODM: (body: WebODMUploadRequest) => {
    return gisProcClient.post<WebODMUploadResponse>('/api/video-ops/webodm', body);
  },

  getJobLogsByTask: (task: string) => {
    return gisProcClient.get<GetJobLogsResponse>(`/api/job-logs/task/${task}`);
  },
};
