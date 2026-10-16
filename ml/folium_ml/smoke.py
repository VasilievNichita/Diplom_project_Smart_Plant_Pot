"""Disposable synthetic fixtures for software tests, never botanical evidence."""
import io
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

from . import CLASSES
from .data import canonical, now, prepare, require, save_json, sha256


def synthetic_archive(path: Path, groups=4, images_per_group=2):
    rng = np.random.default_rng(12345)
    items, files = [], []
    for class_index, name in enumerate(CLASSES):
        for group in range(groups):
            for shot in range(images_per_group):
                key = f"synthetic-{name}-{group}-{shot}"
                pixels = rng.integers(0, 130, (96, 128, 3), dtype=np.uint8)
                pixels[:, :, class_index] += 110
                image = Image.fromarray(pixels)
                buffer = io.BytesIO()
                image.save(buffer, format="PNG")
                raw = buffer.getvalue()
                image_path = f"images/{key}.png"
                files.append((image_path, raw))
                items.append({"id": key, "plantId": name, "specimenId": f"synthetic-{name}-{group}", "sha256": sha256(raw),
                              "mime": "image/png", "image": image_path, "source": "own", "sourceReference": "SYNTHETIC SOFTWARE TEST. NOT A PLANT PHOTO.",
                              "signs": ["unknown"], "reviewRevision": 1, "reviewedAt": now(), "split": None})
    manifest = {"format": "folium-photo-dataset", "version": 1, "purpose": "synthetic-smoke-test",
                "labelSource": "human", "task": "plant-group-classification", "items": items}
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("manifest.json", canonical(manifest))
        for name, raw in files:
            archive.writestr(name, raw)
    return manifest


def smoke(output: Path):
    from .training import evaluate, predict, train
    require(not output.exists(), "Smoke output already exists; use a new disposable folder")
    output.mkdir(parents=True)
    archive = output / "synthetic.zip"
    synthetic_archive(archive)
    manifest = prepare([archive], output / "prepared", seed=23)
    metadata = train(output / "prepared", output / "run", epochs=2, batch_size=6, seed=23)
    report = evaluate(output / "prepared", output / "run")
    sample = output / "prepared" / manifest["items"][0]["image"]
    result = predict(output / "run", sample)
    require(report["purpose"] == "synthetic-smoke-test" and result["purpose"] == "synthetic-smoke-test", "Synthetic provenance was lost")
    require(metadata["initialStateSha256"] != metadata["trainedStateSha256"], "Training did not update the model parameters")
    summary = {"status": "passed", "purpose": "synthetic-smoke-test", "checks": ["archive validation", "specimen splits", "randomly initialized CNN", "two training epochs", "held-out software test", "checkpoint reload and prediction"],
               "warning": "No real plant photographs were used. No plant-recognition accuracy is established."}
    save_json(output / "smoke-result.json", summary)
    return summary
