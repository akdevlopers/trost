const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { auth, verifyOtpToken } = require('../middleware/auth');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const upload = require('../middleware/upload');
const { sendOtpEmail } = require('../utils/email');

// POST /api/apply-listener 
router.post('/apply-listener', upload.fields([{ name: 'profile_photo', maxCount: 1 }, { name: 'primary_voice', maxCount: 1 }, { name: 'secondary_voice', maxCount: 1 }]), async (req, res) => {
    try {

        const {
            full_name,
            current_location,
            home_country,
            university_email,
            phone,
            vibe_id,
            profile_type,
            ready_to_start,
            premium_boost,
            code_of_conduct_agreed,
            bio,
            password
        } = req.body;

        if (university_email) {
            const cleanEmail = university_email.trim().toLowerCase();
            const { rows: users } = await pool.query(
                "SELECT id, user_type, password FROM users WHERE email = $1",
                [cleanEmail]
            );
            if (users.length > 0) {
                const existingUser = users[0];
                if (existingUser.password && existingUser.user_type === 'user') {
                    return res.status(200).json({
                        status: false,
                        message: "This email is already registered as a user."
                    }, 200);
                }
            }
        }

        if (!phone || phone.trim() === "") {
            return res.status(200).json({ status: false, message: "Phone number is required." }, 200);
        }

        const cleanPhone = phone.trim();
        const { rows: existingPhone } = await pool.query(
            "SELECT id FROM users WHERE phone = $1 AND email <> $2",
            [cleanPhone, university_email ? university_email.trim().toLowerCase() : '']
        );
        if (existingPhone.length > 0) {
            return res.status(200).json({
                status: false,
                message: "Phone number already exists."
            }, 200);
        }

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
            return res.status(200).json({ status: false, message: "Full name is required." }, 200);
        if (!current_location)
            return res.status(200).json({ status: false, message: "Current location is required." }, 200);
        if (!home_country)
            return res.status(200).json({ status: false, message: "Home country is required." }, 200);
        if (!university_email)
            return res.status(200).json({ status: false, message: "university_email is required." }, 200);
        if (!password)
            return res.status(200).json({ status: false, message: "Password is required." }, 200);
        if (password.length < 6)
            return res.status(200).json({ status: false, message: "Password must be at least 6 characters." }, 200);
        if (!vibe_id)
            return res.status(200).json({ status: false, message: "Vibe is required." }, 200);
        if (!profile_type)
            return res.status(200).json({ status: false, message: "Profile type is required." }, 200);
        if (!Array.isArray(languages) || languages.length == 0)
            return res.status(200).json({
                status: false,
                message: "Please select at least one language."
            }, 200);

        if (!Array.isArray(interests) || interests.length == 0)
            return res.status(200).json({
                status: false,
                message: "Please select at least one interest."
            }, 200);

        if (!vibe_id) {
            return res.status(200).json({
                status: false,
                message: "Please select a vibe."
            }, 200);
        }

        const { rows: vibe } = await pool.query(
            "SELECT id FROM vibes WHERE id = $1",
            [vibe_id]
        );

        if (vibe.length === 0) {
            return res.status(200).json({
                status: false,
                message: "Invalid vibe."
            }, 200);
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
            }, 200);
        }

        if (premium_boost === undefined) {
            return res.status(200).json({
                status: false,
                message: "Please choose whether to join the Premium Boost program."
            }, 200);
        }

        if (Number(code_of_conduct_agreed) !== 1) {
            return res.status(200).json({
                status: false,
                message: "You must agree to the Code of Conduct before submitting your application."
            }, 200);
        }
        // Check if university email is verified in users table
        const { rows: verificationCheck } = await pool.query(
            "SELECT email_verified FROM users WHERE email = $1",
            [university_email]
        );

        if (verificationCheck.length === 0 || !verificationCheck[0].email_verified) {
            return res.status(200).json({
                status: false,
                message: "Please verify your email before submitting the application."
            }, 200);
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Check user by university email
        const { rows: users } = await pool.query(
            "SELECT id, user_type, password FROM users WHERE email = $1",
            [university_email]
        );
        let userId;
        if (users.length > 0) {
            const existingUser = users[0];
            if (existingUser.password && existingUser.user_type === 'user') {
                return res.status(200).json({
                    status: false,
                    message: "This email is already registered as a user."
                }, 200);
            }
            userId = existingUser.id;
            // Update existing user including password and phone
            await pool.query(
                `UPDATE users
                SET
                    name = $1,
                    user_type = 'listener',
                    password = $2,
                    phone = $3
                WHERE id = $4`,
                [
                    full_name,
                    hashedPassword,
                    cleanPhone,
                    userId
                ]
            );
        } else {
            // Create new user with password and phone
            const { rows: result } = await pool.query(
                `INSERT INTO users
                (
                    name,
                    email,
                    phone,
                    user_type,
                    email_verified,
                    password
                )
                VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
                [
                    full_name,
                    university_email,
                    cleanPhone,
                    'listener',
                    0,
                    hashedPassword
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

        // Send Pending Review Email in the background
        const { sendPendingReviewEmail } = require('../utils/email');
        sendPendingReviewEmail(university_email, full_name)
            .catch(err => console.error("Failed to send pending review email to listener:", err));

        // Track Listener Registration & Voice Submission events
        const { trackRegistration, trackVoiceSubmission } = require('../utils/analytics');
        const listenerObj = {
            id: userId,
            name: full_name,
            email: university_email,
            phone: cleanPhone,
            user_type: 'listener'
        };
        trackRegistration(req, listenerObj).catch(err => console.error("GA4/Meta listener registration tracking failed:", err));
        trackVoiceSubmission(req, listenerObj, {
            primary_voice: primaryVoice,
            secondary_voice: secondaryVoice
        }).catch(err => console.error("GA4/Meta voice submission tracking failed:", err));

        res.status(200).json({
            status: true,
            message: "Listener application submitted successfully."
        }, 200);

    } catch (error) {
        res.status(200).json({
            status: false,
            message: error.message
        }, 200);
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
        }, 200);

    } catch (error) {
        console.error('Language List Error:', error);

        res.status(200).json({
            status: false,
            message: error.message
        }, 200);
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
        }, 200);

    } catch (error) {
        console.error('Fluency Level List Error:', error);

        res.status(200).json({
            status: false,
            message: error.message
        }, 200);
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
            return res.status(401).json({
                status: false,
                message: "Listener not found."
            });
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
        }, 200);

    } catch (error) {

        res.status(200).json({
            status: false,
            message: error.message
        }, 200);

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
                }, 200);
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
                return res.status(401).json({
                    status: false,
                    message: "Listener not found."
                });
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
                    }, 200);
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
                    }, 200);
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
                    }, 200);
                }

                updates.push("secondary_voice = ?");
                params.push(req.files.secondary_voice[0].filename);

                updates.push("secondary_voice_status = 0");
            }

            if (updates.length === 0) {
                return res.status(200).json({
                    status: false,
                    message: "No rejected files uploaded."
                }, 200);
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
            }, 200);

        } catch (error) {

            res.status(200).json({
                status: false,
                message: error.message
            }, 200);

        }
    }
);
// POST /api/listener/reupload-rejected
// Reupload media files (profile photo, primary voice, secondary voice) for a rejected listener
router.post('/listener/reupload-rejected', auth, upload.fields([
    { name: 'profile_photo', maxCount: 1 },
    { name: 'primary_voice', maxCount: 1 },
    { name: 'secondary_voice', maxCount: 1 }
]), async (req, res) => {
    try {
        const user_id = req.user.id;

        if (req.user.user_type !== 'listener') {
            return res.status(401).json({
                status: false,
                message: "Access denied. Listener permissions required."
            });
        }

        // Fetch listener details to verify they are rejected
        const { rows } = await pool.query(
            `SELECT application_status, profile_photo_status, primary_voice_status, secondary_voice_status 
             FROM listener_details 
             WHERE user_id = $1`,
            [user_id]
        );

        if (rows.length === 0) {
            return res.status(200).json({
                status: false,
                message: "Listener details not found."
            });
        }

        const listener = rows[0];

        // The vendor is rejected if application_status is 3, or if any of the media statuses are 2 (rejected)
        if (Number(listener.application_status) !== 3 &&
            Number(listener.profile_photo_status) !== 2 &&
            Number(listener.primary_voice_status) !== 2 &&
            Number(listener.secondary_voice_status) !== 2) {
            return res.status(200).json({
                status: false,
                message: "This account or its media files are not rejected."
            });
        }

        let updates = [];
        let params = [];
        let paramIndex = 1;

        // Profile Photo
        if (req.files?.profile_photo) {
            const profilePhotoFilename = req.files.profile_photo[0].filename;

            // Update users table
            await pool.query(
                `UPDATE users SET profile_photo = $1 WHERE id = $2`,
                [profilePhotoFilename, user_id]
            );

            // Attempt to update profile_photo inside listener_details as well (safeguard)
            try {
                await pool.query(
                    `UPDATE listener_details SET profile_photo = $1 WHERE user_id = $2`,
                    [profilePhotoFilename, user_id]
                );
            } catch (err) {
                console.warn("Could not update profile_photo in listener_details, skipping:", err.message);
            }

            updates.push(`profile_photo_status = 0`);
        }

        // Primary Voice
        if (req.files?.primary_voice) {
            const primaryVoiceFilename = req.files.primary_voice[0].filename;
            updates.push(`primary_voice = $${paramIndex++}`);
            params.push(primaryVoiceFilename);
            updates.push(`primary_voice_status = 0`);
        }

        // Secondary Voice
        if (req.files?.secondary_voice) {
            const secondaryVoiceFilename = req.files.secondary_voice[0].filename;
            updates.push(`secondary_voice = $${paramIndex++}`);
            params.push(secondaryVoiceFilename);
            updates.push(`secondary_voice_status = 0`);
        }

        if (updates.length === 0) {
            return res.status(200).json({
                status: false,
                message: "No files uploaded to update."
            });
        }

        // Reset application status to 1 (pending review)
        updates.push(`application_status = 1`);

        params.push(user_id);
        const queryStr = `UPDATE listener_details SET ${updates.join(', ')} WHERE user_id = $${paramIndex}`;
        await pool.query(queryStr, params);

        res.status(200).json({
            status: true,
            message: "Reuploaded successfully. Application status is now pending review."
        });

    } catch (error) {
        console.error("Reupload rejected error:", error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// GET /api/profile
router.get('/profile', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        const { rows: users } = await pool.query(
            'SELECT id, name, email, phone, profile_photo, user_type FROM users WHERE id = $1',
            [user_id]
        );

        if (users.length === 0) return res.status(401).json({ status: false, message: 'User not found.' });

        res.status(200).json({ status: true, data: users[0] }, 200);
    } catch (error) {
        res.status(200).json({ status: false, message: error.message }, 200);
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

        if (updates.length === 0) return res.status(200).json({ status: false, message: 'No fields provided to update.' }, 200);

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

        res.status(200).json({ status: true, message: 'Profile updated successfully.', data: profile }, 200);
    } catch (error) {
        res.status(200).json({ status: false, message: error.message }, 200);
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
            return res.status(200).json({ status: false, message: 'Application not found.' }, 200);

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

        res.status(200).json({ status: true, data: l }, 200);
    } catch (error) {
        res.status(200).json({ status: false, message: error.message }, 200);
    }
});
// POST /api/change-password
// Authenticated user changes their own password
// Body: { current_password, new_password, confirm_password }
router.post('/change-password', auth, async (req, res) => {
    try {
        const { current_password, new_password, confirm_password } = req.body;

        if (!current_password || !new_password || !confirm_password)
            return res.status(200).json({ status: false, message: 'current_password, new_password, and confirm_password are required.' }, 200);

        if (new_password !== confirm_password)
            return res.status(200).json({ status: false, message: 'new_password and confirm_password do not match.' }, 200);

        if (new_password.length < 6)
            return res.status(200).json({ status: false, message: 'New password must be at least 6 characters.' }, 200);

        const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        if (rows.length === 0 || !rows[0].password)
            return res.status(401).json({ status: false, message: 'User not found or no password set.' });

        const isMatch = await bcrypt.compare(current_password, rows[0].password);
        if (!isMatch)
            return res.status(200).json({ status: false, message: 'Current password is incorrect.' }, 200);

        const hashed = await bcrypt.hash(new_password, 12);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.user.id]);

        res.status(200).json({ status: true, message: 'Password changed successfully.' }, 200);
    } catch (error) {
        res.status(200).json({ status: false, message: error.message }, 200);
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
            return res.status(200).json({ status: false, message: 'No application found.' }, 200);

        if (Number(rows[0].application_status) !== 1)
            return res.status(200).json({ status: false, message: 'Only pending (submitted) applications can be withdrawn.' }, 200);

        // Delete listener_details, languages, and reset user_type back to 'user'
        await pool.query('DELETE FROM listener_details WHERE user_id = $1', [user_id]);
        await pool.query('DELETE FROM listener_preferred_languages WHERE user_id = $1', [user_id]);
        await pool.query(`UPDATE users SET user_type = 'user' WHERE id = $1`, [user_id]);

        res.status(200).json({ status: true, message: 'Application withdrawn successfully.' }, 200);
    } catch (error) {
        res.status(200).json({ status: false, message: error.message }, 200);
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
            return res.status(200).json({ status: false, message: 'At least one language is required.' }, 200);

        const { rows } = await pool.query('SELECT user_id FROM listener_details WHERE user_id = $1', [user_id]);
        if (rows.length === 0)
            return res.status(200).json({ status: false, message: 'Listener application not found.' }, 200);

        await pool.query('DELETE FROM listener_preferred_languages WHERE user_id = $1', [user_id]);
        for (const lang of languages) {
            await pool.query(
                'INSERT INTO listener_preferred_languages (user_id, language_id, fluency_level_id) VALUES ($1, $2, $3)',
                [user_id, lang.language_id, lang.fluency_level_id]
            );
        }

        res.status(200).json({ status: true, message: 'Languages updated successfully.' }, 200);
    } catch (error) {
        res.status(200).json({ status: false, message: error.message }, 200);
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
        await pool.query('UPDATE users SET email_otp = $1, otp_created_at = NOW() WHERE email = $2', [otp, email]);

        // Send OTP to email in the background (non-blocking)
        sendOtpEmail(email, otp)
            .then(emailResult => {
                if (!emailResult.status) {
                    console.error(`Failed to send password reset OTP email to ${email}:`, emailResult.error);
                }
            })
            .catch(err => {
                console.error(`Unhandled error sending password reset OTP email to ${email}:`, err);
            });

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

        const { rows: users } = await pool.query('SELECT id, email_otp, otp_created_at FROM users WHERE email = $1', [email]);
        if (users.length === 0)
            return res.status(401).json({ status: false, message: 'User not found.' });

        if (String(users[0].email_otp) !== String(otp))
            return res.status(200).json({ status: false, message: 'Invalid OTP.' });

        // Check expiration (5 minutes)
        const otpTime = new Date(users[0].otp_created_at).getTime();
        const now = Date.now();
        if (now - otpTime > 5 * 60 * 1000) {
            return res.status(200).json({ status: false, message: 'OTP has expired. Please request a new OTP.' });
        }

        await pool.query('UPDATE users SET email_otp = NULL, otp_created_at = NULL WHERE id = $1', [users[0].id]);

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
            return res.status(401).json({ status: false, message: 'Reset token is required.' });

        const token = authHeader.split(' ')[1];
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (_) {
            return res.status(401).json({ status: false, message: 'Invalid or expired reset token.' });
        }

        if (decoded.type !== 'reset')
            return res.status(401).json({ status: false, message: 'Invalid token type.' });

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
            return res.status(401).json({ status: false, message: 'User not found.' });

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
        const { email, phone, password } = req.body || {};

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
                return res.status(401).json({
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
                return res.status(401).json({
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
        let listenerStatus = 'pending';
        if (listenerDetails.length > 0) {
            listener = { ...listenerDetails[0] };
            const BASE_URL = `${req.protocol}://${req.get('host')}`;
            if (listener.profile_photo) listener.profile_photo = `${BASE_URL}/uploads/${listener.profile_photo}`;
            if (listener.primary_voice) listener.primary_voice = `${BASE_URL}/uploads/${listener.primary_voice}`;
            if (listener.secondary_voice) listener.secondary_voice = `${BASE_URL}/uploads/${listener.secondary_voice}`;

            const appStatus = Number(listener.application_status);
            if (appStatus === 2) {
                listenerStatus = 'approve';
            } else if (appStatus === 3) {
                listenerStatus = 'reject';
            } else {
                listenerStatus = 'pending';
            }
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
            listener_status: listenerStatus,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                user_type: user.user_type,
                profile_photo: user.profile_photo ? `${BASE_URL}/uploads/${user.profile_photo}` : null,
                listener_status: listenerStatus
            },
            listener_details: listener ? {
                ...listener,
                listener_status: listenerStatus
            } : null
        });

    } catch (error) {
        console.error('Listener Login Error:', error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// GET /api/listener/dashboard
// Get aggregated dashboard stats, weekly summaries, incoming call queue, plan details, sessions, and reviews
router.post('/listener/dashboard', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        // Ensure user is listener
        if (req.user.user_type !== 'listener') {
            return res.status(401).json({
                status: false,
                message: 'Access denied. Listener permissions required.'
            });
        }

        // 1. Fetch listener details
        const { rows: listenerRows } = await pool.query(
            'SELECT rating, total_reviews, total_calls, call_price, unsettled_amount, settled_amount FROM listener_details WHERE user_id = $1 LIMIT 1',
            [user_id]
        );
        const listenerDetails = listenerRows[0] || {};
        const callPrice = Number(listenerDetails.call_price || 0.60); // default price per minute if not set

        // 2. Fetch today's completed calls from DB
        const { rows: todayCalls } = await pool.query(
            `SELECT ended_at, started_at
             FROM user_conversations
             WHERE listener_id = $1 
               AND status = 'completed'
               AND started_at >= CURRENT_DATE`,
            [user_id]
        );

        let dbSessionsToday = todayCalls.length;
        let dbMinutesListenedToday = 0;
        todayCalls.forEach(c => {
            if (c.ended_at && c.started_at) {
                dbMinutesListenedToday += Math.round((c.ended_at - c.started_at) / (1000 * 60));
            }
        });

        // 3. Fetch today's earnings from DB
        const { rows: todayEarningsRow } = await pool.query(
            `SELECT SUM(amount) AS total
             FROM minute_transactions
             WHERE listener_id = $1
               AND created_at >= CURRENT_DATE`,
            [user_id]
        );
        let dbEarnedToday = Number(todayEarningsRow[0]?.total || 0);

        // 4. Fetch caller reviews
        const { rows: dbReviews } = await pool.query(
            `SELECT rating, review, created_at, user_name
             FROM (
                 SELECT lr.rating, lr.review, lr.created_at, u.name AS user_name
                 FROM listener_reviews lr
                 JOIN users u ON u.id = lr.user_id
                 WHERE lr.listener_id = $1
                 
                 UNION ALL
                 
                 SELECT uc.rating, uc.review, uc.ended_at AS created_at, u.name AS user_name
                 FROM user_conversations uc
                 JOIN users u ON u.id = uc.user_id
                 WHERE uc.listener_id = $1 AND uc.rating IS NOT NULL AND uc.ended_at IS NOT NULL
             ) combined
             ORDER BY created_at DESC
             LIMIT 10`,
            [user_id]
        );

        // 5. Fetch completed sessions
        const { rows: dbSessions } = await pool.query(
            `SELECT uc.id, uc.room_id, uc.started_at, uc.ended_at, u.name AS user_name, uc.rating, uc.review
             FROM user_conversations uc
             JOIN users u ON uc.user_id = u.id
             WHERE uc.listener_id = $1 AND uc.status = 'completed'
             ORDER BY uc.started_at DESC
             LIMIT 10`,
            [user_id]
        );

        // Helper function for next Friday
        const getNextFriday = () => {
            const d = new Date();
            const day = d.getDay();
            const diff = (5 - day + 7) % 7 || 7;
            d.setDate(d.getDate() + diff);
            return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        };

        // Helper function for auto-renew date (1 month from now)
        const getAutoRenewDate = () => {
            const d = new Date();
            d.setMonth(d.getMonth() + 1);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        };

        const unsettledAmt = Number(listenerDetails.unsettled_amount || 0);
        const settledAmt = Number(listenerDetails.settled_amount || 0);

        // Formatting stats with real DB values
        const stats = {
            earned_today: `$${dbEarnedToday.toFixed(2)}`,
            earned_today_trend: dbEarnedToday > 0 ? "+100%" : "0%",
            sessions_today: dbSessionsToday,
            sessions_today_trend: dbSessionsToday > 0 ? `+${dbSessionsToday} calls` : "0 calls",
            minutes_listened_today: `${dbMinutesListenedToday} m`,
            minutes_listened_today_trend: `+${dbMinutesListenedToday} min`,
            avg_rating: Number(listenerDetails.rating || 0).toFixed(1),
            total_reviews: parseInt(listenerDetails.total_reviews || 0),
            unsettled_amount: unsettledAmt.toFixed(2),
            settled_amount: settledAmt.toFixed(2),
            total_earnings: (unsettledAmt + settledAmt).toFixed(2)
        };

        // Fetch call queue dynamically from DB
        const { rows: queueRows } = await pool.query(
            `SELECT uc.id, uc.room_id, uc.created_at, uc.started_at, u.name AS user_name
             FROM user_conversations uc
             JOIN users u ON uc.user_id = u.id
             WHERE (uc.listener_id = $1 OR uc.listener_id IS NULL)
               AND uc.status IN ('pending', 'waiting', 'requested', 'calling')
               AND uc.ended_at IS NULL
             ORDER BY uc.created_at ASC`,
            [user_id]
        );

        let incomingCallQueue = queueRows.map(uc => {
            const timeSource = uc.created_at || uc.started_at || new Date();
            const diffSecs = Math.floor((Date.now() - new Date(timeSource)) / 1000);
            let waitTime = "Just now";
            if (diffSecs > 0) {
                if (diffSecs < 60) {
                    waitTime = `${diffSecs} sec ago`;
                } else {
                    const diffMins = Math.floor(diffSecs / 60);
                    if (diffMins < 60) {
                        waitTime = `${diffMins} min ago`;
                    } else {
                        const diffHours = Math.floor(diffMins / 60);
                        waitTime = `${diffHours} hr ago`;
                    }
                }
            }
            return {
                caller_id: `#${uc.id}`,
                conversation_id: uc.id,
                room_id: uc.room_id || null,
                caller_name: uc.user_name || `Caller #${uc.id}`,
                wait_time: waitTime,
                call_type: "Voice call",
                topic: "Support Call",
                tag: "Listener Call"
            };
        });

        // Weekly stats from DB (last 7 days)
        const { rows: weeklyCallsRow } = await pool.query(
            `SELECT COUNT(*) AS weekly_sessions,
                    COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at))/60), 0) AS weekly_minutes
             FROM user_conversations
             WHERE listener_id = $1 AND status = 'completed' AND started_at >= NOW() - INTERVAL '7 days'`,
            [user_id]
        );
        const { rows: weeklyEarningsRow } = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) AS weekly_total
             FROM call_earnings_logs
             WHERE listener_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`,
            [user_id]
        );
        const weeklyTotalEarned = Number(weeklyEarningsRow[0]?.weekly_total || 0);
        const weeklySessionsCount = parseInt(weeklyCallsRow[0]?.weekly_sessions || 0);
        const weeklyMinutesCount = Math.round(Number(weeklyCallsRow[0]?.weekly_minutes || 0));

        const weeklySummary = {
            weekly_total: `$${weeklyTotalEarned.toFixed(2)}`,
            next_payout_date: getNextFriday(),
            completed_sessions_count: weeklySessionsCount,
            hours_listened_count: `${(weeklyMinutesCount / 60).toFixed(1)}h`
        };

        // Subscription details
        const subscriptionPlan = {
            plan_name: "Listener Standard",
            price_detail: `Active · Next review ${getAutoRenewDate()}`,
            stability_rate: "100%"
        };

        // Completed sessions mapping
        const completedSessionsList = dbSessions.map(s => {
            const start = new Date(s.started_at);
            const durationMin = s.ended_at ? Math.round((new Date(s.ended_at) - start) / (1000 * 60)) : 0;
            const earnings = durationMin * callPrice;
            return {
                id: s.id,
                room_id: s.room_id || null,
                topic: s.review ? s.review.substring(0, 20) + "..." : "Support Session",
                time: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                rating: s.rating ? Number(s.rating).toFixed(1) : "0",
                duration: `${durationMin}m`,
                earnings: earnings > 0 ? `$${earnings.toFixed(2)}` : "$0.00"
            };
        });

        // Reviews mapping
        const callerReviewsList = dbReviews.map((r, index) => ({
            id: index + 1,
            user_name: r.user_name || "Anonymous",
            review_text: r.review || "No feedback text provided.",
            rating: Number(r.rating || 0).toFixed(1),
            topic: "General Support"
        }));

        res.status(200).json({
            status: true,
            message: "Dashboard data fetched successfully.",
            data: {
                stats,
                incoming_call_queue: incomingCallQueue,
                weekly_summary: weeklySummary,
                subscription_plan: subscriptionPlan,
                completed_sessions: completedSessionsList,
                caller_reviews: callerReviewsList
            }
        });

    } catch (error) {
        console.error('Listener Dashboard Error:', error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// GET /api/listener/calls-queue
// Get incoming calls queue, current availability status, and professional guidelines
router.post('/listener/calls-queue', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        // Ensure user is listener
        if (req.user.user_type !== 'listener') {
            return res.status(401).json({
                status: false,
                message: 'Access denied. Listener permissions required.'
            });
        }

        // Fetch listener online status
        const { rows } = await pool.query(
            'SELECT available_now FROM listener_details WHERE user_id = $1 LIMIT 1',
            [user_id]
        );
        const onlineStatus = rows.length > 0 ? !!rows[0].available_now : false;

        // Fetch call queue dynamically from DB
        const { rows: queueRows } = await pool.query(
            `SELECT uc.id, uc.room_id, uc.created_at, uc.started_at, u.name AS user_name
             FROM user_conversations uc
             JOIN users u ON uc.user_id = u.id
             WHERE (uc.listener_id = $1 OR uc.listener_id IS NULL)
               AND uc.status IN ('pending', 'waiting', 'requested', 'calling')
               AND uc.ended_at IS NULL
             ORDER BY uc.created_at ASC`,
            [user_id]
        );

        const topics = [
            "Anxiety & Overwhelm",
            "Loneliness & Isolation",
            "Work Burnout",
            "Relationship stress",
            "Grief & Loss",
            "Academic Stress"
        ];
        const tags = [
            "Gentle listener needed",
            "Warm chat",
            "Practical guidance",
            "Calm advice",
            "Friendly ear"
        ];

        let queue = [];
        if (queueRows.length > 0) {
            queue = queueRows.map(uc => {
                const timeSource = uc.created_at || uc.started_at || new Date();
                const diffSecs = Math.floor((Date.now() - new Date(timeSource)) / 1000);
                let waitTime = "Just now";
                if (diffSecs > 0) {
                    if (diffSecs < 60) {
                        waitTime = `${diffSecs} sec ago`;
                    } else {
                        const diffMins = Math.floor(diffSecs / 60);
                        if (diffMins < 60) {
                            waitTime = `${diffMins} min ago`;
                        } else {
                            const diffHours = Math.floor(diffMins / 60);
                            waitTime = `${diffHours} hr ago`;
                        }
                    }
                }
                return {
                    caller_id: `#${uc.id}`,
                    conversation_id: uc.id,
                    room_id: uc.room_id || null,
                    caller_name: `Anonymous caller #${uc.id}`,
                    wait_time: waitTime,
                    call_type: uc.id % 2 === 0 ? "Voice call" : "Text / Voice",
                    topic: topics[uc.id % topics.length],
                    tag: tags[uc.id % tags.length]
                };
            });
        } else {
            queue = [];
        }

        // Active Listening Guidelines
        const guidelines = [
            {
                id: 1,
                title: "1. Active Listening Standard",
                content: "Allow 3–5 seconds of quiet space after callers finish speaking before offering a warm response."
            },
            {
                id: 2,
                title: "2. Anonymity Enforcement",
                content: "Do not share personal locations, phone numbers, or last names under any circumstances."
            },
            {
                id: 3,
                title: "3. Emergency Crisis Protocol",
                content: "If a caller indicates self-harm risk, offer the Crisis Hotline transfer button in the call bar."
            }
        ];

        res.status(200).json({
            status: true,
            message: "Calls and queue fetched successfully.",
            data: {
                listener_status: {
                    online_status: onlineStatus
                },
                queue: queue,
                guidelines: guidelines
            }
        });

    } catch (error) {
        console.error('Listener Calls & Queue Error:', error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// POST /api/listener/toggle-status
// Toggle listener online status (available_now) between true and false
router.post('/listener/toggle-status', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        // Ensure user is listener
        if (req.user.user_type !== 'listener') {
            return res.status(401).json({
                status: false,
                message: 'Access denied. Listener permissions required.'
            });
        }

        // Check if listener details exist
        const { rows } = await pool.query(
            'SELECT available_now FROM listener_details WHERE user_id = $1 LIMIT 1',
            [user_id]
        );

        let currentStatus = false;
        let entryExists = rows.length > 0;
        if (entryExists) {
            currentStatus = !!rows[0].available_now;
        }

        // Determine new status (support explicit status in body or automatic toggle)
        let newStatus;
        const body = req.body || {};
        if (body.available_now !== undefined) {
            newStatus = !!body.available_now;
        } else {
            newStatus = !currentStatus;
        }

        if (entryExists) {
            await pool.query(
                'UPDATE listener_details SET available_now = $1, last_active = NOW() WHERE user_id = $2',
                [newStatus, user_id]
            );
        } else {
            await pool.query(
                'INSERT INTO listener_details (user_id, available_now, last_active, application_status) VALUES ($1, $2, NOW(), 2)',
                [user_id, newStatus]
            );
        }

        res.status(200).json({
            status: true,
            message: `Status updated successfully to ${newStatus ? 'online' : 'offline'}.`,
            data: {
                online_status: newStatus
            }
        });

    } catch (error) {
        console.error('Listener Toggle Status Error:', error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// POST or GET /api/listener/call-history (and /api/listener/call-logs, /api/listener/call-log)
// Fetch call history / call logs dynamically from DB along with comprehensive Earnings & Payout Analytics (supporting 7days, 30days, and thisyear filters)
const listenerCallHistoryHandler = async (req, res) => {
    try {
        const user_id = req.user.id;

        // Ensure user is listener
        if (req.user.user_type !== 'listener') {
            return res.status(401).json({
                status: false,
                message: 'Access denied. Listener permissions required.'
            });
        }

        const body = req.body || {};
        const query = req.query || {};
        const search = body.search || query.search || '';
        const page = parseInt(body.page || query.page) || 1;
        const limit = parseInt(body.limit || query.limit) || 10;
        const filter = body.filter || query.filter || '7days'; // can be '7days', '30days', 'thisyear'

        // 1. Determine filter query intervals for stats and charts
        let filterInterval = "INTERVAL '7 days'";
        if (filter === '30days') filterInterval = "INTERVAL '30 days'";

        let totalEarnedQuery;
        if (filter === 'thisyear') {
            totalEarnedQuery = `
                SELECT SUM(amount) AS total 
                FROM minute_transactions 
                WHERE listener_id = $1 AND created_at >= DATE_TRUNC('year', NOW())
            `;
        } else {
            totalEarnedQuery = `
                SELECT SUM(amount) AS total 
                FROM minute_transactions 
                WHERE listener_id = $1 AND created_at >= NOW() - ${filterInterval}
            `;
        }

        const { rows: earnedRows } = await pool.query(totalEarnedQuery, [user_id]);
        let totalEarned = Number(earnedRows[0]?.total || 0);

        // 2. Query chart data
        let chartQuery;
        if (filter === 'thisyear') {
            chartQuery = `
                SELECT TO_CHAR(created_at, 'Mon') AS label, SUM(amount) AS total, EXTRACT(MONTH FROM created_at) as sort_month
                FROM call_earnings_logs
                WHERE listener_id = $1 AND created_at >= DATE_TRUNC('year', NOW())
                GROUP BY label, sort_month
                ORDER BY sort_month ASC
            `;
        } else {
            const daysLimit = filter === '30days' ? 30 : 7;
            chartQuery = `
                SELECT TO_CHAR(created_at, 'YYYY-MM-DD') AS label, SUM(amount) AS total
                FROM call_earnings_logs
                WHERE listener_id = $1 AND created_at >= NOW() - INTERVAL '${daysLimit} days'
                GROUP BY label
                ORDER BY label ASC
            `;
        }
        const { rows: chartRows } = await pool.query(chartQuery, [user_id]);

        const chartData = chartRows.map(r => ({
            label: r.label,
            value: Number(r.total || 0).toFixed(2)
        }));

        // 3. Fetch Payout / Settlement History from DB
        const { rows: settlementRows } = await pool.query(
            `SELECT id, created_at, payment_method, amount, status
             FROM listener_settlements
             WHERE listener_id = $1
             ORDER BY created_at DESC
             LIMIT 5`,
            [user_id]
        );
        const payoutHistory = settlementRows.map(s => ({
            id: s.id,
            date: new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            destination: s.payment_method || "Manual Settlement",
            amount: `$${Number(s.amount).toFixed(2)}`,
            status: s.status || "Completed"
        }));

        // 4. Fetch Completed Calls (History List)
        let whereClause = `WHERE uc.listener_id = $1 AND uc.status = 'completed'`;
        let queryParams = [user_id];

        if (search && search.trim() !== "") {
            const searchPattern = `%${search.trim()}%`;
            whereClause += ` AND (
                u.name ILIKE $2 
                OR CAST(uc.id AS TEXT) LIKE $2
            )`;
            queryParams.push(searchPattern);
        }

        // Count total completed calls matching criteria
        const countQuery = `
            SELECT COUNT(*) AS total
            FROM user_conversations uc
            JOIN users u ON uc.user_id = u.id
            ${whereClause}
        `;
        const { rows: countRows } = await pool.query(countQuery, queryParams);
        const totalCalls = parseInt(countRows[0]?.total || 0);

        // Fetch paginated calls list
        const offset = (page - 1) * limit;
        const dataParams = [...queryParams, limit, offset];
        const dataQuery = `
            SELECT 
                uc.id,
                uc.room_id,
                uc.started_at,
                uc.ended_at,
                uc.status,
                u.name AS user_name,
                ld.call_price
            FROM user_conversations uc
            JOIN users u ON uc.user_id = u.id
            LEFT JOIN listener_details ld ON ld.user_id = uc.listener_id
            ${whereClause}
            ORDER BY uc.started_at DESC
            LIMIT $${queryParams.length + 1}
            OFFSET $${queryParams.length + 2}
        `;
        const { rows: dbHistory } = await pool.query(dataQuery, dataParams);

        // Helper to format date
        const formatCallDate = (date) => {
            const d = new Date(date);
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

            if (d >= today) {
                return `Today · ${timeStr}`;
            } else if (d >= yesterday) {
                return `Yesterday · ${timeStr}`;
            } else {
                const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                return `${dateStr} · ${timeStr}`;
            }
        };

        const callHistoryList = dbHistory.map(uc => {
            const start = new Date(uc.started_at);
            const end = new Date(uc.ended_at);
            const durationMs = end - start;
            const durationSecs = Math.max(0, Math.floor(durationMs / 1000));
            const mins = Math.floor(durationSecs / 60);
            const secs = durationSecs % 60;
            const formattedDuration = mins > 0 ? `${mins}m ${secs < 10 ? '0' + secs : secs}s` : `${secs}s`;

            const ratePerMin = Number(uc.call_price || 0.60);
            const earnedAmount = (durationSecs * (ratePerMin / 60));

            return {
                id: uc.id,
                room_id: uc.room_id || null,
                caller_name: uc.user_name || `Caller #${uc.id}`,
                topic: "Support Call",
                tag: "Voice Call",
                time_and_date: formatCallDate(uc.started_at),
                duration: formattedDuration,
                rate: `$${ratePerMin.toFixed(2)}/min`,
                earned_amount: `+$${earnedAmount.toFixed(2)}`,
                status: uc.status ? uc.status.charAt(0).toUpperCase() + uc.status.slice(1) : "Completed"
            };
        });

        res.status(200).json({
            status: true,
            message: "Call history and analytics fetched successfully.",
            data: {
                analytics: {
                    total_earned: `$${totalEarned.toFixed(2)}`,
                    growth_percentage: "0% growth",
                    chart_data: chartData,
                    payout_history: payoutHistory
                },
                history: {
                    total_records: totalCalls,
                    page: page,
                    limit: limit,
                    total_pages: Math.ceil(totalCalls / limit) || 1,
                    records: callHistoryList
                }
            }
        });

    } catch (error) {
        console.error('Listener Call History Analytics Error:', error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
};

router.post('/listener/call-history', auth, listenerCallHistoryHandler);
router.get('/listener/call-history', auth, listenerCallHistoryHandler);
router.post('/listener/call-logs', auth, listenerCallHistoryHandler);
router.get('/listener/call-logs', auth, listenerCallHistoryHandler);
router.post('/listener/call-log', auth, listenerCallHistoryHandler);
router.get('/listener/call-log', auth, listenerCallHistoryHandler);
router.post('/call-logs', auth, listenerCallHistoryHandler);
router.get('/call-logs', auth, listenerCallHistoryHandler);
router.post('/call-log', auth, listenerCallHistoryHandler);
router.get('/call-log', auth, listenerCallHistoryHandler);

// POST /api/listener/reviews
// Fetch caller reviews dynamically from DB with pagination and dynamic time-ago formatting (e.g. 2 hours ago)
router.post('/listener/reviews', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        // Ensure user is listener
        if (req.user.user_type !== 'listener') {
            return res.status(401).json({
                status: false,
                message: 'Access denied. Listener permissions required.'
            });
        }

        const body = req.body || {};
        const page = parseInt(body.page) || 1;
        const limit = parseInt(body.limit) || 10;
        const offset = (page - 1) * limit;

        // 1. Fetch total count of reviews
        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) AS total 
             FROM (
                 SELECT id FROM listener_reviews WHERE listener_id = $1
                 UNION ALL
                 SELECT id FROM user_conversations WHERE listener_id = $1 AND rating IS NOT NULL AND ended_at IS NOT NULL
             ) combined`,
            [user_id]
        );
        const total = parseInt(countRows[0]?.total || 0);

        // 2. Fetch paginated reviews from DB
        const { rows: dbReviews } = await pool.query(
            `SELECT rating, review, created_at, user_id, user_name
             FROM (
                 SELECT lr.rating, lr.review, lr.created_at, lr.user_id, u.name AS user_name
                 FROM listener_reviews lr
                 JOIN users u ON u.id = lr.user_id
                 WHERE lr.listener_id = $1
                 
                 UNION ALL
                 
                 SELECT uc.rating, uc.review, uc.ended_at AS created_at, uc.user_id, u.name AS user_name
                 FROM user_conversations uc
                 JOIN users u ON u.id = uc.user_id
                 WHERE uc.listener_id = $1 AND uc.rating IS NOT NULL AND uc.ended_at IS NOT NULL
             ) combined
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [user_id, limit, offset]
        );

        const formatReviewDate = (createdAt) => {
            const diffMs = Date.now() - new Date(createdAt);
            const diffSecs = Math.floor(diffMs / 1000);
            if (diffSecs < 60) return "Just now";
            const diffMins = Math.floor(diffSecs / 60);
            if (diffMins < 60) return `${diffMins} minutes ago`;
            const diffHours = Math.floor(diffMins / 60);
            if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
            const diffDays = Math.floor(diffHours / 24);
            if (diffDays === 1) return "Yesterday";
            return `${diffDays} days ago`;
        };

        const resultList = dbReviews.map(lr => ({
            rating: Number(lr.rating || 5.0).toFixed(1),
            review: lr.review || "No feedback text provided.",
            time_ago: formatReviewDate(lr.created_at),
            topic: "Call Review"
        }));

        res.status(200).json({
            status: true,
            message: "Reviews fetched successfully.",
            data: {
                total_records: total,
                page: page,
                limit: limit,
                total_pages: Math.ceil(total / limit) || 1,
                reviews: resultList
            }
        });

    } catch (error) {
        console.error('Listener Reviews Error:', error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// POST /api/listener/profile/view
// Fetch profile details including display name, avatar, bio, selected interests/topics, vibe details, and languages
router.post('/listener/profile/view', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        // Ensure user is listener
        if (req.user.user_type !== 'listener') {
            return res.status(401).json({
                status: false,
                message: 'Access denied. Listener permissions required.'
            });
        }

        // Ensure standard vibes exist in vibes table
        await pool.query("INSERT INTO vibes (id, vibe_name) VALUES (2, 'Warm') ON CONFLICT (id) DO NOTHING");
        await pool.query("INSERT INTO vibes (id, vibe_name) VALUES (3, 'Practical') ON CONFLICT (id) DO NOTHING");
        await pool.query("INSERT INTO vibes (id, vibe_name) VALUES (4, 'Gentle') ON CONFLICT (id) DO NOTHING");
        await pool.query("INSERT INTO vibes (id, vibe_name) VALUES (5, 'Calm') ON CONFLICT (id) DO NOTHING");

        // 1. Fetch user display info & listener details
        const { rows: userRows } = await pool.query(
            `SELECT u.name, u.profile_photo, ld.bio, ld.vibe_id, ld.is_verified, v.vibe_name
             FROM users u
             LEFT JOIN listener_details ld ON ld.user_id = u.id
             LEFT JOIN vibes v ON v.id = ld.vibe_id
             WHERE u.id = $1 LIMIT 1`,
            [user_id]
        );
        const userDetails = userRows[0] || {};

        // 2. Fetch listener's selected interests with their names
        const { rows: selectedInterests } = await pool.query(
            `SELECT i.id, i.interest_name 
             FROM listener_interests li
             JOIN interests i ON i.id = li.interest_id
             WHERE li.user_id = $1
             ORDER BY i.interest_name ASC`,
            [user_id]
        );

        // 3. Fetch listener's selected languages with their names
        const { rows: selectedLanguages } = await pool.query(
            `SELECT l.id, l.language_name 
             FROM listener_preferred_languages lpl
             JOIN languages l ON l.id = lpl.language_id
             WHERE lpl.user_id = $1
             ORDER BY l.language_name ASC`,
            [user_id]
        );

        const vibeDescriptions = {
            'Calm': 'Patient, slow-paced, soothing space.',
            'Warm': 'Deeply empathetic & attentive.',
            'Practical': 'Clear, practical & action-guided.',
            'Gentle': 'Gentle & encouraging tone.'
        };

        const topics = selectedInterests;
        const languages = selectedLanguages;
        let vibe = null;
        if (userDetails.vibe_id) {
            vibe = {
                id: userDetails.vibe_id,
                vibe_name: userDetails.vibe_name || '',
                description: vibeDescriptions[userDetails.vibe_name] || 'Spoken communication style and presence.'
            };
        }

        res.status(200).json({
            status: true,
            message: "Listener profile fetched successfully.",
            data: {
                profile: {
                    name: userDetails.name || '',
                    profile_photo: userDetails.profile_photo || '',
                    listener_id: `#LS-${user_id}`,
                    is_verified: !!userDetails.is_verified,
                    bio: userDetails.bio || ''
                },
                topics: topics,
                vibe: vibe,
                languages: languages
            }
        });

        res.status(200).json({
            status: true,
            message: "Listener profile fetched successfully.",
            data: {
                profile: {
                    name: userDetails.name || '',
                    profile_photo: userDetails.profile_photo || '',
                    listener_id: `#LS-${user_id}`,
                    is_verified: !!userDetails.is_verified,
                    bio: userDetails.bio || ''
                },
                topics: topics,
                vibe: vibe,
                languages: languages
            }
        });

    } catch (error) {
        console.error('Listener Profile View Error:', error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// POST /api/listener/profile/update
// Update profile display details, bio, selected interests/topics, vibe styles, and preferred languages
router.post('/listener/profile/update', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        // Ensure user is listener
        if (req.user.user_type !== 'listener') {
            return res.status(401).json({
                status: false,
                message: 'Access denied. Listener permissions required.'
            });
        }

        const body = req.body || {};
        const { name, bio, vibe_id, selected_topics, selected_languages } = body;

        // 1. Update Display Name in users table
        if (name !== undefined) {
            await pool.query("UPDATE users SET name = $1 WHERE id = $2", [name, user_id]);
        }

        // 2. Update bio & vibe_id in listener_details table
        const { rows: detailsRows } = await pool.query(
            'SELECT id FROM listener_details WHERE user_id = $1 LIMIT 1',
            [user_id]
        );
        if (detailsRows.length > 0) {
            await pool.query(
                'UPDATE listener_details SET bio = $1, vibe_id = $2 WHERE user_id = $3',
                [bio !== undefined ? bio : null, vibe_id || null, user_id]
            );
        } else {
            await pool.query(
                'INSERT INTO listener_details (user_id, bio, vibe_id, application_status) VALUES ($1, $2, $3, 2)',
                [user_id, bio !== undefined ? bio : null, vibe_id || null]
            );
        }

        // 3. Update Selected Support Topics (Interests)
        if (Array.isArray(selected_topics)) {
            await pool.query("DELETE FROM listener_interests WHERE user_id = $1", [user_id]);
            for (const interestId of selected_topics) {
                await pool.query(
                    "INSERT INTO listener_interests (user_id, interest_id) VALUES ($1, $2)",
                    [user_id, interestId]
                );
            }
        }

        // 4. Update Spoken Languages
        if (Array.isArray(selected_languages)) {
            await pool.query("DELETE FROM listener_preferred_languages WHERE user_id = $1", [user_id]);
            for (const langId of selected_languages) {
                await pool.query(
                    "INSERT INTO listener_preferred_languages (user_id, language_id, fluency_level_id) VALUES ($1, $2, 4)",
                    [user_id, langId]
                );
            }
        }

        res.status(200).json({
            status: true,
            message: "Profile updated successfully."
        });

    } catch (error) {
        console.error('Listener Profile Update Error:', error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// POST /api/listener/status
// Check online status of a specific listener or the current logged-in listener
router.post('/listener/status', async (req, res) => {
    try {
        const body = req.body || {};
        let listenerId = body.listener_id;

        // If no listener_id is supplied in body, try to check if there is an auth token to get current user
        if (!listenerId && req.headers.authorization) {
            try {
                const token = req.headers.authorization.split(' ')[1];
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');
                listenerId = decoded.id || decoded.userId;
            } catch (jwtErr) {
                // Ignore token decode errors and let it fail on missing listenerId
            }
        }

        if (!listenerId) {
            return res.status(200).json({
                status: false,
                message: 'listener_id is required.'
            });
        }

        const { rows } = await pool.query(
            `SELECT ld.available_now, ld.application_status, u.name 
             FROM listener_details ld
             JOIN users u ON ld.user_id = u.id
             WHERE ld.user_id = $1 LIMIT 1`,
            [listenerId]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                status: false,
                message: 'Listener not found.'
            });
        }

        let listenerStatus = 'pending';
        const appStatus = Number(rows[0].application_status);
        if (appStatus === 2) {
            listenerStatus = 'approve';
        } else if (appStatus === 3) {
            listenerStatus = 'reject';
        } else {
            listenerStatus = 'pending';
        }

        res.status(200).json({
            status: true,
            message: 'Status fetched successfully.',
            listener_status: listenerStatus,
            data: {
                name: rows[0].name,
                online: !!rows[0].available_now,
                listener_status: listenerStatus
            }
        });

    } catch (error) {
        console.error('Listener Status Error:', error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// POST /api/listener/decline-call or /api/listener/reject-call
// Decline an incoming or ringing call by listener using only conversation_id
const declineCallHandler = async (req, res) => {
    try {
        const auth_user_id = req.user.id;
        const { conversation_id, call_id } = req.body ?? {};

        const convId = conversation_id || call_id;

        if (!convId) {
            return res.status(200).json({
                status: false,
                message: "conversation_id is required."
            });
        }

        const parsedId = Number(convId);
        if (isNaN(parsedId) || !Number.isInteger(parsedId) || parsedId <= 0) {
            return res.status(200).json({
                status: false,
                message: "conversation_id must be a valid positive integer."
            });
        }

        // Fetch conversation and joined caller & listener details from DB
        const { rows: convRows } = await pool.query(
            `SELECT 
                uc.id, 
                uc.user_id, 
                uc.listener_id, 
                uc.room_id, 
                uc.started_at, 
                uc.ended_at, 
                uc.status, 
                uc.created_at,
                u.name AS caller_name,
                u.profile_photo AS caller_photo,
                l.name AS listener_name,
                l.profile_photo AS listener_photo,
                ld.rating AS listener_rating,
                ld.call_price
             FROM user_conversations uc
             LEFT JOIN users u ON u.id = uc.user_id
             LEFT JOIN users l ON l.id = uc.listener_id
             LEFT JOIN listener_details ld ON ld.user_id = uc.listener_id
             WHERE uc.id = $1 AND (uc.listener_id = $2 OR uc.user_id = $2 OR uc.listener_id IS NULL)`,
            [parsedId, auth_user_id]
        );

        if (convRows.length === 0) {
            return res.status(200).json({
                status: false,
                message: "Call / Conversation not found or unauthorized."
            });
        }

        const conversation = convRows[0];

        if (conversation.status === 'completed' || conversation.status === 'cancelled' || conversation.status === 'declined' || conversation.status === 'rejected') {
            return res.status(200).json({
                status: false,
                message: `Call is already ${conversation.status}.`
            });
        }

        // Update status to 'declined' and ended_at to NOW()
        const { rows: updatedRows } = await pool.query(
            `UPDATE user_conversations
             SET status = 'declined',
                 ended_at = NOW()
             WHERE id = $1
             RETURNING id, user_id, listener_id, room_id, started_at, ended_at, status, created_at`,
            [parsedId]
        );

        const updatedCall = updatedRows[0];
        const BASE_URL = `${req.protocol}://${req.get('host')}`;

        return res.status(200).json({
            status: true,
            message: "Call declined successfully.",
            data: {
                conversation_id: updatedCall.id,
                room_id: updatedCall.room_id,
                call_status: updatedCall.status,
                started_at: updatedCall.started_at,
                ended_at: updatedCall.ended_at,
                created_at: updatedCall.created_at,
                caller: {
                    id: conversation.user_id,
                    name: conversation.caller_name || `Caller #${conversation.user_id}`,
                    profile_photo: conversation.caller_photo ? `${BASE_URL}/uploads/${conversation.caller_photo}` : null
                },
                listener: {
                    id: conversation.listener_id || auth_user_id,
                    name: conversation.listener_name || null,
                    profile_photo: conversation.listener_photo ? `${BASE_URL}/uploads/${conversation.listener_photo}` : null,
                    rating: conversation.listener_rating ? Number(conversation.listener_rating) : null,
                    call_price: conversation.call_price ? Number(conversation.call_price) : null
                }
            }
        });

    } catch (error) {
        console.error("Decline call error:", error);
        return res.status(200).json({
            status: false,
            message: error.message
        });
    }
};

router.post('/listener/decline-call', auth, declineCallHandler);
router.post('/listener/reject-call', auth, declineCallHandler);
router.post('/decline-call', auth, declineCallHandler);
router.post('/reject-call', auth, declineCallHandler);

// POST /api/listener/accept-call or /api/listener/attend-call
const listenerAttendCallHandler = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { conversation_id, call_id, room_id } = req.body ?? {};
        const convId = conversation_id || call_id;

        let convRows = [];
        if (convId) {
            const parsedId = Number(convId);
            if (isNaN(parsedId) || !Number.isInteger(parsedId) || parsedId <= 0) {
                return res.status(200).json({
                    status: false,
                    message: "conversation_id must be a valid positive integer."
                });
            }

            const { rows } = await pool.query(
                `SELECT id, user_id, listener_id, room_id, started_at, ended_at, status 
                 FROM user_conversations 
                 WHERE id = $1 AND (user_id = $2 OR listener_id = $2 OR listener_id IS NULL)`,
                [parsedId, user_id]
            );
            convRows = rows;
        } else if (room_id && typeof room_id === 'string' && room_id.trim() !== "") {
            const { rows } = await pool.query(
                `SELECT id, user_id, listener_id, room_id, started_at, ended_at, status 
                 FROM user_conversations 
                 WHERE room_id = $1 AND (user_id = $2 OR listener_id = $2 OR listener_id IS NULL)`,
                [room_id.trim(), user_id]
            );
            convRows = rows;
        } else {
            return res.status(200).json({
                status: false,
                message: "conversation_id or room_id is required."
            });
        }

        if (convRows.length === 0) {
            return res.status(200).json({
                status: false,
                message: "Conversation not found or unauthorized."
            });
        }

        const conversation = convRows[0];

        if (conversation.status === 'completed' || conversation.status === 'cancelled' || conversation.status === 'declined') {
            return res.status(200).json({
                status: false,
                message: `Call is already ${conversation.status}.`
            });
        }

        // Update status to 'in_progress', assign listener_id if null, and set started_at to current timestamp
        const { rows: updatedRows } = await pool.query(
            `UPDATE user_conversations
             SET status = 'in_progress',
                 listener_id = COALESCE(listener_id, $2),
                 started_at = NOW()
             WHERE id = $1
             RETURNING id, user_id, listener_id, room_id, started_at, status, created_at`,
            [conversation.id, user_id]
        );

        return res.status(200).json({
            status: true,
            message: "Call attended and connected successfully.",
            data: updatedRows[0]
        });

    } catch (error) {
        console.error("Attend call error:", error);
        return res.status(200).json({
            status: false,
            message: error.message
        });
    }
};

router.post('/listener/accept-call', auth, listenerAttendCallHandler);
router.post('/listener/attend-call', auth, listenerAttendCallHandler);

// POST /api/listener/end-call
const { endCallHandler } = require('./user');
router.post('/listener/end-call', auth, endCallHandler);

// GET & POST /api/listener/earnings
const listenerEarningsHandler = async (req, res) => {
    try {
        const user_id = req.user.id;

        if (req.user.user_type !== 'listener') {
            return res.status(401).json({
                status: false,
                message: 'Access denied. Listener permissions required.'
            });
        }

        // Fetch listener details
        const { rows: listenerRows } = await pool.query(
            `SELECT rating, total_reviews, total_calls, call_price, unsettled_amount, settled_amount
             FROM listener_details 
             WHERE user_id = $1 LIMIT 1`,
            [user_id]
        );
        const listener = listenerRows[0] || {};
        const unsettled = Number(listener.unsettled_amount || 0);
        const settled = Number(listener.settled_amount || 0);
        const totalEarnings = unsettled + settled;

        // Fetch active listener rate from app_settings
        const { rows: rateRows } = await pool.query(
            `SELECT setting_value FROM app_settings WHERE setting_key = 'listener_rate_per_minute' LIMIT 1`
        );
        const ratePerMin = rateRows.length > 0 && !isNaN(Number(rateRows[0].setting_value))
            ? Number(rateRows[0].setting_value)
            : 0.20;

        // Fetch recent 10 call logs
        const { rows: recentLogs } = await pool.query(
            `SELECT cel.id, cel.call_id, cel.duration_seconds, cel.total_minutes, cel.rate_per_minute, cel.amount, cel.created_at,
                    u.name AS caller_name
             FROM call_earnings_logs cel
             LEFT JOIN users u ON u.id = cel.user_id
             WHERE cel.listener_id = $1
             ORDER BY cel.created_at DESC
             LIMIT 10`,
            [user_id]
        );

        // Fetch recent 10 settlements
        const { rows: recentSettlements } = await pool.query(
            `SELECT id, amount, note, payment_method, transaction_ref, status, created_at
             FROM listener_settlements
             WHERE listener_id = $1
             ORDER BY created_at DESC
             LIMIT 10`,
            [user_id]
        );

        res.status(200).json({
            status: true,
            message: 'Earnings fetched successfully.',
            data: {
                unsettled_amount: unsettled.toFixed(2),
                settled_amount: settled.toFixed(2),
                total_earnings: totalEarnings.toFixed(2),
                listener_rate_per_minute: ratePerMin.toFixed(2),
                total_calls: listener.total_calls || 0,
                rating: listener.rating || "0.0",
                recent_call_logs: recentLogs,
                recent_settlements: recentSettlements
            }
        });
    } catch (error) {
        console.error('Listener earnings error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
};

router.get('/listener/earnings', auth, listenerEarningsHandler);
router.post('/listener/earnings', auth, listenerEarningsHandler);

// GET & POST /api/listener/settlements
const listenerSettlementsListHandler = async (req, res) => {
    try {
        const user_id = req.user.id;

        if (req.user.user_type !== 'listener') {
            return res.status(401).json({
                status: false,
                message: 'Access denied. Listener permissions required.'
            });
        }

        const page = Math.max(1, parseInt(req.query?.page || req.body?.page || 1));
        const limit = Math.max(1, parseInt(req.query?.limit || req.body?.limit || 20));
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) AS total FROM listener_settlements WHERE listener_id = $1`,
            [user_id]
        );
        const total = parseInt(countRows[0]?.total || 0);

        const { rows: settlements } = await pool.query(
            `SELECT id, amount, note, payment_method, transaction_ref, status, created_at
             FROM listener_settlements
             WHERE listener_id = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [user_id, limit, offset]
        );

        // Also fetch current balances
        const { rows: listenerRows } = await pool.query(
            `SELECT unsettled_amount, settled_amount FROM listener_details WHERE user_id = $1 LIMIT 1`,
            [user_id]
        );
        const listener = listenerRows[0] || {};

        res.status(200).json({
            status: true,
            message: 'Settlements fetched successfully.',
            data: {
                total,
                page,
                limit,
                unsettled_amount: Number(listener.unsettled_amount || 0).toFixed(2),
                settled_amount: Number(listener.settled_amount || 0).toFixed(2),
                settlements
            }
        });
    } catch (error) {
        console.error('Listener settlements error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
};

router.get('/listener/settlements', auth, listenerSettlementsListHandler);
router.post('/listener/settlements', auth, listenerSettlementsListHandler);

// GET & POST /api/listener/call-earnings-logs
const listenerCallEarningsLogsHandler = async (req, res) => {
    try {
        const user_id = req.user.id;

        if (req.user.user_type !== 'listener') {
            return res.status(401).json({
                status: false,
                message: 'Access denied. Listener permissions required.'
            });
        }

        const page = Math.max(1, parseInt(req.query?.page || req.body?.page || 1));
        const limit = Math.max(1, parseInt(req.query?.limit || req.body?.limit || 20));
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) AS total FROM call_earnings_logs WHERE listener_id = $1`,
            [user_id]
        );
        const total = parseInt(countRows[0]?.total || 0);

        const { rows: logs } = await pool.query(
            `SELECT cel.id, cel.call_id, cel.duration_seconds, cel.total_minutes, cel.rate_per_minute, cel.amount, cel.created_at,
                    u.name AS caller_name, u.profile_photo AS caller_photo
             FROM call_earnings_logs cel
             LEFT JOIN users u ON u.id = cel.user_id
             WHERE cel.listener_id = $1
             ORDER BY cel.created_at DESC
             LIMIT $2 OFFSET $3`,
            [user_id, limit, offset]
        );

        res.status(200).json({
            status: true,
            message: 'Call earnings logs fetched successfully.',
            data: {
                total,
                page,
                limit,
                logs
            }
        });
    } catch (error) {
        console.error('Listener call earnings logs error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
};

router.get('/listener/call-earnings-logs', auth, listenerCallEarningsLogsHandler);
router.post('/listener/call-earnings-logs', auth, listenerCallEarningsLogsHandler);

// POST /api/listener/send-email-otp
// Generate and send an OTP code to a listener's email address
router.post('/listener/send-email-otp', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(200).json({ status: false, message: "Email is required." });
        }

        const cleanEmail = email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanEmail)) {
            return res.status(200).json({ status: false, message: "Please enter a valid email address." });
        }

        // Check existing user
        const { rows: users } = await pool.query(
            "SELECT * FROM users WHERE email = $1 LIMIT 1",
            [cleanEmail]
        );

        // Account with password already exists
        if (users.length > 0 && users[0].password) {
            if (users[0].user_type === 'user') {
                return res.status(200).json({ status: false, message: "This email is already registered as a user." });
            }
            return res.status(200).json({ status: false, message: "Email already registered." });
        }

        const otp = Math.floor(100000 + Math.random() * 900000);

        if (users.length > 0) {
            await pool.query(
                `UPDATE users
                 SET email_otp = $1,
                     otp_created_at = NOW(),
                     email_verified = false,
                     email_verified_at = NULL
                 WHERE email = $2`,
                [otp, cleanEmail]
            );
        } else {
            await pool.query(
                `INSERT INTO users (email, email_otp, otp_created_at, email_verified, user_type)
                 VALUES ($1, $2, NOW(), false, 'listener')`,
                [cleanEmail, otp]
            );
        }

        // Send OTP via email in the background (non-blocking)
        sendOtpEmail(cleanEmail, otp)
            .then(emailResult => {
                if (!emailResult.status) {
                    console.error(`Failed to send OTP email to ${cleanEmail}:`, emailResult.error);
                }
            })
            .catch(err => {
                console.error(`Unhandled error sending OTP email to ${cleanEmail}:`, err);
            });

        return res.status(200).json({
            status: true,
            message: "OTP sent successfully.",
            otp // Remove in production
        });
    } catch (error) {
        console.error(error);
        return res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/listener/verify-email-otp
// Verify the OTP code sent to the listener's email
router.post('/listener/verify-email-otp', async (req, res) => {
    try {
        let { email, otp } = req.body;
        email = email?.trim().toLowerCase();

        if (!email || !otp) {
            return res.status(200).json({ status: false, message: "Email and OTP are required." });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(200).json({ status: false, message: "Please enter a valid email address." });
        }

        const otpRegex = /^[0-9]{6}$/;
        if (!otpRegex.test(String(otp))) {
            return res.status(200).json({ status: false, message: "OTP must be a 6-digit number." });
        }

        const { rows: users } = await pool.query(
            "SELECT * FROM users WHERE email = $1 LIMIT 1",
            [email]
        );

        if (users.length === 0) {
            return res.status(200).json({ status: false, message: "Email not found." });
        }

        const user = users[0];

        if (user.password) {
            return res.status(200).json({ status: false, message: "Email already registered." });
        }

        if (String(user.email_otp) !== String(otp)) {
            return res.status(200).json({ status: false, message: "Invalid OTP." });
        }

        // Check expiration
        const { rows: otpValid } = await pool.query(
            `SELECT 1 FROM users WHERE email = $1 AND otp_created_at >= NOW() - INTERVAL '5 minutes'`,
            [email]
        );

        if (otpValid.length === 0) {
            return res.status(200).json({ status: false, message: "OTP has expired. Please request a new OTP." });
        }

        // Mark verified
        await pool.query(
            `UPDATE users
             SET email_verified = true,
                 email_verified_at = NOW(),
                 email_otp = NULL,
                 otp_created_at = NULL
             WHERE email = $1`,
            [email]
        );

        return res.status(200).json({ status: true, message: "Email verified successfully." });
    } catch (error) {
        console.error(error);
        return res.status(200).json({ status: false, message: error.message });
    }
});

module.exports = router;


