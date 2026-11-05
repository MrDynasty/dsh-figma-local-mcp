// DSH supplies React. The left-sidebar row opens the host's keyed main page.
window.__ModuleLoader__.load({
  id: 'dsh-figma-local-mcp',
  factory: (require) => {
    const React = require('react')
    const PANEL_ID = 'dsh-figma'

    function activePanel(layout) {
      try { return layout?.panelInfo?.getSnapshot?.()?.activePanelId ?? null } catch { return null }
    }

    // Same-origin iframe: copy only skin variables and typography, never host data.
    // It remains an isolated settings document with its existing CSP and auth.
    function bindSkin(frame, ctx) {
      let pending = null, disposed = false, previous = new Set()
      const sync = () => {
        pending = null
        if (disposed) return
        try {
          const root = frame.contentDocument?.documentElement
          if (!root) return
          const source = getComputedStyle(frame)
          const next = new Set()
          for (const name of source) {
            if (!name.startsWith('--dsw-')) continue
            next.add(name)
            const value = source.getPropertyValue(name).trim()
            if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value)
          }
          for (const name of previous) if (!next.has(name)) root.style.removeProperty(name)
          previous = next
          root.style.fontFamily = source.fontFamily
          root.style.fontSize = source.fontSize
          let scheme = source.colorScheme
          if (!/^(light|dark)$/.test(scheme)) {
            const bg = source.getPropertyValue('--dsw-alias-bg-base').trim()
            const hex = /^#([\da-f]{3}|[\da-f]{6})(?:[\da-f]{2})?$/i.exec(bg)?.[1]
            const rgb = hex ? (hex.length === 3 ? [...hex].map(c => parseInt(c + c, 16)) : [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))) : /^rgba?\(([^)]+)\)/.exec(bg)?.[1].match(/[\d.]+/g)?.slice(0, 3).map(Number)
            scheme = rgb?.length === 3 ? (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 < 140 ? 'dark' : 'light') : 'light dark'
          }
          root.style.colorScheme = scheme
        } catch { /* A navigating/disposed frame must never break the host. */ }
      }
      const schedule = () => { if (!disposed && pending === null) pending = requestAnimationFrame(sync) }
      const observer = new MutationObserver(schedule)
      observer.observe(document.documentElement, { attributes: true })
      if (document.body) observer.observe(document.body, { attributes: true })
      if (document.head) observer.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true })
      const offTheme = ctx?.on?.('theme/change', schedule)
      frame.addEventListener('load', schedule)
      sync()
      return () => {
        disposed = true
        observer.disconnect()
        offTheme?.()
        frame.removeEventListener('load', schedule)
        if (pending !== null) cancelAnimationFrame(pending)
      }
    }

    function Glyph({ size }) {
      const s = typeof size === 'number' ? size : 18
      return React.createElement('svg', {
        width: s, height: s, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      },
        React.createElement('rect', { x: 3.75, y: 3.75, width: 10.5, height: 10.5, rx: 2.5 }),
        React.createElement('path', { d: 'M9.75 9.75h8a2.5 2.5 0 0 1 2.5 2.5v5.5a2.5 2.5 0 0 1-2.5 2.5h-5.5a2.5 2.5 0 0 1-2.5-2.5z' }),
      )
    }

    function Panel({ ctx }) {
      const frame = React.useRef(null)
      React.useEffect(() => frame.current ? bindSkin(frame.current, ctx) : undefined, [ctx])
      return React.createElement('div', {
        style: { flex: '1 1 auto', width: '100%', minWidth: 0, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--dsw-alias-bg-base, transparent)' },
      }, React.createElement('iframe', {
        ref: frame, src: '/dsh-figma', title: 'Figma Token 配置和图片导出',
        style: { display: 'block', width: '100%', height: '100%', minHeight: 0, flex: '1 1 auto', border: 0, background: 'var(--dsw-alias-bg-base, transparent)' },
      }))
    }

    function apply(ctx) {
      const layout = ctx.layout ?? ctx.get?.('layout')
      // Both slots belong to other client plugins: 'main' is declared by the layout
      // entry, 'sidebar.panellist' by the sidebar entry, which only activates after its
      // own deeper inject set (uiWorkspace carries a long chain). Registering eagerly
      // therefore throws `slot "…" is not declared` and fails this whole entry, so wait
      // for each declaration — slots.inject is synchronous when the slot already exists.
      const offPanel = ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => ({ ctx }) }, Panel))
      const offRow = ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: () => 'Figma' }, Glyph))
      ctx.effect(() => () => {
        try { if (activePanel(layout) === PANEL_ID) layout.selectPanel(null) } catch {}
        offRow?.()
        offPanel?.()
      }, 'dsh-figma-local-mcp: left sidebar panel')
    }

    return { apply, inject: ['slots', 'layout'] }
  },
})
