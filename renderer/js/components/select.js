/* ══════════════════════════════════════════
   Select —— 把原生 <select> 换成统一风格的下拉

   做法：保留原生 select 在 DOM 里（隐藏但可读值），
   在它上面盖一个样式化的按钮 + 弹出菜单。
   取值仍走 select.value，change 事件照常派发，
   所以页面里原有的 addEventListener('change') 全都不用改。
   ══════════════════════════════════════════ */

const Select = {
  /** 把 root 下所有未处理的原生 select 换掉 */
  enhance(root) {
    const scope = root || document;
    scope.querySelectorAll('select:not([data-sel-ready])').forEach(sel => this._wrap(sel));
  },

  _wrap(sel) {
    sel.setAttribute('data-sel-ready', '1');
    const box = document.createElement('div');
    box.className = 'cselect';
    if (sel.style.width) box.style.width = sel.style.width;
    if (sel.style.maxWidth) box.style.maxWidth = sel.style.maxWidth;
    sel.parentNode.insertBefore(box, sel);
    box.appendChild(sel);
    sel.classList.add('cselect-native');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cselect-btn';
    btn.innerHTML = '<span class="cselect-label"></span><span class="cselect-caret"></span>';
    box.appendChild(btn);

    const label = btn.querySelector('.cselect-label');
    const sync = () => {
      const o = sel.options[sel.selectedIndex];
      label.textContent = o ? o.textContent : '';
      btn.disabled = sel.disabled;
    };
    this._sync = this._sync || [];
    this._sync.push(sync);
    sync();

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sel.disabled) return;
      const items = [...sel.options].map((o, i) => ({
        label: o.textContent, value: String(i), active: i === sel.selectedIndex, disabled: o.disabled
      }));
      App._menu(btn, items, (idx) => {
        sel.selectedIndex = Number(idx);
        sync();
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.dispatchEvent(new Event('input', { bubbles: true }));
      }, { align: 'left', minWidth: box.offsetWidth });
    });
  },

  /** 选项被脚本改写后重新同步显示文字 */
  refresh(root) {
    (root || document).querySelectorAll('.cselect').forEach(box => {
      const sel = box.querySelector('select');
      const label = box.querySelector('.cselect-label');
      if (!sel || !label) return;
      const o = sel.options[sel.selectedIndex];
      label.textContent = o ? o.textContent : '';
    });
  }
};
