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
    unsubscribe: undefined,
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
    "ha-icon[icon*='home-assistant' i]",
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
    const source = [
      element.getAttribute("src"),
      element.getAttribute("href"),
      element.getAttribute("alt"),
      element.getAttribute("title"),
      element.getAttribute("icon"),
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
      if (!state.originals.has(node)) {
        state.originals.set(node, node.nodeValue || "");
      }
      const original = state.originals.get(node) || "";
      const next = state.config.enabled ? replaceText(original) : original;
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
        if (!originals.has(attr)) {
          originals.set(attr, element.getAttribute(attr) || "");
        }
        const original = originals.get(attr) || "";
        const next = state.config.enabled ? replaceText(original) : original;
        if (element.getAttribute(attr) !== next) {
          element.setAttribute(attr, next);
        }
      }
    }
  };

  const patchBrandAssets = (root) => {
    const logoUrl = toAbsoluteUrl(state.config.logo_url);
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
    observer.observe(root, {
      attributes: true,
      attributeFilter: [...TEXT_ATTRIBUTES, "src", "href", "icon"],
      characterData: true,
      childList: true,
      subtree: true,
    });
    state.observers.push(observer);
  };

  const patchDom = () => {
    walkRoots(document, (root) => {
      observeRoot(root);
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

  const applyStyleBranding = () => {
    const config = state.config;
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }

    const rootVars = [
      config.primary_color ? `--primary-color: ${config.primary_color};` : "",
      config.accent_color ? `--accent-color: ${config.accent_color};` : "",
      config.logo_url
        ? `--branding-manager-logo: ${cssUrl(config.logo_url)};`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    style.textContent = config.enabled
      ? `
:root {
${rootVars}
}

ha-icon[data-branding-manager-logo="true"],
ha-svg-icon[data-branding-manager-logo="true"] {
  background-image: var(--branding-manager-logo);
  background-position: center;
  background-repeat: no-repeat;
  background-size: contain;
  color: transparent !important;
}

ha-icon[data-branding-manager-logo="true"] *,
ha-svg-icon[data-branding-manager-logo="true"] * {
  opacity: 0 !important;
}

${config.custom_css}
`
      : "";
  };

  const applyBranding = () => {
    state.config = normalizeConfig(state.config);
    applyStyleBranding();
    applyDocumentBranding();
    patchDom();
  };

  const findHass = () => {
    const candidates = [
      document.querySelector("home-assistant"),
      document.querySelector("hc-main"),
      document.querySelector("home-assistant-main"),
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (candidate?.hass?.connection) {
        return candidate.hass;
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

  const subscribeUpdates = async (hass) => {
    if (state.unsubscribe) {
      state.unsubscribe();
      state.unsubscribe = undefined;
    }

    if (hass.connection?.subscribeMessage) {
      state.unsubscribe = await hass.connection.subscribeMessage((message) => {
        state.config = normalizeConfig(message.config || message);
        applyBranding();
      }, { type: `${DOMAIN}/subscribe_updates` });
      return;
    }

    if (hass.connection?.subscribeEvents) {
      state.unsubscribe = await hass.connection.subscribeEvents((event) => {
        state.config = normalizeConfig(event.data?.config || event.config);
        applyBranding();
      }, `${DOMAIN}_updated`);
    }
  };

  const loadConfig = async () => {
    const hass = await waitForHass();
    const config = await hass.connection.sendMessagePromise({
      type: `${DOMAIN}/get_config`,
    });
    state.config = normalizeConfig(config);
    applyBranding();
    await subscribeUpdates(hass);
  };

  window.brandingManager = {
    apply: applyBranding,
    reload: loadConfig,
    setLocalConfig(config) {
      state.config = normalizeConfig(config);
      applyBranding();
    },
    get config() {
      return { ...state.config };
    },
  };

  loadConfig().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[Branding Manager] Could not load branding config", err);
  });
})();
