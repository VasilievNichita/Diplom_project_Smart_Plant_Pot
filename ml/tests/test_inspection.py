import base64
import copy
import hashlib
import html
import io
import json
import re
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from folium_ml.__main__ import main
from folium_ml.data import DataError, audit_archives, canonical, sha256
from folium_ml.inspection import inspect_archives
from folium_ml.inspection_copy import COPY
from folium_ml.smoke import synthetic_archive


def near_archive(root):
    """Explicit synthetic fixture: alter one pixel, assign another specimen code."""
    source = root / 'source.zip'
    manifest = synthetic_archive(source, groups=3, images_per_group=1)
    with zipfile.ZipFile(source) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    row = copy.deepcopy(manifest['items'][0])
    with Image.open(io.BytesIO(files[row['image']])) as original:
        image = original.copy()
    r, g, b = image.getpixel((0, 0))
    image.putpixel((0, 0), ((r + 1) % 256, g, b))
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    row.update(id='synthetic-near-photo', image='images/synthetic-near-photo.png',
               specimenId=manifest['items'][1]['specimenId'], sha256=sha256(buffer.getvalue()),
               source='permitted', sourceReference='PRIVATE-PERMISSION-REFERENCE-NOT-FOR-HTML')
    manifest['items'].append(row)
    files[row['image']] = buffer.getvalue()
    files['manifest.json'] = canonical(manifest)
    target = root / 'synthetic-near.zip'
    with zipfile.ZipFile(target, 'x') as archive:
        for name, raw in files.items():
            archive.writestr(name, raw)
    return target


class InspectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='folium-inspection-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = near_archive(self.root)

    def test_offline_pairs_and_catalogue_preserve_synthetic_label_and_omit_source_details(self):
        before = sha256(self.archive.read_bytes())
        for language in COPY:
            with self.subTest(language=language):
                destination = self.root / language
                result = inspect_archives([self.archive], destination, language)
                self.assertTrue(result['auditOk'])
                self.assertEqual(result['images'], 10)
                self.assertEqual(result['possibleDuplicatePairCount'], 1)
                content = (destination / 'review.html').read_text(encoding='utf-8')
                catalogue = (destination / 'catalogue-001.html').read_text(encoding='utf-8')
                for page in [content, catalogue]:
                    self.assertIn(COPY[language]['synthetic'], html.unescape(page))
                    self.assertIn(COPY[language]['private'], html.unescape(page))
                    self.assertNotIn('PRIVATE-PERMISSION-REFERENCE', page)
                    self.assertNotRegex(page, r'(src|href)="https?://')
                data = json.loads(re.search(r'<script id="review-data" type="application/json">(.*?)</script>', content, re.S)[1])
                self.assertEqual(data['auditId'], result['auditId'])
                self.assertEqual(len(data['pairs']), 1)
                self.assertFalse(data['blocked'])
                self.assertEqual(content.count('data-pair-index='), 1)
                self.assertEqual(catalogue.count('<article class="photo">'), 10)
                # A static script hash authorizes only the exact embedded module.
                script = re.search(r'<script type="module">(.*?)</script>', content, re.S)[1]
                digest = base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
                self.assertIn(f"'sha256-{digest}'", html.unescape(content))
                preview = re.search(r'data:image/jpeg;base64,([^"\s]+)', catalogue)[1]
                with Image.open(io.BytesIO(base64.b64decode(preview))) as image:
                    self.assertEqual(image.size, (128, 128))
                    self.assertEqual(image.mode, 'RGB')
                    self.assertFalse(image.getexif())
        self.assertEqual(before, sha256(self.archive.read_bytes()))

    def test_pagination_includes_each_valid_image_once(self):
        destination = self.root / 'paged'
        with patch('folium_ml.inspection.PAGE_SIZE', 4):
            result = inspect_archives([self.archive], destination)
        self.assertEqual(result['cataloguePages'], 3)
        counts = []
        all_ids = []
        for index in range(1, 4):
            content = (destination / f'catalogue-{index:03}.html').read_text(encoding='utf-8')
            counts.append(content.count('<article class="photo">'))
            all_ids.extend(re.findall(r'alt="([^"]+)"', content))
            self.assertIn('href="review.html"', content)
        self.assertEqual(counts, [4, 4, 2])
        self.assertEqual(len(all_ids), len(set(all_ids)))

    def test_errors_are_rendered_as_text_and_report_is_written_on_failed_audit(self):
        bad = self.root / 'bad.zip'
        with zipfile.ZipFile(bad, 'x') as archive:
            archive.writestr('manifest.json', canonical({
                'format': 'folium-photo-dataset', 'version': 1, 'labelSource': 'human',
                'task': 'plant-group-classification', 'items': [{'id': 'valid', 'plantId': '<script>alert(1)</script>'}]}))
        result = inspect_archives([bad], self.root / 'bad-report', 'en')
        self.assertFalse(result['auditOk'])
        content = Path(result['report']).read_text(encoding='utf-8')
        self.assertNotIn('<script>alert(1)', content)
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;', content)
        self.assertIn(COPY['en']['no_images'], (self.root / 'bad-report/catalogue-001.html').read_text(encoding='utf-8'))
        with patch('sys.stdout', new_callable=io.StringIO):
            self.assertEqual(main(['inspect', '--archive', str(bad), '--out', str(self.root / 'cli-bad')]), 2)

    def test_no_pairs_has_no_decision_form_and_never_overwrites(self):
        source = self.root / 'source.zip'
        result = inspect_archives([source], self.root / 'no-pairs')
        content = Path(result['report']).read_text(encoding='utf-8')
        self.assertIn(COPY['ru']['no_pairs'], content)
        self.assertNotIn('id="save-review"', content)
        self.assertNotIn('<script', content)
        with self.assertRaisesRegex(DataError, 'already exists'):
            inspect_archives([source], self.root / 'no-pairs')
        self.assertEqual(content, Path(result['report']).read_text(encoding='utf-8'))

    def test_truncated_report_is_explicitly_blocked(self):
        many = self.root / 'many.zip'
        synthetic_archive(many, groups=8, images_per_group=1)
        with patch('folium_ml.data.difference_hash', return_value=0):
            result = inspect_archives([many], self.root / 'truncated', 'en')
        content = Path(result['report']).read_text(encoding='utf-8')
        self.assertIn(COPY['en']['truncated'], content)
        data = json.loads(re.search(r'<script id="review-data" type="application/json">(.*?)</script>', content, re.S)[1])
        self.assertTrue(data['blocked'])
        self.assertEqual(len(data['pairs']), 200)
        self.assertGreater(result['possibleDuplicatePairCount'], 200)

    def test_inspection_translations_have_matching_keys(self):
        for language in COPY:
            self.assertEqual(set(COPY['en']), set(COPY[language]))
            self.assertEqual(set(COPY['en']['classes']), set(COPY[language]['classes']))


if __name__ == '__main__':
    unittest.main()
