"""A small CNN designed here, initialized by PyTorch from random weights."""
import torch
from torch import nn

from . import ARCHITECTURE, CLASSES


class FoliumCNN(nn.Module):
    def __init__(self):
        super().__init__()
        layers = []
        incoming = 3
        for outgoing in (16, 32, 64, 96):
            layers.extend([
                nn.Conv2d(incoming, outgoing, kernel_size=3, padding=1, bias=False),
                nn.GroupNorm(4, outgoing),
                nn.ReLU(inplace=True),
                nn.MaxPool2d(2),
            ])
            incoming = outgoing
        self.features = nn.Sequential(*layers)
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.classifier = nn.Sequential(nn.Dropout(.15), nn.Linear(96, len(CLASSES)))

    def forward(self, images):
        return self.classifier(self.pool(self.features(images)).flatten(1))


def initialization_hash(model):
    import hashlib
    digest = hashlib.sha256()
    for key, value in sorted(model.state_dict().items()):
        digest.update(key.encode())
        digest.update(value.detach().cpu().contiguous().numpy().tobytes())
    return digest.hexdigest()
