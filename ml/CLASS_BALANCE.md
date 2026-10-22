# Training class balance

The Python training API accepts `class_balance=True` (default false):

```python
from pathlib import Path
from folium_ml.training import train
train(Path('prepared'), Path('runs/balanced'), class_balance=True)
```

Weights are inverse training frequency, N / (3 × class count). Validation loss
remains unweighted for checkpoint selection. The run records these weights and
dataset provenance. Compare matched seeds in the same runtime and check initial
weight hashes. This option does not promise an accuracy improvement.

This release publishes code and a synthetic test only, not photographs, trained
weights or experimental accuracy claims. The CLI switch is a separate local
integration; the public Python API shown above is independently usable.
