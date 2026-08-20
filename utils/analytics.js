const crypto = require('crypto');

// Environment variables for tracking IDs
const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID;
const GA4_API_SECRET = process.env.GA4_API_SECRET;
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

function hashSha256(val) {
    if (!val) return null;
    return crypto.createHash('sha256').update(val.trim().toLowerCase()).digest('hex');
}

// Send event to GA4 Measurement Protocol
async function sendGA4Event(clientId, eventName, params = {}) {
    if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET) {
        console.log(`[Analytics - GA4] Measurement ID or API Secret missing. Skipping event: ${eventName}`);
        return;
    }

    try {
        const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;
        const body = {
            client_id: String(clientId || 'anonymous'),
            events: [{
                name: eventName,
                params: {
                    ...params,
                    engagement_time_msec: 100
                }
            }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Analytics - GA4] Failed to send event ${eventName}:`, errorText);
        } else {
            console.log(`[Analytics - GA4] Event ${eventName} sent successfully.`);
        }
    } catch (err) {
        console.error(`[Analytics - GA4] Error sending event ${eventName}:`, err);
    }
}

// Send event to Meta Conversions API
async function sendMetaEvent(eventName, userData = {}, customData = {}, sourceUrl = '') {
    if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
        console.log(`[Analytics - Meta] Pixel ID or Access Token missing. Skipping event: ${eventName}`);
        return;
    }

    try {
        const url = `https://graph.facebook.com/v16.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;
        
        const userPayload = {};
        if (userData.email) userPayload.em = [hashSha256(userData.email)];
        if (userData.phone) userPayload.ph = [hashSha256(userData.phone)];
        if (userData.clientIp) userPayload.client_ip_address = userData.clientIp;
        if (userData.userAgent) userPayload.client_user_agent = userData.userAgent;

        const body = {
            data: [{
                event_name: eventName,
                event_time: Math.floor(Date.now() / 1000),
                user_data: userPayload,
                custom_data: customData,
                event_source_url: sourceUrl || 'https://trostapp.com',
                action_source: 'website'
            }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const resJson = await response.json();
        if (resJson.error) {
            console.error(`[Analytics - Meta] Failed to send event ${eventName}:`, resJson.error);
        } else {
            console.log(`[Analytics - Meta] Event ${eventName} sent successfully.`);
        }
    } catch (err) {
        console.error(`[Analytics - Meta] Error sending event ${eventName}:`, err);
    }
}

// Track registration event (Registration Tracking)
async function trackRegistration(req, user) {
    const clientId = user.id;
    const eventParams = {
        user_id: user.id,
        user_type: user.user_type,
        registration_method: user.user_type === 'listener' ? 'listener_application' : 'standard_sign_up'
    };

    const userData = {
        email: user.email,
        phone: user.phone,
        clientIp: req.ip,
        userAgent: req.headers['user-agent']
    };

    // Track on GA4
    await sendGA4Event(clientId, 'sign_up', eventParams);

    // Track on Meta
    await sendMetaEvent('CompleteRegistration', userData, {
        content_name: 'User Registration',
        status: 'completed'
    }, `${req.protocol}://${req.get('host')}${req.originalUrl}`);
}

// Track voice submission event (Voice Submission Tracking)
async function trackVoiceSubmission(req, user, details) {
    const clientId = user.id;
    const eventParams = {
        user_id: user.id,
        primary_voice_present: !!details.primary_voice,
        secondary_voice_present: !!details.secondary_voice
    };

    const userData = {
        email: user.email,
        phone: user.phone,
        clientIp: req.ip,
        userAgent: req.headers['user-agent']
    };

    // Track on GA4
    await sendGA4Event(clientId, 'voice_submission', eventParams);

    // Track on Meta
    await sendMetaEvent('SubmitApplication', userData, {
        content_category: 'Listener Application',
        content_name: 'Voice Submission'
    }, `${req.protocol}://${req.get('host')}${req.originalUrl}`);
}

// Track free trial activation (Trial Tracking)
async function trackTrial(req, user, minutesCredited) {
    const clientId = user.id;
    const eventParams = {
        user_id: user.id,
        trial_minutes: minutesCredited
    };

    const userData = {
        email: user.email,
        phone: user.phone,
        clientIp: req.ip,
        userAgent: req.headers['user-agent']
    };

    // Track on GA4
    await sendGA4Event(clientId, 'start_trial', eventParams);

    // Track on Meta
    await sendMetaEvent('StartTrial', userData, {
        content_name: 'Free Trial Activated',
        value: 0.00,
        currency: 'USD'
    }, `${req.protocol}://${req.get('host')}${req.originalUrl}`);
}

// Track conversions/purchases (Conversion Tracking)
async function trackConversion(req, user, payment) {
    const clientId = user.id;
    const amount = parseFloat(payment.amount || 0);

    const eventParams = {
        transaction_id: String(payment.payment_id || payment.id),
        value: amount,
        currency: 'USD',
        items: [{
            item_id: String(payment.package_id),
            item_name: `Minute Package ${payment.package_id}`,
            price: amount,
            quantity: 1
        }]
    };

    const userData = {
        email: user.email,
        phone: user.phone,
        clientIp: req.ip,
        userAgent: req.headers['user-agent']
    };

    // Track on GA4
    await sendGA4Event(clientId, 'purchase', eventParams);

    // Track on Meta
    await sendMetaEvent('Purchase', userData, {
        value: amount,
        currency: 'USD',
        content_type: 'product',
        content_ids: [String(payment.package_id)]
    }, `${req.protocol}://${req.get('host')}${req.originalUrl}`);
}

module.exports = {
    trackRegistration,
    trackVoiceSubmission,
    trackTrial,
    trackConversion
};
