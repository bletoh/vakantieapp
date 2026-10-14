// Maakt de PNG-iconen (app-icoon, beginscherm, manifest) uit public/img/logo.svg.
// Gebruik: node scripts/iconen.js   (opnieuw draaien na het aanpassen van het logo)
const path = require('path');
const sharp = require('sharp');

const IMG = path.join(__dirname, '..', 'public', 'img');
const BG = '#f8f7f3'; // achtergrond van de app

(async () => {
  for (const [file, size, pad] of [['icon-192.png', 192, 0.14], ['icon-512.png', 512, 0.14], ['apple-touch-icon.png', 180, 0.12], ['icon-maskable-512.png', 512, 0.24]]) {
    const inner = Math.round(size * (1 - 2 * pad));
    const logo = await sharp(path.join(IMG, 'logo.svg'), { density: 1200 }).resize(inner, inner).png().toBuffer();
    await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
      .composite([{ input: logo, gravity: 'center' }]).png({ compressionLevel: 9 }).toFile(path.join(IMG, file));
    console.log('gemaakt:', file);
  }
})();
