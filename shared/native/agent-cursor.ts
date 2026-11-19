/** Fixed page overlay. Numeric coordinates only; it never receives page or caller HTML. */
export function agentCursorExpression(x: number, y: number, pressed = false): string {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    throw new Error("Invalid agent cursor coordinates");
  }
  return `(() => {
    const key = '__paseoAgentCursor';
    let host = window[key];
    if (!host || !host.isConnected) {
      host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483647!important;pointer-events:none!important;width:0!important;height:0!important;';
      const root = host.attachShadow({mode:'closed'});
      const marker = document.createElement('div');
      marker.style.cssText = 'width:max-content;pointer-events:none;color:#7c3aed;font:600 11px system-ui;white-space:nowrap;filter:drop-shadow(0 1px 2px #0005)';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '24'); svg.setAttribute('height', '28'); svg.setAttribute('viewBox', '0 0 24 28');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M2 2 L2 23 L8 18 L12 26 L16 24 L12 16 L21 16 Z');
      path.setAttribute('fill', '#7c3aed'); path.setAttribute('stroke', 'white'); path.setAttribute('stroke-width', '2');
      svg.appendChild(path);
      const label = document.createElement('span'); label.textContent = 'Agent';
      label.style.cssText = 'display:block;width:max-content;margin-left:18px;padding:3px 7px;border-radius:5px;background:#7c3aed;color:white';
      marker.append(svg, label);
      root.appendChild(marker);
      document.documentElement.appendChild(host);
      window[key] = host;
    }
    host.style.setProperty('left', ${x} + 'px', 'important');
    host.style.setProperty('top', ${y} + 'px', 'important');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('filter', ${JSON.stringify(pressed ? 'drop-shadow(0 0 5px #a78bfa)' : 'none')}, 'important');
    clearTimeout(host.hideTimer);
    host.hideTimer = setTimeout(() => { host.remove(); if (window[key] === host) delete window[key]; }, 8000);
  })()`;
}
