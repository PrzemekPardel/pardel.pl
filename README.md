# pardel.pl

Source of the personal website of Przemysław Wiktor Pardel, PhD Eng., published at [pardel.pl](https://pardel.pl).

The site is static and served by GitHub Pages directly from the `main` branch. There is no build step: every file in the repository root is published as it is.

## Contents

| Path           | Purpose                                                                  |
|----------------|--------------------------------------------------------------------------|
| `index.html`   | Home page with the animated visualisation and the visit statistics panel |
| `about.html`   | Research, positions, projects, honours and memberships                   |
| `contact.html` | Contact form; messages are stored in the `Contact` sheet                 |
| `privacy.html` | Privacy notice for the visit log, names and contact messages             |
| `404.html`     | Page shown for unknown addresses                                         |
| `favicon.svg`  | Site icon                                                                |
| `og.png`       | Preview image used when a link is shared (1200 × 630)                    |
| `robots.txt`   | Crawler rules                                                            |
| `sitemap.xml`  | List of pages for search engines                                         |
| `llms.txt`     | Plain-text profile for AI assistants                                     |
| `CNAME`        | Custom domain for GitHub Pages                                           |
| `logger/`      | Server side of the visit log (Google Apps Script), not part of the site  |

All styles and scripts are inline in the HTML files. The pages load no external libraries, fonts or trackers.

## Visit statistics

GitHub Pages cannot store data, so visits are recorded by a Google Apps Script web app that writes to a Google Sheet. The page sends one anonymous record per browser session and reads aggregated counts (total, last 24 hours, 7 days, 4 weeks, year, time zones) from the same endpoint. Visitors may also sign their point with a name or nickname of up to 30 characters, which is then shown next to the point. The endpoint address is set in `index.html` as `LOG_ENDPOINT`. If it is left empty, the panel shows only the current visit.

Deployment, stored fields and retention are described in [`logger/README.md`](logger/README.md). After any change to `logger/Code.gs`, the script must be redeployed as a new version in Apps Script; pushing to this repository does not update it.

## Hosting and domain

The domain is registered at OVH. DNS records point to GitHub Pages:

- `A`: 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
- `AAAA`: 2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153, 2606:50c0:8003::153
- `www`: `CNAME` to `przemekpardel.github.io.`

Mail for the domain is handled separately by OVH (MX, SPF and DKIM records).

## Local preview

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000. The visit log also works locally if `LOG_ENDPOINT` is set, so local visits are counted as well.

## Updating

1. Edit the files and check them in a browser.
2. When page content changes, update `lastmod` in `sitemap.xml` and keep `llms.txt` and the structured data in the page headers consistent with the visible text.
3. Commit and push to `main`. GitHub Pages publishes the change within a few minutes.

## Licence

© Przemysław Wiktor Pardel. All rights reserved. The text, images and code may not be reused without permission.
