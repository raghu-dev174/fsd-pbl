import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SUMMARY = ROOT / "results" / "summary.json"
CHARTS = ROOT / "charts"
CHARTS.mkdir(parents=True, exist_ok=True)

with SUMMARY.open("r", encoding="utf-8") as handle:
    data = json.load(handle)

keys = ["shortPolling", "longPolling", "sse"]
labels = ["Short Polling", "Long Polling", "SSE"]
short_labels = ["Poll", "Long", "SSE"]
colors = ["#2563EB", "#7C3AED", "#059669"]
rows = [data["transports"][key] for key in keys]

def font(size, bold=False):
    names = ["arialbd.ttf" if bold else "arial.ttf", "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"]
    for name in names:
        for base in [Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/dejavu")]:
            path = base / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()

TITLE = font(34, True)
SUBTITLE = font(18)
LABEL = font(20, True)
VALUE = font(21, True)
AXIS = font(17)

def draw_text_center(draw, box, text, text_font, fill):
    left, top, right, bottom = box
    bounds = draw.textbbox((0, 0), text, font=text_font)
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    draw.text(((left + right - width) / 2, (top + bottom - height) / 2), text, font=text_font, fill=fill)

def bar_chart(values, title, subtitle, filename, formatter):
    width, height = 1400, 800
    img = Image.new("RGB", (width, height), "#FFFFFF")
    draw = ImageDraw.Draw(img)
    draw.text((70, 55), title, font=TITLE, fill="#0F172A")
    draw.text((70, 105), subtitle, font=SUBTITLE, fill="#64748B")
    plot = (120, 190, 1320, 670)
    max_value = max(values) * 1.22 if max(values) else 1
    for i in range(5):
        y = plot[3] - (plot[3] - plot[1]) * i / 4
        draw.line((plot[0], y, plot[2], y), fill="#E2E8F0", width=2)
        tick = max_value * i / 4
        tick_text = f"{tick:,.0f}" if max_value >= 100 else f"{tick:.1f}"
        bounds = draw.textbbox((0, 0), tick_text, font=AXIS)
        draw.text((plot[0] - 18 - (bounds[2] - bounds[0]), y - 10), tick_text, font=AXIS, fill="#64748B")
    group_width = (plot[2] - plot[0]) / len(values)
    bar_width = group_width * .48
    for i, (label, value, color) in enumerate(zip(labels, values, colors)):
        center = plot[0] + group_width * (i + .5)
        bar_height = (plot[3] - plot[1]) * value / max_value
        x0, x1 = center - bar_width / 2, center + bar_width / 2
        y0 = plot[3] - bar_height
        draw.rounded_rectangle((x0, y0, x1, plot[3]), radius=14, fill=color)
        value_text = formatter(value)
        bounds = draw.textbbox((0, 0), value_text, font=VALUE)
        draw.text((center - (bounds[2] - bounds[0]) / 2, y0 - 38), value_text, font=VALUE, fill="#0F172A")
        draw_text_center(draw, (center - group_width / 2, 686, center + group_width / 2, 744), label, LABEL, "#334155")
    img.save(CHARTS / filename, optimize=True)

bar_chart([r["requestsPerMinute"] for r in rows], "Measured Requests per Minute", "100 concurrent clients; two-minute controlled run", "requests-per-minute.png", lambda v: f"{v:,.1f}")
bar_chart([r["averageCpuPercent"] for r in rows], "Average Server CPU Usage", "Node process CPU as percent of one logical core", "cpu-usage.png", lambda v: f"{v:.2f}%")
bar_chart([r["deliveryDelayMs"]["average"] for r in rows], "Average Notification Delivery Delay", "Client receipt time minus server generation time", "delivery-delay.png", lambda v: f"{v:,.1f} ms")

width, height = 1600, 920
img = Image.new("RGB", (width, height), "#F8FAFC")
draw = ImageDraw.Draw(img)
draw.text((65, 48), "Transport Comparison", font=TITLE, fill="#0F172A")
draw.text((65, 98), "100 concurrent clients | same event source | 120 seconds per transport", font=SUBTITLE, fill="#64748B")
cards = [
    ("Requests per minute", [r["requestsPerMinute"] for r in rows], lambda v: f"{v:,.1f}"),
    ("Average CPU", [r["averageCpuPercent"] for r in rows], lambda v: f"{v:.2f}%"),
    ("Average delay", [r["deliveryDelayMs"]["average"] for r in rows], lambda v: f"{v:,.1f} ms"),
]
for card_index, (card_title, values, formatter) in enumerate(cards):
    left = 55 + card_index * 515
    top, right, bottom = 165, left + 485, 850
    draw.rounded_rectangle((left, top, right, bottom), radius=22, fill="#FFFFFF", outline="#D9E2EC", width=2)
    draw.text((left + 28, top + 26), card_title, font=LABEL, fill="#0F172A")
    max_value = max(values) if max(values) else 1
    for i, (label, value, color) in enumerate(zip(short_labels, values, colors)):
        row_top = top + 105 + i * 175
        draw.text((left + 28, row_top), label, font=LABEL, fill="#334155")
        draw.text((right - 28, row_top), formatter(value), font=VALUE, fill="#0F172A", anchor="ra")
        track = (left + 28, row_top + 54, right - 28, row_top + 92)
        draw.rounded_rectangle(track, radius=14, fill="#E8EEF5")
        fill_right = track[0] + (track[2] - track[0]) * value / max_value
        draw.rounded_rectangle((track[0], track[1], max(track[0] + 20, fill_right), track[3]), radius=14, fill=color)
img.save(CHARTS / "overall-comparison.png", optimize=True)

print(f"Created 4 measured-data charts in {CHARTS}")
