// @ts-nocheck
document.addEventListener('DOMContentLoaded', () => {
  const SESSION_KEY = 'pk_session_wishlist';

  // Helper to read session wishlist (supports localStorage with sessionStorage fallback)
  function getSessionWishlist() {
    try {
      const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  // Helper to save session wishlist
  function saveSessionWishlist(items) {
    try {
      const str = JSON.stringify(items);
      localStorage.setItem(SESSION_KEY, str);
      sessionStorage.setItem(SESSION_KEY, str);
    } catch (e) {}
  }

  // Helper to clear session wishlist
  function clearSessionWishlist() {
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  // Helper to check if customer is logged in
  function getCustomerSessionToken() {
    return localStorage.getItem('pk_session') || (document.cookie.match(/pk_session=([^;]+)/) || [])[1] || null;
  }

  function isCustomerLoggedIn() {
    const wrap = document.getElementById('purrkins-header-user-wrap');
    const isCustomer = wrap && wrap.getAttribute('data-customer') === 'true';
    const hasShopifyCustomer = window.purrkinsCustomerId != null;
    const hasToken = !!getCustomerSessionToken();
    return isCustomer || hasShopifyCustomer || hasToken;
  }

  window['purrkinsWishlist'] = [];

  const updateWishlistButtons = function (container = document) {
    const list = window['purrkinsWishlist'] || [];
    container.querySelectorAll('.pf-qv-fav').forEach((btn) => {
      const productId = btn.getAttribute('data-product-id');
      if (!productId) return;
      const productGid = productId.includes('gid://shopify/Product/')
        ? productId
        : `gid://shopify/Product/${productId}`;
      const path = btn.querySelector('path');
      const isSaved = list.includes(productGid) || list.includes(productId) || list.includes(String(productId));

      if (isSaved) {
        btn.classList.add('is-saved');
        if (path) {
          path.setAttribute('fill', '#FFE330');
          path.setAttribute('stroke', '#FFE330');
        }
      } else {
        btn.classList.remove('is-saved');
        if (path) {
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', '#21252A');
        }
      }
    });
  };

  window['purrkinsUpdateWishlistButtons'] = updateWishlistButtons;

  // Initialize wishlist state
  function initWishlist() {
    const sessionWishlist = getSessionWishlist();
    const loggedIn = isCustomerLoggedIn();
    const token = getCustomerSessionToken();

    if (!loggedIn) {
      // 1. GUEST MODE: Wishlist is entirely session-based
      window['purrkinsWishlist'] = sessionWishlist;
      updateWishlistButtons(document);
      try { document.dispatchEvent(new CustomEvent('purrkins:wishlist:updated', { detail: { wishlist: sessionWishlist } })); } catch (e) {}
      return;
    }

    // 2. CUSTOMER MODE: User is logged in
    let url = '/apps/purrkins/wishlist';
    if (token) {
      url += '?session=' + encodeURIComponent(token);
    }

    // If there are session-based items saved before customer login, pass them to customer storage!
    if (sessionWishlist.length > 0) {
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          action: 'merge',
          product_ids: sessionWishlist,
        }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          clearSessionWishlist();
          if (data && data.success && Array.isArray(data.wishlist)) {
            window['purrkinsWishlist'] = data.wishlist;
            updateWishlistButtons(document);
            try { document.dispatchEvent(new CustomEvent('purrkins:wishlist:updated', { detail: { wishlist: data.wishlist } })); } catch (e) {}
          } else {
            fetchCustomerWishlist(url);
          }
        })
        .catch((err) => {
          console.error('Error merging session wishlist into customer storage:', err);
          fetchCustomerWishlist(url);
        });
    } else {
      fetchCustomerWishlist(url);
    }
  }

  function fetchCustomerWishlist(url) {
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.success && Array.isArray(data.wishlist)) {
          window['purrkinsWishlist'] = data.wishlist;
          updateWishlistButtons(document);
          try { document.dispatchEvent(new CustomEvent('purrkins:wishlist:updated', { detail: { wishlist: data.wishlist } })); } catch (e) {}
        }
      })
      .catch((err) => console.error('Error fetching customer wishlist:', err));
  }

  initWishlist();

  // Listen for clicks on the wishlist button globally
  document.body.addEventListener('click', (e) => {
    if (!e.target || !(e.target instanceof Element)) return;
    const btn = e.target.closest('.pf-qv-fav');
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const productId = btn.getAttribute('data-product-id');
    if (!productId) return;

    const productGid = productId.includes('gid://shopify/Product/')
      ? productId
      : `gid://shopify/Product/${productId}`;

    // Toggle visual state immediately (optimistic UI)
    const path = btn.querySelector('path');
    const isSaved = btn.classList.toggle('is-saved');

    if (path) {
      path.setAttribute('fill', isSaved ? '#FFE330' : 'none');
      path.setAttribute('stroke', isSaved ? '#FFE330' : '#21252A');
    }

    // Sync in-memory wishlist
    let wishlist = window['purrkinsWishlist'] || [];
    if (isSaved) {
      if (!wishlist.includes(productGid)) {
        wishlist.push(productGid);
      }
    } else {
      wishlist = wishlist.filter((id) => id !== productGid && id !== productId && id !== String(productId));
    }
    window['purrkinsWishlist'] = wishlist;
    try {
      document.dispatchEvent(new CustomEvent('purrkins:wishlist:updated', { detail: { wishlist: wishlist } }));
    } catch (e) {}

    // Sync all matching buttons on the page for this product
    document.querySelectorAll(`.pf-qv-fav[data-product-id="${productId}"]`).forEach((otherBtn) => {
      if (otherBtn !== btn) {
        otherBtn.classList.toggle('is-saved', isSaved);
        const otherPath = otherBtn.querySelector('path');
        if (otherPath) {
          otherPath.setAttribute('fill', isSaved ? '#FFE330' : 'none');
          otherPath.setAttribute('stroke', isSaved ? '#FFE330' : '#21252A');
        }
      }
    });

    const loggedIn = isCustomerLoggedIn();

    if (!loggedIn) {
      // Guest: Persist to session storage
      let sessionWl = getSessionWishlist();
      if (isSaved) {
        if (!sessionWl.includes(productGid)) {
          sessionWl.push(productGid);
        }
      } else {
        sessionWl = sessionWl.filter((id) => id !== productGid && id !== productId && id !== String(productId));
      }
      saveSessionWishlist(sessionWl);
      return;
    }

    // Customer: Sync directly to backend customer storage
    let url = '/apps/purrkins/wishlist';
    const currentToken = getCustomerSessionToken();
    if (currentToken) {
      url += '?session=' + encodeURIComponent(currentToken);
    }

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        product_id: productId,
        action: isSaved ? 'add' : 'remove',
      }),
    })
      .then((response) => {
        if (!response.ok) throw new Error('Network response was not ok');
        return response.json();
      })
      .then((data) => {
        if (data && Array.isArray(data.wishlist)) {
          window['purrkinsWishlist'] = data.wishlist;
        }
      })
      .catch((error) => {
        console.error('Error updating customer wishlist on server:', error);
        // Fallback: save to session storage so the user's action is never lost
        let sessionWl = getSessionWishlist();
        if (isSaved && !sessionWl.includes(productGid)) {
          sessionWl.push(productGid);
        } else if (!isSaved) {
          sessionWl = sessionWl.filter((id) => id !== productGid);
        }
        saveSessionWishlist(sessionWl);
      });
  });
});
