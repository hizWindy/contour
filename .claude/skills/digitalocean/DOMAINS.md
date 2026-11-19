# Domains

Where Contour HQ's address lives, and how a custom domain would work. Checked 20 Nov 2026. **TBC** means not confirmed yet.

## Today

- **The only address** is https://contour-hq-mxeqw.ondigitalocean.app. DigitalOcean calls it the starter domain.
- **No custom domain.** The live spec has no `domains:` part, and `doctl compute domain list --context contour` is empty.
- **Contour's own domain** (contourinteriors.com.au) has its DNS somewhere outside DigitalOcean. Who runs it is **TBC** (Dawn or IT).

Check again live: `doctl apps spec get <app id> --context contour | grep -A4 '^domains:'`.

## How a custom domain works

- **Add it** (ask first) in the dashboard: the app, Networking, Domains, Add domain. Or add it to the spec's `domains:` part, which is a spec change.
- **Option 1, DigitalOcean runs the DNS:** point the registrar at `ns1.digitalocean.com`, `ns2.digitalocean.com` and `ns3.digitalocean.com`. This moves the **whole** domain's DNS, including the email (MX) records. Don't do this for contourinteriors.com.au.
- **Option 2, Contour's DNS provider keeps it:** add a CNAME record from the name to the app's alias, which ends in `ondigitalocean.app`. For a root domain (no `hq.` in front), use the A records App Platform gives if the provider can't flatten a CNAME.
- **Certificates:** App Platform makes them by itself. If the domain has CAA records, they must allow both `letsencrypt.org` and `pki.goog`, or the set-up may fail.
- **Not allowed:** a domain with DNSSEC switched on. Whether contourinteriors.com.au uses DNSSEC is **TBC**.
- **Time:** DNS changes can take up to 72 hours to spread.
- **Spec fields:** `domain`, `type` (`DEFAULT`, `PRIMARY` or `ALIAS`, with only one `PRIMARY`), `wildcard`, `zone` (only when DigitalOcean runs the DNS), and `minimum_tls_version` (`"1.2"` or `"1.3"`).
- **The starter address** stays. A redirect rule in the spec can send it to the custom domain.
- **Before deleting an app,** remove its domains first. Otherwise the domain may keep pointing at the deleted app for up to 24 hours.

Source: [manage domains](https://docs.digitalocean.com/products/app-platform/how-to/manage-domains/), [limits](https://docs.digitalocean.com/products/app-platform/details/limits/), [app spec](https://docs.digitalocean.com/products/app-platform/reference/app-spec/).

## What a domain changes in Contour

1. **`${APP_URL}` becomes the custom domain** once it is `PRIMARY`, so `PUBLIC_ORIGIN` changes with it. The backend answers only to its own public host name. The old address will then probably fail at sign-in (**TBC**), so redirect it.
2. **Everyone signs in again,** because cookies belong to one address. The installed website (the app on a phone) is tied to the old address too (**TBC**).
3. **Resend needs DNS records** on Contour's domain to send the run email (run book, "Email"). Ask IT for both at once.
4. **It doesn't fix the live run feed.** A custom domain is needed before the CDN cache can be turned off, but a static site blocks it anyway (APP.md).
5. **Update the run book's checks.** The `curl` lines in "Check after a deploy" use the old address.

## Steps, when Al-khair says

1. **Pick the name**, for example `hq.contourinteriors.com.au` (**TBC**, with Levi and IT).
2. **Ask IT three things:** whether DNSSEC is on, which CAA records exist, and who adds the CNAME.
3. **Add the domain** in the dashboard: Networking, Add domain, "You manage your domain". Copy the CNAME target it shows.
4. **IT adds the CNAME.** Wait until the domain shows as live. A `DOMAIN_FAILED` alert email comes if it fails.
5. **Make it `PRIMARY`**, deploy, and run the run book's checks on the new address. Then copy the live `domains:` part into `.do/app.yaml`.
