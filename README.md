# Branding Manager

Branding Manager is a Home Assistant custom integration that white-labels the visible frontend for Home Assistant instances you administer. It can change the app name, browser title, favicon, logos, theme colors, selected text, and injected CSS at runtime.

It does not change Home Assistant Core, the API, licensing notices, package metadata, or the legal identity of the software. Use it for legitimate white-label deployments where you have the right to brand the instance.

## HACS

This repository is structured as a HACS integration repository:

```text
custom_components/branding_manager/
README.md
hacs.json
```

To install it with HACS:

1. Open **HACS**.
2. Open the three-dot menu and choose **Custom repositories**.
3. Add this GitHub repository URL.
4. Select **Integration** as the category.
5. Download **Branding Manager**.
6. Add the frontend module to `configuration.yaml`:

   ```yaml
   frontend:
     extra_module_url:
       - /branding-manager/branding-manager.js
   ```

7. Restart Home Assistant.
8. Add **Branding Manager** from **Settings > Devices & services > Add integration**.

For GitHub releases, publish a full GitHub release such as `v0.1.0`; a tag alone is not enough for the nicer HACS release picker.

## What it does

- Stores branding settings in Home Assistant storage.
- Exposes a config flow and options flow.
- Serves `/branding-manager/branding-manager.js` from the integration.
- Provides WebSocket commands for live config and update notifications.
- Provides `branding_manager.set_branding` and `branding_manager.reset_branding` services.
- Patches the frontend DOM continuously so route changes and lazy-loaded panels are rebranded too.

## Install

Copy this folder into your Home Assistant configuration:

```text
/config/custom_components/branding_manager
```

Restart Home Assistant, then add **Branding Manager** from **Settings > Devices & services > Add integration**.

To load the frontend patcher globally, add this to `configuration.yaml`:

```yaml
frontend:
  extra_module_url:
    - /branding-manager/branding-manager.js
```

Restart Home Assistant once more after adding the `frontend` configuration.

## Realtime updates

Use the integration options UI or call the service below:

```yaml
service: branding_manager.set_branding
data:
  enabled: true
  app_name: "Acme Home"
  document_title: "Acme Home"
  logo_url: "https://example.com/logo.png"
  favicon_url: "https://example.com/favicon.png"
  primary_color: "#1565c0"
  accent_color: "#ffb300"
  replace_home_assistant: true
  replacements:
    - from: "Home Assistant"
      to: "Acme Home"
      case_sensitive: false
```

Connected browsers receive the update over WebSocket and apply it without a refresh.

## Troubleshooting

If nothing changes in the frontend, first confirm that the module is loaded. Open the browser console in Home Assistant and run:

```js
window.brandingManager?.status
```

Expected output has `loaded: true` and either `subscribed: true` or `polling: true`.

If `window.brandingManager` is `undefined`, Home Assistant has not loaded `/branding-manager/branding-manager.js`. Check the `frontend.extra_module_url` entry, restart Home Assistant, and hard-refresh the browser.

## Notes

Home Assistant's `frontend.extra_module_url` is the important part. Lovelace dashboard resources are not loaded on every Home Assistant page, so they are not enough for full-interface branding.

The frontend module works by patching visible text and common brand assets in the browser. Home Assistant frontend internals can change between releases, so this should be tested after Home Assistant upgrades.
