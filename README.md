# PulseTEXT tip page (GitHub Pages)

Static tip UI only. No Ops desk. No wallets or secrets in this folder.

## Deploy

1. Upload **everything in this folder** to a public GitHub repo root.
2. Settings → Pages → Deploy from branch → `main` / `/(root)`.
3. Edit `config.js`:

```js
window.__PULSETEXT_API__ = "https://tips.yourdomain.com";
```

That must be **your VPS tip relay** HTTPS origin (`/v1/assets`, `/v1/quote`, `/v1/line`). See `relay/README.md` in the main PulseTEXT repo.

4. Stream PC desk → Settings:
   - Tip relay URL + token (same as the VPS)
   - Website origin = `https://YOURUSER.github.io`

Never put `:8787` (Ops) on the public internet.
