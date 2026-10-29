// ===== PRELOADER =====
window.addEventListener('load', () => {
  const preloader = document.getElementById('preloader');
  setTimeout(() => preloader.classList.add('hide'), 1200);
});

// ===== CUSTOM CURSOR =====
const cursor = document.getElementById('cursor');
const cursorRing = document.getElementById('cursorRing');

if (window.matchMedia('(min-width: 1025px)').matches) {
  let mouseX = 0, mouseY = 0, ringX = 0, ringY = 0;

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX; mouseY = e.clientY;
    cursor.style.left = mouseX + 'px';
    cursor.style.top = mouseY + 'px';
  });

  function animateRing() {
    ringX += (mouseX - ringX) * 0.15;
    ringY += (mouseY - ringY) * 0.15;
    cursorRing.style.left = ringX + 'px';
    cursorRing.style.top = ringY + 'px';
    requestAnimationFrame(animateRing);
  }
  animateRing();

  document.querySelectorAll('a, button, .product-item').forEach(el => {
    el.addEventListener('mouseenter', () => {
      cursorRing.style.transform = 'translate(-50%,-50%) scale(1.8)';
      cursorRing.style.borderColor = '#e0c89a';
    });
    el.addEventListener('mouseleave', () => {
      cursorRing.style.transform = 'translate(-50%,-50%) scale(1)';
      cursorRing.style.borderColor = '#c9a876';
    });
  });

  // Magnetic button effect
  document.querySelectorAll('[data-magnetic]').forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      btn.style.transform = `translate(${x * 0.3}px, ${y * 0.3}px)`;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translate(0,0)';
    });
  });
}

// ===== HEADER SCROLL =====
const header = document.getElementById('header');
window.addEventListener('scroll', () => {
  header.classList.toggle('scrolled', window.scrollY > 50);
});

// ===== MOBILE MENU =====
const burger = document.getElementById('burger');
const navLinks = document.getElementById('navLinks');
burger.addEventListener('click', () => {
  burger.classList.toggle('active');
  navLinks.classList.toggle('active');
});
document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', () => {
    burger.classList.remove('active');
    navLinks.classList.remove('active');
  });
});

// ===== SCROLL REVEAL =====
const reveals = document.querySelectorAll('.reveal-up');
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('active');
    }
  });
}, { threshold: 0.15 });
reveals.forEach(el => observer.observe(el));

// ===== COUNTER ANIMATION =====
const counters = document.querySelectorAll('[data-count]');
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const target = +el.getAttribute('data-count');
      let current = 0;
      const increment = target / 50;
      const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
          el.textContent = target;
          clearInterval(timer);
        } else {
          el.textContent = Math.floor(current);
        }
      }, 30);
      counterObserver.unobserve(el);
    }
  });
}, { threshold: 0.5 });
counters.forEach(c => counterObserver.observe(c));

// ===== HERO TITLE REVEAL ON LOAD =====
window.addEventListener('load', () => {
  document.querySelectorAll('.hero-title .line').forEach((line, i) => {
    line.style.transform = 'translateY(100%)';
    line.style.opacity = '0';
    setTimeout(() => {
      line.style.transition = 'all 0.9s cubic-bezier(0.16,1,0.3,1)';
      line.style.transform = 'translateY(0)';
      line.style.opacity = '1';
    }, 1300 + i * 150);
  });
});
