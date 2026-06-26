#!/usr/bin/env python3
"""Append Marukyu stock-check JSON to a simple XLSX log."""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
from pathlib import Path
import zipfile


HEADERS = ["checked_at", "display_name", "name", "size", "price", "status", "source_url"]
DEFAULT_PRODUCTS = {"Yugen", "Isuzu", "Aoarashi"}


def rows_from_payload(payload: dict, names: set[str]) -> list[dict[str, str]]:
    checked_at = payload.get("checkedAt") or payload.get("checked_at") or dt.datetime.now(dt.timezone.utc).isoformat()
    rows: list[dict[str, str]] = []
    for item in payload.get("compact", []):
        if names and item.get("name") not in names:
            continue
        variants = []
        variants += [(v, "available") for v in item.get("availableVariants", [])]
        variants += [(v, "out_of_stock") for v in item.get("outOfStockVariants", [])]
        variants += [(v, "unknown") for v in item.get("unknownVariants", [])]
        for variant, status in variants:
            parts = str(variant).rsplit(" ", 1)
            size, price = (parts[0], parts[1]) if len(parts) == 2 else (str(variant), "")
            rows.append({
                "checked_at": checked_at,
                "display_name": item.get("displayName") or item.get("name") or "",
                "name": item.get("name") or "",
                "size": size,
                "price": price,
                "status": status,
                "source_url": item.get("url") or payload.get("sourceUrl") or "",
            })
    return rows


def read_json(path: str | None) -> dict:
    text = Path(path).read_text(encoding="utf-8") if path else __import__("sys").stdin.read()
    return json.loads(text)


def append_jsonl(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def read_jsonl(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def col_name(index: int) -> str:
    name = ""
    while index:
        index, rem = divmod(index - 1, 26)
        name = chr(65 + rem) + name
    return name


def cell(ref: str, value: str, style: int | None = None) -> str:
    value = html.escape(str(value), quote=False)
    s = f' s="{style}"' if style is not None else ""
    return f'<c r="{ref}" t="inlineStr"{s}><is><t>{value}</t></is></c>'


def sheet_xml(rows: list[dict[str, str]]) -> str:
    all_rows = [dict(zip(HEADERS, HEADERS))] + rows
    row_xml = []
    for r, row in enumerate(all_rows, start=1):
        cells = []
        for c, header in enumerate(HEADERS, start=1):
            style = 1 if r == 1 else None
            cells.append(cell(f"{col_name(c)}{r}", row.get(header, ""), style))
        row_xml.append(f'<row r="{r}">{"".join(cells)}</row>')
    dim = f"A1:{col_name(len(HEADERS))}{len(all_rows)}"
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="{dim}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="3" width="18" customWidth="1"/><col min="4" max="7" width="22" customWidth="1"/></cols>
  <sheetData>{''.join(row_xml)}</sheetData>
  <autoFilter ref="{dim}"/>
</worksheet>'''


def write_xlsx(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    files = {
        "[Content_Types].xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>''',
        "_rels/.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>''',
        "xl/_rels/workbook.xml.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>''',
        "xl/workbook.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Stock Log" sheetId="1" r:id="rId1"/></sheets>
</workbook>''',
        "xl/styles.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font/><font><b/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs>
</styleSheet>''',
        "xl/worksheets/sheet1.xml": sheet_xml(rows),
    }
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", help="Stock-check JSON file. Defaults to stdin.")
    parser.add_argument("--jsonl", default="outputs/marukyu-stock/stock-log.jsonl")
    parser.add_argument("--xlsx", default="outputs/marukyu-stock/marukyu-stock-log.xlsx")
    parser.add_argument("--products", default="Yugen,Isuzu,Aoarashi")
    args = parser.parse_args()

    names = {name.strip() for name in args.products.split(",") if name.strip()}
    rows = rows_from_payload(read_json(args.input), names)
    append_jsonl(Path(args.jsonl), rows)
    all_rows = read_jsonl(Path(args.jsonl))
    write_xlsx(Path(args.xlsx), all_rows)
    print(f"appended {len(rows)} rows; workbook rows: {len(all_rows)}; xlsx: {args.xlsx}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
