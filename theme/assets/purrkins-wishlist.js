// @ts-nocheck
document.addEventListener('DOMContentLoaded', () => {
  window['purrkinsWishlist'] = [];

  const updateWishlistButtons = function (container = document) {
    const list = window['purrkinsWishlist'];
    if (!list) return;
    container.querySelectorAll('.pf-qv-fav').forEach((btn) => {
      const productId = btn.getAttribute('data-product-id');
      const productGid = productId && productId.includes('gid://shopify/Product/') ? productId : `gid://shopify/Product/${productId}`;
      const path = btn.querySelector('path');
      if (productId && list.includes(productGid)) {
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

  // Initialize wishlist state on page load
  const pk_token = localStorage.getItem('pk_session');
  if (pk_token) {
    fetch('/apps/purrkins/wishlist?session=' + pk_token)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.success && data.wishlist) {
          window['purrkinsWishlist'] = data.wishlist;
          updateWishlistButtons(document);
        }
      })
      .catch((err) => console.error('Error fetching wishlist state:', err));
  }

  // Listen for clicks on the wishlist button globally
  document.body.addEventListener('click', (e) => {
    if (!e.target || !(e.target instanceof Element)) return;
    const btn = e.target.closest('.pf-qv-fav');
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const productId = btn.getAttribute('data-product-id');
    if (!productId) return;

    const productGid = productId.includes('gid://shopify/Product/') ? productId : `gid://shopify/Product/${productId}`;

    // Toggle visual state immediately (optimistic UI)
    const svg = btn.querySelector('svg');
    const path = btn.querySelector('path');
    const isSaved = btn.classList.toggle('is-saved');

    const wishlist = window['purrkinsWishlist'];

    if (isSaved) {
      if (path) {
        path.setAttribute('fill', '#FFE330');
        path.setAttribute('stroke', '#FFE330');
      }
      if (wishlist && !wishlist.includes(productGid)) {
        wishlist.push(productGid);
      }
    } else {
      if (path) {
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#21252A');
      }
      if (wishlist) {
        window['purrkinsWishlist'] = wishlist.filter((id) => id !== productGid);
      }
    }

    // Sync other buttons on page for the same product
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

    // Call the app proxy endpoint
    let url = '/apps/purrkins/wishlist';
    const currentToken = localStorage.getItem('pk_session');
    if (currentToken) {
      url += '?session=' + currentToken;
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
        if (response.status === 401) {
          window.location.href =
            '/apps/purrkins/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
          return Promise.reject('Unauthorized');
        }
        if (!response.ok) throw new Error('Network response was not ok');
        return response.json();
      })
      .then((data) => {
        console.log('Wishlist updated:', data);
      })
      .catch((error) => {
        if (error === 'Unauthorized') return;
        console.error('Error updating wishlist:', error);
        // Revert visual state on error
        btn.classList.toggle('is-saved');
        const revertedSaved = btn.classList.contains('is-saved');
        if (path) {
          path.setAttribute('fill', revertedSaved ? '#FFE330' : 'none');
          path.setAttribute('stroke', revertedSaved ? '#FFE330' : '#21252A');
        }
        const currentWl = window['purrkinsWishlist'];
        if (revertedSaved) {
          if (currentWl && !currentWl.includes(productGid)) {
            currentWl.push(productGid);
          }
        } else {
          if (currentWl) {
            window['purrkinsWishlist'] = currentWl.filter((id) => id !== productGid);
          }
        }
      });
  });
});
