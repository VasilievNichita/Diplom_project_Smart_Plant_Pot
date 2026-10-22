import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from folium_ml.training import PhotoDataset

class BrightnessTests(unittest.TestCase):
    def test_only_training_is_augmented_and_range_is_respected(self):
        with tempfile.TemporaryDirectory() as folder:
            Image.new('RGB',(8,8),(100,100,100)).save(Path(folder)/'image.png')
            rows=[{'image':'image.png','plantId':'cactus'}]
            with patch('folium_ml.training.random.uniform',return_value=.6) as uniform:
                train,_=PhotoDataset(folder,rows,True,(.6,1.4))[0]
                uniform.assert_called_once_with(.6,1.4)
                uniform.reset_mock()
                val,_=PhotoDataset(folder,rows,False,(.6,1.4))[0]
                uniform.assert_not_called()
                self.assertLess(train.mean().item(),val.mean().item())
            for bounds in [(1.4,.6),(0,1),(1,float('nan'))]:
                with self.assertRaises(ValueError):PhotoDataset(folder,rows,True,bounds)

    def test_color_changes_only_training_channels_without_changing_labels(self):
        with tempfile.TemporaryDirectory() as folder:
            Image.new('RGB',(8,8),(100,100,100)).save(Path(folder)/'image.png')
            rows=[{'image':'image.png','plantId':'cactus'}]
            with patch('folium_ml.training.random.uniform',side_effect=[1,1.15,1,.85]):
                tensor,label=PhotoDataset(folder,rows,True,(.6,1.4),True)[0]
            self.assertGreater(tensor[0].mean(),tensor[1].mean())
            self.assertGreater(tensor[1].mean(),tensor[2].mean())
            self.assertEqual(label,2)
            with patch('folium_ml.training.random.uniform') as uniform:
                val,_=PhotoDataset(folder,rows,False,(.6,1.4),True)[0]
                uniform.assert_not_called()
                self.assertEqual(val[0].mean(),val[2].mean())
