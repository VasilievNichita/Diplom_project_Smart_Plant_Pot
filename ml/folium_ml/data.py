"""Validate Folium exports, audit duplicates and freeze specimen-level splits."""
from __future__ import annotations

import hashlib
import io
import json
import math
import random
import re
import warnings
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from . import CLASSES, IMAGE_SIZE, VERSION

ID = re.compile(r"[A-Za-z0-9_-]{1,80}\Z")
SPECIMEN = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
IMAGE_PATH = re.compile(r"images/[A-Za-z0-9_-]{1,80}\.(png|jpg|webp)\Z")
SIGNS = {"unknown", "no_visible_issue", "yellowing", "wilting", "dry_edges", "spots", "visible_pest"}
MAX_ZIP = 110 * 1024 * 1024
MAX_IMAGE = 10 * 1024 * 1024
MAX_PIXELS = 24_000_000
MAX_ITEMS = 4000
PAIR_POLICY = "dhash64-distance-3-cross-specimen-v1"


class DataError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise DataError(message)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def save_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as output:
        json.dump(value, output, indent=2, ensure_ascii=False, allow_nan=False)
        output.write("\n")


def decode_image(data: bytes) -> Image.Image:
    require(0 < len(data) <= MAX_IMAGE, "Image must be at most 10 MiB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                require(image.format in {"JPEG", "PNG", "WEBP"}, "Unsupported image encoding")
                require(getattr(image, "n_frames", 1) == 1, "Animated images are not supported")
                require(min(image.size) >= 64, "Image is smaller than 64 pixels on one side")
                require(image.width * image.height <= MAX_PIXELS, "Image exceeds 24 megapixels")
                image.verify()
            with Image.open(io.BytesIO(data)) as original:
                oriented = ImageOps.exif_transpose(original)
                rgba = oriented.convert("RGBA")
                background = Image.new("RGBA", rgba.size, "white")
                return Image.alpha_composite(background, rgba).convert("RGB")
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise DataError("Image cannot be decoded safely") from error


def resize_image(image: Image.Image) -> Image.Image:
    # Preserve the whole plant; no center crop, no EXIF or GPS in derived images.
    contained = ImageOps.contain(image, (IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (IMAGE_SIZE, IMAGE_SIZE), "white")
    canvas.paste(contained, ((IMAGE_SIZE - contained.width) // 2, (IMAGE_SIZE - contained.height) // 2))
    return canvas


def difference_hash(image: Image.Image) -> int:
    grey = np.asarray(image.convert("L").resize((9, 8), Image.Resampling.LANCZOS))
    result = 0
    for bit in (grey[:, 1:] > grey[:, :-1]).flat:
        result = (result << 1) | int(bit)
    return result


def validate_item(item):
    require(isinstance(item, dict), "Invalid manifest item")
    require(isinstance(item.get("id"), str) and ID.fullmatch(item["id"]), "Invalid photo id")
    require(item.get("plantId") in CLASSES, f"Unsupported plant group: {item.get('plantId')}")
    require(isinstance(item.get("specimenId"), str) and SPECIMEN.fullmatch(item["specimenId"]), "Missing or invalid specimen id")
    require(isinstance(item.get("sha256"), str) and re.fullmatch(r"[a-f0-9]{64}", item["sha256"]), "Invalid image SHA-256")
    require(isinstance(item.get("image"), str) and IMAGE_PATH.fullmatch(item["image"]), "Unsafe image path")
    require(item.get("mime") in {"image/jpeg", "image/png", "image/webp"}, "Invalid image MIME")
    require(item.get("source") in {"own", "permitted"}, "Unknown photo source")
    require(isinstance(item.get("sourceReference"), str) and len(item["sourceReference"]) <= 1000, "Invalid source reference")
    require(item["source"] != "permitted" or item["sourceReference"].strip(), "Missing permission reference")
    signs = item.get("signs")
    require(isinstance(signs, list) and signs and all(isinstance(s, str) and s in SIGNS for s in signs), "Invalid visible signs")
    require(len(set(signs)) == len(signs), "Repeated sign labels")
    require(not (set(signs) & {"unknown", "no_visible_issue"}) or len(signs) == 1, "Conflicting sign labels")
    require(type(item.get("reviewRevision")) is int and item["reviewRevision"] >= 1, "Missing human review revision")
    require(isinstance(item.get("reviewedAt"), str), "Missing review timestamp")
    require(item.get("split") is None, "Export must not assign image-level splits")


def audit_archives(paths: list[Path]):
    records, images, errors, duplicate_rows = [], {}, [], []
    by_id, by_bytes, by_pixels, specimen_classes = {}, {}, {}, {}
    purposes = set()
    total = 0
    for path in paths:
        try:
            require(path.stat().st_size <= MAX_ZIP, "ZIP exceeds 110 MiB")
            with zipfile.ZipFile(path) as archive:
                members = archive.infolist()
                names = [m.filename for m in members]
                require(len(names) == len(set(names)) and len(names) <= MAX_ITEMS + 1, "Repeated or excessive archive entries")
                require(all(n == "manifest.json" or IMAGE_PATH.fullmatch(n) for n in names), "Unexpected or unsafe archive entry")
                require(sum(m.file_size for m in members) <= MAX_ZIP, "Expanded ZIP exceeds 110 MiB")
                require(all(not m.flag_bits & 1 and (m.external_attr >> 16) & 0o170000 != 0o120000 for m in members), "Encrypted entries or symlinks are not supported")
                require(archive.getinfo("manifest.json").file_size <= 8 * 1024 * 1024, "Manifest too large")
                manifest = json.loads(archive.read("manifest.json"))
                require(isinstance(manifest, dict) and manifest.get("format") == "folium-photo-dataset" and manifest.get("version") == VERSION, "Not a supported Folium export")
                require(manifest.get("labelSource") == "human" and manifest.get("task") == "plant-group-classification", "Unsupported labelling task")
                purpose = manifest.get("purpose", "plant-research")
                require(purpose in {"plant-research", "synthetic-smoke-test"}, "Unknown dataset purpose")
                purposes.add(purpose)
                items = manifest.get("items")
                require(isinstance(items, list), "Missing items")
                total += len(items)
                require(total <= MAX_ITEMS, f"At most {MAX_ITEMS} images per preparation run")
                for item in items:
                    try:
                        validate_item(item)
                        key = item["id"]
                        if key in by_id:
                            require(canonical(by_id[key]) == canonical(item), "Photo id has conflicting metadata across archives")
                        require(archive.getinfo(item["image"]).file_size <= MAX_IMAGE, "Image exceeds 10 MiB")
                        raw = archive.read(item["image"])
                        require(sha256(raw) == item["sha256"], "Image SHA-256 differs from manifest")
                        image = decode_image(raw)
                        by_id[key] = item
                        pixel_hash = sha256(canonical(image.size) + image.tobytes())
                        identity = (item["plantId"], item["specimenId"], tuple(sorted(item["signs"])))
                        old = by_bytes.get(item["sha256"]) or by_pixels.get(pixel_hash)
                        if old:
                            require(old["identity"] == identity, "Duplicate pixels have conflicting class, specimen or signs")
                            duplicate_rows.append({"id": key, "sameAs": old["id"], "reason": "identical_bytes_or_decoded_pixels"})
                            continue
                        group = item["specimenId"]
                        require(group not in specimen_classes or specimen_classes[group] == item["plantId"], "One specimen id is assigned to different classes")
                        specimen_classes[group] = item["plantId"]
                        match = {"identity": identity, "id": key}
                        by_bytes[item["sha256"]] = by_pixels[pixel_hash] = match
                        record = {**item, "pixelSha256": pixel_hash, "width": image.width, "height": image.height,
                                  "dhash": f"{difference_hash(image):016x}"}
                        records.append(record)
                        # Retain only small, normalized RGB images, not the original ZIPs in memory.
                        images[key] = resize_image(image)
                    except (DataError, KeyError, TypeError, zipfile.BadZipFile) as error:
                        errors.append({"archive": path.name, "id": str(item.get("id", "?")) if isinstance(item, dict) else "?", "error": str(error)})
        except (DataError, OSError, KeyError, TypeError, ValueError, zipfile.BadZipFile) as error:
            errors.append({"archive": path.name, "error": str(error)})
    if len(purposes) > 1:
        errors.append({"error": "Do not mix synthetic test images with real research data"})
    records.sort(key=lambda r: r["id"])
    near, near_count = [], 0
    for i, first in enumerate(records):
        for second in records[i+1:]:
            if first["specimenId"] == second["specimenId"]:
                continue
            distance = (int(first["dhash"], 16) ^ int(second["dhash"], 16)).bit_count()
            if distance <= 3:
                near_count += 1
                if len(near) < 200:
                    near.append({"first": first["id"], "second": second["id"], "distance": distance})
    counts = [{"class": name, "images": sum(r["plantId"] == name for r in records),
               "specimens": len({r["specimenId"] for r in records if r["plantId"] == name})} for name in CLASSES]
    report = {"format": "folium-photo-audit", "version": VERSION, "createdAt": now(),
              "purpose": "mixed" if len(purposes) > 1 else next(iter(purposes), "plant-research"),
              "containsSynthetic": "synthetic-smoke-test" in purposes, "ok": not errors, "images": len(records),
              "classes": counts, "errors": errors, "duplicatesOmitted": duplicate_rows,
              "possibleCrossSpecimenDuplicates": near, "possibleDuplicatePairCount": near_count,
              "possibleDuplicateListTruncated": near_count > len(near),
              "structuralSplitPossible": not errors and all(c["specimens"] >= 3 for c in counts),
              "limitations": ["Three specimens per class is only a structural minimum, not evidence of sufficient training data.",
                              "Perceptual hashes are review hints; they do not identify every duplicate or validate specimen labels."]}
    report["pairPolicy"] = PAIR_POLICY
    # Bind human decisions to image bytes, labels and the exact audit policy.
    # Archive names and report generation time do not change this identity.
    report["auditId"] = sha256(canonical({"policy": PAIR_POLICY, "purpose": report["purpose"],
        "records": records, "duplicates": sorted(duplicate_rows, key=lambda r: (r["id"], r["sameAs"]))}))
    return report, records, images


def grouped_split(records, seed: int):
    assignments = {}
    rng = random.Random(seed)
    for name in CLASSES:
        groups = sorted({r["specimenId"] for r in records if r["plantId"] == name})
        require(len(groups) >= 3, f"{name}: need at least 3 independent physical specimens for train/validation/test")
        rng.shuffle(groups)
        count = max(1, math.floor(len(groups) * .2))
        for i, group in enumerate(groups):
            assignments[group] = "test" if i < count else "validation" if i < count * 2 else "train"
    return assignments


def validate_pair_review(report, path: Path):
    require(path.is_file() and path.stat().st_size <= 1024 * 1024, "Pair review must be a JSON file smaller than 1 MiB")
    raw = path.read_bytes()
    review = json.loads(raw)
    require(isinstance(review, dict) and review.get("format") == "folium-photo-pair-review" and review.get("version") == VERSION, "Unsupported pair review file")
    require(review.get("auditId") == report["auditId"] and review.get("purpose") == report["purpose"], "Pair review belongs to a different dataset; inspect the current exports again")
    require(review.get("acknowledged") is True, "Human review acknowledgement is missing")
    try:
        reviewed_at = datetime.fromisoformat(review.get("reviewedAt", "").replace("Z", "+00:00"))
        require(reviewed_at.tzinfo is not None, "Pair review timestamp needs a time zone")
    except (ValueError, TypeError, AttributeError) as error:
        raise DataError("Invalid pair review timestamp") from error
    pairs = review.get("pairs")
    require(isinstance(pairs, list), "Missing pair decisions")
    expected = {(p["first"], p["second"]) for p in report["possibleCrossSpecimenDuplicates"]}
    seen = set()
    for pair in pairs:
        require(isinstance(pair, dict) and isinstance(pair.get("first"), str) and isinstance(pair.get("second"), str), "Invalid pair decision")
        key = (pair["first"], pair["second"])
        require(key in expected and key not in seen, "Unknown or repeated pair decision")
        require(pair.get("decision") == "different_specimens", "A pair is unresolved or represents one specimen; fix the labels/selection and export again")
        seen.add(key)
    require(seen == expected, "Review every candidate pair before preparing data")
    return {"auditId": report["auditId"], "sha256": sha256(raw), "reviewedAt": review["reviewedAt"], "pairs": len(seen)}


def prepare(paths: list[Path], destination: Path, seed: int, review_file: Path | None = None):
    require(type(seed) is int and 0 <= seed < 2**32, "Seed must be an integer from 0 to 4294967295")
    require(not destination.exists(), "Output folder already exists; prepared datasets are immutable")
    report, records, images = audit_archives(paths)
    require(report["ok"], f"Audit failed ({len(report['errors'])} errors); run audit and inspect its report")
    require(not report["possibleDuplicateListTruncated"],
            "Too many possible duplicate pairs for a complete review report; resolve the listed groups and audit again")
    require(not report["possibleDuplicatePairCount"] or review_file is not None,
            "Possible duplicates cross specimen ids: inspect the audit and save pair decisions, then pass --review-file")
    review = validate_pair_review(report, review_file) if review_file is not None else None
    assignments = grouped_split(records, seed)
    destination.mkdir(parents=True, exist_ok=False)
    (destination / "images").mkdir()
    for record in records:
        key = record["id"]
        target = destination / "images" / f"{key}.png"
        images[key].save(target, format="PNG")
        record["sourceImage"] = record["image"]
        record["image"] = f"images/{key}.png"
        record["preparedSha256"] = sha256(target.read_bytes())
        record["split"] = assignments[record["specimenId"]]
    manifest = {"format": "folium-prepared-dataset", "version": VERSION, "classes": list(CLASSES),
                "purpose": report["purpose"], "seed": seed, "imageSize": IMAGE_SIZE,
                "preprocess": "exif-transpose-rgb-white-letterbox-v1", "items": records,
                "nearDuplicatesReviewed": review is not None, "pairReview": review}
    manifest["datasetId"] = sha256(canonical(manifest))
    save_json(destination / "manifest.json", manifest)
    save_json(destination / "audit.json", report)
    return manifest


def load_prepared(folder: Path):
    root = folder.resolve()
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    require(manifest.get("format") == "folium-prepared-dataset" and manifest.get("version") == VERSION, "Unsupported prepared dataset")
    require(manifest.get("classes") == list(CLASSES) and manifest.get("imageSize") == IMAGE_SIZE, "Dataset/model configuration mismatch")
    unsigned = {k: v for k, v in manifest.items() if k != "datasetId"}
    require(sha256(canonical(unsigned)) == manifest.get("datasetId"), "Manifest fingerprint changed; prepare a new dataset version")
    require(manifest.get("purpose") in {"plant-research", "synthetic-smoke-test"}, "Unknown dataset purpose")
    groups, labels, hashes, ids, counts = {}, {}, {}, set(), Counter()
    for record in manifest["items"]:
        require(record["plantId"] in CLASSES and record["split"] in {"train", "validation", "test"}, "Invalid class or split")
        require(record["id"] not in ids, "Repeated photo id")
        ids.add(record["id"])
        group = record["specimenId"]
        require(group not in groups or groups[group] == record["split"], "Specimen leaks across splits")
        require(group not in labels or labels[group] == record["plantId"], "Conflicting specimen class")
        groups[group], labels[group] = record["split"], record["plantId"]
        require(record["pixelSha256"] not in hashes, "Duplicate source pixels in prepared data")
        hashes[record["pixelSha256"]] = record["id"]
        require(isinstance(record["image"], str) and IMAGE_PATH.fullmatch(record["image"]), "Unsafe prepared image path")
        target = (root / record["image"]).resolve()
        require(target.is_relative_to(root), "Prepared image escapes dataset folder")
        raw = target.read_bytes()
        require(sha256(raw) == record["preparedSha256"], "Prepared image changed since preparation")
        with Image.open(io.BytesIO(raw)) as image:
            require(image.mode == "RGB" and image.size == (IMAGE_SIZE, IMAGE_SIZE), "Invalid prepared image dimensions or mode")
            image.verify()
        counts[(record["plantId"], record["split"])] += 1
    require(all(counts[(c, split)] > 0 for c in CLASSES for split in ["train", "validation", "test"]), "Every class must appear in each split")
    return manifest
