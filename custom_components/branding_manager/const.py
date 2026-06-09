"""Constants for the Branding Manager integration."""

from __future__ import annotations

DOMAIN = "branding_manager"

DATA_MANAGER = "manager"

EVENT_BRANDING_UPDATED = f"{DOMAIN}_updated"

STATIC_URL = "/branding-manager"
STATIC_DIR = "frontend"

STORE_KEY = f"{DOMAIN}.config"
STORE_VERSION = 1

SERVICE_RESET_BRANDING = "reset_branding"
SERVICE_SET_BRANDING = "set_branding"

CONF_ACCENT_COLOR = "accent_color"
CONF_APP_NAME = "app_name"
CONF_COMPANY_NAME = "company_name"
CONF_CUSTOM_CSS = "custom_css"
CONF_DOCUMENT_TITLE = "document_title"
CONF_ENABLED = "enabled"
CONF_FAVICON_URL = "favicon_url"
CONF_LOGO_URL = "logo_url"
CONF_PRIMARY_COLOR = "primary_color"
CONF_REPLACE_HOME_ASSISTANT = "replace_home_assistant"
CONF_REPLACEMENTS = "replacements"

DEFAULT_BRANDING = {
    CONF_ENABLED: True,
    CONF_APP_NAME: "My Home",
    CONF_COMPANY_NAME: "",
    CONF_DOCUMENT_TITLE: "",
    CONF_LOGO_URL: "",
    CONF_FAVICON_URL: "",
    CONF_PRIMARY_COLOR: "",
    CONF_ACCENT_COLOR: "",
    CONF_REPLACE_HOME_ASSISTANT: True,
    CONF_REPLACEMENTS: [],
    CONF_CUSTOM_CSS: "",
}
