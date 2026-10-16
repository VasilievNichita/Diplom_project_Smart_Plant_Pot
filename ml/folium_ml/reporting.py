"""Offline reports from existing run files. Never trains, evaluates, or opens photos."""
from __future__ import annotations

import base64
import html
import io
import json
import math
import re
from pathlib import Path

import numpy as np

from . import ARCHITECTURE, CLASSES, IMAGE_SIZE, VERSION
from .data import now, require, sha256
from .metrics import classification_metrics, metrics_from_confusion
from .report_copy import COPY


def number(value, minimum=0, maximum=float('inf')):
    return type(value) in (int, float) and math.isfinite(value) and minimum <= value <= maximum


def read_json(path):
    require(path.stat().st_size <= 8 * 1024 * 1024, f'Report input is too large: {path.name}')
    return json.loads(path.read_text(encoding='utf-8'))


def verify_metrics(metrics, expected=None):
    require(isinstance(metrics, dict), 'Invalid metrics')
    expected = expected or metrics_from_confusion(metrics.get('confusionMatrix'))
    require(metrics.get('confusionMatrix') == expected['confusionMatrix'], 'Confusion matrix disagrees with predictions')
    for key in ('count', 'matrixRows', 'matrixColumns'):
        require(metrics.get(key) == expected[key], f'Invalid metric: {key}')
    for key in ('accuracy', 'macroF1', 'balancedAccuracy'):
        require(number(metrics.get(key), 0, 1) and math.isclose(metrics[key], expected[key], abs_tol=1e-8), f'Inconsistent metric: {key}')
    if 'loss' in metrics:
        require(number(metrics['loss']), 'Invalid loss')
    classes = metrics.get('classes')
    require(isinstance(classes, list) and len(classes) == len(CLASSES), 'Invalid per-class metrics')
    for recorded, actual in zip(classes, expected['classes']):
        require(isinstance(recorded, dict) and recorded.get('class') == actual['class'] and recorded.get('support') == actual['support'], 'Invalid class order or support')
        for key in ('precision', 'recall', 'f1'):
            require(number(recorded.get(key), 0, 1) and math.isclose(recorded[key], actual[key], abs_tol=1e-8), f'Inconsistent per-class {key}')


def validate_test(test, model):
    require(isinstance(test, dict) and test.get('format') == 'folium-test-report' and test.get('version') == VERSION, 'Unsupported test report')
    for key in ('datasetId', 'weightsSha256', 'purpose'):
        require(test.get(key) == model[key], f'Test report belongs to a different run: {key}')
    rows = test.get('predictions')
    require(isinstance(rows, list) and 0 < len(rows) <= 4000, 'Missing or excessive test predictions')
    ids, specimens, targets, predictions = set(), {}, [], []
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get('id'), str) and row['id'] not in ids, 'Invalid or repeated test photo id')
        ids.add(row['id'])
        require(row.get('true') in CLASSES and row.get('predicted') in CLASSES, 'Invalid test class')
        require(isinstance(row.get('specimenId'), str) and row['specimenId'], 'Missing test specimen')
        scores = row.get('scores')
        require(isinstance(scores, list) and len(scores) == len(CLASSES) and all(number(s, 0, 1) for s in scores) and
                math.isclose(sum(scores), 1, abs_tol=1e-5), 'Invalid prediction scores')
        predicted, target = CLASSES.index(row['predicted']), CLASSES.index(row['true'])
        require(predicted == int(np.argmax(scores)), 'Predicted class disagrees with scores')
        item = specimens.setdefault(row['specimenId'], {'target': target, 'scores': []})
        require(item['target'] == target, 'Conflicting test specimen labels')
        item['scores'].append(scores)
        targets.append(target)
        predictions.append(predicted)
    verify_metrics(test.get('imageMetrics'), classification_metrics(targets, predictions))
    verify_metrics(test.get('specimenMetrics'), classification_metrics([s['target'] for s in specimens.values()],
        [int(np.mean(s['scores'], axis=0).argmax()) for s in specimens.values()]))
    verify_metrics(test.get('majorityBaseline'), classification_metrics(targets, [CLASSES.index(model['majorityClass'])] * len(targets)))


def load_run(run):
    model = read_json(run / 'model.json')
    require(isinstance(model, dict) and model.get('format') == 'folium-model-run' and model.get('version') == VERSION, 'Unsupported run metadata')
    require(model.get('architecture') == ARCHITECTURE and model.get('classes') == list(CLASSES) and model.get('imageSize') == IMAGE_SIZE, 'Unexpected architecture or classes')
    require(model.get('purpose') in ('synthetic-smoke-test', 'plant-research'), 'Unknown run purpose')
    require(model.get('pretrained') is False and model.get('initialization') == 'random' and model.get('testUsedDuringTraining') is False, 'Not a supported from-scratch training run')
    require(type(model.get('epochsCompleted')) is int and 1 <= model['epochsCompleted'] <= 500, 'Missing completed training epochs')
    require(type(model.get('parameterCount')) is int and model['parameterCount'] > 0, 'Invalid parameter count')
    for key in ('datasetId', 'weightsSha256', 'sourceSha256'):
        require(isinstance(model.get(key), str) and re.fullmatch('[a-f0-9]{64}', model[key]), f'Invalid {key}')
    weights = run / 'model.pt'
    require(weights.stat().st_size < 5 * 1024 * 1024 and sha256(weights.read_bytes()) == model['weightsSha256'], 'Checkpoint integrity mismatch')
    history_file = run / 'history.json'
    history = read_json(history_file)
    if 'historySha256' in model:
        require(sha256(history_file.read_bytes()) == model['historySha256'], 'Training history integrity mismatch')
    require(isinstance(history, list) and len(history) == model['epochsCompleted'], 'Incomplete training history')
    for epoch, record in enumerate(history, 1):
        require(isinstance(record, dict) and record.get('epoch') == epoch and number(record.get('trainLoss')), 'Invalid training history')
        verify_metrics(record.get('validation'))
        require(number(record['validation'].get('loss')), 'Missing validation loss')
    best_epoch = min(history, key=lambda item: item['validation']['loss'])['epoch']
    require(type(model.get('bestEpoch')) is int and model['bestEpoch'] == best_epoch, 'Selected epoch disagrees with validation history')
    counts = model.get('trainCounts')
    require(isinstance(counts, dict) and set(counts) == set(CLASSES) and all(type(n) is int and n > 0 for n in counts.values()), 'Invalid training class counts')
    require(model.get('majorityClass') == max(CLASSES, key=lambda c: counts[c]), 'Incorrect training baseline class')
    summary = model.get('splitSummary')
    if summary is not None:
        require(isinstance(summary, dict) and set(summary) == {'train', 'validation', 'test'}, 'Invalid split summary')
        for entry in summary.values():
            require(isinstance(entry, dict) and type(entry.get('images')) is int and type(entry.get('specimens')) is int and
                    3 <= entry['specimens'] <= entry['images'] <= 4000, 'Invalid split counts')
        require(summary['train']['images'] == sum(counts.values()), 'Training counts disagree')
        require(all(r['validation']['count'] == summary['validation']['images'] for r in history), 'Validation counts disagree')
    test_path = run / 'test-report.json'
    test = read_json(test_path) if test_path.exists() else None
    if test is not None:
        validate_test(test, model)
        if summary:
            require(summary['test']['images'] == test['imageMetrics']['count'] and summary['test']['specimens'] == test['specimenMetrics']['count'], 'Test counts disagree with training run')
    return model, history, test


def figure_image(figure):
    buffer = io.BytesIO()
    figure.savefig(buffer, format='png', dpi=150, facecolor='white', bbox_inches='tight', metadata={'Software': 'Folium / Matplotlib'})
    return 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')


def charts(model, history, test, labels):
    # A non-interactive backend: no GUI windows, web access or model execution.
    from matplotlib import rc_context
    from matplotlib.figure import Figure
    from matplotlib.ticker import MaxNLocator
    synthetic = model['purpose'] == 'synthetic-smoke-test'
    with rc_context({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False}):
        figure = Figure(figsize=(9, 3.9), layout='constrained')
        axis = figure.subplots()
        epochs = [r['epoch'] for r in history]
        for key, values, color in [('train', [r['trainLoss'] for r in history], '#22634f'),
                                   ('validation', [r['validation']['loss'] for r in history], '#b86a2a')]:
            axis.plot(epochs, values, label=labels[key], color=color, linewidth=2, marker='o' if len(epochs) < 15 else None)
        axis.axvline(model['bestEpoch'], color='#85958b', linestyle='--', label=labels['best'])
        axis.set(xlabel=labels['epoch'], ylabel=labels['loss'], ylim=(0, None))
        axis.xaxis.set_major_locator(MaxNLocator(integer=True))
        if len(epochs) == 1:
            axis.set_xlim(.5, 1.5)
            axis.set_xticks([1])
        axis.grid(alpha=.15)
        axis.legend(loc='best')
        figure.suptitle(labels['synthetic'] if synthetic else labels['learning'], fontsize=11)
        result = {'loss': figure_image(figure)}
        if test:
            for name, metric in [('by_image', 'imageMetrics'), ('by_specimen', 'specimenMetrics')]:
                figure = Figure(figsize=(5.8, 4.7), layout='constrained')
                axis = figure.subplots()
                matrix = test[metric]['confusionMatrix']
                axis.imshow(matrix, cmap='Greens', vmin=0, vmax=max(1, max(map(max, matrix))))
                names = [labels[c] for c in CLASSES]
                axis.set(xticks=range(3), yticks=range(3), xticklabels=names, yticklabels=names,
                         xlabel=labels['predicted'], ylabel=labels['true'])
                axis.tick_params(axis='x', labelrotation=20)
                for i, row in enumerate(matrix):
                    for j, count in enumerate(row):
                        axis.text(j, i, str(count), ha='center', va='center', fontsize=16,
                                  color='white' if count > max(map(max, matrix)) / 2 else '#213b2d')
                figure.suptitle((labels['synthetic'] + '\n' if synthetic else '') + labels[name], fontsize=10)
                result[name] = figure_image(figure)
        return result


CSS = """
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f5f4ed;color:#203b2d;font:16px/1.6 'Segoe UI',Arial,sans-serif}
main{max-width:1120px;margin:0 auto;padding:32px 24px 64px}header{padding:10px 0 28px}.brand{letter-spacing:.22em;font-size:13px;font-weight:700;color:#53715c}
h1{font-size:clamp(29px,4vw,44px);line-height:1.15;letter-spacing:-.035em;margin:16px 0 12px}h2{font-size:23px;margin:0 0 18px}p{margin:10px 0}
.muted,figcaption{color:#627366;font-size:14px}.status{display:inline-block;padding:6px 13px;background:#e6eee4;border-radius:20px;font-size:14px;font-weight:600}
.banner{background:#fff0d5;border:1px solid #d7b273;border-radius:16px;padding:20px 24px;margin-bottom:24px;color:#67451c}.banner strong{letter-spacing:.04em}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:24px 0}.card,section{border:1px solid #dfe5d9;background:#fffefa;border-radius:18px}
.card{padding:18px}.card span{display:block;font-size:13px;color:#627366}.card strong{display:block;font-size:26px;margin-top:5px}section{padding:26px;margin-top:22px}
.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px;text-align:left}caption{text-align:left;font-weight:600;padding:10px 0}
th,td{padding:12px 10px;border-bottom:1px solid #e6e9e0;vertical-align:top}th{color:#4c6655;font-weight:600}thead{background:#f3f6ee}.selected{background:#eef4e8}
figure{margin:0}figure img{width:100%;height:auto;display:block;border-radius:10px}figcaption{padding:10px 0}.matrices{display:grid;grid-template-columns:1fr 1fr;gap:22px}
details{margin-top:16px}summary{cursor:pointer;font-weight:600}dl{display:grid;grid-template-columns:200px 1fr;gap:12px;font-size:14px}dt{color:#627366}dd{margin:0;overflow-wrap:anywhere}
footer{padding:28px 0;color:#627366;font-size:13px}.notice{border-left:3px solid #b88841;padding-left:16px}code{font-size:12px}
@media(max-width:650px){main{padding:18px 12px}.cards{grid-template-columns:1fr 1fr}.matrices{grid-template-columns:1fr}section{padding:18px 14px}dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:12px}}
@media print{body{background:white}main{padding:0}.card,section{break-inside:avoid;box-shadow:none}details{display:block}summary{display:none}.banner{border:2px solid #a86d28}h1{font-size:30px}}
"""


def render_report(run: Path, destination: Path, language='ru'):
    require(language in COPY, 'Choose report language ru, ro or en')
    require(destination.suffix.lower() == '.html' and not destination.exists(), 'Use a new .html report path; existing files are not overwritten')
    model, history, test = load_run(run)
    t, esc = COPY[language], lambda value: html.escape(str(value), quote=True)
    percent = lambda value: f'{value * 100:.2f}%'
    figures = charts(model, history, test, t)
    synthetic = model['purpose'] == 'synthetic-smoke-test'
    def table(headers, rows, caption=None):
        return '<div class="scroll"><table>' + (f'<caption>{esc(caption)}</caption>' if caption else '') + '<thead><tr>' + ''.join(f'<th scope="col">{esc(v)}</th>' for v in headers) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(f'<td>{esc(v)}</td>' for v in row) + '</tr>' for row in rows) + '</tbody></table></div>'
    def chart(key, caption):
        return f'<figure><img src="{figures[key]}" alt="{esc(caption)}"><figcaption>{esc(caption)}</figcaption></figure>'
    banner = f'<aside class="banner"><strong>{esc(t["synthetic"])}</strong><p>{esc(t["synthetic_note"])}</p></aside>' if synthetic else ''
    cards = ''.join(f'<div class="card"><span>{esc(t[key])}</span><strong>{esc(value)}</strong></div>' for key, value in
                    [('epochs', model['epochsCompleted']), ('best', model['bestEpoch']), ('parameters', f'{model["parameterCount"]:,}'), ('initialization', t['random'])])
    summary = model.get('splitSummary', {})
    data_rows = [[t[split], summary.get(split, {}).get('images', t['unknown']), summary.get(split, {}).get('specimens', t['unknown'])] for split in ('train', 'validation', 'test')]
    history_rows = [[r['epoch'], f'{r["trainLoss"]:.6f}', f'{r["validation"]["loss"]:.6f}', percent(r['validation']['accuracy']), f'{r["validation"]["macroF1"]:.4f}'] for r in history]
    results = f'<p class="notice">{esc(t["pending_note"])}</p>'
    if test:
        rows = [[t[label], percent(test[key]['accuracy']), f'{test[key]["macroF1"]:.4f}', percent(test[key]['balancedAccuracy']), test[key]['count']]
                for label, key in [('by_image', 'imageMetrics'), ('by_specimen', 'specimenMetrics'), ('baseline', 'majorityBaseline')]]
        results = table([t['method'], t['accuracy'], t['f1'], t['balanced'], 'n'], rows) + f'<p class="muted">{esc(t["baseline_note"])}</p><p class="notice">{esc(t["small"])}</p>'
        results += '<div class="matrices">' + ''.join(chart(key, t['confusion'] + ' · ' + t[key]) for key in ('by_image', 'by_specimen')) + '</div>'
        for label, key in [('by_image', 'imageMetrics'), ('by_specimen', 'specimenMetrics')]:
            results += '<details><summary>' + esc(t['confusion'] + ' · ' + t[label]) + '</summary>' + table([t['true'] + ' / ' + t['predicted']] + [t[c] for c in CLASSES],
                       [[t[c], *row] for c, row in zip(CLASSES, test[key]['confusionMatrix'])]) + '</details>'
        results += table([t['class'], t['support'], t['precision'], t['recall'], t['f1']],
                         [[t[r['class']], r['support'], f'{r["precision"]:.4f}', f'{r["recall"]:.4f}', f'{r["f1"]:.4f}'] for r in test['imageMetrics']['classes']], t['class_details'])
    provenance = [(t['generated'], now()), (t['started'], model.get('startedAt', t['unknown'])), (t['finished'], model.get('finishedAt', t['unknown']))]
    provenance += [(t[label], model.get(key, t['unknown'])) for label, key in [('architecture', 'architecture'), ('dataset', 'datasetId'), ('weights', 'weightsSha256'), ('source', 'sourceSha256'), ('seed', 'seed'), ('device', 'device')]]
    provenance += [(key, model.get(key, t['unknown'])) for key in ('torch', 'numpy', 'pillow')]
    details = ''.join(f'<dt>{esc(label)}</dt><dd>{esc(value)}</dd>' for label, value in provenance)
    legacy = f'<p class="notice">{esc(t["legacy"])}</p>' if 'historySha256' not in model else ''
    content = f'''<!doctype html>
<html lang="{language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Folium · {esc(t['title'])}</title><style>{CSS}</style></head><body><main>
<header><div class="brand">FOLIUM / MODEL LAB</div><h1>{esc(t['title'])}</h1><p class="muted">{esc(t['subtitle'])}</p><span class="status">{esc(t['evaluated' if test else 'pending'])}</span></header>
{banner}<div class="cards">{cards}</div>
<section><h2>{esc(t['data'])}</h2>{table([t['split'], t['images'], t['specimens']], data_rows)}<p class="muted">{esc(t['split_note'])}</p></section>
<section><h2>{esc(t['learning'])}</h2>{chart('loss', t['selection'])}<details><summary>{esc(t['history'])}</summary>{table([t['epoch'], t['train'] + ' loss', t['validation'] + ' loss', t['val_accuracy'], t['val_f1']], history_rows)}</details></section>
<section><h2>{esc(t['results'])}</h2>{results}<p class="muted">{esc(t['limits'])}</p></section>
<section><h2>{esc(t['provenance'])}</h2><dl>{details}</dl><p class="muted">{esc(t['integrity'])}</p>{legacy}</section>
<footer>{esc(t['private'])}</footer></main></body></html>'''
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('x', encoding='utf-8') as output:
        output.write(content)
    return {'report': str(destination), 'language': language, 'purpose': model['purpose'], 'testEvaluated': test is not None,
            'status': 'synthetic-software-check' if synthetic else ('evaluated' if test else 'test-pending')}
