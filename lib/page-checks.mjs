// Runs inside the page through page.evaluate, so it must not reference anything outside itself.
export function collectChecks({ touch, minTap, minFont, deviceWidth }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const findings = [];
  const examined = { elements: 0, interactive: 0, textElements: 0, canvases: 0, images: 0 };
  const INTERACTIVE =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [onclick], [tabindex]:not([tabindex="-1"])';
  const esc = (value) => (window.CSS && CSS.escape ? CSS.escape(value) : value);

  const selectorOf = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && parts.length < 4; node = node.parentElement) {
      if (node.id) {
        parts.unshift(`#${esc(node.id)}`);
        break;
      }
      const classes = (node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      parts.unshift(node.tagName.toLowerCase() + classes.map((c) => `.${esc(c)}`).join(''));
    }
    return parts.join(' > ');
  };
  const textOf = (el) => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 48);
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  // The browser still gives a box to what sits inside a closed details or under content-visibility: hidden, when asked.
  // Nobody sees it, so it is never a defect. A closed details always shows its summary.
  const skippedCache = new WeakMap();
  const skipped = (el) => {
    if (skippedCache.has(el)) return skippedCache.get(el);
    const parent = el.parentElement;
    const hidden = Boolean(parent) && (skipped(parent) || (parent.tagName === 'DETAILS' && !parent.open && el.tagName !== 'SUMMARY') || getComputedStyle(parent).contentVisibility === 'hidden');
    skippedCache.set(el, hidden);
    return hidden;
  };
  const isVisible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0 || skipped(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  const ownText = (el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.nodeValue.trim().length > 0);
  const add = (check, severity, el, detail) => {
    findings.push({ check, severity, sel: el ? selectorOf(el) : '', text: el ? textOf(el) : '', detail, rect: el ? rectOf(el) : undefined });
  };
  // Each check lists a few elements and then one line for the rest, so no count is hidden by the cap.
  const more = (check, severity, extra, what) => {
    if (extra > 0) findings.push({ check, severity, sel: '', text: '', detail: `${extra} more ${what}`, count: extra });
  };
  const safe = (name, fn) => {
    try {
      fn();
    } catch (error) {
      findings.push({ check: 'checker', severity: 'info', sel: '', text: '', detail: `${name} check failed to run. ${error.message}` });
    }
  };
  const scrollerCache = new WeakMap();
  const inScroller = (el) => {
    for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      if (!scrollerCache.has(node)) {
        const s = getComputedStyle(node);
        scrollerCache.set(node, /(auto|scroll)/.test(s.overflowX) && node.scrollWidth > node.clientWidth + 1);
      }
      if (scrollerCache.get(node)) return true;
    }
    return false;
  };

  const ELEMENT_CAP = 4000;
  const allElements = Array.from(document.querySelectorAll('body *'));
  const all = allElements.slice(0, ELEMENT_CAP);
  const visible = all.filter(isVisible);
  examined.elements = visible.length;
  // Elements past the cap are never measured, so a clean count would stand for a page that was only partly checked. Say how many were left out.
  examined.skipped = Math.max(0, allElements.length - ELEMENT_CAP);
  if (examined.skipped > 0) findings.push({ check: 'notExamined', severity: 'weak', sel: '', text: '', detail: `${examined.skipped} elements after the first ${ELEMENT_CAP} on the page were not measured, so a clean result covers only the top of it`, count: 1 });
  const meaningful = (el) => ownText(el) || el.matches(INTERACTIVE) || /^(IMG|CANVAS|VIDEO|SVG|INPUT|SELECT|TEXTAREA)$/i.test(el.tagName);

  safe('blank', () => {
    const hasText = (document.body.innerText || '').trim().length > 0;
    if (!hasText && !document.querySelector('canvas, img, video, svg')) {
      findings.push({ check: 'blank', severity: 'broken', sel: 'body', text: '', detail: 'the page renders no text, canvas, image or svg' });
    }
  });

  safe('zoomedOut', () => {
    if (!touch || !deviceWidth || vw <= deviceWidth * 1.02) return;
    findings.push({
      check: 'zoomedOut',
      severity: 'broken',
      sel: 'html',
      text: '',
      detail: `the layout is ${vw}px wide on a ${deviceWidth}px screen, so the phone shrinks the whole page. Add a width=device-width viewport meta tag and fix whatever is wider than the screen`,
    });
  });

  safe('overflowX', () => {
    const width = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
    if (width > vw + 1) {
      findings.push({ check: 'overflowX', severity: 'broken', sel: 'html', text: '', detail: `the page is ${width}px wide in a ${vw}px viewport, ${width - vw}px too wide` });
    }
  });

  safe('offscreen', () => {
    const hits = [];
    for (const el of visible) {
      if (!meaningful(el) || el.ownerSVGElement) continue;
      if (el.closest('[aria-hidden="true"]') && !el.matches(INTERACTIVE)) continue;
      const s = getComputedStyle(el);
      if (s.pointerEvents === 'none' && !ownText(el)) continue;
      const r = el.getBoundingClientRect();
      const fixed = s.position === 'fixed';
      const cutLeft = r.left < -1 && r.right > 1;
      const cutRight = r.right > vw + 1 && r.left < vw - 1;
      const cutBottom = fixed && r.bottom > vh + 1 && r.top < vh - 1;
      const cutTop = fixed && r.top < -1 && r.bottom > 1;
      if (!(cutLeft || cutRight || cutBottom || cutTop)) continue;
      if (!fixed && inScroller(el)) continue;
      hits.push({ el, over: Math.max(-r.left, r.right - vw, fixed ? r.bottom - vh : 0, fixed ? -r.top : 0) });
    }
    hits.sort((a, b) => b.over - a.over);
    for (const hit of hits.slice(0, 8)) add('offscreen', 'broken', hit.el, `cut off by ${Math.round(hit.over)}px at the screen edge`);
    more('offscreen', 'broken', hits.length - 8, 'elements cut off at the screen edge');
  });

  safe('unreachable', () => {
    let count = 0;
    for (const el of visible) {
      if (!el.matches(INTERACTIVE)) continue;
      const r = el.getBoundingClientRect();
      const outside = r.right <= 0 || r.left >= vw;
      if (!outside || inScroller(el) || getComputedStyle(el).position === 'fixed') continue;
      if (count++ < 6) add('unreachable', 'weak', el, 'interactive element sits fully outside the viewport with no scroller to reach it');
    }
    more('unreachable', 'weak', count - 6, 'interactive elements outside the viewport with no scroller to reach them');
  });

  // The visually hidden pattern for screen reader text is a 1px box that clips its own content on purpose.
  const visuallyHidden = (el) => {
    const r = el.getBoundingClientRect();
    return r.width <= 2 && r.height <= 2;
  };

  safe('truncated', () => {
    let count = 0;
    let extraImportant = 0;
    for (const el of visible) {
      if (!ownText(el)) continue;
      examined.textElements += 1;
      const s = getComputedStyle(el);
      if (s.display === 'inline' || el.tagName === 'INPUT' || visuallyHidden(el)) continue;
      const xClip = /(hidden|clip)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1;
      const yClip = /(hidden|clip)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 2;
      if (!xClip && !yClip) continue;
      const important = el.matches(INTERACTIVE) || Boolean(el.closest('button, a[href], [role="button"], label, h1, h2, h3, th, [role="tab"]'));
      const how = xClip ? `cut off horizontally by ${el.scrollWidth - el.clientWidth}px` : `cut off vertically by ${el.scrollHeight - el.clientHeight}px`;
      if (count++ < 12) add('truncated', important ? 'broken' : 'weak', el, `text ${how}${s.textOverflow === 'ellipsis' ? ' with an ellipsis' : ''}`);
      else if (important) extraImportant += 1;
    }
    more('truncated', extraImportant > 0 ? 'broken' : 'weak', count - 12, 'elements with text cut off');
  });

  // Text that runs past the edge of the chip, card or button it sits in. Nothing clips it, so no other check sees it,
  // and it is often unreadable because the page behind has a different color. Clipped text is the truncated check's job.
  safe('spill', () => {
    const boxCache = new WeakMap();
    const isBox = (node) => {
      if (boxCache.has(node)) return boxCache.get(node);
      const s = getComputedStyle(node);
      const alpha = (color) => {
        const m = color.match(/rgba?\(([^)]+)\)/);
        if (!m) return color === 'transparent' ? 0 : 1;
        const parts = m[1].split(/[\s,/]+/).filter(Boolean);
        return parts.length >= 4 ? parseFloat(parts[3]) : 1;
      };
      const border = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== 'none' && alpha(s[`border${side}Color`]) > 0.05);
      const result = alpha(s.backgroundColor) > 0.05 || s.backgroundImage !== 'none' || border;
      boxCache.set(node, result);
      return result;
    };
    const range = document.createRange();
    const hits = [];
    for (const el of visible) {
      if (!ownText(el) || el.ownerSVGElement || el.closest('[aria-hidden="true"]') || visuallyHidden(el)) continue;
      const own = getComputedStyle(el);
      if (own.position === 'fixed' || inScroller(el)) continue;
      let box = null;
      for (let node = el; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
        if (isBox(node)) {
          box = node;
          break;
        }
      }
      if (!box) continue;
      const bs = getComputedStyle(box);
      const br = box.getBoundingClientRect();
      if (br.width * br.height > vw * vh * 0.6) continue;
      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      for (const node of el.childNodes) {
        if (node.nodeType !== 3 || !node.nodeValue.trim()) continue;
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width < 1 || r.height < 1) continue;
          left = Math.min(left, r.left);
          right = Math.max(right, r.right);
          top = Math.min(top, r.top);
          bottom = Math.max(bottom, r.bottom);
        }
      }
      if (!Number.isFinite(left)) continue;
      const clipsX = /(hidden|clip|auto|scroll)/.test(bs.overflowX);
      const clipsY = /(hidden|clip|auto|scroll)/.test(bs.overflowY);
      const side = [
        !clipsX && left < br.left - 2 ? ['left', br.left - left] : null,
        !clipsX && right > br.right + 2 ? ['right', right - br.right] : null,
        !clipsY && top < br.top - 3 ? ['top', br.top - top] : null,
        !clipsY && bottom > br.bottom + 3 ? ['bottom', bottom - br.bottom] : null,
      ].filter(Boolean).sort((a, b) => b[1] - a[1])[0];
      if (!side) continue;
      hits.push({ el, box, side: side[0], by: side[1] });
    }
    hits.sort((a, b) => b.by - a.by);
    for (const hit of hits.slice(0, 10)) {
      const where = hit.box === hit.el ? 'its own box' : selectorOf(hit.box);
      add('spill', hit.by >= 6 ? 'broken' : 'weak', hit.el, `text sticks out of ${where} by ${Math.round(hit.by)}px on the ${hit.side}`);
    }
    const rest = hits.slice(10);
    more('spill', rest.some((hit) => hit.by >= 6) ? 'broken' : 'weak', rest.length, 'elements with text sticking out of their box');
  });

  safe('tapTargets', () => {
    const targets = visible.filter((el) => el.matches(INTERACTIVE) && !el.disabled);
    examined.interactive = targets.length;
    if (!touch) return;
    let count = 0;
    for (const el of targets) {
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue;
      let r = el.getBoundingClientRect();
      if (el.tagName === 'INPUT' && /^(checkbox|radio)$/.test(el.type)) {
        const label = el.closest('label') || (el.id ? document.querySelector(`label[for="${esc(el.id)}"]`) : null);
        if (label) r = label.getBoundingClientRect();
      }
      if (Math.min(r.width, r.height) >= minTap - 0.5) continue;
      if (count++ < 15) add('tinyTap', 'weak', el, `${Math.round(r.width)}x${Math.round(r.height)}px touch target, the guideline is ${minTap}px`);
    }
    more('tinyTap', 'weak', count - 15, `touch targets under ${minTap}px`);
  });

  safe('tinyText', () => {
    if (!minFont) return;
    const sizes = new Map();
    for (const el of visible) {
      if (!ownText(el)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size >= minFont - 0.01) continue;
      const key = size.toFixed(1);
      if (!sizes.has(key)) sizes.set(key, { el, count: 0 });
      sizes.get(key).count += 1;
    }
    for (const [size, { el, count }] of sizes) add('tinyText', 'weak', el, `${count} text element${count === 1 ? '' : 's'} at ${size}px, the minimum is ${minFont}px`);
  });

  safe('overlap', () => {
    // With a modal open the page behind it cannot be reached, so only the controls inside the modal compete for space.
    // A modal still fading in has opacity 0 but already takes the clicks, so opacity does not decide here.
    const takesClicks = (node) => {
      const s = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      return s.display !== 'none' && s.visibility === 'visible' && s.pointerEvents !== 'none' && r.width >= 1 && r.height >= 1;
    };
    const modal = Array.from(document.querySelectorAll('[aria-modal="true"], dialog[open]')).find(takesClicks);
    const interactive = visible.filter((el) => el.matches(INTERACTIVE) && (!modal || modal.contains(el)));
    const targets = interactive.slice(0, 250);
    if (interactive.length > targets.length) add('notExamined', 'weak', null, `${interactive.length - targets.length} controls after the first 250 were not checked for overlap`);
    const rects = targets.map((el) => el.getBoundingClientRect());
    let count = 0;
    for (let i = 0; i < targets.length; i += 1) {
      for (let j = i + 1; j < targets.length; j += 1) {
        if (targets[i].contains(targets[j]) || targets[j].contains(targets[i])) continue;
        const a = rects[i];
        const b = rects[j];
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w <= 0 || h <= 0) continue;
        const share = (w * h) / Math.min(a.width * a.height, b.width * b.height);
        if (share < 0.3) continue;
        if (count++ < 8) add('overlap', 'weak', targets[i], `overlaps ${selectorOf(targets[j])} by ${Math.round(share * 100)}%`);
      }
    }
    more('overlap', 'weak', count - 8, 'pairs of controls that overlap');
  });

  safe('images', () => {
    for (const img of document.images) {
      if (!isVisible(img)) continue;
      examined.images += 1;
      if (img.complete && img.naturalWidth === 0) add('brokenImage', 'broken', img, `image did not load (${(img.currentSrc || img.src || '').slice(-60)})`);
    }
  });

  safe('canvas', () => {
    for (const canvas of document.querySelectorAll('canvas')) {
      const s = getComputedStyle(canvas);
      if (s.display === 'none') continue;
      examined.canvases += 1;
      const r = canvas.getBoundingClientRect();
      const ratio = canvas.width / Math.max(r.width * dpr, 1);
      const pixelArt = /(pixelated|crisp-edges)/.test(s.imageRendering);
      const flags = [];
      if (r.width < 2 || r.height < 2) flags.push('collapsed to zero size');
      else {
        if (r.width >= 100 && ratio < 0.85 && !pixelArt) flags.push(`blurry, the backing store is ${canvas.width}px for ${Math.round(r.width * dpr)} device pixels`);
        const drift = canvas.width / canvas.height / (r.width / r.height);
        if (canvas.height > 0 && Math.abs(drift - 1) > 0.03) flags.push(`stretched, backing aspect ${(canvas.width / canvas.height).toFixed(2)} but shown at ${(r.width / r.height).toFixed(2)}`);
        if (r.right > vw + 1 || r.left < -1) flags.push('wider than the viewport');
      }
      for (const flag of flags) add('canvas', 'broken', canvas, flag);
      if (ratio > 2.6 && r.width >= 100) add('canvas', 'info', canvas, `the backing store is ${ratio.toFixed(1)}x what this screen can show`);
    }
  });

  safe('viewportMeta', () => {
    if (!touch) return;
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      findings.push({ check: 'viewportMeta', severity: 'weak', sel: 'head', text: '', detail: 'no viewport meta tag, so phones lay the page out at 980px wide' });
      return;
    }
    const content = meta.getAttribute('content') || '';
    if (!/width\s*=\s*device-width/.test(content)) findings.push({ check: 'viewportMeta', severity: 'weak', sel: 'head', text: '', detail: `viewport meta has no width=device-width (${content})` });
    if (/user-scalable\s*=\s*(no|0)/.test(content) || /maximum-scale\s*=\s*1(\.0)?(\s|,|$)/.test(content)) {
      findings.push({ check: 'zoomBlocked', severity: 'info', sel: 'head', text: '', detail: 'pinch zoom is disabled' });
    }
  });

  safe('safeArea', () => {
    if (!touch) return;
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) if (rule.cssText.includes('safe-area-inset')) return;
      } catch {
        // cross-origin sheet, cannot read
      }
    }
    const edge = visible.filter((el) => {
      if (getComputedStyle(el).position !== 'fixed') return false;
      const r = el.getBoundingClientRect();
      return r.height < 220 && (r.bottom >= vh - 1 || r.top <= 1);
    });
    if (edge.length) add('safeArea', 'info', edge[0], `${edge.length} fixed element${edge.length === 1 ? '' : 's'} touch a screen edge and no CSS uses env(safe-area-inset-*)`);
  });

  return { findings, examined, viewport: { w: vw, h: vh, dpr } };
}

// Runs inside the page through page.evaluate, so it must not reference anything outside itself.
// The strings a person reads on the page in its current state, one per block of text, before CSS changes their case.
// Hidden things, scripts and styles are left out. Text a script puts on the page counts, because this reads the page and not its source.
export function collectStrings() {
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head']);
  const ATTRIBUTES = ['alt', 'title', 'aria-label', 'placeholder'];
  const out = [];
  const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
  const push = (text) => {
    const value = clean(text);
    if (/\p{L}/u.test(value)) out.push(value);
  };
  const hiddenBySelf = (el) => {
    const s = getComputedStyle(el);
    return s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || s.contentVisibility === 'hidden';
  };
  const closedDetails = (el) => el.parentElement?.tagName === 'DETAILS' && !el.parentElement.open && el.localName !== 'summary';
  const inline = (el) => {
    const display = getComputedStyle(el).display;
    return display.startsWith('inline') || display === 'contents';
  };
  let line = '';
  const flush = () => {
    push(line);
    line = '';
  };
  const attributes = (el) => {
    for (const name of ATTRIBUTES) if (el.hasAttribute(name)) push(el.getAttribute(name));
    if (el.localName === 'input' && /^(submit|button|reset)$/i.test(el.getAttribute('type') || '')) push(el.getAttribute('value'));
  };
  const walk = (el) => {
    if (SKIP.has(el.localName) || hiddenBySelf(el) || closedDetails(el)) return;
    const block = !inline(el);
    if (block) flush();
    attributes(el);
    if (el.localName === 'br') flush();
    for (const node of el.childNodes) {
      if (node.nodeType === 3) line += node.nodeValue;
      else if (node.nodeType === 1) walk(node);
    }
    if (block) flush();
  };
  if (document.body) walk(document.body);
  flush();
  return out;
}
