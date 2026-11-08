#!/usr/bin/env python3
"""Export the existing Excel catalogue and optimized photos without modifying sources."""
import argparse
import hashlib
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile

from PIL import Image, ImageOps

SITE = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = Path("outputs/01a1bbcd-8dff-7bc3-92f3-60a1d71522b8/Коллекция Lay’s.xlsx")
NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
INITIAL_PUBLISHED_AT = "2026-11-08T18:06:56+00:00"


def normalized(text):
    return unicodedata.normalize("NFC", text)


def read_records(path):
    with ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {r.attrib["Id"]: r.attrib["Target"] for r in rels}
        sheet = next(s for s in workbook.findall("x:sheets/x:sheet", NS) if s.attrib["name"] == "Коллекция")
        target = targets[sheet.attrib[f"{{{REL}}}id"]]
        sheet_path = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
        root = ET.fromstring(archive.read(sheet_path))
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(s.itertext()) for s in ET.fromstring(archive.read("xl/sharedStrings.xml"))]

        def value(cell):
            if cell.attrib.get("t") == "inlineStr":
                return "".join(t.text or "" for t in cell.findall(".//x:t", NS))
            text = cell.findtext("x:v", default="", namespaces=NS)
            return strings[int(text)] if cell.attrib.get("t") == "s" else text

        records = []
        for row in root.findall("x:sheetData/x:row", NS):
            cells = {re.sub(r"\d", "", cell.attrib["r"]): value(cell) for cell in row.findall("x:c", NS)}
            if not cells.get("A", "").isdigit() or not cells.get("G"):
                continue
            for col in ("B", "C", "D", "E"):
                if not cells.get(col):
                    raise ValueError(f"Missing {col} at Excel row {row.attrib['r']}")
            records.append(cells)
        if not records:
            raise ValueError("No collection records found; refusing to replace catalogue")
        return records


def export_images(job):
    source, thumbnail, full = job
    if all(target.exists() and target.stat().st_mtime >= source.stat().st_mtime for target in (thumbnail, full)):
        return
    # The EXIF orientation is applied and all camera metadata is omitted from web copies.
    with Image.open(source) as original:
        oriented = ImageOps.exif_transpose(original).convert("RGB")
        for target, size, quality in ((thumbnail, 540, 78), (full, 1800, 86)):
            if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
                continue
            copy = oriented.copy()
            copy.thumbnail((size, size), Image.Resampling.LANCZOS)
            temporary = target.with_suffix(".tmp")
            copy.save(temporary, format="WEBP", quality=quality, method=4)
            temporary.replace(target)


def build(source_root, catalog):
    output = SITE / "public/catalog.json"
    previous = json.loads(output.read_text(encoding="utf-8")) if output.exists() else {"items": []}
    added_dates = {item["id"]: item.get("addedAt") or INITIAL_PUBLISHED_AT for item in previous["items"]}
    exported_at = datetime.now(timezone.utc).isoformat()
    photo_root = source_root / "Фото"
    by_name = {}
    for photo in photo_root.rglob("*"):
        if photo.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
            key = normalized(photo.name)
            if key in by_name:
                raise ValueError(f"Ambiguous photo filename: {key}")
            by_name[key] = photo

    records = read_records(catalog)
    items, jobs, seen = [], [], set()
    thumb_dir = SITE / "public/images/thumbs"
    full_dir = SITE / "public/images/full"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    full_dir.mkdir(parents=True, exist_ok=True)
    for row in records:
        filename = normalized(row["G"])
        source = by_name.get(filename)
        if not source:
            raise ValueError(f"Photo missing: {filename}")
        identifier = hashlib.sha256(filename.encode("utf-8")).hexdigest()[:16]
        if identifier in seen:
            raise ValueError(f"Duplicate catalogue photo: {filename}")
        seen.add(identifier)
        items.append({
            "id": identifier,
            "number": int(row["A"]),
            "country": normalized(row["B"]),
            "type": normalized(row["C"]),
            "flavor": normalized(row["D"]),
            "variant": int(row["E"]),
            "addedAt": added_dates.get(identifier, exported_at),
            "thumbnail": f"images/thumbs/{identifier}.webp",
            "image": f"images/full/{identifier}.webp",
        })
        jobs.append((source, thumb_dir / f"{identifier}.webp", full_dir / f"{identifier}.webp"))

    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(export_images, jobs))
    latest = max([catalog.stat().st_mtime] + [job[0].stat().st_mtime for job in jobs])
    data = {
        "updatedAt": datetime.fromtimestamp(latest, timezone.utc).isoformat(),
        "total": len(items),
        "countries": dict(sorted(Counter(i["country"] for i in items).items())),
        "types": dict(sorted(Counter(i["type"] for i in items).items())),
        "items": items,
    }
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(output)
    # Only remove obsolete files produced by this exporter, after successful generation.
    for folder in (thumb_dir, full_dir):
        for old in folder.glob("*.webp"):
            if re.fullmatch(r"[0-9a-f]{16}", old.stem) and old.stem not in seen:
                old.unlink()
    total_size = sum(p.stat().st_size for folder in (thumb_dir, full_dir) for p in folder.glob("*.webp"))
    print(f"Ready: {len(items)} packages, {len(data['countries'])} countries, {len(data['types'])} types; web photos {total_size / 1024**2:.1f} MiB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=SITE.parent, help="Collection folder containing Фото and outputs")
    parser.add_argument("--catalog", type=Path, help="Explicit path to the active Excel catalogue")
    args = parser.parse_args()
    root = args.source_root.resolve()
    build(root, args.catalog.resolve() if args.catalog else root / DEFAULT_CATALOG)

