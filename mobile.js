/* ============================================================
   麓山绘梦·纹鉴 — 手机端行为 (mobile.js)
   仅对窄屏生效：调起摄像头拍照、详情面板全屏弹层开关
   ============================================================ */
(function () {
  /* ---------- 等待 DOM ready ---------- */
  function init() {
    const dp = document.getElementById('detailPanel');
    if (!dp) {
      setTimeout(init, 100);
      return;
    }

    const isMobile = () => window.matchMedia('(max-width: 820px)').matches;

    /* ---------- 详情面板：移动端全屏弹层 ---------- */
    const closeBtn = document.createElement('button');
    closeBtn.className = 'detail-close';
    closeBtn.innerHTML = '✕';
    closeBtn.setAttribute('aria-label', '关闭详情');
    closeBtn.addEventListener('click', () => {
      dp.classList.remove('open');
      closeBtn.classList.remove('show');
    });
    document.body.appendChild(closeBtn);

    function syncDetail() {
      const empty = dp.querySelector('.no-selection');
      if (isMobile()) {
        if (empty) { dp.classList.remove('open'); closeBtn.classList.remove('show'); }
        else { dp.classList.add('open'); closeBtn.classList.add('show'); }
      } else {
        dp.classList.remove('open'); closeBtn.classList.remove('show');
      }
    }
    const obs = new MutationObserver(syncDetail);
    obs.observe(dp, { childList: true, subtree: true });
    syncDetail();
    window.addEventListener('resize', syncDetail);

    /* ---------- 手机端：摄像头拍照按钮 ---------- */
    if (isMobile()) {
      const cam = document.createElement('input');
      cam.type = 'file';
      cam.id = 'cameraInput';
      cam.accept = 'image/*';
      cam.setAttribute('capture', 'environment');
      cam.style.display = 'none';
      cam.addEventListener('change', (e) => {
        if (typeof window.handleFileSelect === 'function') window.handleFileSelect(e);
      });
      document.body.appendChild(cam);

      const uz = document.getElementById('uploadZone');
      if (uz) {
        const cb = document.createElement('button');
        cb.type = 'button';
        cb.className = 'mobile-camera-btn';
        cb.innerHTML = '  拍照识别';
        cb.addEventListener('click', (ev) => { ev.stopPropagation(); cam.click(); });
        uz.appendChild(cb);
      }
    }
  }

  // DOM ready 后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }
})();

/* ============================================================
   __BACK_NAV_PATCH__ 返回键/浏览器返回 支持 (2026-09-23)
   - 面板切换、详情全屏层、编辑弹窗打开时 pushState 入栈
   - popstate 时反向恢复: 弹窗 -> 详情 -> 面板
   - 安卓返回键 = WebView 后退 (Capacitor 默认), 栈底再按才退出
   ============================================================ */
(function () {
  var dp = document.getElementById('detailPanel');
  var em = document.getElementById('editModal');
  if (!dp) return;
  var MARK = '__BACK_NAV_PATCH__';
  if (window.__backNavPatched) return;
  window.__backNavPatched = true;

  var navFromPop = false;

  function currentPanel() {
    var a = document.querySelector('.panel.active');
    return a ? a.id.replace('panel-', '') : 'recognize';
  }
  function push(st) { try { window.history.pushState(st, ''); } catch (e) {} }
  function appState() { return (window.history.state && window.history.state.__app === true) ? window.history.state : null; }

  // 初始状态占位
  try { if (!appState()) window.history.replaceState({ __app: true, panel: currentPanel() }, ''); } catch (e) {}

  // 1) 面板切换入栈 (包装全局 switchPanel; popstate 恢复时不再入栈)
  var origSwitch = window.switchPanel;
  if (typeof origSwitch === 'function') {
    window.switchPanel = function (name) {
      origSwitch(name);
      if (!navFromPop) {
        var st = appState();
        if (!st || st.panel !== name) push({ __app: true, panel: name });
      }
    };
  }

  // 2) 详情全屏层打开入栈 (监听 class 变化, 不侵入原 syncDetail)
  new MutationObserver(function () {
    if (dp.classList.contains('open')) {
      var st = appState();
      if (!st || !st.detail) push({ __app: true, panel: currentPanel(), detail: true });
    }
  }).observe(dp, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });

  // 3) 编辑弹窗: 打开入栈, 关闭改走 back()
  ['openAddModal', 'openEditModal'].forEach(function (fn) {
    var orig = window[fn];
    if (typeof orig === 'function') {
      window[fn] = function () {
        var r = orig.apply(this, arguments);
        if (em && em.classList.contains('show')) {
          var st = appState();
          if (!st || !st.modal) push({ __app: true, panel: currentPanel(), modal: true });
        }
        return r;
      };
    }
  });
  var origCloseModal = window.closeModal;
  if (typeof origCloseModal === 'function') {
    window.closeModal = function () {
      var st = appState();
      if (st && st.modal) { window.history.back(); return; }
      return origCloseModal.apply(this, arguments);
    };
  }

  // 4) ✕ 关详情改走 back() (捕获阶段拦截, 原有直关逻辑不再触发)
  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('.detail-close') : null;
    if (!btn) return;
    var st = appState();
    if (st && st.detail) { ev.stopPropagation(); ev.preventDefault(); window.history.back(); }
  }, true);

  // 5) 返回键/浏览器返回: 反向恢复
  window.addEventListener('popstate', function (e) {
    navFromPop = true;
    try {
      var st = (e.state && e.state.__app === true) ? e.state : { panel: 'recognize' };
      if (em && em.classList.contains('show')) em.classList.remove('show');
      if (dp.classList.contains('open') && !st.detail) {
        dp.classList.remove('open');
        var dc = document.querySelector('.detail-close');
        if (dc) dc.classList.remove('show');
      }
      if (typeof origSwitch === 'function' && st.panel && !dp.classList.contains('open')) {
        origSwitch(st.panel);
      } else if (typeof origSwitch === 'function' && st.panel) {
        origSwitch(st.panel);
      }
    } finally {
      setTimeout(function () { navFromPop = false; }, 0);
    }
  });
})();
