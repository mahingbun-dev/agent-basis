from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.properties import PageSetupProperties
from openpyxl.workbook.properties import CalcProperties
from openpyxl.formatting.rule import FormulaRule
from openpyxl.chart import BarChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.marker import DataPoint
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.drawing.line import LineProperties
from openpyxl.chart.text import RichText
from openpyxl.drawing.text import Paragraph, ParagraphProperties, CharacterProperties
from openpyxl.worksheet.datavalidation import DataValidation

OUT = "五周年庆典场地比选_含AV总价对比_2026-11-04.xlsx"

# ---------- palette ----------
NAVY = "17324D"
NAVY_2 = "244A66"
GOLD = "B07A45"
GOLD_LIGHT = "F3E7D3"
CREAM = "FBF8F1"
SAGE = "E5EFE9"
SAGE_DARK = "2F6B52"
CORAL = "F8E4DE"
CORAL_DARK = "9E3F2F"
INK = "1F2933"
MUTED = "66727C"
LINE = "D8D2C7"
WHITE = "FFFFFF"
SOFT_GRAY = "F4F5F4"
PALE_BLUE = "EAF1F6"

FONT = "Hiragino Sans GB"
NUM_FONT = "Avenir Next"

thin = Side(style="thin", color=LINE)
medium = Side(style="medium", color=NAVY)
hair = Side(style="hair", color=LINE)


def fill(color):
    return PatternFill("solid", fgColor=color)


def font(size=11, bold=False, color=INK, name=FONT, italic=False, underline=None):
    return Font(name=name, size=size, bold=bold, color=color, italic=italic, underline=underline)


def align(h="left", v="center", wrap=True, indent=0):
    return Alignment(horizontal=h, vertical=v, wrap_text=wrap, indent=indent)


def border(left=thin, right=thin, top=thin, bottom=thin):
    return Border(left=left, right=right, top=top, bottom=bottom)


def cell(ws, r, c, value=None, f=None, fl=None, b=None, al=None, fmt=None):
    x = ws.cell(row=r, column=c)
    if value is not None:
        x.value = value
    if f is not None:
        x.font = f
    if fl is not None:
        x.fill = fl
    if b is not None:
        x.border = b
    if al is not None:
        x.alignment = al
    if fmt is not None:
        x.number_format = fmt
    return x


def merge(ws, r1, c1, r2, c2, value=None, f=None, fl=None, al=None, outline=True):
    ws.merge_cells(start_row=r1, start_column=c1, end_row=r2, end_column=c2)
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            x = ws.cell(row=r, column=c)
            if fl:
                x.fill = fl
            if al:
                x.alignment = al
            if outline:
                left = medium if c == c1 else hair
                right = medium if c == c2 else hair
                top = medium if r == r1 else hair
                bottom = medium if r == r2 else hair
                x.border = border(left, right, top, bottom)
    x = ws.cell(row=r1, column=c1)
    if value is not None:
        x.value = value
    if f:
        x.font = f
    return x


def page(ws, area, orientation="landscape", fit_w=1, fit_h=1, tab=NAVY):
    ws.print_area = area
    ws.page_setup.orientation = orientation
    ws.page_setup.paperSize = 9  # A4
    ws.page_setup.fitToWidth = fit_w
    ws.page_setup.fitToHeight = fit_h
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.print_options.horizontalCentered = True
    ws.print_options.verticalCentered = False
    ws.page_margins.left = 0.35
    ws.page_margins.right = 0.35
    ws.page_margins.top = 0.45
    ws.page_margins.bottom = 0.42
    ws.page_margins.header = 0.2
    ws.page_margins.footer = 0.2
    ws.oddFooter.left.text = "五周年庆典场地比选 · V1.0"
    ws.oddFooter.left.size = 8
    ws.oddFooter.left.color = MUTED
    ws.oddFooter.right.text = "第 &[Page] 页 / 共 &[Pages] 页"
    ws.oddFooter.right.size = 8
    ws.oddFooter.right.color = MUTED
    ws.sheet_properties.tabColor = tab
    ws.sheet_view.showGridLines = False
    ws.sheet_view.zoomScale = 90


def section(ws, r, c1, c2, label, note=""):
    # Do not merge: allows the label to overflow naturally and the note to sit right.
    x = ws.cell(row=r, column=c1, value=label)
    x.font = font(10.5, True, NAVY)
    x.alignment = Alignment(horizontal="left", vertical="center", wrap_text=False)
    if note:
        y = ws.cell(row=r, column=c2, value=note)
        y.font = font(8.8, False, MUTED)
        y.alignment = Alignment(horizontal="right", vertical="center", wrap_text=False)
    for c in range(c1, c2 + 1):
        ws.cell(row=r, column=c).border = Border(bottom=Side(style="medium", color=GOLD))


wb = Workbook()
wb.calculation = CalcProperties(calcMode="auto", fullCalcOnLoad=True, forceFullCalc=True)
wb.properties.creator = "场地比选"
wb.properties.title = "五周年庆典场地比选：含 AV 总价对比"
wb.properties.subject = "开元厅、洲际厅、万豪厅三选一"
wb.properties.description = "基于 2026-11-04 需求方询价记录，统一折算为含 AV 总价。"
wb.properties.keywords = "场地比选, 五周年, AV, 报价对比, 推荐"

# =====================================================================
# Sheet 1 — 比选总览
# =====================================================================
ws = wb.active
ws.title = "比选总览"
widths = {"A": 15, "B": 13, "C": 19.5, "D": 11.5, "E": 14.5, "F": 14.5, "G": 10.5, "H": 8.5, "I": 27}
for col, w in widths.items():
    ws.column_dimensions[col].width = w

ws.row_dimensions[1].height = 4
merge(ws, 2, 1, 2, 9, "五周年庆典 · 场地报价比选", font(24, True, WHITE), fill(NAVY), align("left", "center", False))
ws.row_dimensions[2].height = 42
for c in range(1, 10):
    ws.cell(row=2, column=c).fill = fill(NAVY)
merge(ws, 3, 1, 3, 9, "统一口径：含 AV 总价（万元）　｜　币种：人民币　｜　记录日期：2026-11-04　｜　用途：内部决策", font(10, False, WHITE), fill(NAVY_2), align("left", "center", False))
ws.row_dimensions[3].height = 22
for c in range(1, 10):
    ws.cell(row=3, column=c).fill = fill(NAVY_2)

ws.row_dimensions[4].height = 4

merge(ws, 5, 1, 5, 6, "首选  开元厅  ·  含 AV 8.8 万", font(15, True, WHITE), fill(GOLD), align("left", "center", False), outline=False)
merge(ws, 5, 7, 5, 9, "备选  万豪厅  ·  9.5 万", font(12, True, GOLD), fill(GOLD_LIGHT), align("center", "center", False), outline=False)
ws.row_dimensions[5].height = 40
# clear side borders, add bottom rules only
for c in range(1, 7):
    ws.cell(row=5, column=c).border = Border(bottom=Side(style="medium", color=GOLD))
for c in range(7, 10):
    ws.cell(row=5, column=c).border = Border(bottom=Side(style="medium", color=GOLD))

ws.row_dimensions[6].height = 4

merge(ws, 7, 1, 7, 2, "结论先行", font(10, True, GOLD), None, align("left"), outline=False)
ws.row_dimensions[7].height = 18
conclusion = ("在场地容量、档期与 AV 配置均满足庆典要求、且三家报价口径一致的前提下，推荐开元厅。"
              "其含 AV 总价 8.8 万元为三家最低，比万豪厅低 0.7 万元，比洲际厅低 2.6 万元；且 AV 已含，后续增项与供应商协调更少。")
merge(ws, 8, 1, 10, 9, conclusion, font(11, False, INK), fill(CREAM), align("left", "top"), outline=False)
for r in range(8, 11):
    ws.row_dimensions[r].height = 18
for r in range(8, 11):
    for c in range(1, 10):
        ws.cell(row=r, column=c).fill = fill(CREAM)
# left accent
for r in range(8, 11):
    ws.cell(row=r, column=1).border = Border(left=Side(style="thick", color=GOLD))
for c in range(1, 10):
    ws.cell(row=11, column=c).border = Border(bottom=Side(style="thin", color=LINE))

ws.row_dimensions[11].height = 4

headers = ["场地", "原报价\n（万元）", "AV 口径", "AV 费用\n（万元）", "含 AV 总价\n（万元）", "较最低价\n差额（万元）", "较最低价\n溢价", "总价\n排名", "报价来源"]
for c, h in enumerate(headers, 1):
    x = cell(ws, 12, c, h, font(9.5, True, WHITE), fill(NAVY), border(), align("center", "center", True))
    x.border = Border(left=Side(style="thin", color=NAVY_2), right=Side(style="thin", color=NAVY_2), bottom=Side(style="medium", color=GOLD))
ws.row_dimensions[12].height = 34

rows = [
    ("开元厅", 8.8, "含 AV", 0, "S1｜对话询价", "#'报价来源'!A6"),
    ("洲际厅", 10.2, "不含，另计", 1.2, "S2｜对话询价", "#'报价来源'!A7"),
    ("万豪厅", 9.5, "含 AV", 0, "S3｜对话询价", "#'报价来源'!A8"),
]
for i, (name, base, av_mode, av_cost, src, link) in enumerate(rows, 13):
    row_fill = SAGE if name == "开元厅" else (WHITE if name == "洲际厅" else CREAM)
    cell(ws, i, 1, name, font(11.5, True, INK), fill(row_fill), border(), align("center"))
    cell(ws, i, 2, base, font(11, False, INK, NUM_FONT), fill(row_fill), border(), align("right"), "0.00")
    cell(ws, i, 3, av_mode, font(10, False, INK), fill(row_fill), border(), align("center"))
    cell(ws, i, 4, av_cost, font(11, False, INK, NUM_FONT), fill(row_fill), border(), align("right"), "0.00")
    cell(ws, i, 5, f"=B{i}+D{i}", font(12, name == "开元厅", SAGE_DARK if name == "开元厅" else INK, NUM_FONT), fill(row_fill), border(), align("right"), "0.00")
    cell(ws, i, 6, f"=E{i}-MIN($E$13:$E$15)", font(10.5, False, MUTED, NUM_FONT), fill(row_fill), border(), align("right"), "0.00")
    cell(ws, i, 7, f"=E{i}/MIN($E$13:$E$15)-1", font(10.5, False, MUTED, NUM_FONT), fill(row_fill), border(), align("center"), "0.0%")
    cell(ws, i, 8, f"=RANK(E{i},$E$13:$E$15,1)", font(11, True, INK, NUM_FONT), fill(row_fill), border(), align("center"), "0")
    x = cell(ws, i, 9, src, font(9.5, False, NAVY, FONT, underline="single"), fill(row_fill), border(), align("left"))
    x.hyperlink = link
    ws.row_dimensions[i].height = 31

# highlight lowest total
ws.conditional_formatting.add("E13:E15", FormulaRule(formula=["$E13=MIN($E$13:$E$15)"], fill=fill("D9EADF"), font=Font(name=NUM_FONT, bold=True, color=SAGE_DARK)))

merge(ws, 16, 1, 16, 9, "来源：S1/S2/S3 均逐字取自需求方 2026-11-04 询价记录；三家均未提供书面报价单。点击来源单元格可查看原文。", font(8.5, False, MUTED), fill(SOFT_GRAY), align("left"), outline=False)
for c in range(1, 10):
    ws.cell(row=16, column=c).fill = fill(SOFT_GRAY)
    ws.cell(row=16, column=c).border = Border(top=Side(style="hair", color=LINE), bottom=Side(style="hair", color=LINE))
ws.row_dimensions[16].height = 22

ws.row_dimensions[17].height = 4

section(ws, 18, 1, 9, "推荐理由", "为什么不是简单选“最低价”")
ws.row_dimensions[18].height = 22

cards = [
    ("01  价格最低，且 AV 已含", "8.8 万", "比洲际低 2.6 万、比万豪低 0.7 万；AV 已含。", SAGE, SAGE_DARK),
    ("02  洲际的价格缺口难靠 AV 抹平", "10.2 万", "即使 1.2 万 AV 全免，仍高于开元 1.4 万、万豪 0.7 万。", CORAL, CORAL_DARK),
    ("03  备选路径清楚", "+0.7 万", "若开元容量/档期/AV 不达标，万豪是低风险备选。", PALE_BLUE, NAVY),
]
starts = [(1, 3), (4, 6), (7, 9)]
for (c1, c2), (title, big, body, bg, fg) in zip(starts, cards):
    merge(ws, 19, c1, 19, c2, title, font(9.2, True, fg), fill(bg), align("left"), outline=False)
    merge(ws, 20, c1, 20, c2, big, font(22, True, fg, NUM_FONT), fill(bg), align("left"), outline=False)
    merge(ws, 21, c1, 22, c2, body, font(9, False, INK), fill(bg), align("left", "top"), outline=False)
    # box outline
    for r in range(19, 23):
        for c in range(c1, c2 + 1):
            ws.cell(row=r, column=c).fill = fill(bg)
            ws.cell(row=r, column=c).border = Border(
                left=Side(style="medium", color=fg) if c == c1 else None,
                right=Side(style="medium", color=fg) if c == c2 else None,
                top=Side(style="medium", color=fg) if r == 19 else None,
                bottom=Side(style="medium", color=fg) if r == 22 else None,
            )
for r in range(19, 23):
    ws.row_dimensions[r].height = 18
ws.row_dimensions[20].height = 29
ws.row_dimensions[22].height = 24

ws.row_dimensions[23].height = 4
section(ws, 24, 1, 9, "适用边界（先确认，再签约）", "本页是价格决策，不是场地尽调")
ws.row_dimensions[24].height = 22

caveats = [
    ("价格边界", "仅比较报价，不含容量、层高、地段、餐饮、服务、品牌等非价格因素；这些需现场考察后再定。"),
    ("口径边界", "三家均无书面报价单；含税/发票、服务费、最低消费、押金、超时费、搭建费等未说明，暂按相同口径测算。"),
    ("决策边界", "结论以开元厅容量、档期、AV 配置均满足需求为前提；任一项不达标，转万豪，不以 0.7 万价差牺牲交付。"),
]
for i, (label, text) in enumerate(caveats, 25):
    merge(ws, i, 1, i, 2, label, font(9.2, True, GOLD), None, align("left"), outline=False)
    merge(ws, i, 3, i, 9, text, font(9, False, INK), None, align("left"), outline=False)
    for c in range(1, 10):
        ws.cell(row=i, column=c).border = Border(bottom=Side(style="hair", color=LINE))
    ws.row_dimensions[i].height = 23

merge(ws, 28, 1, 28, 9, "注：金额单位均为人民币万元；最终以盖章/邮件报价单及正式合同为准。编制 V1.0 · 2026-11-04。", font(8, False, MUTED), None, align("left"), outline=False)
ws.row_dimensions[28].height = 16

page(ws, "A1:I28", "landscape", 1, 1, GOLD)
ws.freeze_panes = "A13"
ws.auto_filter.ref = "A12:I15"
ws.sheet_view.selection[0].activeCell = "A1"
ws.sheet_view.selection[0].sqref = "A1"

# =====================================================================
# Sheet 2 — 测算明细
# =====================================================================
ws2 = wb.create_sheet("测算明细")
for col, w in {"A": 30, "B": 16, "C": 16, "D": 16, "E": 3, "F": 26}.items():
    ws2.column_dimensions[col].width = w
ws2.row_dimensions[1].height = 6
merge(ws2, 2, 1, 2, 6, "测算明细 · 从原报价到含 AV 总价", font(20, True, WHITE), fill(NAVY), align("left"), outline=False)
ws2.row_dimensions[2].height = 42
for c in range(1, 7):
    ws2.cell(row=2, column=c).fill = fill(NAVY)
merge(ws2, 3, 1, 3, 6, "只做一件事：把三家不同的 AV 口径，拉到同一张价格尺上。", font(10, False, WHITE), fill(NAVY_2), align("left"), outline=False)
ws2.row_dimensions[3].height = 24
for c in range(1, 7):
    ws2.cell(row=3, column=c).fill = fill(NAVY_2)
ws2.row_dimensions[4].height = 8

section(ws2, 5, 1, 6, "统一折算表", "单位：万元")
ws2.row_dimensions[5].height = 22
heads2 = ["测算项目", "开元厅", "洲际厅", "万豪厅", "", "计算说明"]
for c, h in enumerate(heads2, 1):
    if c == 5:
        continue
    cell(ws2, 6, c, h, font(9.5, True, WHITE), fill(NAVY), border(), align("center"))
ws2.row_dimensions[6].height = 30

# merged F? No, 6 columns with E spacer, F note. For data, merge F? layout A-D data, F note.
# Since E is a narrow spacer, merge F6 only. We'll use A-D, F.
ws2.merge_cells("F6:F6")
calc_rows = [
    ("原报价", 8.8, 10.2, 9.5, "按原报价口径；开元、万豪已含 AV，洲际不含。"),
    ("AV 费用", 0, 1.2, 0, "仅洲际另计 1.2 万；其余按 0 计入。"),
]
for i, (label, a, b, c, note) in enumerate(calc_rows, 7):
    cell(ws2, i, 1, label, font(10, False, INK), fill(WHITE), border(), align("left"))
    cell(ws2, i, 2, a, font(10.5, False, INK, NUM_FONT), fill(WHITE), border(), align("right"), "0.00")
    cell(ws2, i, 3, b, font(10.5, False, INK, NUM_FONT), fill(WHITE), border(), align("right"), "0.00")
    cell(ws2, i, 4, c, font(10.5, False, INK, NUM_FONT), fill(WHITE), border(), align("right"), "0.00")
    cell(ws2, i, 6, note, font(8.8, False, MUTED), fill(WHITE), border(), align("left"))
    ws2.row_dimensions[i].height = 30

# total
cell(ws2, 9, 1, "含 AV 总价", font(11, True, WHITE), fill(GOLD), border(), align("left"))
for c, v in [(2, "=B7+B8"), (3, "=C7+C8"), (4, "=D7+D8")]:
    cell(ws2, 9, c, v, font(12, True, WHITE, NUM_FONT), fill(GOLD), border(), align("right"), "0.00")
cell(ws2, 9, 6, "计算：原报价 + AV 费用；唯一比价口径。", font(9, True, WHITE), fill(GOLD), border(), align("left"))
ws2.row_dimensions[9].height = 36

cell(ws2, 10, 1, "总价排名", font(10, False, INK), fill(WHITE), border(), align("left"))
for c, v in [(2, "=RANK(B9,$B$9:$D$9,1)"), (3, "=RANK(C9,$B$9:$D$9,1)"), (4, "=RANK(D9,$B$9:$D$9,1)")]:
    cell(ws2, 10, c, v, font(10.5, True, INK, NUM_FONT), fill(WHITE), border(), align("center"), "0")
cell(ws2, 10, 6, "1 = 最低；并列时按同排名处理。", font(8.8, False, MUTED), fill(WHITE), border(), align("left"))
ws2.row_dimensions[10].height = 26

cell(ws2, 11, 1, "较最低价差额", font(10, False, INK), fill(WHITE), border(), align("left"))
for c in [2, 3, 4]:
    col = get_column_letter(c)
    cell(ws2, 11, c, f"={col}9-MIN($B$9:$D$9)", font(10.5, False, MUTED, NUM_FONT), fill(WHITE), border(), align("right"), "+0.00;-0.00;0.00")
cell(ws2, 11, 6, "0 为最低价；正数为相对最低价的溢价。", font(8.8, False, MUTED), fill(WHITE), border(), align("left"))
ws2.row_dimensions[11].height = 26

# note under table
merge(ws2, 12, 1, 12, 6, "读法：AV 归一化没有改变名次，但把洲际与开元的差距从 1.4 万扩大到 2.6 万。", font(9.5, True, GOLD), fill(CREAM), align("left"), outline=False)
for c in range(1, 7):
    ws2.cell(row=12, column=c).fill = fill(CREAM)
    ws2.cell(row=12, column=c).border = Border(left=Side(style="medium", color=GOLD) if c == 1 else None, right=Side(style="medium", color=GOLD) if c == 6 else None, top=Side(style="medium", color=GOLD), bottom=Side(style="medium", color=GOLD))
ws2.row_dimensions[12].height = 28

ws2.row_dimensions[13].height = 8
section(ws2, 14, 1, 6, "价格对比图", "含 AV 总价（万元）")
ws2.row_dimensions[14].height = 22

chart = BarChart()
chart.type = "bar"
chart.style = 10
chart.title = "含 AV 总价对比"
chart.y_axis.title = "万元"
chart.x_axis.title = None
chart.height = 7.2
chart.width = 17.5
data = Reference(ws2, min_col=2, max_col=4, min_row=9, max_row=9)
cats = Reference(ws2, min_col=2, max_col=4, min_row=6, max_row=6)
chart.add_data(data, from_rows=True, titles_from_data=False)
chart.set_categories(cats)
chart.legend = None
chart.y_axis.scaling.min = 0
chart.y_axis.scaling.max = 14
chart.y_axis.majorUnit = 2
chart.y_axis.numFmt = "0"
chart.x_axis.delete = False
chart.y_axis.delete = False
chart.y_axis.majorGridlines.spPr = GraphicalProperties(ln=LineProperties(solidFill="E3E0D8", w=0.75))
chart.y_axis.spPr = GraphicalProperties(ln=LineProperties(solidFill=LINE, w=0.75))
chart.x_axis.spPr = GraphicalProperties(ln=LineProperties(solidFill=LINE, w=0.75))
chart.dataLabels = DataLabelList()
chart.dataLabels.showVal = True
chart.dataLabels.showSerName = False
chart.dataLabels.showCatName = False
chart.dataLabels.showLegendKey = False
chart.dataLabels.showPercent = False
chart.dataLabels.showBubbleSize = False
chart.dataLabels.showLeaderLines = False
chart.dataLabels.numFmt = '0.00"万"'
chart.dataLabels.position = "outEnd"
chart.dataLabels.spPr = GraphicalProperties(noFill=True)
chart.dataLabels.txPr = RichText(
    bodyPr=None,
    lstStyle=None,
    p=[Paragraph(pPr=ParagraphProperties(defRPr=CharacterProperties(sz=1000, b=True, solidFill=INK)), endParaRPr=CharacterProperties(sz=1000))],
)
chart.gapWidth = 55

# color each point
series = chart.series[0]
point_colors = [SAGE_DARK, CORAL_DARK, GOLD]
for idx, colr in enumerate(point_colors):
    pt = DataPoint(idx=idx)
    pt.graphicalProperties = GraphicalProperties(solidFill=colr)
    pt.graphicalProperties.line = LineProperties(solidFill=colr)
    series.data_points.append(pt)

chart.plot_area.graphicalProperties = GraphicalProperties(solidFill=WHITE)
ws2.add_chart(chart, "B15")

# sensitivity section below chart
section(ws2, 32, 1, 6, "关键情景", "用临界值检验结论稳不稳")
ws2.row_dimensions[32].height = 22
scen_head = ["情景", "含 AV 总价", "与开元差额", "判断"]
for c, h in enumerate(scen_head, 1):
    cell(ws2, 33, c, h, font(9, True, WHITE), fill(NAVY), border(), align("center"))
ws2.row_dimensions[33].height = 28
scen = [
    ("基准：三家按现报价", "8.8 / 11.4 / 9.5", "—", "开元最低，万豪次之，洲际最高。"),
    ("洲际 AV 全免", "10.2", "+1.4", "仍高于开元，也高于万豪；价格维度无翻盘。"),
    ("洲际 AV 减半（0.6）", "10.8", "+2.0", "仍第三；AV 谈判只能缩小差距，不能改变排序。"),
]
for i, (a, b, c, d) in enumerate(scen, 34):
    fillc = WHITE if i % 2 == 0 else CREAM
    cell(ws2, i, 1, a, font(9, False, INK), fill(fillc), border(), align("left"))
    cell(ws2, i, 2, b, font(9, False, INK, NUM_FONT), fill(fillc), border(), align("center"))
    cell(ws2, i, 3, c, font(9, False, MUTED, NUM_FONT), fill(fillc), border(), align("center"))
    merge(ws2, i, 4, i, 6, d, font(9, False, INK), fill(fillc), align("left"))
    ws2.row_dimensions[i].height = 27

merge(ws2, 38, 1, 38, 6, "临界值：洲际要追平开元，需在免掉全部 1.2 万 AV 后，场租再降 1.4 万；仅免 AV 不够。", font(8.8, False, MUTED), None, align("left"), outline=False)
ws2.row_dimensions[38].height = 20
page(ws2, "A1:F38", "portrait", 1, 2, GOLD)

# =====================================================================
# Sheet 3 — 报价来源
# =====================================================================
ws3 = wb.create_sheet("报价来源")
for col, w in {"A": 8, "B": 12, "C": 43, "D": 20, "E": 18, "F": 16, "G": 10, "H": 18, "I": 22}.items():
    ws3.column_dimensions[col].width = w
ws3.row_dimensions[1].height = 6
merge(ws3, 2, 1, 2, 9, "报价来源 · 逐条可追溯", font(20, True, WHITE), fill(NAVY), align("left"), outline=False)
ws3.row_dimensions[2].height = 42
for c in range(1, 10):
    ws3.cell(row=2, column=c).fill = fill(NAVY)
merge(ws3, 3, 1, 3, 9, "原则：只引用已收到的询价原文，不用公开网页价格替代或补全，避免场地、档期、配置不一致。", font(9.5, False, WHITE), fill(NAVY_2), align("left"), outline=False)
ws3.row_dimensions[3].height = 24
for c in range(1, 10):
    ws3.cell(row=3, column=c).fill = fill(NAVY_2)
ws3.row_dimensions[4].height = 8

section(ws3, 5, 1, 9, "逐条来源", "编号 S1–S3 对应总览页引用")
ws3.row_dimensions[5].height = 22
heads3 = ["编号", "场地", "报价原文（逐字摘录）", "来源类型", "记录时间", "提供方", "书面附件", "核验状态", "本表用途"]
for c, h in enumerate(heads3, 1):
    cell(ws3, 6, c, h, font(9, True, WHITE), fill(NAVY), border(), align("center"))
ws3.row_dimensions[6].height = 30

sources = [
    ("S1", "开元厅", "开元厅报价 8.8 万(含 AV)", "需求方对话询价", "2026-11-04", "需求方（本会话）", "无", "待书面报价确认", "总价测算 / 首选推荐"),
    ("S2", "洲际厅", "洲际厅 10.2 万(不含 AV,AV 另需 1.2 万)", "需求方对话询价", "2026-11-04", "需求方（本会话）", "无", "待书面报价确认", "AV 折算 / 价格对比"),
    ("S3", "万豪厅", "万豪厅 9.5 万(含 AV)", "需求方对话询价", "2026-11-04", "需求方（本会话）", "无", "待书面报价确认", "总价测算 / 备选推荐"),
]
for i, row in enumerate(sources, 7):
    fillc = SAGE if row[0] == "S1" else (WHITE if row[0] == "S2" else CREAM)
    for c, v in enumerate(row, 1):
        al = "center" if c in [1, 2, 5, 6, 7, 8] else "left"
        f = font(9, False, INK)
        if c == 1:
            f = font(10, True, SAGE_DARK if row[0] == "S1" else GOLD)
        if c == 3:
            f = font(9, False, INK)
        cell(ws3, i, c, v, f, fill(fillc), border(), align(al, "center"))
    ws3.row_dimensions[i].height = 54

merge(ws3, 10, 1, 10, 9, "完整上下文（需求方原文）", font(9, True, GOLD), None, align("left"), outline=False)
ws3.row_dimensions[10].height = 24
quote = ("五周年庆典场地三家候选:开元厅报价 8.8 万(含 AV)、洲际厅 10.2 万(不含 AV,AV 另需 1.2 万)、万豪厅 9.5 万(含 AV)。")
merge(ws3, 11, 1, 13, 9, quote, font(11, False, INK), fill(CREAM), align("left"), outline=False)
for r in range(11, 14):
    ws3.row_dimensions[r].height = 23
    for c in range(1, 10):
        ws3.cell(row=r, column=c).fill = fill(CREAM)
for r in range(11, 14):
    ws3.cell(row=r, column=1).border = Border(left=Side(style="thick", color=GOLD))
for c in range(1, 10):
    ws3.cell(row=14, column=c).border = Border(bottom=Side(style="thin", color=LINE))

section(ws3, 15, 1, 9, "引用与核验说明", "当前证据等级：对话询价")
ws3.row_dimensions[15].height = 22
notes = [
    "1. 三家价格均来自同一段需求描述，未从公开网络补价，也未把不同场地、不同档期的价格混用。",
    "2. 三家均未提供书面报价单；含税/发票、服务费、最低消费、押金、超时费、搭建费等口径未说明。",
    "3. 金额均为人民币万元；AV 费用按总额 1.2 万计入，具体设备清单与技术人员配置未提供。",
    "4. 推荐结论以开元厅容量、档期、AV 配置均满足需求为前提；否则转万豪，不因 0.7 万价差牺牲交付。",
    "5. 正式决策前，应取得盖章或邮件报价单，并把“含 AV 总价”和增项审批写进合同。",
]
for i, t in enumerate(notes, 16):
    merge(ws3, i, 1, i, 9, t, font(8.8, False, INK), None, align("left"), outline=False)
    for c in range(1, 10):
        ws3.cell(row=i, column=c).border = Border(bottom=Side(style="hair", color=LINE))
    ws3.row_dimensions[i].height = 22

section(ws3, 22, 1, 9, "待补书面材料", "拿到后再更新本表，不凭口头价签约")
ws3.row_dimensions[22].height = 22
materials = [
    ("01", "三家盖章/邮件报价单（含报价有效期）", "把口头价变成可追责的书面价。"),
    ("02", "含税、发票类型与服务费说明", "避免“低价中标、落地加价”。"),
    ("03", "AV 设备清单与技术人员配置", "确认“含 AV”到底含什么、含多久。"),
    ("04", "场地平面图、容量与摆台方案", "验证开元厅是否装得下实际来宾与舞台。"),
    ("05", "档期保留、定金与取消/改期条款", "锁定日期，明确退款阶梯。"),
    ("06", "餐饮最低消费及酒水政策", "把餐饮从“另算”变成总预算的一部分。"),
]
for i, (num, item, why) in enumerate(materials, 23):
    cell(ws3, i, 1, num, font(9, True, GOLD, NUM_FONT), fill(WHITE), border(), align("center"))
    merge(ws3, i, 2, i, 4, item, font(9, False, INK), fill(WHITE), align("left"))
    merge(ws3, i, 5, i, 9, why, font(8.8, False, MUTED), fill(WHITE), align("left"))
    ws3.row_dimensions[i].height = 28

merge(ws3, 30, 1, 30, 9, "引用格式：S1（开元厅）/ S2（洲际厅）/ S3（万豪厅），对应本页编号；金额与原文不一致时，以书面报价单为准。", font(8, False, MUTED), None, align("left"), outline=False)
ws3.row_dimensions[30].height = 18
page(ws3, "A1:I30", "landscape", 1, 1, NAVY)
ws3.freeze_panes = "A7"

# =====================================================================
# Sheet 4 — 签约核对清单
# =====================================================================
ws4 = wb.create_sheet("签约核对清单")
for col, w in {"A": 6, "B": 22, "C": 54, "D": 9, "E": 16, "F": 12}.items():
    ws4.column_dimensions[col].width = w
ws4.row_dimensions[1].height = 6
merge(ws4, 2, 1, 2, 6, "签约前核对清单 · 以开元厅为首选", font(20, True, WHITE), fill(NAVY), align("left"), outline=False)
ws4.row_dimensions[2].height = 42
for c in range(1, 7):
    ws4.cell(row=2, column=c).fill = fill(NAVY)
merge(ws4, 3, 1, 3, 6, "目标：把“8.8 万含 AV”从一句报价，变成可执行、可追责的合同条款。", font(9.5, False, WHITE), fill(NAVY_2), align("left"), outline=False)
ws4.row_dimensions[3].height = 24
for c in range(1, 7):
    ws4.cell(row=3, column=c).fill = fill(NAVY_2)
ws4.row_dimensions[4].height = 8

section(ws4, 5, 1, 6, "核对项", "建议在付定金前完成")
ws4.row_dimensions[5].height = 22
heads4 = ["#", "核对项", "具体核对要点", "优先级", "责任方", "状态"]
for c, h in enumerate(heads4, 1):
    cell(ws4, 6, c, h, font(9, True, WHITE), fill(NAVY), border(), align("center"))
ws4.row_dimensions[6].height = 30

checks = [
    ("场地容量与摆台", "按实际来宾人数复核圆桌/剧院/酒会容量；确认舞台、签到区、通道与疏散宽度。", "高", "筹备组"),
    ("档期与使用时长", "确认活动、搭建、彩排、撤场时段；把免费时长与超时费写进合同。", "高", "筹备组"),
    ("AV 清单（重点）", "把“含 AV”拆到 LED/投影、音响、麦克风、灯光、控台、技术人员与备用设备。", "高", "筹备组"),
    ("总价含税与发票", "确认 8.8 万是否含税、发票类型与税率；是否另收服务费。", "高", "财务"),
    ("餐饮最低消费", "确认最低消费、菜单、酒水、开瓶费与服务费；避免餐饮另算击穿预算。", "高", "筹备组"),
    ("付款与押金", "确认定金比例、尾款节点、押金金额与退还条件。", "中", "财务"),
    ("取消与改期", "明确不可抗力、改期与取消的退款阶梯，保留书面记录。", "高", "法务/筹备组"),
    ("进场与搭建", "确认进场费、清洁费、电力增容、吊点限制与搭建时间。", "中", "执行团队"),
    ("网络与直播", "确认带宽、专线、直播电力、机位与备用网络。", "中", "执行团队"),
    ("停车与嘉宾动线", "确认停车位、电梯、签到区、指示牌与无障碍通道。", "中", "接待组"),
    ("合同增项条款", "增项须书面确认并设总价上限；口头承诺不算数。", "高", "法务"),
    ("现场负责人", "确认活动当天场地对接人、应急联系人、备用设备清单。", "中", "筹备组"),
]
for i, (item, detail, pri, owner) in enumerate(checks, 7):
    fillc = WHITE if i % 2 == 1 else CREAM
    cell(ws4, i, 1, i - 6, font(9, True, MUTED, NUM_FONT), fill(fillc), border(), align("center"))
    cell(ws4, i, 2, item, font(9.5, True, INK), fill(fillc), border(), align("left"))
    cell(ws4, i, 3, detail, font(8.8, False, INK), fill(fillc), border(), align("left"))
    cell(ws4, i, 4, pri, font(9, True, CORAL_DARK if pri == "高" else GOLD), fill(fillc), border(), align("center"))
    cell(ws4, i, 5, owner, font(8.8, False, MUTED), fill(fillc), border(), align("center"))
    cell(ws4, i, 6, "待确认", font(8.8, False, MUTED), fill(fillc), border(), align("center"))
    ws4.row_dimensions[i].height = 34

# data validation for status
dv = DataValidation(type="list", formula1='"待确认,已确认,不适用,有风险"', allow_blank=False)
ws4.add_data_validation(dv)
dv.add("F7:F18")

merge(ws4, 19, 1, 19, 6, "提醒：以上 12 项全部“已确认/不适用”后，再付定金。任何一项“有风险”，先回到比选表重算总价。", font(9, True, GOLD), fill(CREAM), align("left"), outline=False)
for c in range(1, 7):
    ws4.cell(row=19, column=c).fill = fill(CREAM)
    ws4.cell(row=19, column=c).border = Border(left=Side(style="medium", color=GOLD) if c == 1 else None, right=Side(style="medium", color=GOLD) if c == 6 else None, top=Side(style="medium", color=GOLD), bottom=Side(style="medium", color=GOLD))
ws4.row_dimensions[19].height = 36

merge(ws4, 21, 1, 21, 6, "注：清单为通用场地核对项，未替代法务审阅；具体条款以双方签署合同为准。", font(8, False, MUTED), None, align("left"), outline=False)
ws4.row_dimensions[21].height = 18
page(ws4, "A1:F21", "landscape", 1, 1, SAGE_DARK)
ws4.freeze_panes = "A7"
ws4.auto_filter.ref = "A6:F18"

# reorder: 总览, 测算, 来源, 清单 (already)
wb.active = 0
wb.save(OUT)
print("saved", OUT)
