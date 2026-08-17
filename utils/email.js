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
    const apiKey = process.env.BREVO_API_KEY || (process.env.SMTP_PASS && process.env.SMTP_PASS.startsWith('xkeysib-') ? process.env.SMTP_PASS : null);
    if (host.includes('brevo.com') && apiKey) {
        try {
            console.log(`[Email] Attempting to send email to ${to} via Brevo HTTP API...`);
            const response = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json',
                    'api-key': apiKey
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

/**
 * Send Client Welcome Email
 * @param {string} to - Recipient email address
 * @param {string} name - Recipient's name
 */
async function sendClientWelcomeEmail(to, name) {
    const subject = 'Welcome to Trost!';
    const text = `Hello ${name},\n\nWelcome to Trost! Your account has been registered successfully. We are excited to have you on board.`;
    const html = `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1a202c;">
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="color: #6366f1; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Trost</h1>
            </div>
            <h2 style="color: #2d3748; font-size: 22px; font-weight: 600; margin-top: 0; margin-bottom: 15px;">Welcome to Trost, ${name}!</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #4a5568; margin-bottom: 20px;">
                We are thrilled to welcome you to our community. Trost is here to provide you with a safe, confidential space to talk, connect, and find support whenever you need it.
            </p>
            <p style="font-size: 16px; line-height: 1.6; color: #4a5568; margin-bottom: 25px;">
                You can now log in to your account, explore our directory of active listeners, and start a call at any time.
            </p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="https://trostapp.com/login" style="background-color: #6366f1; color: #ffffff; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block; box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.4);">
                    Explore Trost
                </a>
            </div>
            <p style="font-size: 14px; line-height: 1.5; color: #718096; margin-bottom: 0;">
                If you have any questions or need assistance, our support team is always here to help. Just reply to this email!
            </p>
            <hr style="border: none; border-top: 1px solid #edf2f7; margin: 25px 0;" />
            <p style="font-size: 12px; color: #a0aec0; text-align: center; margin: 0;">
                &copy; 2026 Trost. All rights reserved.
            </p>
        </div>
    `;
    return sendEmail({ to, subject, text, html });
}

/**
 * Send Pending Review Email (sent when listener submits application)
 * @param {string} to - Recipient email address
 * @param {string} name - Recipient's name
 */
async function sendPendingReviewEmail(to, name) {
    const subject = 'Your Trost Listener Application is Under Review';
    const text = `Hello ${name},\n\nThank you for applying to be a listener on Trost! Your application has been successfully submitted and is currently under review. We will notify you once the evaluation is complete.`;
    const html = `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1a202c;">
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="color: #6366f1; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Trost</h1>
            </div>
            <h2 style="color: #2d3748; font-size: 22px; font-weight: 600; margin-top: 0; margin-bottom: 15px;">Application Received!</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #4a5568; margin-bottom: 20px;">
                Hello ${name}, thank you for applying to join the Trost community as a listener. We are excited about your interest in helping others.
            </p>
            <p style="font-size: 16px; line-height: 1.6; color: #4a5568; margin-bottom: 20px;">
                Your application, voice samples, and profile details have been successfully received and are currently being reviewed by our administration team.
            </p>
            <div style="background-color: #f7fafc; border-left: 4px solid #6366f1; padding: 15px; margin: 25px 0; border-radius: 0 8px 8px 0;">
                <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #4a5568; font-weight: 500;">
                    <strong>Current Status:</strong> Pending Review<br/>
                    We typically complete the evaluation within 24-48 hours. We will notify you by email as soon as a decision is made.
                </p>
            </div>
            <p style="font-size: 14px; line-height: 1.5; color: #718096; margin-bottom: 0;">
                If you need to make changes to your application or have questions in the meantime, please contact our review board at support@trostapp.com.
            </p>
            <hr style="border: none; border-top: 1px solid #edf2f7; margin: 25px 0;" />
            <p style="font-size: 12px; color: #a0aec0; text-align: center; margin: 0;">
                &copy; 2026 Trost. All rights reserved.
            </p>
        </div>
    `;
    return sendEmail({ to, subject, text, html });
}

/**
 * Send Listener Welcome Email (sent on admin approval)
 * @param {string} to - Recipient email address
 * @param {string} name - Recipient's name
 */
async function sendListenerWelcomeEmail(to, name) {
    const subject = 'Congratulations! Your Trost Listener Application is Approved';
    const text = `Hello ${name},\n\nCongratulations! Your application to be a listener on Trost has been approved. You can now log in, go online, and start helping callers.`;
    const html = `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1a202c;">
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="color: #10b981; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Trost</h1>
            </div>
            <h2 style="color: #2d3748; font-size: 22px; font-weight: 600; margin-top: 0; margin-bottom: 15px;">Congratulations, ${name}!</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #4a5568; margin-bottom: 20px;">
                We are thrilled to inform you that your application to be a listener has been <strong>approved</strong>! Welcome to the active listener team.
            </p>
            <p style="font-size: 16px; line-height: 1.6; color: #4a5568; margin-bottom: 25px;">
                Your profile is now live. You can log in to the Listener Dashboard, set your status to active, and start accepting support calls.
            </p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="https://trostapp.com/listener/dashboard" style="background-color: #10b981; color: #ffffff; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.4);">
                    Go to Dashboard
                </a>
            </div>
            <p style="font-size: 14px; line-height: 1.5; color: #718096; margin-bottom: 0;">
                Thank you for dedication to making a difference. Let's build a supportive world together.
            </p>
            <hr style="border: none; border-top: 1px solid #edf2f7; margin: 25px 0;" />
            <p style="font-size: 12px; color: #a0aec0; text-align: center; margin: 0;">
                &copy; 2026 Trost. All rights reserved.
            </p>
        </div>
    `;
    return sendEmail({ to, subject, text, html });
}

/**
 * Send Early Bird Confirmation Email
 * @param {string} to - Recipient email address
 * @param {string} name - Recipient's name
 */
async function sendEarlyBirdConfirmationEmail(to, name) {
    const subject = 'You are on the list! Trost Early Bird Access';
    const text = `Hello ${name},\n\nThank you for signing up for early access to Trost. You are officially confirmed as an early bird member. We will notify you as soon as early access begins!`;
    const html = `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1a202c;">
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="color: #6366f1; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Trost</h1>
            </div>
            <h2 style="color: #2d3748; font-size: 22px; font-weight: 600; margin-top: 0; margin-bottom: 15px;">Early Bird Confirmed!</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #4a5568; margin-bottom: 20px;">
                Hello ${name}, thank you for joining our early bird waitlist!
            </p>
            <p style="font-size: 16px; line-height: 1.6; color: #4a5568; margin-bottom: 25px;">
                As an early bird member, you'll receive priority access when Trost officially opens registration, along with exclusive updates and special early-access perks.
            </p>
            <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
                <p style="margin: 0; font-size: 15px; color: #1e3a8a; font-weight: 500; text-align: center;">
                    🚀 You are officially on the list! Stay tuned for launch details.
                </p>
            </div>
            <hr style="border: none; border-top: 1px solid #edf2f7; margin: 25px 0;" />
            <p style="font-size: 12px; color: #a0aec0; text-align: center; margin: 0;">
                &copy; 2026 Trost. All rights reserved.
            </p>
        </div>
    `;
    return sendEmail({ to, subject, text, html });
}

module.exports = {
    sendEmail,
    sendOtpEmail,
    sendClientWelcomeEmail,
    sendPendingReviewEmail,
    sendListenerWelcomeEmail,
    sendEarlyBirdConfirmationEmail,
    transporter
};
