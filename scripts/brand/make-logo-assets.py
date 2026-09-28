#!/usr/bin/env python
"""
从品牌源图生成全站静态资产（可复现，别手改产物）。

源图：docs/brand/logo-source-企智审.png
      James 设计的品牌图标 + LOGO（1254×1254，RGB，近纯白底）
      图形：蓝色六边形 + 白色盾牌 + 文档 + 青绿对勾

产出：
  public/brand/mark-transparent-512.png  图标主体（透明底，512 方形）
  public/brand/mark-512.png              同一图形的白底不透明版（浅色场景兜底）
  public/favicon.ico                     多尺寸 ico
  public/apple-touch-icon.png            180×180 **不透明满幅**
  public/icon-192.png / icon-512.png     PWA 图标（不透明）
  docs/brand/_check.png                  深底/白底合成对照图（人工目检用）

────────────────────────────────────────────────────────────────────
抠图为什么这么绕：一条「窄通道」和三次踩坑
────────────────────────────────────────────────────────────────────

实测（docs/brand/_diag*.py 的结论）：**图标内部的白色盾牌，与图外白底是连通的。**
通道在「对勾左下尖 ↔ 六边形右下边」之间，最窄处约 18px（源图尺度），
V 形，向下张开并入图外白底。

这条连通性决定了：任何「与画布边缘连通的近白 = 背景」的朴素抠图，都会把
白盾牌一起抹掉 —— 深底上只剩一个孤零零的蓝文档。三次失败都源于此：

  ① 四角种子 → 图形把背景围成口袋，角点走不到，右下留白斑。
  ② 只留「中心连通块」→ 白盾牌整块消失。
  ③ 按几何轮廓（闭运算 9×9）→ 连六边形都没了，有效像素仅 16.1%。

③ 的真实原因不是窗口大小，而是**播种点落到了墨迹上**：
种子沿 x 轴每 8px 布一个，(224, 0) 恰是六边形顶点，floodfill 以该点颜色为基准，
把「整块相连的墨迹」填成了背景 ⇒ 图标被自己吃掉。
（教训：floodfill 的种子必须先验证它落在目标像素上，否则它会忠实地把错的东西连根拔起。）

现在的做法与其实测依据：

  1. 墨迹掩码 ink（非近白 = 255），外补 PAD 边（图外本来就是底）。
  2. **闭运算 SEAL_RADIUS**（MaxFilter → MinFilter，对 ink 而言即先膨胀后腐蚀）。
     半径取 12：实测半径 9 封不住那条通道、10 恰好封住，留一档余量。
     闭运算只往**凹处**补料，六边形/对勾的外缘是凸的 ⇒ 轮廓不被撑大、不留白边。
  3. 从四边 floodfill 求「外部」。这一步只喂**背景像素**做种子（教训 ③）。
     被闭运算堵住的内部白（盾牌）因此留在「外部」之外。
  4. alpha = max(近白斜坡, 非外部)。
     - 近白斜坡：只有距白 ≤ (255-NEAR_WHITE) 的像素有部分 alpha，保证图标外缘平滑，
       且不会把浅蓝渐变误判成半透明（按「最暗通道」抠像会犯这个错，本图蓝底 R>0）。
     - 盾牌被「非外部」保住，深底上依然是白的。

副作用（已知、可接受）：闭运算会在**凹尖**处留下极小的白色填塞物
（对勾左下尖与六边形之间的 V 形凹口，约 20×5px／491px 宽）。
换算到 36px 的导航尺寸不足 1.5px，不可见。

────────────────────────────────────────────────────────────────────
两条别的纪律
────────────────────────────────────────────────────────────────────

- **apple-touch-icon 必须不透明满幅。** iOS 不支持透明，透明区会被填黑。
- 白底上的**整幅字标**（图标 + 中文）不要用上面的方法：汉字被笔画围出的
  封闭白区（如「智」的口内）会被判为「内部」而保留成白块，深底上就是白斑。
  字标用朴素「边缘连通白 → 透明」，它本来就只用在浅底（OG 图、浅色版式）上。
"""
from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs" / "brand" / "logo-source-企智审.png"
PUBLIC = ROOT / "public"
BRAND = PUBLIC / "brand"
DOCS = ROOT / "docs" / "brand"

# 源图实测：底是 #F8F8F8（248），不是纯白；盾牌内部也是 248 —— 两者同色，
# 所以**颜色无法区分内外**，只能靠几何（这正是本脚本所有麻烦的来源）。
# 因此斜坡必须把 248 映射成 0，否则整片外底会留下一层半透明灰膜
# （第一版漏了这个：WHITE_LEVEL 写成 250，白色底片上浮出一块灰矩形）。
WHITE_LEVEL = 248  # 该亮度及以上 = 完全透明
SOLID_LEVEL = 240  # 该亮度及以下 = 完全不透明；两者之间线性过渡
SEAL_RADIUS = 10   # 闭运算半径：实测通道宽约 16px，半径 9 封不住、10 恰好封住。
                   # 不能贪大 —— 半径 12 会把盾牌自身的窄处（约 24px）一起封死。
PAD = 64


def ink_mask(image: Image.Image) -> Image.Image:
    """墨迹掩码：非近白 = 255。"""
    return image.convert("L").point(lambda v: 0 if v >= WHITE_LEVEL else 255)


def content_row_runs(mask: Image.Image, min_gap: int = 8) -> list[tuple[int, int]]:
    """
    返回「有墨迹的连续行区间」。

    源图是「图标 / 中文名 / 副标题」三段竖排，用行区间切分比写死百分比稳 ——
    写 0.58 那种魔数会把中文名的顶笔切进来，而它的字宽比图标还大，
    于是包围盒横向被撑开，图标被缩得比预期小。
    """
    rows: list[int] = []
    for y in range(mask.height):
        box = mask.crop((0, y, mask.width, y + 1)).getbbox()
        if box is not None:
            rows.append(y)
    if not rows:
        raise SystemExit("源图里没有找到任何内容")

    runs: list[tuple[int, int]] = []
    start = rows[0]
    previous = rows[0]
    for y in rows[1:]:
        if y - previous > min_gap:
            runs.append((start, previous + 1))
            start = y
        previous = y
    runs.append((start, previous + 1))
    return runs


def dilate(mask_image: Image.Image, radius: int, allowed: Image.Image | None = None) -> Image.Image:
    """把 255 区域膨胀 radius 次，每次 1px（可限制在 allowed 内 —— 测地膨胀）。"""
    size = radius * 2 + 1
    grown = mask_image.filter(ImageFilter.MaxFilter(size))
    if allowed is not None:
        grown = ImageChops.multiply(grown, allowed)
    return grown


def outside_of(bg: Image.Image) -> Image.Image:
    """
    求「与画布四边连通」的背景（= 真正的外部）。

    ⚠️ 必须用测地膨胀而不是 ImageDraw.floodfill：
    floodfill 对每个种子都会遍历整片区域，几十万个像素在纯 Python 里太慢；
    膨胀每轮都是 C 算子，收敛轮数按画布对角线给足即可。
    """
    width, height = bg.size
    marker = Image.new("L", (width, height), 0)
    ImageDraw.Draw(marker).rectangle((0, 0, width - 1, 0), fill=255)
    ImageDraw.Draw(marker).rectangle((0, height - 1, width - 1, height - 1), fill=255)
    ImageDraw.Draw(marker).rectangle((0, 0, 0, height - 1), fill=255)
    ImageDraw.Draw(marker).rectangle((width - 1, 0, width - 1, height - 1), fill=255)
    marker = ImageChops.multiply(marker, bg)

    for _ in range(width + height):
        grown = ImageChops.multiply(marker.filter(ImageFilter.MaxFilter(3)), bg)
        if grown.tobytes() == marker.tobytes():
            break
        marker = grown
    return marker


MIN_KEEP_AREA = 200  # 凹尖处被闭运算填住的小白块，小于此面积一律放开为透明


def release_specks(privileged: Image.Image) -> Image.Image:
    """
    把「小块被保留下来的白」放回透明。

    闭运算会在**凹尖**补料，于是对勾左下尖与六边形之间的 V 形凹口会被填出一小块
    近白（实测 20×6px）。它在白底上不可见、在深底上就是一道白刺 ——
    这是本方法唯一真实的副作用，必须收掉。

    判据用**面积**而不是形状：真正的内部白（盾牌轮廓、文档里的三条白线）
    实测最小的也有 1357px，而被误填的白块最大的只有 67px，中间隔着 20 倍，
    取 200 作阈值谁都不会误伤。放开的像素本来就是背景色（≥ WHITE_LEVEL），
    交给斜坡自然变透明即可。
    """
    width, height = privileged.size
    data = privileged.load()
    seen = [[False] * width for _ in range(height)]
    release = Image.new("L", (width, height), 0)
    painter = release.load()
    for sy in range(height):
        for sx in range(width):
            if not data[sx, sy] or seen[sy][sx]:
                continue
            seen[sy][sx] = True
            queue = deque([(sx, sy)])
            block: list[tuple[int, int]] = []
            while queue:
                x, y = queue.popleft()
                block.append((x, y))
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < width and 0 <= ny < height and data[nx, ny] \
                            and not seen[ny][nx]:
                        seen[ny][nx] = True
                        queue.append((nx, ny))
            if len(block) < MIN_KEEP_AREA:
                for point in block:
                    painter[point] = 255
    return release


def isolate_mark(icon_rgb: Image.Image, report: bool = True) -> Image.Image:
    """抠出图标主体（保留内部白盾牌）。做法与实测依据见文件头。"""
    ink = ink_mask(icon_rgb)
    width, height = ink.size

    padded = Image.new("L", (width + PAD * 2, height + PAD * 2), 0)
    padded.paste(ink, (PAD, PAD))
    size = SEAL_RADIUS * 2 + 1
    sealed = padded.filter(ImageFilter.MaxFilter(size)).filter(ImageFilter.MinFilter(size))

    # 「外部」= 在**封住通道之后**的掩码上，与四边连通的背景。
    sealed_background = ImageOps.invert(sealed)
    outside = outside_of(sealed_background)
    outside = outside.crop((PAD, PAD, PAD + width, PAD + height))

    # 近白斜坡：WHITE_LEVEL→0、SOLID_LEVEL→255，中间线性过渡。
    # 只在这 8 级亮度里做过渡 —— 图标最浅的蓝也在亮度 160 上下，
    # 若按「最暗通道」抠像，任何 R>0 的蓝都会被打成半透明（本图蓝底 R 恰为 0~16）。
    ramp = icon_rgb.convert("L").point(
        lambda v: max(0, min(255, (WHITE_LEVEL - v) * 255 // (WHITE_LEVEL - SOLID_LEVEL)))
    )
    alpha = ImageChops.lighter(ramp, ImageOps.invert(outside))

    # 保留下来、且源图仍是背景色的那些像素（= 内部白 + 凹尖填塞物），收掉小块。
    gray = icon_rgb.convert("L")
    privileged = ImageChops.multiply(
        ImageOps.invert(outside), gray.point(lambda v: 255 if v >= WHITE_LEVEL else 0)
    )
    release = release_specks(privileged)
    alpha = ImageChops.multiply(alpha, ImageOps.invert(release))

    out = icon_rgb.convert("RGBA")
    out.putalpha(alpha)

    if report:
        opaque = sum(1 for v in alpha.getdata() if v > 127)
        ratio = opaque / (width * height) * 100
        print(f"  图标主体 {width}×{height}，不透明像素 {ratio:.1f}%（正常约 55~75%）")
        if ratio < 0.5:
            print("  ⚠️ 不透明比例偏低，内部白可能又被吃掉了 —— 检查 SEAL_RADIUS")
        outside.save(DOCS / "_outside.png")
    return out


def knockout_white(rgb: Image.Image) -> Image.Image:
    """边缘连通的近白 → 透明。只用于**浅底**上的整幅字标（见文件头末段）。"""
    work = rgb.convert("RGB")
    background = Image.new("L", work.size, 0)
    gray = work.convert("L")
    ImageDraw.Draw(background).bitmap(
        (0, 0), gray.point(lambda v: 255 if v >= WHITE_LEVEL else 0)
    )
    # 只从四边播种，且只在背景像素上（教训 ③）
    marker = Image.new("L", work.size, 0)
    width, height = work.size
    ImageDraw.Draw(marker).rectangle((0, 0, width - 1, 0), fill=255)
    ImageDraw.Draw(marker).rectangle((0, height - 1, width - 1, height - 1), fill=255)
    ImageDraw.Draw(marker).rectangle((0, 0, 0, height - 1), fill=255)
    ImageDraw.Draw(marker).rectangle((width - 1, 0, width - 1, height - 1), fill=255)
    reach = outside_of(ImageChops.multiply(marker, background))
    # 只对「背景像素」生效：字标的笔画内部不能被抹
    reach = ImageChops.multiply(reach, background)

    out = work.convert("RGBA")
    out.putalpha(ImageOps.invert(reach))
    return out


def square(image: Image.Image, size: int) -> Image.Image:
    """等比缩放居中到正方形透明画布（不拉伸）。"""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scaled = image.copy()
    scaled.thumbnail((size, size), Image.LANCZOS)
    canvas.paste(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2), scaled)
    return canvas


def on_white(image: Image.Image, size: int) -> Image.Image:
    """铺白底再贴图（iOS / PWA 图标必须不透明）。"""
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    canvas.alpha_composite(square(image, size))
    return canvas.convert("RGB")


def tight(image: Image.Image, margin: int = 8) -> Image.Image:
    """按不透明像素裁到紧包围盒，再补一点边距。"""
    alpha = image.getchannel("A")
    box = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    if box is None:
        return image
    left, top, right, bottom = box
    left, top = max(0, left - margin), max(0, top - margin)
    right = min(image.width, right + margin)
    bottom = min(image.height, bottom + margin)
    return image.crop((left, top, right, bottom))


def palette_summary(image: Image.Image) -> None:
    """把实测配色打出来 —— 换配色板时以这里为准，不凭截图目测。"""
    pixels = image.convert("RGB").getdata()
    counts: dict[tuple[int, int, int], int] = {}
    for pixel in pixels:
        # 量化到 8 的分辨率，避免抗锯齿产生的上千种近似色淹没统计
        key = tuple(channel // 8 * 8 for channel in pixel)
        counts[key] = counts.get(key, 0) + 1
    print("  源图主色（量化到 8 阶，取前 8）:")
    for color, count in sorted(counts.items(), key=lambda kv: -kv[1])[:8]:
        print(f"    rgb{color}  #{color[0]:02X}{color[1]:02X}{color[2]:02X}  {count:>8} px")


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"缺少品牌源图：{SRC}")

    source = Image.open(SRC).convert("RGB")
    BRAND.mkdir(parents=True, exist_ok=True)
    print(f"源图 {source.width}×{source.height} {source.mode}")
    palette_summary(source)

    mask = ink_mask(source)
    runs = content_row_runs(mask)
    print(f"  内容行区间: {runs}")
    if len(runs) < 2:
        raise SystemExit("预期至少「图标 + 文字」两段，实测不足 —— 别硬跑")

    icon_rows = runs[0]
    # ⚠️ getbbox() 给的是**相对裁剪区**的坐标，必须加回行偏移才是原图坐标。
    # 直接拿去裁原图会静默取到「顶部同样高度」的一条带 —— 图标只进来上半截，
    # 不报错、不越界，只是图形少了一半（2026-09-28 实际踩到）。
    local = mask.crop((0, icon_rows[0], source.width, icon_rows[1])).getbbox()
    assert local
    left, top, right, bottom = local
    icon_box = (left, icon_rows[0] + top, right, icon_rows[0] + bottom)
    print(f"  图标包围盒: {icon_box}（{icon_box[2] - icon_box[0]}×"
          f"{icon_box[3] - icon_box[1]}，源图行 {icon_rows[0]}~{icon_rows[1]}）")
    mark = tight(isolate_mark(source.crop(icon_box)))

    # ---- 图标（透明方形）----
    square(mark, 512).save(BRAND / "mark-transparent-512.png")
    on_white(mark, 512).save(BRAND / "mark-512.png")

    # ---- favicon 三件套 + PWA（都不透明）----
    icon_512 = Image.open(BRAND / "mark-transparent-512.png")
    icon_512.resize((32, 32), Image.LANCZOS).save(
        PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
    )
    on_white(mark, 180).save(PUBLIC / "apple-touch-icon.png")
    on_white(mark, 192).save(PUBLIC / "icon-192.png")
    on_white(mark, 512).save(PUBLIC / "icon-512.png")

    # ---- 人工目检对照图：深底 / 白底 ----
    tile = 620
    check = Image.new("RGB", (tile * 2, tile), (255, 255, 255))
    for index, background in enumerate(((11, 33, 73), (255, 255, 255))):
        panel = Image.new("RGBA", (tile, tile), (*background, 255))
        scaled = icon_512.copy()
        scaled.thumbnail((460, 460), Image.LANCZOS)
        panel.alpha_composite(scaled, ((tile - scaled.width) // 2,
                                       (tile - scaled.height) // 2))
        check.paste(panel.convert("RGB"), (index * tile, 0))
    check.save(DOCS / "_check.png")

    for path in [BRAND / "mark-transparent-512.png", BRAND / "mark-512.png",
                 PUBLIC / "apple-touch-icon.png", PUBLIC / "icon-192.png",
                 PUBLIC / "icon-512.png", PUBLIC / "favicon.ico", DOCS / "_check.png"]:
        with Image.open(path) as image:
            print(f"{path.relative_to(ROOT)!s:<44} {path.stat().st_size:>8} B  "
                  f"{image.size} {image.mode}")


if __name__ == "__main__":
    sys.exit(main())
