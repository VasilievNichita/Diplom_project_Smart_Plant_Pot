import copy
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from folium_ml import CLASSES
from folium_ml.data import DataError, audit_archives, canonical, decode_image, grouped_split, load_prepared, prepare, sha256, validate_pair_review
from folium_ml.smoke import synthetic_archive


class DataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="folium-ml-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "source.zip"
        self.manifest = synthetic_archive(self.archive, groups=3, images_per_group=1)

    def altered(self, change_manifest=None, change_files=None):
        with zipfile.ZipFile(self.archive) as source:
            files = {i.filename: source.read(i.filename) for i in source.infolist()}
        manifest = json.loads(files["manifest.json"])
        if change_manifest:
            change_manifest(manifest)
        if change_files:
            change_files(files, manifest)
        files["manifest.json"] = canonical(manifest)
        target = self.root / "altered.zip"
        with zipfile.ZipFile(target, "w") as output:
            for name, data in files.items():
                output.writestr(name, data)
        return target

    def review(self, report, change=None):
        value = {"format": "folium-photo-pair-review", "version": 1, "auditId": report["auditId"],
                 "purpose": report["purpose"], "acknowledged": True, "reviewedAt": "2026-10-16T12:00:00Z",
                 "pairs": [{"first": p["first"], "second": p["second"], "decision": "different_specimens"}
                           for p in report["possibleCrossSpecimenDuplicates"]]}
        if change:
            change(value)
        target = self.root / 'pair-review.json'
        target.write_bytes(canonical(value))
        return target

    def test_grouped_splits_are_reproducible_and_disjoint(self):
        report, records, _ = audit_archives([self.archive])
        self.assertTrue(report["ok"])
        self.assertTrue(report["structuralSplitPossible"])
        self.assertEqual(grouped_split(records, 41), grouped_split(list(reversed(records)), 41))
        dest = self.root / "prepared"
        prepared = prepare([self.archive], dest, 41)
        self.assertEqual(prepared, load_prepared(dest))
        for name in CLASSES:
            self.assertEqual({r["split"] for r in prepared["items"] if r["plantId"] == name}, {"train", "validation", "test"})
        with self.assertRaises(DataError):
            prepare([self.archive], dest, 41)

    def test_three_home_plants_cannot_fake_independent_holdouts(self):
        archive = self.root / "one-per-class.zip"
        synthetic_archive(archive, groups=1, images_per_group=4)
        report, _, _ = audit_archives([archive])
        self.assertFalse(report["structuralSplitPossible"])
        with self.assertRaisesRegex(DataError, 'at least 3'):
            prepare([archive], self.root / "no-output", 1)
        self.assertFalse((self.root / "no-output").exists())

    def test_path_traversal_and_unexpected_zip_entries_are_rejected(self):
        bad = self.altered(change_files=lambda files, _: files.update({"../secret.txt": b"bad"}))
        report, _, _ = audit_archives([bad])
        self.assertFalse(report["ok"])
        self.assertFalse((self.root.parent / "secret.txt").exists())

    def test_hash_and_pixel_decoder_both_validate(self):
        def tamper(files, manifest):
            files[manifest["items"][0]["image"]] = b"not an image"
        report, _, _ = audit_archives([self.altered(change_files=tamper)])
        self.assertTrue(any('SHA-256' in e["error"] for e in report["errors"]))
        def signed_bad(files, manifest):
            tamper(files, manifest)
            manifest["items"][0]["sha256"] = sha256(b"not an image")
        report, _, _ = audit_archives([self.altered(change_files=signed_bad)])
        self.assertTrue(any('decoded' in e["error"] for e in report["errors"]))

    def test_reencoded_identical_pixels_are_deduplicated_and_conflicts_fail(self):
        def duplicate(files, manifest):
            row = copy.deepcopy(manifest["items"][0])
            with Image.open(io.BytesIO(files[row["image"]])) as image:
                buffer = io.BytesIO()
                image.save(buffer, format="PNG", compress_level=0)
            row.update(id='copy', image='images/copy.png', sha256=sha256(buffer.getvalue()))
            files[row["image"]] = buffer.getvalue()
            manifest["items"].append(row)
        good = self.altered(change_files=duplicate)
        report, _, _ = audit_archives([good])
        self.assertTrue(report["ok"])
        self.assertEqual(len(report["duplicatesOmitted"]), 1)
        def conflict(files, manifest):
            duplicate(files, manifest)
            manifest["items"][-1]["specimenId"] = 'different-plant'
        report, _, _ = audit_archives([self.altered(change_files=conflict)])
        self.assertTrue(any('conflicting class' in e["error"] for e in report["errors"]))

    def test_group_identity_and_source_checks_are_enforced(self):
        def conflict(m):
            m["items"][3]["specimenId"] = m["items"][0]["specimenId"]
            m["items"][1]["source"] = "unknown"
            m["items"][2]["signs"] = ["unknown", "spots"]
        report, _, _ = audit_archives([self.altered(change_manifest=conflict)])
        self.assertEqual(len(report["errors"]), 3)

    def test_fingerprint_and_prepared_images_cannot_silently_change(self):
        dest = self.root / "prepared"
        manifest = prepare([self.archive], dest, 41)
        target = dest / manifest["items"][0]["image"]
        target.write_bytes(target.read_bytes() + b"modified")
        with self.assertRaisesRegex(DataError, 'image changed'):
            load_prepared(dest)
        manifest["seed"] = 99
        (dest / "manifest.json").write_bytes(canonical(manifest))
        with self.assertRaisesRegex(DataError, 'fingerprint changed'):
            load_prepared(dest)

    def test_recomputed_manifest_still_cannot_leak_specimens_between_splits(self):
        dest = self.root / "prepared"
        manifest = prepare([self.archive], dest, 41)
        same_class = [r for r in manifest["items"] if r["plantId"] == CLASSES[0]]
        same_class[1]["specimenId"] = same_class[0]["specimenId"]
        manifest["datasetId"] = sha256(canonical({k:v for k,v in manifest.items() if k != 'datasetId'}))
        (dest / "manifest.json").write_bytes(canonical(manifest))
        with self.assertRaisesRegex(DataError, 'leaks across splits'):
            load_prepared(dest)

    def test_synthetic_and_real_manifests_cannot_be_mixed(self):
        real = self.altered(change_manifest=lambda m: m.pop('purpose'))
        report, _, _ = audit_archives([self.archive, real])
        self.assertFalse(report["ok"])
        self.assertTrue(any('mix synthetic' in e["error"] for e in report["errors"]))

    def test_near_duplicates_require_review_and_truncated_lists_cannot_be_bypassed(self):
        with patch('folium_ml.data.difference_hash', return_value=0):
            report, _, _ = audit_archives([self.archive])
            self.assertGreater(report['possibleDuplicatePairCount'], 0)
            with self.assertRaisesRegex(DataError, 'inspect the audit'):
                prepare([self.archive], self.root / 'unreviewed', 1)
            review = self.review(report)
            prepared = prepare([self.archive], self.root / 'reviewed', 1, review_file=review)
            self.assertEqual(prepared['pairReview']['sha256'], sha256(review.read_bytes()))
            self.assertEqual(prepared['pairReview']['pairs'], report['possibleDuplicatePairCount'])
            large = self.root / 'many-pairs.zip'
            synthetic_archive(large, groups=8, images_per_group=1)
            report, _, _ = audit_archives([large])
            self.assertTrue(report['possibleDuplicateListTruncated'])
            with self.assertRaisesRegex(DataError, 'complete review report'):
                prepare([large], self.root / 'truncated', 1, review_file=review)

    def test_review_rejects_missing_stale_unresolved_and_duplicate_decisions(self):
        with patch('folium_ml.data.difference_hash', return_value=0):
            report, _, _ = audit_archives([self.archive])
            mutations = [
                lambda r: r.update(auditId='0' * 64), lambda r: r.update(purpose='plant-research'),
                lambda r: r.update(acknowledged=False), lambda r: r.update(reviewedAt='2026-10-16'),
                lambda r: r.update(reviewedAt=None), lambda r: r['pairs'].pop(),
                lambda r: r['pairs'].append(r['pairs'][0]),
                lambda r: r['pairs'][0].update(first='not-a-photo'),
                lambda r: r['pairs'][0].update(decision='same_specimen'),
                lambda r: r['pairs'][0].update(decision='uncertain'),
                lambda r: r['pairs'][0].update(decision=''),
            ]
            for index, mutation in enumerate(mutations):
                with self.subTest(index=index), self.assertRaises(DataError):
                    prepare([self.archive], self.root / f'rejected-{index}', 1, self.review(report, mutation))
                self.assertFalse((self.root / f'rejected-{index}').exists())
            path = self.review(report)
            path.write_bytes(b' ' * (1024 * 1024 + 1))
            with self.assertRaisesRegex(DataError, '1 MiB'):
                validate_pair_review(report, path)

    def test_review_fingerprint_tracks_images_labels_and_policy_not_export_filename(self):
        report, _, _ = audit_archives([self.archive])
        renamed = self.root / 'renamed.zip'
        renamed.write_bytes(self.archive.read_bytes())
        self.assertEqual(report['auditId'], audit_archives([renamed])[0]['auditId'])
        for field, value in [('specimenId', 'another-plant'), ('signs', ['spots']), ('reviewRevision', 2)]:
            changed = self.altered(change_manifest=lambda m: m['items'][0].update({field: value}))
            self.assertNotEqual(report['auditId'], audit_archives([changed])[0]['auditId'])
        with patch('folium_ml.data.PAIR_POLICY', 'new-policy'):
            self.assertNotEqual(report['auditId'], audit_archives([self.archive])[0]['auditId'])
        with patch('folium_ml.data.difference_hash', return_value=0):
            old, _, _ = audit_archives([self.archive])
            review = self.review(old)
            changed = self.altered(change_manifest=lambda m: m['items'][0].update(reviewRevision=2))
            with self.assertRaisesRegex(DataError, 'different dataset'):
                prepare([changed], self.root / 'stale', 1, review)

    def test_small_animated_and_bomb_images_are_rejected(self):
        image = Image.new('RGB', (1, 1))
        buffer = io.BytesIO(); image.save(buffer, format='PNG')
        with self.assertRaisesRegex(DataError, 'smaller than'):
            decode_image(buffer.getvalue())
        frames = [Image.new('RGB', (64, 64), color) for color in ['red', 'blue']]
        buffer = io.BytesIO(); frames[0].save(buffer,format='WEBP',save_all=True,append_images=frames[1:])
        with self.assertRaisesRegex(DataError, 'Animated'):
            decode_image(buffer.getvalue())
        buffer = io.BytesIO(); frames[0].save(buffer, format='PNG')
        with patch('folium_ml.data.MAX_PIXELS', 100), self.assertRaisesRegex(DataError, 'megapixels'):
            decode_image(buffer.getvalue())


if __name__ == '__main__':
    unittest.main()
