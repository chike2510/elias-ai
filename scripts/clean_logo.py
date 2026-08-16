from pathlib import Path
from PIL import Image

source = Path('/home/ubuntu/work/github-elias/brand/elias-logo-gate.png')
target = Path('/home/ubuntu/work/github-elias/brand/elias-logo-gate-final.png')
image = Image.open(source).convert('RGBA')
pixels = image.load()
for y in range(image.height):
    for x in range(image.width):
        r, g, b, a = pixels[x, y]
        green_strength = g - max(r, b)
        if g > 95 and green_strength > 18:
            pixels[x, y] = (r, g, b, 0)
        elif green_strength > 5 and g > 70:
            alpha = max(0, int(a * (1 - min(1, green_strength / 80))))
            pixels[x, y] = (r, g, b, alpha)

alpha = image.getchannel('A')
bbox = alpha.getbbox()
if bbox:
    pad = max(24, min(image.size) // 18)
    left = max(0, bbox[0] - pad)
    top = max(0, bbox[1] - pad)
    right = min(image.width, bbox[2] + pad)
    bottom = min(image.height, bbox[3] + pad)
    image = image.crop((left, top, right, bottom))

canvas_size = max(image.size)
canvas = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
canvas.alpha_composite(image, ((canvas_size - image.width) // 2, (canvas_size - image.height) // 2))
canvas.save(target, 'PNG', optimize=True)
for size, name in [(512, 'elias-logo-512.png'), (192, 'elias-logo-192.png')]:
    canvas.resize((size, size), Image.Resampling.LANCZOS).save(target.with_name(name), 'PNG', optimize=True)
print(target)
