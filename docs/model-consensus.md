# Experimental model consensus

`ml/folium_ml/consensus.py` aggregates normalized score vectors with identical class order. It averages scores and returns a candidate index. `accepted` requires an untied winner in every model, unanimous agreement, and an average winning score at least the configured threshold (default 0.7). Other cases require review.

This is an experimental pure function, not a deployed classifier or calibrated confidence estimate. The caller must verify model provenance, matching class order and image preprocessing. Agreement between models trained on the same data does not prove correctness and does not detect unseen plant species reliably. A candidate index remains present even when `accepted` is false; callers must not present it as a confirmed identification.

The component is not integrated into production inference. Before deployment, evaluate coverage and error rate on independent specimens under real camera lighting. Record shared mistakes as well as correct answers; a unanimous answer can still be wrong. Plant identification must not directly trigger watering, heating or chemical treatment.

Run the dependency-free component tests from `ml`: `python -m unittest discover -s tests -p test_consensus.py`.
