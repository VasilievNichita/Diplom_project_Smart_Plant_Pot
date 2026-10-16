import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from folium_ml.data import DataError, prepare, sha256
from folium_ml.report_copy import COPY
from folium_ml.reporting import load_run, render_report, validate_test
from folium_ml.smoke import synthetic_archive
from folium_ml.training import evaluate, train


class ReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='folium-report-test-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        archive = cls.root / 'synthetic.zip'
        synthetic_archive(archive, groups=3, images_per_group=2)
        cls.data = cls.root / 'data'
        prepare([archive], cls.data, 5)
        cls.run_dir = cls.root / 'run'
        with contextlib.redirect_stdout(io.StringIO()):
            cls.model = train(cls.data, cls.run_dir, epochs=2, batch_size=6, seed=5)
        cls.test_report = evaluate(cls.data, cls.run_dir)

    def setUp(self):
        self.temp_case = tempfile.TemporaryDirectory(dir=self.root)
        self.addCleanup(self.temp_case.cleanup)
        self.folder = Path(self.temp_case.name)
        self.run_dir = self.folder / 'run'
        self.run_dir.mkdir()
        for name in ('model.json', 'model.pt', 'history.json', 'test-report.json'):
            (self.run_dir / name).write_bytes((type(self).run_dir / name).read_bytes())

    def replace_json(self, name, change):
        path = self.run_dir / name
        value = json.loads(path.read_text(encoding='utf-8'))
        change(value)
        path.write_text(json.dumps(value), encoding='utf-8')

    def test_report_is_offline_read_only_and_retains_synthetic_notice_in_all_languages(self):
        self.assertEqual(set(COPY['ru']), set(COPY['ro']))
        self.assertEqual(set(COPY['ru']), set(COPY['en']))
        before = {p.name: sha256(p.read_bytes()) for p in self.run_dir.iterdir()}
        for language in COPY:
            destination = self.folder / f'{language}.html'
            with patch('folium_ml.training.train', side_effect=AssertionError('must not train')), \
                 patch('folium_ml.training.evaluate', side_effect=AssertionError('must not evaluate')):
                result = render_report(self.run_dir, destination, language)
            content = destination.read_text(encoding='utf-8')
            self.assertEqual(result['status'], 'synthetic-software-check')
            self.assertTrue(result['testEvaluated'])
            self.assertIn(COPY[language]['synthetic'], content)
            self.assertIn(f'<html lang="{language}">', content)
            self.assertIn('data:image/png;base64,', content)
            self.assertNotIn('<script', content)
            self.assertNotIn('src="http', content)
            self.assertNotIn('href="http', content)
            self.assertNotIn(self.test_report['predictions'][0]['specimenId'], content)
            self.assertNotIn(self.test_report['predictions'][0]['id'], content)
        self.assertEqual(before, {p.name: sha256(p.read_bytes()) for p in self.run_dir.iterdir()})

    def test_pending_run_does_not_invent_final_metrics_or_trigger_test(self):
        # The file is one known temporary fixture, not a real experiment.
        (self.run_dir / 'test-report.json').unlink()
        destination = self.folder / 'pending.html'
        result = render_report(self.run_dir, destination, 'en')
        content = destination.read_text(encoding='utf-8')
        self.assertFalse(result['testEvaluated'])
        self.assertIn(COPY['en']['pending'], content)
        self.assertIn(COPY['en']['pending_note'], content)
        self.assertNotIn(COPY['en']['by_image'], content)
        self.assertFalse((self.run_dir / 'test-report.json').exists())

    def test_mixed_run_or_purpose_is_rejected(self):
        for key, value in [('datasetId', '1' * 64), ('weightsSha256', '2' * 64), ('purpose', 'plant-research')]:
            changed = copy.deepcopy(self.test_report)
            changed[key] = value
            with self.assertRaisesRegex(DataError, 'different run'):
                validate_test(changed, self.model)

    def test_metrics_and_predictions_must_agree(self):
        changed = copy.deepcopy(self.test_report)
        changed['imageMetrics']['accuracy'] = -1
        with self.assertRaisesRegex(DataError, 'Inconsistent metric'):
            validate_test(changed, self.model)
        changed = copy.deepcopy(self.test_report)
        changed['predictions'][0]['scores'] = [float('nan'), 0, 0]
        with self.assertRaisesRegex(DataError, 'scores'):
            validate_test(changed, self.model)
        changed = copy.deepcopy(self.test_report)
        changed['specimenMetrics']['confusionMatrix'][0][0] += 1
        with self.assertRaisesRegex(DataError, 'matrix'):
            validate_test(changed, self.model)

    def test_changed_weights_history_and_best_epoch_are_rejected(self):
        path = self.run_dir / 'model.pt'
        original = path.read_bytes()
        path.write_bytes(original + b'modified')
        with self.assertRaisesRegex(DataError, 'Checkpoint integrity'):
            load_run(self.run_dir)
        path.write_bytes(original)
        self.replace_json('history.json', lambda history: history[0].update(trainLoss=999))
        with self.assertRaisesRegex(DataError, 'history integrity'):
            load_run(self.run_dir)
        (self.run_dir / 'history.json').write_bytes((type(self).run_dir / 'history.json').read_bytes())
        self.replace_json('model.json', lambda model: model.update(bestEpoch=99))
        with self.assertRaisesRegex(DataError, 'Selected epoch'):
            load_run(self.run_dir)

    def test_legacy_runs_show_unrecorded_counts_instead_of_invented_data(self):
        self.replace_json('model.json', lambda model: [model.pop(key) for key in ('historySha256', 'splitSummary')])
        destination = self.folder / 'legacy.html'
        render_report(self.run_dir, destination, 'en')
        content = destination.read_text(encoding='utf-8')
        self.assertIn(COPY['en']['unknown'], content)
        self.assertIn(COPY['en']['legacy'], content)

    def test_unsafe_metadata_is_escaped_and_photo_notes_are_not_embedded(self):
        self.replace_json('model.json', lambda model: model.update(device='<img src=x onerror=alert(1)>', note='PRIVATE SENTINEL'))
        destination = self.folder / 'escaped.html'
        render_report(self.run_dir, destination, 'en')
        content = destination.read_text(encoding='utf-8')
        self.assertIn('&lt;img src=x onerror=alert(1)&gt;', content)
        self.assertNotIn('<img src=x', content)
        self.assertNotIn('PRIVATE SENTINEL', content)

    def test_existing_reports_and_model_files_are_not_overwritten(self):
        destination = self.folder / 'existing.html'
        destination.write_text('keep this report')
        with self.assertRaises(DataError):
            render_report(self.run_dir, destination)
        self.assertEqual(destination.read_text(), 'keep this report')
        with self.assertRaises(DataError):
            render_report(self.run_dir, self.folder / 'model.pt')
        with self.assertRaises(DataError):
            render_report(self.run_dir, self.folder / 'new.html', 'unknown')


if __name__ == '__main__':
    unittest.main()
