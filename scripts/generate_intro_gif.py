import math
import os
from PIL import Image, ImageDraw, ImageFont

banner = [
    " ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗   ██╗████████╗███████╗██████╗     ██╗   ██╗███████╗███████╗██████╗ ",
    "██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║   ██║╚══██╔══╝██╔════╝██╔══██╗    ██║   ██║██╔════╝██╔════╝██╔══██╗",
    "██║     ██║   ██║██╔████╔██║██████╔╝██║   ██║   ██║   █████╗  ██████╔╝    ██║   ██║███████╗█████╗  ██████╔╝",
    "██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║   ██║   ██║   ██╔══╝  ██╔══██╗    ██║   ██║╚════██║██╔══╝  ██╔══██╗",
    "╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ╚██████╔╝   ██║   ███████╗██║  ██║    ╚██████╔╝███████║███████╗██║  ██║",
    " ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝      ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝     ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝",
]

splitX = 64
logoW = len(banner[0])
accentHex = "#00e5ff"      # Cyan
secondaryHex = "#a855f7"   # Purple
dimHex = "#1e293b"         # Dark slate
glowHex = "#ffffff"        # Bright white
trailingHex = "#38bdf8"    # Sky blue
leadingHex = "#6366f1"     # Indigo

def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def lerp_color(c1, c2, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(c1[i] * (1 - t) + c2[i] * t) for i in range(3))

accentRGB = hex_to_rgb(accentHex)
secondaryRGB = hex_to_rgb(secondaryHex)
dimRGB = hex_to_rgb(dimHex)
glowRGB = hex_to_rgb(glowHex)
trailingRGB = hex_to_rgb(trailingHex)
leadingRGB = hex_to_rgb(leadingHex)
bgRGB = (15, 17, 23)

font_size = 13
try:
    font = ImageFont.truetype("C:\\Windows\\Fonts\\consola.ttf", font_size)
except Exception:
    font = ImageFont.load_default()

bbox = font.getbbox("█")
char_w = bbox[2] - bbox[0] + 1
char_h = bbox[3] - bbox[1] + 3

padding_x = 32
padding_y = 30

img_w = padding_x * 2 + logoW * char_w
img_h = padding_y * 2 + len(banner) * char_h + 30

frames = []
total_frames = 60

for f in range(0, total_frames, 2):
    img = Image.new("RGB", (img_w, img_h), bgRGB)
    draw = ImageDraw.Draw(img)

    # Window dots
    draw.ellipse((16, 14, 24, 22), fill=(239, 68, 68))
    draw.ellipse((30, 14, 38, 22), fill=(234, 179, 8))
    draw.ellipse((44, 14, 52, 22), fill=(34, 197, 94))

    # Subtitle centered at top
    sub_title = "ComputerUser · Autonomous Desktop & Browser MCP Engine"
    sub_bbox = font.getbbox(sub_title)
    sub_w = sub_bbox[2] - sub_bbox[0]
    draw.text(((img_w - sub_w) // 2, 12), sub_title, font=font, fill=(148, 163, 184))

    sweepFrames = 40
    for row_idx, line in enumerate(banner):
        y = padding_y + 15 + row_idx * char_h
        for x, ch in enumerate(line):
            if ch == " ":
                continue
            if f <= sweepFrames:
                beamProgress = f / float(sweepFrames)
                beamX = int(beamProgress * (logoW + 16)) - 8
                dist = x - beamX
                if abs(dist) <= 1:
                    color = glowRGB
                elif -4 <= dist < 0:
                    color = trailingRGB
                elif dist < -4:
                    color = accentRGB if x < splitX else secondaryRGB
                elif 0 < dist <= 4:
                    color = leadingRGB
                else:
                    color = dimRGB
            else:
                base = accentRGB if x < splitX else secondaryRGB
                shimmerProgress = (f - sweepFrames) / float(total_frames - sweepFrames)
                wave = 0.5 + 0.5 * math.sin(2 * math.pi * (shimmerProgress * 2.0 - x / float(logoW)))
                color = lerp_color(base, glowRGB, 0.45 * wave)

            draw.text((padding_x + x * char_w, y), ch, font=font, fill=color)

    status_text = "READY FOR DEEPSEEK · ANTIGRAVITY · CURSOR · CLINE · ANY AGENT"
    st_bbox = font.getbbox(status_text)
    st_w = st_bbox[2] - st_bbox[0]
    draw.text(((img_w - st_w) // 2, img_h - 20), status_text, font=font, fill=(100, 116, 139))

    frames.append(img)

# Hold final frame
for _ in range(10):
    frames.append(frames[-1])

out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
os.makedirs(out_dir, exist_ok=True)
out_gif = os.path.join(out_dir, "intro.gif")

frames[0].save(
    out_gif,
    save_all=True,
    append_images=frames[1:],
    duration=50,
    loop=0,
    optimize=True
)
print(f"Saved {out_gif} successfully!")
