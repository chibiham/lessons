/* 深層学習入門 — インタラクティブ章の共通スクリプト
   - ページ骨格（章一覧・ページ内目次・前後ナビ・読了バー）
   - デモ用プレーヤー（再生 / 一時停止 / コマ送り / シーク / 速度）
   - DOM・SVG 生成や経路アニメーションの小さなヘルパー
   外部ライブラリには依存しない。 */
(() => {
  'use strict';

  const CHAPTERS = [
    ['0_overview.md', '概要と目次'],
    ['1_what_is_deep_learning.md', '深層学習とは何か'],
    ['2_neural_network_basics.md', 'ニューラルネットワークの基礎'],
    ['3_how_learning_works.md', '学習の仕組み'],
    ['4_evaluation_and_tuning.md', '学習の評価とチューニング'],
    ['5_cnn.html', 'CNN — 画像を扱う'],
    ['6_rnn_lstm_gru.html', 'RNN・LSTM・GRU'],
    ['7_attention_transformer.html', 'Attention と Transformer'],
    ['8_llm_and_generative_ai.md', 'LLM と生成 AI'],
    ['9_hands_on_and_review.md', 'ハンズオンと総復習']
  ];
  const chapterHref = file => file.endsWith('.html') ? file : 'index.html#' + file;

  const SVGNS = 'http://www.w3.org/2000/svg';
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reducedQuery.matches;

  function apply(el, attrs) {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') {
        for (const [p, val] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val);
      }
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    return el;
  }
  const kids = list => list.flat(Infinity).filter(k => k != null && k !== false).map(k => typeof k === 'number' ? String(k) : k);
  /** HTML 要素を作る */
  function h(tag, attrs, ...children) { const el = apply(document.createElement(tag), attrs); el.append(...kids(children)); return el; }
  /** SVG 要素を作る */
  function s(tag, attrs, ...children) { const el = apply(document.createElementNS(SVGNS, tag), attrs); el.append(...kids(children)); return el; }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fmt = (n, digits) => digits == null ? Number(n).toLocaleString('ja-JP') : Number(n).toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const esc = str => String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** 値 v（0〜1）に応じた単色の濃淡。文字色も合わせて返す */
  function shade(v, color = 'var(--blue)') {
    const pct = Math.round(clamp(v, 0, 1) * 88);
    return { background: `color-mix(in srgb, ${color} ${pct}%, var(--paper))`, color: pct > 52 ? '#fff' : 'var(--ink)' };
  }

  /** 経路に沿って点を流す（reduced motion では何もしない） */
  function flow(path, { dur = 700, r = 5, color = 'var(--blue)', reverse = false, delay = 0 } = {}) {
    if (reduced() || !path || !path.isConnected) return Promise.resolve();
    const parent = path.parentNode;
    const len = path.getTotalLength();
    const dot = s('circle', { r, class: 'flow-dot', style: { fill: color } });
    const start = path.getPointAtLength(reverse ? len : 0);
    dot.setAttribute('cx', start.x); dot.setAttribute('cy', start.y); dot.style.opacity = delay ? 0 : 1;
    parent.append(dot);
    return new Promise(resolve => {
      const t0 = performance.now() + delay;
      const frame = now => {
        if (!dot.isConnected) return resolve();
        const p = clamp((now - t0) / dur, 0, 1);
        if (now >= t0) dot.style.opacity = 1;
        const pt = path.getPointAtLength((reverse ? 1 - ease(p) : ease(p)) * len);
        dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
        if (p < 1) requestAnimationFrame(frame); else { dot.remove(); resolve(); }
      };
      requestAnimationFrame(frame);
    });
  }
  function cancelFlows(root) { root.querySelectorAll('.flow-dot').forEach(d => d.remove()); }

  /** 線を「描く」演出。show=false で消す */
  function drawLine(path, show, animate = true) {
    const len = path.getTotalLength();
    path.style.strokeDasharray = len;
    if (!animate || reduced()) { path.style.transition = 'none'; path.style.strokeDashoffset = show ? 0 : len; path.getBoundingClientRect(); path.style.transition = ''; return; }
    path.style.strokeDashoffset = show ? 0 : len;
  }

  /** 数字のカウントアップ */
  function countUp(el, to, { dur = 900, digits = 0, suffix = '' } = {}) {
    if (reduced()) { el.textContent = fmt(to, digits || null) + suffix; return; }
    const t0 = performance.now();
    const frame = now => {
      const p = clamp((now - t0) / dur, 0, 1);
      el.textContent = fmt(+(to * ease(p)).toFixed(digits), digits || null) + suffix;
      if (p < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** 要素 from の位置から to の位置へ、ラベルを飛ばす（FLIP） */
  function flyText(from, to, text, host) {
    if (reduced() || !from || !to) return;
    host = host || to.closest('.demo-stage') || document.body;
    const hr = host.getBoundingClientRect(), fr = from.getBoundingClientRect(), tr = to.getBoundingClientRect();
    const ghost = h('div', { class: 'mono', text, style: { position: 'absolute', left: (fr.left - hr.left + fr.width / 2) + 'px', top: (fr.top - hr.top + fr.height / 2) + 'px', transform: 'translate(-50%,-50%)', fontWeight: 800, fontSize: '.9rem', color: 'var(--ink)', background: 'color-mix(in srgb, var(--orange) 30%, var(--paper))', borderRadius: '6px', padding: '0 6px', pointerEvents: 'none', zIndex: 5 } });
    host.append(ghost);
    const dx = (tr.left + tr.width / 2) - (fr.left + fr.width / 2), dy = (tr.top + tr.height / 2) - (fr.top + fr.height / 2);
    const anim = ghost.animate([{ transform: 'translate(-50%,-50%)', opacity: 1 }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`, opacity: .9 }], { duration: 650, easing: 'cubic-bezier(.4,.1,.2,1)' });
    anim.onfinish = () => ghost.remove();
  }

  /** セグメントボタン（トグル） */
  function segmented({ label, options, value, onChange }) {
    const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    const buttons = options.map(([val, text]) => h('button', { type: 'button', 'aria-pressed': String(val === value), onclick: () => set(val, true) }, text));
    function set(val, fire) {
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === val)));
      value = val; if (fire) onChange(val);
    }
    wrap.append(...buttons);
    wrap.set = set;
    return label ? h('div', { class: 'opt' }, h('span', { text: label }), wrap) : wrap;
  }

  /** スライダー */
  function slider({ label, min, max, step, value, format = v => v, onInput }) {
    const out = h('output', { text: format(value) });
    const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label, oninput: () => { out.textContent = format(+input.value); onInput(+input.value); } });
    const el = h('label', { class: 'slider' }, h('span', { text: label }), input, out);
    el.input = input;
    el.set = v => { input.value = v; out.textContent = format(v); };
    return el;
  }

  /** 数値グリッド。values[r][c] を表示 */
  function grid(rows, cols, { cls = '', text } = {}) {
    const el = h('div', { class: 'grid ' + cls, style: { '--n': cols } });
    const cells = [];
    for (let r = 0; r < rows; r++) {
      cells.push([]);
      for (let c = 0; c < cols; c++) {
        const cell = h('div', { class: 'cell', text: text ? text(r, c) : '' });
        el.append(cell); cells[r].push(cell);
      }
    }
    return { el, cells };
  }

  /** ホバー用ツールチップ */
  let tipEl;
  function tooltip(target, html) {
    const show = e => {
      tipEl ||= document.body.appendChild(h('div', { class: 'tip-pop', role: 'tooltip' }));
      tipEl.innerHTML = typeof html === 'function' ? html() : html; tipEl.hidden = false;
      const r = target.getBoundingClientRect();
      const x = e && e.clientX ? e.clientX : r.left + r.width / 2, y = e && e.clientY ? e.clientY : r.top;
      const w = tipEl.offsetWidth;
      tipEl.style.left = clamp(x - w / 2, 8, innerWidth - w - 8) + 'px';
      tipEl.style.top = Math.max(8, y - tipEl.offsetHeight - 12) + 'px';
    };
    const hide = () => { if (tipEl) tipEl.hidden = true; };
    target.addEventListener('pointerenter', show); target.addEventListener('pointermove', show);
    target.addEventListener('pointerleave', hide); target.addEventListener('focus', () => show()); target.addEventListener('blur', hide);
  }

  /** 画面に入ったら一度だけ実行 */
  function onVisible(el, fn, threshold = .35) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { threshold });
    io.observe(el);
  }

  /** TeX 記法の数式を KaTeX で描画する（.m＝文中、.mb＝別行立て）。KaTeX を読み込めないときは TeX のまま表示される */
  // KaTeX の CSS が効いているか（読み上げ用 MathML が隠れるか）を確かめる。
  // JS だけ届いて CSS が届かないと式が二重に見えるため、そのときは TeX のまま表示する
  function katexStyled() {
    const probe = document.body.appendChild(h('span', { class: 'katex', style: { position: 'absolute', visibility: 'hidden' } }, h('span', { class: 'katex-mathml' })));
    const ok = getComputedStyle(probe.firstChild).position === 'absolute';
    probe.remove();
    return ok;
  }
  // 横スクロールの案内。数式やフォントの描画で幅が変わるので、そのたびに判定し直す
  let scrollHints = [];
  function checkScroll() { scrollHints.forEach(([el, hint]) => { hint.hidden = el.scrollWidth <= el.clientWidth + 2; }); }

  function renderMath(root = document) {
    if (!window.katex || !document.body || !katexStyled()) return;
    root.querySelectorAll('.m:not([data-tex]), .mb:not([data-tex])').forEach(el => {
      const tex = el.textContent;
      try {
        window.katex.render(tex, el, { displayMode: el.classList.contains('mb'), throwOnError: false, strict: false, output: 'htmlAndMathml' });
        el.dataset.tex = tex;
      } catch (e) { console.error('[math]', tex, e); }
    });
    checkScroll();
  }
  // KaTeX は async で読み込むので、読み込み完了時にも描画する
  ['katex-js', 'katex-css'].forEach(id => document.getElementById(id)?.addEventListener('load', () => renderMath()));

  const ICON = {
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>',
    prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12 2.5v11L4.5 8zM2.5 2.5h2v11h-2z"/></svg>',
    next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11L11.5 8zM11.5 2.5h2v11h-2z"/></svg>',
    reset: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5a5.5 5.5 0 1 1-5.2 3.7l1.7.6A3.7 3.7 0 1 0 8 4.3V6.5L4.5 3.4 8 .3z"/></svg>'
  };

  /**
   * 手順を 1 コマずつ見せるプレーヤー。
   * onStep(i, ctx) は「ステップ i の完成状態」を描く（どのステップへ飛んでも同じ見た目になるよう冪等に書く）。
   * ctx.forward が true のときだけ、点を流すなどの一過性の演出を行う。戻り値の文字列はキャプションになる。
   */
  class Player {
    constructor(root, opts) {
      this.root = root;
      this.opts = Object.assign({ interval: 1800, autoplay: true, holds: {} }, opts);
      this.steps = opts.steps; this.i = -1; this.playing = false; this.speed = 1; this.timer = 0; this.touched = false; this.visible = false;
      this.caption = root.querySelector('.demo-caption') || root.appendChild(h('p', { class: 'demo-caption' }));
      this.caption.setAttribute('aria-live', 'polite');
      this.build();
      this.go(0, false);
      this.watch();
    }
    build() {
      const bar = this.root.querySelector('.demo-controls') || this.root.appendChild(h('div', { class: 'demo-controls' }));
      const btn = (icon, label, fn, cls = 'btn') => h('button', { type: 'button', class: cls, 'aria-label': label, title: label, html: ICON[icon], onclick: () => { this.touched = true; fn(); } });
      this.bReset = btn('reset', '最初に戻る', () => { this.pause(); this.go(0); });
      this.bPrev = btn('prev', '1 つ戻る', () => { this.pause(); this.go(this.i - 1); });
      this.bPlay = btn('play', '再生', () => this.playing ? this.pause() : this.play(), 'btn primary');
      this.bNext = btn('next', '1 つ進む', () => { this.pause(); this.go(this.i + 1); });
      this.range = h('input', { type: 'range', min: 0, max: this.steps - 1, value: 0, step: 1, 'aria-label': 'ステップ', oninput: () => { this.touched = true; this.pause(); this.go(+this.range.value); } });
      this.count = h('span', { class: 'count' });
      this.speedSel = h('select', { 'aria-label': '再生速度', onchange: () => { this.speed = +this.speedSel.value; this.root.style.setProperty('--spd', this.speed); if (this.playing) this.schedule(); } },
        [['0.5', '0.5×'], ['1', '1×'], ['1.5', '1.5×'], ['2', '2×']].map(([v, t]) => h('option', { value: v, text: t, selected: v === '1' })));
      bar.append(this.bReset, this.bPrev, this.bPlay, this.bNext, this.range, this.count, this.speedSel);
      this.root.addEventListener('keydown', e => {
        if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); this.touched = true; this.pause(); this.go(this.i + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); this.touched = true; this.pause(); this.go(this.i - 1); }
      });
    }
    ms(v) { return v / this.speed; }
    setSteps(n) {
      this.steps = n; this.range.max = n - 1;
      this.pause(); this.i = -1; this.go(0, false);
    }
    /** 現在のステップを描き直す（オプション変更時など） */
    refresh() { const i = this.i; this.i = -1; this.go(i, false); }
    go(i, animate = true) {
      i = clamp(i, 0, this.steps - 1);
      const prev = this.i; this.i = i;
      cancelFlows(this.root);
      const forward = animate && !reduced() && i === prev + 1;
      const cap = this.opts.onStep(i, { prev, forward, animate: animate && !reduced(), player: this });
      if (cap != null) { this.caption.innerHTML = `<span class="step-no">${i + 1}/${this.steps}</span>` + cap; renderMath(this.caption); }
      this.range.value = i;
      this.count.textContent = `${i + 1} / ${this.steps}`;
      this.bPrev.disabled = i === 0; this.bNext.disabled = i === this.steps - 1;
      this.syncPlay();
    }
    play() {
      if (this.i >= this.steps - 1) this.go(0);
      this.playing = true; this.syncPlay(); this.schedule();
    }
    pause() { this.playing = false; clearTimeout(this.timer); this.syncPlay(); }
    schedule() {
      clearTimeout(this.timer);
      const base = this.opts.holds[this.i] ?? this.opts.interval;
      this.timer = setTimeout(() => {
        if (!this.playing) return;
        if (this.i >= this.steps - 1) { this.pause(); return; }
        this.go(this.i + 1); this.schedule();
      }, this.ms(base));
    }
    syncPlay() {
      const atEnd = this.i >= this.steps - 1 && !this.playing;
      this.bPlay.innerHTML = this.playing ? ICON.pause + '<span>停止</span>' : ICON.play + `<span>${atEnd ? 'もう一度' : '再生'}</span>`;
      this.bPlay.setAttribute('aria-label', this.playing ? '一時停止' : '再生');
    }
    watch() {
      if (!('IntersectionObserver' in window)) return;
      const io = new IntersectionObserver(entries => {
        const vis = entries.some(e => e.isIntersecting);
        this.visible = vis;
        if (vis && this.opts.autoplay && !this.touched && !this.autoplayed && !reduced()) { this.autoplayed = true; this.play(); }
        else if (!vis && this.playing) { this.pause(); this.resumable = true; }
        else if (vis && this.resumable) { this.resumable = false; this.play(); }
      }, { threshold: .45 });
      io.observe(this.root);
    }
  }

  /** Python の簡易シンタックスハイライト。行ごとに <span class="ln"> で包む */
  const PY = /(#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|\b(import|from|as|def|class|return|for|in|if|else|elif|while|with|lambda|not|and|or|is|pass|None|True|False|self|super)\b|\b(\d+(?:\.\d+)?(?:e-?\d+)?)\b|\b(print|range|len|sum|torch|nn|F|models)\b/g;
  function highlightPython(src) {
    return src.replace(/\n$/, '').split('\n').map(line => {
      let out = '', last = 0;
      line.replace(PY, (m, c, str, k, n, f, idx) => {
        out += esc(line.slice(last, idx));
        const cls = c ? 'c' : str ? 's' : k ? 'k' : n ? 'n' : 'f';
        out += `<span class="tok-${cls}">${esc(m)}</span>`;
        last = idx + m.length; return m;
      });
      out += esc(line.slice(last));
      return `<span class="ln">${out || ' '}</span>`;
    }).join('');
  }

  /** ページ骨格の初期化 */
  function initPage() {
    const current = document.body.dataset.chapter;
    const index = CHAPTERS.findIndex(c => c[0] === current);
    const nav = document.querySelector('.chapters');
    if (nav) CHAPTERS.forEach(([file, title], i) => {
      const a = h('a', { href: chapterHref(file) }, h('span', { class: 'number', text: String(i).padStart(2, '0') }), h('span', { text: title }),
        file.endsWith('.html') ? h('span', { class: 'badge', text: '動く図解' }) : null);
      if (i === index) a.setAttribute('aria-current', 'page');
      nav.append(a);
    });
    const menu = document.getElementById('chapter-menu');
    if (menu) {
      const mobile = matchMedia('(max-width:900px)');
      menu.open = !mobile.matches;
      mobile.addEventListener('change', e => { menu.open = !e.matches; });
    }
    const pager = document.querySelector('.pager');
    if (pager && index >= 0) {
      if (index > 0) pager.append(h('a', { href: chapterHref(CHAPTERS[index - 1][0]), text: '← ' + CHAPTERS[index - 1][1] }));
      if (index < CHAPTERS.length - 1) pager.append(h('a', { href: chapterHref(CHAPTERS[index + 1][0]), text: CHAPTERS[index + 1][1] + ' →' }));
    }
    // 数式は各章のデモ（数式パネルを含む）が組み上がった後に描画する
    setTimeout(renderMath, 0);
    // コードのハイライト
    document.querySelectorAll('pre code.python').forEach(code => { code.innerHTML = highlightPython(code.textContent); });
    // 表をスクロール可能に
    document.querySelectorAll('.lesson table').forEach(t => { if (!t.parentElement.classList.contains('table-wrap')) { const w = h('div', { class: 'table-wrap', tabindex: 0 }); t.before(w); w.append(t); } });
    // ページ内目次とスクロール連動
    const toc = document.getElementById('toc');
    const heads = [...document.querySelectorAll('.lesson h2, .lesson h3')];
    heads.forEach((hd, i) => { hd.id ||= 'sec-' + i; });
    if (toc) {
      const links = heads.map(hd => { const a = h('a', { href: '#' + hd.id, text: hd.textContent, class: hd.tagName === 'H3' ? 'sub' : '' }); toc.append(a); return a; });
      // 画面上部 30% より上にある最後の見出しを「現在地」とする
      let ticking = false;
      const spy = () => {
        ticking = false;
        const line = innerHeight * .3;
        let cur = -1;
        heads.forEach((hd, i) => { if (hd.getBoundingClientRect().top < line) cur = i; });
        links.forEach((l, i) => l.classList.toggle('on', i === cur));
      };
      addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }, { passive: true });
      spy();
    }
    // 読了バー
    const bar = document.querySelector('.progress span');
    if (bar) {
      const update = () => { const max = document.documentElement.scrollHeight - innerHeight; bar.style.transform = `scaleX(${max > 0 ? clamp(scrollY / max, 0, 1) : 0})`; };
      addEventListener('scroll', update, { passive: true }); addEventListener('resize', update); update();
    }
    // 横スクロールが必要な図には案内を出す
    scrollHints = [...document.querySelectorAll('.hscroll')].map(el => { const hint = h('div', { class: 'scroll-hint', text: '↔ 図は横にスクロールできます', hidden: true }); el.after(hint); return [el, hint]; });
    addEventListener('resize', checkScroll); addEventListener('load', checkScroll); setTimeout(checkScroll, 300);
    document.fonts?.ready.then(checkScroll);
    document.querySelector('.skip')?.addEventListener('click', e => { e.preventDefault(); const a = document.getElementById('article'); a.focus(); a.scrollIntoView(); });
  }

  /** デモ枠のひな形を取得（HTML 側に .demo を置き、中身をスクリプトで作る） */
  function demo(id) {
    const root = document.getElementById(id);
    if (!root) return null;
    const stage = root.querySelector('.demo-stage') || root.appendChild(h('div', { class: 'demo-stage' }));
    let options = root.querySelector('.demo-options');
    if (!options) { options = h('div', { class: 'demo-options' }); stage.before(options); }
    return { root, stage, options };
  }

  window.DL = { renderMath, h, s, clamp, fmt, ease, esc, shade, flow, cancelFlows, drawLine, countUp, flyText, segmented, slider, grid, tooltip, onVisible, Player, highlightPython, initPage, demo, reduced, CHAPTERS };
  document.addEventListener('DOMContentLoaded', initPage);
})();
