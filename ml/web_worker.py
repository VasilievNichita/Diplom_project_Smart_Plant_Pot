"""Private server bridge. Arguments are server-owned paths, never browser input."""
import sys
from pathlib import Path

from folium_ml.data import audit_archives, prepare, save_json


def run(action, folder):
    folder = Path(folder)
    archive = folder / 'source.zip'
    if action == 'audit':
        report, records, images = audit_archives([archive])
        (folder / 'thumbs').mkdir()
        for key, image in images.items():
            image.save(folder / 'thumbs' / f'{key}.jpg', format='JPEG', quality=85)
        fields = ['id', 'plantId', 'specimenId', 'width', 'height', 'source']
        save_json(folder / 'result.json', {'report': report, 'records': [{k: r[k] for k in fields} for r in records]})
    elif action == 'prepare':
        review = folder / 'decisions.json'
        result = prepare([archive], folder / 'prepared', 42, review if review.exists() else None)
        counts = {split: {'images': sum(r['split'] == split for r in result['items']),
                         'specimens': len({r['specimenId'] for r in result['items'] if r['split'] == split})}
                  for split in ['train', 'validation', 'test']}
        save_json(folder / 'prepared-result.json', {'datasetId': result['datasetId'], 'purpose': result['purpose'], 'counts': counts})
    else:
        raise ValueError('Unknown worker action')


if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2])
