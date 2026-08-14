const nodemailer = require('nodemailer');
require('dotenv').config();

// Create the transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    connectionTimeout: 10000, // Increase to 10 seconds for more buffer on cloud servers
    greetingTimeout: 10000,   // Increase to 10 seconds
    socketTimeout: 20000     // Increase to 20 seconds
});

/**
 * Send an email
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text body
 * @param {string} options.html - HTML body (optional)
 */
async function sendEmail({ to, subject, text, html }) {
    const fromEmail = process.env.SMTP_FROM_EMAIL || 'no-reply@trostapp.com';
    const fromName = process.env.SMTP_FROM_NAME || 'Trost';
    
    // If using Brevo, send via HTTPS API to bypass cloud provider SMTP blocks
    const host = process.env.SMTP_HOST || 'smtp-relay.brevo.com';
    if (host.includes('brevo.com') && process.env.SMTP_PASS) {
        try {
            console.log(`[Email] Attempting to send email to ${to} via Brevo HTTP API...`);
            const response = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json',
                    'api-key': process.env.SMTP_PASS
                },
                body: JSON.stringify({
                    sender: {
                        name: fromName,
                        email: fromEmail
                    },
                    to: [
                        {
                            email: to
                        }
                    ],
                    subject: subject,
                    htmlContent: html,
                    textContent: text
                })
            });

            if (response.ok) {
                const result = await response.json();
                console.log(`[Email] Sent successfully via Brevo HTTP API. Message ID: ${result.messageId}`);
                return { status: true, messageId: result.messageId };
            } else {
                const errorBody = await response.text();
                console.warn(`[Email] Brevo HTTP API returned status ${response.status}: ${errorBody}. Falling back to SMTP...`);
            }
        } catch (apiError) {
            console.warn(`[Email] Brevo HTTP API error: ${apiError.message}. Falling back to SMTP...`);
        }
    }

    // SMTP Fallback
    try {
        const mailOptions = {
            from: `"${fromName}" <${fromEmail}>`,
            to,
            subject,
            text,
            html
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`[Email] Sent successfully via SMTP: ${info.messageId}`);
        return { status: true, messageId: info.messageId };
    } catch (error) {
        console.error('[Email] SMTP Failed to send:', error);
        return { status: false, error: error.message };
    }
}

/**
 * Send OTP email template
 * @param {string} to - Recipient email address
 * @param {string} otp - The OTP code
 */
async function sendOtpEmail(to, otp) {
    const subject = 'Your Trost Verification OTP';
    const text = `Your verification code is: ${otp}. It is valid for 10 minutes.`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #4A90E2; text-align: center;">Trost App Verification</h2>
            <p>Hello,</p>
            <p>Your one-time verification code is:</p>
            <div style="text-align: center; margin: 30px 0;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; background-color: #f5f5f5; padding: 10px 20px; border-radius: 4px; border: 1px dashed #cccccc; color: #333333;">
                    ${otp}
                </span>
            </div>
            <p>This code is valid for 10 minutes. Please do not share this OTP with anyone.</p>
            <hr style="border: none; border-top: 1px solid #eeeeee; margin: 20px 0;" />
            <p style="font-size: 12px; color: #999999; text-align: center;">This is an automated email, please do not reply.</p>
        </div>
    `;
    return sendEmail({ to, subject, text, html });
}

module.exports = {
    sendEmail,
    sendOtpEmail,
    transporter
};
