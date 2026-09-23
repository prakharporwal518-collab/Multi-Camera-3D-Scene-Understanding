# Object detection model

No detection weights are included in this repository. Without a model the detection,
tracking and scene-graph stages are **skipped** (and reported as skipped); nothing is
simulated for real projects. The demo's detections are simulated from its synthetic
ground truth and are labelled as such in the UI and in the scene document.

## Using a YOLOv8 model

The backend runs YOLOv8-style ONNX models through OpenCV's DNN module on the CPU, so no
PyTorch installation is needed at runtime.

1. Export a model (this step needs the `ultralytics` package, on any machine):

   ```bash
   pip install ultralytics
   yolo export model=yolov8n.pt format=onnx imgsz=640 opset=12
   ```

2. Copy `yolov8n.onnx` to the server and set:

   ```bash
   DETECTOR_MODEL_PATH=/path/to/yolov8n.onnx
   # optional, one class name per line; defaults to the 80 COCO classes
   DETECTOR_LABELS_PATH=/path/to/labels.txt
   DETECTOR_INPUT_SIZE=640
   ```

3. Restart the backend. `GET /api/v1/health` should report the detector as `ready`, and the
   Settings page shows the model name.

4. Re-run detection for an existing reconstruction from the API
   (`POST /api/v1/projects/{id}/detection`) or re-run the pipeline from the Overview page.

Check the licence of the weights you use (Ultralytics models are AGPL-3.0).

## How detections become 3D objects

1. Each registered camera's frame is run through the detector.
2. Detections of the same class in two cameras are paired by triangulating their box centres
   and checking the reprojection against both boxes; further cameras join if the
   triangulated point falls inside one of their boxes.
3. Objects seen by one camera only are placed where the bottom of the box meets the ground
   plane (only if the reconstruction found one). These are marked `ground-contact`.
4. Width and height come from the box size and depth; the length along the viewing
   direction is not observable from a 2D box and is set equal to the width.
