// E-mail versturen (alleen voor wachtwoord-herstel). Instellingen via .env:
//   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, MAIL_FROM
// Bijv. Gmail: SMTP_HOST=smtp.gmail.com, SMTP_USER=jij@gmail.com, SMTP_PASS=<app-wachtwoord van 16 tekens>.
// Zonder SMTP_HOST staat e-mail uit en blijft "vraag de beheerder om een tijdelijk wachtwoord" de route.
// MAIL_TRANSPORT=file (voor de tests) schrijft de mail naar DATA_DIR/last-mail.json in plaats van te versturen.
const fs = require('fs');
const path = require('path');

let transport = null;
function getTransport() {
  if (transport) return transport;
  const nodemailer = require('nodemailer');
  if (process.env.MAIL_TRANSPORT === 'file') {
    transport = { sendMail: async (msg) => { fs.writeFileSync(path.join(require('./db').DATA_DIR, 'last-mail.json'), JSON.stringify(msg)); } };
  } else {
    const port = parseInt(process.env.SMTP_PORT, 10) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 15000,
    });
  }
  return transport;
}

const mailEnabled = () => !!(process.env.SMTP_HOST || process.env.MAIL_TRANSPORT === 'file');

async function sendMail({ to, subject, text, html }) {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'vakantieplanner@localhost';
  await getTransport().sendMail({ from: `Vakantieplanner <${from.replace(/^.*<|>.*$/g, '')}>`, to, subject, text, html });
}

module.exports = { mailEnabled, sendMail };
