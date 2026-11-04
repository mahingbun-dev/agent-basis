# -*- coding: utf-8 -*-
import os, sys, json, re
from docx import Document
from docx.shared import Pt, Cm, Mm, RGBColor, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_TAB_ALIGNMENT, WD_TAB_LEADER, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL, WD_ROW_HEIGHT_RULE
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_COLOR_INDEX

# ---------- palette ----------
INK = "1F2933"
GOLD = "B08D57"
GOLD_LIGHT = "D9C7A7"
BURGUNDY = "7A2E3A"
WARM = "F7F2EA"
WARM2 = "EFE6D8"
GREY = "6B7280"
GREY_LIGHT = "9CA3AF"
LINE = "D9D2C7"
WHITE = "FFFFFF"
RED = "A33A3A"

BODY_FONT = "宋体"
HEAD_FONT = "黑体"
LATIN_FONT = "Arial"

# ---------- low-level helpers ----------

def rgb(hexstr):
    return RGBColor.from_string(hexstr)

def set_run_font(run, name=BODY_FONT, size=10.5, bold=False, color=INK, italic=False, latin=LATIN_FONT):
    run.font.name = latin
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = rgb(color)
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rPr.append(rFonts)
    rFonts.set(qn('w:ascii'), latin)
    rFonts.set(qn('w:hAnsi'), latin)
    rFonts.set(qn('w:eastAsia'), name)
    rFonts.set(qn('w:cs'), latin)

def set_char_spacing(run, twips=20):
    rPr = run._element.get_or_add_rPr()
    sp = OxmlElement('w:spacing')
    sp.set(qn('w:val'), str(twips))
    rPr.append(sp)

def set_para(p, before=0, after=6, line=1.5, align=None, keep=False, keep_lines=False):
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    if align is not None:
        p.alignment = align
    if keep:
        pf.keep_with_next = True
    if keep_lines:
        pf.keep_together = True
    return p

def add_text(p, text, name=BODY_FONT, size=10.5, bold=False, color=INK, italic=False, latin=LATIN_FONT):
    r = p.add_run(text)
    set_run_font(r, name=name, size=size, bold=bold, color=color, italic=italic, latin=latin)
    return r

def add_bottom_border(p, color=GOLD, sz=8, space=4):
    pPr = p._p.get_or_add_pPr()
    pBdr = pPr.find(qn('w:pBdr'))
    if pBdr is None:
        pBdr = OxmlElement('w:pBdr')
        pPr.append(pBdr)
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), str(sz))
    bottom.set(qn('w:space'), str(space))
    bottom.set(qn('w:color'), color)
    pBdr.append(bottom)

def add_left_border(p, color=GOLD, sz=18, space=8):
    pPr = p._p.get_or_add_pPr()
    pBdr = pPr.find(qn('w:pBdr'))
    if pBdr is None:
        pBdr = OxmlElement('w:pBdr')
        pPr.append(pBdr)
    left = OxmlElement('w:left')
    left.set(qn('w:val'), 'single')
    left.set(qn('w:sz'), str(sz))
    left.set(qn('w:space'), str(space))
    left.set(qn('w:color'), color)
    pBdr.append(left)

def shade_cell(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = tcPr.find(qn('w:shd'))
    if shd is None:
        shd = OxmlElement('w:shd')
        tcPr.append(shd)
    shd.set(qn('w:fill'), fill)
    shd.set(qn('w:val'), 'clear')

def set_cell_margins(cell, top=50, left=80, bottom=50, right=80):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = tcPr.find(qn('w:tcMar'))
    if tcMar is None:
        tcMar = OxmlElement('w:tcMar')
        tcPr.append(tcMar)
    for side, val in (('top', top), ('left', left), ('bottom', bottom), ('right', right)):
        el = tcMar.find(qn(f'w:{side}'))
        if el is None:
            el = OxmlElement(f'w:{side}')
            tcMar.append(el)
        el.set(qn('w:w'), str(val))
        el.set(qn('w:type'), 'dxa')

def set_cell_text(cell, text, size=8.5, bold=False, color=INK, align=WD_ALIGN_PARAGRAPH.LEFT, font=BODY_FONT, italic=False, line=1.05):
    cell.text = ''
    p = cell.paragraphs[0]
    p.alignment = align
    pf = p.paragraph_format
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)
    pf.line_spacing = line
    add_text(p, text, name=font, size=size, bold=bold, color=color, italic=italic)

def set_table_borders(table, color=LINE, sz=4, inside=True):
    tblPr = table._tbl.tblPr
    borders = tblPr.find(qn('w:tblBorders'))
    if borders is None:
        borders = OxmlElement('w:tblBorders')
        tblPr.append(borders)
    edges = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    for edge in edges:
        el = OxmlElement(f'w:{edge}')
        if edge.startswith('inside') and not inside:
            el.set(qn('w:val'), 'nil')
        else:
            el.set(qn('w:val'), 'single')
            el.set(qn('w:sz'), str(sz))
            el.set(qn('w:space'), '0')
            el.set(qn('w:color'), color)
        borders.append(el)

def set_table_no_borders(table):
    tblPr = table._tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for edge in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']:
        el = OxmlElement(f'w:{edge}')
        el.set(qn('w:val'), 'nil')
        borders.append(el)
    tblPr.append(borders)

def set_table_width(table, widths_cm):
    table.autofit = False
    table.allow_autofit = False
    tblPr = table._tbl.tblPr
    tblW = tblPr.find(qn('w:tblW'))
    if tblW is None:
        tblW = OxmlElement('w:tblW')
        tblPr.append(tblW)
    tblW.set(qn('w:type'), 'dxa')
    tblW.set(qn('w:w'), str(int(sum(widths_cm) * 567)))
    tblLayout = OxmlElement('w:tblLayout')
    tblLayout.set(qn('w:type'), 'fixed')
    tblPr.append(tblLayout)
    for i, w in enumerate(widths_cm):
        table.columns[i].width = Cm(w)
        for cell in table.columns[i].cells:
            cell.width = Cm(w)

def repeat_header(row):
    trPr = row._tr.get_or_add_trPr()
    tblHeader = OxmlElement('w:tblHeader')
    tblHeader.set(qn('w:val'), 'true')
    trPr.append(tblHeader)

def cant_split(row):
    trPr = row._tr.get_or_add_trPr()
    cant = OxmlElement('w:cantSplit')
    cant.set(qn('w:val'), 'true')
    trPr.append(cant)

def set_row_height(row, cm=0.6):
    row.height = Cm(cm)
    row.height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST

def add_page_field(p, color=GREY_LIGHT, size=8):
    r = p.add_run()
    fld1 = OxmlElement('w:fldChar'); fld1.set(qn('w:fldCharType'), 'begin')
    instr = OxmlElement('w:instrText'); instr.set(qn('xml:space'), 'preserve'); instr.text = ' PAGE '
    fld2 = OxmlElement('w:fldChar'); fld2.set(qn('w:fldCharType'), 'separate')
    txt = OxmlElement('w:t'); txt.text = '1'
    fld3 = OxmlElement('w:fldChar'); fld3.set(qn('w:fldCharType'), 'end')
    r._r.append(fld1); r._r.append(instr); r._r.append(fld2); r._r.append(txt); r._r.append(fld3)
    set_run_font(r, size=size, color=color)

def set_page_numbering(section, fmt='decimal', start=1):
    sectPr = section._sectPr
    pgNumType = sectPr.find(qn('w:pgNumType'))
    if pgNumType is None:
        pgNumType = OxmlElement('w:pgNumType')
        sectPr.append(pgNumType)
    pgNumType.set(qn('w:fmt'), fmt)
    pgNumType.set(qn('w:start'), str(start))

def add_page_border(section, color=GOLD, sz=4, space=24):
    sectPr = section._sectPr
    pgBorders = OxmlElement('w:pgBorders')
    pgBorders.set(qn('w:offsetFrom'), 'page')
    for edge in ['top', 'left', 'bottom', 'right']:
        el = OxmlElement(f'w:{edge}')
        el.set(qn('w:val'), 'single')
        el.set(qn('w:sz'), str(sz))
        el.set(qn('w:space'), str(space))
        el.set(qn('w:color'), color)
        pgBorders.append(el)
    sectPr.append(pgBorders)

def clear_paragraph(p):
    for r in list(p.runs):
        r._r.getparent().remove(r._r)
    p.text = ''

# ---------- document structure helpers ----------

def set_section_a4(section, top=2.2, bottom=2.2, left=2.4, right=2.4):
    section.page_width = Mm(210)
    section.page_height = Mm(297)
    section.top_margin = Cm(top)
    section.bottom_margin = Cm(bottom)
    section.left_margin = Cm(left)
    section.right_margin = Cm(right)
    section.header_distance = Cm(1.1)
    section.footer_distance = Cm(1.1)

def setup_header_footer(section, roman=False, cover=False):
    section.header.is_linked_to_previous = False
    section.footer.is_linked_to_previous = False
    # header
    hp = section.header.paragraphs[0]
    clear_paragraph(hp)
    hp.paragraph_format.tab_stops.clear_all()
    hp.paragraph_format.tab_stops.add_tab_stop(Cm(16.2), WD_TAB_ALIGNMENT.RIGHT)
    hp.paragraph_format.space_before = Pt(0)
    hp.paragraph_format.space_after = Pt(2)
    if not cover:
        add_text(hp, '婚礼策划案  /  2026.11.22', size=7.2, color=GREY_LIGHT, latin=LATIN_FONT)
        add_text(hp, '\tPRIVATE & CONFIDENTIAL', size=7.2, color=GREY_LIGHT, latin=LATIN_FONT)
        add_bottom_border(hp, color=LINE, sz=4, space=2)
    # footer
    fp = section.footer.paragraphs[0]
    clear_paragraph(fp)
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fp.paragraph_format.space_before = Pt(0)
    fp.paragraph_format.space_after = Pt(0)
    if not cover:
        add_text(fp, '—  ', size=8, color=GREY_LIGHT)
        add_page_field(fp)
        add_text(fp, '  —', size=8, color=GREY_LIGHT)

def add_chapter(doc, num, title, en, deck=None, first=False):
    if not first:
        p = doc.add_paragraph()
        p.paragraph_format.page_break_before = True
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
    # label
    p = doc.add_paragraph()
    set_para(p, before=0, after=2, line=1.0, keep=True)
    label = 'APPENDIX' if num == 'APPENDIX' else f'CHAPTER {num}'
    add_text(p, label, name=HEAD_FONT, size=8, bold=True, color=GOLD, latin=LATIN_FONT)
    add_text(p, f'   /   {en}', name=HEAD_FONT, size=8, bold=False, color=GREY_LIGHT, latin=LATIN_FONT)
    set_char_spacing(p.runs[0], 50)
    # title
    p = doc.add_paragraph()
    set_para(p, before=0, after=4, line=1.0, keep=True)
    add_text(p, title, name=HEAD_FONT, size=24, bold=True, color=INK)
    # deck
    if deck:
        p = doc.add_paragraph()
        set_para(p, before=2, after=10, line=1.45, keep=True)
        add_text(p, deck, name=BODY_FONT, size=10.5, color=GREY)
    # rule
    p = doc.add_paragraph()
    set_para(p, before=0, after=10, line=1.0)
    add_bottom_border(p, color=GOLD, sz=8, space=1)

def add_h2(doc, num, title, keep=True):
    p = doc.add_paragraph()
    set_para(p, before=12, after=5, line=1.15, keep=keep)
    p.paragraph_format.left_indent = Cm(0.18)
    add_left_border(p, color=GOLD, sz=18, space=7)
    add_text(p, f'{num}', name=HEAD_FONT, size=9, bold=True, color=GOLD, latin=LATIN_FONT)
    add_text(p, f'  {title}', name=HEAD_FONT, size=13.5, bold=True, color=BURGUNDY)
    return p

def add_h3(doc, title, keep=True):
    p = doc.add_paragraph()
    set_para(p, before=8, after=3, line=1.15, keep=keep)
    add_text(p, title, name=HEAD_FONT, size=10.8, bold=True, color=INK)
    return p

def body(doc, text, after=6, size=10.5, color=INK, indent=True, line=1.55):
    p = doc.add_paragraph()
    set_para(p, before=0, after=after, line=line)
    if indent:
        p.paragraph_format.first_line_indent = Cm(0.74)
    add_text(p, text, size=size, color=color)
    return p

def bullet(doc, text, size=10.2, color=INK, marker='·', indent=0.55, after=2):
    p = doc.add_paragraph()
    set_para(p, before=0, after=after, line=1.45)
    p.paragraph_format.left_indent = Cm(indent)
    p.paragraph_format.first_line_indent = Cm(-0.45)
    add_text(p, f'{marker}  ', size=size, color=GOLD, bold=True)
    add_text(p, text, size=size, color=color)
    return p

def numbered(doc, num, title, text, size=10.2):
    p = doc.add_paragraph()
    set_para(p, before=2, after=4, line=1.5)
    p.paragraph_format.left_indent = Cm(0.9)
    p.paragraph_format.first_line_indent = Cm(-0.9)
    add_text(p, f'{num}', name=HEAD_FONT, size=9, bold=True, color=GOLD, latin=LATIN_FONT)
    add_text(p, '  ', size=9)
    add_text(p, title, name=HEAD_FONT, size=10.2, bold=True, color=INK)
    add_text(p, '  ' + text, size=size, color=INK)
    return p

def caption(doc, text, after=4):
    p = doc.add_paragraph()
    set_para(p, before=2, after=after, line=1.1, keep=True)
    add_text(p, text, size=8.2, color=GREY_LIGHT)
    return p

def source_note(doc, text):
    p = doc.add_paragraph()
    set_para(p, before=2, after=8, line=1.2)
    add_text(p, text, size=7.8, color=GREY_LIGHT)
    return p

def callout(doc, title, lines, fill=WARM, border_color=GOLD, title_color=BURGUNDY, width=16.2, size=9.4):
    t = doc.add_table(rows=1, cols=1)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_width(t, [width])
    set_table_no_borders(t)
    cell = t.cell(0,0)
    shade_cell(cell, fill)
    set_cell_margins(cell, top=120, left=180, bottom=120, right=180)
    # left border on cell
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = OxmlElement('w:tcBorders')
    left = OxmlElement('w:left')
    left.set(qn('w:val'), 'single'); left.set(qn('w:sz'), '18'); left.set(qn('w:space'), '0'); left.set(qn('w:color'), border_color)
    tcBorders.append(left)
    tcPr.append(tcBorders)
    cell.text = ''
    p = cell.paragraphs[0]
    set_para(p, before=0, after=3, line=1.1)
    add_text(p, title, name=HEAD_FONT, size=9.6, bold=True, color=title_color)
    for line in lines:
        p = cell.add_paragraph()
        set_para(p, before=0, after=1, line=1.4)
        add_text(p, line, size=size, color=INK)
    # spacing after table
    sp = doc.add_paragraph()
    set_para(sp, before=0, after=2, line=1.0)

def make_table(doc, headers, rows, widths, header_fill=BURGUNDY, font_size=8.5, header_size=8.4,
               first_col_bold=False, row_fills=None, aligns=None, header_align=WD_ALIGN_PARAGRAPH.LEFT,
               repeat=True, row_height=None, category_rows=None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_width(table, widths)
    set_table_borders(table, color=LINE, sz=4)
    hdr = table.rows[0]
    if repeat:
        repeat_header(hdr)
    cant_split(hdr)
    for i, h in enumerate(headers):
        c = hdr.cells[i]
        shade_cell(c, header_fill)
        set_cell_margins(c, top=70, left=80, bottom=70, right=80)
        c.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        set_cell_text(c, h, size=header_size, bold=True, color=WHITE, align=header_align)
    for ridx, row in enumerate(rows):
        tr = table.add_row()
        if row_height:
            set_row_height(tr, row_height)
        cant_split(tr)
        fill = None
        if row_fills and ridx < len(row_fills):
            fill = row_fills[ridx]
        if category_rows and ridx in category_rows:
            fill = WARM2
        for i, val in enumerate(row):
            c = tr.cells[i]
            if fill:
                shade_cell(c, fill)
            set_cell_margins(c, top=45, left=80, bottom=45, right=80)
            c.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            al = WD_ALIGN_PARAGRAPH.LEFT
            if aligns and i < len(aligns):
                al = aligns[i]
            set_cell_text(c, str(val), size=font_size, bold=(first_col_bold and i==0), align=al)
    return table

# ---------- content data ----------
BUDGET = [
    ("A", "婚宴餐饮", 108000, "10桌正席+1桌机动；含服务费与儿童餐/茶歇"),
    ("B", "场地布置", 40000, "舞台、迎宾、桌花、灯光补充、人工"),
    ("C", "婚纱礼服与造型", 16000, "主纱、敬酒服、西装、妆造、伴娘服"),
    ("D", "摄影摄像", 18000, "摄影双机位、摄像双机位、快剪"),
    ("E", "主持与仪式执行", 12000, "主持、督导、音响师、仪式道具"),
    ("F", "婚戒与配饰", 18000, "对戒、头饰、袖扣、刻字保养"),
    ("G", "酒水饮料", 13000, "白酒、红酒、软饮、香槟、开瓶服务"),
    ("H", "喜糖与伴手礼", 12000, "100份喜糖+伴手礼+包装"),
    ("I", "请柬与纸品", 3000, "请柬、桌卡、签到本、誓言卡"),
    ("J", "婚车与交通", 9000, "主婚车、6辆跟车、大巴、停车"),
    ("K", "人员餐宿与红包", 12000, "工作人员餐、住宿、红包、临时用车"),
    ("L", "策划统筹", 15000, "全程策划、执行团队、视觉文件"),
    ("M", "备用金", 24000, "价格浮动、临时增项、应急支出"),
]

BUDGET_DETAIL = {
"A": [
    ("A1", "主宴席", "10人/桌，含冷菜、热菜、汤、主食、甜品", "10桌", "8,800", 88000),
    ("A2", "备用席", "第11桌，按实际开桌计费", "1桌", "8,800", 8800),
    ("A3", "宴会服务费", "按宴席金额10%计", "1式", "9,680", 9680),
    ("A4", "儿童餐/茶歇/蛋糕", "2份儿童餐、仪式蛋糕、签到茶歇", "1式", "1,520", 1520),
],
"B": [
    ("B1", "主舞台背景与花艺", "背景板、地台、主桌花、舞台花", "1式", "16,000", 16000),
    ("B2", "迎宾/签到区", "迎宾牌、签到台、合影区", "1式", "6,000", 6000),
    ("B3", "桌花/路引/手捧", "10桌桌花、通道路引、手捧花2束", "1式", "6,000", 6000),
    ("B4", "灯光补充/音响", "面光、染色灯、备用音箱", "1式", "5,000", 5000),
    ("B5", "指示牌/席位图", "水牌、楼层指引、席位图", "1式", "2,000", 2000),
    ("B6", "人工/运输/撤场", "搭建、拆卸、运输、夜间加班", "1式", "5,000", 5000),
],
"C": [
    ("C1", "新娘主纱", "租赁，含头纱", "1件", "5,000", 5000),
    ("C2", "出门纱/敬酒服", "租赁或轻定制", "1套", "3,000", 3000),
    ("C3", "新郎西装", "定制或租赁，含衬衫/皮鞋", "1套", "3,500", 3500),
    ("C4", "新娘妆造", "含试妆、妈妈妆、伴娘妆", "1式", "3,000", 3000),
    ("C5", "伴娘服/伴郎配饰", "伴娘服4套、领结/口袋巾", "1式", "1,500", 1500),
],
"D": [
    ("D1", "摄影双机位", "10小时，含精修80张", "1式", "8,000", 8000),
    ("D2", "摄像双机位", "10小时，含3-5分钟成片", "1式", "7,000", 7000),
    ("D3", "当日快剪", "仪式后2小时内交付", "1条", "2,000", 2000),
    ("D4", "交通/餐补", "摄影摄像团队餐食与交通", "1式", "1,000", 1000),
],
"E": [
    ("E1", "主持人", "含婚前沟通、彩排、现场主持", "1位", "6,000", 6000),
    ("E2", "仪式督导/执行", "流程控场、人员调度、Cue Sheet", "1式", "3,000", 3000),
    ("E3", "音响师/音乐执行", "调音、播放、备用音源", "1位", "2,000", 2000),
    ("E4", "仪式道具", "戒枕、誓言本、敬茶杯、跪垫", "1式", "1,000", 1000),
],
"F": [
    ("F1", "对戒", "18K金/铂金，按实际金价", "1对", "13,000", 13000),
    ("F2", "新娘头饰/耳饰", "主仪式+敬酒两套", "1套", "2,500", 2500),
    ("F3", "新郎袖扣/领结", "含领带/领结、口袋巾", "1套", "1,000", 1000),
    ("F4", "刻字/保养/保险", "刻字、清洗、戒指保险", "1式", "1,500", 1500),
],
"G": [
    ("G1", "白酒", "按6瓶备，未开瓶可退", "6瓶", "900", 5400),
    ("G2", "红酒", "每桌1瓶，备用2瓶", "12瓶", "130", 1560),
    ("G3", "啤酒/软饮", "可乐、雪碧、果汁、苏打水", "1式", "1,800", 1800),
    ("G4", "香槟/仪式酒", "仪式香槟塔或举杯用", "1式", "1,000", 1000),
    ("G5", "开瓶/冰块/杯具", "酒店或酒水商收取", "1式", "1,200", 1200),
    ("G6", "机动", "价格浮动/临时补货", "1式", "2,040", 2040),
],
"H": [
    ("H1", "喜糖", "100份，含糖盒", "100份", "30", 3000),
    ("H2", "伴手礼", "100份，实用型小物", "100份", "60", 6000),
    ("H3", "定制包装/手提袋", "统一视觉，含卡片", "100个", "15", 1500),
    ("H4", "备用/补送", "临时来客、工作人员", "1式", "1,500", 1500),
],
"I": [
    ("I1", "请柬", "含信封、烫金/印刷", "120份", "15", 1800),
    ("I2", "桌卡/席位卡", "10桌+1机动桌", "10桌", "60", 600),
    ("I3", "签到本/笔/誓言卡/红包袋", "签到本2本、笔10支、誓言卡2张", "1式", "600", 600),
],
"J": [
    ("J1", "主婚车装饰", "车头花、车门花、手捧", "1式", "1,200", 1200),
    ("J2", "跟车", "6辆，含司机", "6辆", "600", 3600),
    ("J3", "亲友大巴/接送", "外地亲属/无车宾客", "1式", "2,000", 2000),
    ("J4", "停车/司机红包", "6位司机，含停车费", "6人", "200", 1200),
    ("J5", "机动", "临时用车/路线调整", "1式", "1,000", 1000),
],
"K": [
    ("K1", "工作人员餐", "搭建/撤场/执行人员", "20份", "50", 1000),
    ("K2", "供应商餐", "摄影/摄像/主持/化妆", "8份", "80", 640),
    ("K3", "外地亲属住宿", "标间，含早", "4间", "500", 2000),
    ("K4", "接亲房/化妆房", "含布置与延时", "1间", "1,500", 1500),
    ("K5", "伴郎伴娘/司机/帮忙红包", "按人头，统一标准", "1式", "3,000", 3000),
    ("K6", "儿童/互动红包", "堵门、游戏、儿童", "1式", "400", 400),
    ("K7", "临时用车", "补位/接送/应急", "1式", "1,000", 1000),
    ("K8", "机动", "临时餐食/交通", "1式", "2,460", 2460),
],
"L": [
    ("L1", "全程策划统筹", "从签约到婚礼当日", "1式", "8,000", 8000),
    ("L2", "执行团队", "4人，含督导/场控/物资", "4人", "5,000", 5000),
    ("L3", "流程设计/视觉文件", "流程表、座位图、设计稿", "1式", "2,000", 2000),
],
"M": [
    ("M1", "价格浮动准备", "金价/花材/人工上涨", "1式", "12,000", 12000),
    ("M2", "临时增项", "加座、补货、延时", "1式", "7,000", 7000),
    ("M3", "应急支出", "医疗、交通、设备", "1式", "5,000", 5000),
],
}

TOC_ITEMS = [
    (1, "01", "当日流程", "当日流程"),
    (2, "1.1", "流程设计原则", "1.1 流程设计原则"),
    (2, "1.3", "当日总览", "1.3 当日总览"),
    (2, "1.4", "晨起与接亲", "1.4 晨起与接亲"),
    (2, "1.5", "迎宾、仪式与宴会", "1.5 迎宾、仪式与宴会"),
    (2, "1.6", "仪式执行 Cue Sheet", "1.6 仪式执行"),
    (2, "1.8", "时间控制与硬节点", "1.8 时间控制"),
    (1, "02", "分项预算", "分项预算"),
    (2, "2.1", "预算总盘", "2.1 预算总盘"),
    (2, "2.3", "分项明细", "2.3 分项明细"),
    (2, "2.4", "付款节点", "2.4 付款节点"),
    (2, "2.5", "预算控制", "2.5 预算控制"),
    (2, "2.6", "取舍清单", "2.6 取舍清单"),
    (1, "03", "分工表", "分工表"),
    (2, "3.1", "组织架构", "3.1 组织架构"),
    (2, "3.2", "岗位职责", "3.2 岗位职责"),
    (2, "3.5", "18 天倒排", "3.5 18 天倒排"),
    (2, "3.6", "供应商管理", "3.6 供应商管理"),
    (2, "3.7", "谁拍板", "3.7 谁拍板"),
    (1, "04", "风险预案", "风险预案"),
    (2, "4.1", "分级响应", "4.1 分级响应"),
    (2, "4.2", "风险清单", "4.2 风险清单"),
    (2, "4.3", "六个场景剧本", "4.3 六个场景"),
    (2, "4.4", "应急包", "4.4 应急包"),
    (2, "4.7", "停损线", "4.7 停损线"),
    (1, "APP", "附录", "附录"),
    (2, "A", "桌位规划", "A 桌位规划"),
    (2, "B", "物资清单", "B 物资清单"),
    (2, "C", "供应商确认话术", "C 供应商确认话术"),
    (2, "D", "预算跟踪表", "D 预算跟踪表"),
    (2, "E", "当日随身卡", "E 当日随身卡"),
]

PAGE_MAP = {f"{n}-{t}": "00" for _, n, t, _ in TOC_ITEMS}

# ---------- cover / front matter ----------
def build_cover(doc):
    sec = doc.sections[0]
    set_section_a4(sec, top=2.2, bottom=2.2, left=2.4, right=2.4)
    add_page_border(sec, color=GOLD, sz=4, space=22)
    setup_header_footer(sec, cover=True)

    p = doc.add_paragraph()
    set_para(p, before=0, after=0, line=1.0)
    r = add_text(p, 'WEDDING PLANNING DOCUMENT   /   2026', name=HEAD_FONT, size=7.5, bold=True, color=GOLD, latin=LATIN_FONT)
    set_char_spacing(r, 80)
    p = doc.add_paragraph()
    set_para(p, before=2, after=0, line=1.0)
    add_text(p, 'PRIVATE & CONFIDENTIAL', name=HEAD_FONT, size=6.8, color=GREY_LIGHT, latin=LATIN_FONT)

    p = doc.add_paragraph()
    set_para(p, before=110, after=0, line=1.0)
    add_text(p, '婚礼策划案', name=HEAD_FONT, size=34, bold=True, color=INK)

    p = doc.add_paragraph()
    set_para(p, before=6, after=0, line=1.0)
    r = add_text(p, 'A COMPLETE WEDDING PLAN', name=HEAD_FONT, size=7.8, color=GOLD, latin=LATIN_FONT)
    set_char_spacing(r, 90)

    p = doc.add_paragraph()
    set_para(p, before=14, after=12, line=1.0)
    add_bottom_border(p, color=GOLD, sz=8, space=1)

    p = doc.add_paragraph()
    set_para(p, before=0, after=0, line=1.25)
    add_text(p, '100 位宾客  ·  30 万元总预算  ·  酒店宴会厅', name=BODY_FONT, size=10.5, color=BURGUNDY)

    p = doc.add_paragraph()
    set_para(p, before=26, after=0, line=0.9)
    add_text(p, '11.22', name=HEAD_FONT, size=64, bold=True, color=GOLD_LIGHT, latin='Georgia')

    p = doc.add_paragraph()
    set_para(p, before=4, after=0, line=1.0)
    r = add_text(p, '2026 / 11 / 22   SUNDAY   ·   LUNCH BANQUET', name=HEAD_FONT, size=7.2, color=GREY, latin=LATIN_FONT)
    set_char_spacing(r, 40)

    p = doc.add_paragraph()
    set_para(p, before=120, after=8, line=1.0)
    add_text(p, '把复杂留给我们，把这一天留给你们。', name=BODY_FONT, size=9.2, color=GREY, italic=True)

    # info table
    t = doc.add_table(rows=2, cols=4)
    t.alignment = WD_TABLE_ALIGNMENT.LEFT
    set_table_width(t, [4.0, 4.0, 4.0, 4.0])
    set_table_no_borders(t)
    info = [
        ('编制', '婚礼策划组'),
        ('版本', 'V1.0'),
        ('日期', '2026.11.04'),
        ('适用范围', '新人及双方家人'),
    ]
    for i, (k, v) in enumerate(info):
        c = t.cell(0, i)
        set_cell_margins(c, top=0, left=0, bottom=10, right=80)
        set_cell_text(c, k, size=6.8, color=GREY_LIGHT, font=HEAD_FONT)
        c2 = t.cell(1, i)
        set_cell_margins(c2, top=0, left=0, bottom=0, right=80)
        set_cell_text(c2, v, size=8.2, color=INK)

def build_front_matter(doc):
    sec = doc.add_section(WD_SECTION.NEW_PAGE)
    set_section_a4(sec)
    setup_header_footer(sec, roman=True)
    set_page_numbering(sec, 'lowerRoman', 1)

    # section label
    p = doc.add_paragraph()
    set_para(p, before=0, after=2, line=1.0)
    r = add_text(p, 'BEFORE THE DAY', name=HEAD_FONT, size=7.2, bold=True, color=GOLD, latin=LATIN_FONT)
    set_char_spacing(r, 80)

    p = doc.add_paragraph()
    set_para(p, before=2, after=4, line=1.0)
    add_text(p, '写在前面', name=HEAD_FONT, size=23, bold=True, color=INK)

    p = doc.add_paragraph()
    set_para(p, before=0, after=12, line=1.0)
    add_bottom_border(p, color=GOLD, sz=8, space=1)

    body(doc, '这不是一份“看起来很美”的方案，而是一份当天可以照着执行的作战手册。它的目标不是让婚礼变成一场表演，而是让 100 位宾客在有限的时间里被照顾到，让新人在最重要的时刻不被琐事打断。', after=7)
    body(doc, '距离 11 月 22 日只剩 18 天。场地已定、宾客规模明确、预算 30 万元——这三件事决定了本方案的重点不是“从零创意”，而是“在既定条件下，把这一天安排得稳妥、体面、有记忆点”。', after=7)
    body(doc, '我们把婚礼拆成三条线：新人线（妆造、接亲、仪式）、宾客线（迎宾、入席、用餐、送客）、后勤线（物资、音视频、交通、礼金）。三条线由总协调统一调度，新人当天不进入指挥链。', after=10)

    # KPI table
    kpis = [
        ('100', '位宾客', '双方亲属 60 · 朋友 40'),
        ('10+1', '桌', '每桌 10 人，含 8 个缓冲位'),
        ('300,000', '总预算', '含 24,000 元备用金（8%）'),
        ('11.22', '周日', '距婚礼 18 天'),
    ]
    t = doc.add_table(rows=2, cols=4)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_width(t, [4.05, 4.05, 4.05, 4.05])
    set_table_no_borders(t)
    for i, (v, unit, note) in enumerate(kpis):
        c = t.cell(0, i)
        set_cell_margins(c, top=80, left=100, bottom=0, right=100)
        # top border
        tcPr = c._tc.get_or_add_tcPr()
        tcBorders = OxmlElement('w:tcBorders')
        top = OxmlElement('w:top')
        top.set(qn('w:val'), 'single'); top.set(qn('w:sz'), '12'); top.set(qn('w:space'), '0'); top.set(qn('w:color'), GOLD)
        tcBorders.append(top)
        tcPr.append(tcBorders)
        c.text = ''
        p = c.paragraphs[0]
        set_para(p, before=0, after=0, line=0.95)
        add_text(p, v, name=HEAD_FONT, size=23, bold=True, color=BURGUNDY, latin='Georgia')
        add_text(p, '  ' + unit, name=BODY_FONT, size=7.8, color=GREY)
        c2 = t.cell(1, i)
        set_cell_margins(c2, top=2, left=100, bottom=80, right=100)
        set_cell_text(c2, note, size=7.2, color=GREY_LIGHT)

    p = doc.add_paragraph()
    set_para(p, before=4, after=8, line=1.0)

    # three sentences callout
    callout(doc, '这场婚礼的三句话', [
        '宴会稳：10 桌正席 + 1 桌机动，绝不因临时来客打乱全场。',
        '流程准：11:58 仪式硬开始；延迟超过 30 分钟，启动删减清单。',
        '人有数：每个环节都有 A/B 角，新人只负责出现、享受、合影。',
    ], fill=WARM, border_color=GOLD, size=9.2)

    add_h3(doc, '先锁定这六件事')
    locked_rows = [
        ('日期：2026-11-22（周日）', '午宴 / 晚宴最终时段'),
        ('规模：100 位宾客 + 新人', '酒店合同桌价、服务费、备用桌条款'),
        ('总预算：300,000 元', '接亲路线与单程时间'),
        ('场地：酒店宴会厅（已定）', '双方家庭习俗、致辞人、敏感关系'),
        ('风格：暖白 + 香槟金（建议）', '外地亲属住宿与接送人数'),
        ('桌数：10 桌正席 + 1 桌机动', '结婚证办理与证件保管'),
    ]
    make_table(doc, ['已锁定', '仍需确认'], locked_rows, [8.05, 8.05], header_fill=BURGUNDY, font_size=8.6, header_size=8.4)
    source_note(doc, '注：方框“□”为待填/待确认项；所有姓名、电话、地址、供应商名称以实际信息替换。')

    add_h3(doc, '方案结构')
    struct_rows = [
        ('01  当日流程', '从 05:30 到 14:30 的分钟级执行表、仪式 Cue Sheet、晚宴版换算'),
        ('02  分项预算', '13 类、59 项，精确到 300,000 元；含付款节点与控制规则'),
        ('03  分工表', '14 个岗位、A/B 角、18 天倒排、供应商管理'),
        ('04  风险预案', '15 项风险、6 个场景剧本、应急包、停损线'),
        ('附录', '桌位、物资、确认话术、预算跟踪表、当日随身卡'),
    ]
    make_table(doc, ['章节', '内容'], struct_rows, [4.2, 11.9], header_fill=INK, font_size=8.5, header_size=8.4, first_col_bold=True)
    body(doc, '建议打印 3 份：总协调 1 份、签到台 1 份、新人房 1 份。手机里再存一份 PDF，便于随时查电话和流程。', after=0, size=9.2, color=GREY)

def build_toc(doc):
    p = doc.add_paragraph()
    p.paragraph_format.page_break_before = True
    set_para(p, before=0, after=0, line=1.0)

    p = doc.add_paragraph()
    set_para(p, before=0, after=2, line=1.0)
    r = add_text(p, 'CONTENTS', name=HEAD_FONT, size=7.2, bold=True, color=GOLD, latin=LATIN_FONT)
    set_char_spacing(r, 80)

    p = doc.add_paragraph()
    set_para(p, before=0, after=4, line=1.0)
    add_text(p, '目录', name=HEAD_FONT, size=23, bold=True, color=INK)

    p = doc.add_paragraph()
    set_para(p, before=0, after=10, line=1.0)
    add_bottom_border(p, color=GOLD, sz=8, space=1)

    for level, num, title, key in TOC_ITEMS:
        p = doc.add_paragraph()
        p.paragraph_format.tab_stops.clear_all()
        p.paragraph_format.tab_stops.add_tab_stop(Cm(15.9), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
        if level == 1:
            set_para(p, before=6, after=1, line=1.05)
            if num == 'APP':
                add_text(p, '附录', name=HEAD_FONT, size=11.2, bold=True, color=INK)
            else:
                add_text(p, f'{num}', name=HEAD_FONT, size=9, bold=True, color=GOLD, latin=LATIN_FONT)
                add_text(p, f'  {title}', name=HEAD_FONT, size=11.2, bold=True, color=INK)
            add_text(p, '\t', size=9)
            add_text(p, PAGE_MAP.get(f'{num}-{title}', '00'), name=HEAD_FONT, size=9, bold=True, color=INK, latin=LATIN_FONT)
        else:
            set_para(p, before=0, after=0, line=1.15)
            p.paragraph_format.left_indent = Cm(0.9)
            add_text(p, f'{num}', name=HEAD_FONT, size=8.2, bold=False, color=GOLD, latin=LATIN_FONT)
            add_text(p, f'  {title}', name=BODY_FONT, size=9.2, color=INK)
            add_text(p, '\t', size=8)
            add_text(p, PAGE_MAP.get(f'{num}-{title}', '00'), name=BODY_FONT, size=8.6, color=GREY, latin=LATIN_FONT)

    p = doc.add_paragraph()
    set_para(p, before=14, after=0, line=1.2)
    add_text(p, '页码对应正文；附录可单独打印。', size=7.8, color=GREY_LIGHT)

# ---------- chapter 1 ----------
def chapter_1(doc):
    add_chapter(doc, '01', '当日流程', 'THE DAY',
                '把一天切成 6 个阶段：准备、接亲、转场、仪式、宴席、送客。每个阶段只有一个负责人，只有一个硬时间。',
                first=True)

    add_h2(doc, '1.1', '流程设计原则')
    body(doc, '流程不是越满越好，而是让每个关键动作都有足够的时间发生。以下三条原则，决定了后面所有时间点的安排。', after=6)
    numbered(doc, '01', '三条线并行，不互相等。', '新人线、宾客线、后勤线各自推进，只在总协调处汇合。新人不需要知道酒店几点上菜，酒店也不需要知道新娘几点换装。')
    numbered(doc, '02', '硬时间 + 软内容。', '08:08 出发、11:58 仪式、12:18 开席、13:30 送客是硬时间；堵门、合影、致辞是软内容，可以压缩。')
    numbered(doc, '03', '每个环节都有 B 计划。', '下雨、延误、设备故障、宾客超员，都必须有替代动作；预案见第 4 章。')

    callout(doc, '本方案的五条假设', [
        '日期为 2026 年 11 月 22 日（周日），以午宴为主线；晚宴版见 1.7。',
        '100 位宾客 + 新人 = 102 人；按 10 桌正席 + 1 桌机动排座。',
        '接亲单程不超过 30 分钟；超过 30 分钟，整体提前 30 分钟出发。',
        '预算含税、含服务费；不含彩礼、嫁妆、蜜月、婚房。',
        '价格按 2026 年 11 月市场测算，签约时以合同价替换。',
    ], size=9.0)

    add_h2(doc, '1.2', '前一日 11/21：把能提前的都提前')
    body(doc, '前一日只做三件事：布置验收、流程彩排、物资封箱。不要在前一日临时改流程、换座位、加节目。', after=5)
    caption(doc, '表 1-1  前一日倒排')
    rows = [
        ('10:00', '物资到场 / 布置开始', '物资组 + 布置商', '按装箱清单逐项交接，缺件当场补'),
        ('14:00', '灯光 / 音响 / 视频调试', 'AV + 酒店工程', '2 支麦克风、2 台电脑、备用音源全部测试'),
        ('16:00', '新人彩排', '总协调 + 主持', '走位 2 遍；誓言、戒指、香槟、敬茶杯确认'),
        ('17:30', '签到区 / 桌卡 / 席位图验收', '物资组', '10 桌 + 1 机动桌卡无误；席位图与名单一致'),
        ('18:30', '外地亲属欢迎餐（可选）', '父母组', '人数、座位、接送、住宿全部确认'),
        ('20:00', '全场巡场 / 封场', '总协调', '门锁、电源、贵重物品、消防通道'),
        ('21:00', '新人回房 / 护肤 / 打包', '新人助理', '次日衣物、鞋、红包、证件入“明日箱”'),
        ('22:30', '熄灯', '新人', '睡够 7 小时；不刷手机、不改流程'),
    ]
    make_table(doc, ['时间', '事项', '负责人', '完成标准'], rows, [2.0, 4.4, 3.4, 6.3], font_size=8.2, header_size=8.2)
    source_note(doc, '注：彩排只走关键动线，不排练情绪；誓言不要求背诵，准备一张手卡即可。')

    add_h2(doc, '1.3', '当日总览：6 个阶段，3 条线')
    body(doc, '先看全局，再看细节。当天所有对讲机呼号、人员调度，都以这张总览为基准。', after=5)
    caption(doc, '表 1-2  当日阶段总览')
    phases = [
        ('05:30–08:08', '准备', '妆造 / 车队 / 物资'),
        ('08:08–10:50', '接亲', '堵门 / 敬茶 / 转场'),
        ('10:50–11:58', '迎宾', '签到 / 入席 / 补妆'),
        ('11:58–12:18', '仪式', '入场 / 誓言 / 戒指'),
        ('12:18–13:30', '宴席', '开席 / 换装 / 敬酒'),
        ('13:30–14:30', '送客', '回礼 / 清点 / 撤场'),
    ]
    t = doc.add_table(rows=2, cols=6)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_width(t, [2.7]*6)
    set_table_no_borders(t)
    fills = [WARM, WARM2, WARM, WARM2, WARM, WARM2]
    for i, (time, name, note) in enumerate(phases):
        c = t.cell(0, i)
        shade_cell(c, fills[i])
        set_cell_margins(c, top=80, left=60, bottom=20, right=60)
        c.text = ''
        p = c.paragraphs[0]
        set_para(p, before=0, after=0, line=1.0)
        add_text(p, time, name=HEAD_FONT, size=7.2, bold=True, color=BURGUNDY, latin=LATIN_FONT)
        c2 = t.cell(1, i)
        shade_cell(c2, fills[i])
        set_cell_margins(c2, top=0, left=60, bottom=70, right=60)
        c2.text = ''
        p = c2.paragraphs[0]
        set_para(p, before=0, after=1, line=1.0)
        add_text(p, name, name=HEAD_FONT, size=10.5, bold=True, color=INK)
        p2 = c2.add_paragraph()
        set_para(p2, before=0, after=0, line=1.0)
        add_text(p2, note, size=6.8, color=GREY)

    p = doc.add_paragraph(); set_para(p, before=0, after=2, line=1.0)

    caption(doc, '表 1-3  三条线并行的控制塔视图')
    rows = [
        ('05:30–08:08', '妆造、接亲准备、出发前合影', '无（宾客未到场）', '车队、物资、AV、妆造'),
        ('08:08–10:50', '接亲、敬茶、转场', '无', '车队、摄影、红包、酒店对接'),
        ('10:50–11:58', '补妆、候场、最后检查', '签到、礼金、入席、合影', '引导、音视频、桌卡、酒水'),
        ('11:58–12:18', '仪式', '观礼、鼓掌、合影', 'Cue Sheet、灯光、麦克风、摄影'),
        ('12:18–13:30', '换敬酒服、敬酒', '用餐、敬酒、合影', '上菜、酒水、安全、儿童'),
        ('13:30–14:30', '送客、补拍', '离场、回礼', '撤场、礼金交接、失物招领'),
    ]
    make_table(doc, ['时间', '新人线', '宾客线', '后勤线'], rows, [2.4, 4.7, 4.4, 4.7], font_size=8.2, header_size=8.2)

    add_h2(doc, '1.4', '晨起与接亲 05:30–10:50')
    body(doc, '这一段最容易“前松后紧”。核心标准只有一个：08:08 车队必须出发。晚于 08:08，后面全部顺延，且没有 buffer。', after=5)
    caption(doc, '表 1-4  晨起、接亲与敬茶')
    rows = [
        ('05:30', '新娘起床、早餐、敷面膜', '吃七分饱，少喝水；把手机交给伴娘', '新娘助理'),
        ('05:45', '新郎起床、早餐', '检查西装、皮鞋、领结、袖扣', '伴郎'),
        ('06:00', '妆造开始', '先底妆、发型；首饰最后戴', '化妆师'),
        ('06:00', '摄影摄像到场', '拍静物、晨袍、环境、戒指', '摄影 / 摄像'),
        ('06:30', '父母着装、红包、戒指、证件清点', '双人清点，签字确认；戒指交伴郎', '父母组 + 财务'),
        ('07:00', '新娘妆发 70%', '试头纱、耳饰；确认主纱穿法', '化妆师'),
        ('07:20', '晨袍照 / 闺蜜照', '15 分钟，不拖延', '摄影'),
        ('07:30', '车队集合', '车况、油量、装饰、车牌、路线', '车队'),
        ('07:45', '对讲机、应急包、充电宝', '频道测试；每车一张路线卡', '物资组'),
        ('08:00', '出发前合影', '红包、手捧花、戒指上车', '伴郎'),
        ('08:08', '车队出发', '不等人；迟到者自行前往', '车队'),
        ('08:38', '到达接亲点', '提前 5 分钟通知女方家', '车队'),
        ('08:40', '堵门游戏', '3 个以内，25 分钟；红包 20–50 个', '伴郎 + 伴娘'),
        ('09:05', '找鞋、穿鞋、献花', '鞋提前藏好，不藏空调/高处', '伴郎'),
        ('09:15', '女方敬茶', '茶杯、跪垫、红包、纸巾；先父母后祖辈', '父母组'),
        ('09:35', '女方父母致辞 / 合影', '每人不超 2 分钟；不临时加人', '摄影'),
        ('09:45', '出门、撑伞、礼花', '不喷雪花/彩带在车漆与婚纱上', '伴郎'),
        ('09:50', '车队出发去酒店/男方家', '新娘坐后排，裙摆整理好', '车队'),
        ('10:20', '到达男方家/酒店', '男方敬茶（如适用）；不超过 20 分钟', '父母组'),
        ('10:40', '补妆、整理', '吸管喝水，不弄花口红', '化妆师'),
        ('10:50', '到达宴会厅', '检查布置、桌卡、音响、通道', '总协调'),
    ]
    make_table(doc, ['时间', '事项', '关键动作 / 标准', '负责人'], rows, [1.7, 4.5, 7.2, 2.8], font_size=7.9, header_size=8.0)

    callout(doc, '堵门三原则', [
        '不绑人、不砸门、不弄脏礼服；伴娘一人控场，伴郎一人递红包。',
        '红包准备 30–50 个，每个 5–20 元；大红包只给“最后一道门”。',
        '游戏不超过 3 个、总时长不超过 25 分钟；新郎说“时间到”，伴娘立即放行。',
    ], size=8.8)

    add_h2(doc, '1.5', '迎宾、仪式与宴会 10:50–14:30')
    body(doc, '这一段是宾客体验的核心。迎宾要“有人接”，仪式要“准时开始”，宴席要“菜不等人、人不等菜”。', after=5)
    caption(doc, '表 1-5  迎宾、仪式、宴席与送客')
    rows = [
        ('10:50', '到场巡场', '检查舞台、通道、签到台、桌卡、空调', '总协调'),
        ('11:00', '迎宾开始', '签到、礼金、合影、引导入座', '签到组 + 迎宾组'),
        ('11:20', '新娘补妆 / 换仪式造型', '10 分钟内完成；不要重新做发型', '化妆师'),
        ('11:30', '宾客入席', '暖场视频/音乐；长辈先入座', '酒店 + AV'),
        ('11:45', '清场、伴郎伴娘就位', '通道清空；门口不站人', '总协调'),
        ('11:50', '新人候场、麦克风检查', '2 支麦都试；戒指在伴郎口袋', 'AV + 伴郎'),
        ('11:58', '仪式开始', '硬开始；不等人、不补人', '主持人'),
        ('12:18', '礼成、开席', '上菜；主持人引导', '酒店'),
        ('12:25', '新娘换敬酒服', '10–15 分钟；伴娘协助', '化妆师 + 伴娘'),
        ('12:40', '敬酒开始', '主桌 → 男方亲属 → 女方亲属 → 朋友', '总协调'),
        ('13:10', '敬酒结束、合影', '不逐桌坐下；每桌 1.5–2 分钟', '摄影'),
        ('13:30', '送客、回礼', '门口列队；回礼一人一份', '迎宾组 + 物资'),
        ('14:00', '礼金交接、物资清点', '双人清点、签字；失物登记', '财务 + 物资'),
        ('14:30', '撤场', '检查房间、保险柜、婚车、化妆间', '物资组'),
    ]
    make_table(doc, ['时间', '事项', '关键动作 / 标准', '负责人'], rows, [1.7, 4.3, 7.4, 2.8], font_size=8.0, header_size=8.0)

    callout(doc, '敬酒路线与节奏', [
        '主桌（2 分钟）→ 男方亲属 T2–T4（每桌 1.5 分钟）→ 女方亲属 T5–T7（每桌 1.5 分钟）→ 朋友 T8–T11（每桌 1 分钟）。',
        '伴郎拿“代酒”（茶/水）与纸巾；伴娘管裙摆、手机、口红；总协调在前方清路。',
        '不坐下、不单独加敬、不回应“再喝一杯”；每桌说完“谢谢大家”就移动。',
    ], size=8.8)

    add_h2(doc, '1.6', '仪式执行 Cue Sheet')
    body(doc, '仪式只有 20 分钟，所有动作必须按秒走。以下时间以 11:58 开场为基准，主持人、AV、督导各持一份。', after=5)
    caption(doc, '表 1-6  仪式 Cue Sheet')
    rows = [
        ('11:58:00', '开场', '主持人上场；请宾客安静', '灯光 50%；Music A', '主持'),
        ('12:00:30', '新郎入场', '从侧台走到舞台中央', '面光；Music B', 'AV'),
        ('12:02:30', '新娘入场', '门打开；父亲挽手；宾客可起身', '通道光；Music C', '督导'),
        ('12:06:00', '交接', '父亲将手交给新郎；拥抱', 'Music C 继续', '主持'),
        ('12:07:30', '誓言', '面对面；麦克风 1；手卡', '音乐降到底', '主持'),
        ('12:10:30', '交换戒指', '伴郎递戒枕；戴左手无名指', '特写；Music C 轻', '摄影'),
        ('12:12:30', '证婚 / 父母致辞', '每人不超过 2 分钟；麦克风 2', '灯光 70%', '主持'),
        ('12:15:30', '感恩 / 拥抱', '请双方父母起身；不强制上台', 'Music D 轻', '主持'),
        ('12:17:00', '礼成 / 撒花', '退场；花瓣/礼花需酒店书面同意', '灯光全亮；Music D', '督导'),
        ('12:18:00', '开席', '主持人引导；酒店上菜', '灯光全亮', '酒店'),
    ]
    make_table(doc, ['时间', '环节', '动作', '音乐 / 灯光', '负责人'], rows, [1.8, 3.0, 5.9, 3.7, 1.8], font_size=7.8, header_size=7.9)
    source_note(doc, '音乐建议：A《Canon in D》/ B《Marry You》/ C《Beautiful in White》/ D《Sugar》。提前剪好 30 秒淡入淡出，存 2 个 U 盘 + 1 台电脑离线播放。')

    add_h2(doc, '1.7', '晚宴版时间换算')
    body(doc, '如果酒店最终定的是晚宴，不需要重做流程，只需把下午段整体后移 6 小时。以下为关键节点换算。', after=5)
    caption(doc, '表 1-7  晚宴版关键时间')
    rows = [
        ('新娘化妆', '12:00', '接亲出发', '14:30'),
        ('女方敬茶', '15:30', '迎宾开始', '16:30'),
        ('仪式开始', '17:58', '开席', '18:18'),
        ('敬酒开始', '19:00', '送客', '20:30'),
        ('撤场', '21:00', '—', '—'),
    ]
    make_table(doc, ['环节', '时间', '环节', '时间'], rows, [4.0, 4.0, 4.0, 4.0], font_size=8.8, header_size=8.6)
    source_note(doc, '注：晚宴版需重新确认酒店午间场地使用、化妆房时段、工作人员餐；午餐按工作人员餐单列，不占宴会桌数。')

    add_h2(doc, '1.8', '时间控制与硬节点')
    body(doc, '当天只允许“内容压缩”，不允许“硬节点顺延”。总协调就是时间官，拥有停止和删减的权力。', after=5)
    add_h3(doc, '三个对表时间')
    bullet(doc, '07:30：妆造、车队、物资三方对表；任何一项未完成，立即启动补位。')
    bullet(doc, '10:30：接亲返程对表；未上车即通知酒店顺延 15 分钟。')
    bullet(doc, '11:30：仪式对表；签到、入席、音视频、伴郎伴娘全部就位。')
    add_h3(doc, '延迟处理')
    rows = [
        ('延迟 15 分钟', '压缩堵门/合影；通知酒店延后 10 分钟上菜', '总协调'),
        ('延迟 30 分钟', '取消外景补拍、迎宾合影；仪式压缩至 15 分钟', '总协调 + 主持'),
        ('延迟 45 分钟', '父母致辞改书面；誓言精简；12:18 必须开席', '总协调 + 新人'),
    ]
    make_table(doc, ['触发条件', '动作', '决策人'], rows, [3.2, 10.0, 3.0], font_size=8.5, header_size=8.4)
    add_h3(doc, '删减顺序（从先到后）')
    body(doc, '堵门游戏 → 外景补拍 → 迎宾合影 → 朋友互动 → 父母致辞（改书面）。仪式、敬酒、送客、安全环节绝不删。', after=6, indent=False)
    callout(doc, '五个硬节点', [
        '08:08 车队出发  ·  11:30 宾客入席  ·  11:58 仪式开始  ·  12:18 开席  ·  13:30 送客',
    ], fill=WARM2, border_color=BURGUNDY, title_color=BURGUNDY, size=9.2)

# ---------- chapter 2 ----------
def fmt_money(n):
    return f'{n:,}'

def budget_detail_table(doc):
    headers = ['编号', '项目', '规格 / 说明', '数量', '单价(元)', '金额(元)', '占比']
    widths = [1.0, 3.9, 5.3, 1.4, 1.7, 1.7, 1.2]
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_width(table, widths)
    set_table_borders(table, color=LINE, sz=4)
    hdr = table.rows[0]
    repeat_header(hdr); cant_split(hdr)
    for i, h in enumerate(headers):
        c = hdr.cells[i]
        shade_cell(c, BURGUNDY)
        set_cell_margins(c, top=65, left=70, bottom=65, right=70)
        c.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        set_cell_text(c, h, size=7.8, bold=True, color=WHITE, align=WD_ALIGN_PARAGRAPH.CENTER if i in (0,3,4,5,6) else WD_ALIGN_PARAGRAPH.LEFT)

    total = 0
    for code, name, sub, note in BUDGET:
        total += sub
        # category row
        tr = table.add_row(); cant_split(tr)
        cells = tr.cells
        for c in cells:
            shade_cell(c, WARM2)
            set_cell_margins(c, top=55, left=70, bottom=55, right=70)
            c.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        set_cell_text(cells[0], code, size=8.0, bold=True, color=BURGUNDY, align=WD_ALIGN_PARAGRAPH.CENTER)
        set_cell_text(cells[1], name, size=8.2, bold=True, color=BURGUNDY)
        merged = cells[2].merge(cells[4])
        set_cell_text(merged, '小计', size=7.8, color=GREY)
        set_cell_text(cells[5], fmt_money(sub), size=8.2, bold=True, color=BURGUNDY, align=WD_ALIGN_PARAGRAPH.RIGHT)
        set_cell_text(cells[6], f'{sub/300000*100:.2f}%', size=7.6, color=GREY, align=WD_ALIGN_PARAGRAPH.CENTER)
        # items
        for (icode, item, spec, qty, price, amount) in BUDGET_DETAIL[code]:
            tr = table.add_row(); cant_split(tr)
            cells = tr.cells
            vals = [icode, item, spec, qty, price, fmt_money(amount), '']
            for i, v in enumerate(vals):
                c = cells[i]
                set_cell_margins(c, top=42, left=70, bottom=42, right=70)
                c.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
                al = WD_ALIGN_PARAGRAPH.CENTER if i in (0,3,4,6) else (WD_ALIGN_PARAGRAPH.RIGHT if i == 5 else WD_ALIGN_PARAGRAPH.LEFT)
                set_cell_text(c, v, size=7.4, color=INK, align=al)
    # total row
    tr = table.add_row(); cant_split(tr)
    cells = tr.cells
    for c in cells:
        shade_cell(c, BURGUNDY)
        set_cell_margins(c, top=70, left=70, bottom=70, right=70)
        c.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    merged = cells[0].merge(cells[4])
    set_cell_text(merged, '合计', size=8.6, bold=True, color=WHITE)
    set_cell_text(cells[5], '300,000', size=9.0, bold=True, color=WHITE, align=WD_ALIGN_PARAGRAPH.RIGHT)
    set_cell_text(cells[6], '100%', size=8.2, bold=True, color=WHITE, align=WD_ALIGN_PARAGRAPH.CENTER)
    return table

def chapter_2(doc):
    add_chapter(doc, '02', '分项预算', 'THE BUDGET',
                '30 万元不是“花完”，而是“花对”。先锁总盘，再分配置，最后留 8% 的余地。')

    add_h2(doc, '2.1', '预算总盘：先定三条红线')
    body(doc, '总预算 300,000 元，按 102 人（100 位宾客 + 新人）测算，人均约 2,941 元。宴会与酒水占 40.3%，备用金 8.0%，单桌 8,800 元——三个指标都在安全线内。', after=6)
    kpis = [
        ('300,000', '总预算', '含税、含服务费'),
        ('2,941', '人均', '按 102 人计'),
        ('40.3%', '宴会+酒水', '红线 ≤ 42%'),
        ('8.0%', '备用金', '红线 ≥ 7%'),
    ]
    t = doc.add_table(rows=2, cols=4)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_width(t, [4.05, 4.05, 4.05, 4.05])
    set_table_no_borders(t)
    for i, (v, unit, note) in enumerate(kpis):
        c = t.cell(0, i)
        set_cell_margins(c, top=70, left=90, bottom=0, right=90)
        tcPr = c._tc.get_or_add_tcPr()
        tcBorders = OxmlElement('w:tcBorders')
        top = OxmlElement('w:top')
        top.set(qn('w:val'), 'single'); top.set(qn('w:sz'), '12'); top.set(qn('w:space'), '0'); top.set(qn('w:color'), GOLD)
        tcBorders.append(top); tcPr.append(tcBorders)
        c.text = ''
        p = c.paragraphs[0]
        set_para(p, before=0, after=0, line=0.95)
        add_text(p, v, name=HEAD_FONT, size=21, bold=True, color=BURGUNDY, latin='Georgia')
        add_text(p, '  ' + unit, name=BODY_FONT, size=7.2, color=GREY)
        c2 = t.cell(1, i)
        set_cell_margins(c2, top=2, left=90, bottom=70, right=90)
        set_cell_text(c2, note, size=7.0, color=GREY_LIGHT)

    p = doc.add_paragraph(); set_para(p, before=4, after=8, line=1.0)

    add_h3(doc, '三条红线')
    rows = [
        ('宴会 + 酒水 ≤ 42%', '126,000 元', '121,000 元（40.3%）', '通过'),
        ('备用金 ≥ 7%', '21,000 元', '24,000 元（8.0%）', '通过'),
        ('单桌 ≤ 9,000 元', '9,000 元/桌', '8,800 元/桌', '通过'),
    ]
    make_table(doc, ['红线', '上限', '本方案', '状态'], rows, [5.2, 3.4, 4.8, 2.8], font_size=8.6, header_size=8.4)
    source_note(doc, '注：桌价按二线城市中端酒店宴会标准测算；如所在城市为一线，优先从布置、车队、备用金调剂，不增加总预算。')

    callout(doc, '预算口径', [
        '本预算为“可支配婚礼总预算”，含税、含服务费；已支付定金计入对应分项，不重复计算。',
        '不含彩礼、嫁妆、蜜月旅行、婚房首付、家具家电。',
        '所有价格为 2026 年 11 月市场测算；签约时用合同价替换，差额从备用金或对应分项调剂。',
        '第 11 桌为机动桌：未开桌则节省 8,800 元 + 880 元服务费，转入备用金。',
    ], size=8.8)

    add_h3(doc, '预算分配的四个口袋')
    rows = [
        ('宴会与酒水', '121,000', '40.3%', '保底：菜品、服务、酒水，不让宾客感到怠慢'),
        ('体验与执行', '101,000', '33.7%', '保值：布置、影像、主持、妆造、策划'),
        ('戒指与杂项', '54,000', '18.0%', '保稳：对戒、伴手礼、纸品、交通、人员'),
        ('备用金', '24,000', '8.0%', '保命：只处理意外，不用于升级'),
    ]
    make_table(doc, ['口袋', '金额(元)', '占比', '用途'], rows, [4.2, 3.0, 2.0, 7.0], font_size=8.4, header_size=8.4,
               aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.RIGHT, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT])

    p = add_h2(doc, '2.2', '预算结构：钱花在哪里')
    p.paragraph_format.page_break_before = True
    body(doc, '先看结构，再看明细。婚宴是最大单项，但真正决定宾客体验的，是布置、灯光、摄影、主持和菜品的组合。', after=4)
    doc.add_picture('assets/budget_bar.png', width=Cm(13.2))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    caption(doc, '图 2-1  预算分布（万元）', after=6)

    caption(doc, '表 2-1  分项预算总表')
    rows = []
    for code, name, amount, note in BUDGET:
        rows.append((code, name, fmt_money(amount), f'{amount/300000*100:.2f}%', note))
    rows.append(('—', '合计', '300,000', '100.00%', '含 24,000 元备用金'))
    t = make_table(doc, ['编号', '类别', '金额(元)', '占比', '控制要点'], rows, [1.0, 4.2, 2.5, 1.5, 7.0], font_size=7.8, header_size=7.9,
                   aligns=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.RIGHT, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT])
    # shade total row
    for c in t.rows[-1].cells:
        shade_cell(c, WARM2)
        for p in c.paragraphs:
            for r in p.runs:
                r.font.bold = True
                r.font.color.rgb = rgb(BURGUNDY)

    p = add_h2(doc, '2.3', '分项明细：59 项，精确到 300,000')
    p.paragraph_format.page_break_before = True
    body(doc, '以下为执行版明细，可直接作为询价与合同比价底稿。每一项都标注了数量、单价和金额；签约时只替换单价，不改变结构。', after=4)
    caption(doc, '表 2-2  分项预算明细')
    budget_detail_table(doc)
    source_note(doc, '注：A2 备用席按实际开桌计费；G1 白酒未开瓶可退；K5 红包按人头统一标准，建议伴郎伴娘 200–500 元/人，司机 100–200 元/人。')

    p = add_h2(doc, '2.4', '付款节点：尾款跟验收走')
    p.paragraph_format.page_break_before = True
    body(doc, '付款节奏比价格更容易失控。原则是：定金不超过 30%，尾款在服务验收后支付，所有增项必须书面确认。', after=5)
    caption(doc, '表 2-3  建议付款节点')
    rows = [
        ('1', '婚宴（酒店）', '32,400 / 75,600', '签约 / 11-15', '30% 定金；70% 尾款最晚 11-15'),
        ('2', '场地布置', '20,000 / 20,000', '11-01 / 11-21', '50% 定金；50% 验收后'),
        ('3', '策划统筹', '7,500 / 7,500', '签约 / 11-22', '50% 定金；50% 婚礼结束当日'),
        ('4', '摄影摄像', '5,400 / 12,600', '签约 / 成片交付前', '30% 定金；70% 看片后'),
        ('5', '婚纱礼服 / 妆造', '8,000 / 8,000', '11-10 / 11-21', '50% 定金；50% 取衣/试妆后'),
        ('6', '主持 / 执行', '6,000 / 6,000', '11-10 / 11-22', '50% 定金；50% 仪式后'),
        ('7', '婚戒 / 配饰', '18,000', '11-10', '全款；保留发票与证书'),
        ('8', '酒水 / 喜糖 / 纸品', '28,000', '11-15', '全款；未开瓶酒水可退'),
        ('9', '婚车 / 交通', '9,000', '11-22', '当日结束、车辆归还后'),
        ('10', '人员餐宿 / 红包', '12,000', '11-22', '按实际人数；红包签字'),
        ('11', '备用金', '24,000', '11-22', '仅总协调/新人签批动用'),
    ]
    make_table(doc, ['批次', '对象', '金额(元)', '建议时点', '触发条件'], rows, [1.0, 4.0, 3.4, 3.0, 4.8], font_size=7.8, header_size=7.9,
               aligns=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.RIGHT, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT])
    source_note(doc, '注：金额为分项合计，不是新增支出；已付定金请在实际付款栏扣减。所有付款保留合同、发票/收据、微信文字确认。')

    add_h2(doc, '2.5', '预算控制：把“临时加一点”关进笼子')
    numbered(doc, '01', '总盘锁定。', '任何分项超 5%，或单笔增项超过 2,000 元，必须由总协调 + 新人书面确认；超过 5,000 元，需双方父母知情。')
    numbered(doc, '02', '先合同、后付款。', '不接受口头加价；增项必须写清项目、数量、单价、总价、完成时间，双方签字/微信确认。')
    numbered(doc, '03', '备用金分级动用。', '1,000 元以下总协调决定；1,000–5,000 元新人决定；5,000 元以上双方父母 + 新人共同决定。')
    numbered(doc, '04', '婚礼前 7 天冻结非必要采购。', '只保留耗材补货、酒水补货、应急交通；不临时升级布置、不加节目、不换团队。')
    numbered(doc, '05', '当日不刷卡、不转账给陌生人。', '所有尾款由财务/总协调按验收支付；新人身上只带少量现金。')
    numbered(doc, '06', '每周一更新三张表。', '预算表（计划）、承诺表（已签合同）、现金表（已付/未付）。三张表对不上，立即暂停新支出。')

    add_h3(doc, '备用金三级动用')
    rows = [
        ('< 1,000 元', '总协调', '补货、打车、临时餐食、小件物料'),
        ('1,000–5,000 元', '新人', '加座、延时、设备替换、临时用车'),
        ('> 5,000 元', '双方父母 + 新人', '更换供应商、场地升级、重大超时'),
    ]
    make_table(doc, ['金额', '审批人', '典型场景'], rows, [3.5, 4.5, 8.2], font_size=8.5, header_size=8.4)

    add_h2(doc, '2.6', '取舍清单：哪些钱值得花，哪些可以省')
    body(doc, '30 万元的预算，不可能每一项都顶配。策略是：把预算集中在宾客能感知、镜头能记录、当天不可重来的地方。', after=5)
    caption(doc, '表 2-4  预算取舍')
    rows = [
        ('摄影摄像（双机位）', '车队数量（6 辆足够）', '食品安全与留样'),
        ('主持人与仪式督导', '纸质请柬（可电子 + 少量纸质）', '活动保险 / 公众责任险'),
        ('新娘妆造与试妆', '大型花艺（改为重点区域花艺）', '备用金（不低于 7%）'),
        ('灯光与音响', '定制喜糖盒（改为统一简约包装）', '专业主持 / 摄影 / 化妆'),
        ('菜品试吃与长辈餐', '甜品台 / 烟花 / 冷焰火', '音视频备份（2 麦 2 电脑）'),
        ('长辈舒适度（接送/住宿/披肩）', '过多跟拍 / 摆拍', '礼金双人保管与保险柜'),
    ]
    make_table(doc, ['值得加钱', '可以省', '绝不省'], rows, [5.4, 5.4, 5.4], font_size=8.4, header_size=8.4)
    add_h3(doc, '如果还有 10,000 元，按这个顺序加')
    body(doc, '灯光 → 摄影（加机位/加精修）→ 化妆（试妆/跟妆）→ 花艺（主舞台/迎宾区）→ 车队（主车升级）。不要先加桌、加菜、加酒。', after=6, indent=False)

    add_h2(doc, '2.7', '婚礼后结算：把账收干净')
    rows = [
        ('T+1（11/23）', '收集发票/收据；退还租赁物；礼金存入银行；照片/视频双备份', '财务 + 物资'),
        ('T+7（11/29）', '支付尾款；核对损坏押金；完成预算复盘；发出感谢卡', '总协调 + 财务'),
        ('T+30（12/22）', '确认摄影/摄像交付节点；整理合同与票据归档', '新人 + 影像团队'),
    ]
    make_table(doc, ['时间', '动作', '负责人'], rows, [3.2, 10.0, 3.0], font_size=8.4, header_size=8.4)
    source_note(doc, '结算公式：总支出 = 合同金额 + 已确认变更 − 退款/未开桌；备用金余额转入家庭账户，不留在婚礼活期账户里。')
    body(doc, '最后一条建议：不要用婚礼当天收到的礼金支付供应商尾款。礼金是祝福，不是现金流；尾款提前准备好，现场才不会乱。', after=0, size=9.6, color=GREY)

# ---------- chapter 3 ----------
def chapter_3(doc):
    add_chapter(doc, '03', '分工表', 'THE TEAM',
                '婚礼当天，新人不需要做决定。每个岗位知道自己在什么时候、在哪里、做什么，比“大家都很帮忙”更重要。')

    add_h2(doc, '3.1', '组织架构：一条指挥链')
    body(doc, '所有信息只走一条线：总协调 → 各组负责人 → 志愿者。新人不在指挥链上，供应商也不直接找新人。这样做的目的，是让新人在当天只处理三件事：出现、享受、合影。', after=5)
    caption(doc, '表 3-1  三层组织架构')
    rows = [
        ('决策层', '新人 + 双方父母', '只处理：预算 > 5,000 元、家庭敏感关系、是否暂停/取消'),
        ('总控', '总协调 / 婚礼管家', '唯一调度权：流程、供应商、预算、应急；对讲机 CH1'),
        ('执行层', '签到礼金、迎宾引导、物资道具、音视频、影像对接、车队交通、父母组、伴郎伴娘、儿童安全、应急机动、财务', '按岗位卡执行；每岗设 A/B 角；问题 3 分钟内上报'),
    ]
    make_table(doc, ['层级', '角色', '权限 / 边界'], rows, [2.2, 6.4, 7.6], font_size=8.2, header_size=8.3)
    callout(doc, '一条铁律', [
        '任何供应商、亲友、酒店提出的临时需求，先找总协调；总协调判断后，再决定是否打扰新人。',
        '新人手机静音；伴娘保管新娘手机，伴郎保管新郎手机；只有双方父母和总协调可以直拨。',
    ], size=8.8)

    add_h2(doc, '3.2', '岗位职责：14 个岗位，每岗一个负责人')
    body(doc, '以下“建议人选”按关系与能力匹配，不按辈分。每个岗位必须指定 1 名备份；备份不到场，视为岗位空缺。', after=5)
    caption(doc, '表 3-2  核心岗位（R01–R07）')
    rows = [
        ('R01', '总协调', '婚礼管家 / 资深亲友', '1', '总控流程、供应商、预算、现场决策；持主流程表、电话表、座位图；有权删减环节', '05:30 / CH1'),
        ('R02', '新人助理', '伴娘 / 亲密朋友', '1', '手机、水、纸巾、补妆、裙摆；替新人挡人、挡问题；全程不离开新人', '05:30 / CH1'),
        ('R03', '签到礼金', '细心的表姐 / 同事', '2+1', '签到、礼金登记、编号、锁箱、双人保管；不在公开区域点数；仪式前送保险柜', '10:15 / CH3'),
        ('R04', '迎宾引导', '朋友 / 同事', '4', '门口迎接、电梯指引、座位引导、长辈/儿童照顾、洗手间指引', '10:30 / CH3'),
        ('R05', '物资道具', '细心亲友', '2+1', '装箱清单、布置验收、补货、撤场、失物招领；每 2 小时巡一次', '09:00 / CH4'),
        ('R06', '音视频', 'IT / 音响朋友', '1', '麦克风、音乐、视频、备用设备、Cue Sheet；提前 2 小时测试', '09:30 / CH4'),
        ('R07', '影像对接', '伴郎 / 朋友', '1', '拍摄清单、家庭合影名单、团队餐食、卡备份；不挡镜头、不催流程', '06:00 / CH1'),
    ]
    make_table(doc, ['编号', '岗位', '建议人选', '人数', '核心职责', '到位 / 频道'], rows, [1.0, 2.6, 3.2, 0.9, 6.7, 1.8], font_size=7.4, header_size=7.6,
               aligns=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER])

    p = caption(doc, '表 3-3  支持岗位（R08–R14）')
    p.paragraph_format.page_break_before = True
    rows = [
        ('R08', '车队交通', '会开车的亲戚', '1+1', '路线、集合、车牌、停车、宾客接送；每车一张路线卡；实时定位', '07:30 / CH2'),
        ('R09', '父母组', '双方各 1 位长辈/亲戚', '2', '长辈座位、敬茶、用药、披肩、情绪；敏感家庭关系提前排座', '06:30 / CH1'),
        ('R10', '伴郎团', '新郎好友', '4', '堵门、戒指、红包、代酒、搬物、应急；一人专管戒指', '06:30 / CH2'),
        ('R11', '伴娘团', '新娘好友', '4', '裙摆、手机、补妆、纸巾、堵门控场；一人专管红包', '05:30 / CH1'),
        ('R12', '儿童 / 安全', '有孩子的好友', '1', '儿童看护、通道、明火/台阶/水池、走失；危险区提前封控', '11:00 / CH1'),
        ('R13', '应急机动', '机动朋友', '1', '补位任何岗位、跑腿、取物、送医陪同；不安排固定任务', '08:00 / CH1'),
        ('R14', '财务结算', '会计 / 细心家人', '1', '合同、付款、发票、礼金交接、结算；只认签字，不认口头', '12:30 / CH1'),
    ]
    make_table(doc, ['编号', '岗位', '建议人选', '人数', '核心职责', '到位 / 频道'], rows, [1.0, 2.6, 3.2, 0.9, 6.7, 1.8], font_size=7.4, header_size=7.6,
               aligns=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER])

    add_h2(doc, '3.3', '到岗与通讯：让每个人都在同一频道')
    caption(doc, '表 3-4  到岗时间')
    rows = [
        ('05:30', '总协调、新人助理、伴娘、妆造', '开灯、早餐、妆造开始；检查今日箱'),
        ('06:00', '摄影、摄像', '静物、晨袍、环境；确认拍摄清单'),
        ('07:30', '车队、伴郎', '车况、油量、装饰、路线；对讲机测试'),
        ('09:00', '物资、酒店宴会经理', '布置验收、桌卡、通道、电源、空调'),
        ('10:15', '签到、礼金', '签到台、礼金箱、席位图、笔、计算器'),
        ('10:30', '迎宾、父母组、儿童安全', '门口迎接、长辈入座、儿童区'),
        ('11:00', '全体', '对讲机点名；未到岗立即补位'),
    ]
    make_table(doc, ['时间', '到岗人员', '动作'], rows, [2.0, 6.0, 8.2], font_size=8.2, header_size=8.3)

    caption(doc, '表 3-5  对讲机频道')
    rows = [
        ('CH1', '总控 / 酒店 / 新人', '总协调、酒店宴会经理、新人助理'),
        ('CH2', '接亲 / 车队', '车队、伴郎、摄影车'),
        ('CH3', '签到 / 迎宾', '签到、礼金、迎宾、父母组'),
        ('CH4', '物资 / AV', '物资、音视频、布置、摄影对接'),
    ]
    make_table(doc, ['频道', '覆盖', '主要人员'], rows, [1.8, 5.0, 9.4], font_size=8.4, header_size=8.3)
    add_h3(doc, '通讯纪律')
    bullet(doc, '对讲机戴耳机，音量适中；只说“人话”，不聊闲天。')
    bullet(doc, '手机静音；微信群只发文字和定位，不发长语音。')
    bullet(doc, '紧急情况直接打电话，不在群里等回复。')
    bullet(doc, '任何人不得擅自离岗；需要离开，先向总协调报备并找到替补。')
    bullet(doc, '不拍摄、不传播现场照片；尤其不拍新人疲惫、宾客失态、事故画面。')

    add_h2(doc, '3.4', '三张任务卡：新人、伴郎伴娘、父母')
    callout(doc, '新人卡：今天只做三件事', [
        '出现：按总协调的时间点出现，不提前、不迟到。',
        '享受：仪式上看着对方，不要看手机、不要看流程表。',
        '合影：迎宾、仪式、敬酒、送客四个节点，其他时间休息。',
        '遇到任何问题，只说一句：“找总协调。”不现场决策、不临时改流程。',
    ], size=8.9)
    callout(doc, '伴郎伴娘卡：一人一责，不扎堆', [
        '伴郎 A：戒指 + 戒枕；伴郎 B：红包 + 代酒；伴郎 C：车门 + 物资；伴郎 D：机动 + 挡人。',
        '伴娘 A：裙摆 + 补妆；伴娘 B：手机 + 纸巾；伴娘 C：堵门控场；伴娘 D：红包 + 回礼。',
        '不劝酒、不婚闹、不把新人抬起来、不喷雪花/彩带在婚纱和车漆上。',
        '任何环节超时，伴郎/伴娘直接执行总协调的删减指令。',
    ], fill=WARM, border_color=GOLD, size=8.8)
    callout(doc, '父母卡：被照顾，也被尊重', [
        '双方各指定 1 位对接人，所有家庭事务先找对接人，不直接找供应商。',
        '长辈座位靠前、远离音响；提前准备披肩、暖宝宝、常用药、老花镜。',
        '致辞不超过 2 分钟；不临时加人、不临时改流程、不在台上催婚/催生。',
        '如家庭关系敏感，提前排座、安排单独休息区，不在现场处理旧账。',
    ], fill=WARM2, border_color=BURGUNDY, title_color=BURGUNDY, size=8.8)

    add_h2(doc, '3.5', '18 天倒排：从今天到婚礼')
    body(doc, '今天（11 月 4 日）到 11 月 22 日只有 18 天。以下节点按“必须完成”设计，逾期一天，后面就会挤。', after=5)
    caption(doc, '表 3-6  18 天执行倒排')
    rows = [
        ('11-04', 'D-18', '启动会：确认预算、人数、合同、供应商', '预算表 V1、供应商清单'),
        ('11-06', 'D-16', '酒店合同、菜单试菜、服务费/备用桌条款', '合同扫描件、菜单确认'),
        ('11-08', 'D-14', '发请柬、建宾客群、收集忌口/住宿/接送', 'RSVP 50%'),
        ('11-10', 'D-12', '试纱、试妆、对戒、西装、伴娘服', '定妆照、戒指尺寸'),
        ('11-13', 'D-9', '桌数初稿、付款计划、外地亲属住宿', '桌数 V1、付款表'),
        ('11-15', 'D-7', '最终人数、座位图、过敏名单、酒水/喜糖下单', '座位图 V1'),
        ('11-17', 'D-5', '打印桌卡/席位图、采购物资、补印请柬', '装箱清单'),
        ('11-19', 'D-3', '72 小时天气、供应商 T-1 确认、备用方案', '确认表、风险清单'),
        ('11-20', 'D-2', '打包“明日箱”、取礼服、戒指/证件清点', '封箱拍照'),
        ('11-21', 'D-1', '布置验收、彩排、封场、早睡', '验收单、彩排完成'),
        ('11-22', 'D-0', '婚礼执行', '按流程表'),
        ('11-23', 'D+1', '归还租赁、照片备份、失物招领、礼金存入', '交接单'),
        ('11-29', 'D+7', '尾款、发票、预算复盘、感谢卡', '结算表'),
    ]
    make_table(doc, ['日期', '节点', '必做', '交付 / 标准'], rows, [1.8, 1.6, 8.0, 4.8], font_size=7.9, header_size=8.0)

    p = add_h2(doc, '3.6', '供应商管理：只认文字，不认口头')
    p.paragraph_format.page_break_before = True
    body(doc, '供应商不是“请来帮忙的人”，而是合同关系。当天所有变更，必须落到文字；所有尾款，必须跟验收挂钩。', after=5)
    caption(doc, '表 3-7  供应商 Call Sheet（模板）')
    rows = [
        ('酒店', '待填', '宴会经理', '09:00', '合同 / 尾款', '宴会厅、停车、电源'),
        ('布置', '待填', '负责人', '10:00', '合同 / 尾款', '进场时间、撤场押金'),
        ('摄影', '待填', '主摄', '06:00', '合同 / 尾款', '拍摄清单、餐食'),
        ('摄像', '待填', '主摄', '06:00', '合同 / 尾款', '机位、收音、快剪'),
        ('主持', '待填', '主持人', '10:30', '合同 / 尾款', 'Cue Sheet、音乐'),
        ('妆造', '待填', '化妆师', '05:30', '合同 / 尾款', '试妆照、跟妆'),
        ('车队', '待填', '队长', '07:30', '合同 / 尾款', '车牌、路线、停车'),
        ('酒水', '待填', '配送', '11:00', '合同 / 尾款', '开瓶费、退瓶'),
    ]
    make_table(doc, ['类别', '供应商', '联系人', '到场', '合同 / 尾款', '备注'], rows, [1.8, 3.6, 3.2, 1.8, 3.2, 2.6], font_size=7.6, header_size=7.7)
    add_h3(doc, 'T-1 确认（11/21 18:00 前完成）')
    bullet(doc, '到场时间、地点、对接人、车牌/人员数量。')
    bullet(doc, '合同金额、已付/未付、是否有增项、发票。')
    bullet(doc, '物料清单、设备清单、备用方案、紧急联系人。')
    bullet(doc, '是否需要餐食、停车、电源、化妆位。')
    bullet(doc, '如遇雨/延误/设备故障，如何调整、多久到位。')
    body(doc, '全部用微信文字确认；未回复者 20:00 电话；仍失联，启动备份供应商。', after=5, indent=False, size=9.2)
    add_h3(doc, '供应商四条红线')
    bullet(doc, '不付全款：定金 ≤ 30%，尾款验收后。')
    bullet(doc, '不接受口头增项：所有加价写进变更单。')
    bullet(doc, '不让供应商直接找新人：统一对接总协调。')
    bullet(doc, '不临时换人：合同写明主摄/主持/化妆师姓名，换人需书面同意。')

    add_h2(doc, '3.7', '谁拍板：把决策权放在一个人手里')
    rows = [
        ('流程变更（±15 分钟）', '总协调', '主持、酒店、新人助理', '5 分钟内'),
        ('预算追加 < 5,000 元', '新人', '总协调、财务', '10 分钟内'),
        ('预算追加 > 5,000 元', '双方父母 + 新人', '总协调', '30 分钟内'),
        ('座位调整 / 临时来客', '父母组 + 总协调', '签到、酒店', '即时'),
        ('供应商尾款', '财务 + 总协调', '新人', '验收后'),
        ('医疗 / 安全 / 报警', '总协调', '120 / 110 / 家属', '立即'),
        ('媒体 / 拍摄 / 隐私', '影像对接', '总协调', '即时'),
        ('礼金保管 / 交接', '签到 + 财务', '总协调', '全程'),
    ]
    make_table(doc, ['事项', '第一决策人', '必须知会', '时限'], rows, [5.2, 3.6, 4.8, 2.6], font_size=8.2, header_size=8.2)

    p = add_h2(doc, '3.8', '志愿者纪律：帮忙，但不添乱')
    p.paragraph_format.page_break_before = True
    bullet(doc, '提前 30 分钟到岗；穿黑色/统一色，不穿高跟鞋、不穿拖地长裙。')
    bullet(doc, '不饮酒；不串岗；不围观的围拍；不在通道停留。')
    bullet(doc, '不向新人提问、不向新人不报忧；所有问题找总协调。')
    bullet(doc, '不擅自使用新人物品；不拆红包、不点礼金、不拍照发群。')
    bullet(doc, '看到老人、儿童、醉酒者、可疑人员，立即上报。')
    bullet(doc, '婚礼结束后留下 30 分钟，协助物资清点与撤场。')

# ---------- chapter 4 ----------
def chapter_4(doc):
    add_chapter(doc, '04', '风险预案', 'THE RISK',
                '预案不是咒语，而是让每个人在意外发生时，知道下一步做什么。先保安全，再保仪式，最后保流程。')

    add_h2(doc, '4.1', '分级响应：绿、黄、红')
    body(doc, '不是所有问题都值得惊动新人。把风险分成三级，对应不同的响应速度和决策人，现场才不会乱。', after=5)
    caption(doc, '表 4-1  三级响应')
    rows = [
        ('绿色', '不影响流程，或 5 分钟内可解决', '岗位自行处理，事后记录', '岗位负责人', '桌卡错字、笔没水、花材缺一支'),
        ('黄色', '影响 15–30 分钟，或影响部分宾客体验', '总协调 10 分钟内决定，可动用备用金', '总协调', '车队延误、音响故障、宾客超员'),
        ('红色', '人身安全、法律风险、重大财产损失', '立即暂停/报警/就医；总协调 + 家属出面', '总协调 + 家属', '火灾、食物中毒、暴力冲突、走失'),
    ]
    make_table(doc, ['级别', '定义', '响应', '决策人', '典型例子'], rows, [1.5, 5.0, 4.8, 2.6, 4.0], font_size=7.8, header_size=7.9)
    callout(doc, '风险处理的三个原则', [
        '安全 > 仪式 > 流程 > 拍照 > 布置。任何时候，只要有人身安全风险，立即暂停婚礼。',
        '先解决，后追责。不要在现场争论谁对谁错，先把人照顾好、把场面稳住。',
        '不让新人处理事故。总协调 + 双方父母出面；新人只需要知道“已经处理好了”。',
    ], size=8.9)
    add_h3(doc, '30 分钟规则')
    body(doc, '任何环节延误超过 30 分钟，立即启动删减清单；不把焦虑传递给宾客。主持人用一句“稍等片刻，美好值得等待”带过，不要解释细节。', after=5, indent=False)

    add_h2(doc, '4.2', '风险清单：15 项，逐项有人负责')
    body(doc, '以下按“概率 × 影响”排序。高概率项提前做物理准备，高影响项提前做人和合同准备。', after=4)
    caption(doc, '表 4-2  风险清单')
    rows = [
        ('降雨 / 降温', '预报降雨 > 60% 或体感 < 10°C', '中 / 中', '室内备用、雨具、暖宝宝、防滑垫', '转室内、姜茶、调整外景、车队靠近门口', '总协调'),
        ('接亲 / 车队延误', '出发晚 15 分钟、堵车', '高 / 中', '路线踏勘、提前 30 分钟、实时定位', '压缩游戏、改路线、通知酒店顺延', '车队'),
        ('宾客超员 / 座位冲突', 'RSVP 超 10%、临时带人', '中 / 中', '10+1 桌、座位图、签到核对', '加座不加桌、启用机动桌、引导至休息区', '签到'),
        ('供应商迟到 / 失联', 'T-1 未确认、迟到 20 分钟', '中 / 高', '合同、备份名单、尾款约束', '启动备份、调整顺序、保留证据', '总协调'),
        ('音响 / 断电', '无声、跳闸、麦克风啸叫', '中 / 高', '2 麦、2 电脑、UPS、酒店工程', '换麦、换音源、清唱/手持扩音、发电机', 'AV'),
        ('食物过敏 / 食品安全', '宾客不适、菜品异味', '低 / 高', '过敏名单、菜品标签、留样 48h', '停菜、就医、留证、报告酒店', '酒店 + 总协调'),
        ('醉酒 / 冲突', '大声喧哗、推搡、纠缠', '中 / 高', '限酒、代酒、酒店安保', '隔离、叫安保/110、不拍摄、不刺激', '总协调'),
        ('礼金 / 财物丢失', '红包不见、箱子异常、人员进出', '低 / 高', '双人保管、编号、锁箱、监控', '封场、查监控、报警、双人清点', '财务'),
        ('照片 / 视频丢失', '卡满、设备故障、误删', '低 / 高', '双卡、双备份、合同交付条款', '换机、数据恢复、补拍、书面告知', '影像'),
        ('流程超时', '关键节点晚 15 分钟', '高 / 中', '时间官、硬节点、删减清单', '压缩/删减、主持人控场', '总协调'),
        ('新娘 / 宾客身体不适', '头晕、腹痛、过敏、低血糖', '中 / 高', '早餐、常用药、医院路线、陪同', '休息、就医、家人陪同、不围观', '新人助理'),
        ('火灾 / 紧急疏散', '烟雾、警报、明火', '低 / 极高', '出口、灭火器、禁明火、容量', '疏散、119、点名、集合点', '酒店安保'),
        ('儿童走失 / 受伤', '找不到、摔倒、烫伤', '中 / 中', '家长看护、腕带、危险区封控', '广播、封门、寻找、送医', '儿童安全'),
        ('合同 / 付款纠纷', '临时加价、发票问题、换人', '中 / 中', '书面合同、变更单、尾款验收', '拒付争议款、留证、投诉/诉讼', '财务'),
        ('证件 / 戒指忘带', '出发前未清点、找不到', '低 / 高', '明日箱、双人清点、备用戒指', '回家取、复印件、备用戒指、调整仪式', '新人助理'),
    ]
    make_table(doc, ['风险', '触发信号', '概率/影响', '预防', '应急', '负责人'], rows, [2.8, 3.3, 1.4, 3.8, 3.5, 1.4], font_size=7.1, header_size=7.5,
               aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER])

    p = add_h2(doc, '4.3', '六个场景剧本：如果……立即……')
    p.paragraph_format.page_break_before = True
    body(doc, '以下六个场景，是婚礼当天最可能发生的“真问题”。每个场景只记三件事：谁来做、先做什么、绝不做什么。', after=4)
    callout(doc, '场景 1  下雨 / 降温', [
        '如果 11/20 18:00 预报降雨概率 > 60%，或气温 < 10°C：',
        '立即：外景改室内，车队靠近门口，签到台备姜茶，通道铺防滑垫。',
        '然后：物资组发 20 把透明伞、10 条披肩、50 片暖宝宝；摄影改用走廊/宴会厅前厅。',
        '绝不：让新娘穿主纱在雨里走 10 分钟以上；用深色伞挡镜头；让长辈在风口等车。',
    ], size=8.7)
    callout(doc, '场景 2  接亲 / 车队延误 30 分钟', [
        '如果 08:38 未到接亲点，或 10:20 未返程：',
        '立即：车队对讲机报告；总协调判断是否压缩堵门/敬茶。',
        '然后：伴娘结束游戏，伴郎找鞋；通知酒店、摄影、主持顺延；仪式不晚于 12:08。',
        '绝不：为等一个人推迟仪式；在车上狂飙；让宾客在宴会厅干等而不说明。',
    ], size=8.7)
    callout(doc, '场景 3  音响 / 断电', [
        '如果仪式前麦克风无声、音乐中断、跳闸：',
        '立即：AV 切换备用麦克风/备用电脑；酒店工程 3 分钟内到场。',
        '然后：主持人用备用手持麦；无法恢复则改清唱/手机播放 + 手持扩音器；仪式不中断。',
        '绝不：让宾客集体等待超过 10 分钟而不说明；在台上反复“喂喂喂”；临时换主持人。',
    ], size=8.7)
    callout(doc, '场景 4  宾客超员 / 座位冲突', [
        '如果签到人数超过 102 人，或出现“没位置”：',
        '立即：签到组把客人引到迎宾区，不直接进厅；总协调启用 T11 机动桌。',
        '然后：优先加座，不加桌；父母组调整亲属桌；朋友桌可拆桌/并桌。',
        '绝不：让宾客自己找座位；在主桌加陌生人；当着宾客面争论座位。',
    ], size=8.7)
    callout(doc, '场景 5  身体不适 / 醉酒', [
        '如果宾客头晕、呕吐、过敏、醉倒：',
        '立即：新人助理/父母组陪同到休息室；需要时拨打 120；酒店安保引导救护车。',
        '然后：家人陪同就医；醉酒者由同伴送回/代驾；保留呕吐物/菜品样本（如疑似食物中毒）。',
        '绝不：给处方药；继续劝酒；拍摄失态照片；让醉酒者驾车。',
    ], size=8.7)
    callout(doc, '场景 6  礼金 / 财物安全', [
        '如果红包箱异常、人员频繁进出、礼金对不上：',
        '立即：锁箱，双人保管；仪式前送酒店保险柜/专人看管房间。',
        '然后：结束后双人清点、签字交接；当日存入银行；必要时查监控/报警。',
        '绝不：把红包放在新娘房、婚车、签到台过夜；单人保管；在公开区域点数。',
    ], size=8.7)

    add_h2(doc, '4.4', '应急包：一个箱子，装下当天的“万一”')
    body(doc, '应急包由物资组保管，放在签到台内侧/化妆间固定位置；总协调、新人助理、物资组都知道位置。婚礼前一日封箱拍照。', after=5)
    caption(doc, '表 4-3  应急包清单')
    rows = [
        ('医药', '创可贴、碘伏棉签、肠胃药、抗过敏药、退烧药、止痛药、个人处方药', '各1盒', '物资组 / 按医嘱'),
        ('新娘', '针线包、别针、双面胶、吸管、纸巾、湿巾、口红、粉饼、发夹、备用丝袜、平底鞋、暖宝宝', '1套', '伴娘 A'),
        ('仪式', '备用戒指、誓言卡、戒枕、备用捧花、胸花、签到笔、电池、延长线、转换插头、对讲机、充电宝', '1套', '物资组 / AV'),
        ('食品', '矿泉水、能量棒、巧克力、吸管', '1箱', '新人助理'),
        ('文件', '合同、付款凭证、供应商电话、座位图、流程表、证件复印件', '1套', '总协调 / 财务'),
        ('工具', '剪刀、胶带、扎带、美纹纸、记号笔、透明袋、标签纸', '1套', '物资组'),
        ('现金', '零钱、备用红包、应急现金', '1包', '财务'),
        ('雨具', '透明伞 20 把、防滑垫 2 块、毛巾 10 条', '1套', '物资组'),
    ]
    make_table(doc, ['类别', '物品', '数量', '存放 / 负责人'], rows, [1.8, 9.3, 1.8, 3.3], font_size=7.5, header_size=7.6)
    source_note(doc, '注：处方药只给本人，不自行分发；如宾客需要用药，建议由家人/医生处理。')

    add_h2(doc, '4.5', '关键电话与医院：提前存，不要当天搜')
    body(doc, '以下表格打印 3 份：总协调 1 份、签到台 1 份、新人房 1 份。婚礼前一日由总协调逐项确认号码可通。', after=5)
    caption(doc, '表 4-4  关键联系人')
    rows = [
        ('总协调', '', '', '唯一调度'),
        ('酒店宴会经理', '', '', '场地/上菜/停电'),
        ('酒店安保', '', '', '冲突/疏散/失物'),
        ('布置负责人', '', '', '搭建/撤场'),
        ('摄影主摄', '', '', '拍摄/备份'),
        ('摄像主摄', '', '', '机位/收音'),
        ('主持人', '', '', '流程/控场'),
        ('化妆师', '', '', '补妆/换装'),
        ('车队队长', '', '', '路线/停车'),
        ('新人 A', '', '', '仅紧急'),
        ('新人 B', '', '', '仅紧急'),
        ('双方父母', '', '', '家庭事务'),
        ('最近医院急诊', '', '', '车程 ___ 分钟'),
        ('120 / 110 / 119', '', '', '紧急报警'),
    ]
    make_table(doc, ['角色', '姓名', '电话', '备注'], rows, [5.0, 3.5, 4.0, 3.7], font_size=8.0, header_size=8.1)
    body(doc, '婚礼前一周，实地走一次“酒店 → 最近三甲医院急诊”的路线，记录车程、入口、停车位置；不要婚礼当天才导航。', after=5, indent=False, size=9.4, color=GREY)

    p = add_h2(doc, '4.6', '保险与合同：把“万一”变成“有据可依”')
    p.paragraph_format.page_break_before = True
    add_h3(doc, '保险')
    bullet(doc, '确认酒店是否已购公众责任险，保额、覆盖范围、免赔额。')
    bullet(doc, '如活动有搭建、烟花、冷焰火、外景，补充活动意外险/搭建险。')
    bullet(doc, '摄影/摄像设备险由团队自备；合同中写明设备故障的补救责任。')
    add_h3(doc, '合同必写条款')
    bullet(doc, '取消/延期/不可抗力：定金退多少、改期几次、是否加价。')
    bullet(doc, '替补：主摄/主持/化妆师换人需书面同意，否则退款/赔偿。')
    bullet(doc, '交付：照片/视频数量、精修张数、交付时间、逾期违约金。')
    bullet(doc, '肖像权/隐私：是否可用于商家宣传；未经同意不得发布。')
    bullet(doc, '付款：定金 ≤ 30%，尾款验收后；增项书面确认。')
    add_h3(doc, '证据留存')
    body(doc, '合同、发票/收据、微信文字确认、现场照片、付款记录，统一放进一个文件袋/云文件夹。发生争议时，先留证，再沟通；不签空白合同、不付私人账户、不押身份证。', after=5, indent=False, size=9.4)

    add_h2(doc, '4.7', '停损线：什么时候必须停下来')
    numbered(doc, '01', '人身安全高于一切。', '火灾、踩踏、食物中毒、暴力冲突、极端天气，立即暂停婚礼，疏散/就医/报警。')
    numbered(doc, '02', '仪式可以简化，但不能取消。', '12:18 必须开席；仪式最长延迟到 12:08，之后压缩誓言/致辞，不取消交换戒指。')
    numbered(doc, '03', '不追不可控的损失。', '已经错过的外景、漏拍的合影、迟到的宾客，不回头补；先把当下的人照顾好。')
    numbered(doc, '04', '不让新人处理事故。', '总协调 + 双方父母出面；新人只需知道“已经处理好了”，不被拉进争论。')
    numbered(doc, '05', '不传播事故画面。', '不拍、不发、不群传；保护当事人隐私，避免二次伤害。')
    callout(doc, '最后一句话', [
        '婚礼可以有不完美，但不能有不安全。',
        '如果只能记住一件事：任何时候，先保护人，再保护流程。',
    ], fill=WARM2, border_color=BURGUNDY, title_color=BURGUNDY, size=9.2)

# ---------- appendices ----------
def appendices(doc):
    add_chapter(doc, 'APPENDIX', '附录', 'TOOLS & CHECKLISTS',
                '把方案变成当天能用的工具：桌位、物资、话术、跟踪表、随身卡。')

    add_h2(doc, 'A', '桌位规划：10 桌正席 + 1 桌机动')
    body(doc, '按 102 人排座，共 110 个座位，预留 8 个缓冲位。原则是：长辈靠前、双方分侧、朋友成圈、敏感关系分开。', after=5)
    caption(doc, '表 A-1  桌位规划')
    rows = [
        ('T1', '主桌', '10', '靠近舞台', '总协调', '新人 2 + 双方父母 4 + 祖辈/证婚 4'),
        ('T2', '男方亲属', '10', '舞台左侧', '男方父母组', '主桌外亲属'),
        ('T3', '男方亲属', '10', '舞台左侧', '男方父母组', '按辈分/家庭排'),
        ('T4', '男方亲属', '10', '舞台左侧', '男方父母组', '留 2–4 个缓冲位'),
        ('T5', '女方亲属', '10', '舞台右侧', '女方父母组', '主桌外亲属'),
        ('T6', '女方亲属', '10', '舞台右侧', '女方父母组', '按辈分/家庭排'),
        ('T7', '女方亲属', '10', '舞台右侧', '女方父母组', '留 2–4 个缓冲位'),
        ('T8', '朋友', '10', '中后区', '伴郎', '同学/同事'),
        ('T9', '朋友', '10', '中后区', '伴郎', '朋友'),
        ('T10', '朋友', '10', '中后区', '伴娘', '朋友'),
        ('T11', '朋友/机动', '0–10', '靠近入口', '签到组', '可开可关；优先加座'),
    ]
    make_table(doc, ['桌号', '对象', '座位', '位置', '负责人', '备注'], rows, [1.3, 3.0, 1.6, 2.6, 3.4, 4.3], font_size=8.0, header_size=8.1,
               aligns=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT])
    add_h3(doc, '排座五原则')
    bullet(doc, '长辈靠前、远离音响；行动不便者靠近通道，但不坐在上菜口。')
    bullet(doc, '男方亲属坐舞台左侧，女方亲属坐舞台右侧；主桌双方父母相对而坐。')
    bullet(doc, '朋友按“同学 / 同事 / 发小 / 伴侣”分圈层，不把陌生人拼一桌。')
    bullet(doc, '敏感关系（前任、离异家庭、有过冲突的亲友）提前分开，必要时安排单独休息区。')
    bullet(doc, '儿童靠近父母、靠近出口；不安排在舞台边、电线边、热菜通道边。')

    p = add_h2(doc, 'B', '物资清单：按箱子打包，按清单验收')
    p.paragraph_format.page_break_before = True
    body(doc, '物资不要按“品类”散放，要按“使用场景”装箱：签到箱、仪式箱、新娘箱、AV 箱、应急箱、撤场箱。每箱贴标签、写负责人。', after=5)
    caption(doc, '表 B-1  物资清单')
    rows = [
        ('签到', '签到本 2、签字笔 10、席位图 2、桌卡 11、礼金箱 1、登记表 2、号码贴 1、计算器 1、锁 1', '1箱', '签到组', '礼金箱双人保管'),
        ('迎宾', '指示牌 6、迎宾牌 1、合影道具 1 套、签到花艺 1 组、名片盘 1', '1箱', '迎宾组', '指示牌提前试摆'),
        ('仪式', '戒指盒 1、誓言卡 2、戒枕 1、捧花 2、胸花 8、花瓣/礼花 1、香槟塔 1、敬茶杯 8、跪垫 4', '1箱', '物资组', '礼花需酒店书面同意'),
        ('新娘', '主纱、敬酒服、婚鞋、平底鞋、丝袜、披肩、暖宝宝、针线包、别针、双面胶、吸管、纸巾、湿巾、口红、粉饼、发夹', '1箱', '伴娘 A', '按“先穿后穿”顺序放'),
        ('桌面', '酒水、喜糖、伴手礼、桌卡、菜单、姓名卡', '按桌', '物资组', '每桌一张核对表'),
        ('AV', '笔记本 2、U 盘 2、备用麦 2、音频线、转换头、充电宝、对讲机 6、电池', '1箱', 'AV', '离线播放，不依赖网络'),
        ('应急', '医药包、透明伞 20、防滑垫 2、毛巾 10、工具、现金', '1箱', '物资组', '放在化妆间固定位置'),
        ('撤场', '纸箱 10、胶带、标签、推车、清单', '1箱', '物资组', '撤场前 30 分钟到位'),
    ]
    make_table(doc, ['类别', '物资', '数量', '负责人', '备注'], rows, [1.6, 9.4, 1.6, 1.8, 1.8], font_size=7.4, header_size=7.6)

    p = add_h2(doc, 'C', '供应商确认话术：把“没问题”变成“几点到”')
    p.paragraph_format.page_break_before = True
    body(doc, 'T-1（11/21）10:00 发送，18:00 前收齐文字回复；未回复 20:00 电话；仍失联，启动备份。不要问“有没有问题”，要问具体数字。', after=5)
    callout(doc, '微信确认模板', [
        '您好，我是 11 月 22 日婚礼的总协调 ____。现在做最后确认，麻烦您用文字回复以下 6 项：',
        '1. 明天到场时间、地点、对接人；',
        '2. 到场人数、车牌号、需要几个停车位；',
        '3. 物料/设备清单，是否有缺件；',
        '4. 合同金额、已付/未付、是否有增项；',
        '5. 如遇下雨/延误/设备故障，您的备用方案是什么；',
        '6. 是否需要我们提供餐食、电源、化妆位。',
        '收到请回复“确认 + 上述信息”，谢谢。',
    ], size=8.6)
    add_h3(doc, '确认后的动作')
    bullet(doc, '把回复截图存入“供应商确认”文件夹；未确认项标红。')
    bullet(doc, '把到场时间、车牌、联系人填入表 3-7 Call Sheet。')
    bullet(doc, '把尾款金额、付款人、发票信息填入表 2-3 付款节点。')
    bullet(doc, '把备用方案写进第 4 章风险清单，指定触发条件。')

    add_h2(doc, 'D', '预算跟踪表：每周一更新')
    body(doc, '这张表用来回答三个问题：已经花了多少、还欠多少、还能花多少。建议用 Excel 维护，婚礼前每周一更新，婚礼后 T+7 结算。', after=5)
    caption(doc, '表 D-1  预算跟踪表（模板）')
    rows = [
        ('', '', '', '', '', '', '', '', ''),
        ('', '', '', '', '', '', '', '', ''),
        ('', '', '', '', '', '', '', '', ''),
        ('', '', '', '', '', '', '', '', ''),
        ('', '', '', '', '', '', '', '', ''),
        ('合计', '', '300,000', '', '', '', '', '', ''),
    ]
    make_table(doc, ['日期', '类别/项目', '预算', '合同', '已付', '未付', '变更', '余额', '备注'], rows,
               [1.4, 3.2, 1.7, 1.7, 1.7, 1.7, 1.5, 1.5, 1.8], font_size=7.4, header_size=7.5,
               aligns=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.RIGHT, WD_ALIGN_PARAGRAPH.RIGHT, WD_ALIGN_PARAGRAPH.RIGHT, WD_ALIGN_PARAGRAPH.RIGHT, WD_ALIGN_PARAGRAPH.RIGHT, WD_ALIGN_PARAGRAPH.RIGHT, WD_ALIGN_PARAGRAPH.LEFT])
    source_note(doc, '公式：余额 = 预算 − 合同 − 已确认变更；未付 = 合同 − 已付。合计行只做校验，不重复计入。')

    p = add_h2(doc, 'E', '当日随身卡：打印后对折，放进口袋/手包')
    p.paragraph_format.page_break_before = True
    body(doc, '这一页是给新人的“最小信息卡”。不需要带整本方案，只带这一页。', after=6)

    t = doc.add_table(rows=1, cols=2)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_width(t, [9.0, 7.2])
    set_table_borders(t, color=GOLD, sz=8)
    left, right = t.cell(0,0), t.cell(0,1)
    for c in (left, right):
        shade_cell(c, WARM)
        set_cell_margins(c, top=180, left=220, bottom=180, right=220)
    left.text = ''
    p = left.paragraphs[0]
    set_para(p, before=0, after=8, line=1.0)
    add_text(p, '今天的时间轴', name=HEAD_FONT, size=12, bold=True, color=BURGUNDY)
    timeline = [
        ('05:30', '起床、早餐、敷面膜'),
        ('06:00', '妆造开始；摄影拍静物'),
        ('08:08', '车队出发（不等人）'),
        ('09:15', '女方敬茶'),
        ('10:50', '到宴会厅；最后检查'),
        ('11:58', '仪式开始（硬开始）'),
        ('12:18', '开席'),
        ('12:40', '敬酒开始'),
        ('13:30', '送客、回礼'),
    ]
    for time, text in timeline:
        p = left.add_paragraph()
        set_para(p, before=0, after=5, line=1.0)
        add_text(p, time, name=HEAD_FONT, size=9.5, bold=True, color=GOLD, latin='Georgia')
        add_text(p, '   ' + text, size=9.0, color=INK)
    p = left.add_paragraph()
    set_para(p, before=10, after=0, line=1.35)
    add_text(p, '只做三件事：出现、享受、合影。', name=HEAD_FONT, size=9.0, bold=True, color=BURGUNDY)
    p = left.add_paragraph()
    set_para(p, before=2, after=0, line=1.35)
    add_text(p, '遇到任何问题，只说一句：“找总协调。”', size=8.8, color=GREY)

    right.text = ''
    p = right.paragraphs[0]
    set_para(p, before=0, after=8, line=1.0)
    add_text(p, '紧急联系', name=HEAD_FONT, size=12, bold=True, color=BURGUNDY)
    contacts = [
        ('总协调', '____________'),
        ('酒店经理', '____________'),
        ('摄影主摄', '____________'),
        ('车队队长', '____________'),
        ('最近医院', '____________'),
        ('120 / 110', '____________'),
    ]
    for role, phone in contacts:
        p = right.add_paragraph()
        set_para(p, before=0, after=6, line=1.15)
        add_text(p, role, size=8.4, color=GREY)
        add_text(p, '  ' + phone, size=8.4, color=INK)
    p = right.add_paragraph()
    set_para(p, before=12, after=2, line=1.3)
    add_text(p, '应急包位置', name=HEAD_FONT, size=9.0, bold=True, color=BURGUNDY)
    p = right.add_paragraph()
    set_para(p, before=0, after=0, line=1.3)
    add_text(p, '化妆间 / 签到台内侧', size=8.4, color=INK)
    p = right.add_paragraph()
    set_para(p, before=12, after=0, line=1.3)
    add_text(p, '戒指在伴郎口袋；\n红包在锁箱；\n手机在伴娘包里。', size=8.2, color=GREY)

    # version / disclaimer
    p = doc.add_paragraph()
    set_para(p, before=18, after=3, line=1.1)
    add_bottom_border(p, color=LINE, sz=4, space=2)
    p = doc.add_paragraph()
    set_para(p, before=2, after=0, line=1.2)
    add_text(p, '版本记录：V1.0 / 2026-11-04 / 初稿。待酒店合同、最终人数、接亲路线确认后更新 V1.1。', size=7.4, color=GREY_LIGHT)
    p = doc.add_paragraph()
    set_para(p, before=1, after=0, line=1.2)
    add_text(p, '说明：本方案为执行建议，不替代酒店/供应商合同；价格随市场变化，以合同为准。涉及医疗、法律事项，请咨询专业人士。', size=7.4, color=GREY_LIGHT)

# ---------- main ----------
def build(out_path='婚礼策划案_1122_100人_30万.docx', page_map=None):
    global PAGE_MAP
    if page_map:
        PAGE_MAP = page_map
    doc = Document()
    # normal style
    st = doc.styles['Normal']
    st.font.name = LATIN_FONT
    st.font.size = Pt(10.5)
    st.font.color.rgb = rgb(INK)
    rPr = st.element.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rPr.append(rFonts)
    rFonts.set(qn('w:ascii'), LATIN_FONT)
    rFonts.set(qn('w:hAnsi'), LATIN_FONT)
    rFonts.set(qn('w:eastAsia'), BODY_FONT)
    rFonts.set(qn('w:cs'), LATIN_FONT)
    st.paragraph_format.line_spacing = 1.5
    st.paragraph_format.space_after = Pt(6)

    cp = doc.core_properties
    cp.title = '婚礼策划案｜100 位宾客 · 30 万元总预算 · 2026.11.22'
    cp.subject = '婚礼当日流程、分项预算、分工表与风险预案'
    cp.author = '婚礼策划组'
    cp.keywords = '婚礼策划, 100人, 30万, 流程, 预算, 分工, 风险预案'
    cp.comments = 'V1.0 / 2026-11-04'

    build_cover(doc)
    build_front_matter(doc)
    build_toc(doc)

    # body section
    sec = doc.add_section(WD_SECTION.NEW_PAGE)
    set_section_a4(sec)
    setup_header_footer(sec)
    set_page_numbering(sec, 'decimal', 1)

    chapter_1(doc)
    chapter_2(doc)
    chapter_3(doc)
    chapter_4(doc)
    appendices(doc)

    # update fields on open
    settings = doc.settings.element
    updateFields = settings.find(qn('w:updateFields'))
    if updateFields is None:
        updateFields = OxmlElement('w:updateFields')
        settings.append(updateFields)
    updateFields.set(qn('w:val'), 'true')

    doc.save(out_path)
    return out_path

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '婚礼策划案_1122_100人_30万.docx'
    build(out)
    print('saved', out)
