# Scene document

The pipeline's output is a single JSON document plus two kinds of binary files. The frontend
renders real projects and the bundled demo from exactly this format; the TypeScript
definition is in `frontend/src/types/scene.ts` and the writer in
`backend/app/pipeline/scene_writer.py`.

## Coordinate frames

* **World**: right-handed, **+Y up**. When a ground plane is found (`groundAligned: true`) it is `y = 0`.
* **Units**: `"m"` when a known baseline between CAM-01 and CAM-02 was configured, otherwise `"relative"` (the initial camera pair's baseline is 1).
* **Camera poses** use the OpenCV convention `x_cam = R · x_world + t` with camera axes x right, y down, z forward. `R` is row-major; `position` is the camera centre `−Rᵀt`.
* **Pixels**: native image resolution, origin at the top-left pixel centre.

## Top-level fields

| Field | Content |
| --- | --- |
| `source` | `pipeline` or `demo` |
| `provenance` | Where each layer comes from. `detections` is `none`, `model:<name>` or `simulated` (demo only) |
| `cameras[]` | Intrinsics, calibration method, pose (or `null` + `registrationNote`), SfM reprojection error |
| `pointCloud` | `url`, counts per layer, 1st/99th-percentile `bounds` |
| `depthMaps[]` | One per registered camera with a usable neighbour: `url`, size, statistics, `encoding.step` |
| `timeline` | Timestamps and frame indices of the synchronized timesteps |
| `frames[]` | Per timestep: `objects[]` with class, confidence, 3D centre and size, cameras and 2D boxes |
| `tracks[]` | Per track: `states[]` with position, velocity, observed flag and cameras |
| `regions[]` | Named ground polygons (x/z) used for `on`/`inside` relations |
| `relations[]` | `{subject, predicate, object, value?, unit?}` for the last timestep |
| `stats` | Stage records, reprojection histogram, bundle-adjustment rounds, resources |
| `evaluation` | Demo only: errors against the synthetic ground truth |

Relative URLs in `pointCloud.url` and `depthMaps[].url` are resolved against the result
directory (`/scene/{id}/files/` for the API, `/demo/` for the demo). `cameras[].frameUrl` is a
template with `{index}` (or `{index:03d}`) resolved against the API root or the demo folder.

## `points.bin`

Little-endian, `N` points, no header (N comes from `pointCloud.count`):

```
float32 xyz[N][3]   12·N bytes
uint8   rgb[N][3]    3·N bytes
uint8   layer[N]       N bytes   0 = sparse SfM point, 1 = dense MVS point
```

Points are shuffled when written, so any prefix is a uniform random subsample. The viewer
uses this for its density slider by simply drawing fewer points.

## Depth maps

8-bit RGB PNG at the depth working resolution. For each pixel:

```
q      = R · 256 + G          (16-bit value, 0 = no estimate)
depth  = q · encoding.step    (camera-space z, scene units)
conf   = B / 255              (aggregated ZNCC score mapped to 0..1)
```
