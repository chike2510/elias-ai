"""ELIAS clipper (runs on GitHub Actions).

1. Download only what is needed (a section when times are given, audio first when they are not).
2. No times: find the loudest spikes with ffmpeg's EBU R128 meter and pick 10-40s windows around them.
3. Cut: start 1.5s before the setup, loudness normalised to -14 LUFS, 1080x1920.
   Vertical footage goes full screen; landscape is centred over a blurred copy of itself.
4. Hook: white rounded box with black text (2-4 lines, emoji in colour) on screen for the whole clip.
Outputs go to out/: clip_N.mp4, candidates.json, caption.txt.
"""
import json
import os
import re
import subprocess
import sys
import textwrap
from pathlib import Path

OUT = Path("out")
WORK = Path("work")
OUT.mkdir(exist_ok=True)
WORK.mkdir(exist_ok=True)

URL = os.environ.get("CLIP_URL", "").strip()
START = os.environ.get("CLIP_START", "").strip()
END = os.environ.get("CLIP_END", "").strip()
HOOK = os.environ.get("CLIP_HOOK", "").strip()
COUNT = max(1, min(3, int(os.environ.get("CLIP_COUNT", "1") or 1)))
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
EMOJI_FONT = "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"


def run(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd)[:400], flush=True)
    return subprocess.run(cmd, check=True, text=True, **kw)


def seconds(value: str) -> float:
    if not value:
        return 0.0
    parts = [float(p) for p in value.split(":")]
    total = 0.0
    for p in parts:
        total = total * 60 + p
    return total


def ytdlp_base():
    cmd = ["yt-dlp", "--no-playlist", "--no-warnings", "-q"]
    cookies = os.environ.get("YTDLP_COOKIES", "")
    if cookies:
        path = WORK / "cookies.txt"
        path.write_text(cookies)
        cmd += ["--cookies", str(path)]
    return cmd


def download_section(start: float, end: float, name: str) -> Path:
    target = WORK / f"{name}.mp4"
    run(ytdlp_base() + ["-f", "bv*[height<=1080]+ba/b[height<=1080]/b", "--merge-output-format", "mp4",
                        "--download-sections", f"*{start:.2f}-{end:.2f}", "--force-keyframes-at-cuts",
                        "-o", str(target), URL])
    return target


def download_audio() -> Path:
    run(ytdlp_base() + ["-f", "ba/b", "-x", "--audio-format", "m4a", "-o", str(WORK / "audio.%(ext)s"), URL])
    return next(WORK.glob("audio.*"))


def loudness_per_second(audio: Path):
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-loglevel", "verbose", "-i", str(audio), "-vn", "-af", "ebur128=framelog=verbose", "-f", "null", "-"],
                          capture_output=True, text=True)
    per_sec = {}
    for match in re.finditer(r"t:\s*([\d.]+)\s+TARGET.*?M:\s*(-?[\d.]+)", proc.stderr):
        t, m = int(float(match.group(1))), float(match.group(2))
        per_sec[t] = max(per_sec.get(t, -120.0), m)
    if not per_sec:
        sys.exit("Could not measure loudness; is there audio?")
    length = max(per_sec) + 1
    return [per_sec.get(i, -120.0) for i in range(length)]


def pick_moments(levels, count):
    """Score each second by how far it jumps above the 20s before it (a reaction), then grow a window around it."""
    n = len(levels)
    scored = []
    for i in range(20, n - 5):
        before = sorted(levels[i - 20:i])[10]  # median of the 20s before
        peak = max(levels[i:i + 3])
        scored.append((peak - before + 0.15 * (peak + 30), i))
    scored.sort(reverse=True)
    picks = []
    for score, i in scored:
        start = max(0, i - 14)            # the setup usually sits ~10-15s before the reaction
        end = min(n, i + 8)               # end right after the reaction
        if any(not (end <= s or start >= e) for _, s, e in picks):
            continue
        picks.append((round(score, 1), start, end))
        if len(picks) >= count:
            break
    best = scored[0][0] if scored else 1
    return [{"start": s, "end": e, "score": sc, "virality_estimate": max(5, min(95, int(sc / best * 80)))} for sc, s, e in picks]


def probe(path: Path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", str(path)],
                         capture_output=True, text=True, check=True).stdout
    stream = json.loads(out)["streams"][0]
    return int(stream["width"]), int(stream["height"])


EMOJI = re.compile("[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF\uFE0F\u200D]+")


def render_hook(text: str, path: Path):
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.truetype(FONT, 58)
    emoji_font = None
    if Path(EMOJI_FONT).exists():
        try:
            emoji_font = ImageFont.truetype(EMOJI_FONT, 109)
        except OSError:
            emoji_font = None
    words_only = EMOJI.sub("", text).strip()
    emoji = "".join(EMOJI.findall(text)).replace("\uFE0F", "").replace("\u200D", "")
    lines = textwrap.wrap(words_only, width=24)[:4]
    if emoji and emoji_font:
        lines[-1] = lines[-1] + " " + "\u2003" * len(emoji)  # space reserved for the emoji, level with the text
    line_h = 72
    pad = 34
    canvas_w = 1080
    measure = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    widths = [measure.textlength(line, font=font) for line in lines]
    box_w = int(min(canvas_w - 80, max(widths) + pad * 2))
    box_h = line_h * len(lines) + pad * 2 - 10
    img = Image.new("RGBA", (canvas_w, box_h + 20), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    x0 = (canvas_w - box_w) // 2
    draw.rounded_rectangle([x0, 0, x0 + box_w, box_h], radius=26, fill=(255, 255, 255, 255))
    y = pad - 6
    for idx, line in enumerate(lines):
        w = measure.textlength(line, font=font)
        x = (canvas_w - w) / 2
        draw.text((x, y), line, font=font, fill=(0, 0, 0, 255))
        if idx == len(lines) - 1 and emoji and emoji_font:
            ex = x + measure.textlength(line.rstrip("\u2003 "), font=font) + 14
            for ch in emoji:
                try:
                    tile = Image.new("RGBA", (136, 128), (0, 0, 0, 0))
                    ImageDraw.Draw(tile).text((0, 0), ch, font=emoji_font, embedded_color=True)
                    tile = tile.resize((60, 56))
                    img.alpha_composite(tile, (int(ex), int(y + 4)))
                    ex += 62
                except Exception as error:  # colour emoji unsupported: keep the text, skip the emoji
                    print("emoji skipped:", error)
                    break
        y += line_h
    img.save(path)


def cut(source: Path, start: float, duration: float, hook_png, target: Path):
    w, h = probe(source)
    vertical = h > w
    inputs = ["-ss", f"{start:.2f}", "-t", f"{duration:.2f}", "-i", str(source)]
    if vertical:
        graph = "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[base]"
    else:
        graph = ("[0:v]split[a][b];"
                 "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2[bg];"
                 "[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[base]")
    if hook_png:
        inputs += ["-i", str(hook_png)]
        graph += ";[base][1:v]overlay=(W-w)/2:250[v]"
    else:
        graph += ";[base]null[v]"
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", "[v]", "-map", "0:a?",
         "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(target)])


def main():
    if not URL:
        sys.exit("CLIP_URL is required")
    hook_png = None
    if HOOK:
        hook_png = WORK / "hook.png"
        render_hook(HOOK, hook_png)
        (OUT / "caption.txt").write_text(HOOK + "\n")

    if START and END:
        moments = [{"start": seconds(START), "end": seconds(END), "score": None, "virality_estimate": None}]
    else:
        levels = loudness_per_second(download_audio())
        moments = pick_moments(levels, COUNT)
    (OUT / "candidates.json").write_text(json.dumps(moments, indent=2))

    for n, moment in enumerate(moments, 1):
        lead = 1.5
        s = max(0.0, moment["start"] - lead)
        e = moment["end"]
        source = download_section(s, e, f"section_{n}")
        cut(source, 0.0, e - s, hook_png, OUT / f"clip_{n}.mp4")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as fh:
            fh.write("## Clips\n\n| # | start | end | virality |\n|---|---|---|---|\n")
            for n, m in enumerate(moments, 1):
                fh.write(f"| {n} | {m['start']:.0f}s | {m['end']:.0f}s | {m['virality_estimate'] if m['virality_estimate'] is not None else '-'} |\n")
    print(json.dumps(moments))


if __name__ == "__main__":
    main()
