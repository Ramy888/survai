"""Anonymise survey footage on this Mac before any API sees it.

Blurs faces, whole people, every text region (labels, logos, wordmarks; macOS Vision) and paper sheets taped on
dark rack doors (OpenCV), picks the
sharpest key frames, and strips file metadata (GPS, device). On a power-panel photo, breaker ratings
(C16, 16A, 2P) stay readable and everything else with text is blurred.

Usage:
  prepare.py frames VIDEO --out DIR [--count 30] [--boxes B.json]   key frames + manifest.json + sheet.jpg
  prepare.py clip   VIDEO --out FILE.mp4 [--start S]               blurred narrated path clip from S seconds (audio kept)
  prepare.py photo  IMAGE --out FILE.jpg [--panel] [--boxes B.json] blurred photo

Detection misses small text on low-resolution phone video, so every output is reviewed by eye. Anything
missed goes in a boxes file: {"<frame time s, time range "a-b", or photo name>": [[x0, y0, x1, y1], ...]},
fractions of the frame with the origin top-left, then the command is re-run. Clip times count from --start.
For a clip, a range set to "marks" ({"14.8-20.2": "marks"}) blurs every small bright mark on a dark panel
(logos, badges, label strips) in those seconds, so the box follows each logo instead of covering an area.
"""
import argparse
import json
import math
import re
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np
import Quartz
import Vision
from Foundation import NSData

MAX_SIDE = 1280
PAD = 0.15  # grow each detected box by 15% so edges of logos and faces are covered
CLIP_HOLD = 6  # frames: reuse a box on neighbouring frames so a missed detection never flashes clear
MARK_HOLD = 2  # small marks are found on nearly every frame; a longer hold smears them across a pan
MAX_COVER = 0.4  # a key frame blurred over more than this shows nothing useful; take the next sharpest


def pick_sharpest(times, scores, n, min_gap, exclude=()):
    """Sharpest frame per equal time segment, never two picks closer than min_gap seconds."""
    if not times:
        return []
    t0, span = times[0], max(times[-1] - times[0], 1e-9)
    segments = [[] for _ in range(n)]
    for t, s in zip(times, scores):
        if t not in exclude:
            segments[min(int((t - t0) / span * n), n - 1)].append((s, t))
    picked = []
    for seg in segments:
        for _, t in sorted(seg, reverse=True):
            if all(abs(t - p) >= min_gap for p in picked):
                picked.append(t)
                break
    return sorted(picked)


def to_pixels(box, width, height, pad=PAD):
    """Vision box (normalised, origin bottom-left) -> padded, clamped pixel box (x0, y0, x1, y1)."""
    x, y, w, h = box
    x0 = math.floor((x - pad * w) * width)
    x1 = math.ceil((x + w + pad * w) * width)
    y0 = math.floor((1 - y - h - pad * h) * height)
    y1 = math.ceil((1 - y + pad * h) * height)
    return max(0, x0), max(0, y0), min(width, x1), min(height, y1)


def keep_panel_text(text):
    """A breaker rating has a digit and at most two letters (C16, 16A, 6kA); brands and words do not."""
    s = text.strip()
    return 0 < len(s) <= 8 and any(c.isdigit() for c in s) and len(re.findall(r"[A-Za-z]", s)) <= 2


def manual_boxes(boxes, key, width, height):
    """Hand-listed boxes for a frame time (float) or a photo name, as pixel boxes.
    Time keys are one moment ("94.4") or a range ("16.4-20.0", every clip frame inside it)."""
    if isinstance(key, str):
        rows = boxes.get(key, [])
    else:
        rows = [b for k, v in boxes.items() if isinstance(v, list) and _covers(k, key) for b in v]
    return [(math.floor(x0 * width), math.floor(y0 * height), math.ceil(x1 * width), math.ceil(y1 * height))
            for x0, y0, x1, y1 in rows]


def marks_on(boxes, t):
    """A range set to "marks" turns on small-mark blurring for those clip seconds."""
    return any(v == "marks" and _covers(k, t) for k, v in boxes.items())


def _covers(k, t):
    try:
        if "-" in k:
            a, b = (float(x) for x in k.split("-"))
            return a <= t <= b
        return abs(float(k) - t) < 0.05
    except ValueError:  # a photo name
        return False


def coverage(boxes, width, height):
    mask = np.zeros((height, width), bool)
    for x0, y0, x1, y1 in boxes:
        mask[y0:y1, x0:x1] = True
    return float(mask.mean())


def blur_boxes(img, boxes):
    """Pixelate then blur each box, so the content cannot be recovered by sharpening."""
    out = img.copy()
    for x0, y0, x1, y1 in boxes:
        roi = out[y0:y1, x0:x1]
        h, w = roi.shape[:2]
        if h < 2 or w < 2:
            continue
        small = cv2.resize(roi, (max(1, w // 12), max(1, h // 12)), interpolation=cv2.INTER_AREA)
        roi = cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)
        k = max(3, (min(w, h) // 6) | 1)
        out[y0:y1, x0:x1] = cv2.GaussianBlur(roi, (k, k), 0)
    return out


def paper_boxes(bgr):
    """Taped sheets (port lists, notices): a bright, colourless rectangle framed by a dark rack door.
    Text on them is too small for Vision at phone resolution; the dark frame keeps the ceiling out."""
    h, w = bgr.shape[:2]
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    mask = ((hsv[..., 2] > 150) & (hsv[..., 1] < 60)).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    found = []
    for c in cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
        x, y, bw, bh = cv2.boundingRect(c)
        area = cv2.contourArea(c)
        if not (0.002 * w * h <= area <= 0.25 * w * h) or area < 0.7 * bw * bh or not 0.4 <= bw / bh <= 2.5:
            continue
        mx, my = max(4, bw // 6), max(4, bh // 6)
        X0, Y0, X1, Y1 = max(0, x - mx), max(0, y - my), min(w, x + bw + mx), min(h, y + bh + my)
        ring = hsv[Y0:Y1, X0:X1, 2].astype(float).sum() - hsv[y:y + bh, x:x + bw, 2].astype(float).sum()
        ring_px = (Y1 - Y0) * (X1 - X0) - bw * bh
        inner = hsv[y:y + bh, x:x + bw, 2].mean()  # lit mesh panels pass the mask but average ~90
        if ring_px and ring / ring_px < 105 and inner > 140:
            found.append((max(0, x - 3), max(0, y - 3), min(w, x + bw + 3), min(h, y + bh + 3)))
    return found


def mark_boxes(bgr, lo=85, ring_max=70):
    """Small bright marks on a dark panel: vendor emblems, badges, label strips (also cable tags).
    Graphic logos are not text, so Vision misses them; used only on ranges the reviewer switches on."""
    h, w = bgr.shape[:2]
    v = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[..., 2]
    mask = cv2.morphologyEx((v > lo).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    found = []
    for x, y, bw, bh, area in stats[1:n]:
        if not 25 <= area <= 0.0025 * w * h or bw > 0.15 * w or bh > 0.06 * h or not 0.2 <= bw / bh <= 5:  # logo-sized only
            continue
        m = max(5, max(bw, bh) // 3)
        X0, Y0, X1, Y1 = max(0, x - m), max(0, y - m), min(w, x + bw + m), min(h, y + bh + m)
        win = v[Y0:Y1, X0:X1].astype(float)
        ring = np.ones(win.shape, bool)
        ring[y - Y0:y - Y0 + bh, x - X0:x - X0 + bw] = False
        if win[ring].mean() < ring_max:
            found.append((int(X0), int(Y0), int(X1), int(Y1)))
    return found


def _cgimage(bgr):
    ok, buf = cv2.imencode(".png", bgr)
    data = NSData.dataWithBytes_length_(buf.tobytes(), len(buf))
    return Quartz.CGImageSourceCreateImageAtIndex(Quartz.CGImageSourceCreateWithData(data, None), 0, None)


def detect(bgr, panel=False):
    """Normalised Vision boxes for faces, people and text (on a panel, rating text is skipped)."""
    found = []
    for k in (1, 2):  # distant people are only found at 2x
        people = Vision.VNDetectHumanRectanglesRequest.alloc().init()
        people.setUpperBodyOnly_(False)  # default is upper body only, which leaves legs and badges clear
        img = bgr if k == 1 else cv2.resize(bgr, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
        found += _run(img, [Vision.VNDetectFaceRectanglesRequest.alloc().init(), people])
    # Small text on phone video is found far more often at 2-3x; boxes are normalised, so scales merge.
    for img in [bgr] + [cv2.resize(bgr, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC) for k in (2, 3)]:
        read = Vision.VNRecognizeTextRequest.alloc().init()
        read.setUsesLanguageCorrection_(False)
        read.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate if panel else Vision.VNRequestTextRecognitionLevelFast)
        requests = [read] if panel else [read, Vision.VNDetectTextRectanglesRequest.alloc().init()]
        _run(img, requests)
        found += [r for r in read.results() or [] if not (panel and keep_panel_text(str(r.topCandidates_(1)[0].string())))]
        if not panel:
            found += list(requests[1].results() or [])
    boxes = []
    for r in found:
        b = r.boundingBox()
        boxes.append((b.origin.x, b.origin.y, b.size.width, b.size.height))
    return boxes


def _run(bgr, requests):
    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(_cgimage(bgr), None)
    ok, err = handler.performRequests_error_(requests, None)
    if not ok:
        raise RuntimeError(f"Vision failed: {err}")
    return [r for q in requests for r in q.results() or []]


def fit(img):
    h, w = img.shape[:2]
    scale = MAX_SIDE / max(h, w)
    return img if scale >= 1 else cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)


def anonymise(img, panel=False, extra=()):
    h, w = img.shape[:2]
    boxes = [to_pixels(b, w, h) for b in detect(img, panel)] + paper_boxes(img) + list(extra)
    return blur_boxes(img, boxes), boxes


def sharpness(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, (480, round(480 * gray.shape[0] / gray.shape[1])))
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def cmd_frames(video, out, count, boxes):
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    step = max(1, round(fps / 5))  # score 5 frames per second
    times, scores, i = [], [], 0
    while cap.grab():
        if i % step == 0:
            ok, frame = cap.retrieve()
            if ok:
                times.append(i / fps)
                scores.append(sharpness(frame))
        i += 1
    cap.release()
    score_at = dict(zip(times, scores))

    done, exclude = {}, set()
    cap = cv2.VideoCapture(str(video))
    while True:
        picked = pick_sharpest(times, scores, count, min_gap=1.0, exclude=exclude)
        todo = [t for t in picked if t not in done]
        if not todo:
            break
        for t in todo:
            cap.set(cv2.CAP_PROP_POS_FRAMES, round(t * fps))
            ok, frame = cap.read()
            frame = fit(frame)
            h, w = frame.shape[:2]
            clean, blurred = anonymise(frame, extra=manual_boxes(boxes, t, w, h))
            if coverage(blurred, w, h) > MAX_COVER:
                exclude.add(t)
            else:
                done[t] = (clean, len(blurred))
    cap.release()

    out.mkdir(parents=True, exist_ok=True)
    manifest, thumbs = [], []
    for n, t in enumerate(picked, 1):
        clean, nblur = done[t]
        name = f"frame-{n:02d}.jpg"
        cv2.imwrite(str(out / name), clean, [cv2.IMWRITE_JPEG_QUALITY, 90])
        manifest.append({"file": name, "t": round(t, 2), "sharpness": round(score_at[t], 1), "blurred": nblur})
        thumbs.append(cv2.resize(clean, (160, round(160 * clean.shape[0] / clean.shape[1]))))
    (out / "manifest.json").write_text(json.dumps({"source": video.name, "skipped_mostly_blurred": sorted(round(t, 2) for t in exclude),
                                                   "frames": manifest}, indent=2))
    write_sheet(thumbs, out / "sheet.jpg")
    print(f"{len(manifest)} frames ({len(exclude)} mostly-blurred frames replaced) -> {out}")


def write_sheet(thumbs, path, cols=6):
    if not thumbs:
        return
    h = max(t.shape[0] for t in thumbs)
    rows = [thumbs[i:i + cols] for i in range(0, len(thumbs), cols)]
    pad = lambda t: cv2.copyMakeBorder(t, 0, h - t.shape[0], 0, 0, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    blank = np.full((h, 160, 3), 255, np.uint8)
    grid = [np.hstack([pad(t) for t in r] + [blank] * (cols - len(r))) for r in rows]
    cv2.imwrite(str(path), np.vstack(grid), [cv2.IMWRITE_JPEG_QUALITY, 85])


def cmd_clip(video, out, start=0.0, boxes=None):
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    skip = round(start * fps)  # read and drop frames: exact, unlike seeking to the nearest keyframe
    for _ in range(skip):
        cap.grab()
    per_frame = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame = fit(frame)
        h, w = frame.shape[:2]
        t = len(per_frame) / fps
        marks = mark_boxes(frame) if marks_on(boxes or {}, t) else []
        per_frame.append(([to_pixels(b, w, h) for b in detect(frame)] + paper_boxes(frame) + manual_boxes(boxes or {}, t, w, h), marks))
    cap.release()

    with tempfile.TemporaryDirectory() as tmp:
        silent = Path(tmp) / "silent.mp4"
        cap, writer, i = cv2.VideoCapture(str(video)), None, 0
        for _ in range(skip):
            cap.grab()
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame = fit(frame)
            if writer is None:
                writer = cv2.VideoWriter(str(silent), cv2.VideoWriter_fourcc(*"mp4v"), fps, frame.shape[1::-1])
            held = [b for wide, _ in per_frame[max(0, i - CLIP_HOLD): i + CLIP_HOLD + 1] for b in wide]
            held += [b for _, marks in per_frame[max(0, i - MARK_HOLD): i + MARK_HOLD + 1] for b in marks]
            writer.write(blur_boxes(frame, held))
            i += 1
        cap.release()
        writer.release()
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(silent), "-ss", f"{skip / fps:.3f}", "-i", str(video), "-map", "0:v", "-map", "1:a?",
                        "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-map_metadata", "-1",
                        "-movflags", "+faststart", str(out)], check=True)
    print(f"{i} frames, {sum(len(a) + len(b) for a, b in per_frame)} boxes -> {out}")


def cmd_photo(image, out, panel, boxes):
    img = cv2.imread(str(image))
    if img is None:
        raise SystemExit(f"cannot read {image}")
    img = fit(img)
    h, w = img.shape[:2]
    clean, blurred = anonymise(img, panel, extra=manual_boxes(boxes, image.name, w, h))
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), clean, [cv2.IMWRITE_JPEG_QUALITY, 92])  # OpenCV writes no EXIF
    print(f"{len(blurred)} regions blurred -> {out}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("frames"); f.add_argument("video", type=Path); f.add_argument("--out", type=Path, required=True)
    f.add_argument("--count", type=int, default=30); f.add_argument("--boxes", type=Path)
    c = sub.add_parser("clip"); c.add_argument("video", type=Path); c.add_argument("--out", type=Path, required=True)
    c.add_argument("--start", type=float, default=0.0); c.add_argument("--boxes", type=Path)
    ph = sub.add_parser("photo"); ph.add_argument("image", type=Path); ph.add_argument("--out", type=Path, required=True)
    ph.add_argument("--panel", action="store_true"); ph.add_argument("--boxes", type=Path)
    a = p.parse_args()
    boxes = json.loads(a.boxes.read_text()) if getattr(a, "boxes", None) else {}
    if a.cmd == "frames":
        cmd_frames(a.video, a.out, a.count, boxes)
    elif a.cmd == "clip":
        cmd_clip(a.video, a.out, a.start, boxes)
    else:
        cmd_photo(a.image, a.out, a.panel, boxes)


if __name__ == "__main__":
    main()
