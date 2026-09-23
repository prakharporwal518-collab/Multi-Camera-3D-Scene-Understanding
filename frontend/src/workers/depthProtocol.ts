import type { BackprojectedCloud, DecodedDepth } from '@/services/depthCodec'
import type { CameraPose, Intrinsics } from '@/types/scene'

export interface DepthWorkerRequest {
  id: number
  depthUrl: string
  rgbUrl: string | null
  width: number
  height: number
  step: number
  intrinsics: Intrinsics
  pose: CameraPose | null
}

export type DepthWorkerResponse =
  | { id: number; ok: true; decoded: DecodedDepth; cloud: BackprojectedCloud | null }
  | { id: number; ok: false; error: string }
