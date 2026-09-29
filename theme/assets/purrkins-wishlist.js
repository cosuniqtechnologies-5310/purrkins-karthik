document.addEventListener('DOMContentLoaded', () => {
  // Listen for clicks on the wishlist button globally
  document.body.addEventListener('click', (e) => {
    if (!e.target || !(e.target instanceof Element)) return;
    const btn = e.target.closest('.pf-qv-fav');
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const productId = btn.getAttribute('data-product-id');
    if (!productId) return;

    // Toggle visual state immediately (optimistic UI)
    const svg = btn.querySelector('svg');
    const path = btn.querySelector('path');
    const isSaved = btn.classList.toggle('is-saved');

    if (isSaved) {
      if (path) path.setAttribute('fill', '#21252A');
      // svg.style.fill = '#21252A'; // Alternate fallback
    } else {
      if (path) path.setAttribute('fill', 'none');
      // svg.style.fill = 'none';
    }

    // Call the app proxy endpoint
        let url = '/apps/purrkins/wishlist';
    const pk_token = localStorage.getItem('pk_session');
    if (pk_token) {
      url += '?session=' + pk_token;
    }

    // Call the app proxy endpoint
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        product_id: productId,
        action: isSaved ? 'add' : 'remove'
      })
    })
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.json();
    })
    .then(data => {
      console.log('Wishlist updated:', data);
    })
    .catch(error => {
      console.error('Error updating wishlist:', error);
      // Revert visual state on error
      btn.classList.toggle('is-saved');
      if (isSaved) {
        if (path) path.setAttribute('fill', 'none');
      } else {
        if (path) path.setAttribute('fill', '#21252A');
      }
    });
  });
});
