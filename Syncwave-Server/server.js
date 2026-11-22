require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');

for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID', 'STRIPE_WEBHOOK_SECRET', 'SIGNING_PRIVATE_KEY', 'BASE_URL']) {
  if (!process.env[k]) { console.error('Fehlende Variable: ' + k); process.exit(1); }
}
const { STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET, SIGNING_PRIVATE_KEY } = process.env;
const BASE_URL = process.env.BASE_URL.replace(/\/$/, '');
const PORT = +process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || './data.json';
const MAX_DEVICES = +process.env.MAX_DEVICES || 3;
const LIMIT = 7200;

const stripe = Stripe(STRIPE_SECRET_KEY);
const signKey = crypto.createPrivateKey({ key: Buffer.from(SIGNING_PRIVATE_KEY, 'base64'), format: 'der', type: 'pkcs8' });

/* ---------- Speicher (JSON-Datei) ---------- */
let db = { licenses: {}, bySub: {}, usage: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch {}
const save = () => { try { fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(db)); fs.renameSync(DATA_FILE + '.tmp', DATA_FILE); } catch (e) { console.error('Speichern fehlgeschlagen', e.message); } };
let timer = null;
const saveSoon = () => { clearTimeout(timer); timer = setTimeout(save, 2000); };
process.on('SIGTERM', () => { save(); process.exit(0); });

const weekKey = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
setInterval(() => { const w = weekKey(); for (const k of Object.keys(db.usage)) if (!k.endsWith(':' + w)) delete db.usage[k]; saveSoon(); }, 36e5);

const newKey = () => crypto.randomBytes(12).toString('hex').toUpperCase().match(/.{6}/g).join('-');
function findOrCreate(subId, customer, email) {
  if (db.bySub[subId] && db.licenses[db.bySub[subId]]) return db.licenses[db.bySub[subId]];
  const key = newKey();
  db.licenses[key] = { key, sub: subId, customer, email: email || '', status: 'active', devices: [], created: Date.now() };
  db.bySub[subId] = key; saveSoon();
  return db.licenses[key];
}
const pubOf = (b64) => crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
const validPub = (s) => { if (typeof s !== 'string' || s.length > 200) return false; try { pubOf(s); return true; } catch { return false; } };

/* ---------- App ---------- */
const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' }); next(); });

// Stripe-Webhook (braucht den rohen Body → vor express.json)
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  let ev;
  try { ev = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET); }
  catch { return res.status(400).send('Ungültige Signatur'); }
  const o = ev.data.object;
  if (ev.type === 'checkout.session.completed' && o.mode === 'subscription' && o.subscription) {
    findOrCreate(o.subscription, o.customer, o.customer_details && o.customer_details.email);
  } else if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(ev.type)) {
    const key = db.bySub[o.id];
    if (key) { db.licenses[key].status = ['active', 'trialing', 'past_due'].includes(o.status) ? 'active' : 'inactive'; saveSoon(); }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// einfacher Ratenbegrenzer pro IP
const hits = new Map();
setInterval(() => hits.clear(), 60000);
const limit = (n) => (req, res, next) => {
  const k = req.path + '|' + req.ip, c = (hits.get(k) || 0) + 1; hits.set(k, c);
  if (c > n) return res.status(429).json({ error: 'rate' });
  next();
};

app.post('/api/checkout', limit(20), async (req, res) => {
  try {
    const s = await stripe.checkout.sessions.create({
      mode: 'subscription', line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: BASE_URL + '/success?session_id={CHECKOUT_SESSION_ID}', cancel_url: BASE_URL + '/#preise',
      allow_promotion_codes: true, locale: 'de'
    });
    res.json({ url: s.url });
  } catch (e) { console.error(e.message); res.status(500).json({ error: 'stripe' }); }
});

app.get('/success', async (req, res) => {
  try {
    const s = await stripe.checkout.sessions.retrieve(String(req.query.session_id || ''));
    if (s.mode !== 'subscription' || s.status !== 'complete' || !s.subscription || !['paid', 'no_payment_required'].includes(s.payment_status)) throw new Error('unpaid');
    const lic = findOrCreate(s.subscription, s.customer, s.customer_details && s.customer_details.email);
    res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Syncwave Pro – Dein Schlüssel</title><link rel="stylesheet" href="/style.css"></head><body>
<main class="narrow"><div class="panel center"><div class="ok">✓</div><h1>Danke für deinen Kauf!</h1>
<p>Dein Syncwave-Pro-Lizenzschlüssel:</p><div class="key" id="k">${lic.key}</div>
<button class="btn primary" onclick="navigator.clipboard.writeText('${lic.key}');this.textContent='Kopiert'">Schlüssel kopieren</button>
<ol class="steps"><li>Syncwave öffnen.</li><li>In der Seitenleiste auf <b>„Schlüssel eingeben"</b> klicken.</li><li>Schlüssel einfügen und auf <b>„Aktivieren"</b> klicken.</li></ol>
<p class="dim"><b>Wichtig:</b> Speichere den Schlüssel gut ab (Screenshot oder Passwortmanager). Er gilt für bis zu ${MAX_DEVICES} Geräte.</p></div></main></body></html>`);
  } catch { res.status(400).send('Zahlung nicht gefunden. Wenn du bezahlt hast, warte kurz und lade die Seite neu.'); }
});

app.post('/api/portal', limit(10), async (req, res) => {
  const lic = db.licenses[String(req.body.key || '').trim().toUpperCase()];
  if (!lic) return res.status(404).json({ error: 'invalid' });
  try { const s = await stripe.billingPortal.sessions.create({ customer: lic.customer, return_url: BASE_URL }); res.json({ url: s.url }); }
  catch (e) { console.error(e.message); res.status(500).json({ error: 'stripe' }); }
});

// Lizenz aktivieren/erneuern → signiertes Token (3 Tage gültig, an das Gerät gebunden)
app.post('/api/activate', limit(30), (req, res) => {
  const key = String(req.body.key || '').trim().toUpperCase(), dev = req.body.dev;
  if (!validPub(dev)) return res.status(400).json({ error: 'bad-device' });
  const lic = db.licenses[key];
  if (!lic) return res.status(404).json({ error: 'invalid' });
  if (lic.status !== 'active') return res.status(403).json({ error: 'expired' });
  if (!lic.devices.includes(dev)) {
    if (lic.devices.length >= MAX_DEVICES) return res.status(409).json({ error: 'devices' });
    lic.devices.push(dev); saveSoon();
  }
  const payload = Buffer.from(JSON.stringify({ lic: key.slice(0, 6), dev, exp: Date.now() + 3 * 864e5 }));
  res.json({ token: payload.toString('base64url') + '.' + crypto.sign(null, payload, signKey).toString('base64url') });
});

// Wochenzeit für Free-Nutzer (Anfrage ist mit dem Geräteschlüssel signiert)
app.post('/api/usage', limit(30), (req, res) => {
  const { dev, ts, sec, sig } = req.body || {};
  if (!validPub(dev) || !Number.isFinite(ts) || !Number.isInteger(sec) || sec < 0 || sec > 60 || Math.abs(Date.now() - ts) > 120000) return res.status(400).json({ error: 'bad' });
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(`usage|${ts}|${sec}`), pubOf(dev), Buffer.from(String(sig), 'base64url')); } catch {}
  if (!ok) return res.status(401).json({ error: 'sig' });
  const k = crypto.createHash('sha256').update(dev).digest('hex').slice(0, 24) + ':' + weekKey();
  db.usage[k] = (db.usage[k] || 0) + sec; saveSoon();
  res.json({ seconds: db.usage[k], limit: LIMIT });
});

app.get('/healthz', (_q, res) => res.send('ok'));
app.listen(PORT, () => console.log('Syncwave-Server läuft auf Port ' + PORT));
