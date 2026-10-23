import unittest
from folium_ml.consensus import consensus


class ConsensusTests(unittest.TestCase):
    def test_agreement_and_disagreement(self):
        self.assertTrue(consensus([[.8,.1,.1],[.9,.05,.05]])['accepted'])
        result=consensus([[.9,.05,.05],[.05,.9,.05]])
        self.assertFalse(result['accepted'])
        self.assertAlmostEqual(result['scores'][0],.475)
        self.assertFalse(consensus([[.5,.5,0]],threshold=.4)['accepted'])
        self.assertFalse(consensus([[.4,.3,.3]])['accepted'])

    def test_invalid_vectors(self):
        for scores in [[],[[1]],[[.8,.8]],[[float('nan'),0]],[[1,0],[1,0,0]],[[2,-1]]]:
            with self.assertRaises(ValueError):consensus(scores)

if __name__=='__main__':unittest.main()
