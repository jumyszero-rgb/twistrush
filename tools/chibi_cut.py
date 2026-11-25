# 白背景のシートを切り分け：外側の白（ふちからつながる白）だけ透明にし、かたまりを一番近いマスに割り当てる
import sys, numpy as np, cv2
from PIL import Image
src, ids, out = sys.argv[1], sys.argv[2].split(','), sys.argv[3]
cols, rows = int(sys.argv[4]) if len(sys.argv) > 4 else 5, int(sys.argv[5]) if len(sys.argv) > 5 else 2
rgb = np.array(Image.open(src).convert('RGB')).astype(np.int16); H, W, _ = rgb.shape
wh = (rgb.min(axis=2) > 228) & ((rgb.max(axis=2) - rgb.min(axis=2)) < 22)
n, lab = cv2.connectedComponents(wh.astype(np.uint8), connectivity=4)
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
bg = np.isin(lab, list(border))
# 大きい白の穴（キャラのすき間）も背景：面積が大きく、ほぼ真っ白
for i in range(1, n):
    if i in border: continue
    m = lab == i
    if m.sum() > 2500 and rgb[m].min(axis=1).mean() > 245: bg |= m
fg = ~bg
fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
# ふちのやわらかさ：背景に接する前景の、白っぽさでアルファを下げる
dist = cv2.distanceTransform(fg, cv2.DIST_L2, 3)
whiteness = (rgb.min(axis=2) - 180).clip(0, 75) / 75.0
alpha = np.where(fg > 0, 255, 0).astype(np.float32)
edge = (fg > 0) & (dist < 2.5)
alpha[edge] = 255 * (1 - 0.85 * whiteness[edge])
rgba = np.dstack([rgb.astype(np.uint8), alpha.clip(0, 255).astype(np.uint8)])
nc, cl, st, cen = cv2.connectedComponentsWithStats(fg, connectivity=8)
cells = {k: np.zeros((H, W), bool) for k in range(len(ids))}
# 大きいかたまり（体）はマスで決める。小さいかけら（炎・玉・きらきら）は、いちばん近い体のものにする（となりのキャラのかけらが混ざらないように）
boxes = {}
for i in range(1, nc):
    if st[i, cv2.CC_STAT_AREA] < 5000: continue
    cx, cy = cen[i]; c = min(cols - 1, int(cx * cols / W)); r = min(rows - 1, int(cy * rows / H)); k = r * cols + c
    if k >= len(ids): continue
    cells[k] |= cl == i
    x, y, w, h = st[i, 0], st[i, 1], st[i, 2], st[i, 3]
    bx = boxes.get(k); boxes[k] = (x, y, x + w, y + h) if bx is None else (min(bx[0], x), min(bx[1], y), max(bx[2], x + w), max(bx[3], y + h))
for i in range(1, nc):
    a = st[i, cv2.CC_STAT_AREA]
    if a < 40 or a >= 5000 or not boxes: continue
    cx, cy = cen[i]
    d = {k: np.hypot(max(b[0] - cx, 0, cx - b[2]), max(b[1] - cy, 0, cy - b[3])) for k, b in boxes.items()}
    cells[min(d, key=d.get)] |= cl == i
sheet = Image.new('RGBA', (cols * 200, rows * 200), (60, 60, 70, 255))
for k, gid in enumerate(ids):
    if gid == '-' or not cells[k].any(): continue
    ys, xs = np.where(cells[k]); a = rgba.copy(); a[..., 3] = np.where(cells[k], a[..., 3], 0)
    cc = Image.fromarray(a[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
    s = min(240 / cc.width, 248 / cc.height)
    cc = cc.resize((max(1, round(cc.width * s)), max(1, round(cc.height * s))), Image.LANCZOS)
    o = Image.new('RGBA', (256, 256), (0, 0, 0, 0)); o.paste(cc, ((256 - cc.width) // 2, 256 - cc.height - 4), cc)
    o.save(f'{out}/{gid}.webp', quality=88)
    r, c = divmod(k, cols); t = o.resize((190, 190)); sheet.paste(t, (c * 200 + 5, r * 200 + 5), t)
sheet.save(f'{out}/_check.png')
