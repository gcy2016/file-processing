#!/usr/bin/env bash
# 生成测试样例到 tests/samples/（需要 python3、ffmpeg（含 libx265）、pandoc；会 pip 安装 pillow-heif py7zr pyzipper reportlab openpyxl）
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p samples && cd samples
pip install -q pillow pillow-heif py7zr pyzipper reportlab openpyxl python-docx python-pptx python-can

python3 - <<'EOF'
import random, os, shutil, zipfile, tarfile, gzip
from PIL import Image, ImageDraw
import pillow_heif, py7zr, pyzipper
random.seed(1)
im = Image.new("RGB", (3000, 2000)); d = ImageDraw.Draw(im)
for _ in range(400):
    x, y = random.randint(0, 3000), random.randint(0, 2000)
    d.ellipse([x, y, x + random.randint(20, 300), y + random.randint(20, 300)], fill=tuple(random.randint(0, 255) for _ in range(3)))
im.save("photo.jpg", quality=95)
exif = Image.Exif(); exif[0x0112] = 6; exif[0x8825] = {1: "N", 2: (30.0, 15.0, 0.0)}
im.resize((600, 400)).save("rotated_gps.jpg", exif=exif.tobytes(), quality=90)   # 方向 6 + GPS
im.save("big.png")
rgba = Image.new("RGBA", (800, 600), (0, 0, 0, 0)); ImageDraw.Draw(rgba).ellipse([100, 100, 700, 500], fill=(200, 30, 30, 180)); rgba.save("alpha.png")
im.resize((1200, 800)).save("pic.webp", quality=90)
im.resize((800, 600)).save("pic.tiff")
im.resize((640, 480)).save("pic.gif")
pillow_heif.register_heif_opener(); im.resize((1500, 1000)).save("pic.heic", quality=85)

ims = [Image.open("photo.jpg").convert("RGB"), Image.open("big.png").convert("RGB").resize((2400, 1600))]
ims[0].save("photos.pdf", save_all=True, append_images=ims[1:], resolution=300)
from reportlab.pdfgen import canvas
c = canvas.Canvas("text.pdf"); c.drawString(100, 750, "Hello PDF text layer"); c.linkURL("https://example.com", (100, 740, 300, 760))
c.drawImage("photo.jpg", 50, 100, 500, 333); c.showPage(); c.drawString(100, 750, "Page 2"); c.save()

os.makedirs("tree/图片/子目录", exist_ok=True); os.makedirs("tree/empty_dir", exist_ok=True)
shutil.copy("photo.jpg", "tree/图片/照片.jpg"); shutil.copy("big.png", "tree/图片/子目录/big.png"); shutil.copy("text.pdf", "tree/文档.pdf")
open("tree/readme.txt", "w").write("hello 你好\n")
with zipfile.ZipFile("tree/inner.zip", "w") as z: z.write("alpha.png", "alpha.png")
def files():
    for root, _, fs in os.walk("tree"):
        for f in fs:
            p = os.path.join(root, f); yield p, os.path.relpath(p, "tree")
with zipfile.ZipFile("utf8.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for p, a in files(): z.write(p, a)
    z.writestr(zipfile.ZipInfo("empty_dir/"), "")
with zipfile.ZipFile("gbk.zip", "w", zipfile.ZIP_DEFLATED) as z:      # Windows 风格：GBK 文件名、无 UTF-8 标记
    for p, a in files():
        zi = zipfile.ZipInfo(a.encode("gbk").decode("cp437")); zi.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi, open(p, "rb").read())
with tarfile.open("t.tar", "w") as t: t.add("tree", arcname=".")
with tarfile.open("t.tar.gz", "w:gz") as t: t.add("tree", arcname=".")
with py7zr.SevenZipFile("t.7z", "w") as z: z.writeall("tree", arcname="")
with pyzipper.AESZipFile("enc.zip", "w", compression=zipfile.ZIP_DEFLATED, encryption=pyzipper.WZ_AES) as z:
    z.setpassword(b"pw"); z.writestr("a.txt", "secret")
with zipfile.ZipFile("slip.zip", "w") as z:                          # 路径穿越
    z.writestr("../../evil.txt", "x"); z.writestr("/abs.txt", "y"); z.writestr("ok.txt", "z")
open("single.txt.gz", "wb").write(gzip.compress(b"just a gz file"))

import openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "销售"; ws.append(["月份", "金额"]); ws.append(["一月", 100]); ws.append(["二月", "=B2*2"])
wb.create_sheet("其他").append(["x"]); wb.save("book.xlsx")
open("gbk.csv", "wb").write("编号,姓名,金额\n007,张三,12.5\n110101199001011234,李四,3\n".encode("gbk"))
open("rows.json", "w").write('[{"编号":"007","姓名":"张三","嵌套":{"a":1}},{"编号":"8","姓名":"李四"}]')
EOF

cat > doc.md <<'EOF'
# 标题一

这是一段**中文**文字，带一个[链接](https://example.com)。

| 姓名 | 电话 |
|---|---|
| 张三 | 0123 |

![图片](alpha.png)

- 列表一
- 列表二
EOF
pandoc doc.md -o doc.docx
pandoc doc.md -o doc.epub --metadata title=测试
pandoc doc.md -s -o doc.html --metadata title=测试

F="ffmpeg -hide_banner -loglevel error -y"
$F -f lavfi -i testsrc2=size=1920x1080:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 8 -c:v libx264 -b:v 12M -pix_fmt yuv420p -c:a aac -b:a 192k h264.mp4
$F -f lavfi -i testsrc2=size=1920x1080:rate=30 -f lavfi -i sine=frequency=330:sample_rate=48000 -t 6 -c:v libx265 -x265-params log-level=error -tag:v hvc1 -b:v 8M -pix_fmt yuv420p -c:a aac iphone_hevc.mov
$F -f lavfi -i testsrc2=size=640x360:rate=25 -f lavfi -i sine=sample_rate=48000 -t 4 -c:v libvpx-vp9 -b:v 1M -c:a libopus v.webm
$F -i h264.mp4 -t 4 -c copy v.mkv
$F -f lavfi -i sine=frequency=500:sample_rate=44100 -f lavfi -i anoisesrc=d=6:a=0.1 -filter_complex amix -t 6 -c:a libmp3lame -b:a 192k plain.mp3
$F -i plain.mp3 -i alpha.png -map 0 -map 1 -c:a copy -c:v png -disposition:v attached_pic -id3v2_version 3 cover.mp3
for x in wav flac ogg m4a; do $F -i plain.mp3 a.$x; done

# RAR 样例（来自 libarchive 测试集，uuencode 格式）
for n in rar5_compressed:rar5 rar:rar4; do
  src=${n%%:*}; dst=${n##*:}
  curl -sSL "https://raw.githubusercontent.com/libarchive/libarchive/master/libarchive/test/test_read_format_${src}.rar.uu" |
    python3 -c "import sys,binascii
out=b''; s=False
for l in sys.stdin.read().splitlines():
    if l.startswith('begin'): s=True; continue
    if l=='end': break
    if s and l: out+=binascii.a2b_uu(l)
open('$dst.rar','wb').write(out)" || echo "（RAR 样例下载失败，跳过）"
done
# 中文 Word、PPT、中文 PDF、扫描版 PDF、BLF（文档转 PDF、PDF 转 Word、BLF 转文本用）
python3 - <<'EOF2'
import random, can
from docx import Document
from docx.shared import Inches
from pptx import Presentation
from pptx.util import Inches as PI, Pt
from pptx.dml.color import RGBColor
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from PIL import Image, ImageDraw, ImageFont

d = Document()
d.sections[0].header.paragraphs[0].text = "页眉：轻压测试文档"; d.sections[0].footer.paragraphs[0].text = "页脚 第 1 页"
d.add_heading("一、中文标题测试", level=1)
p = d.add_paragraph("这是一段中文正文，包含"); p.add_run("加粗").bold = True; p.add_run("文字。English mixed 混排。")
t = d.add_table(rows=3, cols=3); t.style = "Table Grid"
for i, row in enumerate([["姓名", "部门", "电话"], ["张三", "研发部", "13800000000"], ["李四", "市场部", "13900000000"]]):
    for j, v in enumerate(row): t.cell(i, j).text = v
d.add_picture("alpha.png", width=Inches(3)); d.add_page_break(); d.add_heading("二、第二页", level=1)
for i in range(30): d.add_paragraph(f"第 {i+1} 段：床前明月光，疑是地上霜。举头望明月，低头思故乡。")
d.save("zh.docx")

pr = Presentation(); pr.slide_width, pr.slide_height = PI(13.333), PI(7.5)
s = pr.slides.add_slide(pr.slide_layouts[0]); s.shapes.title.text = "季度汇报"; s.placeholders[1].text = "轻压测试 · 2026"
s2 = pr.slides.add_slide(pr.slide_layouts[5]); s2.shapes.title.text = "第二页：要点"
tf = s2.shapes.add_textbox(PI(1), PI(2), PI(6), PI(3)).text_frame; tf.text = "第一点：中文显示正常"
para = tf.add_paragraph(); para.text = "第二点：English text"; para.runs[0].font.size = Pt(28); para.runs[0].font.color.rgb = RGBColor(0xC0, 0x20, 0x20)
r = s2.shapes.add_shape(1, PI(8), PI(2), PI(3), PI(2)); r.fill.solid(); r.fill.fore_color.rgb = RGBColor(0x0D, 0x7A, 0x5F); r.text_frame.text = "色块"
s2.shapes.add_picture("alpha.png", PI(8), PI(4.5), PI(2))
tb = s2.shapes.add_table(3, 3, PI(1), PI(5.2), PI(6), PI(1.2)).table
for i in range(3):
    for j in range(3): tb.cell(i, j).text = f"单元{i}{j}"
pr.save("deck.pptx")

pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
c = canvas.Canvas("zh_text.pdf"); c.setFont("STSong-Light", 22); c.drawString(72, 760, "第一章 测试标题"); c.setFont("STSong-Light", 12)
y = 720
for i in range(6):
    c.drawString(72, y, f"这是第{i+1}段的第一行文字，用于测试中文 PDF 的文字提取效果，"); y -= 16
    c.drawString(72, y, "这是同一段的第二行。"); y -= 30
c.showPage(); c.setFont("STSong-Light", 12); c.drawString(72, 760, "第二页的内容 Hello World"); c.save()

f = ImageFont.truetype("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 40)   # 需要文泉驿字体
im = Image.new("L", (1654, 2339), 255); dr = ImageDraw.Draw(im)
for k, line in enumerate(["扫描件测试：床前明月光", "Scanned page with English text.", "疑是地上霜，举头望明月。"]):
    dr.text((150, 200 + k * 100), line, font=f, fill=0)
im.save("scan.pdf", resolution=200)

random.seed(2)
with can.BLFWriter("can.blf") as w:
    for i in range(50000):
        ext, fd = i % 7 == 0, i % 11 == 0
        w.on_message_received(can.Message(timestamp=1700000000.0 + i * 0.001, arbitration_id=random.randint(0, 0x1FFFFFFF if ext else 0x7FF),
            is_extended_id=ext, is_fd=fd, data=bytes(random.randint(0, 255) for _ in range(16 if fd else 8)), channel=1 + i % 2))
EOF2
echo "样例已生成：$(pwd)"
