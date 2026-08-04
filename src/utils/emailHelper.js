// Read config from env
const EMAIL_PASS = process.env.EMAIL_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'Investate India <support@investateindia.com>';

let fromAddress = "support@investateindia.com";
let fromName = "Investate India";

const fromMatch = EMAIL_FROM.match(/^(.*?)\s*<(.+)>$/);
if (fromMatch) {
  fromName = fromMatch[1].replace(/['"]/g, '').trim();
  fromAddress = fromMatch[2].trim();
} else if (EMAIL_FROM) {
  fromAddress = EMAIL_FROM;
}

if (!EMAIL_PASS) {
  console.log('[EmailHelper] EMAIL_PASS missing. Operating in Mock console mode.');
} else {
  console.log('[EmailHelper] ZeptoMail REST API configured successfully.');
}

/**
 * Send an email using ZeptoMail REST API (Bypasses SMTP port blocks)
 * @param {string} to
 * @param {string} subject
 * @param {string} text
 * @param {string} html
 */
const sendMail = async (to, subject, text, html = '') => {
  if (!to) return;

  if (EMAIL_PASS) {
    try {
      const response = await fetch('https://api.zeptomail.in/v1.1/email', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Zoho-enczapikey ${EMAIL_PASS}`
        },
        body: JSON.stringify({
          from: {
            address: fromAddress,
            name: fromName
          },
          to: [
            {
              email_address: {
                address: to,
                name: to.split('@')[0]
              }
            }
          ],
          subject: subject,
          htmlbody: html || text
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(`ZeptoMail API Error: ${JSON.stringify(data)}`);
      }
      console.log(`[EmailHelper] Email sent successfully to ${to} for: "${subject}"`);
    } catch (err) {
      console.error(`[EmailHelper] Failed to send email to ${to}:`, err.message);
      throw err;
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
