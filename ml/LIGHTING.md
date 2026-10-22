# Lighting augmentation

The Python training API accepts `brightness=(0.6, 1.4)` and
`color_jitter=True`. Defaults retain brightness 0.9–1.1 and disable color jitter.
Both changes affect training images only; validation and test inputs retain
the original preprocessing. Color jitter applies independent RGB gains
0.85–1.15 after brightness scaling. Each run records these ranges.

```python
from pathlib import Path
from folium_ml.training import train

train(Path('prepared'), Path('runs/lighting-42'), seed=42,
      class_balance=True, brightness=(0.6, 1.4), color_jitter=False)
```

Compare matched seeds, initial parameter hashes, dataset versions and runtime
versions. Keep the checkpoint selection rule fixed. Report unmodified images
and each lighting condition separately, including regressions. Modified copies
do not increase the number of independent plants. Digital brightness and RGB
scaling do not represent measured lux, lamp spectrum or camera noise.

More augmentation is not necessarily better. Retain unsuccessful candidates
for analysis and do not automatically replace the active model. Preserve the
held-out test for final evaluation. No disease or actuator decisions are trained
by these options.
