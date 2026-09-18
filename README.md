# chris-duarte.com

Personal site for Chris Duarte — About Me, Projects, and Contact. Plain HTML/CSS/JS, no build step, hosted free on GitHub Pages with the custom domain `chris-duarte.com`.

## Editing content

Open `index.html` and update anything marked `<!-- EDIT ME -->`:

- Your bio text in the **About** section
- The skills/chips list
- The project cards in the **Projects** section (swap in your real projects, or duplicate an `<article class="card">` block to add more)
- Your real email and GitHub link in the **Contact** section

You can edit any file directly on GitHub (open the file, click the pencil icon) and commit — no local setup needed.

## Enabling GitHub Pages

1. In this repo, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to `Deploy from a branch`.
3. Pick branch `main`, folder `/ (root)`, then **Save**.
4. Under **Custom domain**, enter `chris-duarte.com` and save. (The `CNAME` file is already included here.)

GitHub will show "DNS check unsuccessful" until the DNS records below are added — that's expected at first.

## Pointing the domain at GitHub (in GoDaddy)

In GoDaddy: **My Products → DNS → Manage** for `chris-duarte.com`, then add:

**Apex domain (`chris-duarte.com`)** — four A records, host `@`:

| Type | Name | Value |
|------|------|-----------------|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

**`www` subdomain** — one CNAME record:

| Type | Name | Value |
|------|------|--------------------|
| CNAME | www | xoorki.github.io |

Remove any GoDaddy "Parked" or forwarding records on `@` first — they'll conflict with the new A records.

DNS changes can take a few minutes to a few hours to propagate. Once it does, go back to **Settings → Pages** in this repo, confirm the DNS check passes, and tick **Enforce HTTPS**.

## Structure

```
index.html   – page content
style.css    – dark theme styling
script.js    – nav toggle + scroll animations
CNAME        – tells GitHub Pages which custom domain to serve
```
