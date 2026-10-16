import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import torch

from folium_ml import CLASSES, IMAGE_SIZE
from folium_ml.data import DataError, prepare
from folium_ml.model import FoliumCNN, initialization_hash
from folium_ml.smoke import synthetic_archive
from folium_ml.training import PhotoDataset, classification_metrics, evaluate, load_model, predict, set_seed, train


class ModelTests(unittest.TestCase):
    def test_random_initialization_is_seeded_and_gradients_reach_all_layers(self):
        set_seed(41)
        first = FoliumCNN()
        set_seed(41)
        self.assertEqual(initialization_hash(first), initialization_hash(FoliumCNN()))
        set_seed(42)
        self.assertNotEqual(initialization_hash(first), initialization_hash(FoliumCNN()))
        output = first(torch.randn(2, 3, IMAGE_SIZE, IMAGE_SIZE))
        self.assertEqual(tuple(output.shape), (2, len(CLASSES)))
        torch.nn.functional.cross_entropy(output, torch.tensor([0, 2])).backward()
        self.assertTrue(all(p.grad is not None and torch.isfinite(p.grad).all() for p in first.parameters()))

    def test_metrics_against_hand_calculated_confusion_matrix(self):
        result = classification_metrics([0, 0, 1, 1, 2, 2], [0, 1, 1, 1, 0, 2])
        self.assertEqual(result['confusionMatrix'], [[1, 1, 0], [0, 2, 0], [1, 0, 1]])
        self.assertAlmostEqual(result['accuracy'], 4 / 6)
        self.assertAlmostEqual(result['balancedAccuracy'], (0.5 + 1 + 0.5) / 3)
        self.assertAlmostEqual(result['macroF1'], (0.5 + 0.8 + 2 / 3) / 3)
        missing = classification_metrics([0, 1, 2], [0, 0, 0])
        self.assertEqual(missing['classes'][1]['precision'], 0)
        self.assertAlmostEqual(missing['accuracy'], 1 / 3)
        with self.assertRaises(DataError):
            classification_metrics([], [])


class TrainingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='folium-training-test-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        cls.archive = cls.root / 'synthetic.zip'
        synthetic_archive(cls.archive, groups=3, images_per_group=2)
        cls.data = cls.root / 'prepared'
        cls.manifest = prepare([cls.archive], cls.data, 41)
        cls.run_dir = cls.root / 'run'
        cls.accessed = []
        original = PhotoDataset.__getitem__

        def record_access(dataset, index):
            cls.accessed.append((dataset.records[index]['split'], dataset.augment))
            return original(dataset, index)

        with patch.object(PhotoDataset, '__getitem__', record_access), contextlib.redirect_stdout(io.StringIO()):
            cls.metadata = train(cls.data, cls.run_dir, epochs=2, batch_size=6, seed=41)

    def test_training_uses_only_train_and_validation_and_updates_random_weights(self):
        self.assertEqual(set(self.accessed), {('train', True), ('validation', False)})
        self.assertNotEqual(self.metadata['initialStateSha256'], self.metadata['trainedStateSha256'])
        self.assertFalse(self.metadata['pretrained'])
        self.assertFalse(self.metadata['testUsedDuringTraining'])
        self.assertEqual(self.metadata['purpose'], 'synthetic-smoke-test')
        self.assertFalse((self.run_dir / 'test-report.json').exists())
        loaded, _, _ = load_model(self.run_dir)
        self.assertEqual(initialization_hash(loaded), self.metadata['trainedStateSha256'])
        self.assertTrue((self.run_dir / 'history.json').exists())

    def test_frozen_evaluation_uses_only_test_and_keeps_software_test_label(self):
        with tempfile.TemporaryDirectory(dir=self.root) as folder:
            # Separate report location, preserving the class-level unevaluated run.
            run = Path(folder)
            for name in ('model.pt', 'model.json'):
                (run / name).write_bytes((self.run_dir / name).read_bytes())
            accessed = []
            original = PhotoDataset.__getitem__

            def record_access(dataset, index):
                accessed.append((dataset.records[index]['split'], dataset.augment))
                return original(dataset, index)

            with patch.object(PhotoDataset, '__getitem__', record_access):
                report = evaluate(self.data, run)
            self.assertEqual(set(accessed), {('test', False)})
            self.assertEqual(report['imageMetrics']['count'], 6)
            self.assertEqual(report['specimenMetrics']['count'], 3)
            self.assertAlmostEqual(report['majorityBaseline']['accuracy'], 1 / 3)
            self.assertIn('SOFTWARE TEST ONLY', report['warning'])
            self.assertEqual(report, json.loads((run / 'test-report.json').read_text()))
            with self.assertRaisesRegex(DataError, 'already exists'):
                evaluate(self.data, run)

    def test_evaluation_refuses_a_different_frozen_dataset(self):
        other = self.root / 'other-prepared'
        prepare([self.archive], other, 42)
        with self.assertRaisesRegex(DataError, 'differs'):
            evaluate(other, self.run_dir)

    def test_synthetic_model_cannot_present_a_plant_decision(self):
        sample = self.data / self.manifest['items'][0]['image']
        result = predict(self.run_dir, sample, threshold=0)
        self.assertEqual(result['decision'], 'synthetic_test_only')
        self.assertTrue(result['requiresHumanConfirmation'])
        self.assertIsNone(result['diagnosis'])
        self.assertIsNone(result['pumpCommand'])
        self.assertAlmostEqual(sum(result['scores'].values()), 1, places=6)
        with self.assertRaises(DataError):
            predict(self.run_dir, sample, threshold=float('nan'))

    def test_checkpoint_tampering_is_rejected_before_loading(self):
        with tempfile.TemporaryDirectory(dir=self.root) as folder:
            altered = Path(folder)
            (altered / 'model.json').write_bytes((self.run_dir / 'model.json').read_bytes())
            (altered / 'model.pt').write_bytes(b'not a checkpoint')
            with self.assertRaisesRegex(DataError, 'integrity mismatch'):
                load_model(altered)

    def test_invalid_training_and_overwrite_are_rejected_before_output(self):
        with self.assertRaisesRegex(DataError, 'already exists'):
            train(self.data, self.run_dir)
        output = self.root / 'invalid-run'
        for options in ({'epochs': 0}, {'learning_rate': float('nan')}, {'batch_size': 0}, {'seed': -1}):
            with self.assertRaises(DataError):
                train(self.data, output, **options)
            self.assertFalse(output.exists())

    def test_validation_images_are_never_randomly_augmented(self):
        rows = [r for r in self.manifest['items'] if r['split'] == 'validation']
        dataset = PhotoDataset(self.data, rows)
        set_seed(1)
        first, label = dataset[0]
        set_seed(999)
        second, other_label = dataset[0]
        self.assertTrue(torch.equal(first, second))
        self.assertEqual(label, other_label)


if __name__ == '__main__':
    unittest.main()
