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
