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
import os
for i in range(1 if os.environ.get('KEEP_HOLES') != '1' else n, n):   # KEEP_HOLES=1：白い雲など、キャラの中の白を残す
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
# 1行のシート（建物など）：すき間（何もない縦の列）で区切る。大きい建物の重心がとなりのマスに入っても大丈夫
colOf = lambda cx: min(cols - 1, int(cx * cols / W))
if rows == 1 and cols > 1:
    proj = (fg > 0).sum(axis=0) > 0
    runs = []; x = 0
    while x < W:
        if proj[x]:
            x0 = x
            while x < W and proj[x]: x += 1
            runs.append([x0, x])
        else: x += 1
    runs = [r for r in runs if r[1] - r[0] > 8]
    while len(runs) > cols:   # すき間がいちばん狭いところからくっつける
        g = min(range(len(runs) - 1), key=lambda j: runs[j + 1][0] - runs[j][1])
        runs[g] = [runs[g][0], runs[g + 1][1]]; del runs[g + 1]
    if len(runs) == cols:
        bounds = [(runs[j][1] + runs[j + 1][0]) / 2 for j in range(cols - 1)]
        colOf = lambda cx: sum(cx > b for b in bounds)
# 大きいかたまりがちょうどマスの数だけあるときは、左から順に割り当てる（いちばん確実）
bigs = [i for i in range(1, nc) if st[i, cv2.CC_STAT_AREA] >= 5000]
if rows == 1 and len(bigs) == cols:
    order = sorted(bigs, key=lambda i: cen[i][0]); rank = {i: j for j, i in enumerate(order)}
else:
    rank = None
boxes = {}
for i in range(1, nc):
    if st[i, cv2.CC_STAT_AREA] < 5000: continue
    cx, cy = cen[i]; c = rank[i] if rank else colOf(cx); r = min(rows - 1, int(cy * rows / H)); k = r * cols + c
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
S = int(os.environ.get('SIZE', '256'))   # SIZE=512：建物など大きい絵
gs = None
if os.environ.get('SAME_SCALE') == '1':   # SAME_SCALE=1：全部を同じ倍率で縮める（Lv1〜5の大きさの差を残す）
    dims = [(np.ptp(np.where(cells[k])[1]) + 1, np.ptp(np.where(cells[k])[0]) + 1) for k, g in enumerate(ids) if g != '-' and cells[k].any()]
    gs = min(min(S * 0.94 / w, S * 0.97 / h) for w, h in dims)
for k, gid in enumerate(ids):
    if gid == '-' or not cells[k].any(): continue
    ys, xs = np.where(cells[k]); a = rgba.copy(); a[..., 3] = np.where(cells[k], a[..., 3], 0)
    cc = Image.fromarray(a[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
    s = gs if gs else min(S * 0.94 / cc.width, S * 0.97 / cc.height, 1.0)
    cc = cc.resize((max(1, round(cc.width * s)), max(1, round(cc.height * s))), Image.LANCZOS)
    o = Image.new('RGBA', (S, S), (0, 0, 0, 0)); o.paste(cc, ((S - cc.width) // 2, S - cc.height - S // 64), cc)
    o.save(f'{out}/{gid}.webp', quality=88)
    r, c = divmod(k, cols); t = o.resize((190, 190)); sheet.paste(t, (c * 200 + 5, r * 200 + 5), t)
sheet.save(f'{out}/_check.png')
