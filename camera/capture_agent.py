"""USB capture client for an enabled Folium device-camera point.

Install opencv-python separately. Credentials belong in a private JSON file.
--check reads configuration only and never opens a camera.
"""
import argparse
import base64
from datetime import datetime, timezone
import ipaddress
import json
from pathlib import Path
import re
import time
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
import uuid

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Redirects are not allowed for camera credentials")

def load_config(filename):
    config = json.loads(Path(filename).read_text(encoding="utf-8-sig"))
    url = urlsplit(config["server"])
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
        raise ValueError("Use a server origin without credentials or a path")
    if url.scheme == "http" and url.hostname != "localhost":
        try:
            address = ipaddress.ip_address(url.hostname)
            if not (address.is_private or address.is_loopback):
                raise ValueError("Public servers require HTTPS")
        except ValueError:
            raise ValueError("HTTP requires localhost or a private IP") from None
    if not re.fullmatch(r"[a-f0-9]{64}", config["token"]):
        raise ValueError("Invalid camera token")
    config["server"] = config["server"].rstrip("/")
    return config

def api(config, route, body=None):
    headers = {"Authorization": "Bearer " + config["token"]}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    request = Request(config["server"] + "/api/camera-device/" + route, data=data, headers=headers)
    with build_opener(NoRedirect()).open(request, timeout=20) as response:
        return json.loads(response.read(65536))

def frame_bytes(index):
    import cv2
    camera = cv2.VideoCapture(index)
    try:
        if not camera.isOpened():
            raise RuntimeError("Camera unavailable")
        # Discard startup frames while auto exposure settles.
        for _ in range(8):
            ok, frame = camera.read()
        if not ok:
            raise RuntimeError("No frame")
        height, width = frame.shape[:2]
        if width > 1280:
            frame = cv2.resize(frame, (1280, round(height * 1280 / width)))
        ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok or len(encoded) > 2 * 1024 * 1024:
            raise RuntimeError("Frame exceeds JPEG limit")
        return encoded.tobytes()
    finally:
        camera.release()

def capture_once(config, index, capture=frame_bytes, request=api):
    state = request(config, "config")
    point = state["camera"]
    if config.get("cameraId") != point["id"] or point["kind"] != "device":
        raise ValueError("Camera binding mismatch")
    if not point["enabled"]:
        return "disabled"
    if point.get("lastFrameAt"):
        elapsed = (datetime.fromisoformat(state["serverTime"].replace("Z", "+00:00")) -
                   datetime.fromisoformat(point["lastFrameAt"].replace("Z", "+00:00"))).total_seconds()
        if elapsed < point["intervalSeconds"]:
            return "waiting"
    payload = {"requestKey": str(uuid.uuid4()), "revision": point["revision"],
               "capturedAt": datetime.now(timezone.utc).isoformat(),
               "mime": "image/jpeg", "base64": base64.b64encode(capture(index)).decode()}
    # One request only. A failed upload is not relabelled or added to a dataset.
    request(config, "photos", payload)
    return "saved"

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    config = load_config(args.config)
    if args.check:
        point = api(config, "config")["camera"]
        print(json.dumps({"connected": True, "enabled": point["enabled"],
                          "intervalSeconds": point["intervalSeconds"]}))
        return
    while True:
        try:
            print(capture_once(config, args.camera_index), flush=True)
        except Exception as error:
            # Do not print tokens, request headers or server response bodies.
            print("Capture failed: " + type(error).__name__, flush=True)
            if args.once:
                raise SystemExit(1)
        if args.once:
            return
        time.sleep(10)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
