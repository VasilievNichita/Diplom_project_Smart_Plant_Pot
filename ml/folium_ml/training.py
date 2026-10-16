"""Separate training/validation from a later explicit held-out test evaluation."""
from __future__ import annotations

import json
import math
import os
import random
from collections import Counter
from pathlib import Path

import numpy as np
import PIL
import torch
from PIL import Image, ImageEnhance, ImageOps
from torch import nn
from torch.utils.data import DataLoader, Dataset

from . import CLASSES, IMAGE_SIZE, VERSION
from .data import canonical, decode_image, load_prepared, now, require, resize_image, save_json, sha256
from .model import ARCHITECTURE, FoliumCNN, initialization_hash
from .metrics import classification_metrics


def set_seed(seed):
    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    random.seed(seed)
    np.random.seed(seed % 2**32)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True)
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
        torch.backends.cudnn.benchmark = False


def image_tensor(image):
    array = np.asarray(image, dtype=np.float32).copy() / 255.0
    # Fixed scaling: no fitted preprocessing sees validation or test images.
    return torch.from_numpy(array).permute(2, 0, 1).contiguous().sub(.5).div(.5)


class PhotoDataset(Dataset):
    def __init__(self, folder, records, augment=False):
        self.folder, self.records, self.augment = Path(folder), records, augment

    def __len__(self):
        return len(self.records)

    def __getitem__(self, index):
        record = self.records[index]
        with Image.open(self.folder / record["image"]) as image:
            image = image.convert("RGB")
            if self.augment:
                if random.random() < .5:
                    image = ImageOps.mirror(image)
                image = ImageEnhance.Brightness(image).enhance(random.uniform(.9, 1.1))
            tensor = image_tensor(image)
        return tensor, CLASSES.index(record["plantId"])


@torch.no_grad()
def score(model, loader, device):
    model.eval()
    total_loss, targets, predictions, probabilities = 0.0, [], [], []
    for images, labels in loader:
        logits = model(images.to(device))
        total_loss += nn.functional.cross_entropy(logits, labels.to(device), reduction="sum").item()
        targets.extend(labels.tolist())
        predictions.extend(logits.argmax(1).cpu().tolist())
        probabilities.extend(logits.softmax(1).cpu().tolist())
    result = classification_metrics(targets, predictions)
    result["loss"] = total_loss / len(targets)
    return result, targets, predictions, probabilities


def select_device(name):
    require(name in {"cpu", "cuda"}, "Choose cpu or cuda")
    require(name != "cuda" or torch.cuda.is_available(), "CUDA is unavailable; install a matching GPU build or use cpu")
    return torch.device(name)


def source_hash():
    root = Path(__file__).parent
    return sha256(b"".join(p.name.encode() + p.read_bytes() for p in sorted(root.glob("*.py"))))


def train(folder: Path, output: Path, epochs=30, batch_size=16, learning_rate=.001, seed=42, patience=8, device_name="cpu"):
    require(not output.exists(), "Run folder already exists; use a new run id")
    require(1 <= epochs <= 500 and 1 <= batch_size <= 256 and 1 <= patience <= 100, "Invalid training limits")
    require(math.isfinite(learning_rate) and 0 < learning_rate <= .1, "Invalid learning rate")
    require(type(seed) is int and 0 <= seed < 2**32, "Seed must be an integer from 0 to 4294967295")
    manifest = load_prepared(folder)
    train_rows = [r for r in manifest["items"] if r["split"] == "train"]
    val_rows = [r for r in manifest["items"] if r["split"] == "validation"]
    device = select_device(device_name)
    set_seed(seed)
    model = FoliumCNN().to(device)
    initial_hash = initialization_hash(model)
    generator = torch.Generator().manual_seed(seed)
    train_loader = DataLoader(PhotoDataset(folder, train_rows, augment=True), batch_size=batch_size, shuffle=True, generator=generator, num_workers=0)
    val_loader = DataLoader(PhotoDataset(folder, val_rows), batch_size=batch_size, shuffle=False, num_workers=0)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=.0001)
    output.mkdir(parents=True, exist_ok=False)
    counts = Counter(r["plantId"] for r in train_rows)
    split_summary = {split: {"images": sum(r["split"] == split for r in manifest["items"]),
                            "specimens": len({r["specimenId"] for r in manifest["items"] if r["split"] == split})}
                     for split in ("train", "validation", "test")}
    metadata = {"format": "folium-model-run", "version": VERSION, "architecture": ARCHITECTURE,
                "purpose": manifest["purpose"], "datasetId": manifest["datasetId"], "classes": list(CLASSES), "imageSize": IMAGE_SIZE,
                "initialization": "random", "pretrained": False, "initialStateSha256": initial_hash,
                "sourceSha256": source_hash(), "seed": seed, "device": str(device), "startedAt": now(),
                "torch": str(torch.__version__), "numpy": np.__version__, "pillow": PIL.__version__,
                "parameterCount": sum(p.numel() for p in model.parameters()), "epochsRequested": epochs,
                "batchSize": batch_size, "learningRate": learning_rate, "patience": patience,
                "checkpointSelection": "lowest_validation_cross_entropy", "testUsedDuringTraining": False,
                "trainCounts": dict(counts), "splitSummary": split_summary,
                "majorityClass": max(CLASSES, key=lambda c: counts[c]),
                "augmentation": "training_only_horizontal_flip_and_brightness_0.9_1.1"}
    save_json(output / "configuration.json", metadata)
    best, best_epoch, history = float("inf"), 0, []
    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        for images, labels in train_loader:
            optimizer.zero_grad(set_to_none=True)
            logits = model(images.to(device))
            loss = nn.functional.cross_entropy(logits, labels.to(device))
            require(torch.isfinite(loss).item(), "Non-finite training loss")
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * labels.size(0)
        metrics, _, _, _ = score(model, val_loader, device)
        require(math.isfinite(metrics["loss"]), "Non-finite validation loss")
        history.append({"epoch": epoch, "trainLoss": total_loss / len(train_rows), "validation": metrics})
        if metrics["loss"] < best:
            best, best_epoch = metrics["loss"], epoch
            state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
            torch.save(state, output / "checkpoint.tmp")
            os.replace(output / "checkpoint.tmp", output / "model.pt")
        print(f"epoch {epoch}: train_loss={history[-1]['trainLoss']:.4f} val_loss={metrics['loss']:.4f}", flush=True)
        if epoch - best_epoch >= patience:
            break
    model.load_state_dict(torch.load(output / "model.pt", map_location=device, weights_only=True), strict=True)
    metadata.update({"finishedAt": now(), "epochsCompleted": len(history), "bestEpoch": best_epoch,
                     "trainedStateSha256": initialization_hash(model),
                     "weightsSha256": sha256((output / "model.pt").read_bytes()), "status": "trained_pending_test"})
    save_json(output / "history.json", history)
    metadata["historySha256"] = sha256((output / "history.json").read_bytes())
    save_json(output / "model.json", metadata)
    return metadata


def load_model(run: Path, device_name="cpu"):
    metadata = json.loads((run / "model.json").read_text(encoding="utf-8"))
    require(metadata.get("format") == "folium-model-run" and metadata.get("architecture") == ARCHITECTURE and metadata.get("version") == VERSION, "Unsupported model run")
    require(metadata.get("classes") == list(CLASSES) and metadata.get("imageSize") == IMAGE_SIZE, "Model class/preprocessing mismatch")
    require(metadata.get("pretrained") is False and metadata.get("initialization") == "random", "This pipeline expects its own from-scratch run")
    require(metadata.get("purpose") in {"plant-research", "synthetic-smoke-test"}, "Unknown model purpose")
    weights = run / "model.pt"
    require(weights.stat().st_size < 5 * 1024 * 1024, "Unexpected checkpoint size")
    require(sha256(weights.read_bytes()) == metadata.get("weightsSha256"), "Checkpoint integrity mismatch")
    device = select_device(device_name)
    model = FoliumCNN()
    # Tensor-only loading; no arbitrary pickle objects or external model downloads.
    model.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True), strict=True)
    model.to(device).eval()
    return model, metadata, device


def evaluate(folder: Path, run: Path, device_name="cpu"):
    require(not (run / "test-report.json").exists(), "Test report already exists; do not repeatedly tune on the held-out test")
    manifest = load_prepared(folder)
    model, metadata, device = load_model(run, device_name)
    require(manifest["datasetId"] == metadata["datasetId"] and manifest["purpose"] == metadata["purpose"], "Evaluation dataset differs from the frozen training dataset")
    rows = [r for r in manifest["items"] if r["split"] == "test"]
    loader = DataLoader(PhotoDataset(folder, rows), batch_size=metadata["batchSize"], shuffle=False, num_workers=0)
    metrics, targets, predictions, probabilities = score(model, loader, device)
    baseline = classification_metrics(targets, [CLASSES.index(metadata["majorityClass"])] * len(targets))
    # Equal specimen weights are reported alongside image-weighted metrics.
    by_specimen = {}
    for row, target, probability in zip(rows, targets, probabilities):
        entry = by_specimen.setdefault(row["specimenId"], {"target": target, "scores": []})
        entry["scores"].append(probability)
    specimen_metrics = classification_metrics([v["target"] for v in by_specimen.values()],
        [int(np.mean(v["scores"], axis=0).argmax()) for v in by_specimen.values()])
    report = {"format": "folium-test-report", "version": VERSION, "purpose": metadata["purpose"], "createdAt": now(),
              "datasetId": manifest["datasetId"], "weightsSha256": metadata["weightsSha256"],
              "imageMetrics": metrics, "specimenMetrics": specimen_metrics, "majorityBaseline": baseline,
              "predictions": [{"id": r["id"], "specimenId": r["specimenId"], "true": CLASSES[y], "predicted": CLASSES[p], "scores": prob}
                              for r, y, p, prob in zip(rows, targets, predictions, probabilities)],
              "limitations": ["Scores are uncalibrated model outputs, not diagnosis probabilities.",
                              "Small test sets and three broad classes do not establish general plant or disease recognition."]}
    if metadata["purpose"] == "synthetic-smoke-test":
        report["warning"] = "SOFTWARE TEST ONLY. These metrics are not plant recognition results."
    save_json(run / "test-report.json", report)
    return report


@torch.no_grad()
def predict(run: Path, image_path: Path, threshold=.7):
    require(math.isfinite(threshold) and 0 <= threshold <= 1, "Threshold must be between 0 and 1")
    model, metadata, device = load_model(run)
    tensor = image_tensor(resize_image(decode_image(image_path.read_bytes()))).unsqueeze(0).to(device)
    probabilities = model(tensor).softmax(1)[0].cpu().tolist()
    candidate = int(np.argmax(probabilities))
    decision = CLASSES[candidate] if probabilities[candidate] >= threshold else "uncertain"
    if metadata["purpose"] == "synthetic-smoke-test":
        decision = "synthetic_test_only"
    return {"purpose": metadata["purpose"], "candidate": CLASSES[candidate], "scores": dict(zip(CLASSES, probabilities)),
            "decision": decision, "threshold": threshold,
            "requiresHumanConfirmation": True, "diagnosis": None, "pumpCommand": None,
            "warning": "Uncalibrated scores across three groups; unfamiliar objects may still score highly. No automatic care actions."}
