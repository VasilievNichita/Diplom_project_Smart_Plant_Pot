import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import torch
from folium_ml import CLASSES
from folium_ml.data import prepare, canonical, sha256
from folium_ml.smoke import synthetic_archive
from folium_ml.training import train

class ClassBalanceTests(unittest.TestCase):
    def test_weights_use_training_counts_and_validation_stays_unweighted(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            synthetic_archive(root/'source.zip',groups=3,images_per_group=2)
            manifest=prepare([root/'source.zip'],root/'data',42)
            remove=next(r for r in manifest['items'] if r['split']=='train' and r['plantId']==CLASSES[0])
            manifest['items'].remove(remove)
            manifest.pop('datasetId')
            manifest['datasetId']=sha256(canonical(manifest))
            (root/'data/manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
            observed=[]
            original=torch.nn.functional.cross_entropy
            def loss(*args,**kwargs):
                weight=kwargs.get('weight')
                observed.append(None if weight is None else weight.tolist())
                return original(*args,**kwargs)
            with patch('torch.nn.functional.cross_entropy',side_effect=loss),contextlib.redirect_stdout(io.StringIO()):
                result=train(root/'data',root/'run',epochs=1,batch_size=6,class_balance=True)
            counts=result['trainCounts']; total=sum(counts.values())
            expected=[total/(3*counts[c]) for c in CLASSES]
            self.assertEqual(result['trainingClassWeights'],expected)
            self.assertTrue(result['classBalance'])
            self.assertIn(None,observed)
            self.assertTrue(any(w is not None for w in observed))
            self.assertFalse((root/'run/test-report.json').exists())

if __name__=='__main__':unittest.main()
