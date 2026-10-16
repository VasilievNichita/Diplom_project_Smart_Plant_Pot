"""Private offline photo catalogue and human pair decisions; never trains a model."""
from __future__ import annotations

import base64
import hashlib
import html
import io
import json
import math
from pathlib import Path

from . import CLASSES
from .data import audit_archives, require, save_json
from .inspection_copy import COPY

PAGE_SIZE = 60
STYLE = """
:root{color-scheme:light;font:16px/1.55 system-ui,sans-serif;color:#213e32;background:#f6f5ef}
*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:36px 24px 72px}
h1{font-size:clamp(26px,4vw,40px);line-height:1.18;max-width:900px}h2{font-size:23px}h3{margin-top:0;font-size:18px}
p{max-width:900px}a{color:#235f49}a:focus-visible,button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #be7125;outline-offset:3px}
nav{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0}nav a{padding:6px 12px;border:1px solid #cbd7cc;border-radius:8px}
section{margin:28px 0}.notice{padding:14px 18px;border-left:4px solid #73947b;background:#e8eee5;border-radius:5px}
.warning{background:#fff0d7;border-color:#b47a26;color:#5b3e15}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
.stat,.photo,.pair{border:1px solid #d8ded3;border-radius:16px;background:#fffefa;padding:20px}.stat strong{display:block;font-size:30px}
.pair{margin:18px 0}.pair-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.pair .photo{background:#f5f6ee}
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.photo img{display:block;width:128px;height:128px;margin:0 auto 16px;border:1px solid #ddd}
dl{margin:0}dt{font-size:12px;color:#5b6a60;margin-top:8px}dd{margin:0;overflow-wrap:anywhere}code{font-size:12px;overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:10px;border-bottom:1px solid #d8ded3;overflow-wrap:anywhere}
select,button,input[type=file]{font:inherit;max-width:100%}select{display:block;width:100%;margin-top:8px;padding:10px;border:1px solid #98b4a2;border-radius:8px;background:white}
button{padding:11px 18px;color:white;background:#295d45;border:0;border-radius:9px;cursor:pointer}button:disabled{opacity:.5;cursor:default}
.actions{display:flex;flex-wrap:wrap;gap:18px;align-items:center;margin:20px 0}.check{display:flex;align-items:flex-start;gap:10px}.check input{margin-top:6px}
.muted,footer{color:#59685f;font-size:14px}footer{border-top:1px solid #d8ded3;margin-top:36px;padding-top:18px}
@media(max-width:560px){main{padding:22px 14px 48px}.pair-grid{grid-template-columns:1fr}.pair{padding:14px}}
"""


def esc(value):
    return html.escape(str(value), quote=True)


def embedded_json(value):
    # Prevent untrusted metadata from ending a script element.
    return json.dumps(value, ensure_ascii=False).replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")


def document(language, title, body, report, script=""):
    t = COPY[language]
    script_policy = "'none'"
    if script:
        digest = base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode("ascii")
        script_policy = f"'sha256-{digest}'"
    csp = f"default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src {script_policy}; connect-src 'none'; base-uri 'none'; form-action 'none'"
    warning = f'<p class="notice warning">{esc(t["synthetic"])}</p>' if report["containsSynthetic"] else ""
    if report["purpose"] == "mixed":
        warning += f'<p class="notice warning">{esc(t["mixed"])}</p>'
    return f'''<!doctype html>
<html lang="{language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{esc(csp)}"><title>Folium · {esc(title)}</title><style>{STYLE}</style></head>
<body><main><p class="muted">FOLIUM / DATASET</p><h1>{esc(title)}</h1><p class="notice">{esc(t["private"])}</p>{warning}
{body}<footer><p>{esc(t["thumbnail"])}</p><p>{esc(t["created"])}: {esc(report["createdAt"])}<br>
{esc(t["identity"])}: <code>{esc(report["auditId"])}</code></p></footer></main>
{f'<script type="module">{script}</script>' if script else ''}</body></html>'''


def photo_card(record, thumbnail, t):
    fields = [(t["photo"], record["id"]), (t["class"], t["classes"][record["plantId"]]),
              (t["specimen"], record["specimenId"]), (t["dimensions"], f'{record["width"]} × {record["height"]}'),
              (t["source"], t[record["source"]])]
    description = "".join(f'<dt>{esc(label)}</dt><dd>{esc(value)}</dd>' for label, value in fields)
    return f'<article class="photo"><img loading="lazy" width="128" height="128" src="{thumbnail}" alt="{esc(record["id"])}"><dl>{description}</dl></article>'


def catalogue_links(pages, t):
    return '<nav aria-label="' + esc(t["catalogue"]) + '">' + "".join(
        f'<a href="catalogue-{i:03}.html">{esc(t["page"])} {i}</a>' for i in range(1, pages + 1)) + '</nav>'


def inspect_archives(paths: list[Path], destination: Path, language="ru"):
    require(language in COPY, "Unsupported inspection language")
    require(not destination.exists(), "Inspection folder already exists; choose a new version")
    report, records, images = audit_archives(paths)
    t = COPY[language]
    thumbnails = {}
    for key, image in images.items():
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=85)
        thumbnails[key] = 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')
    by_id = {r["id"]: r for r in records}
    ordered = sorted(records, key=lambda r: (CLASSES.index(r["plantId"]), r["specimenId"], r["id"]))
    pages = max(1, math.ceil(len(ordered) / PAGE_SIZE))
    navigation = catalogue_links(pages, t)
    destination.mkdir(parents=True, exist_ok=False)
    save_json(destination / "audit.json", report)
    for page in range(1, pages + 1):
        cards = "".join(photo_card(r, thumbnails[r["id"]], t) for r in ordered[(page-1)*PAGE_SIZE:page*PAGE_SIZE])
        body = f'<nav><a href="review.html">{esc(t["back"])}</a></nav><p>{esc(t["page"])} {page} / {pages}</p>{navigation}'
        body += f'<div class="gallery">{cards}</div>' if cards else f'<p>{esc(t["no_images"])}</p>'
        (destination / f"catalogue-{page:03}.html").write_text(document(language, t["catalogue"], body, report), encoding="utf-8")
    stats = [(t["images"], report["images"]), (t["specimens"], sum(c["specimens"] for c in report["classes"])),
             (t["pairs"], report["possibleDuplicatePairCount"]), (t["errors"], len(report["errors"]))]
    body = f'<p>{esc(t["intro"])}</p><div class="cards">' + "".join(f'<div class="stat">{esc(label)}<strong>{count}</strong></div>' for label, count in stats) + '</div>'
    body += f'<nav><a href="catalogue-001.html">{esc(t["catalogue"])}</a><a href="audit.json" download>{esc(t["audit"])}</a></nav>'
    rows = ''.join(f'<tr><td>{esc(t["classes"][c["class"]])}</td><td>{c["images"]}</td><td>{c["specimens"]}</td></tr>' for c in report["classes"])
    body += f'<section><h2>{esc(t["counts"])}</h2><table><thead><tr><th>{esc(t["class"])}</th><th>{esc(t["images"])}</th><th>{esc(t["specimens"])}</th></tr></thead><tbody>{rows}</tbody></table>'
    body += f'<p>{esc(t["structural_yes"] if report["structuralSplitPossible"] else t["structural_no"])}</p><p class="muted">{esc(t["minimum"])}</p></section>'
    errors = ''.join(f'<li><code>{esc(error.get("archive", ""))} {esc(error.get("id", ""))}</code>: {esc(error["error"])}</li>' for error in report["errors"])
    body += f'<section><h2>{esc(t["errors"])}</h2>' + (f'<ul class="notice warning">{errors}</ul>' if errors else f'<p>{esc(t["no_errors"])}</p>') + '</section>'
    duplicates = ''.join(f'<li><code>{esc(row["id"])}</code> → <code>{esc(row["sameAs"])}</code></li>' for row in report["duplicatesOmitted"])
    if duplicates:
        body += f'<details><summary>{esc(t["omitted"])} ({len(report["duplicatesOmitted"])})</summary><p>{esc(t["same_as"])}</p><ul>{duplicates}</ul></details>'
    body += f'<section><h2>{esc(t["pairs"])}</h2><p>{esc(t["hint"])}</p><p class="muted">{esc(t["thumbnail"])}</p>'
    if report["possibleDuplicateListTruncated"]:
        body += f'<p class="notice warning">{esc(t["truncated"])}</p>'
    pairs = report["possibleCrossSpecimenDuplicates"]
    for index, pair in enumerate(pairs):
        cards = ''.join(photo_card(by_id[pair[key]], thumbnails[pair[key]], t) for key in ["first", "second"])
        options = ''.join(f'<option value="{value}">{esc(t[value or "unanswered"])}</option>' for value in ["", "different_specimens", "same_specimen", "uncertain"])
        body += f'<article class="pair"><h3>{esc(t["pair"])} {index + 1}</h3><p class="muted">{esc(t["distance"])}: {pair["distance"]}/64</p><div class="pair-grid">{cards}</div><label for="pair-{index}">{esc(t["choice"])}</label><select id="pair-{index}" data-pair-index="{index}">{options}</select></article>'
    if not pairs:
        body += f'<p>{esc(t["no_pairs"])}</p>'
    body += '</section>'
    script = ""
    if pairs:
        body += f'''<section><h2>{esc(t["review"])}</h2><p>{esc(t["decision_help"])}</p>
<label class="check"><input id="acknowledged" type="checkbox">{esc(t["ack"])}</label>
<p id="review-status" role="status">{esc(t["pending"])}</p><div class="actions"><button type="button" id="save-review" disabled>{esc(t["save"])}</button>
<label>{esc(t["load"])}<br><input id="load-review" type="file" accept="application/json,.json" disabled></label></div>
<p id="review-message" role="status"></p><p class="muted">{esc(t["file_help"])}</p><noscript><p class="notice warning">{esc(t["noscript"])}</p></noscript></section>'''
        payload = {"auditId": report["auditId"], "purpose": report["purpose"], "pairs": pairs,
                   "blocked": not report["ok"] or report["possibleDuplicateListTruncated"],
                   "copy": {key: t[key] for key in ["progress", "corrections", "ready", "pending", "blocked", "downloaded", "loaded", "bad_review"]}}
        body += f'<script id="review-data" type="application/json">{embedded_json(payload)}</script>'
        script = Path(__file__).with_name("inspection_ui.mjs").read_text(encoding="utf-8")
    (destination / "review.html").write_text(document(language, t["title"], body, report, script), encoding="utf-8")
    return {"report": str(destination / "review.html"), "auditOk": report["ok"], "auditId": report["auditId"],
            "purpose": report["purpose"], "images": report["images"], "cataloguePages": pages,
            "possibleDuplicatePairCount": report["possibleDuplicatePairCount"], "structuralSplitPossible": report["structuralSplitPossible"]}
