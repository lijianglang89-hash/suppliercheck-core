#!/usr/bin/env python3
"""
生成一份中文《供应商准入资料包》示例 PDF。

存在意义有两个，都很具体：

1) **补上中文 PDF 提取的测试缺口。**
   项目原先只能用代码合成极简 PDF，而合成 PDF 写不进中文 —— 塞进去的 UTF-16BE
   十六进制串会被 pdf.js 按 WinAnsi 逐字节读出来，得到 `O ^ UF D (`f Nf g...` 这种乱码。
   所以那条「中文提取」的断言一直是空的。这个脚本用真实字体嵌入 + 真实 CMap
   生成真 PDF，提取路径和真实业务文件一致。

2) **给产品演示一份可用的样例资料。**
   内容是「结构/五金件供应商准入」的常见材料：企业信息、资质认证、报价单、商务条款。
   刻意覆盖各类难提取的字符：全角标点、千分位数字、Φ / ℃ / ≥ / ± / °、中英文混排。

⚠️ 内容全部是虚构示例（公司名以「示例」开头，代码/电话/邮箱都是占位符），
   不指向任何真实企业 —— 这是刻意的：示例文件不该被误当成真实资料。

用法：
    python scripts/make-sample-supplier-pdf.py [输出路径]

依赖：fpdf2（`pip install fpdf2`），以及一份中文 TTF 字体。
"""

from __future__ import annotations

import sys
from pathlib import Path

from fpdf import FPDF

# ---------------------------------------------------------------------------
# 字体：必须用真正的 TTF/TTC 并嵌入，否则 pdf.js 无法按 Unicode 还原文字。
# 优先等线（Deng.ttf），回退到仿宋（simfang.ttf）。
# ---------------------------------------------------------------------------
FONT_CANDIDATES = [
    ("Deng", Path("C:/Windows/Fonts/Deng.ttf")),
    ("Deng", Path("/usr/share/fonts/truetype/deng/Deng.ttf")),
    ("FangSong", Path("C:/Windows/Fonts/simfang.ttf")),
    ("NotoSansCJK", Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")),
]

# ---------------------------------------------------------------------------
# 文件内容。用结构化数据而不是长字符串，便于调整。
# ---------------------------------------------------------------------------

COMPANY_FIELDS: list[tuple[str, str]] = [
    ("公司名称", "示例精密五金制造（佛山）有限公司"),
    ("统一社会信用代码", "91440606MA0000000X"),
    ("法定代表人", "张示例"),
    ("注册资本", "人民币 500 万元整"),
    ("成立日期", "2018 年 3 月 12 日"),
    ("注册地址", "广东省佛山市顺德区示例路 88 号 3 栋"),
    ("生产地址", "广东省佛山市顺德区示例工业园区 B 区 6 号厂房"),
    ("联系人", "李示例（商务部经理）"),
    ("联系电话", "0757-0000 0000"),
    ("电子邮箱", "sample@example.com"),
    ("员工人数", "126 人（其中技术人员 18 人）"),
    ("厂房面积", "4,200 平方米"),
]

SCOPE_TEXT = (
    "精密五金件、金属结构件、钣金件的研发、制造与销售；"
    "货物进出口、技术进出口。（依法须经批准的项目，经相关部门批准后方可开展经营活动）"
)

CERTIFICATIONS: list[str] = [
    "ISO 9001:2015 质量管理体系认证，证书编号 CN-SAMPLE-2024-0001，有效期至 2027 年 6 月 30 日",
    "ISO 14001:2015 环境管理体系认证，证书编号 CN-SAMPLE-2024-0002，有效期至 2027 年 6 月 30 日",
    "CE 认证（EN 1090-1），证书编号 SAMPLE-CE-2023-0456，有效期至 2026 年 12 月 31 日",
]

# 报价单：列顺序 = 序号 / 物料编码 / 品名 / 规格 / 材质 / 单位 / 数量 / 单价 / 金额
QUOTE_ROWS: list[list[str]] = [
    ["1", "HW-1001", "连接底板", "120×80×6 mm", "Q235B", "件", "2,000", "18.50", "37,000.00"],
    ["2", "HW-1002", "加强角件", "90×90×8 mm", "Q235B", "件", "1,500", "24.80", "37,200.00"],
    ["3", "HW-1003", "调节支架", "Φ60×3.0 mm", "Q355B", "套", "800", "86.00", "68,800.00"],
    ["4", "HW-1004", "预埋螺栓", "M16×220 mm", "8.8 级", "套", "5,000", "6.40", "32,000.00"],
]
QUOTE_HEADER = ["序号", "物料编码", "品名", "规格", "材质", "单位", "数量", "单价(元)", "金额(元)"]
QUOTE_TOTAL = "合计金额：人民币 壹拾柒万伍仟元整（¥175,000.00）"

COMMERCIAL_TERMS: list[str] = [
    "付款方式：合同签订后预付 30%，发货前付 60%，验收合格后 10% 于 30 日内付清。",
    "交货周期：订单确认并收到预付款后 20 个工作日内发货。",
    "交货地点：买方指定仓库（广东省内免运费）。",
    "质保期：自验收合格之日起 12 个月，非人为损坏免费更换。",
    "表面处理：热浸镀锌，平均锌层厚度 ≥ 65 μm，盐雾试验 ≥ 480 小时。",
    "允许公差：长度 ±1.0 mm，角度 ±0.5°，孔径 ±0.2 mm。",
    "工作温度范围：-40 ℃ 至 +85 ℃。",
    "包装方式：木箱 + 防潮膜，单箱净重不超过 800 kg。",
]


def pick_font(pdf: FPDF) -> tuple[str, str]:
    """挑一个可用的中文字体并注册，返回 (字体名, 粗体字体名)。"""
    for name, path in FONT_CANDIDATES:
        if path.is_file():
            pdf.add_font(name, "", str(path))
            # 没有独立的粗体文件就复用常规体 —— 宁可没有粗体，也不要渲染成方框
            pdf.add_font(name, "B", str(path))
            return name, name
    raise SystemExit(
        "找不到任何中文字体。请把一份 .ttf 路径加进 FONT_CANDIDATES，"
        "否则生成的 PDF 里中文会变成方框。"
    )


def build(out_path: Path) -> None:
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    font, font_bold = pick_font(pdf)

    # ---------------- 第 1 页 ----------------
    pdf.add_page()

    pdf.set_font(font, "B", 20)
    pdf.cell(0, 12, "供应商准入资料包", new_x="LMARGIN", new_y="NEXT", align="C")

    pdf.set_font(font, "", 10)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 6, "（示例文件 · 仅用于系统测试，非真实企业资料）", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.set_text_color(0, 0, 0)
    pdf.ln(4)

    # 一、企业基本信息
    pdf.set_font(font_bold, "B", 13)
    pdf.cell(0, 9, "一、企业基本信息", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(font, "", 10.5)
    for label, value in COMPANY_FIELDS:
        pdf.cell(42, 7, f"{label}：", border=0)
        pdf.cell(0, 7, value, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # 二、经营范围
    pdf.set_font(font_bold, "B", 13)
    pdf.cell(0, 9, "二、经营范围", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(font, "", 10.5)
    pdf.multi_cell(0, 7, SCOPE_TEXT, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # 三、资质与认证
    pdf.set_font(font_bold, "B", 13)
    pdf.cell(0, 9, "三、资质与认证", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(font, "", 10.5)
    for index, text in enumerate(CERTIFICATIONS, start=1):
        pdf.multi_cell(0, 7, f"{index}）{text}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # ---------------- 第 2 页 ----------------
    pdf.add_page()

    # 四、报价单
    pdf.set_font(font_bold, "B", 13)
    pdf.cell(0, 9, "四、报价单", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(font, "", 10.5)
    # ⚠️ 每行只放一个字段。曾经把「报价单号 / 报价日期 / 币种」并排放在同一行，
    # 提取出来是交错的（`报价日币种：`）—— PDF 没有「行」的概念，
    # 提取器只能按文字在页面上的坐标还原顺序。示例文件要干净，所以逐行排。
    for line in [
        "报价单号：QT-2026-0927-A",
        "报价日期：2026 年 9 月 27 日",
        "币种：人民币（CNY）",
        "报价有效期：自报价日起 30 个自然日",
    ]:
        pdf.cell(0, 7, line, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    # 表格：列宽手工指定，总宽 = 174mm（A4 去掉左右各 18mm 边距）
    widths = [10, 22, 24, 26, 20, 12, 18, 20, 22]
    pdf.set_font(font_bold, "B", 9.5)
    pdf.set_fill_color(238, 241, 245)
    for width, title in zip(widths, QUOTE_HEADER):
        pdf.cell(width, 8, title, border=1, align="C", fill=True)
    pdf.ln()

    pdf.set_font(font, "", 9.5)
    for row in QUOTE_ROWS:
        for width, cell_value in zip(widths, row):
            pdf.cell(width, 8, cell_value, border=1, align="C")
        pdf.ln()

    pdf.ln(3)
    pdf.set_font(font_bold, "B", 11)
    pdf.cell(0, 8, QUOTE_TOTAL, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # 五、商务条款
    pdf.set_font(font_bold, "B", 13)
    pdf.cell(0, 9, "五、商务条款", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(font, "", 10.5)
    for index, text in enumerate(COMMERCIAL_TERMS, start=1):
        pdf.multi_cell(0, 7, f"{index}. {text}", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(6)
    pdf.set_font(font, "", 9.5)
    pdf.set_text_color(120, 120, 120)
    pdf.multi_cell(
        0,
        6,
        "本文件为测试用示例，所有企业名称、证件编号、联系方式与价格均为虚构占位内容。",
        new_x="LMARGIN",
        new_y="NEXT",
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(out_path))
    print(f"已生成：{out_path}（{out_path.stat().st_size} 字节，{pdf.pages_count} 页）")


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("tests/fixtures/supplier-package-zh.pdf")
    build(target)
