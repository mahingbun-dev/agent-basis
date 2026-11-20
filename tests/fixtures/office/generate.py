#!/usr/bin/env python3
"""office 三格式中文样本生成器（51 §1；54 §6.2；T47）。

生成：
  tests/fixtures/office/sample.docx —— 标题/正文/表格（中文）
  tests/fixtures/office/sample.xlsx —— 表头/数值/公式（=SUM）
  tests/fixtures/office/sample.pptx —— 两页（标题 + 要点，中文）

依赖（仅生成时；夹具产物已入库，运行验证不需要）：
  python3 -m pip install python-docx openpyxl python-pptx
用法：
  python3 tests/fixtures/office/generate.py [--out DIR]
"""
import argparse
import os
import sys

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from openpyxl import Workbook
from openpyxl.styles import Font
from pptx import Presentation
from pptx.util import Inches, Pt


def make_docx(path: str) -> None:
    doc = Document()
    title = doc.add_heading("恒灵活动策划 · 验收样本", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph("本文件用于验证 office 能力的 docx 渲染与中文不乱码。")
    doc.add_heading("一、年度预算", level=1)
    for line in (
        "场地租赁：人民币 120,000 元",
        "灯光音响：人民币 45,000 元",
        "人员餐饮：人民币 80,000 元",
    ):
        doc.add_paragraph(line, style="List Bullet")
    table = doc.add_table(rows=4, cols=3)
    table.style = "Table Grid"
    header = table.rows[0].cells
    header[0].text, header[1].text, header[2].text = "科目", "金额（元）", "占比"
    rows = [("场地", "120000", "49%"), ("灯光", "45000", "18%"), ("餐饮", "80000", "33%")]
    for index, (name, amount, ratio) in enumerate(rows, start=1):
        cells = table.rows[index].cells
        cells[0].text, cells[1].text, cells[2].text = name, amount, ratio
    doc.add_heading("二、审批红线", level=1)
    doc.add_paragraph("单笔超过 50,000 元的支出必须走双人审批；付款指令须附合同编号。")
    doc.save(path)


def make_xlsx(path: str) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "预算明细"
    ws.append(["科目", "数量", "单价（元）", "小计（元）"])
    for cell in ws[1]:
        cell.font = Font(bold=True)
    rows = [("场地租赁", 1, 120000), ("灯光音响", 2, 22500), ("人员餐饮", 4, 20000)]
    for index, (name, count, price) in enumerate(rows, start=2):
        ws.append([name, count, price, f"=B{index}*C{index}"])
    ws.append(["合计", "", "", "=SUM(D2:D4)"])
    ws.column_dimensions["A"].width = 16
    ws.column_dimensions["B"].width = 10
    ws.column_dimensions["C"].width = 12
    ws.column_dimensions["D"].width = 12
    wb.save(path)


def make_pptx(path: str) -> None:
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text = "恒灵活动策划 · 验收样本"
    slide.placeholders[1].text = "rc.5 office 能力验收（中文版式）"
    slide2 = prs.slides.add_slide(prs.slide_layouts[1])
    slide2.shapes.title.text = "年度目标"
    body = slide2.placeholders[1].text_frame
    body.text = "完成 12 场活动交付"
    for line in ("预算控制在 3,000,000 元以内", "供应商比选至少三家", "重大付款双人审批"):
        paragraph = body.add_paragraph()
        paragraph.text = line
        paragraph.font.size = Pt(20)
    slide2.shapes.add_textbox(Inches(1), Inches(5.6), Inches(6), Inches(0.6)).text_frame.text = (
        "样本仅供测试，不含真实客户信息。"
    )
    prs.save(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    make_docx(os.path.join(args.out, "sample.docx"))
    make_xlsx(os.path.join(args.out, "sample.xlsx"))
    make_pptx(os.path.join(args.out, "sample.pptx"))
    for name in ("sample.docx", "sample.xlsx", "sample.pptx"):
        path = os.path.join(args.out, name)
        print(f"{name}\t{os.path.getsize(path)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())