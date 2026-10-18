// 麓山绘梦·纹鉴 - 二次创作派生谱系前端界面
// =========================================================
// 依赖全局：CHAIN_CONFIG（proxyUrl）、window.currentFingerprint
// 后端接口：
//   GET  /api/derivations?fingerprint=xxx  -> { fingerprint, relations:[{sourceFingerprint, derivedFingerprint, relationType, judgeBasis, evidenceId, createdAt}] }
//   POST /api/derivations                  -> { source_fingerprint, derived_fingerprint, relation_type('new_creation'|'derivative'), judge_basis?, evidence_id? }
// 入口：openDerivationGraph()（index.html 中绑定按钮） -> initDerivationUI(fingerprint, name)

const DERIVATION_RELATION_LABELS = {
  derivative:   { text: '衍生',   color: '#a78bfa', desc: '形式二创·挂回谱系·不独立确权' },
  new_creation: { text: '新创作', color: '#10b981', desc: '主题重构·独立确权·记录派生自' }
};

class DerivationUI {
  constructor(fingerprint, name) {
    this.fingerprint = fingerprint || null;
    this.focusName = name || '';
    this.relations = [];
    this.overlay = null;
    this.history = []; // 焦点回溯栈 [{ fingerprint, name }]
  }

  open() {
    this.renderShell();
    this.bindShell();
    this.loadAndRender();
  }

  // ---------- 浮层骨架 ----------
  renderShell() {
    const old = document.querySelector('.derivation-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.className = 'derivation-overlay';
    overlay.innerHTML = `
      <div class="derivation-container">
        <div class="derivation-header">
          <h2>🌿 二次创作派生谱系</h2>
          <p>查看纹样的来源与衍生脉络，登记二次创作关系（source → derivative 有向图）</p>
          <button class="derivation-close-btn" type="button" title="关闭">✕</button>
        </div>

        <div class="dv-toolbar">
          <button class="dv-back" type="button" style="display:none;">← 返回上层</button>
          <div class="dv-focus-label">焦点纹样：<strong id="dv-focus-name">—</strong>
            <span id="dv-focus-fp" style="color:#585875;font-size:12px;"></span></div>
        </div>

        <div id="dv-status" class="dv-status" style="display:none;"></div>

        <div class="dv-graph-scroll">
          <div id="dv-graph" class="dv-graph"></div>
        </div>

        <div class="dv-legend">
          <span><span class="sw" style="background:#a78bfa;"></span>衍生（形式二创·挂回谱系·不独立确权）</span>
          <span><span class="sw" style="background:#10b981;"></span>新创作（主题重构·独立确权·记录派生自）</span>
          <span style="color:#585875;">点击任一节点可下钻查看其谱系</span>
        </div>

        <div class="dv-form-section">
          <h3>登记派生关系</h3>
          <div class="dv-role-toggle">
            <label><input type="radio" name="dv-role" value="source" checked> 当前纹样是「来源」（它是被二创的母本）</label>
            <label><input type="radio" name="dv-role" value="derived"> 当前纹样是「二创」（它派生于某母本）</label>
          </div>
          <div class="form-group">
            <label id="dv-other-label">对方纹样指纹（二创纹样 / 衍生作品）</label>
            <input type="text" id="dv-other-fp" placeholder="粘贴对方纹样的指纹哈希（≥ 8 位）">
          </div>
          <div class="form-group">
            <label>关系类型</label>
            <select id="dv-relation-type">
              <option value="derivative">衍生（形式二创·挂回谱系·不独立确权）</option>
              <option value="new_creation">新创作（主题重构·独立确权·记录派生自）</option>
            </select>
          </div>
          <div class="form-group">
            <label>判定依据（可选）</label>
            <input type="text" id="dv-judge" placeholder="如：仅改配色与比例，保留母本线条骨架">
          </div>
          <div class="form-actions">
            <button class="btn-secondary" type="button" onclick="derivationUI.cancel()">关闭</button>
            <button class="btn-primary" type="button" id="dv-submit">提交登记</button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    this.overlay = overlay;
    window.derivationUI = this;
  }

  bindShell() {
    this.overlay.querySelector('.derivation-close-btn').addEventListener('click', () => this.cancel());
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.cancel(); });
    this.overlay.querySelector('.dv-back').addEventListener('click', () => this.back());

    const roleInputs = this.overlay.querySelectorAll('input[name="dv-role"]');
    roleInputs.forEach(r => r.addEventListener('change', () => this.updateRoleLabel()));
    this.updateRoleLabel();

    this.overlay.querySelector('#dv-submit').addEventListener('click', () => this.submit());
  }

  updateRoleLabel() {
    const role = this.overlay.querySelector('input[name="dv-role"]:checked').value;
    const lbl = this.overlay.querySelector('#dv-other-label');
    lbl.textContent = (role === 'source')
      ? '对方纹样指纹（二创纹样 / 衍生作品）'
      : '母本纹样指纹（来源纹样）';
  }

  setStatus(msg, isError) {
    const el = this.overlay.querySelector('#dv-status');
    if (!msg) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.className = 'dv-status' + (isError ? ' dv-error' : '');
    el.textContent = msg;
  }

  // ---------- 数据加载 + 渲染 ----------
  async loadAndRender() {
    if (!this.fingerprint) { this.renderGraph(); return; }
    this.setStatus('加载派生关系中…', false);
    try {
      const url = `${CHAIN_CONFIG.proxyUrl}/api/derivations?fingerprint=${encodeURIComponent(this.fingerprint)}`;
      const resp = await fetch(url);
      const data = await resp.json();
      this.relations = (data && data.relations) || [];
      this.setStatus('');
    } catch (e) {
      console.error('加载派生关系失败:', e);
      this.relations = [];
      this.setStatus('加载失败：' + (e && e.message ? e.message : '网络错误') + '（仍可在下方登记）', true);
    }
    this.renderGraph();
  }

  renderGraph() {
    const nameEl = this.overlay.querySelector('#dv-focus-name');
    const fpEl = this.overlay.querySelector('#dv-focus-fp');
    nameEl.textContent = this.focusName || '未命名纹样';
    fpEl.textContent = this.fingerprint ? ('#' + this.shortFp(this.fingerprint)) : '';
    this.overlay.querySelector('.dv-back').style.display = this.history.length ? 'inline-block' : 'none';

    const g = this.overlay.querySelector('#dv-graph');
    const fp = this.fingerprint;

    const upstream = [];   // focal 派生于这些 source（左侧·来源）
    const downstream = []; // 这些 derived 派生于 focal（右侧·二创）
    (this.relations || []).forEach(rel => {
      if (rel.derivedFingerprint === fp) {
        upstream.push({ fp: rel.sourceFingerprint, rel, tag: '来源' });
      } else if (rel.sourceFingerprint === fp) {
        downstream.push({ fp: rel.derivedFingerprint, rel, tag: '二创' });
      }
    });

    if (!fp && upstream.length === 0 && downstream.length === 0) {
      g.innerHTML = '<div class="dv-empty">尚未选择纹样</div>';
      return;
    }
    if (upstream.length === 0 && downstream.length === 0) {
      g.innerHTML = '<div class="dv-empty">当前纹样暂无派生关系<br><span style="font-size:12px;">可在下方登记它的来源或衍生作品</span></div>';
      return;
    }

    const NODE_W = 184, NODE_H = 56, PAD = 36, STEP = 92;
    const COL = { up: 110, focal: 408, down: 806 }; // svgW = 1000
    const rows = Math.max(upstream.length, downstream.length, 1);
    const height = PAD * 2 + NODE_H + (rows - 1) * STEP + 16;
    const focalY = PAD + NODE_H / 2 + (rows - 1) * STEP / 2;
    const place = (i, n) => { const total = (n - 1) * STEP; return focalY - total / 2 + i * STEP; };
    upstream.forEach((n, i) => { n.y = place(i, upstream.length); n.x = COL.up; });
    downstream.forEach((n, i) => { n.y = place(i, downstream.length); n.x = COL.down; });
    const focal = { fp, x: COL.focal, y: focalY, focal: true };

    const svgW = 1000, svgH = height;
    let svg = `<svg class="derivation-graph" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="dv-arrow-purple" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,3 L0,6 Z" fill="#a78bfa"></path></marker>
        <marker id="dv-arrow-green" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,3 L0,6 Z" fill="#10b981"></path></marker>
      </defs>`;

    const edge = (from, to, rel) => {
      const info = DERIVATION_RELATION_LABELS[rel.relationType] || { color: '#a78bfa', text: rel.relationType };
      const marker = rel.relationType === 'new_creation' ? 'dv-arrow-green' : 'dv-arrow-purple';
      const x1 = from.x + NODE_W, y1 = from.y;
      const x2 = to.x, y2 = to.y;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${info.color}" stroke-width="2" marker-end="url(#${marker})"></line>
        <rect x="${mx - 28}" y="${my - 11}" width="56" height="20" rx="10" fill="#0f0f1e" stroke="${info.color}" stroke-width="1"></rect>
        <text x="${mx}" y="${my + 4}" text-anchor="middle" font-size="12" fill="${info.color}">${this.escapeHtml(info.text)}</text>`;
    };
    upstream.forEach(n => { svg += edge(n, focal, n.rel); });
    downstream.forEach(n => { svg += edge(focal, n, n.rel); });

    const nodeSvg = (n) => {
      const isFocal = !!n.focal;
      const cx = n.x + NODE_W / 2;
      const fill = isFocal ? '#10b981' : '#1a1a2e';
      const stroke = isFocal ? '#10b981' : '#3a3a5c';
      const textColor = isFocal ? '#06281c' : '#e8e8f0';
      const subColor = isFocal ? '#0c3a29' : '#a0a0b8';
      const title = isFocal ? ((this.focusName || '焦点纹样') + '  ' + n.fp) : n.fp;
      const label1 = isFocal ? (this.focusName || '焦点纹样') : (n.tag || '纹样');
      const label2 = this.shortFp(n.fp);
      const clickable = isFocal ? '' : ' dv-node-clickable';
      const dataAttr = isFocal ? '' : ` data-fp="${this.escapeHtml(n.fp)}"`;
      return `<g class="dv-node${clickable}"${dataAttr}>
        <title>${this.escapeHtml(title)}</title>
        <rect x="${n.x}" y="${n.y - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="2"></rect>
        <text x="${cx}" y="${n.y - 6}" text-anchor="middle" font-size="13" font-weight="600" fill="${textColor}">${this.escapeHtml(this.truncate(label1, 12))}</text>
        <text x="${cx}" y="${n.y + 14}" text-anchor="middle" font-size="11" fill="${subColor}">${this.escapeHtml(label2)}</text>
      </g>`;
    };
    upstream.forEach(n => { svg += nodeSvg(n); });
    svg += nodeSvg(focal);
    downstream.forEach(n => { svg += nodeSvg(n); });

    svg += '</svg>';
    g.innerHTML = svg;

    g.querySelectorAll('[data-fp]').forEach(el => {
      el.addEventListener('click', () => this.navigate(el.getAttribute('data-fp')));
    });
  }

  // ---------- 导航 ----------
  navigate(fp) {
    if (!fp || fp === this.fingerprint) return;
    this.history.push({ fingerprint: this.fingerprint, name: this.focusName });
    this.fingerprint = fp;
    this.focusName = '';
    this.loadAndRender();
  }

  back() {
    const prev = this.history.pop();
    if (!prev) return;
    this.fingerprint = prev.fingerprint;
    this.focusName = prev.name;
    this.loadAndRender();
  }

  // ---------- 提交登记 ----------
  async submit() {
    const role = this.overlay.querySelector('input[name="dv-role"]:checked').value;
    const otherFp = (this.overlay.querySelector('#dv-other-fp').value || '').trim();
    const relationType = this.overlay.querySelector('#dv-relation-type').value;
    const judge = (this.overlay.querySelector('#dv-judge').value || '').trim();

    if (!this.fingerprint) { this.setStatus('缺少当前纹样指纹', true); return; }
    if (!otherFp || otherFp.length < 8) { this.setStatus('请填写对方纹样指纹（至少 8 位）', true); return; }
    if (otherFp === this.fingerprint) { this.setStatus('源纹样与二创纹样不能相同', true); return; }

    const source_fingerprint = role === 'source' ? this.fingerprint : otherFp;
    const derived_fingerprint = role === 'source' ? otherFp : this.fingerprint;

    const btn = this.overlay.querySelector('#dv-submit');
    const oldText = btn.textContent;
    btn.disabled = true; btn.textContent = '提交中…';
    this.setStatus('');

    try {
      const resp = await fetch(`${CHAIN_CONFIG.proxyUrl}/api/derivations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_fingerprint,
          derived_fingerprint,
          relation_type: relationType,
          judge_basis: judge || null
        })
      });
      const data = await resp.json();
      if (resp.ok) {
        this.setStatus('✓ 登记成功，已刷新谱系');
        this.overlay.querySelector('#dv-other-fp').value = '';
        this.overlay.querySelector('#dv-judge').value = '';
        this.loadAndRender();
      } else {
        this.setStatus('登记失败：' + (data.error || resp.status), true);
      }
    } catch (e) {
      console.error('登记派生关系失败:', e);
      this.setStatus('登记失败：' + (e && e.message ? e.message : '网络错误'), true);
    } finally {
      btn.disabled = false; btn.textContent = oldText;
    }
  }

  // ---------- 工具 ----------
  shortFp(fp) { if (!fp) return ''; return fp.length > 14 ? (fp.slice(0, 8) + '…' + fp.slice(-4)) : fp; }
  truncate(s, n) { if (!s) return ''; return s.length > n ? (s.slice(0, n - 1) + '…') : s; }
  escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  cancel() { if (this.overlay) { this.overlay.remove(); this.overlay = null; } }
}

// 全局实例
let derivationUI = null;

function initDerivationUI(fingerprint, name) {
  if (derivationUI) derivationUI.cancel();
  derivationUI = new DerivationUI(fingerprint, name);
  derivationUI.open();
  return derivationUI;
}

// 导出供外部使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DerivationUI, initDerivationUI };
} else {
  window.DerivationUI = DerivationUI;
  window.initDerivationUI = initDerivationUI;
}
