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
    this.#syncSubscriptionUI();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(StandardEvents.cartLinesUpdate, this.#handleCartLinesUpdate);
    this.#themeDrawer?.removeEventListener(DrawerOpenEvent.eventName, this.#handleDrawerOpen);
    this.removeEventListener('click', this.#handleTabClick);
  }

  #syncSubscriptionUI = () => {
    let activeTab = /** @type {HTMLElement | null} */ (this.querySelector('.cart-drawer-tab.active'));
    const hasSubItem = Boolean(this.querySelector('.cart-items__table-row[data-subscription-type="subscribe"]'));
    if (!activeTab && hasSubItem) {
      activeTab = /** @type {HTMLElement | null} */ (this.querySelector('.cart-drawer-tab[data-tab="subscribe"]'));
      if (activeTab) {
        this.querySelectorAll('.cart-drawer-tab').forEach(b => b.classList.toggle('active', b === activeTab));
      }
    }
    const isSub = activeTab ? activeTab.dataset.tab === 'subscribe' : hasSubItem;
    document.body.dataset.cartTab = isSub ? 'subscribe' : 'one-time';

    const subPrices = /** @type {NodeListOf<HTMLElement>} */ (this.querySelectorAll('.cart-item-subscription-price, .cart-item-price-sub'));
    const regPrices = /** @type {NodeListOf<HTMLElement>} */ (this.querySelectorAll('.cart-item-regular-price, .cart-item-price-reg'));
    const subInfo = /** @type {HTMLElement | null} */ (this.querySelector('.cart-drawer-subscription-info'));
    const checkoutReg = /** @type {HTMLElement | null} */ (this.querySelector('.checkout-regular-price'));
    const checkoutSub = /** @type {HTMLElement | null} */ (this.querySelector('.checkout-sub-price'));

    subPrices.forEach(el => el.style.display = isSub ? 'inline-flex' : 'none');
    regPrices.forEach(el => el.style.display = isSub ? 'none' : 'inline-flex');
    if (subInfo) subInfo.style.display = isSub ? 'flex' : 'none';
    if (checkoutReg) checkoutReg.style.display = isSub ? 'none' : 'inline';
    if (checkoutSub) checkoutSub.style.display = isSub ? 'inline' : 'none';
  };

  #handleTabClick = (/** @type {Event} */ event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const btn = /** @type {HTMLElement | null} */ (target.closest('.cart-drawer-tab'));
    if (!btn) return;

    const tab = btn.dataset.tab;
    const isSub = tab === 'subscribe';

    // 1. Toggle tab buttons visually
    const tabs = /** @type {NodeListOf<HTMLElement>} */ (this.querySelectorAll('.cart-drawer-tab'));
    tabs.forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });

    // 2. Sync subscription UI elements
    this.#syncSubscriptionUI();

    // 3. Persist subscription status in cart attributes
    const daysSelect = /** @type {HTMLSelectElement | null} */ (this.querySelector('#cart-drawer-delivery-days-select'));
    const chosenDays = daysSelect?.value || '30 days';

    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attributes: {
          _subscription: isSub ? 'true' : '',
          _delivery_frequency: isSub ? chosenDays : '',
          _subscription_discount: isSub ? '15%' : ''
        }
      })
    }).catch(console.error);

    /** @type {any} */
    const comp = this.querySelector('cart-items-component');
    if (!comp || typeof comp.updateQuantity !== 'function') return;

    const rows = /** @type {NodeListOf<HTMLElement>} */ (this.querySelectorAll('.cart-items__table-row[data-key]'));
    
    /** @type {Array<{line: number, key: string, quantity: number, selling_plan: string}>} */
    const updatesToProcess = [];

    rows.forEach((row, index) => {
      const key = row.dataset.key;
      if (!key) return;
      const qty = parseInt(row.dataset.currentQuantity || '1', 10);
      const planId = row.dataset.firstSellingPlanId;
      const currentType = row.dataset.subscriptionType;

      if (isSub && currentType !== 'subscribe') {
        if (planId) {
          updatesToProcess.push({ line: index + 1, key: key, quantity: qty, selling_plan: planId });
        }
      } else if (!isSub && currentType === 'subscribe') {
        updatesToProcess.push({ line: index + 1, key: key, quantity: qty, selling_plan: "" });
      }
    });

    if (updatesToProcess.length === 0) return;

    if (updatesToProcess.length === 1) {
      const update = updatesToProcess[0];
      if (!update) return;
      comp.updateQuantity({
        line: update.line,
        quantity: update.quantity,
        selling_plan: update.selling_plan,
        action: 'change'
      });
      return;
    }

    const lastUpdate = updatesToProcess.pop();
    if (!lastUpdate) return;
    
    const shopifyInfo = /** @type {any} */ (window.Shopify);
    const url = shopifyInfo?.routes?.root ? shopifyInfo.routes.root + 'cart/change.js' : '/cart/change.js';
    
    const updateNext = (/** @type {number} */ index) => {
      if (index >= updatesToProcess.length) {
        comp.updateQuantity({
          line: lastUpdate.line,
          quantity: lastUpdate.quantity,
          selling_plan: lastUpdate.selling_plan,
          action: 'change'
        });
        return;
      }
      
      const update = updatesToProcess[index];
      if (!update) {
        updateNext(index + 1);
        return;
      }
      
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          id: update.key,
          quantity: update.quantity,
          selling_plan: update.selling_plan
        })
      })
      .then(() => updateNext(index + 1))
      .catch(err => {
        console.error(err);
        updateNext(index + 1);
      });
    };
    
    updateNext(0);
  };

  /**
   * Handles the theme-drawer opening — updates sticky state and wires up the installments CTA.
   */
  #handleDrawerOpen = () => {
    this.#updateStickyState();
    this.#syncSubscriptionUI();

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
    console.log('[PURRKINS CART] DRAWER EVENT HANDLER', {
      action: event.action,
      hasPromise: !!event.promise
    });

    const shouldAutoOpen = this.hasAttribute('auto-open') && event.action === 'add' && !this.#themeDrawer?.isOpen;

    const sourceModal = /** @type {HTMLDialogElement | null} */ (
      event.target instanceof Element ? event.target.closest('dialog:modal') : null
    );

    event.promise
      ?.then(({ detail }) => {
        const settle = () => requestAnimationFrame(() => {
          this.#updateStickyState();
          this.#syncSubscriptionUI();
        });

        if (!shouldAutoOpen || detail?.didError) {
          settle();
          return;
        }

        const openAndSettle = () => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              this.#themeDrawer?.open();
              this.#syncSubscriptionUI();
              console.log('[PURRKINS CART] DRAWER OPEN SUCCESS', {
                isOpen: !!this.#themeDrawer?.isOpen,
                drawerCount: document.querySelectorAll('cart-drawer-component').length,
                cartItemsCount: document.querySelectorAll('cart-items-component').length
              });
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
            console.error('[PURRKINS CART] DRAWER ERROR', { error, message: error?.message });
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

/**
 * Global helper to update delivery frequency (15 days, 30 days, 45 days, 60 days)
 * @param {string} frequency
 * @param {HTMLSelectElement} [selectEl]
 */
// @ts-ignore
window.purrkinsChangeDeliveryFrequency = function(frequency, selectEl) {
  if (!frequency) return;
  fetch('/cart/update.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attributes: {
        _delivery_frequency: frequency,
        _subscription: 'true',
        _subscription_discount: '15%'
      }
    })
  }).catch(console.error);
};

/**
 * Global helper to update selling plan frequency for all subscription items in the cart
 * @param {string} planId
 * @param {HTMLSelectElement} [selectEl]
 */
// @ts-ignore
window.purrkinsChangeCartSellingPlan = function(planId, selectEl) {
  if (!planId) return;
  /** @type {any} */
  const comp = document.querySelector('cart-items-component');
  const rows = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.cart-items__table-row[data-key][data-subscription-type="subscribe"]'));
  if (!rows || rows.length === 0) return;

  /** @type {Array<{line: number, key: string, quantity: number, selling_plan: string}>} */
  const updatesToProcess = [];
  rows.forEach((row, index) => {
    const key = row.dataset.key;
    const qty = parseInt(row.dataset.currentQuantity || '1', 10);
    if (key) {
      updatesToProcess.push({ line: index + 1, key: key, quantity: qty, selling_plan: planId });
    }
  });

  if (updatesToProcess.length === 0) return;
  if (selectEl) selectEl.disabled = true;

  if (updatesToProcess.length === 1 && comp && typeof comp.updateQuantity === 'function') {
    const update = updatesToProcess[0];
    if (update) {
      comp.updateQuantity({
        line: update.line,
        quantity: update.quantity,
        selling_plan: update.selling_plan,
        action: 'change'
      });
    }
    return;
  }

  const lastUpdate = updatesToProcess.pop();
  if (!lastUpdate) return;

  const updateNext = (/** @type {number} */ index) => {
    if (index >= updatesToProcess.length) {
      if (comp && typeof comp.updateQuantity === 'function') {
        comp.updateQuantity({
          line: lastUpdate.line,
          quantity: lastUpdate.quantity,
          selling_plan: lastUpdate.selling_plan,
          action: 'change'
        });
      } else {
        window.location.reload();
      }
      return;
    }

    const u = updatesToProcess[index];
    if (!u) {
      updateNext(index + 1);
      return;
    }

    fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: u.key,
        quantity: u.quantity,
        selling_plan: u.selling_plan
      })
    })
    .then(() => updateNext(index + 1))
    .catch((err) => {
      console.error('Error changing subscription plan:', err);
      if (selectEl) selectEl.disabled = false;
    });
  };

  updateNext(0);
};
