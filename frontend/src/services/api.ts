import type {
  CalibrationRequest,
  Camera,
  HealthInfo,
  MatchResponse,
  PipelineRun,
  Project,
  ProjectConfig,
  UploadResult,
} from '@/types/project'
import type { SceneDocument } from '@/types/scene'
import { apiRequest, apiUpload, type UploadOptions } from './apiClient'

export const api = {
  health: (signal?: AbortSignal) => apiRequest<HealthInfo>('/health', { signal, timeoutMs: 8000 }),

  listProjects: (signal?: AbortSignal) => apiRequest<Project[]>('/projects', { signal }),
  getProject: (id: string, signal?: AbortSignal) => apiRequest<Project>(`/projects/${enc(id)}`, { signal }),
  createProject: (name: string, description: string) =>
    apiRequest<Project>('/projects', { method: 'POST', body: { name, description } }),
  updateProject: (id: string, patch: { name?: string; description?: string; config?: ProjectConfig }) =>
    apiRequest<Project>(`/projects/${enc(id)}`, { method: 'PATCH', body: patch }),
  deleteProject: (id: string) => apiRequest<void>(`/projects/${enc(id)}`, { method: 'DELETE' }),

  listCameras: (projectId: string, signal?: AbortSignal) =>
    apiRequest<Camera[]>(`/projects/${enc(projectId)}/cameras`, { signal }),
  addCamera: (projectId: string, name?: string) =>
    apiRequest<Camera>(`/projects/${enc(projectId)}/cameras`, { method: 'POST', body: name ? { name } : {} }),
  renameCamera: (cameraId: string, name: string) =>
    apiRequest<Camera>(`/cameras/${enc(cameraId)}`, { method: 'PATCH', body: { name } }),
  deleteCamera: (cameraId: string) => apiRequest<void>(`/cameras/${enc(cameraId)}`, { method: 'DELETE' }),
  clearFrames: (cameraId: string) => apiRequest<Camera>(`/cameras/${enc(cameraId)}/frames`, { method: 'DELETE' }),
  uploadImages: (cameraId: string, files: File[], opts?: UploadOptions) => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f, f.name))
    return apiUpload<UploadResult>(`/cameras/${enc(cameraId)}/frames`, form, opts)
  },
  uploadVideo: (cameraId: string, file: File, stride: number, opts?: UploadOptions) => {
    const form = new FormData()
    form.append('file', file, file.name)
    form.append('stride', String(stride))
    return apiUpload<UploadResult>(`/cameras/${enc(cameraId)}/video`, form, opts)
  },
  calibrate: (cameraId: string, body: CalibrationRequest) =>
    apiRequest<Camera>(`/cameras/${enc(cameraId)}/calibration`, { method: 'POST', body, timeoutMs: 120_000 }),

  matchFeatures: (
    projectId: string,
    body: { cameraA: string; cameraB: string; detector: string; ratio: number; frameIndex?: number },
    signal?: AbortSignal,
  ) =>
    apiRequest<MatchResponse>(`/projects/${enc(projectId)}/feature-matching`, {
      method: 'POST',
      body,
      signal,
      timeoutMs: 90_000,
    }),

  startRun: (projectId: string, fromStage = 'input') =>
    apiRequest<PipelineRun>(`/projects/${enc(projectId)}/runs`, { method: 'POST', body: { fromStage } }),
  latestRun: (projectId: string, signal?: AbortSignal) =>
    apiRequest<PipelineRun | null>(`/projects/${enc(projectId)}/runs/latest`, { signal }),
  cancelRun: (projectId: string) =>
    apiRequest<PipelineRun>(`/projects/${enc(projectId)}/runs/cancel`, { method: 'POST' }),

  scene: (projectId: string, signal?: AbortSignal) =>
    apiRequest<SceneDocument>(`/scene/${enc(projectId)}`, { signal, timeoutMs: 30_000 }),
}

function enc(value: string): string {
  return encodeURIComponent(value)
}
