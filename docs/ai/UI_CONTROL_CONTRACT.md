# Shared UI controls

## Icon-only dismissal

Use `renderDismissButton` from `apps/web/shell/dismiss-control.js` for every icon-only close or dismiss control. Keep the same control for notifications, account dialogs, stories, invitations and flyouts. Do not render a literal × or make a new close-button variant.

- Show a subtle neutral 16 px x. Keep its resting background, border and shadow transparent.
- Keep a native button with a target of at least 44 × 44 CSS pixels. The visible glyph and the click target are different sizes.
- Supply a meaningful accessible label such as “Close invite” or “Dismiss move notification.” The decorative icon is hidden from assistive technology.
- Preserve visible keyboard focus, native Enter and Space activation, disabled state, and the owning surface’s Escape and focus-return behavior.
- Pass existing owner classes and data attributes through the helper. The helper renders presentation and markup. It does not dismiss a surface or register handlers.
- Keep hover quiet. Never remove the focus outline to make the control subtle.
- Verify the actual target and glyph sizes on desktop and mobile, including enlarged text. Check the real page and native modal or flyout position.

Labeled actions such as Dismiss, Cancel request and Reject retain their existing wording and semantics. A close icon beside a labeled action does not make it an icon-only dismissal.

New notification styles must reuse this control. A new material or animation must not change its target size, label, keyboard behavior, dismissal authority or focus ownership.
