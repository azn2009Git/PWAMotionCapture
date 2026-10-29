import os
import math
from PIL import Image, ImageDraw

def create_mocap_icon(size, is_maskable=False):
    # Create image with RGBA
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    center = size / 2.0
    scale = size / 512.0

    # Background
    if is_maskable:
        # Full bleed square for maskable
        draw.rectangle([0, 0, size, size], fill=(11, 15, 25, 255))
    else:
        # Rounded squircle for standard icons
        radius = size * 0.22
        draw.rounded_rectangle([0, 0, size, size], radius=radius, fill=(11, 15, 25, 255))

    # Outer subtle accent glow ring
    outer_r = 190.0 * scale
    draw.ellipse([center - outer_r, center - outer_r, center + outer_r, center + outer_r],
                 outline=(30, 45, 75, 255), width=max(1, int(4 * scale)))

    # Outer segmented orbital / motion ring
    orbit_r = 150.0 * scale
    for deg in range(0, 360, 15):
        rad = math.radians(deg)
        x1 = center + (orbit_r - 6 * scale) * math.cos(rad)
        y1 = center + (orbit_r - 6 * scale) * math.sin(rad)
        x2 = center + (orbit_r + 6 * scale) * math.cos(rad)
        y2 = center + (orbit_r + 6 * scale) * math.sin(rad)
        draw.line([x1, y1, x2, y2], fill=(45, 85, 140, 200), width=max(1, int(3 * scale)))

    # Gimbal / Gyroscope Ellipses
    # Horizontal tilted ellipse
    tilt_w = 120.0 * scale
    tilt_h = 55.0 * scale
    draw.ellipse([center - tilt_w, center - tilt_h, center + tilt_w, center + tilt_h],
                 outline=(0, 210, 255, 240), width=max(2, int(6 * scale)))

    # Vertical tilted ellipse
    vert_w = 55.0 * scale
    vert_h = 120.0 * scale
    draw.ellipse([center - vert_w, center - vert_h, center + vert_w, center + vert_h],
                 outline=(147, 51, 234, 230), width=max(2, int(6 * scale)))

    # Inner circular core
    core_r = 60.0 * scale
    draw.ellipse([center - core_r, center - core_r, center + core_r, center + core_r],
                 outline=(16, 185, 129, 255), width=max(2, int(5 * scale)))

    # Crosshair axes
    cross_len = 80.0 * scale
    draw.line([center - cross_len, center, center + cross_len, center],
              fill=(0, 210, 255, 180), width=max(1, int(3 * scale)))
    draw.line([center, center - cross_len, center, center + cross_len],
              fill=(0, 210, 255, 180), width=max(1, int(3 * scale)))

    # Glowing center sensor core
    node_r = 20.0 * scale
    draw.ellipse([center - node_r, center - node_r, center + node_r, center + node_r],
                 fill=(255, 255, 255, 255))
    inner_node = 12.0 * scale
    draw.ellipse([center - inner_node, center - inner_node, center + inner_node, center + inner_node],
                 fill=(0, 229, 255, 255))

    # 4 satellite tracking dots (like motion capture markers!)
    marker_dist = 115.0 * scale
    marker_r = 9.0 * scale
    angles = [math.radians(45), math.radians(135), math.radians(225), math.radians(315)]
    colors = [(0, 229, 255, 255), (16, 185, 129, 255), (245, 158, 11, 255), (236, 72, 153, 255)]
    for ang, col in zip(angles, colors):
        mx = center + marker_dist * math.cos(ang)
        my = center + marker_dist * math.sin(ang)
        draw.ellipse([mx - marker_r, my - marker_r, mx + marker_r, my + marker_r], fill=col)

    return img

def main():
    icons_dir = r"C:\Abyss\PWAMotionCapture\icons"
    os.makedirs(icons_dir, exist_ok=True)

    sizes = [
        (180, "icon-180.png", False),
        (192, "icon-192.png", False),
        (512, "icon-512.png", False),
        (512, "icon-maskable-512.png", True),
    ]

    for size, filename, is_maskable in sizes:
        img = create_mocap_icon(size, is_maskable=is_maskable)
        filepath = os.path.join(icons_dir, filename)
        img.save(filepath, "PNG")
        print(f"Generated {filepath} ({size}x{size})")

    # Also save apple-touch-icon.png in icons/ and root for best compatibility
    img180 = create_mocap_icon(180, is_maskable=False)
    img180.save(os.path.join(icons_dir, "apple-touch-icon.png"), "PNG")
    img180.save(r"C:\Abyss\PWAMotionCapture\apple-touch-icon.png", "PNG")
    print("Saved apple-touch-icon.png")

    # Save favicon.png (32x32)
    img32 = create_mocap_icon(32, is_maskable=False)
    img32.save(os.path.join(icons_dir, "favicon-32.png"), "PNG")
    img32.save(r"C:\Abyss\PWAMotionCapture\favicon.ico", "ICO")
    print("Saved favicon.ico")

if __name__ == "__main__":
    main()
