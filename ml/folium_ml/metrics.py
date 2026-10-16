"""Shared, framework-independent classification metrics."""
from . import CLASSES
from .data import require


def metrics_from_confusion(matrix):
    size = len(CLASSES)
    require(isinstance(matrix, list) and len(matrix) == size and
            all(isinstance(row, list) and len(row) == size and
                all(type(n) is int and n >= 0 for n in row) for row in matrix), "Invalid confusion matrix")
    count = sum(map(sum, matrix))
    require(count > 0, "Metrics require non-empty predictions")
    per_class = []
    for i, name in enumerate(CLASSES):
        tp, support = matrix[i][i], sum(matrix[i])
        predicted_count = sum(row[i] for row in matrix)
        precision = tp / predicted_count if predicted_count else 0.0
        recall = tp / support if support else 0.0
        per_class.append({"class": name, "support": support, "precision": precision, "recall": recall,
                          "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0})
    return {"count": count, "accuracy": sum(matrix[i][i] for i in range(size)) / count,
            "macroF1": sum(c["f1"] for c in per_class) / size,
            "balancedAccuracy": sum(c["recall"] for c in per_class) / size,
            "confusionMatrix": matrix, "matrixRows": "true_class", "matrixColumns": "predicted_class", "classes": per_class}


def classification_metrics(targets, predictions):
    require(len(targets) == len(predictions) and len(targets) > 0, "Metrics require matching non-empty predictions")
    matrix = [[0 for _ in CLASSES] for _ in CLASSES]
    for target, predicted in zip(targets, predictions):
        require(type(target) is int and type(predicted) is int and
                0 <= target < len(CLASSES) and 0 <= predicted < len(CLASSES), "Invalid class index")
        matrix[target][predicted] += 1
    return metrics_from_confusion(matrix)
