# Contact log

The page on pardel.pl is static (GitHub Pages), so visits are stored by a small
Google Apps Script web app that writes to a Google Sheet. `Code.gs` contains the
whole server side.

## What is stored

| column    | content                                                   |
|-----------|-----------------------------------------------------------|
| timestamp | server time of the visit                                  |
| session   | random string generated per browser tab session           |
| timezone  | IANA time zone reported by the browser, e.g. Europe/Warsaw|
| language  | browser language, e.g. pl-PL                              |
| referrer  | host name of the referring site, if any                   |
| device    | `mobile` or `desktop`                                     |
| lat, lon  | approximate position, only after explicit consent (0.1°)  |
| consent   | `yes` if a location was shared                            |

IP addresses, user agents and cookies are not used. The statistics endpoint
publishes counts and coordinates rounded to whole degrees (about 100 km).

## Deployment

1. Create a new Google Sheet, e.g. "pardel.pl contact log".
2. Extensions → Apps Script. Replace the default file with the contents of `Code.gs` and save.
3. Deploy → New deployment → type **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Authorise the script and copy the web app URL (ends with `/exec`).
5. In `index.html` set `var LOG_ENDPOINT = "<web app URL>";`, commit and push.
6. Triggers (clock icon) → Add trigger → function `purgeOldRows`, time-driven, day timer.
   This enforces the 12-month retention stated in `privacy.html`.

After changes to `Code.gs`, use Deploy → Manage deployments → Edit → New version,
otherwise the URL keeps serving the previous code.

## Notes

- The endpoint accepts anonymous POST requests, so rows can in principle be forged.
  Inputs are length-limited and sanitised; the data should be treated as indicative.
- Retention and the description of processing in `privacy.html` must match the
  actual configuration of the script.
