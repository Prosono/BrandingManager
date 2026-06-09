(() => {
  const DOMAIN = "branding_manager";
  const STYLE_ID = "branding-manager-style";
  const MANIFEST_ID = "branding-manager-manifest";
  const PATCH_DEBOUNCE_MS = 80;

  const DEFAULT_CONFIG = {
    enabled: true,
    app_name: "My Home",
    company_name: "",
    document_title: "",
    logo_url: "",
    favicon_url: "",
    primary_color: "",
    accent_color: "",
    replace_home_assistant: true,
    replacements: [],
    custom_css: "",
  };

  const state = {
    config: { ...DEFAULT_CONFIG },
    originals: new WeakMap(),
    attrOriginals: new WeakMap(),
    observedRoots: new WeakSet(),
    observers: [],
    patchTimer: undefined,
    pollTimer: undefined,
    styleText: "",
    unsubscribe: undefined,
    api: undefined,
    loaded: false,
  };

  const SKIP_TEXT_TAGS = new Set([
    "CODE",
    "INPUT",
    "SCRIPT",
    "STYLE",
    "TEXTAREA",
  ]);

  const TEXT_ATTRIBUTES = [
    "alt",
    "aria-label",
    "label",
    "placeholder",
    "title",
  ];

  const LOGO_SELECTOR = [
    "img",
    "image",
    "svg[aria-label*='Home Assistant' i]",
    "svg[title*='Home Assistant' i]",
    "ha-icon[icon*='home-assistant' i]",
    "ha-icon[icon*='homeassistant' i]",
    "ha-icon[icon='hass:home-assistant']",
    "ha-svg-icon[title*='Home Assistant' i]",
  ].join(",");

  const normalizeConfig = (rawConfig = {}) => {
    const config = { ...DEFAULT_CONFIG, ...rawConfig };
    config.enabled = Boolean(config.enabled);
    config.replace_home_assistant = Boolean(config.replace_home_assistant);

    for (const key of [
      "app_name",
      "company_name",
      "document_title",
      "logo_url",
      "favicon_url",
      "primary_color",
      "accent_color",
      "custom_css",
    ]) {
      config[key] = String(config[key] || "").trim();
    }

    config.replacements = Array.isArray(config.replacements)
      ? config.replacements
          .map((item) => ({
            from: String(item?.from || "").trim(),
            to: String(item?.to || ""),
            case_sensitive: Boolean(item?.case_sensitive),
          }))
          .filter((item) => item.from)
      : [];

    return config;
  };

  const getReplacementRules = () => {
    const config = state.config;
    const rules = [];

    if (config.replace_home_assistant && config.app_name) {
      rules.push(
        { from: "Home Assistant", to: config.app_name },
        { from: "HomeAssistant", to: config.app_name.replace(/\s+/g, "") },
        { from: "home-assistant", to: config.app_name.toLowerCase().replace(/\s+/g, "-") },
        { from: "homeassistant", to: config.app_name.toLowerCase().replace(/\s+/g, "") },
      );
    }

    return [...rules, ...config.replacements];
  };

  const escapeRegExp = (value) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const replaceText = (value) => {
    if (!state.config.enabled || !value) {
      return value;
    }

    return getReplacementRules().reduce((output, replacement) => {
      const flags = replacement.case_sensitive ? "g" : "gi";
      return output.replace(
        new RegExp(escapeRegExp(replacement.from), flags),
        replacement.to,
      );
    }, value);
  };

  const isBrandAsset = (element) => {
    const className =
      typeof element.className === "string"
        ? element.className
        : element.className?.baseVal;
    const source = [
      element.getAttribute("src"),
      element.getAttribute("href"),
      element.getAttribute("alt"),
      element.getAttribute("title"),
      element.getAttribute("icon"),
      element.getAttribute("aria-label"),
      className,
      element.querySelector?.("title")?.textContent,
    ]
      .filter(Boolean)
      .join(" ");
    return /home[-\s]?assistant|hass:home-assistant/i.test(source);
  };

  const toAbsoluteUrl = (value) => {
    if (!value) {
      return "";
    }
    try {
      return new URL(value, window.location.href).toString();
    } catch (_err) {
      return "";
    }
  };

  const cssUrl = (value) => {
    const url = toAbsoluteUrl(value);
    return url ? `url("${url.replace(/"/g, "%22")}")` : "none";
  };

  const getAttrOriginals = (element) => {
    let originals = state.attrOriginals.get(element);
    if (!originals) {
      originals = new Map();
      state.attrOriginals.set(element, originals);
    }
    return originals;
  };

  const patchTextNodes = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIP_TEXT_TAGS.has(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node = walker.nextNode();
    while (node) {
      const current = node.nodeValue || "";
      const original = state.originals.get(node);
      const patchedOriginal =
        original === undefined ? undefined : replaceText(original);

      if (
        original === undefined ||
        (current !== original && current !== patchedOriginal)
      ) {
        state.originals.set(node, current);
      }
      const nextOriginal = state.originals.get(node) || "";
      const next = state.config.enabled
        ? replaceText(nextOriginal)
        : nextOriginal;
      if (node.nodeValue !== next) {
        node.nodeValue = next;
      }
      node = walker.nextNode();
    }
  };

  const patchAttributes = (root) => {
    const elements = root.querySelectorAll?.("*") || [];
    for (const element of elements) {
      const originals = getAttrOriginals(element);
      for (const attr of TEXT_ATTRIBUTES) {
        if (!element.hasAttribute(attr)) {
          continue;
        }
        const current = element.getAttribute(attr) || "";
        const original = originals.get(attr);
        const patchedOriginal =
          original === undefined ? undefined : replaceText(original);

        if (
          original === undefined ||
          (current !== original && current !== patchedOriginal)
        ) {
          originals.set(attr, current);
        }
        const nextOriginal = originals.get(attr) || "";
        const next = state.config.enabled
          ? replaceText(nextOriginal)
          : nextOriginal;
        if (element.getAttribute(attr) !== next) {
          element.setAttribute(attr, next);
        }
      }
    }
  };

  const patchBrandAssets = (root) => {
    const logoUrl = toAbsoluteUrl(
      state.config.logo_url || state.config.favicon_url,
    );
    if (!state.config.enabled || !logoUrl) {
      return;
    }

    const elements = root.querySelectorAll?.(LOGO_SELECTOR) || [];
    for (const element of elements) {
      if (!isBrandAsset(element)) {
        continue;
      }

      if (element instanceof HTMLImageElement) {
        if (element.src !== logoUrl) {
          element.src = logoUrl;
        }
        element.alt = state.config.app_name || element.alt;
        continue;
      }

      if (element instanceof SVGImageElement) {
        element.setAttribute("href", logoUrl);
        continue;
      }

      if (element instanceof SVGSVGElement) {
        element.setAttribute("data-branding-manager-logo", "true");
        element.setAttribute("role", "img");
        continue;
      }

      element.setAttribute("data-branding-manager-logo", "true");
    }
  };

  const walkRoots = (root, callback) => {
    callback(root);
    const elements = root.querySelectorAll?.("*") || [];
    for (const element of elements) {
      if (element.shadowRoot) {
        walkRoots(element.shadowRoot, callback);
      }
    }
  };

  const observeRoot = (root) => {
    if (state.observedRoots.has(root)) {
      return;
    }
    state.observedRoots.add(root);

    const observer = new MutationObserver(schedulePatch);
    try {
      observer.observe(root, {
        attributes: true,
        attributeFilter: [...TEXT_ATTRIBUTES, "src", "href", "icon"],
        characterData: true,
        childList: true,
        subtree: true,
      });
    } catch (_err) {
      observer.observe(root, {
        characterData: true,
        childList: true,
        subtree: true,
      });
    }
    state.observers.push(observer);
  };

  const patchDom = () => {
    walkRoots(document, (root) => {
      observeRoot(root);
      ensureStyle(root);
      patchTextNodes(root);
      patchAttributes(root);
      patchBrandAssets(root);
    });
  };

  function schedulePatch() {
    if (state.patchTimer !== undefined) {
      return;
    }
    state.patchTimer = window.setTimeout(() => {
      state.patchTimer = undefined;
      patchDom();
    }, PATCH_DEBOUNCE_MS);
  }

  const setLink = (id, rel, href, type) => {
    if (!href) {
      return;
    }

    let link = document.getElementById(id);
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = rel;
      document.head.appendChild(link);
    }
    link.href = href;
    if (type) {
      link.type = type;
    }
  };

  const applyDocumentBranding = () => {
    const config = state.config;
    if (!config.enabled) {
      return;
    }

    const appName = config.app_name || DEFAULT_CONFIG.app_name;
    document.title = config.document_title || appName;

    const iconUrl = toAbsoluteUrl(config.favicon_url || config.logo_url);
    setLink("branding-manager-icon", "icon", iconUrl);
    setLink("branding-manager-shortcut-icon", "shortcut icon", iconUrl);
    setLink("branding-manager-apple-icon", "apple-touch-icon", iconUrl);

    const manifest = {
      name: appName,
      short_name: appName,
      start_url: window.location.origin,
      display: "standalone",
      icons: iconUrl
        ? [
            {
              src: iconUrl,
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: iconUrl,
              sizes: "512x512",
              type: "image/png",
            },
          ]
        : [],
    };
    const manifestUrl = `data:application/manifest+json,${encodeURIComponent(
      JSON.stringify(manifest),
    )}`;
    setLink(MANIFEST_ID, "manifest", manifestUrl, "application/manifest+json");
  };

  const getStyleContainer = (root) => {
    if (root === document) {
      return document.head;
    }
    return root;
  };

  const ensureStyle = (root) => {
    const container = getStyleContainer(root);
    if (!container) {
      return;
    }

    let style = container.querySelector?.(`#${STYLE_ID}`);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      container.appendChild(style);
    }

    if (style.textContent !== state.styleText) {
      style.textContent = state.styleText;
    }
  };

  const buildStyleText = () => {
    const config = state.config;

    const rootVars = [
      config.primary_color ? `--primary-color: ${config.primary_color};` : "",
      config.accent_color ? `--accent-color: ${config.accent_color};` : "",
      config.logo_url || config.favicon_url
        ? `--branding-manager-logo: ${cssUrl(config.logo_url || config.favicon_url)};`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    if (!config.enabled) {
      return "";
    }

    return `
:root {
${rootVars}
}

[data-branding-manager-logo="true"] {
  background-image: var(--branding-manager-logo);
  background-position: center;
  background-repeat: no-repeat;
  background-size: contain;
  color: transparent !important;
  fill: transparent !important;
  overflow: hidden;
}

[data-branding-manager-logo="true"] *,
svg[data-branding-manager-logo="true"] > * {
  opacity: 0 !important;
}

${config.custom_css}
`;
  };

  const applyStyleBranding = () => {
    state.styleText = buildStyleText();
    walkRoots(document, ensureStyle);
  };

  const applyBranding = () => {
    state.config = normalizeConfig(state.config);
    applyStyleBranding();
    applyDocumentBranding();
    patchDom();
  };

  const findHass = () => {
    const roots = [document];
    const seenRoots = new WeakSet();

    while (roots.length) {
      const root = roots.shift();
      if (!root || seenRoots.has(root)) {
        continue;
      }
      seenRoots.add(root);

      const elements = [
        root.host,
        root.querySelector?.("home-assistant"),
        root.querySelector?.("hc-main"),
        root.querySelector?.("home-assistant-main"),
        ...(root.querySelectorAll?.("*") || []),
      ].filter(Boolean);

      for (const element of elements) {
        if (
          element.hass &&
          (typeof element.hass.callWS === "function" ||
            typeof element.hass.connection?.sendMessagePromise === "function")
        ) {
          return element.hass;
        }
        if (element.shadowRoot) {
          roots.push(element.shadowRoot);
        }
      }
    }

    return undefined;
  };

  const waitForHass = () =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        const hass = findHass();
        if (hass) {
          window.clearInterval(timer);
          resolve(hass);
          return;
        }
        if (Date.now() - started > 60000) {
          window.clearInterval(timer);
          reject(new Error("Timed out waiting for Home Assistant frontend"));
        }
      }, 250);
    });

  const getContext = (context) =>
    new Promise((resolve, reject) => {
      const target = document.querySelector("home-assistant") || document.body;
      const timeout = window.setTimeout(() => {
        reject(new Error(`Timed out waiting for ${context} context`));
      }, 5000);
      const event = new CustomEvent("context-request", {
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      event.context = context;
      event.subscribe = false;
      event.callback = (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      };
      target.dispatchEvent(event);
    });

  const getConnection = async (hass) => {
    if (hass.connection) {
      return hass.connection;
    }

    try {
      const context = await getContext("connection");
      return context?.connection || context?.conn || context;
    } catch (_err) {
      return undefined;
    }
  };

  const callWS = async (hass, message) => {
    if (typeof hass.callWS === "function") {
      return hass.callWS(message);
    }

    if (typeof hass.connection?.sendMessagePromise === "function") {
      return hass.connection.sendMessagePromise(message);
    }

    const connection = await getConnection(hass);
    if (typeof connection?.sendMessagePromise === "function") {
      return connection.sendMessagePromise(message);
    }

    throw new Error("No Home Assistant WebSocket API is available");
  };

  const configsAreEqual = (first, second) =>
    JSON.stringify(first) === JSON.stringify(second);

  const refreshConfig = async (hass, forceApply = false) => {
    const config = normalizeConfig(
      await callWS(hass, { type: `${DOMAIN}/get_config` }),
    );
    const changed = !configsAreEqual(config, state.config);
    state.config = config;
    state.loaded = true;
    if (changed || forceApply) {
      applyBranding();
    }
  };

  const startPolling = (hass) => {
    if (state.pollTimer !== undefined) {
      return;
    }

    state.pollTimer = window.setInterval(() => {
      refreshConfig(hass).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[Branding Manager] Could not refresh branding config", err);
      });
    }, 5000);

    window.addEventListener("focus", () => {
      refreshConfig(hass).catch(() => undefined);
    });
  };

  const subscribeUpdates = async (hass) => {
    if (state.unsubscribe) {
      state.unsubscribe();
      state.unsubscribe = undefined;
    }

    const connection = await getConnection(hass);

    if (connection?.subscribeMessage) {
      state.unsubscribe = await connection.subscribeMessage((message) => {
        state.config = normalizeConfig(message.config || message);
        state.loaded = true;
        applyBranding();
      }, { type: `${DOMAIN}/subscribe_updates` });
      return true;
    }

    if (connection?.subscribeEvents) {
      state.unsubscribe = await connection.subscribeEvents((event) => {
        state.config = normalizeConfig(event.data?.config || event.config);
        state.loaded = true;
        applyBranding();
      }, `${DOMAIN}_updated`);
      return true;
    }

    return false;
  };

  const loadConfig = async () => {
    const hass = await waitForHass();
    state.api = hass;
    await refreshConfig(hass, true);
    if (!(await subscribeUpdates(hass))) {
      startPolling(hass);
    }
  };

  window.brandingManager = {
    apply: applyBranding,
    reload: loadConfig,
    refresh() {
      return state.api ? refreshConfig(state.api, true) : loadConfig();
    },
    setLocalConfig(config) {
      state.config = normalizeConfig(config);
      applyBranding();
    },
    get config() {
      return { ...state.config };
    },
    get status() {
      return {
        loaded: state.loaded,
        hasApi: Boolean(state.api),
        subscribed: Boolean(state.unsubscribe),
        polling: state.pollTimer !== undefined,
      };
    },
  };

  loadConfig().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[Branding Manager] Could not load branding config", err);
  });
})();
