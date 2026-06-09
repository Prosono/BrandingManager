"""Config flow for Branding Manager."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import config_validation as cv

from .const import (
    CONF_ACCENT_COLOR,
    CONF_APP_NAME,
    CONF_COMPANY_NAME,
    CONF_DOCUMENT_TITLE,
    CONF_ENABLED,
    CONF_FAVICON_URL,
    CONF_LOGO_URL,
    CONF_PRIMARY_COLOR,
    CONF_REPLACE_HOME_ASSISTANT,
    DATA_MANAGER,
    DEFAULT_BRANDING,
    DOMAIN,
)


class BrandingManagerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Branding Manager."""

    VERSION = 1
    MINOR_VERSION = 0

    async def async_step_user(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> config_entries.ConfigFlowResult:
        """Handle the initial step."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            return self.async_create_entry(
                title=user_input.get(CONF_APP_NAME) or "Branding Manager",
                data=user_input,
            )

        return self.async_show_form(
            step_id="user",
            data_schema=_branding_schema(DEFAULT_BRANDING),
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Create the options flow."""
        return BrandingManagerOptionsFlow()


class BrandingManagerOptionsFlow(config_entries.OptionsFlow):
    """Handle Branding Manager options."""

    async def async_step_init(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> config_entries.ConfigFlowResult:
        """Manage Branding Manager options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current = {**DEFAULT_BRANDING, **self.config_entry.data, **self.config_entry.options}
        if (
            self.hass
            and DOMAIN in self.hass.data
            and DATA_MANAGER in self.hass.data[DOMAIN]
        ):
            current = self.hass.data[DOMAIN][DATA_MANAGER].config
        return self.async_show_form(
            step_id="init",
            data_schema=_branding_schema(current),
        )


def _branding_schema(defaults: dict[str, Any]) -> vol.Schema:
    """Return the shared config/options schema."""
    return vol.Schema(
        {
            vol.Optional(
                CONF_ENABLED,
                default=defaults.get(CONF_ENABLED, DEFAULT_BRANDING[CONF_ENABLED]),
            ): cv.boolean,
            vol.Optional(
                CONF_APP_NAME,
                default=defaults.get(CONF_APP_NAME, DEFAULT_BRANDING[CONF_APP_NAME]),
            ): cv.string,
            vol.Optional(
                CONF_COMPANY_NAME,
                default=defaults.get(CONF_COMPANY_NAME, ""),
            ): cv.string,
            vol.Optional(
                CONF_DOCUMENT_TITLE,
                default=defaults.get(CONF_DOCUMENT_TITLE, ""),
            ): cv.string,
            vol.Optional(
                CONF_LOGO_URL,
                default=defaults.get(CONF_LOGO_URL, ""),
            ): cv.string,
            vol.Optional(
                CONF_FAVICON_URL,
                default=defaults.get(CONF_FAVICON_URL, ""),
            ): cv.string,
            vol.Optional(
                CONF_PRIMARY_COLOR,
                default=defaults.get(CONF_PRIMARY_COLOR, ""),
            ): cv.string,
            vol.Optional(
                CONF_ACCENT_COLOR,
                default=defaults.get(CONF_ACCENT_COLOR, ""),
            ): cv.string,
            vol.Optional(
                CONF_REPLACE_HOME_ASSISTANT,
                default=defaults.get(
                    CONF_REPLACE_HOME_ASSISTANT,
                    DEFAULT_BRANDING[CONF_REPLACE_HOME_ASSISTANT],
                ),
            ): cv.boolean,
        }
    )
