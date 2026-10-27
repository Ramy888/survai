# protects: footage is anonymised and key frames are well spread before anything is uploaded;
# fails_when: frame picking clusters, box maths drifts, panel ratings get blurred or brands kept, or
# macOS Vision stops finding text; no_claim: detection recall on real footage (the owner reviews outputs).
import unittest

import cv2
import numpy as np

import prepare


class PickSharpest(unittest.TestCase):
    def test_spread_sorted_and_gapped(self):
        times = [i * 0.2 for i in range(600)]  # 120 s at 5 fps
        scores = [(i * 37) % 101 for i in range(600)]
        picked = prepare.pick_sharpest(times, scores, n=30, min_gap=1.0)
        self.assertEqual(len(picked), 30)
        self.assertEqual(picked, sorted(picked))
        self.assertTrue(all(b - a >= 1.0 for a, b in zip(picked, picked[1:])))
        self.assertGreater(picked[-1] - picked[0], 100)  # covers the whole clip

    def test_takes_the_sharpest_in_each_segment(self):
        times = [0, 1, 2, 3, 4, 5]
        scores = [1, 9, 2, 3, 8, 1]
        self.assertEqual(prepare.pick_sharpest(times, scores, n=2, min_gap=1.0), [1, 4])

    def test_excluded_frames_are_replaced_in_their_segment(self):
        times = [0, 1, 2, 3, 4, 5]
        scores = [1, 9, 2, 3, 8, 1]
        self.assertEqual(prepare.pick_sharpest(times, scores, n=2, min_gap=1.0, exclude={1}), [2, 4])

    def test_short_clip_returns_fewer(self):
        self.assertEqual(len(prepare.pick_sharpest([0, 0.2, 0.4], [1, 2, 3], n=30, min_gap=1.0)), 1)


class BoxMaths(unittest.TestCase):
    def test_vision_box_flips_y_and_pads(self):
        # Vision: normalised, origin bottom-left. (0.5, 0.0, 0.5, 0.5) is the bottom-right quarter.
        self.assertEqual(prepare.to_pixels((0.5, 0.0, 0.5, 0.5), 200, 100, pad=0), (100, 50, 200, 100))

    def test_padding_is_clamped_to_image(self):
        self.assertEqual(prepare.to_pixels((0.0, 0.0, 1.0, 1.0), 200, 100, pad=0.2), (0, 0, 200, 100))


class PanelText(unittest.TestCase):
    def test_keeps_breaker_ratings(self):
        for t in ["C16", "16A", "2P", "63 A", "6kA", "230V", "C 32"]:
            self.assertTrue(prepare.keep_panel_text(t), t)

    def test_blurs_brands_and_words(self):
        for t in ["ABB", "Schneider", "iC60N", "Legrand", "Customer feed", ""]:
            self.assertFalse(prepare.keep_panel_text(t), t)


class ManualBoxes(unittest.TestCase):
    def test_boxes_for_a_time_scale_to_the_frame(self):
        boxes = {"94.4": [[0.5, 0.0, 1.0, 0.25]]}
        self.assertEqual(prepare.manual_boxes(boxes, 94.4, 200, 400), [(100, 0, 200, 100)])
        self.assertEqual(prepare.manual_boxes(boxes, 12.0, 200, 400), [])

    def test_time_range_keys_cover_every_frame_inside(self):
        boxes = {"16.4-20.0": [[0.0, 0.5, 1.0, 0.7]]}
        self.assertEqual(prepare.manual_boxes(boxes, 18.2, 100, 100), [(0, 50, 100, 70)])
        self.assertEqual(prepare.manual_boxes(boxes, 20.1, 100, 100), [])


class Coverage(unittest.TestCase):
    def test_union_area_not_double_counted(self):
        self.assertAlmostEqual(prepare.coverage([(0, 0, 50, 100), (0, 0, 50, 100)], 100, 100), 0.5)


class PaperOnRack(unittest.TestCase):
    def test_finds_a_sheet_on_a_dark_door(self):
        img = np.full((400, 300, 3), 25, np.uint8)
        img[100:220, 80:200] = 235
        boxes = prepare.paper_boxes(img)
        self.assertEqual(len(boxes), 1)
        x0, y0, x1, y1 = boxes[0]
        self.assertTrue(x0 <= 80 and y0 <= 100 and x1 >= 200 and y1 >= 220)

    def test_ignores_a_bright_ceiling(self):
        img = np.full((400, 300, 3), 25, np.uint8)
        img[:150, :] = 235  # ceiling across the top, not framed by dark
        self.assertEqual(prepare.paper_boxes(img), [])


class Blur(unittest.TestCase):
    def test_changes_only_inside_boxes(self):
        img = np.random.default_rng(1).integers(0, 255, (100, 200, 3), dtype=np.uint8)
        out = prepare.blur_boxes(img, [(10, 10, 60, 60)])
        self.assertFalse(np.array_equal(out[10:60, 10:60], img[10:60, 10:60]))
        self.assertTrue(np.array_equal(out[:, 100:], img[:, 100:]))


class VisionDetects(unittest.TestCase):
    def test_finds_printed_text(self):
        img = np.full((400, 800, 3), 255, np.uint8)
        cv2.putText(img, "ACME NETWORKS", (40, 220), cv2.FONT_HERSHEY_SIMPLEX, 2.5, (0, 0, 0), 6)
        boxes = prepare.detect(img)
        self.assertTrue(boxes, "Vision found no text")
        x0, y0, x1, y1 = prepare.to_pixels(boxes[0], 800, 400, pad=0)
        self.assertLess(y0, 220)
        self.assertGreater(y1, 150)


if __name__ == "__main__":
    unittest.main()
