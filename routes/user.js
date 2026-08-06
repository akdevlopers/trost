const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { auth, verifyOtpToken } = require('../middleware/auth');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const upload = require('../middleware/upload');


router.get('/listeners', auth, async (req, res) => {
    try {
        const user_id = req.user.id;
        const {
            page = 1,
            search,
            available_now,
            rating,
            language_id,
            interest,
            vibe,
            sort = "recommended"
        } = req.query;

        const limit = 10;
        const offset = (page - 1) * limit;

        let where = `
            WHERE
                u.user_type='listener'
                AND ld.application_status=2
                AND u.id <> $1
        `;

        const values = [user_id];
        let index = 2;

        if (search) {
            where += ` AND u.name ILIKE $${index}`;
            values.push(`%${search}%`);
            index++;
        }

        if (available_now !== undefined) {
            where += ` AND ld.available_now = $${index}`;
            values.push(available_now === "true");
            index++;
        }

        if (rating) {
            where += ` AND ld.rating >= $${index}`;
            values.push(Number(rating));
            index++;
        }

        if (language_id) {
            const ids = language_id.split(',').map(Number);

            where += ` AND ul.language_id = ANY($${index})`;
            values.push(ids);
            index++;
        }

        if (interest) {
            const ids = interest.split(',').map(Number);

            where += ` AND li.interest_id = ANY($${index})`;
            values.push(ids);
            index++;
        }

        if (vibe) {
            const ids = vibe.split(',').map(Number);

            where += ` AND ld.vibe_id = ANY($${index})`;
            values.push(ids);
            index++;
        }

        let orderBy = "ld.rating DESC";

        switch (sort) {
            case "rating":
                orderBy = "ld.rating DESC";
                break;

            case "newest":
                orderBy = "u.id DESC";
                break;

            case "recommended":
            default:
                orderBy = "ld.rating DESC";
        }

        const countQuery = `
            SELECT COUNT(DISTINCT u.id) AS total
            FROM users u
            JOIN listener_details ld ON ld.user_id = u.id
            LEFT JOIN listener_preferred_languages ul ON ul.user_id = u.id
            LEFT JOIN listener_interests li ON li.user_id = u.id
            ${where}
        `;
        const { rows: countRows } = await pool.query(countQuery, values);
        const total = parseInt(countRows[0].total);
        const totalPages = Math.ceil(total / limit);

        values.push(limit);
        values.push(offset);

        const query = `
            SELECT
                u.id,
                u.name,
                u.profile_photo,

                ld.tagline,
                ld.rating,
                ld.total_reviews,
                ld.available_now,
                ld.vibe_id,
                ld.primary_voice,

                STRING_AGG(DISTINCT i.interest_name, ', ') AS interests,
                STRING_AGG(DISTINCT l.language_name, ', ') AS languages

            FROM users u

            JOIN listener_details ld
                ON ld.user_id = u.id

            LEFT JOIN listener_preferred_languages ul
                ON ul.user_id = u.id

            LEFT JOIN languages l
                ON l.id = ul.language_id

            LEFT JOIN listener_interests li
                 ON li.user_id = u.id

            LEFT JOIN interests i
                 ON i.id = li.interest_id

            ${where}

            GROUP BY
                u.id,
                ld.id

            ORDER BY ${orderBy}

            LIMIT $${index} OFFSET $${index + 1}
        `;

        const { rows } = await pool.query(query, values);

        const BASE_URL = `${req.protocol}://${req.get('host')}`;

        const data = rows.map(listener => ({
            ...listener,
            profile_photo: listener.profile_photo
                ? `${BASE_URL}/uploads/${listener.profile_photo}`
                : null,

            primary_voice: listener.primary_voice
                ? `${BASE_URL}/uploads/${listener.primary_voice}`
                : null,

            secondary_voice: listener.secondary_voice
                ? `${BASE_URL}/uploads/${listener.secondary_voice}`
                : null
        }));


        res.status(200).json({
            status: true,
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages,
            data: data
        });

    } catch (error) {
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

router.get('/listeners-list', async (req, res) => {
    try {
        const query = `
            SELECT
                u.id,
                u.name,
                u.profile_photo,
                ld.tagline,
                ld.rating,
                ld.total_reviews,
                ld.available_now,
                ld.vibe_id,
                ld.primary_voice,
                ld.secondary_voice,
                STRING_AGG(DISTINCT i.interest_name, ', ') AS interests,
                STRING_AGG(DISTINCT l.language_name, ', ') AS languages
            FROM users u
            JOIN listener_details ld
                ON ld.user_id = u.id
            LEFT JOIN listener_preferred_languages ul
                ON ul.user_id = u.id
            LEFT JOIN languages l
                ON l.id = ul.language_id
            LEFT JOIN listener_interests li
                ON li.user_id = u.id
            LEFT JOIN interests i
                ON i.id = li.interest_id
            WHERE
                u.user_type = 'listener'
                AND ld.application_status = 2
            GROUP BY
                u.id,
                ld.id
            ORDER BY
                ld.rating DESC
            LIMIT 6;
        `;

        const { rows } = await pool.query(query);

        const BASE_URL = `${req.protocol}://${req.get('host')}`;

        const data = rows.map(listener => ({
            ...listener,
            profile_photo: listener.profile_photo
                ? `${BASE_URL}/uploads/${listener.profile_photo}`
                : null,
            primary_voice: listener.primary_voice
                ? `${BASE_URL}/uploads/${listener.primary_voice}`
                : null,
            secondary_voice: listener.secondary_voice
                ? `${BASE_URL}/uploads/${listener.secondary_voice}`
                : null
        }));

        res.status(200).json({
            status: true,
            data
        });

    } catch (error) {
        res.status(500).json({
            status: false,
            message: error.message
        });
    }
});
// GET /api/language-list
router.get('/language-list', async (req, res) => {
    try {

        const { rows: languages } = await pool.query(`
            SELECT
                id,
                language_name,
                created_at,
                updated_at
            FROM languages
            ORDER BY language_name ASC
        `);

        res.status(200).json({
            status: true,
            message: 'Languages fetched successfully.',
            data: languages
        });

    } catch (error) {
        console.error(error);

        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// GET /api/fluency-list
router.get('/fluency-list', auth, async (req, res) => {
    try {

        const { rows: fluencies } = await pool.query(`
            SELECT
                id,
                level_name,
                created_at,
                updated_at
            FROM fluency_levels
            ORDER BY id ASC
        `);

        return res.status(200).json({
            status: true,
            message: 'Fluency levels fetched successfully.',
            data: fluencies
        });

    } catch (error) {
        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// GET /api/vibes-list
router.get('/vibes-list',async (req, res) => {
    try {

        const { rows: vibes } = await pool.query(`
            SELECT
                id,
                vibe_name
            FROM vibes
            ORDER BY id ASC
        `);

        return res.status(200).json({
            status: true,
            message: 'Vibes fetched successfully.',
            data: vibes
        });

    } catch (error) {
        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// GET /api/vibes-list
router.get('/vibes-list', async (req, res) => {
    try {

        const { rows: vibes } = await pool.query(`
            SELECT
                id,
                vibe_name
            FROM vibes
            ORDER BY id ASC
        `);

        return res.status(200).json({
            status: true,
            message: 'Vibes fetched successfully.',
            data: vibes
        });

    } catch (error) {
        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// GET /api/interests-list
router.get('/interests-list', async (req, res) => {
    try {

        const { rows: interests } = await pool.query(`
            SELECT
                id,
                interest_name
            FROM interests
            ORDER BY id ASC
        `);

        return res.status(200).json({
            status: true,
            message: 'Interests fetched successfully.',
            data: interests
        });

    } catch (error) {
        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// GET /api/home
router.get('/home', auth, async (req, res) => {
    try {
        const user_id = req.user.id;
        const BASE_URL = `${req.protocol}://${req.get('host')}`;

        // Fetch User Info
        const { rows: userData } = await pool.query(
            `SELECT id, name, profile_photo, email_verified FROM users WHERE id = $1`,
            [user_id]
        );
        let user = userData.length > 0 ? userData[0] : null;
        if (user) {
            if (user.profile_photo) {
                user.profile_photo = `${BASE_URL}/uploads/${user.profile_photo}`;
            }
            // Mocking streak since there's no check-in table/column yet
            user.streak = 4;
        }

        // Available count
        const { rows: countData } = await pool.query(
            `SELECT COUNT(*) FROM listener_details ld
             JOIN users u ON u.id = ld.user_id
             WHERE ld.available_now = true AND ld.application_status = 2 AND u.id <> $1`,
            [user_id]
        );
        const availableCount = parseInt(countData[0].count);

        // Available Right Now
        const { rows: availableNow } = await pool.query(
            `SELECT
                u.id, u.name, u.profile_photo,
                ld.rating, ld.vibe_id, ld.available_now, ld.total_reviews, ld.is_verified,
                STRING_AGG(DISTINCT i.interest_name, ', ') AS interests
             FROM users u
             JOIN listener_details ld ON ld.user_id = u.id
             LEFT JOIN listener_interests li ON li.user_id = u.id
             LEFT JOIN interests i ON i.id = li.interest_id
             WHERE ld.available_now = true AND ld.application_status = 2 AND u.id <> $1
             GROUP BY u.id, u.name, u.profile_photo, ld.rating, ld.vibe_id, ld.available_now, ld.total_reviews, ld.is_verified
             ORDER BY ld.rating DESC NULLS LAST, u.id DESC
             LIMIT 4`,
            [user_id]
        );

        // Jump Back In (Using user_conversations table for actual recent interactions)
        const { rows: jumpBackIn } = await pool.query(
            `SELECT 
                u.id, u.name, u.profile_photo, 
                ld.available_now
             FROM (
                SELECT listener_id, MAX(started_at) as last_convo
                FROM user_conversations
                WHERE user_id = $1
                GROUP BY listener_id
                ORDER BY last_convo DESC
                LIMIT 4
             ) recent
             JOIN users u ON u.id = recent.listener_id
             JOIN listener_details ld ON ld.user_id = u.id
             ORDER BY recent.last_convo DESC`,
            [user_id]
        );

        // Recent Conversations
        const { rows: recentConversations } = await pool.query(
            `SELECT 
                c.id as conversation_id,
                u.id as listener_id,
                u.name as listener_name,
                u.profile_photo as listener_photo,
                ld.vibe_id,
                c.started_at,
                c.ended_at,
                EXTRACT(EPOCH FROM (c.ended_at - c.started_at))/60 AS duration_minutes
             FROM user_conversations c
             JOIN users u ON u.id = c.listener_id
             LEFT JOIN listener_details ld ON ld.user_id = u.id
             WHERE c.user_id = $1
             ORDER BY c.started_at DESC
             LIMIT 5`,
            [user_id]
        );

        const formatListener = (l) => ({
            ...l,
            profile_photo: l.profile_photo ? `${BASE_URL}/uploads/${l.profile_photo}` : null,
        });

        // // Filter Values
        // const [languages, fluencies, vibes, interests] = await Promise.all([
        //     pool.query('SELECT id, language_name FROM languages ORDER BY language_name ASC'),
        //     pool.query('SELECT id, level_name FROM fluency_levels ORDER BY id ASC'),
        //     pool.query('SELECT id, vibe_name FROM vibes ORDER BY id ASC'),
        //     pool.query('SELECT id, interest_name FROM interests ORDER BY id ASC')
        // ]);

        const { rows: minuteData } = await pool.query(
            `SELECT
                free_minutes,
                purchased_minutes,
                remaining_minutes
            FROM user_minutes
            WHERE user_id = $1`,
            [user_id]
        );

        const minutes = minuteData.length > 0
            ? minuteData[0]
            : {
                free_minutes: 0,
                purchased_minutes: 0,
                remaining_minutes: 0
            };

        res.json({
            status: true,
            message: 'Home data fetched successfully.',
            data: {
                user,
                minutes,
                available_listeners_count: availableCount,
                available_right_now: availableNow.map(formatListener),
                jump_back_in: jumpBackIn.map(formatListener),
                recent_conversations: recentConversations.map(conv => ({
                    ...conv,
                    listener_photo: conv.listener_photo ? `${BASE_URL}/uploads/${conv.listener_photo}` : null,
                    duration_minutes: conv.duration_minutes ? Math.round(conv.duration_minutes) : 0
                })),
                // filters: {
                //     languages: languages.rows,
                //     fluencies: fluencies.rows,
                //     vibes: vibes.rows,
                //     interests: interests.rows
                // }

            }
        });

    } catch (error) {
        console.error(error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// GET /api/billing
router.get('/billing', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        // 1. Balance
        const { rows: balanceData } = await pool.query(
            `SELECT free_minutes, purchased_minutes, remaining_minutes 
             FROM user_minutes WHERE user_id = $1`,
            [user_id]
        );
        let balance = { total_minutes: 0, free_minutes: 0, top_up_minutes: 0 };
        if (balanceData.length > 0) {
            balance = {
                total_minutes: balanceData[0].remaining_minutes,
                free_minutes: balanceData[0].free_minutes,
                top_up_minutes: balanceData[0].purchased_minutes
            };
        }

        // 2. Top-up Offers
        const { rows: packagesData } = await pool.query(
            `SELECT id, package_name, minutes, price, is_popular 
             FROM minute_packages WHERE status = TRUE ORDER BY minutes ASC`
        );
        const top_up_offers = packagesData.map(pkg => ({
            id: pkg.id,
            package_name: pkg.package_name,
            minutes: pkg.minutes,
            price: parseFloat(pkg.price),
            price_per_min: parseFloat((pkg.price / pkg.minutes).toFixed(2)),
            is_popular: pkg.is_popular
        }));

        // 3. Transaction History
        const { rows: transactionData } = await pool.query(
            `SELECT 
                mt.id,
                mt.type,
                mt.source,
                mt.minutes,
                mt.amount,
                mt.created_at as date,
                u.name as listener_name
             FROM minute_transactions mt
             LEFT JOIN users u ON u.id = mt.listener_id
             WHERE mt.user_id = $1
             ORDER BY mt.created_at DESC
             LIMIT 20`,
            [user_id]
        );

        const transactions = transactionData.map(t => {
            let title = '';
            let cost_type = '';
            let minutes_change = t.minutes;

            if (t.source === 'call') {
                title = `Talk with ${t.listener_name || 'Listener'}`;
                cost_type = t.amount && t.amount > 0 ? `$${t.amount}` : 'Free';
            } else if (t.source === 'package') {
                title = `Top-up · ${Math.abs(t.minutes)} min pack`;
                cost_type = t.amount && t.amount > 0 ? `$${t.amount}` : 'Free';
            } else if (t.source === 'free_trial') {
                title = `Free trial`;
                if (t.listener_name) title += ` · ${t.listener_name}`;
                cost_type = 'Free';
            } else {
                title = t.source;
                cost_type = t.amount && t.amount > 0 ? `$${t.amount}` : 'Free';
            }

            return {
                id: t.id,
                type: t.source,
                title: title,
                created_at: t.date,
                minutes_change: minutes_change,
                cost_type: cost_type
            };
        });

        res.status(200).json({
            status: true,
            message: 'Billing data fetched successfully.',
            data: {
                balance,
                top_up_offers,
                transaction_history: transactions
            }
        });

    } catch (error) {
        console.error(error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// GET /api/account
router.get('/account', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        const BASE_URL = `${req.protocol}://${req.get('host')}`;

        // 1. User Profile & Preferred Language
        const { rows: userData } = await pool.query(
            `SELECT id, name, profile_photo, created_at as member_since FROM users WHERE id = $1`,
            [user_id]
        );
        let user = userData.length > 0 ? userData[0] : null;
        if (user) {
            if (user.profile_photo) {
                user.profile_photo = `${BASE_URL}/uploads/${user.profile_photo}`;
            } else {
                user.profile_photo = "";
            }
        }

        // 2. All Interests and User's Selected Interests
        const { rows: allInterests } = await pool.query(`SELECT id, interest_name FROM interests ORDER BY id ASC`);
        const { rows: userInterests } = await pool.query(
            `SELECT interest_id FROM user_interests WHERE user_id = $1`,
            [user_id]
        );
        const selected_interests = userInterests.map(row => row.interest_id);

        // 3. Languages List
       const { rows: languages } = await pool.query(
            `SELECT
                id,
                language_name
            FROM languages
            ORDER BY language_name ASC`
        );

        const { rows: userLanguages } = await pool.query(
            `SELECT language_id
            FROM user_preferred_languages
            WHERE user_id = $1`,
            [user_id]
        );

        const selected_languages = userLanguages.map(
            row => row.language_id
        );

        // 4. Balance
        const { rows: balanceData } = await pool.query(
            `SELECT id, remaining_minutes FROM user_minutes WHERE user_id = $1`,
            [user_id]
        );
        const remaining_minutes = balanceData.length > 0 ? balanceData[0].remaining_minutes : 0;

        // 5. Default Payment Method
        const { rows: cardData } = await pool.query(
            `SELECT
                id,
                provider,
                card_holder_name,
                card_number,
                card_last4,
                cvv,
                expiry_month,
                expiry_year,
                is_default
            FROM card_payment
            WHERE user_id = $1
            AND is_default = TRUE
            LIMIT 1`,
            [user_id]
        );
        const payment_method = cardData.length > 0 ? cardData[0] : null;

        // 6. Notification Settings
        const { rows: notifData } = await pool.query(
            `SELECT saved_listener_online, checkin_reminders, product_updates 
             FROM notification_settings WHERE user_id = $1`,
            [user_id]
        );
        const notifications = notifData.length > 0 ? notifData[0] : {
            saved_listener_online: true,
            checkin_reminders: true,
            product_updates: false
        };

        // 7. Recent Conversations (Calls)
        const { rows: recentConversations } = await pool.query(
            `SELECT 
                c.id,
                u.name as listener_name,
                ld.rating as listener_rating,
                EXTRACT(EPOCH FROM (c.ended_at - c.started_at))/60 AS duration_minutes,
                c.started_at as created_at
             FROM user_conversations c
             JOIN users u ON u.id = c.listener_id
             LEFT JOIN listener_details ld ON ld.user_id = u.id
             WHERE c.user_id = $1
             ORDER BY c.started_at DESC
             LIMIT 4`,
            [user_id]
        );

        res.status(200).json({
            status: true,
            message: 'Account data fetched successfully.',
            data: {
                user,
                interests: {
                    all: allInterests,
                    selected: selected_interests
                },
                languages: {
                    all: languages,
                    selected: selected_languages
                },
                balance: {
                    remaining_minutes,
                    pay_as_you_go_rate: 0.90 // Static default based on UI design
                },
                payment_method,
                notifications,
                recent_conversations: recentConversations.map(c => ({
                    ...c,
                    duration_minutes: c.duration_minutes ? Math.round(c.duration_minutes) : 0
                }))
            }
        });

    } catch (error) {
        console.error(error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// GET /api/conversations?page=1&limit=10
router.get('/conversations', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        // Total count
        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) AS total
             FROM user_conversations
             WHERE user_id = $1`,
            [user_id]
        );

        const total = parseInt(countRows[0].total);

        // Conversation list
        const { rows } = await pool.query(
            `SELECT
                c.id,
                c.listener_id,
                u.name AS listener_name,
                u.profile_photo,
                ld.rating AS listener_rating,
                c.started_at,
                c.ended_at,
                ROUND(EXTRACT(EPOCH FROM (c.ended_at - c.started_at))/60) AS duration_minutes
            FROM user_conversations c
            JOIN users u
                ON u.id = c.listener_id
            LEFT JOIN listener_details ld
                ON ld.user_id = u.id
            WHERE c.user_id = $1
            ORDER BY c.started_at DESC
            LIMIT $2 OFFSET $3`,
            [user_id, limit, offset]
        );

        const BASE_URL = `${req.protocol}://${req.get('host')}`;

        const conversations = rows.map(item => ({
            id: item.id,
            listener_id: item.listener_id,
            listener_name: item.listener_name.trim(),
            profile_photo: item.profile_photo
                ? `${BASE_URL}/uploads/${item.profile_photo}`
                : null,
            listener_rating: item.listener_rating
                ? Number(item.listener_rating)
                : null,
            started_at: item.started_at,
            ended_at: item.ended_at,
            duration_minutes: Number(item.duration_minutes)
        }));

        return res.status(200).json({
            status: true,
            message: "Conversation list fetched successfully.",
            data: {
                current_page: page,
                per_page: limit,
                total_records: total,
                total_pages: Math.ceil(total / limit),
                conversations
            }
        });

    } catch (error) {
        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });
    }
});
//POST /api/toggle-save-listener
router.post('/toggle-save-listener', auth, async (req, res) => {
    try {
        const user_id = req.user.id;
        const { listener_id } = req.body;

        if (!listener_id) {
            return res.status(200).json({
                status: false,
                message: "listener_id is required."
            });
        }

        // Check listener exists
        const { rows: listener } = await pool.query(
            `SELECT id
             FROM users
             WHERE id = $1
             AND user_type = 'listener'`,
            [listener_id]
        );

        if (listener.length === 0) {
            return res.status(200).json({
                status: false,
                message: "Listener not found."
            });
        }

        // Check if already saved
        const { rows: existing } = await pool.query(
            `SELECT id
             FROM saved_listeners
             WHERE user_id = $1
             AND listener_id = $2`,
            [user_id, listener_id]
        );

        if (existing.length > 0) {
            // Unsave
            await pool.query(
                `DELETE FROM saved_listeners
                 WHERE user_id = $1
                 AND listener_id = $2`,
                [user_id, listener_id]
            );

            return res.status(200).json({
                status: true,
                action: "unsaved",
                is_saved: false,
                message: "Listener removed from saved list."
            });
        }

        // Save
        await pool.query(
            `INSERT INTO saved_listeners (user_id, listener_id)
             VALUES ($1, $2)`,
            [user_id, listener_id]
        );

        return res.status(200).json({
            status: true,
            action: "saved",
            is_saved: true,
            message: "Listener saved successfully."
        });

    } catch (error) {
        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });
    }
});
//GET /api/get-saved-listeners
router.get('/get-saved-listeners', auth, async (req, res) => {

    try {

        const user_id = req.user.id;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const BASE_URL = `${req.protocol}://${req.get('host')}`;

        const { rows: count } = await pool.query(
            `SELECT COUNT(*) total
             FROM saved_listeners
             WHERE user_id=$1`,
            [user_id]
        );

        const total = Number(count[0].total);

        const { rows } = await pool.query(
            `SELECT
                sl.id,
                u.id AS listener_id,
                u.name,
                u.profile_photo,
                ld.tagline,
                ld.rating,
                ld.total_reviews,
                ld.available_now
            FROM saved_listeners sl
            JOIN users u
                ON u.id=sl.listener_id
            LEFT JOIN listener_details ld
                ON ld.user_id=u.id
            WHERE sl.user_id=$1
            ORDER BY sl.created_at DESC
            LIMIT $2 OFFSET $3`,
            [user_id, limit, offset]
        );

        const listeners = rows.map(item => ({
            id: item.id,
            listener_id: item.listener_id,
            name: item.name.trim(),
            profile_photo: item.profile_photo
                ? `${BASE_URL}/uploads/${item.profile_photo}`
                : null,
            tagline: item.tagline,
            rating: item.rating ? Number(item.rating) : 0,
            total_reviews: item.total_reviews,
            available_now: item.available_now
        }));

        res.status(200).json({
            status: true,
            message: "Saved listeners fetched successfully.",
            data: {
                current_page: page,
                per_page: limit,
                total_records: total,
                total_pages: Math.ceil(total / limit),
                listeners
            }
        });

    } catch (error) {

        console.error(error);

        res.status(200).json({
            status: false,
            message: error.message
        });
    }

});
//profile
// GET /api/card
router.get('/card', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        const { rows } = await pool.query(
            `SELECT
                id,
                provider,
                card_holder_name,
                
                card_number,
                card_last4,
                cvv,
                expiry_month,
                expiry_year,
                is_default,
                created_at
             FROM card_payment
             WHERE user_id = $1
             AND is_default = TRUE
             LIMIT 1`,
            [user_id]
        );

        if (rows.length === 0) {
            return res.json({
                status: false,
                message: "No card found."
            });
        }

        return res.json({
            status: true,
            message: "Card fetched successfully.",
            data: rows[0]
        });

    } catch (error) {
        console.error(error);

        return res.json({
            status: false,
            message: error.message
        });
    }
});
// POST /api/add-card
router.post('/add-card', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        const {
            provider,
            card_holder_name,
            //card_brand,
            card_number,
            card_last4,
            cvv,
            expiry_month,
            expiry_year
        } = req.body;

        // Required fields
        if (
            !provider ||
            !card_holder_name ||
            //!card_brand ||
            !card_number ||
            !card_last4 ||
            !cvv ||
            !expiry_month ||
            !expiry_year
        ) {
            return res.json({
                status: false,
                message: "provider, card_holder_name, card_number, card_last4, cvv, expiry_month and expiry_year are required."
            });
        }

        // Provider validation
        const validProviders = [
            "Visa",
            "Mastercard",
            "RuPay",
            "American Express"
        ];

        if (!validProviders.includes(provider)) {
            return res.json({
                status: false,
                message: "Invalid provider."
            });
        }

        // Card holder name
        if (card_holder_name.trim().length < 2) {
            return res.json({
                status: false,
                message: "Invalid card holder name."
            });
        }

        // Card brand
        // if (card_brand.length > 50) {
        //     return res.json({
        //         status: false,
        //         message: "card_brand is too long."
        //     });
        // }

        // Card number
        if (!/^\d{13,19}$/.test(card_number)) {
            return res.json({
                status: false,
                message: "Invalid card number."
            });
        }

        // Last 4 digits
        if (!/^\d{4}$/.test(card_last4)) {
            return res.json({
                status: false,
                message: "card_last4 must contain exactly 4 digits."
            });
        }

        // CVV
        if (!/^\d{3,4}$/.test(cvv)) {
            return res.json({
                status: false,
                message: "Invalid CVV."
            });
        }

        // Expiry Month
        if (expiry_month < 1 || expiry_month > 12) {
            return res.json({
                status: false,
                message: "Invalid expiry month."
            });
        }

        // Expiry Year
        const currentYear = new Date().getFullYear();

        if (expiry_year < currentYear) {
            return res.json({
                status: false,
                message: "Card has expired."
            });
        }

        // Check if same card already exists
        const { rows: existing } = await pool.query(
            `SELECT id
             FROM card_payment
             WHERE user_id = $1
             AND card_number = $2`,
            [user_id, card_number]
        );

        if (existing.length > 0) {
            return res.json({
                status: false,
                message: "Card already exists."
            });
        }

        // Make first card default
        const { rows: countRows } = await pool.query(
            `SELECT id
             FROM card_payment
             WHERE user_id = $1`,
            [user_id]
        );

        const isDefault = countRows.length === 0;

        await pool.query(
            `INSERT INTO card_payment
            (
                user_id,
                provider,
                card_holder_name,
                card_number,
                card_last4,
                cvv,
                expiry_month,
                expiry_year,
                is_default
            )
            VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
                user_id,
                provider,
                card_holder_name,
                //card_brand,
                card_number,
                card_last4,
                cvv,
                expiry_month,
                expiry_year,
                isDefault
            ]
        );

        return res.json({
            status: true,
            message: "Card added successfully."
        });

    } catch (error) {
        console.error(error);

        return res.json({
            status: false,
            message: error.message
        });
    }
});
// POST /api/update-card
router.post('/update-card', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        const {
            card_id,
            provider,
            card_holder_name,
            card_number,
            card_last4,
            cvv,
            expiry_month,
            expiry_year
        } = req.body;

        // Validation
        if (!card_id) {
            return res.json({
                status: false,
                message: "card_id is required."
            });
        }

        if (
            !provider ||
            !card_holder_name ||
            !card_number ||
            !card_last4 ||
            !cvv ||
            !expiry_month ||
            !expiry_year
        ) {
            return res.json({
                status: false,
                message: "provider, card_holder_name, card_number, card_last4, cvv, expiry_month and expiry_year are required."
            });
        }

        // Check card exists
        const { rows: cardRows } = await pool.query(
            `SELECT id
             FROM card_payment
             WHERE id = $1
             AND user_id = $2`,
            [card_id, user_id]
        );

        if (cardRows.length === 0) {
            return res.json({
                status: false,
                message: "Card not found."
            });
        }

        // Provider validation
        const validProviders = [
            "Visa",
            "Mastercard",
            "RuPay",
            "American Express"
        ];

        if (!validProviders.includes(provider)) {
            return res.json({
                status: false,
                message: "Invalid provider."
            });
        }

        // Card holder name
        if (card_holder_name.trim().length < 2) {
            return res.json({
                status: false,
                message: "Invalid card holder name."
            });
        }

        // Card brand
        // if (card_brand.length > 50) {
        //     return res.json({
        //         status: false,
        //         message: "card_brand is too long."
        //     });
        // }

        // Card number
        if (!/^\d{13,19}$/.test(card_number)) {
            return res.json({
                status: false,
                message: "Invalid card number."
            });
        }

        // Last 4 digits
        if (!/^\d{4}$/.test(card_last4)) {
            return res.json({
                status: false,
                message: "card_last4 must contain exactly 4 digits."
            });
        }

        // CVV
        if (!/^\d{3,4}$/.test(cvv)) {
            return res.json({
                status: false,
                message: "Invalid CVV."
            });
        }

        // Expiry Month
        if (expiry_month < 1 || expiry_month > 12) {
            return res.json({
                status: false,
                message: "Invalid expiry month."
            });
        }

        // Expiry Year
        const currentYear = new Date().getFullYear();

        if (expiry_year < currentYear) {
            return res.json({
                status: false,
                message: "Card has expired."
            });
        }

        // Check duplicate card number
        const { rows: duplicate } = await pool.query(
            `SELECT id
             FROM card_payment
             WHERE user_id = $1
             AND card_number = $2
             AND id != $3`,
            [user_id, card_number, card_id]
        );

        if (duplicate.length > 0) {
            return res.json({
                status: false,
                message: "Card already exists."
            });
        }

        // Update card
        await pool.query(
            `UPDATE card_payment
             SET
                provider = $1,
                card_holder_name = $2,
                card_number = $3,
                card_last4 = $4,
                cvv = $5,
                expiry_month = $6,
                expiry_year = $7,
                updated_at = NOW()
             WHERE id = $8
             AND user_id = $9`,
            [
                provider,
                card_holder_name,
                
                card_number,
                card_last4,
                cvv,
                expiry_month,
                expiry_year,
                card_id,
                user_id
            ]
        );

        return res.json({
            status: true,
            message: "Card updated successfully."
        });

    } catch (error) {
        console.error(error);

        return res.json({
            status: false,
            message: error.message
        });
    }
});

// POST /api/update-language
router.post('/update-language', auth, async (req, res) => {
    const client = await pool.connect();

    try {
        const user_id = req.user.id;
        const { language_id } = req.body;

        // Validation
        if (!Array.isArray(language_id) || language_id.length === 0) {
            return res.json({
                status: false,
                message: "language_ids must be a non-empty array."
            });
        }

        // Check all language IDs exist
        const { rows } = await client.query(
            `SELECT id
             FROM languages
             WHERE id = ANY($1::int[])`,
            [language_id]
        );

        if (rows.length !== language_id.length) {
            return res.json({
                status: false,
                message: "One or more language IDs are invalid."
            });
        }

        await client.query("BEGIN");

        // Remove previous languages
        await client.query(
            `DELETE FROM user_preferred_languages
             WHERE user_id = $1`,
            [user_id]
        );

        // Insert selected languages
        for (const language_ids of language_id) {
            await client.query(
                `INSERT INTO user_preferred_languages
                (
                    user_id,
                    language_id
                )
                VALUES
                ($1, $2)`,
                [user_id, language_ids]
            );
        }

        await client.query("COMMIT");

        return res.json({
            status: true,
            message: "Preferred languages updated successfully."
        });

    } catch (error) {

        await client.query("ROLLBACK");

        console.error(error);

        return res.json({
            status: false,
            message: error.message
        });

    } finally {
        client.release();
    }
});
// POST /api/update-interests
router.post('/update-interests', auth, async (req, res) => {
    const client = await pool.connect();

    try {
        const user_id = req.user.id;
        const { interest_ids } = req.body;

        if (
            !Array.isArray(interest_ids) ||
            interest_ids.length === 0
        ) {
            return res.json({
                status: false,
                message: "interest_ids must be a non-empty array."
            });
        }

        // Check all interests exist
        const { rows } = await client.query(
            `SELECT id
             FROM interests
             WHERE id = ANY($1::int[])`,
            [interest_ids]
        );

        if (rows.length !== interest_ids.length) {
            return res.json({
                status: false,
                message: "One or more interest IDs are invalid."
            });
        }

        await client.query("BEGIN");

        // Remove existing interests
        await client.query(
            `DELETE FROM user_interests
             WHERE user_id = $1`,
            [user_id]
        );

        // Insert new interests
        for (const interest_id of interest_ids) {
            await client.query(
                `INSERT INTO user_interests
                (
                    user_id,
                    interest_id
                )
                VALUES
                ($1,$2)`,
                [user_id, interest_id]
            );
        }

        await client.query("COMMIT");

        return res.json({
            status: true,
            message: "Interests updated successfully."
        });

    } catch (error) {
        await client.query("ROLLBACK");

        console.error(error);

        return res.json({
            status: false,
            message: error.message
        });

    } finally {
        client.release();
    }
});
// GET /api/user-minutes
router.get('/user-minutes', auth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search?.trim();

        const offset = (page - 1) * limit;

        let where = '';
        const values = [];
        let index = 1;

        if (search) {
            where = `
                WHERE
                    u.name ILIKE $${index}
                    OR u.email ILIKE $${index}
                    OR u.phone ILIKE $${index}
            `;
            values.push(`%${search}%`);
            index++;
        }

        // Total Count
        const countQuery = `
            SELECT COUNT(*)
            FROM user_minutes um
            JOIN users u ON u.id = um.user_id
            ${where}
        `;

        const { rows: countRows } = await pool.query(countQuery, values);

        const total = parseInt(countRows[0].count);
        const totalPages = Math.ceil(total / limit);

        values.push(limit);
        values.push(offset);

        // List
        const query = `
            SELECT
                um.id,
                um.user_id,

                u.name,
                u.email,
                u.phone,
                u.profile_photo,

                um.free_minutes,
                um.purchased_minutes,
                um.remaining_minutes,
                um.updated_at

            FROM user_minutes um

            JOIN users u
                ON u.id = um.user_id

            ${where}

            ORDER BY um.updated_at DESC

            LIMIT $${index}
            OFFSET $${index + 1}
        `;

        const { rows } = await pool.query(query, values);

        const BASE_URL = `${req.protocol}://${req.get('host')}`;

        const data = rows.map(item => ({
            ...item,
            profile_photo: item.profile_photo
                ? `${BASE_URL}/uploads/${item.profile_photo}`
                : null
        }));

        return res.json({
            status: true,
            page,
            limit,
            total,
            totalPages,
            data
        });

    } catch (error) {
        console.error(error);

        return res.json({
            status: false,
            message: error.message
        });
    }
});

//post /api/update-notification-settings
router.post('/update-notification-settings', auth, async (req, res) => {
    try {

        const user_id = req.user.id;
        const { type, enabled } = req.body;

        if (!type) {
            return res.status(200).json({
                status: false,
                message: "type is required."
            });
        }

        if (enabled === undefined) {
            return res.status(200).json({
                status: false,
                message: "enabled is required."
            });
        }

        const allowedTypes = [
            "saved_listener_online",
            "checkin_reminders",
            "product_updates"
        ];

        if (!allowedTypes.includes(type)) {
            return res.status(200).json({
                status: false,
                message: "Invalid notification type."
            });
        }

        // Check if settings already exist
        const { rows } = await pool.query(
            `SELECT id
             FROM notification_settings
             WHERE user_id = $1`,
            [user_id]
        );

        if (rows.length === 0) {

            await pool.query(
                `INSERT INTO notification_settings
                (
                    user_id,
                    saved_listener_online,
                    checkin_reminders,
                    product_updates
                )
                VALUES
                (
                    $1,
                    false,
                    false,
                    false
                )`,
                [user_id]
            );
        }

        await pool.query(
            `UPDATE notification_settings
             SET ${type} = $1,
                 updated_at = NOW()
             WHERE user_id = $2`,
            [enabled, user_id]
        );

        const { rows: updated } = await pool.query(
            `SELECT
                saved_listener_online,
                checkin_reminders,
                product_updates
             FROM notification_settings
             WHERE user_id = $1`,
            [user_id]
        );

        return res.status(200).json({
            status: true,
            message: "Notification settings updated successfully.",
            data: updated[0]
        });

    } catch (error) {

        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });

    }
});
// GET /api/listener-details/:listener_id
router.get('/listener-details/:listener_id', auth, async (req, res) => {
    try {

        const user_id = req.user.id;
        const listener_id = req.params.listener_id;

        const BASE_URL = `${req.protocol}://${req.get('host')}`;

        // Listener Details
        const { rows } = await pool.query(
            `
            SELECT
                u.id,
                u.name,
                u.profile_photo,

                ld.tagline,
                ld.bio,
                ld.rating,
                ld.total_reviews,
                ld.total_calls,
                ld.available_now,
                ld.primary_voice,
                ld.secondary_voice,

                v.vibe_name AS vibe,

                EXISTS (
                    SELECT 1
                    FROM saved_listeners sl
                    WHERE sl.user_id = $1
                    AND sl.listener_id = u.id
                ) AS is_saved

            FROM users u

            JOIN listener_details ld
                ON ld.user_id = u.id

            LEFT JOIN vibes v
                ON v.id = ld.vibe_id

            WHERE
                u.id = $2
                AND u.user_type = 'listener'
            `,
            [user_id, listener_id]
        );

        if (rows.length === 0) {
            return res.status(200).json({
                status: false,
                message: "Listener not found."
            });
        }

        const listener = rows[0];

        // Languages
        const { rows: languages } = await pool.query(
            `
            SELECT
                l.id,
                l.language_name
            FROM listener_preferred_languages ul
            JOIN languages l
                ON l.id = ul.language_id
            WHERE ul.user_id = $1
            ORDER BY l.language_name
            `,
            [listener_id]
        );

        // Interests
        const { rows: interests } = await pool.query(
            `
            SELECT
                i.id,
                i.interest_name
            FROM listener_interests li
            JOIN interests i
                ON i.id = li.interest_id
            WHERE li.user_id = $1
            ORDER BY i.interest_name
            `,
            [listener_id]
        );

        listener.profile_photo = listener.profile_photo
            ? `${BASE_URL}/uploads/${listener.profile_photo}`
            : null;

        listener.primary_voice = listener.primary_voice
            ? `${BASE_URL}/uploads/${listener.primary_voice}`
            : null;

        listener.secondary_voice = listener.secondary_voice
            ? `${BASE_URL}/uploads/${listener.secondary_voice}`
            : null;

        listener.languages = languages;
        listener.interests = interests;

        return res.status(200).json({
            status: true,
            message: "Listener details fetched successfully.",
            data: listener
        });

    } catch (error) {

        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });

    }
});
//post /api/rate-listener
router.post('/rate-listener', auth, async (req, res) => {
    const client = await pool.connect();

    try {

        const user_id = req.user.id;
        const { listener_id, rating, review } = req.body;

        if (!listener_id) {
            return res.status(200).json({
                status: false,
                message: "listener_id is required."
            });
        }

        if (!rating) {
            return res.status(200).json({
                status: false,
                message: "rating is required."
            });
        }

        if (rating < 1 || rating > 5) {
            return res.status(200).json({
                status: false,
                message: "Rating must be between 1 and 5."
            });
        }

        await client.query("BEGIN");

        // Check listener
        const { rows: listener } = await client.query(
            `SELECT id
             FROM users
             WHERE id = $1
             AND user_type = 'listener'`,
            [listener_id]
        );

        if (listener.length === 0) {
            await client.query("ROLLBACK");

            return res.status(200).json({
                status: false,
                message: "Listener not found."
            });
        }

        // Has user already reviewed?
        const { rows: existing } = await client.query(
            `SELECT id
             FROM listener_reviews
             WHERE user_id = $1
             AND listener_id = $2`,
            [user_id, listener_id]
        );

        if (existing.length > 0) {

            await client.query(
                `UPDATE listener_reviews
                 SET
                    rating = $1,
                    review = $2,
                    updated_at = NOW()
                 WHERE id = $3`,
                [
                    rating,
                    review || null,
                    existing[0].id
                ]
            );

        } else {

            await client.query(
                `INSERT INTO listener_reviews
                (
                    user_id,
                    listener_id,
                    rating,
                    review
                )
                VALUES
                ($1,$2,$3,$4)`,
                [
                    user_id,
                    listener_id,
                    rating,
                    review || null
                ]
            );

        }

        // Recalculate rating
        const { rows: stats } = await client.query(
            `SELECT
                ROUND(AVG(rating)::numeric,1) AS rating,
                COUNT(*) AS total_reviews
             FROM listener_reviews
             WHERE listener_id = $1`,
            [listener_id]
        );

        await client.query(
            `UPDATE listener_details
             SET
                rating = $1,
                total_reviews = $2
             WHERE user_id = $3`,
            [
                stats[0].rating,
                stats[0].total_reviews,
                listener_id
            ]
        );

        await client.query("COMMIT");

        return res.status(200).json({
            status: true,
            message: "Review submitted successfully.",
            data: {
                rating: Number(stats[0].rating),
                total_reviews: Number(stats[0].total_reviews)
            }
        });

    } catch (error) {

        await client.query("ROLLBACK");

        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });

    } finally {

        client.release();

    }
});
//post /api/update-name 
router.post('/update-name', auth, async (req, res) => {
    try {

        const user_id = req.user.id;
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(200).json({
                status: false,
                message: "Name is required."
            });
        }

        if (name.trim().length < 2) {
            return res.status(200).json({
                status: false,
                message: "Name must be at least 2 characters."
            });
        }

        const { rows } = await pool.query(
            `UPDATE users
             SET
                name = $1,
                updated_at = NOW()
             WHERE id = $2
             RETURNING id, name, email, phone, profile_photo`,
            [name.trim(), user_id]
        );

        if (rows.length === 0) {
            return res.status(200).json({
                status: false,
                message: "User not found."
            });
        }

        const user = rows[0];

        if (user.profile_photo) {
            user.profile_photo = `${BASE_URL}/${user.profile_photo}`;
        }

        return res.status(200).json({
            status: true,
            message: "Name updated successfully.",
            data: user
        });

    } catch (error) {

        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });

    }
});
// GET /api/conversation/:id
router.get('/conversation/:id', auth, async (req, res) => {
    try {
        const user_id = req.user.id;
        const conversation_id = req.params.id;

        const { rows } = await pool.query(
            `SELECT
                uc.id,
                uc.started_at,
                uc.ended_at,

                CASE
                    WHEN uc.ended_at IS NULL THEN 0
                    ELSE ROUND(EXTRACT(EPOCH FROM (uc.ended_at - uc.started_at)) / 60)
                END AS minutes_used,

                uc.status,

                u.id AS listener_id,
                u.name AS listener_name,
                u.profile_photo,

                ld.rating,
                ld.primary_voice,
                ld.secondary_voice

            FROM user_conversations uc

            JOIN users u
                ON u.id = uc.listener_id

            LEFT JOIN listener_details ld
                ON ld.user_id = u.id

            WHERE
                uc.id = $1
                AND uc.user_id = $2`,
            [conversation_id, user_id]
        );

        if (rows.length === 0) {
            return res.status(200).json({
                status: false,
                message: "Conversation not found."
            });
        }

        const conversation = rows[0];
        const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";

        if (conversation.profile_photo) {
            conversation.profile_photo = `${BASE_URL}/${conversation.profile_photo}`;
        }

        if (conversation.primary_voice) {
            conversation.primary_voice = `${BASE_URL}/${conversation.primary_voice}`;
        }

        if (conversation.secondary_voice) {
            conversation.secondary_voice = `${BASE_URL}/${conversation.secondary_voice}`;
        }

        // Fetch Reviews
        const { rows: reviews } = await pool.query(
            `SELECT
                lr.id,
                lr.rating,
                lr.review,
                lr.created_at,
                u.id AS user_id,
                u.name,
                u.profile_photo
            FROM listener_reviews lr
            JOIN users u ON u.id = lr.user_id
            WHERE lr.listener_id = $1
            ORDER BY lr.created_at DESC`,
            [conversation.listener_id]
        );

        if (reviews.length > 0) {
            reviews.forEach(review => {
                if (review.profile_photo) {
                    review.profile_photo = `${BASE_URL}/${review.profile_photo}`;
                }
            });
        }
        conversation.reviews = reviews;
        // The frontend might use 'what_callers_say' for the reviews section
        //conversation.what_callers_say = reviews.map(r => r.review).filter(r => r).slice(0, 5);

        // Fetch Similar Listeners (Random 5 listeners)
        const { rows: similarListeners } = await pool.query(
            `SELECT
                u.id,
                u.name,
                u.profile_photo,
                ld.rating,
                ld.is_verified,
                ld.tagline
            FROM users u
            JOIN listener_details ld ON ld.user_id = u.id
            WHERE u.user_type = 'listener' AND u.id != $1
            ORDER BY RANDOM()
            LIMIT 5`,
            [conversation.listener_id]
        );

        if (similarListeners.length > 0) {
            similarListeners.forEach(listener => {
                if (listener.profile_photo) {
                    listener.profile_photo = `${BASE_URL}/${listener.profile_photo}`;
                }
            });
        }
        conversation.similar_listeners = similarListeners;

        return res.status(200).json({
            status: true,
            message: "Conversation details fetched successfully.",
            data: conversation
        });

    } catch (error) {

        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });

    }
});
// GET /api/listener-reviews/:listener_id
router.get('/listener-reviews/:listener_id', auth, async (req, res) => {
    try {

        const listener_id = req.params.listener_id;

        const { rows } = await pool.query(
            `SELECT
                lr.id,
                lr.rating,
                lr.review,
                lr.created_at,

                u.id AS user_id,
                u.name,
                u.profile_photo

            FROM listener_reviews lr

            JOIN users u
                ON u.id = lr.user_id

            WHERE lr.listener_id = $1

            ORDER BY lr.created_at DESC`,
            [listener_id]
        );

        const reviews = rows.map(review => ({

            ...review,

            profile_photo: review.profile_photo
                ? `${BASE_URL}/${review.profile_photo}`
                : null

        }));

        return res.status(200).json({
            status: true,
            message: "Listener reviews fetched successfully.",
            total_reviews: reviews.length,
            data: reviews
        });

    } catch (error) {

        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });

    }
});

//_______________________________________________________________________________________

//post all 3 at a time /api/update-all-notification-settings 
router.post('/update-all-notification-settings', auth, async (req, res) => {
    try {

        const user_id = req.user.id;

        const {
            saved_listener_online,
            checkin_reminders,
            product_updates
        } = req.body;

        if (
            saved_listener_online === undefined ||
            checkin_reminders === undefined ||
            product_updates === undefined
        ) {
            return res.status(200).json({
                status: false,
                message: "All notification settings are required."
            });
        }

        // Check if row exists
        const { rows } = await pool.query(
            `SELECT id
             FROM notification_settings
             WHERE user_id = $1`,
            [user_id]
        );

        if (rows.length === 0) {

            await pool.query(
                `INSERT INTO notification_settings
                (
                    user_id,
                    saved_listener_online,
                    checkin_reminders,
                    product_updates
                )
                VALUES
                ($1,$2,$3,$4)`,
                [
                    user_id,
                    saved_listener_online,
                    checkin_reminders,
                    product_updates
                ]
            );

        } else {

            await pool.query(
                `UPDATE notification_settings
                 SET
                    saved_listener_online = $1,
                    checkin_reminders = $2,
                    product_updates = $3,
                    updated_at = NOW()
                 WHERE user_id = $4`,
                [
                    saved_listener_online,
                    checkin_reminders,
                    product_updates,
                    user_id
                ]
            );
        }

        const { rows: updated } = await pool.query(
            `SELECT
                saved_listener_online,
                checkin_reminders,
                product_updates
             FROM notification_settings
             WHERE user_id = $1`,
            [user_id]
        );

        return res.status(200).json({
            status: true,
            message: "Notification settings updated successfully.",
            data: updated[0]
        });

    } catch (error) {

        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });

    }
});
//POST /api/save-listener
router.post('/save-listener', auth, async (req, res) => {
    try {
        const user_id = req.user.id;
        const { listener_id } = req.body;

        if (!listener_id) {
            return res.status(200).json({
                status: false,
                message: "listener_id is required."
            });
        }

        // Check listener exists
        const { rows: listener } = await pool.query(
            `SELECT id
             FROM users
             WHERE id = $1
             AND user_type = 'listener'`,
            [listener_id]
        );

        if (listener.length === 0) {
            return res.status(200).json({
                status: false,
                message: "Listener not found."
            });
        }

        // Already saved?
        const { rows: existing } = await pool.query(
            `SELECT id
             FROM saved_listeners
             WHERE user_id = $1
             AND listener_id = $2`,
            [user_id, listener_id]
        );

        if (existing.length > 0) {
            return res.status(200).json({
                status: false,
                message: "Listener already saved."
            });
        }

        await pool.query(
            `INSERT INTO saved_listeners
            (user_id, listener_id)
            VALUES ($1,$2)`,
            [user_id, listener_id]
        );

        res.status(200).json({
            status: true,
            message: "Listener saved successfully."
        });

    } catch (error) {
        console.error(error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});
//DELETE /api/remove-saved-listener
router.delete('/remove-saved-listener', auth, async (req, res) => {
    try {

        const user_id = req.user.id;
        const { listener_id } = req.body;

        const result = await pool.query(
            `DELETE FROM saved_listeners
             WHERE user_id=$1
             AND listener_id=$2`,
            [user_id, listener_id]
        );

        if (result.rowCount === 0) {
            return res.status(200).json({
                status: false,
                message: "Saved listener not found."
            });
        }

        res.status(200).json({
            status: true,
            message: "Listener removed successfully."
        });

    } catch (error) {

        console.error(error);

        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

module.exports = router;