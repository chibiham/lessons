/* 第7章の図解。数値は説明用。共通Playerの手動再生・キーボード操作を利用する。 */
(() => {
  'use strict';
  const { h, demo, Player, shade } = window.DL;
  const softmax = xs => {
    const peak = Math.max(...xs);
    const exps = xs.map(x => Math.exp(x - peak));
    const total = exps.reduce((a, b) => a + b, 0);
    return exps.map(x => x / total);
  };
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
  const f = n => Math.abs(n) < .0005 ? '0.000' : n.toFixed(3);
  const vec = xs => '[' + xs.map(f).join(', ') + ']';
  const label = text => h('div', { class: 'd-label', text });
  const box = (text, cls = '') => h('div', { class: 'flow-box ' + cls, text });
  const down = () => h('div', { class: 'arrow', 'aria-hidden': 'true', text: '↓' });
  const flow = items => h('div', { class: 'flow-down' }, items.flatMap((item, i) => i ? [down(), item] : [item]));
  const select = (title, options, change) => {
    const el = h('select', { class: 'btn', 'aria-label': title }, options.map(([v, t]) => h('option', { value: v, text: t })));
    el.addEventListener('change', () => change(el.value));
    return h('label', {}, title + ' ', el);
  };
  const toggle = (text, change, initial = false) => {
    const el = h('input', { type: 'checkbox', checked: initial });
    el.addEventListener('change', () => change(el.checked));
    return h('label', {}, el, text);
  };
  function weightRows(words) {
    const rows = words.map(word => {
      const bar = h('div', { class: 'weight-fill' });
      const number = h('span', { class: 'mono' });
      const root = h('div', { class: 'weight-row' }, h('span', { text: word }), h('div', { class: 'weight-track', 'aria-hidden': 'true' }, bar), number);
      return { root, bar, number };
    });
    return {
      root: h('div', {}, rows.map(r => r.root)),
      update(weights) {
        const peak = Math.max(...weights);
        rows.forEach((r, i) => {
          r.bar.style.width = `${weights[i] * 100}%`;
          r.number.textContent = weights[i].toFixed(3);
          r.root.classList.toggle('strong', weights[i] === peak);
        });
      }
    };
  }
  function player(d, steps, onStep) {
    return new Player(d.root, { steps, autoplay: false, interval: 2400, onStep });
  }

  function reference() {
    const d = demo('d7-reference');
    const words = ['今日', '会議', '15時', '会議室'];
    const tokens = words.map(word => h('span', { class: 'token', text: word }));
    const state = box('最後の状態だけ → Decoder', 'violet');
    const bars = weightRows(words);
    d.stage.replaceChildren(label('Encoderが読んだ入力（説明用の4区分）'), h('div', { class: 'tokens' }, tokens), state, bars.root);
    player(d, 3, i => {
      const weights = [[0, 0, 0, 0], [.05, .8, .05, .1], [.05, .05, .85, .05]][i];
      state.textContent = ['基本的なSeq2Seq：最後の固定長の状態だけに集約', 'Attention：全位置の状態を残し、meetingの予測に必要な情報を参照', 'Attention：15:00の予測では、参照先の配分を再計算'][i];
      bars.root.hidden = i === 0;
      bars.update(weights);
      tokens.forEach((t, j) => t.classList.toggle('active', i > 0 && weights[j] > .5));
      return [
        '6章の出発点です。入力が長くなっても、Decoderへ渡す状態の次元は固定です。',
        '入力の全位置の状態を参照可能にします。ここでは<b>meetingを予測するために「会議」の情報を多く取り込む</b>例です。重みは説明用です。',
        '次の出力位置では配分が変わります。<b>Attentionが返すのは訳語そのものではなく、訳語の予測に使うベクトル</b>です。RNNの逐次処理は、この段階では残っています。'
      ][i];
    });
  }

  function calculation() {
    const d = demo('d7-calculation');
    const keys = [[0, 0], [1, 0], [1, 1]];
    const values = [[1, 0], [0, 1], [1, 1]];
    let query = [1, 1], p;
    const steps = ['① スコア', '② 配分', '③ 加重和', '④ 出力'].map(text => h('span', { text }));
    const qText = h('p', { class: 'mono' });
    const table = h('table', {}, h('thead', {}, h('tr', {}, ['参照先', 'K', 'V', 'Q·K / √2', '重み'].map(text => h('th', { scope: 'col', text })))));
    const tbody = h('tbody');
    table.append(tbody);
    const cells = keys.map((key, i) => {
      const score = h('td'), weight = h('td');
      tbody.append(h('tr', {}, h('th', { scope: 'row', text: String.fromCharCode(65 + i) }), h('td', { class: 'mono', text: '[' + key + ']' }), h('td', { class: 'mono', text: '[' + values[i] + ']' }), score, weight));
      return { score, weight };
    });
    const bars = weightRows(['AのValue', 'BのValue', 'CのValue']);
    const calculationText = h('div', { class: 'num-panel' });
    const result = h('div', { class: 'flow-box green' });
    d.stage.replaceChildren(h('div', { class: 'calc-steps', 'aria-hidden': 'true' }, steps), qText, h('div', { class: 'table-wrap' }, table), bars.root, calculationText, result);
    d.options.append(select('Queryを変更', [['1', 'Q = [1, 1]'], ['-1', 'Q = [−1, −1]']], v => { query = [+v, +v]; p.refresh(); }));
    p = player(d, 4, i => {
      const scores = keys.map(k => dot(query, k) / Math.sqrt(2));
      const weights = softmax(scores);
      const out = [0, 1].map(dim => values.reduce((sum, v, j) => sum + v[dim] * weights[j], 0));
      qText.textContent = `Q = [${query.join(', ')}] ／ d_k = 2`;
      steps.forEach((step, j) => step.classList.toggle('on', j === i));
      cells.forEach((cell, j) => { cell.score.textContent = f(scores[j]); cell.weight.textContent = i >= 1 ? f(weights[j]) : 'まだ計算しない'; });
      bars.root.hidden = i < 1; bars.update(weights);
      calculationText.hidden = i < 2;
      calculationText.textContent = `${f(weights[0])} × [1, 0] + ${f(weights[1])} × [0, 1] + ${f(weights[2])} × [1, 1]`;
      result.hidden = i < 3;
      result.textContent = `出力 ≈ ${vec(out)}　← 情報を混ぜたベクトル`;
      return [
        'Qと各Kの内積を取り、√2で割りました。この値は<b>まだ重みではなく、負にもなるスコア</b>です。',
        'Softmaxで配分を作ります。<b>重みの合計は1</b>です。小数第3位で表示しているため、表示値の合計には丸め誤差が出る場合があります。',
        '各Vの成分に同じ重みを掛け、成分ごとに足します。スコアやK自体を混ぜているわけではありません。',
        '出力は2次元ベクトルです。<b>Queryを変えると、同じK・Vでも配分と出力が変わります。</b>どの語を出すかは、後段のネットワークが予測します。'
      ][i];
    });
  }

  function selfAttention() {
    const d = demo('d7-self');
    const words = ['動物は', '疲れて', '道を', '渡らなかった'];
    const weights = [[.5, .2, .1, .2], [.45, .3, .05, .2], [.1, .05, .55, .3], [.55, .25, .05, .15]];
    const values = [[1, 0], [0, 1], [.5, .5], [1, 1]];
    const table = h('table', { class: 'heatmap', 'aria-label': '各行のトークンから各列のトークンへの注目度' });
    table.append(h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: '見る側 ↓\n参照先 →' }), words.map(text => h('th', { scope: 'col', text })))));
    let selected = 3;
    const rows = [], buttons = [];
    const summary = h('div', { class: 'num-panel', 'aria-live': 'polite' });
    const bars = weightRows(words);
    const tbody = h('tbody');
    weights.forEach((row, i) => {
      const b = h('button', { type: 'button', text: words[i], 'aria-label': `${words[i]}からの参照を見る`, onclick: () => { selected = i; update(); } });
      buttons.push(b);
      const tr = h('tr', {}, h('th', { scope: 'row' }, b));
      row.forEach(w => tr.append(h('td', { text: w.toFixed(2), style: shade(w) })));
      tbody.append(tr); rows.push(tr);
    });
    table.append(tbody);
    d.stage.replaceChildren(h('p', { class: 'note', text: '行見出しをクリック／キーボードで選択。数値は説明用で、係り受けの実測結果ではありません。' }), h('div', { class: 'matrix-wrap' }, table), bars.root, summary);
    function update() {
      rows.forEach((r, i) => r.classList.toggle('selected', i === selected));
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === selected)));
      bars.update(weights[selected]);
      const out = [0, 1].map(dim => values.reduce((sum, v, j) => sum + v[dim] * weights[selected][j], 0));
      summary.textContent = `「${words[selected]}」から見た配分。行の合計 = 1.00。Vを順に [1,0], [0,1], [0.5,0.5], [1,1] とすると出力は ${vec(out)}。この位置の表現に文脈を取り込みます。`;
    }
    update();
  }

  function position() {
    const d = demo('d7-position');
    let swapped = false, positioned = false;
    const row = h('div', { class: 'position-row' });
    const summary = h('div', { class: 'num-panel', 'aria-live': 'polite' });
    d.stage.replaceChildren(row, summary);
    d.options.append(
      toggle('犬と人を入れ替える', v => { swapped = v; update(); }),
      toggle('位置の情報を付ける', v => { positioned = v; update(); })
    );
    function update() {
      const words = swapped ? ['人', 'が', '犬', 'を', '噛んだ'] : ['犬', 'が', '人', 'を', '噛んだ'];
      row.replaceChildren(...words.map((word, i) => h('div', { class: 'position-cell' + (positioned ? ' positioned' : '') + (word === '犬' ? ' mark' : '') }, word, h('small', { text: positioned ? `＋位置${i + 1}のベクトル` : '語の埋め込みのみ' }))));
      summary.textContent = positioned
        ? `位置情報あり：「犬」の埋め込みに足す位置ベクトルが、${swapped ? '3番目' : '1番目'}に応じて変わります。これは実際のAttention計算ではなく、入力を区別する手掛かりの図解です。`
        : '位置情報なし：「犬」の埋め込み自体は、置いた位置だけでは変わりません。語を並べ替えると出力も対応して並び替わりますが、その位置関係を意味の手掛かりにできません。';
    }
    update();
  }

  function heads() {
    const d = demo('d7-heads');
    let count = 8;
    const branches = h('div', { class: 'head-grid' });
    const result = h('div', { class: 'num-panel', 'aria-live': 'polite' });
    d.stage.replaceChildren(box('入力 X : (10, 512)', 'blue'), branches, box('連結 → 出力変換 W_O → (10, 512)', 'violet'), result);
    d.options.append(select('ヘッド数', [['8', '8ヘッド × 64次元'], ['1', '1ヘッド × 512次元']], v => { count = +v; update(); }));
    function update() {
      const width = 512 / count;
      branches.replaceChildren(...Array.from({ length: count }, (_, i) => h('div', { class: 'head-chip' }, `Head ${i + 1}`, h('small', { text: `別のW_Q・W_K・W_V` }), h('small', { text: `出力 (10, ${width})` }))));
      result.textContent = `${width}次元 × ${count}ヘッド = 512次元。各ヘッドの配分表はどちらも (10, 10)。幅512の1ヘッドと比べて主要な演算量は概ね同程度ですが、重みの保存量や実際の速度まで同じとは限りません。`;
    }
    update();
  }

  function architecture() {
    const d = demo('d7-architecture');
    const encIn = box('① 入力文（翻訳元）', 'blue');
    const encEmbed = box('埋め込み ＋ 位置情報');
    const encSelf = box('② Self-Attention ＋ 残差・LN（エルエヌ）', 'blue');
    const encFFN = box('FFN（エフエフエヌ） ＋ 残差・LN', 'green');
    const encStack = h('div', { class: 'concept' }, label('このブロックをN層積む'), flow([encSelf, encFFN]));
    const encOut = box('③ Encoderの最終出力：各位置のベクトル', 'blue');
    const decIn = box('④ 生成済みの語／学習時はずらした正解文', 'violet');
    const decEmbed = box('埋め込み ＋ 位置情報');
    const decSelf = box('⑤ Masked Self-Attention ＋ 残差・LN', 'violet');
    decSelf.append(h('small', { text: 'マスクト・セルフアテンション' }));
    const cross = box('⑥ Cross-Attention ＋ 残差・LN', 'blue');
    cross.append(h('small', { text: 'クロスアテンション' }));
    cross.append(h('small', { text: 'Q：Decoder側 ／ K・V：Encoder最終出力を変換' }));
    const decFFN = box('FFN ＋ 残差・LN', 'green');
    const decStack = h('div', { class: 'concept' }, label('このブロックをN層積む'), flow([decSelf, cross, decFFN]));
    const projection = box('⑦ 語彙（ごい）への線形変換 ＋ Softmax', 'violet');
    projection.append(h('small', { text: '各出力位置のベクトル → 次の語の候補の確率' }));
    const enc = h('section', { class: 'arch-column', 'aria-label': 'Encoder 上から下に処理' }, h('h4', { text: 'Encoder ↓' }), flow([encIn, encEmbed, encStack, encOut]));
    const dec = h('section', { class: 'arch-column', 'aria-label': 'Decoder 上から下に処理' }, h('h4', { text: 'Decoder ↓' }), flow([decIn, decEmbed, decStack, projection]));
    const bridge = h('div', { class: 'bridge', text: '接続：③ Encoderの最終出力 → 各Decoder層の⑥ Cross-AttentionのK・V。Decoder内部の表現がQになります。' });
    d.stage.replaceChildren(h('div', { class: 'arch-grid' }, enc, dec), bridge, h('div', { class: 'output-types', text: '2種類のSoftmax：Attention内＝参照先の配分 ／ 最後の出力＝次の語の候補の確率' }));
    const targets = [encIn, encSelf, encOut, decIn, decSelf, cross, projection];
    player(d, targets.length, i => {
      targets.forEach((t, j) => t.classList.toggle('active', i === j));
      return [
        'まず翻訳元の入力文をトークン化し、埋め込みと位置情報を作ります。',
        'Encoderは入力文の各位置で情報を交換し、FFNで各位置の情報を加工します。図のブロック全体をN層積みます。',
        '最後まで処理した<b>各位置のベクトルを残します</b>。この最終出力が、各Decoder層のCross-Attentionへ渡されます。',
        'Decoderには別の入力があります。生成時は既に作った語、学習時は1位置ずらした正解文です。<b>翻訳元の入力文そのものとは別です。</b>',
        'Masked Self-Attentionで、Decoderの文脈を取り込みます。各位置は自分より後ろを参照できません。',
        'Cross-Attentionで翻訳元を参照します。QはDecoder側、K・VはEncoderの最終出力から作ります。その後FFNを通し、このDecoderブロックもN層積みます。',
        '各出力位置のベクトルを<b>語彙数ぶんのスコアへ線形変換し、Softmaxで次の語の確率</b>にします。Attention内のSoftmaxとは対象が異なります。'
      ][i];
    });
  }

  function mask() {
    const d = demo('d7-mask');
    const words = ['〈開始〉', 'I', 'like', 'cats'];
    const targets = ['I', 'like', 'cats', '〈終了〉'];
    const raw = [[1, 2, 0, 3], [1, 2, 3, 0], [0, 1, 2, 3], [1, 0, 2, 1]];
    let causal = true, showWeights = false;
    const table = h('table', { class: 'heatmap', 'aria-label': '因果Maskを適用するスコア行列' });
    const summary = h('div', { class: 'num-panel', 'aria-live': 'polite' });
    const cells = [];
    table.append(h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: '入力 ↓／参照 →' }), words.map(text => h('th', { scope: 'col', text })))));
    const tbody = h('tbody');
    raw.forEach((row, i) => {
      const tr = h('tr', {}, h('th', { scope: 'row', text: `${words[i]} → ${targets[i]}を予測` }));
      cells[i] = row.map(() => { const td = h('td'); tr.append(td); return td; });
      tbody.append(tr);
    });
    table.append(tbody);
    d.stage.replaceChildren(h('div', { class: 'matrix-wrap' }, table), summary);
    d.options.append(toggle('未来への参照をMask', v => { causal = v; update(); }, true), toggle('Softmax後の重みを表示', v => { showWeights = v; update(); }));
    function update() {
      raw.forEach((row, i) => {
        const scores = row.map((v, j) => causal && j > i ? -Infinity : v);
        const weights = softmax(scores);
        cells[i].forEach((cell, j) => {
          const blocked = causal && j > i;
          cell.textContent = showWeights ? weights[j].toFixed(2) : blocked ? '−∞' : String(row[j]);
          cell.classList.toggle('blocked', blocked);
          cell.style.background = blocked ? '' : showWeights ? shade(weights[j]).background : '';
          cell.style.color = blocked ? '' : showWeights ? shade(weights[j]).color : '';
        });
      });
      summary.textContent = causal
        ? '因果Maskあり。入力Iの行は〈開始〉とIを参照して、次のlikeを予測します。対角線上のIは入力であり、正解likeではありません。Softmax後は、禁止した位置の重みが0になります。'
        : '因果Maskなし。入力Iの行から、予測すべき正解likeを含む後ろの位置が見えてしまいます。次の語を予測する学習では、この漏れを防ぎます。Encoderでは入力全体が既知なので通常この因果Maskは使いません。';
    }
    update();
  }

  function training() {
    const d = demo('d7-training');
    const inputs = ['〈開始〉', 'I', 'like', 'cats'];
    const outputs = ['I', 'like', 'cats', '〈終了〉'];
    let mode = 'train', p;
    const table = h('table', { class: 'train-table' });
    const inputCells = inputs.map(() => h('td'));
    const outputCells = outputs.map(() => h('td'));
    table.append(h('tbody', {},
      h('tr', {}, h('th', { scope: 'row', text: '入力' }), inputCells),
      h('tr', {}, h('th', { scope: 'row', text: '次の語の予測' }), outputCells)
    ));
    const info = h('div', { class: 'num-panel' });
    const choices = h('div', { class: 'num-panel' });
    d.stage.replaceChildren(h('div', { class: 'table-wrap' }, table), info, choices);
    d.options.append(select('モード', [['train', '学習：正解文を入力'], ['generate', '生成：出した語を追加']], v => { mode = v; p.refresh(); }));
    p = player(d, 5, i => {
      const trainingMode = mode === 'train';
      inputCells.forEach((cell, j) => {
        const available = trainingMode || j <= i;
        cell.textContent = available ? inputs[j] : '未確定';
        cell.className = available ? 'lit' : 'waiting';
      });
      outputCells.forEach((cell, j) => {
        const predicted = trainingMode ? i >= 1 : j < i;
        cell.textContent = predicted ? outputs[j] : '？';
        cell.className = predicted ? 'lit' : 'waiting';
      });
      info.textContent = trainingMode
        ? (i === 0 ? '正解文は既にある：入力を〈開始〉, I, like, catsと用意し、正解をI, like, cats,〈終了〉にずらします。' : 'すべての位置の次トークン分布をまとめて計算し、各位置の正解との損失を使ってパラメータを更新します。上の語は各位置で当てたい正解を示しています。')
        : (i === 0 ? '最初は〈開始〉だけ。次に出す語はまだ決まっていません。' : `${i}回目まで予測して語を決定しました。${i < 4 ? `出した${outputs[i - 1]}を次の入力へ加えます。` : '終了トークンで生成を止めます。'}`);
      choices.textContent = trainingMode
        ? 'まとめて計算しても、因果Maskによって各位置が使えるのは、その位置までの入力だけです。図は計算時間の実測比較ではありません。'
        : ['語彙への出力Softmax → 次の語の分布 → 1語を選ぶ', '例：P(I)=0.70、P(We)=0.20、その他=0.10 → Iを選ぶ', '例：P(like)=0.60、P(have)=0.25、その他=0.15 → likeを選ぶ', '例：P(cats)=0.55、P(dogs)=0.30、その他=0.15 → catsを選ぶ', '例：P(終了)=0.80、その他=0.20 → 終了を選ぶ'][i];
      return trainingMode
        ? ['入力と正解は1位置ずれています。6章のteacher forcingと同じ発想です。', '<b>全位置の予測分布をまとめて計算</b>できます。表示している語は正解の例で、モデルが常に正解するという意味ではありません。', '予測分布を各位置の正解と比較します。因果Maskがあるため、後ろの入力は使えません。', '損失の勾配から、Q・K・Vの変換を含むパラメータを学習します。ここで新しい語を順に作っているわけではありません。', '今度はモードを「生成」に切り替え、最初に戻ってください。<b>正解文がない場合、入力は最初からそろいません。</b>'][i]
        : ['まだ出力がないので、使える入力は開始トークンだけです。', '次の語をIと決めました。これを次の入力に含めます。', 'Iを含む文脈からlikeを決めました。<b>前の決定が、次の予測の入力になります。</b>', 'likeを含む文脈からcatsを決めました。通常の自己回帰生成はこの繰り返しです。', '終了を選んで完了です。<b>学習時の位置方向の並列化と、生成時の語の決定順序を区別</b>してください。KVキャッシュは再計算を減らしますが、この依存は残ります。'][i];
    });
  }

  function families() {
    const d = demo('d7-families');
    let kind = 'gpt';
    const diagram = h('div');
    const info = h('div', { class: 'num-panel', 'aria-live': 'polite' });
    d.stage.replaceChildren(diagram, info);
    d.options.append(select('モデル構成', [['gpt', 'GPT系：Decoder-only'], ['bert', 'BERT系：Encoder-only'], ['original', '原型：Encoder–Decoder']], v => { kind = v; update(); }));
    function update() {
      const configs = {
        gpt: ['入力トークン＋位置情報', 'Masked Self-Attention', 'FFN', '語彙のスコア → 次のトークン'],
        bert: ['入力トークン＋位置情報', 'Self-Attention（前後を参照）', 'FFN', '各位置の表現 → 目的に応じた出力層'],
        original: ['入力文 → Encoder → 各位置の表現を保存', '別の入力：生成済みの訳文', 'Decoder：Masked Self-Attention', 'Cross-Attention（Encoderの最終出力を参照）', 'FFN → 語彙のスコア → 次のトークン']
      };
      diagram.replaceChildren(flow(configs[kind].map((text, i) => box(text, i === 1 ? 'violet' : 'blue'))));
      info.textContent = {
        gpt: 'GPT系の代表的なDecoder-only構成には、別のEncoderと、そのEncoderを見るCross-Attentionがありません。「原型のDecoderを何も変えずに残す」という意味ではありません。',
        bert: 'BERT系は入力全体を見て表現を作ります。穴埋めによる事前学習や、分類・抽出への利用が代表例です。用途に合う出力層や学習済みモデルを組み合わせます。',
        original: '翻訳元と翻訳先の2つの入口があります。Decoderは自分の文脈を見たうえで、Cross-AttentionでEncoderの最終出力を参照します。'
      }[kind];
    }
    update();
  }

  document.addEventListener('DOMContentLoaded', () => {
    reference(); calculation(); selfAttention(); position(); heads(); architecture(); mask(); training(); families();
    // 閉じた補足内の見出しへ移動する場合も、目次から内容を読めるようにする。
    function revealTarget(hash = location.hash) {
      let id;
      try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
      const target = document.getElementById(id);
      if (!target) return;
      for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.tagName === 'DETAILS') ancestor.open = true;
      }
      target.scrollIntoView({ block: 'start' });
    }
    document.addEventListener('click', event => {
      const link = event.target.closest('a[href^="#"]');
      if (link) revealTarget(link.getAttribute('href'));
    });
    window.addEventListener('hashchange', () => revealTarget());
    if (location.hash) revealTarget();
  });
})();
