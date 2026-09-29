import { Component } from '@theme/component';
import { StandardEvents } from '@shopify/events';
import { DrawerOpenEvent } from '@theme/theme-drawer';

/**
 * A custom element that manages cart drawer behavior within a `<theme-drawer>`.
 *
 * Dialog lifecycle (open/close, squeeze, history, animations) is owned by `<theme-drawer>`.
 * The `cart:view` event is auto-dispatched by `CartItemsComponent` via the
 * `view-event-trigger="dialog"` attribute (see `snippets/cart-items-component.liquid`).
 * Cart count announcements are owned by `<header-actions>`.
 * This component handles the remaining cart-specific concerns: auto-open on add-to-cart,
 * sticky summary layout, and the installments CTA close-on-click.
 *
 * @extends {Component}
 */
class CartDrawerComponent extends Component {
  /** @type {number} */
  #summaryThreshold = 0.5;

  /** @type {import('@theme/theme-drawer').ThemeDrawer | null} */
  get #themeDrawer() {
    return /** @type {import('@theme/theme-drawer').ThemeDrawer | null} */ (this.closest('theme-drawer'));
  }

  /** @type {HTMLDialogElement | null} */
  get #dialog() {
    return this.closest('dialog');
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(StandardEvents.cartLinesUpdate, this.#handleCartLinesUpdate);

    // Reliable fallback for the close button, handles all clicks inside this component
    this.addEventListener('click', (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      if (target.closest('.theme-drawer__close-button')) {
        if (this.#themeDrawer && typeof this.#themeDrawer.close === 'function') {
          this.#themeDrawer.close();
        }
      }
    });
    this.#themeDrawer?.addEventListener(DrawerOpenEvent.eventName, this.#handleDrawerOpen);
    this.addEventListener('click', this.#handleTabClick);

    // The restore path sets [open] before this module loads, so the
    // theme-drawer:open event will have already fired. Use the attribute
    // check so this works even before <theme-drawer> upgrades.
    if (this.#themeDrawer?.hasAttribute('open')) {
      this.#handleDrawerOpen();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(StandardEvents.cartLinesUpdate, this.#handleCartLinesUpdate);
    this.#themeDrawer?.removeEventListener(DrawerOpenEvent.eventName, this.#handleDrawerOpen);
    this.removeEventListener('click', this.#handleTabClick);
  }

  #handleTabClick = (/** @type {Event} */ event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const btn = /** @type {HTMLElement | null} */ (target.closest('.cart-drawer-tab'));
    if (!btn) return;
    
    if (btn.classList.contains('active')) return;

    const tab = btn.dataset.tab;
    /** @type {any} */
    const comp = this.querySelector('cart-items-component');
    if (!comp || typeof comp.updateMultiple !== 'function') return;

    const rows = /** @type {NodeListOf<HTMLElement>} */ (this.querySelectorAll('.cart-items__table-row[data-key]'));
    /** @type {Record<string, any>} */
    const updates = {};
    let hasChanges = false;
    
    rows.forEach(row => {
      const key = row.dataset.key;
      if (!key) return;
      const qty = parseInt(row.dataset.currentQuantity || '1', 10);
      const planId = row.dataset.firstSellingPlanId;
      const currentType = row.dataset.subscriptionType;

      if (planId) {
        if (tab === 'subscribe' && currentType !== 'subscribe') {
          updates[key] = { quantity: qty, selling_plan: planId };
          hasChanges = true;
        } else if (tab === 'one-time' && currentType === 'subscribe') {
          updates[key] = { quantity: qty, selling_plan: "" };
          hasChanges = true;
        }
      }
    });
    
    const tabs = /** @type {NodeListOf<HTMLElement>} */ (this.querySelectorAll('.cart-drawer-tab'));
    tabs.forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });

    if (hasChanges) {
      comp.updateMultiple(updates);
    }
  };

  /**
   * Handles the theme-drawer opening — updates sticky state and wires up the installments CTA.
   */
  #handleDrawerOpen = () => {
    this.#updateStickyState();

    const closeBtn = /** @type {HTMLElement | null} */ (this.querySelector('.theme-drawer__close-button'));
    if (closeBtn && !closeBtn.dataset.nativeBound) {
      closeBtn.addEventListener('click', () => {
        if (this.#themeDrawer && typeof this.#themeDrawer.close === 'function') {
          this.#themeDrawer.close();
        }
      });
      closeBtn.dataset.nativeBound = 'true';
    }

    // Close cart drawer when installments CTA is clicked to avoid overlapping dialogs.
    // Re-queried on every open so it survives cart content re-renders that
    // replace the shopify-payment-terms shadow root.
    customElements.whenDefined('shopify-payment-terms').then(() => {
      const cta = this.querySelector('shopify-payment-terms')?.shadowRoot?.querySelector('#shopify-installments-cta');
      cta?.addEventListener('click', () => this.#themeDrawer?.close(), { once: true });
    });
  };

  /**
   * @param {import('@shopify/events').CartLinesUpdateEvent} event
   */
  #handleCartLinesUpdate = (event) => {
    const shouldAutoOpen = this.hasAttribute('auto-open') && event.action === 'add' && !this.#themeDrawer?.isOpen;

    const sourceModal = /** @type {HTMLDialogElement | null} */ (
      event.target instanceof Element ? event.target.closest('dialog:modal') : null
    );

    event.promise
      ?.then(({ detail }) => {
        const settle = () => requestAnimationFrame(() => this.#updateStickyState());

        if (!shouldAutoOpen || detail?.didError) {
          settle();
          return;
        }

        const openAndSettle = () => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              this.#themeDrawer?.open();
              console.log('[cart-drawer] Cart drawer successfully opened and updated!');
              settle();
            });
          });
        };

        if (sourceModal?.open) {
          sourceModal.addEventListener('close', openAndSettle, { once: true });
        } else {
          openAndSettle();
        }
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
            console.error('[cart-drawer] ERROR: Failed to update or open cart drawer!', error);
        }
      });
  };

  #isCartEmpty() {
    return Boolean(this.querySelector('.cart-drawer--empty'));
  }

  #updateStickyState() {
    const dialog = this.#dialog;
    if (!dialog) return;

    // Refs do not cross nested `*-component` boundaries (e.g., `cart-items-component`), so we query within the dialog.
    const content = dialog.querySelector('.cart-drawer__content');
    const summary = dialog.querySelector('.cart-drawer__summary');

    if (!content || !summary) {
      // Ensure the dialog doesn't get stuck in "unsticky" mode when summary disappears (e.g., empty cart).
      dialog.setAttribute('cart-summary-sticky', 'false');
      return;
    }

    const drawerHeight = dialog.getBoundingClientRect().height;
    const summaryHeight = summary.getBoundingClientRect().height;
    const ratio = summaryHeight / drawerHeight;
    dialog.setAttribute('cart-summary-sticky', ratio > this.#summaryThreshold ? 'false' : 'true');
  }
}

if (!customElements.get('cart-drawer-component')) {
  customElements.define('cart-drawer-component', CartDrawerComponent);
}
