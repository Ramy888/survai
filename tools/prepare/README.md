# tools/prepare

Anonymises survey footage on the engineer's Mac before anything is uploaded or sent to a model.

- Blurs faces and whole people (macOS Vision, full body, at 1x and 2x for distant people).
- Blurs every text region it finds (labels, logos, wordmarks), at 1x, 2x and 3x.
- On a power-panel photo (`--panel`) keeps breaker ratings readable (C16, 16A, 2P) and blurs brands and words.
- Picks the 30 sharpest key frames spread across the walk-through (at least 1 s apart); a frame blurred over more
  than 40% is replaced by the next sharpest in its part of the clip.
- Strips metadata (GPS, device): OpenCV writes no EXIF, ffmpeg runs with `-map_metadata -1`.

## Setup

```sh
python3 -m venv tools/prepare/.venv
tools/prepare/.venv/bin/pip install opencv-python-headless numpy pyobjc-framework-Vision pyobjc-framework-Quartz
```

## Use

```sh
P=tools/prepare/.venv/bin/python
$P tools/prepare/prepare.py frames WALKTHROUGH.mp4 --out tools/prepare/out/devices_hall/frames --boxes BOXES.json
$P tools/prepare/prepare.py clip   PATH_CLIP.mp4   --out tools/prepare/out/devices_hall/path-clip.mp4
$P tools/prepare/prepare.py photo  PANEL.jpg       --out tools/prepare/out/devices_hall/panel.jpg --panel
```

## Review every output

Detection misses small text on low-resolution phone video. Look at `frames/sheet.jpg`, every frame, the clip and
the photo before uploading. List anything missed in a boxes file and re-run:

```json
{ "94.4": [[0.0, 0.06, 0.33, 0.27]], "panel.jpg": [[0.1, 0.0, 0.5, 0.1]] }
```

Keys are the frame time in seconds (from `manifest.json`) or the photo's file name; boxes are `[x0, y0, x1, y1]`
as fractions of the frame, origin top-left. Keep boxes files and outputs out of git (`private/`, `out/`).

## Test

```sh
tools/prepare/.venv/bin/python -m unittest discover -s tools/prepare
```
