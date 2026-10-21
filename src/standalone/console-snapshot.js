// Page Debug Snapshot - wersja do wklejenia w konsolę DevTools
// Wklej całość w Console i naciśnij Enter -> pobierze się plik JSON ze snapshotem.

(function () {
  if (window.PageDebugSnapshot) {
    console.warn('PageDebugSnapshot already exists on window.');
    return;
  }

  window.PageDebugSnapshot = {
    version: '1.0.0',
    initialized: false,

    config: {
      buttonText: '📸 Snapshot',
      fileNamePrefix: 'page-debug-snapshot',
      maxHtmlLength: 2000000,
      maxTextLength: 50000,
      maxItems: 5000,
      createFloatingButton: true,
      buttonPosition: {
        bottom: '20px',
        right: '20px'
      },
      zIndex: 2147483647
    },

    state: {
      initializedAt: null,
      consoleLogs: [],
      runtimeErrors: [],
      network: [],
      notes: [
        'Console logs are captured only from initialization time.',
        'Fetch/XHR logs are captured only from initialization time.',
        'Already loaded resources are collected from Performance API.'
      ]
    },

    original: {
      console: {},
      fetch: null,
      XMLHttpRequest: null
    },

    ui: {
      button: null,
      toast: null
    },

    init(userConfig = {}) {
      if (this.initialized) {
        console.warn('PageDebugSnapshot is already initialized.');
        return this;
      }

      this.config = this.deepMerge(this.config, userConfig);
      this.state.initializedAt = new Date().toISOString();

      this.installConsoleHooks();
      this.installErrorHooks();
      this.installFetchHook();
      this.installXHRHook();

      if (this.config.createFloatingButton) {
        this.createUI();
      }

      this.initialized = true;

      console.info('PageDebugSnapshot initialized.');
      return this;
    },

    destroy() {
      if (!this.initialized) return;

      this.restoreConsole();
      this.restoreFetch();
      this.restoreXHR();
      this.removeUI();

      this.initialized = false;
      console.info('PageDebugSnapshot destroyed.');
    },

    deepMerge(target, source) {
      const output = { ...target };

      if (!source || typeof source !== 'object') {
        return output;
      }

      Object.keys(source).forEach((key) => {
        if (
          source[key] &&
          typeof source[key] === 'object' &&
          !Array.isArray(source[key]) &&
          typeof output[key] === 'object' &&
          output[key] !== null
        ) {
          output[key] = this.deepMerge(output[key], source[key]);
        } else {
          output[key] = source[key];
        }
      });

      return output;
    },

    nowIso() {
      return new Date().toISOString();
    },

    safeSlice(value, max = this.config.maxTextLength) {
      if (typeof value !== 'string') return value;
      return value.length > max
        ? value.slice(0, max) + `... [truncated ${value.length - max} chars]`
        : value;
    },

    pushLimited(arr, item, max = this.config.maxItems) {
      arr.push(item);
      if (arr.length > max) arr.shift();
    },

    safeJson(value) {
      const seen = new WeakSet();
      const self = this;

      const replacer = function (_key, val) {
        if (typeof val === 'function') {
          return `[Function: ${val.name || 'anonymous'}]`;
        }

        if (val instanceof Error) {
          return {
            name: val.name,
            message: val.message,
            stack: val.stack
          };
        }

        if (typeof Element !== 'undefined' && val instanceof Element) {
          return {
            tagName: val.tagName,
            id: val.id,
            className: val.className,
            outerHTML: self.safeSlice(val.outerHTML, 2000)
          };
        }

        if (typeof Node !== 'undefined' && val instanceof Node) {
          return `[Node: ${val.nodeName}]`;
        }

        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }

        return val;
      };

      try {
        return JSON.parse(JSON.stringify(value, replacer));
      } catch (err) {
        return {
          serializationError: err?.message || 'Unknown serialization error',
          fallback: String(value)
        };
      }
    },

    getAttributes(el) {
      if (!el?.attributes) return {};
      return Array.from(el.attributes).reduce((acc, attr) => {
        acc[attr.name] = attr.value;
        return acc;
      }, {});
    },

    textContentShort(el, max = 300) {
      if (!el) return '';
      return this.safeSlice((el.textContent || '').trim().replace(/\s+/g, ' '), max);
    },

    getElementSummary(el) {
      return {
        tagName: el.tagName,
        id: el.id || null,
        className: el.className || null,
        name: el.getAttribute?.('name') || null,
        type: el.getAttribute?.('type') || null,
        src: el.getAttribute?.('src') || null,
        href: el.getAttribute?.('href') || null,
        text: this.textContentShort(el),
        attributes: this.getAttributes(el)
      };
    },

    installConsoleHooks() {
      const self = this;
      const methods = ['log', 'info', 'warn', 'error', 'debug'];

      methods.forEach((level) => {
        self.original.console[level] = console[level];

        console[level] = function (...args) {
          self.pushLimited(self.state.consoleLogs, {
            timestamp: self.nowIso(),
            level,
            args: self.safeJson(args)
          });

          return self.original.console[level].apply(console, args);
        };
      });
    },

    restoreConsole() {
      const methods = ['log', 'info', 'warn', 'error', 'debug'];
      methods.forEach((level) => {
        if (this.original.console[level]) {
          console[level] = this.original.console[level];
        }
      });
    },

    installErrorHooks() {
      window.addEventListener('error', (event) => {
        this.pushLimited(this.state.runtimeErrors, {
          timestamp: this.nowIso(),
          type: 'error',
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: this.safeJson(event.error)
        });
      });

      window.addEventListener('unhandledrejection', (event) => {
        this.pushLimited(this.state.runtimeErrors, {
          timestamp: this.nowIso(),
          type: 'unhandledrejection',
          reason: this.safeJson(event.reason)
        });
      });
    },

    installFetchHook() {
      if (typeof window.fetch !== 'function') return;

      const self = this;
      this.original.fetch = window.fetch;

      window.fetch = async function (...args) {
        const startedAt = performance.now();
        const startedIso = self.nowIso();

        const requestInfo = {
          type: 'fetch',
          startedAt: startedIso,
          input: self.safeJson(args[0]),
          init: self.safeJson(args[1] || null)
        };

        try {
          const response = await self.original.fetch.apply(this, args);
          const durationMs = +(performance.now() - startedAt).toFixed(2);

          self.pushLimited(self.state.network, {
            ...requestInfo,
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            url: response.url,
            redirected: response.redirected,
            responseType: response.type,
            durationMs,
            headers: Object.fromEntries(response.headers.entries())
          });

          return response;
        } catch (error) {
          const durationMs = +(performance.now() - startedAt).toFixed(2);

          self.pushLimited(self.state.network, {
            ...requestInfo,
            error: self.safeJson(error),
            durationMs
          });

          throw error;
        }
      };
    },

    restoreFetch() {
      if (this.original.fetch) {
        window.fetch = this.original.fetch;
      }
    },

    installXHRHook() {
      if (typeof window.XMLHttpRequest !== 'function') return;

      const self = this;
      this.original.XMLHttpRequest = window.XMLHttpRequest;

      function DebugXHR() {
        const xhr = new self.original.XMLHttpRequest();
        const record = {
          type: 'xhr',
          startedAt: null,
          startedAtIso: null,
          method: null,
          url: null,
          async: true,
          requestHeaders: {},
          status: null,
          statusText: null,
          durationMs: null,
          responseURL: null
        };

        const originalOpen = xhr.open;
        const originalSend = xhr.send;
        const originalSetRequestHeader = xhr.setRequestHeader;

        xhr.open = function (method, url, async = true, user, password) {
          record.startedAt = performance.now();
          record.startedAtIso = self.nowIso();
          record.method = method;
          record.url = url;
          record.async = async;
          return originalOpen.call(this, method, url, async, user, password);
        };

        xhr.setRequestHeader = function (header, value) {
          record.requestHeaders[header] = value;
          return originalSetRequestHeader.call(this, header, value);
        };

        xhr.addEventListener('loadend', function () {
          record.status = xhr.status;
          record.statusText = xhr.statusText;
          record.responseURL = xhr.responseURL;
          record.readyState = xhr.readyState;
          record.durationMs = record.startedAt != null
            ? +(performance.now() - record.startedAt).toFixed(2)
            : null;

          self.pushLimited(self.state.network, self.safeJson(record));
        });

        xhr.send = function (body) {
          record.body =
            typeof body === 'string'
              ? self.safeSlice(body, 5000)
              : self.safeJson(body);

          return originalSend.call(this, body);
        };

        return xhr;
      }

      window.XMLHttpRequest = DebugXHR;
    },

    restoreXHR() {
      if (this.original.XMLHttpRequest) {
        window.XMLHttpRequest = this.original.XMLHttpRequest;
      }
    },

    getPerformanceSummary() {
      const nav = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource');

      return {
        timeOrigin: performance.timeOrigin,
        navigation: nav
          ? {
              name: nav.name,
              entryType: nav.entryType,
              startTime: nav.startTime,
              duration: nav.duration,
              initiatorType: nav.initiatorType,
              nextHopProtocol: nav.nextHopProtocol,
              renderBlockingStatus: nav.renderBlockingStatus,
              workerStart: nav.workerStart,
              redirectStart: nav.redirectStart,
              redirectEnd: nav.redirectEnd,
              fetchStart: nav.fetchStart,
              domainLookupStart: nav.domainLookupStart,
              domainLookupEnd: nav.domainLookupEnd,
              connectStart: nav.connectStart,
              secureConnectionStart: nav.secureConnectionStart,
              connectEnd: nav.connectEnd,
              requestStart: nav.requestStart,
              responseStart: nav.responseStart,
              responseEnd: nav.responseEnd,
              domInteractive: nav.domInteractive,
              domContentLoadedEventStart: nav.domContentLoadedEventStart,
              domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
              domComplete: nav.domComplete,
              loadEventStart: nav.loadEventStart,
              loadEventEnd: nav.loadEventEnd,
              transferSize: nav.transferSize,
              encodedBodySize: nav.encodedBodySize,
              decodedBodySize: nav.decodedBodySize,
              type: nav.type
            }
          : null,
        resources: resources.map((r) => ({
          name: r.name,
          entryType: r.entryType,
          initiatorType: r.initiatorType,
          startTime: r.startTime,
          duration: r.duration,
          transferSize: r.transferSize,
          encodedBodySize: r.encodedBodySize,
          decodedBodySize: r.decodedBodySize,
          nextHopProtocol: r.nextHopProtocol,
          renderBlockingStatus: r.renderBlockingStatus || null,
          responseEnd: r.responseEnd
        }))
      };
    },

    getStorageSnapshot() {
      const localStorageData = {};
      const sessionStorageData = {};

      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          localStorageData[key] = this.safeSlice(localStorage.getItem(key), 5000);
        }
      } catch (e) {
        localStorageData.__error = e.message;
      }

      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          sessionStorageData[key] = this.safeSlice(sessionStorage.getItem(key), 5000);
        }
      } catch (e) {
        sessionStorageData.__error = e.message;
      }

      return {
        cookies: document.cookie,
        localStorage: localStorageData,
        sessionStorage: sessionStorageData
      };
    },

    collectDomSnapshot() {
      const allElements = Array.from(document.querySelectorAll('*'));

      return {
        counts: {
          totalElements: allElements.length,
          scripts: document.scripts.length,
          stylesheets: document.styleSheets.length,
          images: document.images.length,
          links: document.links.length,
          iframes: document.querySelectorAll('iframe').length,
          forms: document.forms.length
        },
        html: {
          doctype: document.doctype
            ? {
                name: document.doctype.name,
                publicId: document.doctype.publicId,
                systemId: document.doctype.systemId
              }
            : null,
          lang: document.documentElement.lang || null,
          charset: document.characterSet,
          compatMode: document.compatMode,
          outerHTML: this.safeSlice(
            document.documentElement.outerHTML,
            this.config.maxHtmlLength
          )
        },
        meta: Array.from(document.querySelectorAll('meta')).map((el) =>
          this.getElementSummary(el)
        ),
        canonical: document.querySelector('link[rel="canonical"]')?.href || null,
        hreflangs: Array.from(
          document.querySelectorAll('link[rel="alternate"][hreflang]')
        ).map((el) => ({
          hreflang: el.getAttribute('hreflang'),
          href: el.href
        })),
        scripts: Array.from(document.scripts).map((el) => ({
          src: el.src || null,
          type: el.type || null,
          async: el.async,
          defer: el.defer,
          textLength: el.src ? 0 : (el.textContent || '').length,
          id: el.id || null,
          attributes: this.getAttributes(el)
        })),
        stylesheets: Array.from(
          document.querySelectorAll('link[rel="stylesheet"], style')
        ).map((el) => ({
          tagName: el.tagName,
          href: el.getAttribute('href') || null,
          media: el.getAttribute('media') || null,
          disabled: !!el.disabled,
          textLength: el.tagName === 'STYLE' ? (el.textContent || '').length : 0,
          attributes: this.getAttributes(el)
        })),
        images: Array.from(document.images).map((img) => ({
          src: img.currentSrc || img.src,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          width: img.width,
          height: img.height,
          loading: img.loading || null,
          alt: img.alt || null
        })),
        iframes: Array.from(document.querySelectorAll('iframe')).map((el) => ({
          src: el.src || null,
          id: el.id || null,
          name: el.name || null,
          title: el.title || null,
          attributes: this.getAttributes(el)
        })),
        forms: Array.from(document.forms).map((form) => ({
          id: form.id || null,
          name: form.name || null,
          method: form.method || null,
          action: form.action || null,
          enctype: form.enctype || null,
          elements: Array.from(form.elements).map((el) => ({
            tagName: el.tagName,
            type: el.type || null,
            name: el.name || null,
            id: el.id || null,
            value: ['password', 'hidden'].includes(el.type)
              ? '[redacted]'
              : this.safeSlice(el.value, 500),
            checked: typeof el.checked === 'boolean' ? el.checked : undefined
          }))
        })),
        rootMarkers: {
          bodyClassName: document.body?.className || null,
          htmlClassName: document.documentElement.className || null,
          dataAttributesOnHtml: this.getAttributes(document.documentElement),
          dataAttributesOnBody: document.body ? this.getAttributes(document.body) : {}
        }
      };
    },

    collectEnvironment() {
      return {
        timestamp: this.nowIso(),
        location: {
          href: location.href,
          origin: location.origin,
          protocol: location.protocol,
          host: location.host,
          hostname: location.hostname,
          port: location.port,
          pathname: location.pathname,
          search: location.search,
          hash: location.hash
        },
        document: {
          title: document.title,
          referrer: document.referrer,
          readyState: document.readyState,
          visibilityState: document.visibilityState,
          lastModified: document.lastModified
        },
        navigator: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          languages: navigator.languages,
          cookieEnabled: navigator.cookieEnabled,
          onLine: navigator.onLine,
          platform: navigator.platform,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemory: navigator.deviceMemory || null
        },
        screen: {
          width: screen.width,
          height: screen.height,
          availWidth: screen.availWidth,
          availHeight: screen.availHeight,
          colorDepth: screen.colorDepth,
          pixelDepth: screen.pixelDepth
        },
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight,
          devicePixelRatio: window.devicePixelRatio,
          scrollX: window.scrollX,
          scrollY: window.scrollY
        }
      };
    },

    snapshot() {
      const snapshot = {
        version: this.version,
        collectedAt: this.nowIso(),
        initializedAt: this.state.initializedAt,
        notes: [...this.state.notes],
        environment: this.collectEnvironment(),
        dom: this.collectDomSnapshot(),
        performance: this.getPerformanceSummary(),
        storage: this.getStorageSnapshot(),
        consoleLogs: [...this.state.consoleLogs],
        runtimeErrors: [...this.state.runtimeErrors],
        network: [...this.state.network]
      };

      window.__PAGE_DEBUG_SNAPSHOT__ = snapshot;
      return snapshot;
    },

    download(filename) {
      const snapshot = this.snapshot();
      const finalName =
        filename ||
        `${this.config.fileNamePrefix}-${Date.now()}.json`;

      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: 'application/json'
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');

      a.href = url;
      a.download = finalName;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
      return snapshot;
    },

    showToast(message, isError = false) {
      if (!this.ui.toast) return;

      this.ui.toast.textContent = message;
      this.ui.toast.style.background = isError ? '#b00020' : '#0a7f39';
      this.ui.toast.style.opacity = '1';
      this.ui.toast.style.transform = 'translateY(0)';

      clearTimeout(this.ui.toast.__hideTimeout);
      this.ui.toast.__hideTimeout = setTimeout(() => {
        this.ui.toast.style.opacity = '0';
        this.ui.toast.style.transform = 'translateY(10px)';
      }, 2200);
    },

    createUI() {
      if (document.getElementById('__page_debug_snapshot_button__')) return;

      const btn = document.createElement('button');
      btn.id = '__page_debug_snapshot_button__';
      btn.type = 'button';
      btn.textContent = this.config.buttonText;

      Object.assign(btn.style, {
        position: 'fixed',
        bottom: this.config.buttonPosition.bottom,
        right: this.config.buttonPosition.right,
        zIndex: String(this.config.zIndex),
        padding: '10px 14px',
        fontSize: '14px',
        lineHeight: '1.2',
        fontWeight: '600',
        background: '#111',
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        opacity: '0.92',
        transition: 'all 0.2s ease'
      });

      btn.addEventListener('mouseenter', () => {
        btn.style.opacity = '1';
      });

      btn.addEventListener('mouseleave', () => {
        btn.style.opacity = '0.92';
      });

      const toast = document.createElement('div');
      toast.id = '__page_debug_snapshot_toast__';

      Object.assign(toast.style, {
        position: 'fixed',
        bottom: `calc(${this.config.buttonPosition.bottom} + 52px)`,
        right: this.config.buttonPosition.right,
        zIndex: String(this.config.zIndex),
        padding: '8px 12px',
        fontSize: '12px',
        background: '#0a7f39',
        color: '#fff',
        borderRadius: '6px',
        opacity: '0',
        transform: 'translateY(10px)',
        transition: 'all 0.2s ease',
        pointerEvents: 'none',
        maxWidth: '280px',
        wordBreak: 'break-word',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
      });

      btn.addEventListener('click', () => {
        try {
          btn.disabled = true;
          btn.textContent = '⏳ Working...';

          this.download();

          btn.textContent = this.config.buttonText;
          btn.disabled = false;
          this.showToast('Snapshot downloaded');
        } catch (e) {
          console.error(e);
          btn.textContent = this.config.buttonText;
          btn.disabled = false;
          this.showToast('Snapshot error', true);
        }
      });

      document.body.appendChild(btn);
      document.body.appendChild(toast);

      this.ui.button = btn;
      this.ui.toast = toast;
    },

    removeUI() {
      if (this.ui.button?.remove) this.ui.button.remove();
      if (this.ui.toast?.remove) this.ui.toast.remove();

      this.ui.button = null;
      this.ui.toast = null;
    }
  };
})();
(function () {
  try {
    if (!window.PageDebugSnapshot.initialized) {
      window.PageDebugSnapshot.init({ createFloatingButton: false });
    }
    window.PageDebugSnapshot.download();
  } catch (error) {
    console.error('[PageDebugSnapshot Console]', error);
  }
})();
