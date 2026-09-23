export const REPO_URL = 'https://github.com/prakharporwal518-collab/Multi-Camera-3D-Scene-Understanding'

export const PIPELINE: { name: string; method: string }[] = [
  { name: 'Input', method: 'Frame-index synchronisation, count and frame-rate checks' },
  { name: 'Preprocessing', method: 'Resize to working resolution, blur and exposure checks' },
  { name: 'Calibration', method: 'Checkerboard (Zhang), manual, or assumed intrinsics' },
  { name: 'Feature extraction', method: 'SIFT, ORB or AKAZE (OpenCV)' },
  { name: 'Feature matching', method: 'Ratio test, mutual check, fundamental-matrix MAGSAC++' },
  { name: 'Pose estimation', method: 'Essential matrix init, PnP registration, bundle adjustment' },
  { name: 'Depth estimation', method: 'Plane-sweep MVS with ZNCC and cross-view consistency' },
  { name: '3D reconstruction', method: 'Voxel fusion, RANSAC ground plane, metric scale from baseline' },
  { name: 'Object detection', method: 'YOLOv8 ONNX per camera, multi-view triangulation' },
  { name: 'Tracking', method: 'Alpha–beta filter, gated nearest-neighbour association' },
  { name: 'Scene understanding', method: 'Geometric relations: near, on, inside, behind' },
]

export const OUTPUTS: { output: string; detail: string; page: string }[] = [
  { output: 'Camera poses', detail: 'Rotation, position and field of view per camera; reprojection error per camera', page: 'calibration' },
  { output: 'Sparse point cloud', detail: 'Triangulated feature tracks refined by bundle adjustment', page: 'reconstruction' },
  { output: 'Depth maps', detail: '16-bit depth with per-pixel confidence for every registered camera', page: 'depth' },
  { output: 'Dense point cloud', detail: 'Consistency-filtered depth fused into a voxel grid, coloured from the images', page: 'reconstruction' },
  { output: '3D objects', detail: 'Class, confidence, 3D centre and extent, list of cameras that see each object', page: 'detection' },
  { output: 'Tracks', detail: 'Position and velocity over time with observation history', page: 'tracking' },
  { output: 'Scene graph', detail: 'Typed relations between objects, regions and the ground plane', page: 'scene-graph' },
  { output: 'Exports', detail: 'PLY point clouds, camera JSON, CSV tracks, full scene document', page: 'export' },
]

export const STACK: { title: string; items: string[] }[] = [
  { title: 'Frontend', items: ['React 19, TypeScript, Vite', 'three.js with React Three Fiber', 'Recharts for charts', 'Web Worker for depth decoding'] },
  { title: 'Backend', items: ['Python 3.11, FastAPI', 'OpenCV 4, NumPy', 'Background runs on a thread pool', 'Optional ONNX detector via OpenCV DNN'] },
  { title: 'Data', items: ['SQLite (dev) or PostgreSQL', 'Scene document as JSON', 'Binary point cloud (16 B/point)', 'Depth maps as RG16 PNG'] },
]

export const LIMITATIONS = [
  'No detection model is bundled; without DETECTOR_MODEL_PATH the detection, tracking and scene-graph stages are skipped.',
  'Cameras are assumed static. Poses are estimated once, from the reference frame.',
  'Frames are synchronised by index, not by timestamp.',
  'Processing is CPU-only; the four-camera 720p demo scene takes about 20 s, mostly in dense depth estimation.',
]
