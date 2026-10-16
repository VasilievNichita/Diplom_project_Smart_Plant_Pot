import argparse
import json
import sys
from pathlib import Path

from .data import DataError, audit_archives, prepare, save_json


def main(argv=None):
    parser = argparse.ArgumentParser(description="Folium: local photo preparation and from-scratch CNN. Never controls pumps.")
    commands = parser.add_subparsers(dest="command", required=True)
    audit = commands.add_parser("audit", help="Validate exported ZIP files without training")
    audit.add_argument("--archive", type=Path, nargs="+", required=True)
    audit.add_argument("--out", type=Path, required=True)
    prep = commands.add_parser("prepare", help="Freeze independent specimen-level splits")
    prep.add_argument("--archive", type=Path, nargs="+", required=True)
    prep.add_argument("--out", type=Path, required=True)
    prep.add_argument("--seed", type=int, default=42)
    prep.add_argument("--review-file", type=Path, help="Human pair decisions downloaded from inspect; bound to the current dataset")
    inspect = commands.add_parser("inspect", help="Create a private offline photo catalogue and pair-review page")
    inspect.add_argument("--archive", type=Path, nargs="+", required=True)
    inspect.add_argument("--out", type=Path, required=True)
    inspect.add_argument("--language", choices=["ru", "ro", "en"], default="ru")
    fit = commands.add_parser("train", help="Train FoliumCNN with random initial weights")
    fit.add_argument("--data", type=Path, required=True)
    fit.add_argument("--out", type=Path, required=True)
    fit.add_argument("--epochs", type=int, default=30)
    fit.add_argument("--batch-size", type=int, default=16)
    fit.add_argument("--learning-rate", type=float, default=.001)
    fit.add_argument("--seed", type=int, default=42)
    fit.add_argument("--patience", type=int, default=8)
    fit.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    evaluate = commands.add_parser("evaluate", help="Evaluate the selected checkpoint on its held-out test once")
    evaluate.add_argument("--data", type=Path, required=True)
    evaluate.add_argument("--run", type=Path, required=True)
    evaluate.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    predict = commands.add_parser("predict", help="Class scores for one image; no diagnosis or care command")
    predict.add_argument("--run", type=Path, required=True)
    predict.add_argument("--image", type=Path, required=True)
    predict.add_argument("--threshold", type=float, default=.7)
    smoke = commands.add_parser("smoke", help="Run a synthetic software check, not an experiment with plants")
    smoke.add_argument("--out", type=Path, required=True)
    report = commands.add_parser("report", help="Create an offline HTML report from an existing run; does not run evaluation")
    report.add_argument("--run", type=Path, required=True)
    report.add_argument("--out", type=Path, required=True)
    report.add_argument("--language", choices=["ru", "ro", "en"], default="ru")
    args = parser.parse_args(argv)
    try:
        if args.command == "audit":
            report, _, _ = audit_archives(args.archive)
            save_json(args.out, report)
            print(json.dumps({"report": str(args.out), "valid": report["ok"], "images": report["images"], "classes": report["classes"], "errors": len(report["errors"]), "structuralSplitPossible": report["structuralSplitPossible"]}, ensure_ascii=False))
            return 0 if report["ok"] else 2
        if args.command == "prepare":
            result = prepare(args.archive, args.out, args.seed, args.review_file)
            print(json.dumps({"datasetId": result["datasetId"], "purpose": result["purpose"], "prepared": str(args.out)}))
        elif args.command == "inspect":
            from .inspection import inspect_archives
            result = inspect_archives(args.archive, args.out, args.language)
            print(json.dumps(result, ensure_ascii=False))
            return 0 if result["auditOk"] else 2
        elif args.command == "train":
            from .training import train
            result = train(args.data, args.out, args.epochs, args.batch_size, args.learning_rate, args.seed, args.patience, args.device)
            print(json.dumps({"run": str(args.out), "purpose": result["purpose"], "status": result["status"], "bestEpoch": result["bestEpoch"], "pretrained": result["pretrained"]}))
        elif args.command == "evaluate":
            from .training import evaluate
            result = evaluate(args.data, args.run, args.device)
            print(json.dumps({"report": str(args.run / 'test-report.json'), "purpose": result["purpose"], "warning": result.get("warning"), "imageMetrics": result["imageMetrics"], "specimenMetrics": result["specimenMetrics"]}))
        elif args.command == "predict":
            from .training import predict
            print(json.dumps(predict(args.run, args.image, args.threshold), indent=2))
        elif args.command == "smoke":
            from .smoke import smoke
            print(json.dumps(smoke(args.out), indent=2))
        elif args.command == "report":
            from .reporting import render_report
            print(json.dumps(render_report(args.run, args.out, args.language), ensure_ascii=False))
        return 0
    except (DataError, OSError, KeyError, ValueError) as error:
        print(f"STOP: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
