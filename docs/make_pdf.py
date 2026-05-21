#!/usr/bin/env python3
"""
Convert docs/SIGNA.md → docs/SIGNA.pdf

Hand-rolled markdown → reportlab Platypus converter. Lightweight and
deterministic — we don't need full CommonMark, just the subset SIGNA.md
uses: H1/H2/H3, paragraphs, bold, inline `code`, ```code blocks```,
GitHub-style pipe tables, horizontal rules (---), bullet lists.

Output target: clean dev-readable PDF, monospace for code, no corporate
styling. Letter size, 1in margins.
"""

import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Preformatted,
    Table,
    TableStyle,
    PageBreak,
    HRFlowable,
    KeepTogether,
)


# ---------- paths ----------
HERE = Path(__file__).parent
MD_PATH = HERE / "SIGNA.md"
PDF_PATH = HERE / "SIGNA.pdf"


# ---------- styles ----------

# Dev-friendly palette: near-black on white, SIGNA accent for headings.
ACCENT = colors.HexColor("#5b8def")
DIM = colors.HexColor("#666666")
CODE_BG = colors.HexColor("#f4f4f6")
RULE = colors.HexColor("#dddde0")
TABLE_HEAD_BG = colors.HexColor("#f0f1f5")

SS = getSampleStyleSheet()

style_body = ParagraphStyle(
    "Body",
    parent=SS["BodyText"],
    fontName="Helvetica",
    fontSize=10.5,
    leading=15,
    spaceAfter=8,
    textColor=colors.HexColor("#1a1a1a"),
)

style_h1 = ParagraphStyle(
    "H1",
    parent=SS["Heading1"],
    fontName="Helvetica-Bold",
    fontSize=22,
    leading=28,
    spaceBefore=4,
    spaceAfter=12,
    textColor=colors.HexColor("#0a0a0a"),
)

style_h2 = ParagraphStyle(
    "H2",
    parent=SS["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=15,
    leading=20,
    spaceBefore=18,
    spaceAfter=8,
    textColor=ACCENT,
)

style_h3 = ParagraphStyle(
    "H3",
    parent=SS["Heading3"],
    fontName="Helvetica-Bold",
    fontSize=12,
    leading=16,
    spaceBefore=12,
    spaceAfter=4,
    textColor=colors.HexColor("#1a1a1a"),
)

style_meta = ParagraphStyle(
    "Meta",
    parent=SS["BodyText"],
    fontName="Helvetica-Oblique",
    fontSize=9,
    leading=12,
    textColor=DIM,
    spaceAfter=12,
)

style_code = ParagraphStyle(
    "Code",
    parent=SS["BodyText"],
    fontName="Courier",
    fontSize=8.5,
    leading=12,
    leftIndent=8,
    rightIndent=4,
    backColor=CODE_BG,
    textColor=colors.HexColor("#0a0a0a"),
    borderPadding=6,
    spaceBefore=4,
    spaceAfter=10,
)

style_bullet = ParagraphStyle(
    "Bullet",
    parent=style_body,
    leftIndent=18,
    bulletIndent=4,
    spaceAfter=4,
)


# ---------- markdown parsing ----------

INLINE_CODE_RE = re.compile(r"`([^`]+)`")
BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def inline_format(text: str) -> str:
    """Turn markdown inline syntax into reportlab Paragraph mini-language.

    - `code` → <font name="Courier" backColor="#f4f4f6">code</font>
    - **bold** → <b>bold</b>
    - [text](url) → <link href="url"><font color="#5b8def">text</font></link>
    """
    # escape XML reserved chars FIRST so user content can't break our markup
    text = (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    text = BOLD_RE.sub(r"<b>\1</b>", text)
    text = LINK_RE.sub(
        r'<link href="\2"><font color="#5b8def">\1</font></link>', text
    )
    # backtick code — apply LAST so its <font> markup isn't re-mangled
    text = INLINE_CODE_RE.sub(
        r'<font name="Courier" backColor="#f4f4f6" size="9">\1</font>', text
    )
    return text


def parse_table(lines, start_idx):
    """Parse a GitHub-style pipe table starting at start_idx.

    Returns (rows: list[list[str]], end_idx).
    Skips the separator row (|---|---|).
    """
    rows = []
    i = start_idx
    while i < len(lines) and lines[i].strip().startswith("|"):
        line = lines[i].strip()
        # split on pipes, strip whitespace, drop empty edges
        cells = [c.strip() for c in line.split("|")[1:-1]]
        # Skip separator row (|---|--- etc.)
        if all(re.match(r"^:?-+:?$", c) for c in cells):
            i += 1
            continue
        rows.append(cells)
        i += 1
    return rows, i


def render_table(rows, doc_width):
    """Render a markdown table to a reportlab Table.

    Auto-sizes column widths proportional to content length.
    """
    if not rows:
        return None

    # cell paragraphs (so inline formatting + wrapping work)
    cell_style = ParagraphStyle(
        "Cell",
        parent=style_body,
        fontSize=9,
        leading=11.5,
        spaceAfter=0,
        textColor=colors.HexColor("#1a1a1a"),
    )
    head_style = ParagraphStyle(
        "CellHead",
        parent=cell_style,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#0a0a0a"),
    )

    data = []
    for r_idx, row in enumerate(rows):
        rendered_row = []
        for cell in row:
            s = head_style if r_idx == 0 else cell_style
            rendered_row.append(Paragraph(inline_format(cell), s))
        data.append(rendered_row)

    # column widths proportional to MAX raw character length in the column
    n_cols = max(len(r) for r in rows)
    raw_lens = [0] * n_cols
    for row in rows:
        for ci, cell in enumerate(row):
            if ci < n_cols:
                raw_lens[ci] = max(raw_lens[ci], len(cell))
    total = sum(raw_lens) or n_cols
    col_widths = [doc_width * (l / total) for l in raw_lens]
    # enforce a sane minimum so very-narrow cols still readable
    min_w = doc_width / (n_cols * 2.5)
    col_widths = [max(min_w, w) for w in col_widths]
    # rescale to exactly fit
    scale = doc_width / sum(col_widths)
    col_widths = [w * scale for w in col_widths]

    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEAD_BG),
                ("LINEBELOW", (0, 0), (-1, 0), 0.75, RULE),
                ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return t


def parse_markdown(md_text):
    """Parse SIGNA.md-shaped markdown into a list of reportlab flowables."""
    lines = md_text.split("\n")
    flowables = []
    doc_width = letter[0] - 2 * inch  # 1-inch margins both sides

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # H1
        if stripped.startswith("# ") and not stripped.startswith("## "):
            flowables.append(Paragraph(inline_format(stripped[2:]), style_h1))
            i += 1
            continue

        # H2
        if stripped.startswith("## ") and not stripped.startswith("### "):
            flowables.append(Paragraph(inline_format(stripped[3:]), style_h2))
            i += 1
            continue

        # H3
        if stripped.startswith("### "):
            flowables.append(Paragraph(inline_format(stripped[4:]), style_h3))
            i += 1
            continue

        # Horizontal rule
        if stripped == "---":
            flowables.append(Spacer(1, 4))
            flowables.append(HRFlowable(width="100%", thickness=0.5, color=RULE))
            flowables.append(Spacer(1, 6))
            i += 1
            continue

        # Code fence
        if stripped.startswith("```"):
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing ```
            code = "\n".join(code_lines)
            # Preformatted preserves whitespace and wraps long lines
            flowables.append(
                Preformatted(code, style_code, dedent=0)
            )
            continue

        # Table (line starts with |)
        if stripped.startswith("|"):
            rows, end_idx = parse_table(lines, i)
            tbl = render_table(rows, doc_width)
            if tbl:
                flowables.append(Spacer(1, 4))
                flowables.append(tbl)
                flowables.append(Spacer(1, 6))
            i = end_idx
            continue

        # Bullet list
        if re.match(r"^[-*]\s+", stripped):
            list_items = []
            while i < len(lines) and re.match(r"^[-*]\s+", lines[i].strip()):
                item_text = re.sub(r"^[-*]\s+", "", lines[i].strip())
                list_items.append(
                    Paragraph(
                        "• " + inline_format(item_text),
                        style_bullet,
                    )
                )
                i += 1
            flowables.extend(list_items)
            flowables.append(Spacer(1, 4))
            continue

        # Numbered list (loose handling — just render as paragraphs with the number kept)
        if re.match(r"^\d+\.\s+", stripped):
            list_items = []
            while i < len(lines) and re.match(r"^\d+\.\s+", lines[i].strip()):
                item_text = lines[i].strip()
                list_items.append(
                    Paragraph(inline_format(item_text), style_bullet)
                )
                i += 1
            flowables.extend(list_items)
            flowables.append(Spacer(1, 4))
            continue

        # Blank line
        if not stripped:
            i += 1
            continue

        # Default — paragraph (gather contiguous non-blank lines)
        para_lines = [line]
        i += 1
        while i < len(lines):
            nxt = lines[i]
            nxt_stripped = nxt.strip()
            if (
                not nxt_stripped
                or nxt_stripped.startswith("#")
                or nxt_stripped.startswith("```")
                or nxt_stripped.startswith("|")
                or nxt_stripped == "---"
                or re.match(r"^[-*]\s+", nxt_stripped)
                or re.match(r"^\d+\.\s+", nxt_stripped)
            ):
                break
            para_lines.append(nxt)
            i += 1
        para = " ".join(l.strip() for l in para_lines).strip()
        if para:
            flowables.append(Paragraph(inline_format(para), style_body))

    return flowables


# ---------- page footer ----------

def draw_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(DIM)
    page_num = canvas.getPageNumber()
    footer = f"SIGNA · protocol docs · page {page_num}"
    canvas.drawString(inch, 0.5 * inch, footer)
    canvas.drawRightString(letter[0] - inch, 0.5 * inch, "signaagent.xyz")
    canvas.restoreState()


# ---------- main ----------

def sanitize_unicode_for_helvetica(text: str) -> str:
    """Replace unicode characters that reportlab's built-in Helvetica
    Type-1 font can't render (or that render as boxes / question marks)
    with ASCII equivalents. PDF stays clean and readable on any device.

    Em/en-dashes and smart quotes ARE in WinAnsi so we keep them.
    Symbols like check / cross / arrows are not, so we replace.
    """
    repl = {
        # NOT replacing em-dash / en-dash / smart quotes — those are
        # supported by Helvetica via the standard WinAnsi encoding.
        "→": "->",   # → right arrow
        "←": "<-",   # ← left arrow
        "↑": "^",    # ↑
        "↓": "v",    # ↓
        "↩": "(return)",  # ↩
        "✔": "[ok]", # ✔
        "✓": "[ok]", # ✓
        "✘": "[x]",  # ✘
        "✗": "[x]",  # ✗
        "✅": "[ok]", # ✅
        "❌": "[x]",  # ❌
        "⚠": "[!]",  # ⚠
        "⭐": "*",    # ⭐
        "★": "*",    # ★
        "☆": "*",    # ☆
        "·": "-",    # · middle dot (kept for visual rhythm)
        "•": "-",    # • bullet (we render our own with "- ")
        "●": "o",    # ●
        "○": "o",    # ○
        "─": "-",    # ─ box drawings
        "━": "-",
        "┃": "|",    # ┃
        "█": "#",    # █
        "▄": "#",
        "▀": "#",
        "░": ".",    # ░
        "▒": ":",    # ▒
        "▓": "#",    # ▓
        "—": "--",   # em-dash — kept supported but normalize to -- for code blocks
        # smart quotes kept (Helvetica handles them)
    }
    for k, v in repl.items():
        text = text.replace(k, v)
    return text


def main():
    md_text = MD_PATH.read_text(encoding="utf-8")
    md_text = sanitize_unicode_for_helvetica(md_text)
    flowables = parse_markdown(md_text)

    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=letter,
        leftMargin=inch,
        rightMargin=inch,
        topMargin=0.85 * inch,
        bottomMargin=0.85 * inch,
        title="SIGNA — Protocol Docs",
        author="SIGNA",
        subject="Wallet-native, agent-native, federable messaging + agent OS on Base",
    )
    doc.build(
        flowables,
        onFirstPage=draw_footer,
        onLaterPages=draw_footer,
    )
    size = PDF_PATH.stat().st_size
    print(f"[ok] wrote {PDF_PATH} ({size:,} bytes)")


if __name__ == "__main__":
    main()
