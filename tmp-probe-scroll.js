(() => {
  const t = document.querySelector('textarea')
  window.__log = []
  const push = (o) => window.__log.push(Object.assign({ at: Math.round(performance.now()) }, o))
  const stackOf = (n) => (new Error().stack || '').split(String.fromCharCode(10)).slice(1, n || 8).join(' <- ')

  const wrapMethod = (proto, name, label) => {
    const orig = proto[name]
    if (typeof orig !== 'function') return
    proto[name] = function (...args) {
      if (this === t || (this && this.contains && this.contains(t))) {
        push({ kind: label, args: args.map((a) => (typeof a === 'object' ? 'obj' : a)), stack: stackOf() })
      }
      return orig.apply(this, args)
    }
  }
  wrapMethod(Element.prototype, 'scrollTo', 'scrollTo')
  wrapMethod(Element.prototype, 'scrollBy', 'scrollBy')
  wrapMethod(Element.prototype, 'scrollIntoView', 'scrollIntoView')
  wrapMethod(HTMLTextAreaElement.prototype, 'setSelectionRange', 'setSelectionRange')
  wrapMethod(HTMLTextAreaElement.prototype, 'focus', 'focus')

  const sd = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
  Object.defineProperty(t, 'scrollTop', {
    configurable: true,
    get() {
      return sd.get.call(this)
    },
    set(v) {
      push({ kind: 'setScrollTop', v: v, stack: stackOf(6) })
      sd.set.call(this, v)
    },
  })

  const mo = new MutationObserver((records) => {
    records.forEach((r) => {
      r.addedNodes.forEach((n) => {
        if (n === t) return
        push({ kind: 'dom+', tag: n.nodeName, cls: n.className && String(n.className).slice(0, 40) })
      })
      r.removedNodes.forEach((n) => {
        if (n === t) return
        push({ kind: 'dom-', tag: n.nodeName, cls: n.className && String(n.className).slice(0, 40) })
      })
    })
  })
  mo.observe(document.body, { childList: true })

  t.addEventListener('scroll', () => {
    push({ kind: 'scroll', val: t.scrollTop, h: t.scrollHeight, sel: t.selectionStart, active: document.activeElement === t })
  })
  return 'patched3'
})()
