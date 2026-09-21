// 麓山绘梦·纹鉴 - 区域链确权功能前端界面
// =========================================================
// 依赖全局：CHAIN_CONFIG（proxyUrl）、window.currentFingerprint、
//           computeFingerprintForResult()（可选，用于兜底计算）
// 入口：openRegionChain() → initRegionChainUI()

class RegionChainUI {
  constructor() {
    this.regions = [];
    this.selectedRegion = null;
    this.overlay = null;
    this.fingerprint = null;
    this.evidence = null;
    this.init();
  }

  async init() {
    this.fingerprint = window.currentFingerprint
      || (typeof computeFingerprintForResult === 'function'
            ? await computeFingerprintForResult().catch(() => null)
            : null);
    await this.loadRegions();
    this.render();
  }

  async loadRegions() {
    try {
      const response = await fetch(`${CHAIN_CONFIG.proxyUrl}/api/regions`);
      const data = await response.json();
      this.regions = (data && data.regions) || [];
    } catch (error) {
      console.error('加载区域列表失败:', error);
      // 网络失败时的本地兜底清单（与后端保持一致）
      this.regions = [
        { code: 'GBA', name: '粤港澳大湾区',     level: '国家级', description: '粤港澳大湾区文化资产保护区域' },
        { code: 'YRD', name: '长三角经济区',     level: '国家级', description: '长三角经济区传统文化保护区域' },
        { code: 'BTH', name: '京津冀协同发展区', level: '国家级', description: '京津冀协同发展文化保护区域' },
        { code: 'CDR', name: '成渝经济圈',       level: '国家级', description: '成渝经济圈传统文化保护区域' },
        { code: 'GZ',  name: '贵州省',           level: '省级',   description: '贵州省少数民族文化保护区域' },
        { code: 'YN',  name: '云南省',           level: '省级',   description: '云南省少数民族文化保护区域' },
        { code: 'GX',  name: '广西壮族自治区',   level: '省级',   description: '广西壮族自治区民族文化保护区域' }
      ];
    }
  }

  render() {
    // 移除旧实例
    const old = document.querySelector('.region-chain-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.className = 'region-chain-overlay';

    const container = document.createElement('div');
    container.className = 'region-chain-container';
    container.innerHTML = `
      <div class="region-chain-header">
        <h2>🏛️ 区域链确权</h2>
        <p>为您的纹样添加区域性文化资产保护确权</p>
        <button class="region-close-btn" type="button" title="关闭">✕</button>
      </div>

      <div class="region-chain-form">
        <div class="form-section">
          <h3>选择保护区域</h3>
          <div class="region-grid">
            ${this.regions.map(region => `
              <div class="region-card ${this.selectedRegion?.code === region.code ? 'selected' : ''}"
                   data-code="${region.code}">
                <div class="region-level">${region.level}</div>
                <h4>${region.name}</h4>
                <p>${region.description || ''}</p>
                <div class="region-select-btn">选择</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="form-section">
          <h3>确权信息</h3>
          <div class="form-group">
            <label>纹样名称</label>
            <input type="text" id="region-pattern-name" placeholder="请输入纹样名称">
          </div>

          <div class="form-group">
            <label>所有权人</label>
            <input type="text" id="region-owner" placeholder="请输入所有权人">
          </div>

          <div class="form-group">
            <label>文化类型</label>
            <select id="region-culture-type">
              <option value="传统纹样">传统纹样</option>
              <option value="民族纹样">民族纹样</option>
              <option value="现代纹样">现代纹样</option>
              <option value="文创纹样">文创纹样</option>
            </select>
          </div>

          <div class="form-group">
            <label>保护级别</label>
            <select id="region-protection-level">
              <option value="一般">一般保护</option>
              <option value="重要">重要保护</option>
              <option value="重点">重点保护</option>
              <option value="濒危">濒危保护</option>
            </select>
          </div>

          <div class="form-group">
            <label>真实性验证</label>
            <select id="region-authenticity">
              <option value="待验证">待验证</option>
              <option value="已验证">已验证</option>
              <option value="认证中">认证中</option>
            </select>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn-secondary" onclick="regionChainUI.cancel()">取消</button>
          <button class="btn-primary" onclick="regionChainUI.submit()" disabled>提交确权</button>
        </div>
      </div>

      <div class="region-chain-result" style="display: none;">
        <h3>确权结果</h3>
        <div class="result-content"></div>
        <div class="result-actions">
          <button class="btn-secondary" onclick="regionChainUI.reset()">确权新纹样</button>
          <button class="btn-primary" onclick="regionChainUI.viewOnChain()">查看链上信息</button>
        </div>
      </div>
    `;

    overlay.appendChild(container);
    document.body.appendChild(overlay);
    this.overlay = overlay;

    // 预填已有信息
    if (window.currentResult && window.currentResult.name) {
      document.getElementById('region-pattern-name').value = window.currentResult.name;
    }
    if (CHAIN_CONFIG.owner && CHAIN_CONFIG.owner !== '待填写权属人') {
      document.getElementById('region-owner').value = CHAIN_CONFIG.owner;
    }

    this.bindEvents();
    this.checkFormValidity();
  }

  bindEvents() {
    // 关闭按钮 / 点击遮罩空白处关闭
    this.overlay.querySelector('.region-close-btn').addEventListener('click', () => this.cancel());
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.cancel(); });

    // 区域选择
    this.overlay.querySelectorAll('.region-card').forEach(card => {
      card.addEventListener('click', () => {
        const code = card.dataset.code;
        this.selectedRegion = this.regions.find(r => r.code === code);
        this.overlay.querySelectorAll('.region-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.checkFormValidity();
      });
    });

    // 表单输入监听
    const inputs = ['region-pattern-name', 'region-owner', 'region-culture-type',
                    'region-protection-level', 'region-authenticity'];
    inputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => this.checkFormValidity());
    });
  }

  checkFormValidity() {
    const nameEl = document.getElementById('region-pattern-name');
    const ownerEl = document.getElementById('region-owner');
    const submitBtn = this.overlay.querySelector('.form-actions .btn-primary');
    if (!submitBtn) return;
    const isValid = !!this.selectedRegion && nameEl.value.trim() && ownerEl.value.trim() && !!this.fingerprint;
    submitBtn.disabled = !isValid;
  }

  async submit() {
    if (!this.selectedRegion) { alert('请选择保护区域'); return; }
    if (!this.fingerprint) { alert('未获取到纹样指纹，请重新上传图片后再试'); return; }

    const submitBtn = this.overlay.querySelector('.form-actions .btn-primary');
    const oldText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';

    const formData = {
      fingerprint: this.fingerprint,
      meta: {
        name: document.getElementById('region-pattern-name').value.trim(),
        owner: document.getElementById('region-owner').value.trim(),
        culture_type: document.getElementById('region-culture-type').value,
        protection_level: document.getElementById('region-protection-level').value,
        authenticity: document.getElementById('region-authenticity').value,
        region_name: this.selectedRegion.name,
        region_code: this.selectedRegion.code,
        region_level: this.selectedRegion.level
      },
      provider: 'region-chain'
    };

    try {
      const response = await fetch(`${CHAIN_CONFIG.proxyUrl}/api/anchor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const result = await response.json();

      if (response.ok) {
        this.evidence = result;
        this.showResult(result);
      } else {
        alert(`确权失败: ${result.error || response.status}`);
        submitBtn.disabled = false;
        submitBtn.textContent = oldText;
      }
    } catch (error) {
      console.error('确权请求失败:', error);
      alert('确权请求失败，请重试');
      submitBtn.disabled = false;
      submitBtn.textContent = oldText;
    }
  }

  showResult(evidence) {
    const formDiv = this.overlay.querySelector('.region-chain-form');
    const resultDiv = this.overlay.querySelector('.region-chain-result');
    const contentDiv = resultDiv.querySelector('.result-content');

    const fmtTime = (t) => t ? new Date(Number(t) || t).toLocaleString('zh-CN') : '—';
    const shortTx = (h) => h ? (String(h).slice(0, 20) + '...') : '—';

    contentDiv.innerHTML = `
      <div class="result-success">
        <div class="result-icon">✅</div>
        <h4>确权成功！</h4>
        <div class="result-details">
          <p><strong>区域:</strong> ${evidence.region_name || '—'}</p>
          <p><strong>区域层级:</strong> ${evidence.region_level || '—'}</p>
          <p><strong>证据ID:</strong> ${evidence.evidenceId || '—'}</p>
          <p><strong>交易哈希:</strong> ${shortTx(evidence.chainTxHash)}</p>
          <p><strong>确权时间:</strong> ${fmtTime(evidence.blockTime)}</p>
        </div>
        ${evidence.explorerUrl ? `
        <div class="result-explorer">
          <a href="${evidence.explorerUrl}" target="_blank" class="explorer-link" rel="noopener">
            🔗 查看链上信息
          </a>
        </div>` : ''}
      </div>
    `;

    formDiv.style.display = 'none';
    resultDiv.style.display = 'block';
  }

  viewOnChain() {
    if (this.evidence && this.evidence.explorerUrl) {
      window.open(this.evidence.explorerUrl, '_blank');
    } else {
      alert('暂无链上信息');
    }
  }

  reset() {
    document.getElementById('region-pattern-name').value = '';
    document.getElementById('region-owner').value = '';
    document.getElementById('region-culture-type').value = '传统纹样';
    document.getElementById('region-protection-level').value = '一般';
    document.getElementById('region-authenticity').value = '待验证';

    this.selectedRegion = null;
    this.evidence = null;
    this.overlay.querySelectorAll('.region-card').forEach(c => c.classList.remove('selected'));

    this.overlay.querySelector('.region-chain-form').style.display = 'block';
    this.overlay.querySelector('.region-chain-result').style.display = 'none';
    this.checkFormValidity();
  }

  cancel() {
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
  }
}

// 全局实例
let regionChainUI = null;

// 初始化区域链UI（每次调用重建界面，确保拿到最新指纹）
function initRegionChainUI() {
  if (regionChainUI) regionChainUI.cancel();
  regionChainUI = new RegionChainUI();
  return regionChainUI;
}

// 导出供外部使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RegionChainUI, initRegionChainUI };
} else {
  window.RegionChainUI = RegionChainUI;
  window.initRegionChainUI = initRegionChainUI;
}
