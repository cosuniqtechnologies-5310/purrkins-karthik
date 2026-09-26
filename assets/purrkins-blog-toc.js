document.addEventListener('DOMContentLoaded', function() {
    const content = document.getElementById('single-blog-content');
    const tocList = document.getElementById('sb-toc-list');
    
    if (!content || !tocList) return;
    
    const headings = content.querySelectorAll('h2, h3');
    
    if (headings.length === 0) {
        document.querySelector('.single-blog-sidebar').style.display = 'none';
        return;
    }
    
    headings.forEach((heading, index) => {
        // Create ID if it doesn't exist
        if (!heading.id) {
            heading.id = 'heading-' + index;
        }
        
        const li = document.createElement('li');
        if (index === 0) li.classList.add('active'); // First one active by default
        
        const a = document.createElement('a');
        a.href = '#' + heading.id;
        a.textContent = heading.textContent;
        a.className = 'sb-toc-link';
        
        // Remove click listener and let native anchor href handle it natively
        
        li.appendChild(a);
        tocList.appendChild(li);
    });
    
    // Scroll Spy using IntersectionObserver
    const observerOptions = {
        root: null,
        rootMargin: '-130px 0px -60% 0px', // Trigger when heading is in the upper part of the viewport
        threshold: 0
    };

    const observer = new IntersectionObserver((entries) => {
        // We only care about headings that are intersecting
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const current = entry.target.id;
                const links = tocList.querySelectorAll('li');
                links.forEach(li => {
                    li.classList.remove('active');
                    if (li.querySelector('a').getAttribute('href') === '#' + current) {
                        li.classList.add('active');
                    }
                });
            }
        });
    }, observerOptions);

    // Observe all headings
    headings.forEach(heading => {
        observer.observe(heading);
    });
});
