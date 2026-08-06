const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { auth, verifyOtpToken } = require('../middleware/auth');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const upload = require('../middleware/upload');

// POST /api/apply-listener 
router.post('/apply-listener', upload.fields([{ name: 'profile_photo', maxCount: 1 }, { name: 'primary_voice', maxCount: 1 }, { name: 'secondary_voice', maxCount: 1 }]), async (req, res) => {
    try {

        const {
            full_name,
            current_location,
            home_country,
            university_email,
            vibe_id,
            profile_type,
            ready_to_start,
            premium_boost,
            code_of_conduct_agreed,
            bio
        } = req.body;

        if (!bio || bio.trim() === "") {
            return res.status(200).json({
                status: false,
                message: "bio is required."
            });
        }

        let interests = [];
            if (req.body.interests) {
                interests = JSON.parse(req.body.interests);
            }

        let languages = [];
        if (req.body.languages) {
            languages = JSON.parse(req.body.languages);
        }
        if (!full_name)
            return res.status(200).json({ status: false, message: "Full name is required." },200);
        if (!current_location)
            return res.status(200).json({ status: false, message: "Current location is required." },200);
        if (!home_country)
            return res.status(200).json({ status: false, message: "Home country is required." },200);
        if (!university_email)
            return res.status(200).json({ status: false, message: "university_email is required." },200);
        if (!vibe_id)
            return res.status(200).json({ status: false, message: "Vibe is required." },200);
        if (!profile_type)
            return res.status(200).json({ status: false, message: "Profile type is required." },200);
        if (!Array.isArray(languages) || languages.length == 0)
            return res.status(200).json({
                status: false,
                message: "Please select at least one language."
            },200);

        if (!Array.isArray(interests) || interests.length == 0)
            return res.status(200).json({
                status: false,
                message: "Please select at least one interest."
            },200);

        if (!vibe_id) {
            return res.status(200).json({
                status: false,
                message: "Please select a vibe."
            },200);
        }

        const { rows: vibe } = await pool.query(
            "SELECT id FROM vibes WHERE id = $1",
            [vibe_id]
        );

        if (vibe.length === 0) {
            return res.status(200).json({
                status: false,
                message: "Invalid vibe."
            },200);
        }

        let profilePhoto = null;
        let primaryVoice = null;
        let secondaryVoice = null;

        if (req.files?.profile_photo) {
            profilePhoto = req.files.profile_photo[0].filename;
        }
        if (req.files?.primary_voice) {
            primaryVoice = req.files.primary_voice[0].filename;
        }
        if (req.files?.secondary_voice) {
            secondaryVoice = req.files.secondary_voice[0].filename;
        }

        if (ready_to_start === undefined) {
            return res.status(200).json({
                status: false,
                message: "Please select whether you are ready to start."
            },200);
        }

        if (premium_boost === undefined) {
            return res.status(200).json({
                status: false,
                message: "Please choose whether to join the Premium Boost program."
            },200);
        }

        if (Number(code_of_conduct_agreed) !== 1) {
            return res.status(200).json({
                status: false,
                message: "You must agree to the Code of Conduct before submitting your application."
            },200);
        }
        // Check user by university email
        const { rows: users } = await pool.query(
            "SELECT id FROM users WHERE email = $1",
            [university_email]
        );
        let userId;
        if (users.length > 0) {
            userId = users[0].id;
            // Update existing user
            await pool.query(
                `UPDATE users
                SET
                    name = $1,
                    user_type = 'listener'
                WHERE id = $2`,
                [
                    full_name,
                    userId
                ]
            );
        } else {
            // Create new user
            const { rows: result } = await pool.query(
                `INSERT INTO users
                (
                    name,
                    email,
                    user_type,
                    email_verified
                )
                VALUES ($1,$2,$3,$4) RETURNING id`,
                [
                    full_name,
                    university_email,
                    'listener',
                    0
                ]
            );
            userId = result[0].id;
        }

        if (profile_type === 'photo' && profilePhoto) {
            await pool.query(
                `UPDATE users
                 SET profile_photo = $1
                 WHERE id = $2`,
                [profilePhoto, userId]
            );
        }

        // Save listener details
        await pool.query(`
            INSERT INTO listener_details
            (
                user_id,
                current_location,
                home_country,
                university_email,
                vibe_id,
                profile_type,
                primary_voice,
                secondary_voice,
                ready_to_start,
                premium_boost,
                code_of_conduct_agreed,
                bio,
                application_status
                
            )
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT (user_id) DO UPDATE SET
                current_location=EXCLUDED.current_location,
                home_country=EXCLUDED.home_country,
                university_email=EXCLUDED.university_email,
                vibe_id=EXCLUDED.vibe_id,
                profile_type=EXCLUDED.profile_type,
                primary_voice=EXCLUDED.primary_voice,
                secondary_voice=EXCLUDED.secondary_voice,
                ready_to_start=EXCLUDED.ready_to_start,
                premium_boost=EXCLUDED.premium_boost,
                code_of_conduct_agreed=EXCLUDED.code_of_conduct_agreed,
                bio=EXCLUDED.bio,
                application_status=EXCLUDED.application_status             
        `, [
            userId,
            current_location,
            home_country,
            university_email,
            vibe_id,
            profile_type,
            primaryVoice,
            secondaryVoice,
            ready_to_start,
            premium_boost,
            code_of_conduct_agreed,
            bio,
            '1'
        ]);

        // Save Languages

        await pool.query(
            "DELETE FROM listener_preferred_languages WHERE user_id=$1",
            [userId]
        );

        for (const language of languages) {

            await pool.query(`
                INSERT INTO listener_preferred_languages
                (user_id,language_id,fluency_level_id)
                VALUES($1,$2,$3)
            `, [
                userId,
                language.language_id,
                language.fluency_level_id
            ]);

        }

        // Save Interests

        await pool.query(
            "DELETE FROM listener_interests WHERE user_id = $1",
            [userId]
        );

        for (const interest_id of interests) {

            await pool.query(
                `INSERT INTO listener_interests
                (user_id, interest_id)
                VALUES ($1, $2)`,
                [
                    userId,
                    interest_id
                ]
            );

        }
       
        res.status(200).json({
            status: true,
            message: "Listener application submitted successfully."
        },200);

    } catch (error) {
        res.status(200).json({
            status: false,
            message: error.message
        },200);
    }
});
// GET /api/language-list
router.get('/language-list', async (req, res) => {
    try {

        const { rows: languages } = await pool.query(`
            SELECT
                id,
                language_name
            FROM languages
            ORDER BY language_name ASC
        `);

        res.status(200).json({
            status: true,
            message: 'Language list fetched successfully.',
            data: languages
        },200);

    } catch (error) {
        console.error('Language List Error:', error);

        res.status(200).json({
            status: false,
            message: error.message
        },200);
    }
});
// GET /api/fluency-level-list
router.get('/fluency-level-list', async (req, res) => {
    try {

        const { rows: levels } = await pool.query(`
            SELECT
                id,
                level_name
            FROM fluency_levels
            ORDER BY id ASC
        `);

        res.status(200).json({
            status: true,
            message: 'Fluency level list fetched successfully.',
            data: levels
        },200);

    } catch (error) {
        console.error('Fluency Level List Error:', error);

        res.status(200).json({
            status: false,
            message: error.message
        },200);
    }
});
// GET /api/listener-application/:user_id
router.get('/listener-application/:user_id', async (req, res) => {
    try {
        const { user_id } = req.params;
        // User + Listener Details
        const { rows: listener } = await pool.query(`
            SELECT
                u.id,
                u.name,
                u.email,
                u.phone,
                u.profile_photo,

                ld.current_location,
                ld.home_country,
                ld.university_email,
                ld.vibe_id,
                ld.profile_type,
                ld.primary_voice,
                ld.secondary_voice,
                ld.ready_to_start,
                ld.premium_boost,
                ld.code_of_conduct_agreed,
                ld.application_status,
                ld.profile_photo_status,
                ld.primary_voice_status,
                ld.secondary_voice_status

            FROM users u

            JOIN listener_details ld
                ON u.id = ld.user_id

            WHERE u.id = $1
        `, [user_id]);

        if (listener.length === 0) {
            return res.status(200).json({
                status: false,
                message: "Listener not found."
            },200);
        }

        // Languages
        const { rows: languages } = await pool.query(`
            SELECT
                ul.language_id,
                l.language_name AS language,
                ul.fluency_level_id,
                fl.level_name AS fluency

            FROM listener_preferred_languages ul

            JOIN languages l
                ON ul.language_id = l.id

            JOIN fluency_levels fl
                ON ul.fluency_level_id = fl.id

            WHERE ul.user_id = $1
        `, [user_id]);

        const BASE_URL = `${req.protocol}://${req.get('host')}`;
        const l = listener[0];
        if (l.profile_photo) l.profile_photo = `${BASE_URL}/uploads/${l.profile_photo}`;
        if (l.primary_voice) l.primary_voice = `${BASE_URL}/uploads/${l.primary_voice}`;
        if (l.secondary_voice) l.secondary_voice = `${BASE_URL}/uploads/${l.secondary_voice}`;
        l.languages = languages;

        // Interests from listener_interests table
        const { rows: interests } = await pool.query(`
            SELECT i.id, i.interest_name
            FROM listener_interests li
            JOIN interests i ON i.id = li.interest_id
            WHERE li.user_id = $1
            ORDER BY i.interest_name
        `, [user_id]);
        l.interests = interests;

        res.status(200).json({
            status: true,
            data: l
        },200);

    } catch (error) {

        res.status(200).json({
            status: false,
            message: error.message
        },200);

    }
});
// POST /api/listener-reupload
router.post('/listener-reupload', upload.fields([
    { name: 'profile_photo', maxCount: 1 },
    { name: 'primary_voice', maxCount: 1 },
    { name: 'secondary_voice', maxCount: 1 }
    ]),
    async (req, res) => {
        try {

            const { user_id } = req.body;

            if (!user_id) {
                return res.status(200).json({
                    status: false,
                    message: "User ID is required."
                },200);
            }

            const { rows } = await pool.query(
                `SELECT
                    profile_photo_status,
                    primary_voice_status,
                    secondary_voice_status
                 FROM listener_details
                 WHERE user_id = $1`,
                [user_id]
            );

            if (rows.length === 0) {
                return res.status(200).json({
                    status: false,
                    message: "Listener not found."
                },200);
            }

            const listener = rows[0];

            let updates = [];
            let params = [];

            // Profile Photo
            if (req.files?.profile_photo) {

                if (Number(listener.profile_photo_status) !== 2) {
                    return res.status(200).json({
                        status: false,
                        message: "Profile photo is not rejected."
                    },200);
                }

                updates.push("profile_photo = ?");
                params.push(req.files.profile_photo[0].filename);

                updates.push("profile_photo_status = false");
            }

            // Primary Voice
            if (req.files?.primary_voice) {

                if (Number(listener.primary_voice_status) !== 2) {
                    return res.status(200).json({
                        status: false,
                        message: "Primary voice is not rejected."
                    },200);
                }

                updates.push("primary_voice = ?");
                params.push(req.files.primary_voice[0].filename);

                updates.push("primary_voice_status = 0 ");
            }

            // Secondary Voice
            if (req.files?.secondary_voice) {

                if (Number(listener.secondary_voice_status) !== 2) {
                    return res.status(200).json({
                        status: false,
                        message: "Secondary voice is not rejected."
                    },200);
                }

                updates.push("secondary_voice = ?");
                params.push(req.files.secondary_voice[0].filename);

                updates.push("secondary_voice_status = 0");
            }

            if (updates.length === 0) {
                return res.status(200).json({
                    status: false,
                    message: "No rejected files uploaded."
                },200);
            }

            updates.push("application_status = 1");

            params.push(user_id);

            let queryStr = `UPDATE listener_details SET ${updates.join(", ")} WHERE user_id = ?`;
            let paramIndex = 1;
            queryStr = queryStr.replace(/\?/g, () => `$${paramIndex++}`);
            await pool.query(queryStr, params);

            res.status(200).json({
                status: true,
                message: "Files re-uploaded successfully. Waiting for admin approval."
            },200);

        } catch (error) {

            res.status(200).json({
                status: false,
                message: error.message
            },200);

        }
    }
);
// GET /api/profile
router.get('/profile', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        const { rows: users } = await pool.query(
            'SELECT id, name, email, phone, profile_photo, user_type FROM users WHERE id = $1',
            [user_id]
        );

        if (users.length === 0) return res.status(200).json({ status: false, message: 'User not found.' },200);

        res.status(200).json({ status: true, data: users[0] },200);
    } catch (error) {
        res.status(200).json({ status: false, message: error.message },200);
    }
});
// POST /api/update-profile
router.post('/update-profile', auth, upload.single('profile_photo'), async (req, res) => {
    try {
        const user_id = req.user.id;
        const { name, phone } = req.body;

        let updates = [];
        let params = [];

        if (name) { updates.push('name = ?'); params.push(name); }
        if (phone) { updates.push('phone = ?'); params.push(phone); }
        if (req.file) { updates.push('profile_photo = ?'); params.push(req.file.filename); }

        if (updates.length === 0) return res.status(200).json({ status: false, message: 'No fields provided to update.' },200);

        params.push(user_id);
        let queryStr = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
        let paramIndex = 1;
        queryStr = queryStr.replace(/\?/g, () => `$${paramIndex++}`);
        await pool.query(queryStr, params);

        const { rows: updated } = await pool.query(
            'SELECT id, name, email, phone, profile_photo, user_type FROM users WHERE id = $1',
            [user_id]
        );

        const BASE_URL = `${req.protocol}://${req.get('host')}`;
        const profile = updated[0];
        if (profile.profile_photo) profile.profile_photo = `${BASE_URL}/uploads/${profile.profile_photo}`;

        res.status(200).json({ status: true, message: 'Profile updated successfully.', data: profile },200);
    } catch (error) {
        res.status(200).json({ status: false, message: error.message },200);
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// LISTENER SELF-SERVICE APIS
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/my-application
// Authenticated listener views their own application (no need to pass user_id in URL)
router.get('/my-application', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        const { rows: listener } = await pool.query(`
            SELECT
                u.id, u.name, u.email, u.phone, u.profile_photo,
                ld.current_location, ld.home_country, ld.university_email, ld.vibe_id,
                ld.profile_type, ld.primary_voice, ld.secondary_voice,
                ld.ready_to_start, ld.premium_boost, ld.code_of_conduct_agreed,
                ld.application_status, ld.profile_photo_status,
                ld.primary_voice_status, ld.secondary_voice_status
            FROM users u
            JOIN listener_details ld ON u.id = ld.user_id
            WHERE u.id = $1
        `, [user_id]);

        if (listener.length === 0)
            return res.status(200).json({ status: false, message: 'Application not found.' },200);

        const { rows: languages } = await pool.query(`
            SELECT ul.language_id, l.language_name AS language,
                   ul.fluency_level_id, fl.level_name AS fluency
            FROM listener_preferred_languages ul
            JOIN languages l  ON ul.language_id = l.id
            JOIN fluency_levels fl ON ul.fluency_level_id = fl.id
            WHERE ul.user_id = $1
        `, [user_id]);

        const BASE_URL = `${req.protocol}://${req.get('host')}`;
        const l = listener[0];
        if (l.profile_photo) l.profile_photo = `${BASE_URL}/uploads/${l.profile_photo}`;
        if (l.primary_voice) l.primary_voice = `${BASE_URL}/uploads/${l.primary_voice}`;
        if (l.secondary_voice) l.secondary_voice = `${BASE_URL}/uploads/${l.secondary_voice}`;
        l.languages = languages;

        // Interests from listener_interests table
        const { rows: interests } = await pool.query(`
            SELECT i.id, i.interest_name
            FROM listener_interests li
            JOIN interests i ON i.id = li.interest_id
            WHERE li.user_id = $1
            ORDER BY i.interest_name
        `, [user_id]);
        l.interests = interests;

        res.status(200).json({ status: true, data: l },200);
    } catch (error) {
        res.status(200).json({ status: false, message: error.message },200);
    }
});
// POST /api/change-password
// Authenticated user changes their own password
// Body: { current_password, new_password, confirm_password }
router.post('/change-password', auth, async (req, res) => {
    try {
        const { current_password, new_password, confirm_password } = req.body;

        if (!current_password || !new_password || !confirm_password)
            return res.status(200).json({ status: false, message: 'current_password, new_password, and confirm_password are required.' },200);

        if (new_password !== confirm_password)
            return res.status(200).json({ status: false, message: 'new_password and confirm_password do not match.' },200);

        if (new_password.length < 6)
            return res.status(200).json({ status: false, message: 'New password must be at least 6 characters.' },200);

        const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        if (rows.length === 0 || !rows[0].password)
            return res.status(200).json({ status: false, message: 'User not found or no password set.' },200);

        const isMatch = await bcrypt.compare(current_password, rows[0].password);
        if (!isMatch)
            return res.status(200).json({ status: false, message: 'Current password is incorrect.' },200);

        const hashed = await bcrypt.hash(new_password, 12);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.user.id]);

        res.status(200).json({ status: true, message: 'Password changed successfully.' },200);
    } catch (error) {
        res.status(200).json({ status: false, message: error.message },200);
    }
});
// POST /api/withdraw-application
// Authenticated listener withdraws/cancels their pending application
// Only allowed if application_status = 1 (submitted/pending)
router.post('/withdraw-application', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        const { rows } = await pool.query(
            'SELECT application_status FROM listener_details WHERE user_id = $1',
            [user_id]
        );

        if (rows.length === 0)
            return res.status(200).json({ status: false, message: 'No application found.' },200);

        if (Number(rows[0].application_status) !== 1)
            return res.status(200).json({ status: false, message: 'Only pending (submitted) applications can be withdrawn.' },200);

        // Delete listener_details, languages, and reset user_type back to 'user'
        await pool.query('DELETE FROM listener_details WHERE user_id = $1', [user_id]);
        await pool.query('DELETE FROM listener_preferred_languages WHERE user_id = $1', [user_id]);
        await pool.query(`UPDATE users SET user_type = 'user' WHERE id = $1`, [user_id]);

        res.status(200).json({ status: true, message: 'Application withdrawn successfully.' },200);
    } catch (error) {
        res.status(200).json({ status: false, message: error.message },200);
    }
});
// POST /api/update-languages
// Authenticated listener updates only their language preferences (no full reapplication needed)
// Body: { languages: [{ language_id, fluency_level_id }, ...] }
router.post('/update-languages', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        let languages = [];
        try { languages = JSON.parse(req.body.languages || '[]'); } catch (_) { languages = req.body.languages || []; }

        if (!Array.isArray(languages) || languages.length === 0)
            return res.status(200).json({ status: false, message: 'At least one language is required.' },200);

        const { rows } = await pool.query('SELECT user_id FROM listener_details WHERE user_id = $1', [user_id]);
        if (rows.length === 0)
            return res.status(200).json({ status: false, message: 'Listener application not found.' },200);

        await pool.query('DELETE FROM listener_preferred_languages WHERE user_id = $1', [user_id]);
        for (const lang of languages) {
            await pool.query(
                'INSERT INTO listener_preferred_languages (user_id, language_id, fluency_level_id) VALUES ($1, $2, $3)',
                [user_id, lang.language_id, lang.fluency_level_id]
            );
        }

        res.status(200).json({ status: true, message: 'Languages updated successfully.' },200);
    } catch (error) {
        res.status(200).json({ status: false, message: error.message },200);
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD FLOW (no auth required)
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/forgot-password
// Send a 6-digit OTP to the email for password reset
// Body: { email }
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email)
            return res.status(200).json({ status: false, message: 'Email is required.' });

        const { rows: users } = await pool.query('SELECT id FROM users WHERE email = $1 AND password IS NOT NULL', [email]);
        if (users.length === 0)
            return res.status(200).json({ status: false, message: 'No account found with this email.' });

        const otp = Math.floor(100000 + Math.random() * 900000);
        await pool.query('UPDATE users SET otp = $1 WHERE email = $2', [otp, email]);

        // TODO: Send OTP to email
        res.status(200).json({ status: true, message: 'Password reset OTP sent to your email.', otp }); // remove otp in production
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});
// POST /api/verify-forgot-otp
// Verify OTP and get a short-lived reset token
// Body: { email, otp }
router.post('/verify-forgot-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp)
            return res.status(200).json({ status: false, message: 'Email and OTP are required.' });

        const { rows: users } = await pool.query('SELECT id, otp FROM users WHERE email = $1', [email]);
        if (users.length === 0)
            return res.status(200).json({ status: false, message: 'User not found.' });

        if (String(users[0].otp) !== String(otp))
            return res.status(200).json({ status: false, message: 'Invalid OTP.' });

        await pool.query('UPDATE users SET otp = NULL WHERE id = $1', [users[0].id]);

        // Issue a short-lived reset token (10 min)
        const resetToken = jwt.sign(
            { userId: users[0].id, type: 'reset' },
            process.env.JWT_SECRET,
            { expiresIn: '10m' }
        );

        res.status(200).json({ status: true, message: 'OTP verified.', reset_token: resetToken });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});
// POST /api/reset-password
// Set new password using the reset_token obtained from verify-forgot-otp
// Body: { new_password, confirm_password }  — Bearer: reset_token
router.post('/reset-password', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer '))
            return res.status(200).json({ status: false, message: 'Reset token is required.' });

        const token = authHeader.split(' ')[1];
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (_) {
            return res.status(200).json({ status: false, message: 'Invalid or expired reset token.' });
        }

        if (decoded.type !== 'reset')
            return res.status(200).json({ status: false, message: 'Invalid token type.' });

        const { new_password, confirm_password } = req.body;
        if (!new_password || !confirm_password)
            return res.status(200).json({ status: false, message: 'new_password and confirm_password are required.' });

        if (new_password !== confirm_password)
            return res.status(200).json({ status: false, message: 'Passwords do not match.' });

        if (new_password.length < 6)
            return res.status(200).json({ status: false, message: 'Password must be at least 6 characters.' });

        const hashed = await bcrypt.hash(new_password, 12);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, decoded.userId]);

        res.status(200).json({ status: true, message: 'Password reset successfully. You can now log in.' });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/delete-account
// Authenticated listener permanently deletes their own account
// Body: { password }  — requires password confirmation for safety
router.post('/delete-account', auth, async (req, res) => {
    try {
        const user_id = req.user.id;
        const { password } = req.body;

        if (!password)
            return res.status(200).json({ status: false, message: 'Password confirmation is required.' });

        const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [user_id]);
        if (rows.length === 0)
            return res.status(200).json({ status: false, message: 'User not found.' });

        const isMatch = await bcrypt.compare(password, rows[0].password);
        if (!isMatch)
            return res.status(200).json({ status: false, message: 'Incorrect password.' });

        await pool.query('DELETE FROM listener_details WHERE user_id = $1', [user_id]);
        await pool.query('DELETE FROM listener_preferred_languages WHERE user_id = $1', [user_id]);
        await pool.query('DELETE FROM blacklisted_tokens WHERE token IN (SELECT token FROM blacklisted_tokens)', []);
        await pool.query('DELETE FROM users WHERE id = $1', [user_id]);

        res.status(200).json({ status: true, message: 'Account deleted successfully.' });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/listener-login
// Authenticate listener via email/phone and password, and return user & application details
router.post('/listener-login', async (req, res) => {
    try {
        const { email, phone, password } = req.body;

        if ((!email && !phone) || !password) {
            return res.status(200).json({
                status: false,
                message: 'Email or Phone, and Password are required.'
            });
        }

        let user;
        if (email) {
            const cleanEmail = email.trim().toLowerCase();
            const { rows: users } = await pool.query(
                'SELECT * FROM users WHERE email = $1 LIMIT 1',
                [cleanEmail]
            );
            if (users.length === 0) {
                return res.status(200).json({
                    status: false,
                    message: 'Listener account not found.'
                });
            }
            user = users[0];
        } else {
            const cleanPhone = phone.trim();
            const { rows: users } = await pool.query(
                'SELECT * FROM users WHERE phone = $1 LIMIT 1',
                [cleanPhone]
            );
            if (users.length === 0) {
                return res.status(200).json({
                    status: false,
                    message: 'Listener account not found.'
                });
            }
            user = users[0];
        }

        // Verify password
        if (!user.password) {
            return res.status(200).json({
                status: false,
                message: 'Password not set for this account.'
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(200).json({
                status: false,
                message: 'Invalid password.'
            });
        }

        // Ensure user type is listener
        if (user.user_type !== 'listener') {
            return res.status(200).json({
                status: false,
                message: 'This account is not registered as a listener.'
            });
        }

        // Fetch listener details
        const { rows: listenerDetails } = await pool.query(
            'SELECT * FROM listener_details WHERE user_id = $1 LIMIT 1',
            [user.id]
        );

        let listener = null;
        if (listenerDetails.length > 0) {
            listener = { ...listenerDetails[0] };
            const BASE_URL = `${req.protocol}://${req.get('host')}`;
            if (listener.profile_photo) listener.profile_photo = `${BASE_URL}/uploads/${listener.profile_photo}`;
            if (listener.primary_voice) listener.primary_voice = `${BASE_URL}/uploads/${listener.primary_voice}`;
            if (listener.secondary_voice) listener.secondary_voice = `${BASE_URL}/uploads/${listener.secondary_voice}`;
        }

        // Generate Access Token
        const token = jwt.sign(
            {
                userId: user.id,
                user_type: user.user_type
            },
            process.env.JWT_SECRET,
            {
                expiresIn: '30d'
            }
        );

        const BASE_URL = `${req.protocol}://${req.get('host')}`;
        res.status(200).json({
            status: true,
            message: 'Login successful.',
            access_token: token,
            token_type: 'Bearer',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                user_type: user.user_type,
                profile_photo: user.profile_photo ? `${BASE_URL}/uploads/${user.profile_photo}` : null
            },
            listener_details: listener
        });

    } catch (error) {
        console.error('Listener Login Error:', error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

module.exports = router;

