/* ══════════════════════════════════════════
   Notify —— 任务完成提示音
   用 Web Audio 现场合成，不带任何音频文件
   ══════════════════════════════════════════ */

const Notify = {
  _ctx: null,

  /** 提示音种类 —— 设置页直接读这个表 */
  SOUNDS: [
    ['none',  '关闭'],
    ['chime', '清脆双音'],
    ['ding',  '单声叮'],
    ['pop',   '轻气泡'],
    ['down',  '下行三音']
  ],

  _ac() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this._ctx = new AC();
    }
    if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
    return this._ctx;
  },

  /** 合成一个音；t 为相对开始的秒数 */
  _tone(ac, freq, t, dur, gain = 0.14, type = 'sine') {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime + t);
    // 快起慢落，避免爆音
    g.gain.setValueAtTime(0.0001, ac.currentTime + t);
    g.gain.exponentialRampToValueAtTime(gain, ac.currentTime + t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + dur);
    osc.connect(g); g.connect(ac.destination);
    osc.start(ac.currentTime + t);
    osc.stop(ac.currentTime + t + dur + 0.02);
  },

  play(kind) {
    const name = kind || (Store.settings.notify && Store.settings.notify.sound) || 'chime';
    if (name === 'none') return;
    const ac = this._ac();
    if (!ac) return;
    const vol = ((Store.settings.notify && Store.settings.notify.volume) ?? 70) / 100;
    const g = 0.05 + vol * 0.16;

    switch (name) {
      case 'ding':
        this._tone(ac, 880, 0, 0.5, g);
        break;
      case 'pop':
        this._tone(ac, 420, 0, 0.10, g, 'triangle');
        break;
      case 'down':
        this._tone(ac, 660, 0,    0.22, g);
        this._tone(ac, 550, 0.10, 0.22, g);
        this._tone(ac, 440, 0.20, 0.40, g);
        break;
      case 'chime':
      default:
        this._tone(ac, 784, 0,    0.28, g);          // G5
        this._tone(ac, 1046, 0.10, 0.42, g);         // C6
        break;
    }
  },

  /** 失败用下行音，和成功区分开 */
  fail() {
    const ac = this._ac();
    if (!ac) return;
    const vol = ((Store.settings.notify && Store.settings.notify.volume) ?? 70) / 100;
    const g = 0.05 + vol * 0.14;
    this._tone(ac, 440, 0,    0.20, g, 'triangle');
    this._tone(ac, 330, 0.14, 0.34, g, 'triangle');
  },

  /** 是否该响：总开关 + 分项开关都开才响 */
  onDone() {
    const n = Store.settings.notify || {};
    if (n.soundEnabled === false) return;
    if (n.onDone === false) return;
    this.play();
  },

  onFail() {
    const n = Store.settings.notify || {};
    if (n.soundEnabled === false) return;
    if (n.onFail === false) return;
    this.fail();
  }
};
