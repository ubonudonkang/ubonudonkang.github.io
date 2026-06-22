# Ubon Udonkang | BA Portfolio

**Live site:** [ubonudonkang.github.io](https://ubonudonkang.github.io)

Senior Business Analyst portfolio; covering fintech, banking automation, Open Banking, and cross-border payment systems across Nigerian and African markets.

---

## Pages

| Page | Description |
|------|-------------|
| `index.html` | Home; hero, key metrics, featured projects, 4C Framework intro |
| `projects.html` | Seven full case studies with challenge, role, and outcome |
| `about.html` | Bio, 4C Framework detail, skills grid, career timeline, certifications |
| `contact.html` | Contact form (Formspree), direct contact info, engagement process |

## Stack

- Pure HTML5, CSS3, and Vanilla JS; no build tools, no dependencies
- Google Fonts: Space Grotesk, Inter, JetBrains Mono
- Hosted on GitHub Pages (free)

## Setup: Deploy to GitHub Pages in 3 Steps

### Step 1: Create a new repository

Go to [github.com/new](https://github.com/new) and create a repository named exactly:

```
ubonudonkang.github.io
```

Make it **Public**. Do not initialise with a README (you already have one).

### Step 2: Push the files

Open your terminal in this folder and run:

```bash
git init
git add .
git commit -m "Initial portfolio launch"
git branch -M main
git remote add origin https://github.com/ubonudonkang/ubonudonkang.github.io.git
git push -u origin main
```

### Step 3: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** > **Pages** (left sidebar)
3. Under **Source**, select **Deploy from a branch**
4. Set branch to **main**, folder to **/ (root)**
5. Click **Save**

Your site will be live at `https://ubonudonkang.github.io` within 2 minutes.

---

## Activate the Contact Form

The contact form uses [Formspree](https://formspree.io) (free tier; 50 submissions/month).

1. Sign up at [formspree.io](https://formspree.io)
2. Create a new form and copy your form ID (looks like `xpzgkwrb`)
3. In `contact.html`, replace the form action:

```html
<!-- Replace this: -->
action="https://formspree.io/f/your-form-id"

<!-- With your actual ID: -->
action="https://formspree.io/f/xpzgkwrb"
```

---

## Customisation Notes

- **Email address:** Update `ubon.udonkang@gmail.com` in `contact.html` to your actual email
- **LinkedIn URL:** Update `linkedin.com/in/ubonudonkang` across all pages if your handle differs
- **Color tokens:** All design tokens are in `css/style.css` under `:root { }` at line 20
- **Timeline dates:** Update career dates in `about.html` as needed

---

## License

All content and code is the intellectual property of Ubon Udonkang. Project descriptions reflect real professional experience. Not for redistribution.
