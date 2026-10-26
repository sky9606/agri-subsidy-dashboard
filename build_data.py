# -*- coding: utf-8 -*-
"""为大屏生成 dashboard/data.js（聚合数据，前端直接读取，无需服务端）

设计要点：
1. 行政区合并（兵团/农垦/计划单列市 → 所属省）在 Python 侧一次完成，
   前端拿到的 statsYear / provYear / catAll ... 全部以「省级单元」为键，
   地图省名直接对应 ChinaGeo 的 name，避免中文名不一致导致漏省份。
2. 品目名称归一（去掉「（含渔船用）」这类范围注记），避免同名品目被拆成两条。
"""
import os
import json
import sqlite3
from collections import defaultdict
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
DB = os.path.join(ROOT, "data", "subsidy.db")
OUT = os.path.join(BASE, "data.js")

YEARS = [2021, 2022, 2023, 2024, 2025, 2026]

# 价格带（左开右闭：0 < price <= 1000）
PRICE_BANDS = [(0, 1000, "≤1千"), (1000, 3000, "1千-3千"), (3000, 5000, "3千-5千"),
               (5000, 10000, "5千-1万"), (10000, 20000, "1万-2万"), (20000, 10 ** 9, ">2万")]

# 区域名 → 省级单元名（键必须是 GeoJSON 里的省名，否则地图不上色）
UNIT_OF = {
    "黑龙江": "黑龙江省",
    "北大荒农垦集团": "黑龙江省",
    "新疆维吾尔自治区": "新疆维吾尔自治区",
    "新疆生产建设兵团": "新疆维吾尔自治区",
    "广东省": "广东省",
    "广东省农垦总局": "广东省",
    "福建省": "福建省",
    "福建厦门": "福建省",
    "浙江省": "浙江省",
    "浙江宁波": "浙江省",
    "辽宁省": "辽宁省",
    "辽宁大连": "辽宁省",
    "山东省": "山东省",
    "山东青岛": "山东省",
}

# 品目名称归一：去掉尾部范围注记
CAT_SUFFIX = ("（含渔船用）", "(含渔船用)", "（含渔船）", "(含渔船)")


def unit_of(region):
    return UNIT_OF.get(region, region)


def norm_cat(name):
    s = (name or "").strip()
    changed = True
    while changed:
        changed = False
        for suf in CAT_SUFFIX:
            if s.endswith(suf):
                s = s[:-len(suf)].strip()
                changed = True
    return s


def topn(d, n):
    return [[k, round(v, 1)] for k, v in sorted(d.items(), key=lambda kv: -kv[1])[:n]]


def town_out(counties):
    """county -> {year: [[town,[qty,amt]], ...] TOP12}"""
    out = {}
    for c, towns in counties.items():
        years = set()
        for _, yd in towns.items():
            years.update(yd.keys())
        d2 = {}
        for y in years:
            lst = [[t, [round(yd[y][0], 1), round(yd[y][1], 0)]]
                   for t, yd in towns.items() if y in yd]
            lst.sort(key=lambda x: -x[1][0])
            d2[str(y)] = lst[:10]
        out[c] = d2
    return out


def main():
    db = sqlite3.connect(DB, timeout=120)
    db.row_factory = sqlite3.Row
    cur = db.cursor()

    # stats[u][y] = [records, qty, amount, subsidy, counties(set), dealers(set), towns(set)]
    stats = defaultdict(lambda: defaultdict(lambda: [0, 0.0, 0.0, 0.0, set(), set(), set()]))
    county_qt = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0.0, 0.0])))
    cstats = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0, 0.0, 0.0, 0.0, set()])))
    cmonth = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0.0, 0.0])))
    cprice = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(float))))
    ccat = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(float))))
    cfac = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(float))))
    town_qt = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))))
    cat_y = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    fac_y = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    deal_y = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    cat_a = defaultdict(lambda: defaultdict(float))
    fac_a = defaultdict(lambda: defaultdict(float))
    deal_a = defaultdict(lambda: defaultdict(float))
    month = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))
    price_y = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    model_y = defaultdict(lambda: defaultdict(float))
    # --- 搜索索引专用（保持小基数以保证前端可整表下发）---
    model_p = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))  # 型号 -> 省 -> 年 -> 台
    model_a = defaultdict(float)                                            # 型号 -> 销售额
    model_fac = defaultdict(lambda: defaultdict(float))                     # 型号 -> 厂家 -> 台
    fac_amt = defaultdict(float)                                            # 厂家 -> 销售额
    dealer_geo = {}                                                         # 经销商 -> (省, 县)

    print("扫描明细表 ...")
    n = 0
    rows = cur.execute("""
        SELECT region, year, county, town, category, factory, dealer, model,
               substr(buy_date,1,7) AS ym, qty, unit_price, total_subsidy
        FROM records
    """)
    for r in rows:
        n += 1
        u = unit_of(r["region"])
        y = r["year"]
        q = r["qty"] or 0
        amt = (r["unit_price"] or 0) * (q or 1)
        sub = r["total_subsidy"] or 0
        county = r["county"]
        town = r["town"]
        dealer = r["dealer"]
        cat = norm_cat(r["category"])
        fac = r["factory"]

        for key in (u, "全国"):
            for yy in (y, "all"):
                s = stats[key][yy]
                s[0] += 1
                s[1] += q
                s[2] += amt
                s[3] += sub
                if county:
                    s[4].add((key, county))
                if dealer:
                    s[5].add(dealer)
                if town:
                    s[6].add((county or "", town))

        if county:
            c = county_qt[u][county][y]
            c[0] += q
            c[1] += amt
            for yy in (y, "all"):
                cs2 = cstats[u][county][yy]
                cs2[0] += 1
                cs2[1] += q
                cs2[2] += amt
                cs2[3] += sub
                if town:
                    cs2[4].add(town)
            if r["ym"]:
                cm = cmonth[u][county][r["ym"]]
                cm[0] += q
                cm[1] += amt
            if cat:
                for yy in (y, "all"):
                    ccat[u][county][yy][cat] += q
            if fac:
                for yy in (y, "all"):
                    cfac[u][county][yy][fac] += q
        if town:
            for yy in (y, "all"):
                t = town_qt[u][county or ""][town][yy]
                t[0] += q
                t[1] += amt

        if cat:
            cat_y[u][y][cat] += q
            cat_y["全国"][y][cat] += q
            cat_a[u][cat] += q
            cat_a["全国"][cat] += q
        if fac:
            fac_y[u][y][fac] += q
            fac_y["全国"][y][fac] += q
            fac_a[u][fac] += q
            fac_a["全国"][fac] += q
            fac_amt[fac] += amt
        if dealer:
            deal_y[u][y][dealer] += q
            deal_y["全国"][y][dealer] += q
            deal_a[u][dealer] += q
            deal_a["全国"][dealer] += q
            if dealer not in dealer_geo:
                dealer_geo[dealer] = (u, county or "")
        if r["model"]:
            model_y[r["year"]][r["model"]] += q
            model_p[r["model"]][u][y] += q
            model_a[r["model"]] += amt
            if fac:
                model_fac[r["model"]][fac] += q

        if r["ym"]:
            for key in (u, "全国"):
                m = month[key][r["ym"]]
                m[0] += q
                m[1] += amt

        up = r["unit_price"] or 0
        for lo, hi, label in PRICE_BANDS:
            if lo < up <= hi:
                for key in (u, "全国"):
                    price_y[key][y][label] += q
                    price_y[key]["all"][label] += q
                if county:
                    for yy in (y, "all"):
                        cprice[u][county][yy][label] += q
                break

    print("  记录 %d 条" % n)

    # --- 组装输出 ---
    stats_out = {}
    for u, yd in stats.items():
        d = {}
        for y, s in yd.items():
            # counties 用 (unit, county) 去重后按 county 名再计；同一县名跨区域不会重名，直接取 len
            d[str(y)] = [int(s[0]), round(s[1], 1), round(s[2], 0), round(s[3], 0),
                         len({c for _, c in s[4]}), len(s[5]), len({t for _, t in s[6]})]
        stats_out[u] = d

    units = sorted([u for u in stats_out if u != "全国"])

    # ---------------- 搜索索引 ----------------
    # 只收录小基数维度（省/区县/厂家/型号/品目/经销商/乡镇），前端线性扫一遍即可即时出结果。
    # 购机者姓名按脱敏要求不入索引。每条记录末尾的 y6 是 2021–2026 逐年销量，供搜索命中后按当前年份过滤。
    uidx = {u: i for i, u in enumerate(units)}

    def y6(getter):
        return [int(getter(y) or 0) for y in YEARS]

    s_u, s_c, s_t, s_f, s_m, s_k, s_d = [], [], [], [], [], [], []
    cidx = {}

    for u in units:
        st = stats_out[u]
        s_u.append([u, st["all"][1], y6(lambda y: (st.get(str(y)) or [0, 0, 0])[1])])

    for u in units:
        for c in sorted(county_qt[u]):
            yd = county_qt[u][c]
            tot = sum(v[0] for v in yd.values())
            if tot <= 0:
                continue
            cidx[(u, c)] = len(s_c)
            s_c.append([c, uidx[u], tot, y6(lambda y: yd.get(y, [0, 0])[0])])

    for u in units:
        for c, tmap in town_qt[u].items():
            ci = cidx.get((u, c))
            if ci is None:
                continue
            for t, yd in tmap.items():
                tot = sum(v[0] for v in yd.values())
                if tot <= 0:
                    continue
                s_t.append([t, ci, tot, y6(lambda y: yd.get(y, [0, 0])[0])])

    fac_names = set()
    for d in fac_y["全国"].values():
        fac_names.update(d)
    for fac in fac_names:
        per = [0] * 6
        prov = defaultdict(float)
        for u in units:
            for i, y in enumerate(YEARS):
                v = fac_y[u].get(y, {}).get(fac, 0)
                if v:
                    per[i] += v
                    prov[u] += v
        tot = sum(per)
        if tot <= 0:
            continue
        top = sorted(prov.items(), key=lambda kv: -kv[1])[:6]
        s_f.append([fac, tot, fac_amt.get(fac, 0), per,
                    [[uidx[u], v] for u, v in top], len(prov)])

    for mdl, pdata in model_p.items():
        per = [0] * 6
        prov = defaultdict(float)
        for u, yd in pdata.items():
            for i, y in enumerate(YEARS):
                v = yd.get(y, 0)
                if v:
                    per[i] += v
                    prov[u] += v
        tot = sum(per)
        if tot <= 0:
            continue
        fc = model_fac.get(mdl)
        fac = max(fc.items(), key=lambda kv: kv[1])[0] if fc else ""
        top = sorted(prov.items(), key=lambda kv: -kv[1])[:6]
        s_m.append([mdl, fac, tot, model_a.get(mdl, 0), per,
                    [[uidx[u], v] for u, v in top], len(prov)])

    cat_names = set()
    for d in cat_y["全国"].values():
        cat_names.update(d)
    for cat in cat_names:
        per = y6(lambda y: cat_y["全国"].get(y, {}).get(cat, 0))
        prov = defaultdict(float)
        for u in units:
            for y in YEARS:
                v = cat_y[u].get(y, {}).get(cat, 0)
                if v:
                    prov[u] += v
        top = sorted(prov.items(), key=lambda kv: -kv[1])[:6]
        s_k.append([cat, sum(per), per, [[uidx[u], v] for u, v in top], len(prov)])

    dealer_year = defaultdict(lambda: [0] * 6)
    dealer_unit = {}
    for u in units:
        for y, dd in deal_y[u].items():
            i = YEARS.index(y)
            for dl, v in dd.items():
                dealer_year[dl][i] += v
                dealer_unit.setdefault(dl, u)
    for dl, per in dealer_year.items():
        tot = sum(per)
        if tot <= 0:
            continue
        u = dealer_unit.get(dl, units[0])
        c = dealer_geo.get(dl, (u, ""))[1]
        s_d.append([dl, uidx[u], cidx.get((u, c), -1), tot, per])

    for arr, ki in ((s_c, 2), (s_t, 2), (s_f, 1), (s_m, 2), (s_k, 1), (s_d, 3)):
        arr.sort(key=lambda x, ki=ki: -x[ki])
    search = {"u": s_u, "c": s_c, "t": s_t, "f": s_f, "m": s_m, "k": s_k, "d": s_d}

    def intify(x):
        if isinstance(x, float):
            return int(round(x))
        if isinstance(x, list):
            return [intify(v) for v in x]
        return x

    search = {k: intify(v) for k, v in search.items()}
    print("搜索索引: 省 %d / 区县 %d / 乡镇 %d / 厂家 %d / 型号 %d / 品目 %d / 经销商 %d"
          % (len(s_u), len(s_c), len(s_t), len(s_f), len(s_m), len(s_k), len(s_d)))


    out = {
        "meta": {
            "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "years": YEARS,
            "latestMonth": max(month["全国"].keys()) if month["全国"] else "",
            "units": units,
            "source": "全国农机购置与应用补贴信息公开平台（各省公示系统）",
            "scope": "补贴机具范围＝田间监测及作业监控设备（品目代码 07）",
            "note": "销售额＝单台销售价格×购买数量；购机者信息已按脱敏要求不展示",
        },
        # 省级单元/全国 -> 年 -> [records, qty, amount, subsidy, counties, dealers, towns]
        "statsYear": stats_out,
        # 省级单元 -> 省 -> 县 -> 年 -> [qty, amount]
        "countyYear": {u: {c: {str(y): [round(v[0], 1), round(v[1], 0)] for y, v in yd.items()}
                           for c, yd in cs.items()} for u, cs in county_qt.items()},
        # 省级单元 -> 县 -> 年 -> [records, qty, amount, subsidy, towns]
        "countyStat": {u: {c: {str(y): [int(v[0]), round(v[1], 1), round(v[2], 0), round(v[3], 0), len(v[4])]
                                for y, v in yd.items()}
                           for c, yd in cs.items()} for u, cs in cstats.items()},
        # 省级单元 -> 县 -> 年 -> [[镇, [qty, amount]], ...] TOP12
        "townOfCounty": {u: town_out(cs) for u, cs in town_qt.items()},
        "catYear": {u: {str(y): topn(d, 10) for y, d in yd.items()} for u, yd in cat_y.items()},
        "facYear": {u: {str(y): topn(d, 12) for y, d in yd.items()} for u, yd in fac_y.items()},
        "dealerYear": {u: {str(y): topn(d, 12) for y, d in yd.items()} for u, yd in deal_y.items()},
        "catAll": {u: topn(d, 14) for u, d in cat_a.items()},
        "facAll": {u: topn(d, 20) for u, d in fac_a.items()},
        "dealerAll": {u: topn(d, 40) for u, d in deal_a.items()},
        "modelTop": {str(y): topn(d, 12) for y, d in model_y.items()},
        "monthSeries": {u: {k: [round(v[0], 1), round(v[1], 0)] for k, v in sorted(md.items())}
                        for u, md in month.items()},
        "priceBands": {u: {str(y): [[lab, round(d.get(lab, 0), 1)] for _, _, lab in PRICE_BANDS]
                           for y, d in yd.items()} for u, yd in price_y.items()},
        # 县级明细：品目/厂家/价格带/月度（保证下钻到县时所有面板口径一致）
        "countyDetail": {
            u: {
                c: {
                    "month": {k: [round(v[0], 1), round(v[1], 0)] for k, v in sorted(cmonth[u][c].items())},
                    "cat": {str(y): topn(d, 4) for y, d in ccat[u][c].items()},
                    "fac": {str(y): topn(d, 5) for y, d in cfac[u][c].items()},
                    "price": {str(y): [[lab, round(d[lab], 1)] for _, _, lab in PRICE_BANDS if d.get(lab)]
                              for y, d in cprice[u][c].items()},
                } for c in cstats[u]
            } for u in cstats
        },
        # 搜索索引：u 省 / c 区县 / t 乡镇 / f 厂家 / m 型号 / k 品目 / d 经销商
        "search": search,
    }

    js = "window.DASH_DATA = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)
    print("已生成:", OUT, "%.2f MB" % (len(js.encode("utf-8")) / 1024 / 1024))

    nat = out["statsYear"]["全国"]["all"]
    print("全国合计: 记录 %d / 机具 %.0f 台 / 销售额 %.2f 亿元 / 补贴 %.2f 亿元 / 区县 %d / 经销商 %d"
          % (nat[0], nat[1], nat[2] / 1e8, nat[3] / 1e8, nat[4], nat[5]))

    # 一致性自检：各省相加应等于全国
    tot = [0, 0.0, 0.0, 0.0]
    for u in units:
        s = out["statsYear"][u]["all"]
        for i in range(4):
            tot[i] += s[i]
    ok = abs(tot[0] - nat[0]) < 1 and abs(tot[1] - nat[1]) < 1
    print("省份相加: 记录 %d / 机具 %.0f / 销售额 %.2f 亿  → %s"
          % (tot[0], tot[1], tot[2] / 1e8, "一致 ✓" if ok else "不一致 ✗"))
    print("省级单元 %d 个" % len(units))
    db.close()


if __name__ == "__main__":
    main()
