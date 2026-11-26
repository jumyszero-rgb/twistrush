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

# ===== ストーリーキャラ（BOSS_FX）と住人（ZAKO_SK）も同じルールで（2026-11-27 本人「ストーリーキャラも修正して」）=====
# 必要なキャラ情報（タイプ・グレード・属性）は、ゲームから書き出した JSON（tools/skill_gen.py 第2引数）
if len(sys.argv) > 2:
    import hashlib
    meta = json.load(open(sys.argv[2], encoding='utf-8'))
    hh = lambda x: int(hashlib.md5(x.encode()).hexdigest()[:6], 16) % 101
    s = open(F, encoding='utf-8').read()
    for b in meta['boss']:
        attr[b['n']] = b['a']
        c = {'grade': b['g'], 'type': b['t'], 'name': b['n'], 'h': hh(b['id'])}
        sp, _ = build(c, 'sp'); og, _ = build(c, 'ougi')
        s, n = re.subn(r"^(    " + b['id'] + r": )\{sp: \[\[.*\},$", lambda m: m.group(1) + '{sp: ' + fxs(sp) + ', ougi: ' + fxs(og) + '},', s, count=1, flags=re.M)
        assert n == 1, b['id']
    for z in meta['zako']:
        attr[z['n']] = z['a']
        c = {'grade': z['g'], 'type': z['t'], 'name': z['n'], 'h': hh(z['k'])}
        sp, _ = build(c, 'sp')
        s, n = re.subn(r"^(    " + z['k'] + r": \{n: '[^']*', fx: ).*?(\]\])(\}.*)$", lambda m: m.group(1) + fxs(sp) + m.group(3), s, count=1, flags=re.M)
        assert n == 1, z['k']
    open(F, 'w', encoding='utf-8').write(s)
    print('story/zako rewrote', len(meta['boss']), len(meta['zako']))

# 住人のRにも奥義（2026-11-27 本人「Rは中ボスポジションだから奥義があっても良い」「名前は適当につけて良い」）
Z_OUGI = {'a1_02': 'ストロベリー・フェアリーワルツ', 'a1_04': 'ハニー・ストームニードル', 'a1_09': 'ぐつぐつジャム大鍋', 'a1_10': '大地の大たがやし', 'a2_02': '見習い騎士の大突撃',
  'a2_04': '百発百中の矢雨', 'a2_09': '木馬隊の大進撃', 'a2_10': 'ひかる本の大まちがい', 'a3_03': '禁書の大がぶり', 'a3_05': '氷岩の大城壁', 'a3_09': '星くらげの流星群',
  'a3_10': '三日月の大魔法', 'a4_01': 'ほうき星の大旋回', 'a4_06': '真夜中の特別授業', 'a4_09': '千年年輪の守り', 'a4_10': '星屑の大魔法陣', 'a5_02': '特製まんぷくディナー',
  'a5_03': '夜の屋根の大泥棒', 'a5_06': '猫の街の非常警戒', 'a5_10': '真珠の女王の号令', 'a6_04': 'フルシールド展開', 'a6_05': '超新星大実験', 'a6_08': 'ギガパワー・フルアーム',
  'a6_10': '全艦一斉発進', 'a7_05': '大つむじ風の舞', 'a7_07': '風刃・百連', 'a7_08': '大くじらの雲海潮ふき', 'a7_10': '天羽の大城門', 'a8_02': '九尾の狐火', 'a8_03': '天狗の大嵐',
  'a8_08': '大がま忍法・大津波', 'a8_09': '影鎖の大しばり', 'vol_08': '竜巫女の炎扇舞', 'vol_09': '溶岩の大鉄壁', 'vol_10': '灼熱の大鍛冶', 'sea_08': '甲板大そうじ大作戦',
  'sea_09': 'ゆうれい船の大合唱', 'sea_10': '八本足の大航海', 'pyr_08': '王墓の最後の審判', 'pyr_09': '大砂嵐の秘術', 'pyr_10': '黄金宝物庫の輝き', 'park_08': '大サーカス・ジャグリング',
  'park_09': '真夜中の大観覧車', 'park_10': 'スペード兵団の大突撃', 'clk_08': '流星群の大観測', 'clk_09': '歯車仕掛けの大盾', 'clk_10': '時を読む大時計', 'a9_03': 'からっぽ鎧の大行進',
  'a9_06': '石像群の目覚め', 'a9_07': '銀竜の大ブレス', 'a9_10': 'お姫さまの舞踏会'}
if len(sys.argv) > 2:
    s = open(F, encoding='utf-8').read(); k2 = 0
    for z in meta['zako']:
        if z['g'] != 'R': continue
        c = {'grade': 'R', 'type': z['t'], 'name': z['n'], 'h': hh(z['k'])}
        og, _ = build(c, 'ougi')
        s, n = re.subn(r"^(    " + z['k'] + r": \{n: '[^']*', fx: \[.*?\]\])(, og: \{.*?\]\]\})?\},$", lambda m: m.group(1) + ", og: {n: '" + Z_OUGI[z['k']] + "', fx: " + fxs(og) + "}},", s, count=1, flags=re.M)
        assert n == 1, z['k']; k2 += 1
    open(F, 'w', encoding='utf-8').write(s); print('zako R ougi', k2)
