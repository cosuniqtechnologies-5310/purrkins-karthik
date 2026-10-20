import { Component } from '@theme/component';
import { StandardEvents } from '@shopify/events';
import { DrawerOpenEvent } from '@theme/theme-drawer';

/** @type {any} */
const _win = typeof window !== 'undefined' ? window : {};

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
    if (typeof _win.purrkinsSyncSubscriptionPlans === 'function') {
      _win.purrkinsSyncSubscriptionPlans();
    }
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

    const discount = (_win.purrkinsBackendDiscount || 15) + '%';

    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attributes: {
          _subscription: isSub ? 'true' : '',
          _delivery_frequency: isSub ? chosenDays : '',
          _subscription_discount: isSub ? discount : ''
        }
      })
    }).catch(console.error);

    /** @type {any} */
    const comp = this.querySelector('cart-items-component');
    if (!comp || typeof comp.updateQuantity !== 'function') return;

    const rows = /** @type {NodeListOf<HTMLElement>} */ (this.querySelectorAll('.cart-items__table-row[data-key]'));
    
    /** @type {Array<{line: number, key: string, quantity: number, selling_plan: string, properties: Record<string, string>}>} */
    const updatesToProcess = [];

    const subProps = isSub ? {
      _subscription: 'true',
      _delivery_frequency: chosenDays,
      Frequency: `Delivered every ${chosenDays}`,
      _subscription_discount: discount
    } : {
      _subscription: '',
      _delivery_frequency: '',
      Frequency: '',
      _subscription_discount: ''
    };

    rows.forEach((/** @type {any} */ row, /** @type {number} */ index) => {
      const key = row.dataset.key;
      if (!key) return;
      const qty = parseInt(row.dataset.currentQuantity || '1', 10);
      const planId = row.dataset.firstSellingPlanId;
      const currentType = row.dataset.subscriptionType;

      if (isSub && currentType !== 'subscribe') {
        updatesToProcess.push({ line: index + 1, key: key, quantity: qty, selling_plan: planId || '', properties: subProps });
      } else if (!isSub && currentType === 'subscribe') {
        updatesToProcess.push({ line: index + 1, key: key, quantity: qty, selling_plan: '', properties: subProps });
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
        properties: update.properties,
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
          properties: lastUpdate.properties,
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
          selling_plan: update.selling_plan,
          properties: update.properties
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
 * Dynamic sync with app subscription plans & discount
 */
_win.purrkinsSyncSubscriptionPlans = function() {
  fetch('/apps/purrkins/subscription-plans')
    .then((/** @type {any} */ res) => res.json())
    .then((/** @type {any} */ data) => {
      if (data && data.success) {
        if (Array.isArray(data.plans) && data.plans.length > 0) {
          _win.purrkinsBackendPlans = data.plans;
        }
        if (data.discountPercent) {
          _win.purrkinsBackendDiscount = data.discountPercent;
        }

        // Sync dropdown options in the cart drawer
        const selectEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('cart-drawer-delivery-days-select'));
        if (selectEl && _win.purrkinsBackendPlans && _win.purrkinsBackendPlans.length > 0) {
          const currentVal = selectEl.value || _win.purrkinsSelectedFrequency || '30 days';
          selectEl.innerHTML = '';
          _win.purrkinsBackendPlans.forEach((/** @type {any} */ plan) => {
            const opt = document.createElement('option');
            const val = plan.label || `${plan.intervalCount} days`;
            opt.value = val;
            opt.textContent = val;
            if (val === currentVal || (plan.intervalCount && currentVal.startsWith(String(plan.intervalCount)))) {
              opt.selected = true;
            }
            selectEl.appendChild(opt);
          });
          if (!selectEl.value && selectEl.options.length > 0) {
            selectEl.selectedIndex = 0;
          }
        }

        // Sync subscribe tab label
        const subTab = document.querySelector('.cart-drawer-tab[data-tab="subscribe"]');
        if (subTab && _win.purrkinsBackendDiscount) {
          subTab.textContent = `Subscribe - save ${_win.purrkinsBackendDiscount}%`;
        }
      }
    })
    .catch((/** @type {any} */ err) => {
      console.warn('[PURRKINS CART] Subscription plans sync notice:', err);
    });
};

// Initial sync
if (typeof _win.purrkinsSyncSubscriptionPlans === 'function') {
  _win.purrkinsSyncSubscriptionPlans();
}

/**
 * Global helper to update delivery frequency (15 days, 30 days, 45 days, 60 days)
 * Saves to cart attributes and in the background to EVERY product in the cart drawer.
 * @param {string} frequency
 * @param {HTMLSelectElement} [selectEl]
 */
_win.purrkinsChangeDeliveryFrequency = async function(frequency, selectEl) {
  if (!frequency) return;
  const card = document.getElementById('cart-drawer-subscription-plan-card');
  if (card) card.classList.add('is-saving');
  if (selectEl) selectEl.disabled = true;

  try {
    const days = parseInt(frequency, 10) || 30;
    _win.purrkinsSelectedFrequency = frequency;

    // 1. Ensure backend plans are available
    let backendPlans = _win.purrkinsBackendPlans;
    let discountPercent = _win.purrkinsBackendDiscount || 15;

    if (!backendPlans || backendPlans.length === 0) {
      try {
        const res = await fetch('/apps/purrkins/subscription-plans');
        const data = await res.json();
        if (data && data.success) {
          _win.purrkinsBackendPlans = data.plans || [];
          _win.purrkinsBackendDiscount = data.discountPercent || 15;
          backendPlans = _win.purrkinsBackendPlans;
          discountPercent = _win.purrkinsBackendDiscount || 15;
        }
      } catch (e) {
        console.warn('[PURRKINS CART] Plan fetch fallback:', e);
      }
    }

    // Find specific plan discount and sellingPlanId if configured per plan
    let matchingSellingPlanId = null;
    if (backendPlans && backendPlans.length > 0) {
      const matchingPlan = backendPlans.find((/** @type {any} */ p) => p.intervalCount === days || String(p.label).includes(String(days)));
      if (matchingPlan) {
        if (typeof matchingPlan.discountPercent === 'number') {
          discountPercent = matchingPlan.discountPercent;
        }
        if (matchingPlan.sellingPlanId) matchingSellingPlanId = matchingPlan.sellingPlanId;
      }
    }

    // 2. Save cart attributes in background
    await fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attributes: {
          _delivery_frequency: frequency,
          _subscription: 'true',
          _subscription_discount: `${discountPercent}%`
        }
      })
    });

    // 3. Fetch current cart line items to update every product
    const cartRes = await fetch('/cart.js');
    /** @type {any} */
    const cart = await cartRes.json();

    if (!cart.items || cart.items.length === 0) {
      if (card) card.classList.remove('is-saving');
      if (selectEl) selectEl.disabled = false;
      return;
    }

    /** @type {any} */
    const comp = document.querySelector('cart-items-component');

    // Build updates for every product in the cart
    const itemsToUpdate = (cart.items || []).map((/** @type {any} */ item, /** @type {number} */ index) => {
      const existingProps = Object.assign({}, item.properties || {});
      existingProps['_subscription'] = 'true';
      existingProps['_delivery_frequency'] = frequency;
      existingProps['Frequency'] = `Delivered every ${frequency}`;
      existingProps['_subscription_discount'] = `${discountPercent}%`;

      let planToApply = item.selling_plan_allocation?.selling_plan?.id;
      if (matchingSellingPlanId) {
        const match = String(matchingSellingPlanId).match(/\/SellingPlan\/(\d+)$/) || String(matchingSellingPlanId).match(/^(\d+)$/);
        if (match && match[1]) {
          planToApply = parseInt(match[1], 10);
        }
      }

      return {
        line: index + 1,
        key: item.key,
        quantity: item.quantity,
        properties: existingProps,
        selling_plan: planToApply
      };
    });

    // Update items 0 to n-2 sequentially via /cart/change.js
    for (let i = 0; i < itemsToUpdate.length - 1; i++) {
      const u = itemsToUpdate[i];
      if (!u) continue;
      /** @type {Record<string, any>} */
      const changeBody = {
        id: u.key,
        quantity: u.quantity,
        properties: u.properties
      };
      if (u.selling_plan) changeBody.selling_plan = u.selling_plan;

      await fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changeBody)
      });
    }

    // Update the last item using comp.updateQuantity so section re-renders seamlessly
    const lastItem = itemsToUpdate[itemsToUpdate.length - 1];
    if (!lastItem) return;

    if (comp && typeof comp.updateQuantity === 'function') {
      comp.updateQuantity({
        line: lastItem.line,
        quantity: lastItem.quantity,
        properties: lastItem.properties,
        selling_plan: lastItem.selling_plan,
        action: 'change'
      });
    } else {
      /** @type {Record<string, any>} */
      const lastBody = {
        id: lastItem.key,
        quantity: lastItem.quantity,
        properties: lastItem.properties,
        sections: 'cart-drawer-section',
        sections_url: window.location.pathname
      };
      if (lastItem.selling_plan) lastBody.selling_plan = lastItem.selling_plan;
      await fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lastBody)
      });
      window.location.reload();
    }
  } catch (err) {
    console.error('[PURRKINS CART] Error saving frequency to products:', err);
  } finally {
    if (card) card.classList.remove('is-saving');
    if (selectEl) selectEl.disabled = false;
  }
};

/**
 * Global helper to update selling plan frequency for all subscription items in the cart
 * @param {string} planId
 * @param {HTMLSelectElement} [selectEl]
 */
_win.purrkinsChangeCartSellingPlan = function(planId, selectEl) {
  if (!planId) return;
  /** @type {any} */
  const comp = document.querySelector('cart-items-component');
  const rows = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.cart-items__table-row[data-key][data-subscription-type="subscribe"]'));
  if (!rows || rows.length === 0) return;

  /** @type {Array<{line: number, key: string, quantity: number, selling_plan: string}>} */
  const updatesToProcess = [];
  rows.forEach((/** @type {any} */ row, /** @type {number} */ index) => {
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
