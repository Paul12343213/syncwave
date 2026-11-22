// Einmalig ausführen: node gen-keys.js
const crypto = require('crypto');
const k = crypto.generateKeyPairSync('ed25519');
console.log('\nSIGNING_PRIVATE_KEY (GEHEIM, nur in die .env / Server-Variablen):\n' + k.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'));
console.log('\npublicKey (in Syncwave/config.json eintragen, darf öffentlich sein):\n' + k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') + '\n');
