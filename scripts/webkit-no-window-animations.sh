#!/bin/sh
# Playwright rejects a separate NO launch argument as a page URL. Append this
# Cocoa process preference here; never write the user's global defaults.
exec "${RIGHELT_WEBKIT_BROWSER_EXECUTABLE:?Missing WebKit executable}" "$@" -NSAutomaticWindowAnimationsEnabled NO
