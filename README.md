# Ubon Udonkang · Portfolio v5

**Deploy URL:** https://ubonudonkang.github.io

## Deployment
```bash
cd portfolio-v5
git init && git add .
git commit -m "v5 launch"
git branch -M main
git remote add origin https://github.com/ubonudonkang/ubonudonkang.github.io.git
git push -f origin main
```
GitHub → Settings → Pages → Source: main / root → Save.

## Activate Contact Form
Replace `action="https://formspree.io/f/your-form-id"` in `contact.html` with your real Formspree endpoint.

## Add Profile Photo
In `index.html`, replace:
```html
<div class="hero__avatar">UU</div>
```
with:
```html
<div class="hero__avatar"><img src="photo.jpg" alt="Ubon Udonkang"/></div>
```

## File Structure
```
index.html              Home + hero (Africa SVG, dark project cards, testimonial carousel)
projects.html           All 6 project cards (dark grid)
about.html              Bio, 4C Framework, skills, timeline, certifications
contact.html            Form + contact info (Formspree)
resources.html          Paid and free resources
project-rights-issue.html
project-ams.html
project-rpa-treasury.html
project-open-banking.html
project-bid-management.html
project-loan-approval.html
css/style.css           Full design system
js/main.js              Spring dock, WAT clock, carousel, email copy
```

## Key v5 Changes
1. Dark project card grid (2-col, matching v2 screenshot)
2. Testimonial carousel (auto-scroll right to left, infinite loop, pause on hover)
3. Clock shows WAT (UTC+1)
4. Avatar square frame above name; name on single line
5. Removed "Est. 2017·Lagos" meta line
6. Dock: smaller (42px), spring-physics per-item animation
7. Email: ubonudonkang@gmail.com
8. Digital Transformation added as service
9. Responsive: tablet (1024px) and mobile (768px, 480px) breakpoints
10. Africa network SVG illustration in hero (Lagos as hub, 7 connected markets)
11. Six project detail pages with full case study content
