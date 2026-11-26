# 2026-11-27 スキル作りなおし（本人と決めた。Notion「スキル作りなおし案（2026-11-27）」）
# 103人の技の中身を、タイプ・属性・見た目のルールで作りなおして index.html に書きこむ。技の名前は変えない
#   必殺技＝メイン＋タイプサブ1＋汎用サブ1（小〜中）／奥義＝メイン＋タイプサブ2＋汎用サブ2（小〜大）。Nは奥義なし、Rは小さめの奥義
#   メイン＝タイプの基本効果＋特有スキル（見た目に合うもの、なければ属性から）
import re, json, sys
F = sys.argv[1] if len(sys.argv) > 1 else 'index.html'
s = open(F, encoding='utf-8').read()
attr = dict(re.findall(r"'([^']+)': '(\w+)'", re.search(r"const ATTR_GACHA = \{(.*?)\};", s).group(1)))
POS = {'N': 0, 'R': .25, 'SR': .5, 'MR': .75, 'LR': 1}

def mk(kind, g):
    t = POS[g]
    if kind == 'sp': a = t * .5            # 必殺技：範囲の下半分
    elif g == 'R': a = .25                   # Rの奥義：小さめ
    else: a = t                              # 奥義：範囲ぜんぶ
    def v(lo, hi, step=1): return int(round((lo + (hi - lo) * a) / step) * step) if step >= 1 else round(lo + (hi - lo) * a, 1)
    return v

# ---- 特有スキル（v＝数字の決め方）
U = {
  '爆発':   lambda v: [['dmg', v(5, 20), '爆発']],
  '延焼':   lambda v: [['dot', v(1, 3), v(5, 10), '延焼']],
  '煉獄':   lambda v: [['focus', v(10, 40, 5), '煉獄']],
  '感電':   lambda v: [['shock', v(1, 3)]],
  '雷撃':   lambda v: [['dot', v(1, 5), v(3, 8), '雷撃']],
  '落雷':   lambda v: [['cols', v(1, 2)]],
  '氷結':   lambda v: [['edeb', 'spd', v(5, 12), v(30, 60, 5)]],
  '潮流':   lambda v: [['regen', v(10, 40, 5), v(8, 12)]],
  '大波':   lambda v: [['rows', v(1, 2)]],
  '岩壁':   lambda v: [['guard', v(20, 50, 5), v(5, 12)]],
  '地割れ': lambda v: [['dmg', v(5, 15), '地割れ']],
  '石化':   lambda v: [['erew', v(3, 10)]],
  '疾風':   lambda v: [['chg', v(3, 10)]],
  '竜巻':   lambda v: [['tempest', v(20, 50, 5)]],
  'かまいたち': lambda v: [['diag', v(4, 8)]],
  '聖光':   lambda v: [['cleanse', v(30, 80, 10)]],
  '閃光':   lambda v: [['evade', 100 - v(30, 60, 5), v(8, 15)]],
  '裁き':   lambda v: [['dmg', v(5, 15), '裁き']],
  '吸血':   lambda v: [['drain', v(5, 20), 50]],
  '呪い':   lambda v: [['edeb', 'atk', v(5, 12), v(15, 35, 5)]],
  '影縫い': lambda v: [['stop', v(2, 5)]],
  '見切り': lambda v: [['parry', v(1, 3)]],
  '集中':   lambda v: [['critup', v(20, 50, 5), v(200, 300, 10), v(5, 15)]],
  '早業':   lambda v: [['chg', v(3, 10)]],
  '不死鳥': lambda v: [['gheart', 1], ['dot', v(1, 3), v(5, 10), '延焼']],
  '毒':     lambda v: [['dot', v(1, 3), v(6, 12), '毒']],
  '出血':   lambda v: [['dot', v(1, 3), v(5, 10), '出血']],
  '料理':   lambda v: [['regen', v(10, 40, 5), v(8, 12)]],
  '色ぬり': lambda v: [['colorx']],
}
BY_ATTR = {'fire': ['爆発', '延焼', '煉獄'], 'thunder': ['感電', '雷撃', '落雷'], 'water': ['氷結', '潮流', '大波'], 'earth': ['岩壁', '地割れ', '石化'],
  'wind': ['疾風', '竜巻', 'かまいたち'], 'light': ['聖光', '閃光', '裁き'], 'dark': ['吸血', '呪い', '影縫い'], 'none': ['見切り', '集中', '早業']}
# 見た目で決めるキャラ
MOTIF = {'エリザ': '吸血', 'ヴォルカ': '煉獄', 'フェニア': '不死鳥', 'ヒョウガ': '氷結', 'セツナ': '氷結', 'メェル': '感電', 'ボルテクス': '雷撃', 'ナルカミ': '雷撃', 'ライガ': '感電',
  'ボルティ': '落雷', 'ポッピー': '爆発', 'マリーナ': '爆発', 'ケルベロ': '影縫い', 'ヴェイル': '影縫い', 'マリオン': '影縫い', 'ノクス': '石化', 'ハーブ': '料理', 'グラタ': '料理',
  'ホクホ': '料理', 'ミルフィ': '料理', 'シズク': '潮流', 'サーラ': '毒', 'ローザ': '出血', 'ディーラ': '竜巻', 'パレ': '色ぬり', 'ルミエル': '裁き', 'ダスティ': '集中', 'ソウマ': '集中',
  'ジン': '集中', 'キキ': '閃光', 'トリオン': '爆発', 'ヒノカ': '爆発', 'ボーボ': '延焼', 'マグ': '延焼', 'ロウ': '延焼', 'ポルチ': '毒', 'リリ': '呪い', 'ノワール': '呪い',
  'カザキリ': 'かまいたち', 'シャオ': '疾風', 'ゼファー': '疾風', 'ナミ': '大波', 'アビスシェル': '大波', 'ガイアロ': '岩壁', 'グランディオ': '地割れ', 'ゴルダ': '地割れ', 'ガルナ': '地割れ'}

MAIN = {'hp': lambda v: [['heal', v(5, 50, 1)]],
        'def': lambda v: [['buf', 'def', v(5, 15), v(130, 300, 10)]],
        'spd': lambda v: [['buf', 'spd', v(5, 15), v(120, 200, 10)]],
        'atk': lambda v: [['buf', 'atk', v(5, 15), v(120, 200, 10)]]}
# タイプサブ（k＝必殺技で使うときの形、o＝奥義で使うときの形。なければ同じ）
TSUB = {
  'hp': [('じわじわ回復', lambda v: [['regen', v(5, 50, 5), v(8, 15)]]), ('ゴールドハート', lambda v: [['gheart', 1]]),
         ('全アップ', lambda v: [['allup', v(5, 15), v(110, 150, 5)]]), ('属性反転', lambda v: [['flip', v(110, 125), v(10, 15)]]),
         ('デバフ軽減', lambda v, og=False: [['field', v(30, 100, 10), v(15, 30)]] if og else [['cleanse', v(30, 100, 10)]])],
  'def': [('さらに防御', lambda v: [['buf2', 'def', v(3, 15), v(120, 150, 5)]]), ('敵の防御ダウン', lambda v: [['edeb', 'def', v(3, 15), v(5, 50, 5)]]),
          ('反射', lambda v: [['reflect', v(5, 100, 5), v(5, 12)]]), ('回復', lambda v: [['heal', v(5, 10)]])],
  'spd': [('敵のスピードダウン', lambda v: [['eslow', v(20, 50, 5), v(5, 15)]]), ('時間ストップ', lambda v: [['stop', v(2, 5)]]), ('技の時間短縮', lambda v: [['chg', v(3, 10)]]),
          ('ダメージ回避', lambda v: [['evade', 100 - v(40, 70, 5), v(15, 30)]]), ('クリティカル', lambda v: [['critup', v(30, 60, 5), v(200, 300, 10), v(5, 30)]]), ('回復', lambda v: [['heal', v(5, 10)]])],
  'atk': [('さらに攻撃', lambda v: [['buf2', 'atk', v(5, 15), v(110, 150, 5)]]), ('敵の攻撃ダウン', lambda v: [['edeb', 'atk', v(5, 15), v(20, 50, 5)]]),
          ('直接ダメージ', lambda v: [['dmg', v(5, 30)]]), ('防御貫通', lambda v: [['pierce', v(30, 100, 10), v(3, 15)]]), ('一点集中', lambda v: [['focus', v(5, 30)]]), ('回復', lambda v: [['heal', v(5, 10)]])],
}
GSUB = [('オクタ', lambda v: [['octa', v(2, 10)]]), ('ブロック破壊', None), ('カラー変換', lambda v: [['colorx']]), ('シャッフル', lambda v: [['tempest', v(10, 50, 5)]])]
def destroy(g, og, h):
    big = {'N': 0, 'R': 1, 'SR': 2, 'MR': 3, 'LR': 4}[g] + (1 if og else 0)
    opts = [[['clr', 4 + 2 * big]], [['diag', min(8, 4 + big)]], [['cross', min(13, 5 + 2 * big)]], [['rect', min(5, 2 + big // 2 + (1 if og else 0)), min(5, 2 + (big + 1) // 2)]]]
    return opts[h % 4]

def pick(lst, n, h, avoid=()):
    out, i = [], 0
    cand = [x for x in lst if x[0] not in avoid]
    while len(out) < n and cand:
        x = cand[(h + i * 7) % len(cand)]
        if x not in out: out.append(x)
        i += 1
        if i > 50: break
    return out

def build(c, kind):
    g, ty, nm, h = c['grade'], c['type'], c['name'], c['h']
    v = mk(kind, g); og = kind == 'ougi'
    uniq = MOTIF.get(nm) or BY_ATTR[attr.get(nm, 'none')][h % 3]
    fx = MAIN[ty](v) + U[uniq](v)
    nt = 1 if (kind == 'sp' or g == 'R') else 2
    avoid = {'回復'} if ty == 'hp' else set()
    if uniq in ('疾風', '早業'): avoid.add('技の時間短縮')
    # 同じ種類の効果が2つ入らないようにする（例：竜巻＋シャッフル）
    kinds = lambda L: {('eslow' if x[0] == 'edeb' and x[1] == 'spd' else x[0] + (x[1] if x[0] in ('buf', 'buf2', 'edeb') else '')) for x in L}
    def add(cands, n, seed, mkfx):
        nonlocal fx
        got = 0
        for i in range(len(cands) * 3):
            if got >= n: break
            name, fn = cands[(seed + i * 7) % len(cands)]
            if name in avoid: continue
            new = mkfx(name, fn)
            if kinds(new) & kinds(fx): continue
            fx += new; got += 1; avoid.add(name)
    add(TSUB[ty], nt, h + (3 if og else 0), lambda name, fn: fn(v, og) if name == 'デバフ軽減' else fn(v))
    add(GSUB, nt, h * 3 + (1 if og else 0), lambda name, fn: destroy(g, og, h + (1 if og else 0)) if fn is None else fn(v))
    return fx, uniq

# R の奥義の名前（Rは今まで奥義がなかったので、新しくつける）
R_OUGI = {'g48': '銀狼の大旋回', 'g49': 'いなずま大嵐', 'g50': 'かぶと城の大盾', 'g51': '水晶の泉', 'g52': '全砲門・一斉発射', 'g53': '砂嵐の双曲刀', 'g54': 'からくり大行進',
  'g55': 'ダイヤモンド・スピン', 'g56': 'マグマ大噴火', 'g57': 'ロイヤル・フラッシュ', 'g58': '獅子王の大舞', 'g59': 'グリフォン・ダイブ', 'g60': '真夜中の大怪盗', 'g61': '千年の森の知恵',
  'g62': '満月のもちつき大会', 'g63': '深海の大ちょうちん', 'g64': 'いばらの花吹雪', 'g65': 'メカ・フルスロットル', 'g66': 'ひまわり畑の大行進', 'g67': '大嵐の羽ばたき',
  'g75': '夜の劇場・大喝采', 'g79': '火吹き大サーカス'}

out_lines, table = [], []
def fxs(fx): return json.dumps(fx, ensure_ascii=False)
cnt = 0
def rep(m):
    global cnt
    line = m.group(0)
    k = re.search(r'k: "(g\d+)"', line).group(1); nm = re.search(r'name: "([^"]+)"', line).group(1)
    g = re.search(r'grade: "(\w+)"', line).group(1); ty = re.search(r'type: "(\w+)"', line).group(1)
    c = {'grade': g, 'type': ty, 'name': nm, 'h': int(k[1:]) * 37 % 101}
    spfx, uq = build(c, 'sp')
    line = re.sub(r'sp: \{n: "([^"]+)", fx: \[.*?\]\]', lambda mm: 'sp: {n: "' + mm.group(1) + '", fx: ' + fxs(spfx), line, count=1)
    if g != 'N':
        ogfx, _ = build(c, 'ougi')
        if re.search(r'ougi: \{n: "', line):
            line = re.sub(r'ougi: \{n: "([^"]+)", fx: \[.*?\]\]', lambda mm: 'ougi: {n: "' + mm.group(1) + '", fx: ' + fxs(ogfx), line, count=1)
        else:
            line = re.sub(r'(sp: \{n: "[^"]+", fx: \[.*?\]\]\})', lambda mm: mm.group(1) + ', ougi: {n: "' + R_OUGI[k] + '", fx: ' + fxs(ogfx) + '}', line, count=1)
    if 'noTune' not in line: line = line.replace('{k: "' + k + '",', '{k: "' + k + '", noTune: true, uq: "' + uq + '",', 1)
    else: line = re.sub(r'uq: "[^"]*", ', '', line).replace('noTune: true,', 'noTune: true, uq: "' + uq + '",', 1)
    cnt += 1
    return line
s2 = re.sub(r'^\s*\{k: "g\d+",( noTune: true,)?( uq: "[^"]*",)? name:.*$', rep, s, flags=re.M)
open(F, 'w', encoding='utf-8').write(s2)
print('rewrote', cnt)
