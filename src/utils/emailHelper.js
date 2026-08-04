const nodemailer = require('nodemailer');

// Read config from env
const EMAIL_HOST = process.env.EMAIL_HOST || '';
const EMAIL_PORT = process.env.EMAIL_PORT || '587';
const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@investateindia.com';

let transporter = null;

// Initialize transporter if env values are provided
if (EMAIL_HOST && EMAIL_USER && EMAIL_PASS) {
  try {
    transporter = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: parseInt(EMAIL_PORT, 10),
      secure: EMAIL_PORT === '465', // true for 465, false for other ports
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
    });
    console.log('[EmailHelper] SMTP transporter configured successfully.');
  } catch (err) {
    console.error('[EmailHelper] SMTP configuration failed:', err.message);
  }
} else {
  console.log('[EmailHelper] SMTP credentials missing. Operating in Mock console mode.');
}

/**
 * Send an email
 * @param {string} to
 * @param {string} subject
 * @param {string} text
 * @param {string} html
 */
const sendMail = async (to, subject, text, html = '') => {
  if (!to) return;

  if (transporter) {
    try {
      await transporter.sendMail({
        from: EMAIL_FROM,
        to,
        subject,
        text,
        html: html || text,
      });
      console.log(`[EmailHelper] Email sent successfully to ${to} for: "${subject}"`);
    } catch (err) {
      console.error(`[EmailHelper] Failed to send email to ${to}:`, err.message);
    }
  } else {
    // Console log fallback
    console.log(`
============================================================
[MOCK EMAIL SENT]
To: ${to}
From: ${EMAIL_FROM}
Subject: ${subject}
Content: ${text}
============================================================
    `);
  }
};

/**
 * Format HTML template wrap
 */
const buildTemplate = (title, bodyHtml) => {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
      <div style="background-color: #0b264f; padding: 20px; border-radius: 12px 12px 0 0; text-align: center;">
        <h2 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">${title}</h2>
      </div>
      <div style="padding: 24px; color: #334155; line-height: 1.6; font-size: 15px;">
        ${bodyHtml}
      </div>
      <div style="border-top: 1px solid #f1f5f9; padding-top: 16px; margin-top: 24px; text-align: center; font-size: 11px; color: #94a3b8;">
        This is an automated system notification from Investate India. Please do not reply directly to this message.
      </div>
    </div>
  `;
};

module.exports = {
  sendMail,
  buildTemplate,
};
