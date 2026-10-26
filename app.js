/* ============ 全国农机补贴数据大屏 · 逻辑 ============ */
(function () {
  'use strict';

  var D = window.DASH_DATA;
  var S = { year: 'all', metric: 'qty', prov: null, county: null, tab: 'region' };
  var YEAR_LIST = ['all'].concat(D.meta.years.map(String));
  var UNITS = D.meta.units || [];

  /* ---------- 工具 ---------- */
  function fmtInt(n) {
    if (n == null || isNaN(n)) return '-';
    return Math.round(n).toLocaleString('en-US');
  }
  function fmtQty(n) {
    if (n == null || isNaN(n)) return '-';
    if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
    if (n >= 1e4) return (n / 1e4).toFixed(2) + ' 万';
    return fmtInt(n);
  }
  function fmtMoney(n) {
    if (n == null || isNaN(n)) return '-';
    if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万';
    return fmtInt(n);
  }
  /* 坐标轴用：短、无单位空格 */
  function fmtShort(n) {
    if (n == null || isNaN(n)) return '';
    if (Math.abs(n) >= 1e8) return +(n / 1e8).toFixed(1) + '亿';
    if (Math.abs(n) >= 1e4) return +(n / 1e4).toFixed(0) + '万';
    return String(Math.round(n));
  }
  function pct(a, b) { return b ? (a / b * 100) : 0; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
  function shortProv(n) {
    return String(n || '').replace(/(维吾尔|壮族|回族|特别行政区|自治区|省|市)/g, '') || n;
  }

  /* ---------- 作用域：全国 / 省 / 县 ---------- */
  function scopeName() { return S.county || S.prov || '全国'; }
  function scopeProv() { return S.prov || '全国'; }

  function statOf(y) {
    if (S.county && S.prov) {
      var c = ((D.countyStat[S.prov] || {})[S.county] || {})[y];
      if (!c) return null;
      return [c[0], c[1], c[2], c[3], 1, 0, c[4]];
    }
    var s = (D.statsYear[scopeName()] || {})[y];
    return s || null;
  }

  /* ---------- 序列读取 ---------- */
  function countyDetail() {
    return ((D.countyDetail || {})[S.prov] || {})[S.county] || null;
  }
  function scopeLabel() {
    return S.county ? S.county : (S.prov ? shortProv(S.prov) : '全国');
  }

  function series(key, n) {
    if (S.county) {
      var cd = countyDetail();
      if (cd && cd[key]) return (cd[key][S.year] || []).slice(0, n);
      // 无县级口径（如经销商）→ 回落到省级，调用方需按省级分母计算占比
    }
    var scope = scopeProv();
    var out;
    if (S.year === 'all') {
      out = (D[key + 'All'] || {})[scope] || (D[key + 'All'] || {})['全国'] || [];
    } else {
      out = ((D[key + 'Year'] || {})[scope] || {})[S.year] || [];
    }
    return out.slice(0, n);
  }

  function countiesOf(u) {
    var cs = D.countyYear[u] || {};
    return Object.keys(cs).map(function (c) {
      var yy = cs[c];
      if (S.year === 'all') {
        var it = (D.countyStat[u] || {})[c] || {};
        var a = it['all'] || [0, 0, 0, 0, 0];
        return [c, a[1], a[2]];
      }
      var v = yy[S.year] || [0, 0];
      return [c, v[0], v[1]];
    }).filter(function (d) { return d[1] > 0; })
      .sort(function (a, b) { return b[1] - a[1]; });
  }

  function townsOf(u, c) {
    var m = ((D.townOfCounty[u] || {})[c] || {})[S.year] || [];
    return m.map(function (d) { return [d[0], d[1][0], d[1][1]]; });
  }

  function scopeMonths() {
    if (S.county) {
      var cd = countyDetail();
      var cm = (cd && cd.month) || {};
      var ks = Object.keys(cm).sort();
      if (S.year !== 'all') ks = ks.filter(function (k) { return k.indexOf(S.year + '-') === 0; });
      return ks.map(function (k) { return { m: k, qty: cm[k][0], amt: cm[k][1] }; });
    }
    var key = (D.monthSeries[scopeProv()] ? scopeProv() : '全国');
    var ms = D.monthSeries[key] || {};
    var keys = Object.keys(ms).sort();
    if (S.year !== 'all') keys = keys.filter(function (k) { return k.indexOf(S.year + '-') === 0; });
    return keys.map(function (k) { return { m: k, qty: ms[k][0], amt: ms[k][1] }; });
  }

  function priceBands() {
    var labels = ['≤1千', '1千-3千', '3千-5千', '5千-1万', '1万-2万', '>2万'];
    var per;
    if (S.county) {
      var cd = countyDetail();
      per = (cd && cd.price && cd.price[S.year]) || [];
    } else {
      per = (D.priceBands[scopeProv()] || D.priceBands['全国'] || {})[S.year] || [];
    }
    var m = {};
    per.forEach(function (it) { m[it[0]] = it[1]; });
    return labels.map(function (l) { return [l, Math.round(m[l] || 0)]; });
  }

  /* ---------- 图表基础 ---------- */
  var AXIS = {
    line: { lineStyle: { color: 'rgba(90,150,220,.28)' } },
    label: { color: '#8fb2d9', fontSize: 11 },
    split: { lineStyle: { color: 'rgba(90,150,220,.12)', type: 'dashed' } }
  };
  var TIP = {
    backgroundColor: 'rgba(6,20,40,.96)',
    borderColor: 'rgba(64,158,255,.45)',
    borderWidth: 1,
    textStyle: { color: '#dceaff', fontSize: 12 },
    padding: [7, 11],
    extraCssText: 'box-shadow:0 6px 20px rgba(0,0,0,.5);border-radius:6px;'
  };

  var charts = {};
  function ec(id) {
    if (!charts[id]) charts[id] = echarts.init(document.getElementById(id), null, { renderer: 'canvas' });
    return charts[id];
  }

  /* ---------- KPI ---------- */
  function renderKPI() {
    var st = statOf(S.year) || [0, 0, 0, 0, 0, 0, 0];
    var avg = st[1] ? st[2] / st[1] : 0;

    // 最新月份
    var ms = scopeMonths();
    var last = ms.length ? ms[ms.length - 1] : null;
    var prev = ms.length > 1 ? ms[ms.length - 2] : null;
    var mom = (last && prev && prev.qty) ? pct(last.qty - prev.qty, prev.qty) : null;
    var partial = last && last.m === D.meta.latestMonth;

    var cards;
    if (S.county) {
      cards = [
        { lab: '累计销量', val: fmtQty(st[1]), unit: '台', sub: '均价 <b>' + fmtInt(avg) + '</b> 元/台', cls: '' },
        { lab: '累计销售额', val: fmtMoney(st[2]), unit: '元', sub: '含补贴 <b>' + fmtMoney(st[3]) + '</b> 元', cls: 'k2' },
        { lab: '记录条数', val: fmtInt(st[0]), unit: '条', sub: '购机明细（已脱敏）', cls: 'k3' },
        { lab: '补贴总额', val: fmtMoney(st[3]), unit: '元', sub: '占销售额 <b>' + pct(st[3], st[2]).toFixed(1) + '%</b>', cls: 'k4' },
        { lab: '单台均价', val: fmtInt(avg), unit: '元', sub: '按销量加权', cls: 'k5' },
        { lab: '覆盖乡镇', val: fmtInt(st[6]), unit: '个', sub: '本区县内', cls: 'k6' }
      ];
    } else {
      cards = [
        { lab: '累计销量', val: fmtQty(st[1]), unit: '台', sub: '记录 <b>' + fmtInt(st[0]) + '</b> 条', cls: '' },
        { lab: '累计销售额', val: fmtMoney(st[2]), unit: '元', sub: '均价 <b>' + fmtInt(avg) + '</b> 元/台', cls: 'k2' },
        {
          lab: '最新月销量', val: last ? fmtInt(last.qty) : '-', unit: '台',
          sub: last ? (last.m + (partial ? '（未完）' : '') +
            (mom === null ? '' : ' · 环比 <b class="' + (mom >= 0 ? 'up' : 'down') + '">' + (mom >= 0 ? '+' : '') + mom.toFixed(1) + '%</b>')) : '无数据',
          cls: 'k3'
        },
        { lab: '补贴总额', val: fmtMoney(st[3]), unit: '元', sub: '占销售额 <b>' + pct(st[3], st[2]).toFixed(1) + '%</b>', cls: 'k4' },
        { lab: '覆盖区县', val: fmtInt(st[4]), unit: '个', sub: '乡镇 <b>' + fmtInt(st[6]) + '</b> 个', cls: 'k5' },
        {
          lab: '经销商数', val: fmtInt(st[5]), unit: '家',
          sub: st[5] ? '平均 <b>' + Math.round(st[1] / st[5]) + '</b> 台/家' : '—', cls: 'k6'
        }
      ];
    }

    document.getElementById('kpis').innerHTML = cards.map(function (c) {
      return '<div class="kpi ' + c.cls + '"><div class="lab">' + c.lab + '</div>' +
        '<div class="val">' + c.val + '<small>' + (c.unit || '') + '</small></div>' +
        '<div class="sub2">' + c.sub + '</div></div>';
    }).join('');

    // 无数据提示
    var note = document.getElementById('emptyNote');
    if (note) note.style.display = (st[0] === 0) ? 'block' : 'none';
  }

  /* ---------- 地图 ---------- */
  var mapChart = null;
  var BAND_COLORS = ['#103a6b', '#1560a8', '#1f8fd6', '#37d6ff', '#ffd166'];
  var NO_LABEL = { '北京市': 1, '天津市': 1, '上海市': 1, '香港特别行政区': 1, '澳门特别行政区': 1 };

  function sig2(x) {
    if (x <= 0) return 0;
    var e = Math.pow(10, Math.floor(Math.log(x) / Math.LN10) - 1);
    return Math.round(x / e) * e;
  }
  function fmtBand(v) {
    if (!v) return '0';
    if (v >= 1e8) return +(v / 1e8).toFixed(1) + ' 亿';
    if (v >= 1e4) return +(v / 1e4).toFixed(1) + ' 万';
    return fmtInt(v);
  }

  function buildPieces(vals) {
    var v = vals.slice().sort(function (a, b) { return a - b; });
    var n = v.length;
    var max = v[n - 1] || 1;
    var pick = function (p) { return v[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))]; };
    var cuts = [0];
    [0.3, 0.6, 0.85].forEach(function (p) {
      var x = sig2(pick(p));
      if (x > cuts[cuts.length - 1]) cuts.push(x);
    });
    var top = sig2(max);
    if (top > cuts[cuts.length - 1]) cuts.push(top);
    if (cuts.length < 2) cuts = [0, max];

    var pieces = [];
    for (var i = 0; i < cuts.length; i++) {
      var color = BAND_COLORS[Math.min(i, BAND_COLORS.length - 1)];
      if (i === cuts.length - 1) {
        pieces.push({ gte: cuts[i], color: color, label: fmtBand(cuts[i]) + ' 以上' });
      } else {
        pieces.push({ gte: cuts[i], lt: cuts[i + 1], color: color, label: fmtBand(cuts[i]) + ' – ' + fmtBand(cuts[i + 1]) });
      }
    }
    return { pieces: pieces, cuts: cuts };
  }

  function bandOf(v, cuts) {
    for (var i = 0; i < cuts.length - 1; i++) {
      if (v >= cuts[i] && v < cuts[i + 1]) return i;
    }
    return cuts.length - 1;
  }

  function renderMap() {
    if (!mapChart) {
      echarts.registerMap('china', window.CHINA_GEO);
      mapChart = ec('cMap');
      mapChart.on('click', function (p) {
        if (!p || !p.name || p.name === '南海诸岛') return;
        if (UNITS.indexOf(p.name) < 0) return;          // 无数据区域不响应
        S.county = null;
        S.prov = (S.prov === p.name) ? null : p.name;
        renderAll();
      });
    }

    var data = UNITS.map(function (u) {
      var st = (D.statsYear[u] || {})[S.year];
      if (!st) return null;
      return {
        name: u, value: S.metric === 'qty' ? st[1] : st[2],
        qty: st[1], amt: st[2], counties: st[4]
      };
    }).filter(function (d) { return d && d.value > 0; });

    var vals = data.map(function (d) { return d.value; });
    var bp = buildPieces(vals);

    data.forEach(function (d) {
      var bi = bandOf(d.value, bp.cuts);
      if (S.prov === d.name) {
        d.itemStyle = { areaColor: '#ffb648', borderColor: '#fff8e6', borderWidth: 1.6, shadowBlur: 20, shadowColor: 'rgba(255,182,72,.75)' };
        d.label = { show: true, color: '#2a1a00', fontWeight: 'bold', fontSize: 10.5 };
      } else {
        // 亮底用深色字、暗底用浅色字，保证都可读
        d.label = { color: bi >= 3 ? '#05243c' : 'rgba(198,226,255,.72)' };
      }
    });

    mapChart.setOption({
      backgroundColor: 'transparent',
      tooltip: Object.assign({}, TIP, {
        trigger: 'item',
        formatter: function (p) {
          if (!p.data || !p.data.qty) return '<b>' + p.name + '</b><br><span style="color:#7a99b8">暂无公示数据</span>';
          return '<b style="color:#37d6ff">' + p.name + '</b><br>' +
            '销量　　<b>' + fmtInt(p.data.qty) + '</b> 台<br>' +
            '销售额　<b>' + fmtMoney(p.data.amt) + '</b> 元<br>' +
            '覆盖区县 <b>' + fmtInt(p.data.counties) + '</b> 个' +
            (S.prov === p.name ? '<br><span style="color:#ffb648">已下钻 · 再次点击返回</span>' : '<br><span style="color:#5c7fa6">点击下钻</span>');
        }
      }),
      visualMap: {
        type: 'piecewise', pieces: bp.pieces, left: 14, top: 8,
        itemWidth: 12, itemHeight: 9, itemGap: 7, showLabel: true,
        textStyle: { color: '#8fb2d9', fontSize: 10 },
        selectedMode: false
      },
      series: [{
        type: 'map', map: 'china', roam: false,
        aspectScale: 0.78, layoutCenter: ['50%', '52%'], layoutSize: '110%',
        zoom: 1.05, center: [104.5, 36.2],
        label: {
          show: true, color: 'rgba(198,226,255,.72)', fontSize: 9.5,
          formatter: function (p) { return NO_LABEL[p.name] ? '' : shortProv(p.name); }
        },
        itemStyle: {
          areaColor: '#0a1c33',
          borderColor: 'rgba(84,160,245,.38)', borderWidth: .7,
          shadowColor: 'rgba(30,120,220,.45)', shadowBlur: 14, shadowOffsetY: 5
        },
        emphasis: {
          label: { show: true, color: '#fff', fontSize: 10.5, fontWeight: 'bold' },
          itemStyle: { areaColor: '#ffc85e', borderColor: '#fff', borderWidth: 1.2, shadowBlur: 24, shadowColor: 'rgba(255,182,72,.75)' }
        },
        select: { disabled: true },
        data: data
      }]
    }, true);
  }

  /* ---------- 品目 TOP10 ---------- */
  function renderCat() {
    var arr = series('cat', 10).slice().reverse();
    var names = arr.map(function (d) { return d[0]; });
    var tot = arr.reduce(function (s, d) { return s + d[1]; }, 0);
    var topShare = arr.length ? pct(arr[arr.length - 1][1], tot) : 0;
    document.getElementById('catHint').textContent =
      '按销量 · ' + scopeLabel() + ' · 首位占 ' + topShare.toFixed(1) + '%';
    ec('cCat').setOption({
      grid: { left: 6, right: 78, top: 10, bottom: 4, containLabel: true },
      tooltip: Object.assign({}, TIP, {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: function (ps) {
          var p = ps[0];
          return esc(names[p.dataIndex]) + '<br>销量 <b>' + fmtInt(p.value) + '</b> 台（' + pct(p.value, tot).toFixed(2) + '%）';
        }
      }),
      xAxis: {
        type: 'value', axisLabel: Object.assign({}, AXIS.label, { fontSize: 10, formatter: fmtShort }),
        splitNumber: 4, splitLine: AXIS.split, axisLine: { show: false }
      },
      yAxis: {
        type: 'category', data: arr.map(function (d) { return cut(d[0], 12); }),
        axisLabel: Object.assign({}, AXIS.label, { fontSize: 10.5 }), axisLine: AXIS.line, axisTick: { show: false }
      },
      series: [{
        type: 'bar', barWidth: 9, data: arr.map(function (d) { return d[1]; }),
        itemStyle: {
          borderRadius: [0, 5, 5, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: 'rgba(55,214,255,.20)' }, { offset: 1, color: '#37d6ff' }])
        },
        label: {
          show: true, position: 'right', color: '#9fd0f0', fontSize: 10,
          formatter: function (p) { return fmtShort(p.value) + '　' + pct(p.value, tot).toFixed(1) + '%'; }
        }
      }]
    }, true);
  }

  /* ---------- 价格带 ---------- */
  function renderPrice() {
    var arr = priceBands();
    var total = arr.reduce(function (s, d) { return s + d[1]; }, 0);
    var colors = ['#2ee6a8', '#37d6ff', '#6aa9ff', '#8a7cff', '#ffb648', '#ff6b8a'];
    var idx = {};
    arr.forEach(function (d, i) { idx[d[0]] = i; });

    ec('cPrice').setOption({
      tooltip: Object.assign({}, TIP, {
        trigger: 'item',
        formatter: function (p) { return p.name + ' 元<br>销量 <b>' + fmtInt(p.value) + '</b> 台（' + pct(p.value, total).toFixed(1) + '%）'; }
      }),
      legend: {
        orient: 'vertical', right: 8, top: 'middle', itemWidth: 8, itemHeight: 8, itemGap: 10,
        textStyle: { color: '#8fb2d9', fontSize: 11 },
        formatter: function (n) {
          var v = arr[idx[n]] ? arr[idx[n]][1] : 0;
          return n + '　' + pct(v, total).toFixed(0) + '%';
        }
      },
      graphic: [{
        type: 'text', left: '30%', top: '45%', style: {
          text: fmtQty(total).replace(' ', ''), fill: '#eaf4ff', fontSize: 17, fontWeight: 'bold', textAlign: 'center'
        }
      }, {
        type: 'text', left: '30%', top: '55.5%', style: {
          text: '台', fill: '#6f92b8', fontSize: 10, textAlign: 'center'
        }
      }],
      series: [{
        type: 'pie', radius: ['50%', '72%'], center: ['31%', '52%'], avoidLabelOverlap: true,
        itemStyle: { borderColor: 'rgba(4,14,30,.92)', borderWidth: 2 },
        label: {
          show: true, position: 'inside', color: '#04182b', fontSize: 10, fontWeight: 'bold',
          formatter: function (p) { return pct(p.value, total) >= 6 ? pct(p.value, total).toFixed(0) + '%' : ''; }
        },
        labelLine: { show: false },
        data: arr.filter(function (d) { return d[1] > 0; }).map(function (d) {
          return { name: d[0], value: d[1], itemStyle: { color: colors[idx[d[0]] % colors.length] } };
        })
      }]
    }, true);
    document.getElementById('priceHint').textContent =
      '单台价格 · ' + scopeLabel() + ' · ' + fmtQty(total) + ' 台';
  }

  /* ---------- 厂家市占 ---------- */
  function shortCorp(n) {
    var s = String(n || '').replace(/(股份有限公司|有限责任公司|有限公司|集团公司|公司)$/g, '').trim();
    return cut(s, 13);
  }

  function renderFac() {
    var arr = series('fac', 10);
    var st = statOf(S.year) || [0, 0];
    var scopeQty = st[1] || arr.reduce(function (s, d) { return s + d[1]; }, 0);
    var palette = ['#37d6ff', '#2ee6a8', '#ffb648', '#8a7cff', '#ff6b8a', '#6aa9ff', '#4dd0c1', '#c9a227', '#a06bff', '#ff9d6b'];
    var map = {};
    var data = arr.map(function (d, i) {
      var nm = shortCorp(d[0]) || d[0];
      map[nm] = d[1];
      return { name: nm, value: d[1], itemStyle: { color: palette[i % palette.length] } };
    });
    var covered = data.reduce(function (s, d) { return s + d.value; }, 0);
    var rest = Math.max(0, scopeQty - covered);
    if (rest > 0) data.push({ name: '其他厂家', value: rest, itemStyle: { color: 'rgba(90,130,175,.45)' } });

    document.getElementById('facHint').textContent =
      (S.county ? '占本县销量' : ('占' + (S.prov ? '全省' : '全国'))) + ' · ' + scopeLabel();

    ec('cFac').setOption({
      tooltip: Object.assign({}, TIP, {
        trigger: 'item',
        formatter: function (p) { return esc(p.name) + '<br>销量 <b>' + fmtInt(p.value) + '</b> 台（' + pct(p.value, scopeQty).toFixed(1) + '%）'; }
      }),
      legend: {
        type: 'scroll', orient: 'vertical', right: 4, top: 8, bottom: 8,
        itemWidth: 8, itemHeight: 8, itemGap: 7, pageIconSize: 8, pageIconColor: '#37d6ff', pageTextStyle: { color: '#5c7fa6', fontSize: 9 },
        textStyle: { color: '#8fb2d9', fontSize: 10 },
        formatter: function (n) { return n + '  ' + pct(map[n] || (scopeQty - covered), scopeQty).toFixed(0) + '%'; }
      },
      series: [{
        type: 'pie', radius: ['46%', '72%'], center: ['28%', '52%'],
        itemStyle: { borderColor: 'rgba(4,14,30,.92)', borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, color: '#fff', fontSize: 12, formatter: function (p) { return p.name + '<br>' + pct(p.value, scopeQty).toFixed(1) + '%'; } } },
        data: data
      }]
    }, true);
  }

  /* ---------- 右侧区域排行 ---------- */
  function renderRank() {
    var title = document.getElementById('rankTitle');
    var hint = document.getElementById('rankHint');
    var rows = [];

    if (S.county && S.prov) {
      title.textContent = '乡镇销量 TOP10';
      hint.textContent = S.county;
      rows = townsOf(S.prov, S.county).slice(0, 10).map(function (d) { return [d[0], d[1]]; });
    } else if (S.prov) {
      title.textContent = '区县销量 TOP10';
      hint.textContent = '点击省份下钻 · 点表格进乡镇';
      rows = countiesOf(S.prov).slice(0, 10).map(function (d) { return [d[0], d[1]]; });
    } else {
      title.textContent = '区域销量 TOP10';
      hint.textContent = '点击省份下钻';
      rows = UNITS.map(function (u) {
        var st = (D.statsYear[u] || {})[S.year];
        return [u, st ? st[1] : 0];
      }).filter(function (d) { return d[1] > 0; })
        .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10);
    }

    var arr = rows.slice().reverse();
    var ch = ec('cRank');
    ch.setOption({
      grid: { left: 6, right: 58, top: 8, bottom: 4, containLabel: true },
      tooltip: Object.assign({}, TIP, {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: function (ps) { var p = ps[0]; return esc(arr[p.dataIndex][0]) + '<br>销量 <b>' + fmtInt(p.value) + '</b> 台'; }
      }),
      xAxis: {
        type: 'value', axisLabel: Object.assign({}, AXIS.label, { fontSize: 10, formatter: fmtShort }),
        splitNumber: 4, splitLine: AXIS.split, axisLine: { show: false }
      },
      yAxis: {
        type: 'category', data: arr.map(function (d) {
          return S.prov && !S.county ? cut(d[0], 7) : (S.county ? cut(d[0], 8) : shortProv(d[0]));
        }),
        axisLabel: Object.assign({}, AXIS.label, { fontSize: 10.5 }), axisLine: AXIS.line, axisTick: { show: false }
      },
      series: [{
        type: 'bar', barWidth: 9, data: arr.map(function (d) { return d[1]; }),
        itemStyle: {
          borderRadius: [0, 5, 5, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: 'rgba(255,182,72,.16)' }, { offset: 1, color: '#ffb648' }])
        },
        label: { show: true, position: 'right', color: '#ffd9a3', fontSize: 10, formatter: function (p) { return fmtShort(p.value); } }
      }]
    }, true);

    ch.off('click');
    ch.on('click', function (p) {
      var name = arr[p.dataIndex] && arr[p.dataIndex][0];
      if (!name) return;
      if (S.county) return;
      if (!S.prov) { S.prov = name; S.county = null; renderAll(); }
      else { S.county = name; renderAll(); }
    });
  }

  /* ---------- 趋势 ---------- */
  function renderTrend() {
    var ms = scopeMonths();
    var labels = ms.map(function (d) { return d.m.slice(2); });
    var qty = ms.map(function (d) { return d.qty; });
    var amt = ms.map(function (d) { return +(d.amt / 1e4).toFixed(1); });

    document.getElementById('trendHint').textContent =
      (S.county ? S.county + ' · ' : '') + (S.year === 'all' ? '近 24 个月' : S.year + ' 年') +
      (S.year === '2026' ? '（截至 10 月）' : '');

    ec('cTrend').setOption({
      grid: { left: 54, right: 58, top: 30, bottom: 24 },
      tooltip: Object.assign({}, TIP, {
        trigger: 'axis',
        formatter: function (ps) {
          var i = ps[0].dataIndex;
          return labels[i] + '<br>销量 <b>' + fmtInt(qty[i]) + '</b> 台<br>销售额 <b>' + fmtMoney(ms[i].amt) + '</b> 元';
        }
      }),
      legend: {
        data: ['销量(台)', '销售额(万元)'], right: 10, top: 0, itemWidth: 10, itemHeight: 8, itemGap: 14,
        textStyle: { color: '#8fb2d9', fontSize: 10.5 }
      },
      xAxis: {
        type: 'category', data: labels,
        axisLabel: Object.assign({}, AXIS.label, { fontSize: 10, interval: 'auto', hideOverlap: true }),
        axisLine: AXIS.line, axisTick: { show: false }
      },
      yAxis: [
        {
          type: 'value', name: '台', nameTextStyle: { color: '#5c7fa6', fontSize: 10, padding: [0, 0, 0, -18] },
          axisLabel: Object.assign({}, AXIS.label, { fontSize: 10, formatter: fmtShort }),
          splitLine: AXIS.split, axisLine: { show: false }
        },
        {
          type: 'value', name: '万元', nameTextStyle: { color: '#5c7fa6', fontSize: 10, padding: [0, -22, 0, 0] },
          axisLabel: Object.assign({}, AXIS.label, { fontSize: 10, formatter: fmtShort }),
          splitLine: { show: false }, axisLine: { show: false }
        }
      ],
      series: [
        {
          name: '销量(台)', type: 'bar', barWidth: '44%', data: qty,
          itemStyle: {
            borderRadius: [3, 3, 0, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(55,214,255,.85)' }, { offset: 1, color: 'rgba(55,214,255,.10)' }])
          }
        },
        {
          name: '销售额(万元)', type: 'line', yAxisIndex: 1, data: amt, smooth: true, symbol: 'circle', symbolSize: 4,
          lineStyle: { width: 2, color: '#ffb648', shadowColor: 'rgba(255,182,72,.6)', shadowBlur: 10 },
          itemStyle: { color: '#ffb648' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(255,182,72,.26)' }, { offset: 1, color: 'rgba(255,182,72,0)' }])
          }
        }
      ]
    }, true);
  }

  /* ---------- 明细表 ---------- */
  function renderTable() {
    var tabs = document.getElementById('tabs');
    var regionName = S.county ? '乡镇排行' : (S.prov ? '区县排行' : '省份排行');
    var defs = [
      { k: 'region', n: regionName },
      { k: 'dealer', n: S.county ? '经销商(全省)' : '经销商排行' },
      { k: 'model', n: '机型排行' }
    ];
    tabs.innerHTML = defs.map(function (d) {
      return '<button class="' + (S.tab === d.k ? 'on' : '') + '" data-tab="' + d.k + '">' + d.n + '</button>';
    }).join('');
    Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (b) {
      b.onclick = function () { S.tab = b.getAttribute('data-tab'); renderTable(); };
    });

    var head, rows = [], scopeTotal = 0;

    if (S.tab === 'region') {
      var list;
      if (S.county && S.prov) {
        head = ['#', '乡镇', '销量(台)', '销售额', '占比'];
        list = townsOf(S.prov, S.county).map(function (d) { return { n: d[0], q: d[1], a: d[2] }; });
      } else if (S.prov) {
        head = ['#', '区县', '销量(台)', '销售额', '占比'];
        list = countiesOf(S.prov).slice(0, 60).map(function (d) { return { n: d[0], q: d[1], a: d[2] }; });
      } else {
        head = ['#', '省份', '销量(台)', '销售额', '占比'];
        list = UNITS.map(function (u) {
          var st = (D.statsYear[u] || {})[S.year];
          return { n: u, q: st ? st[1] : 0, a: st ? st[2] : 0 };
        }).filter(function (d) { return d.q > 0; }).sort(function (a, b) { return b.q - a.q; });
      }
      scopeTotal = list.reduce(function (s, d) { return s + d.q; }, 0);
      rows = list.map(function (d) { return [d.n, d.q, d.a, pct(d.q, scopeTotal)]; });
    } else if (S.tab === 'dealer') {
      head = ['#', '经销商', '销量(台)', '占' + (S.prov ? '全省' : '全国')];
      var dl = series('dealer', 40);
      // 经销商只在省/全国维度聚合，分母必须用同口径，避免县级下钻时占比失真
      var pv = (D.statsYear[S.prov || '全国'] || {})[S.year];
      scopeTotal = pv ? pv[1] : 0;
      rows = dl.map(function (d) { return [d[0], d[1], pct(d[1], scopeTotal)]; });
    } else {
      head = ['#', '机型', '销量(台)', '占全国'];
      var ml = [];
      if (S.year === 'all') {
        var mm = {};
        Object.keys(D.modelTop).forEach(function (y) {
          D.modelTop[y].forEach(function (it) { mm[it[0]] = (mm[it[0]] || 0) + it[1]; });
        });
        ml = Object.keys(mm).map(function (k) { return [k, mm[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 40);
      } else {
        ml = (D.modelTop[S.year] || []).slice(0, 40);
      }
      var natSt = (D.statsYear['全国'] || {})[S.year];
      scopeTotal = natSt ? natSt[1] : 0;
      rows = ml.map(function (d) { return [d[0], d[1], pct(d[1], scopeTotal)]; });
    }

    var maxQ = rows.length ? Math.max.apply(null, rows.map(function (r) { return r[1]; })) : 1;
    var html = '<table><thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>';

    rows.forEach(function (r, i) {
      var rk = i < 3 ? ' t' + (i + 1) : '';
      var name = esc(r[0]);
      var pctCell = '<td class="bar-cell"><i style="width:' + Math.max(4, Math.round(52 * r[r.length - 1] / 55)) + 'px"></i>' +
        r[r.length - 1].toFixed(1) + '%</td>';
      if (S.tab === 'region') {
        html += '<tr data-name="' + name + '"><td><span class="rk' + rk + '">' + (i + 1) + '</span>' + name + '</td>' +
          '<td>' + fmtInt(r[1]) + '</td><td>' + fmtMoney(r[2]) + '</td>' + pctCell + '</tr>';
      } else {
        html += '<tr><td><span class="rk' + rk + '">' + (i + 1) + '</span>' + name + '</td>' +
          '<td>' + fmtInt(r[1]) + '</td>' + pctCell + '</tr>';
      }
    });
    html += '</tbody></table>';
    document.getElementById('tableWrap').innerHTML = html;

    if (S.tab === 'region') {
      Array.prototype.forEach.call(document.querySelectorAll('#tableWrap tbody tr'), function (tr) {
        tr.onclick = function () {
          var n = tr.getAttribute('data-name');
          if (!S.prov && UNITS.indexOf(n) >= 0) { S.prov = n; S.county = null; renderAll(); }
          else if (S.prov && !S.county) { S.county = n; renderAll(); }
        };
      });
    }
  }

  /* ---------- 面包屑 ---------- */
  function renderCrumbs() {
    var el = document.getElementById('crumbs');
    var html = '<a class="' + (S.prov ? '' : 'cur') + '" data-lv="0">全国</a>';
    if (S.prov) {
      html += '<i>/</i><a class="' + (S.county ? '' : 'cur') + '" data-lv="1">' + esc(S.prov) + '</a>';
    }
    if (S.county) {
      html += '<i>/</i><a class="cur" data-lv="2">' + esc(S.county) + '</a>';
    }
    el.innerHTML = html;
    Array.prototype.forEach.call(el.querySelectorAll('a'), function (a) {
      a.onclick = function () {
        var lv = +a.getAttribute('data-lv');
        if (lv === 0) { S.prov = null; S.county = null; renderAll(); }
        else if (lv === 1) { S.county = null; renderAll(); }
      };
    });
  }

  /* ---------- 顶部控件 ---------- */
  function buildControls() {
    var ys = document.getElementById('yearSeg');
    ys.innerHTML = YEAR_LIST.map(function (y) {
      return '<button data-y="' + y + '" class="' + (S.year === y ? 'on' : '') + '">' + (y === 'all' ? '全部' : y) + '</button>';
    }).join('');
    Array.prototype.forEach.call(ys.querySelectorAll('button'), function (b) {
      b.onclick = function () { S.year = b.getAttribute('data-y'); buildControls(); renderAll(); };
    });

    var ms = document.getElementById('metricSeg');
    var defs = [{ k: 'qty', n: '销量' }, { k: 'amt', n: '销售额' }];
    ms.innerHTML = defs.map(function (d) {
      return '<button data-m="' + d.k + '" class="' + (S.metric === d.k ? 'on' : '') + '">' + d.n + '</button>';
    }).join('');
    Array.prototype.forEach.call(ms.querySelectorAll('button'), function (b) {
      b.onclick = function () { S.metric = b.getAttribute('data-m'); buildControls(); renderMap(); };
    });
  }

  /* ---------- 汇总 ---------- */
  function renderAll() {
    renderKPI();
    renderCrumbs();
    renderMap();
    renderCat();
    renderPrice();
    renderFac();
    renderRank();
    renderTrend();
    renderTable();
  }

  /* ---------- 自适应 ---------- */
  function fit() {
    var stage = document.getElementById('stage');
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = 'scale(' + s + ')';
    Object.keys(charts).forEach(function (k) { charts[k].resize(); });
  }

  /* ---------- 启动 ---------- */
  document.getElementById('updTime').textContent = D.meta.generated;
  document.getElementById('updRows').textContent = fmtInt((D.statsYear['全国'] || {})['all'][0]);
  buildControls();
  renderAll();
  fit();
  window.addEventListener('resize', fit);
})();
