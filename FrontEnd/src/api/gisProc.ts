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
  uploadVideo: (ownerId: string, file: File) => {
    const formData = new FormData();
    formData.append('owner_id', ownerId);
    formData.append('file', file);

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
    return gisProcClient.post('/api/video-ops/parse', body);
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
