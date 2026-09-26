document.addEventListener('DOMContentLoaded', function() {
    const contentArea = document.getElementById('single-blog-content');
    const tocList = document.getElementById('sb-toc-list');
    
    if (!contentArea || !tocList) return;

    // Pulling both h2 and h3 for TOC (excluding the Blog CTA block titles)
    const headings = contentArea.querySelectorAll('h2:not(.pbc-title), h3:not(.pbc-title)');
    
    if (headings.length === 0) {
        // Hide TOC if no headings
        document.querySelector('.single-blog-sidebar').style.display = 'none';
        document.querySelector('.single-blog-content-wrapper').classList.add('no-sidebar');
        return;
    }

    const tocItems = [];

    headings.forEach((heading, index) => {
        // Ensure each heading has an ID
        let id = heading.id;
        if (!id) {
            id = heading.textContent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
            if (!id) id = 'heading-' + index;
            heading.id = id;
        }

        // Create TOC list item
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#' + id;
        a.textContent = heading.textContent;
        a.className = 'sb-toc-link';
        
        li.appendChild(a);
        tocList.appendChild(li);
        tocItems.push({ id: id, link: a, element: heading });

        // Smooth scroll
        a.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.getElementById(id);
            if (target) {
                // Adjust scroll position for sticky header if exists
                const offset = 100;
                const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
                window.scrollTo({ top, behavior: 'smooth' });
            }
        });
    });

    // Intersection Observer for active state
    const observerOptions = {
        root: null,
        rootMargin: '-120px 0px -60% 0px',
        threshold: 0
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Remove active from all
                tocItems.forEach(item => item.link.parentElement.classList.remove('active'));
                
                // Add active to current
                const activeItem = tocItems.find(item => item.id === entry.target.id);
                if (activeItem) {
                    activeItem.link.parentElement.classList.add('active');
                }
            }
        });
    }, observerOptions);

    headings.forEach(heading => observer.observe(heading));
});
