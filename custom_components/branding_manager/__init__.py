"""Branding Manager custom integration."""

from __future__ import annotations

from copy import deepcopy
import logging
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType

from .const import (
    CONF_ACCENT_COLOR,
    CONF_APP_NAME,
    CONF_COMPANY_NAME,
    CONF_CUSTOM_CSS,
    CONF_DOCUMENT_TITLE,
    CONF_ENABLED,
    CONF_FAVICON_URL,
    CONF_LOGO_URL,
    CONF_PRIMARY_COLOR,
    CONF_REPLACE_HOME_ASSISTANT,
    CONF_REPLACEMENTS,
    DATA_MANAGER,
    DEFAULT_BRANDING,
    DOMAIN,
    EVENT_BRANDING_UPDATED,
    SERVICE_RESET_BRANDING,
    SERVICE_SET_BRANDING,
    STATIC_DIR,
    STATIC_URL,
    STORE_KEY,
    STORE_VERSION,
)

_LOGGER = logging.getLogger(__name__)

REPLACEMENT_SCHEMA = vol.Schema(
    {
        vol.Required("from"): cv.string,
        vol.Required("to"): cv.string,
        vol.Optional("case_sensitive", default=False): cv.boolean,
    }
)

BRANDING_SCHEMA = vol.Schema(
    {
        vol.Optional(CONF_ENABLED): cv.boolean,
        vol.Optional(CONF_APP_NAME): cv.string,
        vol.Optional(CONF_COMPANY_NAME): cv.string,
        vol.Optional(CONF_DOCUMENT_TITLE): cv.string,
        vol.Optional(CONF_LOGO_URL): cv.string,
        vol.Optional(CONF_FAVICON_URL): cv.string,
        vol.Optional(CONF_PRIMARY_COLOR): cv.string,
        vol.Optional(CONF_ACCENT_COLOR): cv.string,
        vol.Optional(CONF_REPLACE_HOME_ASSISTANT): cv.boolean,
        vol.Optional(CONF_REPLACEMENTS): vol.All(cv.ensure_list, [REPLACEMENT_SCHEMA]),
        vol.Optional(CONF_CUSTOM_CSS): cv.string,
    },
    extra=vol.PREVENT_EXTRA,
)


class BrandingManager:
    """Persist and publish frontend branding configuration."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the manager."""
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORE_VERSION, STORE_KEY)
        self._config: dict[str, Any] = deepcopy(DEFAULT_BRANDING)
        self._loaded_from_store = False

    @property
    def config(self) -> dict[str, Any]:
        """Return the current public branding configuration."""
        return deepcopy(self._config)

    @property
    def loaded_from_store(self) -> bool:
        """Return whether stored branding already exists."""
        return self._loaded_from_store

    async def async_load(self) -> None:
        """Load stored branding configuration."""
        stored = await self._store.async_load()
        if not isinstance(stored, dict):
            return

        self._config = _normalize_branding(stored)
        self._loaded_from_store = True

    async def async_update(self, data: dict[str, Any]) -> dict[str, Any]:
        """Merge and persist branding configuration."""
        next_config = _normalize_branding({**self._config, **data})
        if next_config == self._config:
            return self.config

        self._config = next_config
        await self._store.async_save(self._config)
        self._async_fire_update()
        return self.config

    async def async_reset(self) -> dict[str, Any]:
        """Reset branding configuration to defaults."""
        self._config = deepcopy(DEFAULT_BRANDING)
        await self._store.async_save(self._config)
        self._async_fire_update()
        return self.config

    @callback
    def _async_fire_update(self) -> None:
        """Notify connected frontends that branding changed."""
        self.hass.bus.async_fire(EVENT_BRANDING_UPDATED, {"config": self.config})


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up Branding Manager."""
    hass.data.setdefault(DOMAIN, {})

    manager = BrandingManager(hass)
    await manager.async_load()
    hass.data[DOMAIN][DATA_MANAGER] = manager

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                STATIC_URL,
                str(Path(__file__).parent / STATIC_DIR),
                False,
            )
        ]
    )

    websocket_api.async_register_command(hass, _websocket_get_config)
    websocket_api.async_register_command(hass, _websocket_update_config)
    websocket_api.async_register_command(hass, _websocket_subscribe_updates)
    _async_register_services(hass, manager)

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Branding Manager from a config entry."""
    manager: BrandingManager = hass.data[DOMAIN][DATA_MANAGER]
    if not manager.loaded_from_store:
        await manager.async_update(_entry_branding(entry))
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a Branding Manager config entry."""
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Handle options updates."""
    manager: BrandingManager = hass.data[DOMAIN][DATA_MANAGER]
    await manager.async_update(_entry_branding(entry))


def _async_register_services(hass: HomeAssistant, manager: BrandingManager) -> None:
    """Register integration services."""
    if not hass.services.has_service(DOMAIN, SERVICE_SET_BRANDING):

        async def async_set_branding(call: ServiceCall) -> None:
            """Set branding values from a service call."""
            await manager.async_update(dict(call.data))

        hass.services.async_register(
            DOMAIN,
            SERVICE_SET_BRANDING,
            async_set_branding,
            schema=BRANDING_SCHEMA,
        )

    if not hass.services.has_service(DOMAIN, SERVICE_RESET_BRANDING):

        async def async_reset_branding(call: ServiceCall) -> None:
            """Reset branding values from a service call."""
            await manager.async_reset()

        hass.services.async_register(
            DOMAIN,
            SERVICE_RESET_BRANDING,
            async_reset_branding,
            schema=vol.Schema({}),
        )


@callback
@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get_config"})
def _websocket_get_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return current branding config."""
    manager: BrandingManager = hass.data[DOMAIN][DATA_MANAGER]
    connection.send_result(msg["id"], manager.config)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/update_config",
        vol.Required("config"): BRANDING_SCHEMA,
    }
)
@websocket_api.async_response
async def _websocket_update_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Update branding config over WebSocket."""
    if not connection.user.is_admin:
        raise Unauthorized

    manager: BrandingManager = hass.data[DOMAIN][DATA_MANAGER]
    config = await manager.async_update(msg["config"])
    connection.send_result(msg["id"], config)


@callback
@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/subscribe_updates"})
def _websocket_subscribe_updates(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Subscribe to branding updates."""
    manager: BrandingManager = hass.data[DOMAIN][DATA_MANAGER]

    @callback
    def forward_update(event: Any) -> None:
        connection.send_event(msg["id"], event.data)

    connection.subscriptions[msg["id"]] = hass.bus.async_listen(
        EVENT_BRANDING_UPDATED,
        forward_update,
    )
    connection.send_result(msg["id"], manager.config)


def _entry_branding(entry: ConfigEntry) -> dict[str, Any]:
    """Return branding values from config entry data and options."""
    data = {**entry.data, **entry.options}
    return {key: value for key, value in data.items() if key in DEFAULT_BRANDING}


def _normalize_branding(data: dict[str, Any]) -> dict[str, Any]:
    """Normalize public branding configuration."""
    normalized = deepcopy(DEFAULT_BRANDING)
    for key in DEFAULT_BRANDING:
        if key not in data:
            continue

        value = data[key]
        if key in {
            CONF_APP_NAME,
            CONF_COMPANY_NAME,
            CONF_DOCUMENT_TITLE,
            CONF_LOGO_URL,
            CONF_FAVICON_URL,
            CONF_PRIMARY_COLOR,
            CONF_ACCENT_COLOR,
            CONF_CUSTOM_CSS,
        }:
            normalized[key] = str(value or "").strip()
        elif key in {CONF_ENABLED, CONF_REPLACE_HOME_ASSISTANT}:
            normalized[key] = bool(value)
        elif key == CONF_REPLACEMENTS:
            normalized[key] = _normalize_replacements(value)

    return normalized


def _normalize_replacements(value: Any) -> list[dict[str, Any]]:
    """Normalize text replacement rules."""
    if not isinstance(value, list):
        return []

    replacements: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        source = str(item.get("from", "")).strip()
        if not source:
            continue
        replacements.append(
            {
                "from": source,
                "to": str(item.get("to", "")),
                "case_sensitive": bool(item.get("case_sensitive", False)),
            }
        )
    return replacements
