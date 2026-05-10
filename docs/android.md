# Android-förberedelse

Appen är förberedd som en installbar PWA.

## Snabb väg

1. Öppna `https://app-itg-favourites.vercel.app` i Chrome på Android.
2. Välj `Lägg till på startskärmen` eller `Installera app`.
3. Appen öppnas i standalone-läge med egen ikon.

## Filer som styr detta

- `public/manifest.webmanifest` beskriver namn, färger, ikon, start-URL och standalone-läge.
- `public/app-icon.svg` är källikonen.
- `public/app-icon-192.png`, `public/app-icon-512.png` och `public/app-icon-maskable-512.png` används av Android/PWA-flöden.
- `public/sw.js` gör appen PWA-installbar och cachelagrar grundskalet.
- `src/app/layout.tsx` kopplar manifest, ikon och mobil metadata.

## Nästa steg för Play Store

Om appen senare ska publiceras i Google Play är enklaste vägen en Trusted Web Activity via Bubblewrap. Då behövs ett Android package name, signeringsnyckel och en riktig `assetlinks.json` med certifikatets SHA-256-fingerprint.
