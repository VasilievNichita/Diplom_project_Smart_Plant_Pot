import unittest
from capture_agent import capture_once

class CaptureTests(unittest.TestCase):
    def state(self, enabled=True, last=None):
        return {"camera": {"id": "test", "kind": "device", "enabled": enabled,
                "revision": 2, "lastFrameAt": last, "intervalSeconds": 300},
                "serverTime": "2026-10-20T12:00:00Z"}
    def test_disabled_does_not_open_camera(self):
        result = capture_once({"cameraId": "test"}, 0,
            capture=lambda _: self.fail("camera opened"),
            request=lambda *args: self.state(False))
        self.assertEqual(result, "disabled")
    def test_interval_does_not_open_camera(self):
        result = capture_once({"cameraId": "test"}, 0,
            capture=lambda _: self.fail("camera opened"),
            request=lambda *args: self.state(last="2026-10-20T11:59:00Z"))
        self.assertEqual(result, "waiting")
    def test_upload_uses_binding_revision_without_labels(self):
        calls = []
        def request(config, route, body=None):
            calls.append((route, body))
            return self.state()
        self.assertEqual(capture_once({"cameraId": "test"}, 1, capture=lambda _: b"test", request=request), "saved")
        self.assertEqual(calls[1][1]["revision"], 2)
        self.assertNotIn("plantId", calls[1][1])
        self.assertNotIn("selected", calls[1][1])
    def test_wrong_binding_does_not_open_camera(self):
        with self.assertRaises(ValueError):
            capture_once({"cameraId": "other"}, 0, capture=lambda _: self.fail("camera opened"), request=lambda *args: self.state())

if __name__ == "__main__":
    unittest.main()
