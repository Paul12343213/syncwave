# Syncwave-Server (Website + Lizenzen)

## 1. Stripe einrichten (stripe.com)
1. Produkt „Syncwave Pro" anlegen: wiederkehrend, 2 € / Monat → **Preis-ID** (`price_...`) kopieren.
2. Entwickler → API-Schlüssel → **Geheimer Schlüssel** (`sk_live_...`).
3. Einstellungen → Billing → **Kundenportal** aktivieren (Kündigung erlauben).
4. Entwickler → Webhooks → Endpunkt `https://DEINE-DOMAIN/webhook` mit den Ereignissen
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   → **Signing secret** (`whsec_...`) kopieren.

## 2. Schlüssel erzeugen
    npm install
    npm run keys
Der PRIVATE Schlüssel kommt in die Server-Variablen, der PUBLIC Schlüssel in `Syncwave/config.json`.

## 3. Konfigurieren
`.env.example` → `.env` kopieren und alle Werte eintragen (oder beim Hoster als Variablen setzen).

## 4. Starten / Deployen
Lokal testen: `npm start` (mit Stripe-Testschlüsseln und `stripe listen --forward-to localhost:3000/webhook`).
Online: bei Render, Railway, Fly.io oder einem eigenen Server (Node 18+, HTTPS, **dauerhafter Speicher** für `data.json`!).
Start-Befehl: `npm start`.

## 5. App verbinden
In `Syncwave/config.json`:
    { "serverUrl": "https://DEINE-DOMAIN", "publicKey": "..." }
Dann die App mit `build.bat` neu bauen.

## Wichtig
- `data.json` enthält alle Lizenzen: regelmäßig sichern!
- Den privaten Schlüssel NIE weitergeben. Wer ihn hat, kann Pro-Tokens erzeugen.
- Impressum/Datenschutz ausfüllen, ggf. Widerrufsbelehrung ergänzen (Rechtsberatung empfohlen).
