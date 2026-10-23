"""Conservative score aggregation; agreement is not proof of correctness."""
import math


def consensus(scores, threshold=.7):
    if not scores or not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ValueError('Invalid scores or threshold')
    width = len(scores[0])
    if width < 2 or any(len(row) != width or any(not math.isfinite(x) or x < 0 or x > 1 for x in row) or abs(sum(row)-1) > 1e-5 for row in scores):
        raise ValueError('Expected equally sized normalized score vectors')
    mean = [sum(row[i] for row in scores)/len(scores) for i in range(width)]
    winner = max(range(width), key=lambda i: mean[i])
    votes = [max(range(width), key=lambda i: row[i]) for row in scores]
    tied = any(row.count(max(row)) > 1 for row in scores)
    accepted = not tied and all(v == winner for v in votes) and mean[winner] >= threshold
    return {'scores': mean, 'candidateIndex': winner, 'accepted': accepted,
            'unanimous': not tied and len(set(votes)) == 1, 'votes': votes,
            'reason': 'consensus' if accepted else 'review_required'}
