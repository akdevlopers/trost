const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { auth, role } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const upload = require('../middleware/upload');
const { fileTypeFromFile } = require('file-type'); // npm install file-type
const fs = require('fs');

// Deletes any files multer already saved to disk before we reject the request
function cleanupUploadedFiles(files) {
    if (!files) return;
    Object.values(files).flat().forEach(file => {
        fs.unlink(file.path, () => { });
    });
}

// Shared failure responder — cleans up any uploaded files, then responds
function fail(req, res, message) {
    cleanupUploadedFiles(req.files);
    return res.status(200).json({ status: false, message });
}

// Verifies actual file content (magic bytes), not just extension/mimetype
async function isActuallyAudio(filePath) {
    try {
        const type = await fileTypeFromFile(filePath);
        if (!type) return false;
        return type.mime.startsWith('audio/');
    } catch (_) {
        return false;
    }
}


// POST /api/admin/login
router.post('/login', async (req, res) => {
    try {
        let { email, password } = req.body;

        // ── Required fields ──────────────────────────────────────────────
        if (!email || !password) {
            return res.status(200).json({ status: false, message: 'Email and password are required.' });
        }

        // Trim + normalize
        email = email.trim().toLowerCase();

        // ── Email format validation ──────────────────────────────────────
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(200).json({ status: false, message: 'Please enter a valid email address.' });
        }

        // ── Password basic format validation ─────────────────────────────
        if (typeof password !== 'string' || password.length < 6) {
            return res.status(200).json({ status: false, message: 'Password must be at least 6 characters.' });
        }

        if (password.length > 100) {
            return res.status(200).json({ status: false, message: 'Password is too long.' });
        }

        const { rows: users } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        if (users.length === 0) {
            return res.status(200).json({ status: false, message: 'Admin not found.' });
        }

        const user = users[0];

        if (user.user_type !== 'admin') {
            return res.status(200).json({ status: false, message: 'Unauthorized. Only admins can log in here.' });
        }

        // ── Guard against missing password hash (e.g. OAuth-only accounts) ─
        if (!user.password) {
            return res.status(200).json({ status: false, message: 'No password set for this account.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(200).json({ status: false, message: 'Invalid password.' });
        }

        // ── Optional: block login if admin account itself is disabled ──────
        if (user.status !== undefined && Number(user.status) === 0) {
            return res.status(200).json({ status: false, message: 'This admin account has been disabled.' });
        }

        // Generate JWT token for admin
        const token = jwt.sign(
            { userId: user.id, user_type: user.user_type },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        delete user.password;

        res.status(200).json({
            status: true,
            message: 'Admin login successful',
            data: { token: token }
        });

    } catch (error) {
        console.error('Admin login error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});

// GET /api/admin/get-listeners
router.get('/get-listeners', auth, role('admin'), async (req, res) => {
    try {
        const { page, limit, offset } = getPagination(req.query);
        const { search, application_status, premium_boost, profile_type } = req.query;

        let conditions = [`u.user_type = 'listener'`];
        let params = [];

        // Search filter
        if (search && search.trim()) {
            const like = `%${search.trim()}%`;
            conditions.push(`(u.name LIKE $${params.length + 1} OR u.email LIKE $${params.length + 2} OR ld.home_country LIKE $${params.length + 3} OR ld.university_email LIKE $${params.length + 4})`);
            params.push(like, like, like, like);
        }

        // application_status filter
        if (application_status !== undefined && application_status !== '') {
            conditions.push(`ld.application_status = $${params.length + 1}`);
            params.push(Number(application_status));
        }

        // premium_boost filter
        if (premium_boost !== undefined && premium_boost !== '') {
            conditions.push(`ld.premium_boost = $${params.length + 1}`);
            params.push(Number(premium_boost));
        }

        // profile_type filter
        if (profile_type && profile_type.trim()) {
            conditions.push(`ld.profile_type = $${params.length + 1}`);
            params.push(profile_type.trim());
        }

        const WHERE = `WHERE ` + conditions.join(' AND ');

        // Count total
        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) AS total
             FROM users u
             JOIN listener_details ld ON u.id = ld.user_id
             ${WHERE}`,
            params
        );
        const total = countRows[0].total;

        // Fetch page
        // const { rows: listeners } = await pool.query(
        //     `SELECT
        //          u.id,
        //             u.name,
        //             u.email,
        //             u.phone,
        //             u.profile_photo,

        //             ld.current_location,
        //             ld.home_country,
        //             ld.university_email,

        //             v.vibe_name AS vibe,

        //             STRING_AGG(DISTINCT i.interest_name, ', ') AS interests,

        //             ld.profile_type,
        //             ld.primary_voice,
        //             ld.secondary_voice,
        //             ld.ready_to_start,
        //             ld.premium_boost,
        //             ld.code_of_conduct_agreed,
        //             ld.application_status,
        //             ld.profile_photo_status,
        //             ld.primary_voice_status,
        //             ld.secondary_voice_status

        //         FROM users u

        //         JOIN listener_details ld
        //             ON u.id = ld.user_id

        //         LEFT JOIN vibes v
        //             ON ld.vibe_id = v.id

        //         LEFT JOIN listener_interests li
        //             ON li.user_id = u.id

        //         LEFT JOIN interests i
        //             ON li.interest_id = i.id

        //         ${WHERE}

        //         GROUP BY
        //             u.id,
        //             ld.user_id,
        //             v.vibe_name

        //         ORDER BY u.id DESC

        //         LIMIT $${params.length + 1}
        //         OFFSET $${params.length + 2}`,
        //     // `SELECT
        //     //     u.id, u.name, u.email, u.phone, u.profile_photo,
        //     //     ld.current_location, ld.home_country, ld.university_email, ld.interests,
        //     //     ld.profile_type, ld.primary_voice, ld.secondary_voice,
        //     //     ld.ready_to_start, ld.premium_boost, ld.code_of_conduct_agreed,
        //     //     ld.application_status, ld.profile_photo_status, ld.primary_voice_status, ld.secondary_voice_status
        //     //  FROM users u
        //     //  JOIN listener_details ld ON u.id = ld.user_id
        //     //  ${WHERE}
        //     //  ORDER BY u.id DESC
        //     //  LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,

        //     [...params, limit, offset]
        // );

        const { rows: listeners } = await pool.query(
            `SELECT
                u.id,
                u.name,
                u.email,
                u.phone,
                u.profile_photo,

                ld.current_location,
                ld.home_country,
                ld.university_email,

                v.vibe_name AS vibe,

                (
                    SELECT STRING_AGG(DISTINCT i.interest_name, ', ')
                    FROM listener_interests li
                    JOIN interests i ON li.interest_id = i.id
                    WHERE li.user_id = u.id
                ) AS interests,

                ld.profile_type,
                ld.primary_voice,
                ld.secondary_voice,
                ld.ready_to_start,
                ld.premium_boost,
                ld.code_of_conduct_agreed,
                ld.application_status,
                ld.profile_photo_status,
                ld.primary_voice_status,
                ld.secondary_voice_status,
                COALESCE(ld.unsettled_amount, 0.00) AS unsettled_amount,
                COALESCE(ld.settled_amount, 0.00) AS settled_amount,
                COALESCE(ld.total_calls, 0) AS total_calls,
                ld.call_price,
                ld.rating

            FROM users u

            JOIN listener_details ld
                ON u.id = ld.user_id

            LEFT JOIN vibes v
                ON ld.vibe_id = v.id

            ${WHERE}

            ORDER BY u.id DESC

            LIMIT $${params.length + 1}
            OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );

        const BASE_URL = `${req.protocol}://${req.get('host')}`;
        await attachLanguages(listeners);
        listeners.forEach(l => {
            if (l.profile_photo) l.profile_photo = `${BASE_URL}/uploads/${l.profile_photo}`;
            if (l.primary_voice) l.primary_voice = `${BASE_URL}/uploads/${l.primary_voice}`;
            if (l.secondary_voice) l.secondary_voice = `${BASE_URL}/uploads/${l.secondary_voice}`;
        });

        res.status(200).json({
            status: true,
            message: 'Listeners fetched successfully.',
            data: listeners,
            pagination: {
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit)
            }
        }, 200);
    } catch (error) {
        console.error('Fetch listeners error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});

router.post('/profile-photo-status', auth, role('admin'), async (req, res) => {
    try {

        const { user_id, status } = req.body;

        if (!user_id || status === undefined) {
            return res.status(200).json({
                status: false,
                message: 'User ID and status are required.'
            }, 200);
        }

        if (![0, 1, 2].includes(Number(status))) {
            return res.status(200).json({
                status: false,
                message: 'Invalid status.'
            }, 200);
        }

        const result = await pool.query(
            `UPDATE listener_details
             SET profile_photo_status = $1
             WHERE user_id = $2`,
            [status, user_id]
        );

        if (result.rowCount === 0) {
            return res.status(200).json({
                status: false,
                message: "Listener not found."
            }, 200);
        }

        // Auto-approve: if all 3 are approved (1), set application_status = 2
        const { rows: checkRows } = await pool.query(
            'SELECT profile_photo_status, primary_voice_status, secondary_voice_status, application_status FROM listener_details WHERE user_id = $1',
            [user_id]
        );
        let autoApproved = false;
        if (checkRows.length > 0) {
            const l = checkRows[0];
            if (Number(l.profile_photo_status) === 1 && Number(l.primary_voice_status) === 1 && Number(l.secondary_voice_status) === 1 && Number(l.application_status) !== 2) {
                await pool.query('UPDATE listener_details SET application_status = 2 WHERE user_id = $1', [user_id]);
                autoApproved = true;
            }
        }

        let message = '';
        if (Number(status) === 1) message = autoApproved ? 'Profile photo approved and application automatically approved!' : 'Profile photo approved successfully.';
        else if (Number(status) === 2) message = 'Profile photo rejected successfully.';
        else message = 'Profile photo marked as pending.';

        res.status(200).json({ status: true, message }, 200);

    } catch (error) {

        res.status(200).json({
            status: false,
            message: error.message
        }, 200);

    }
});

router.post('/primary-voice-status', auth, role('admin'), async (req, res) => {
    try {

        const { user_id, status } = req.body;

        if (!user_id || status === undefined) {
            return res.status(200).json({
                status: false,
                message: "User ID and status are required."
            }, 200);
        }

        if (![0, 1, 2].includes(Number(status))) {
            return res.status(200).json({
                status: false,
                message: "Invalid status."
            }, 200);
        }

        const result = await pool.query(
            `UPDATE listener_details
             SET primary_voice_status = $1
             WHERE user_id = $2`,
            [status, user_id]
        );

        if (result.rowCount === 0) {
            return res.status(200).json({
                status: false,
                message: "Listener not found."
            }, 200);
        }

        // Auto-approve: if all 3 are approved (1), set application_status = 2
        const { rows: checkRows } = await pool.query(
            'SELECT profile_photo_status, primary_voice_status, secondary_voice_status, application_status FROM listener_details WHERE user_id = $1',
            [user_id]
        );
        let autoApproved = false;
        if (checkRows.length > 0) {
            const l = checkRows[0];
            if (Number(l.profile_photo_status) === 1 && Number(l.primary_voice_status) === 1 && Number(l.secondary_voice_status) === 1 && Number(l.application_status) !== 2) {
                await pool.query('UPDATE listener_details SET application_status = 2 WHERE user_id = $1', [user_id]);
                autoApproved = true;
            }
        }

        let message = '';
        if (Number(status) === 1) message = autoApproved ? 'Primary voice approved and application automatically approved!' : 'Primary voice approved successfully.';
        else if (Number(status) === 2) message = 'Primary voice rejected successfully.';
        else message = 'Primary voice marked as pending.';

        res.status(200).json({ status: true, message }, 200);

    } catch (error) {

        res.status(200).json({
            status: false,
            message: error.message
        }, 200);

    }
});

router.post('/secondary-voice-status', auth, role('admin'), async (req, res) => {
    try {

        const { user_id, status } = req.body;

        if (!user_id || status === undefined) {
            return res.status(200).json({
                status: false,
                message: "User ID and status are required."
            }, 200);
        }

        if (![0, 1, 2].includes(Number(status))) {
            return res.status(200).json({
                status: false,
                message: "Invalid status."
            }, 200);
        }

        const result = await pool.query(
            `UPDATE listener_details
             SET secondary_voice_status = $1
             WHERE user_id = $2`,
            [status, user_id]
        );

        if (result.rowCount === 0) {
            return res.status(200).json({
                status: false,
                message: "Listener not found."
            }, 200);
        }

        // Auto-approve: if all 3 are approved (1), set application_status = 2
        const { rows: checkRows } = await pool.query(
            'SELECT profile_photo_status, primary_voice_status, secondary_voice_status, application_status FROM listener_details WHERE user_id = $1',
            [user_id]
        );
        let autoApproved = false;
        if (checkRows.length > 0) {
            const l = checkRows[0];
            if (Number(l.profile_photo_status) === 1 && Number(l.primary_voice_status) === 1 && Number(l.secondary_voice_status) === 1 && Number(l.application_status) !== 2) {
                await pool.query('UPDATE listener_details SET application_status = 2 WHERE user_id = $1', [user_id]);
                autoApproved = true;
            }
        }

        let message = '';
        if (Number(status) === 1) message = autoApproved ? 'Secondary voice approved and application automatically approved!' : 'Secondary voice approved successfully.';
        else if (Number(status) === 2) message = 'Secondary voice rejected successfully.';
        else message = 'Secondary voice marked as pending.';

        res.status(200).json({ status: true, message }, 200);

    } catch (error) {

        res.status(200).json({
            status: false,
            message: error.message
        }, 200);

    }
});

// POST /api/admin/add-listener
router.post('/add-listener', auth, role('admin'), upload.fields([
    { name: 'profile_photo', maxCount: 1 },
    { name: 'primary_voice', maxCount: 1 },
    { name: 'secondary_voice', maxCount: 1 }
]), async (req, res) => {
    try {

        let {
            full_name,
            current_location,
            home_country,
            university_email,
            vibe_id,
            profile_type,
            ready_to_start,
            premium_boost,
            code_of_conduct_agreed
        } = req.body;

        let languages = [];
        try {
            if (req.body.languages) languages = JSON.parse(req.body.languages);
        } catch (_) {
            return fail(req, res, "languages must be valid JSON.");
        }

        let interests = [];
        try {
            if (req.body.interests) interests = JSON.parse(req.body.interests);
        } catch (_) {
            return fail(req, res, "interests must be valid JSON.");
        }

        // ── full_name ─────────────────────────────────────────────────────
        if (!full_name || !full_name.trim()) {
            return fail(req, res, "Full name is required.");
        }
        full_name = full_name.trim();
        if (full_name.length < 2 || full_name.length > 50) {
            return fail(req, res, "Full name must be between 2 and 50 characters.");
        }
        if (!/^[a-zA-Z\s.'-]+$/.test(full_name)) {
            return fail(req, res, "Full name contains invalid characters.");
        }

        // ── current_location ─────────────────────────────────────────────
        if (!current_location || !current_location.trim()) {
            return fail(req, res, "Current location is required.");
        }
        current_location = current_location.trim();
        if (current_location.length > 100) {
            return fail(req, res, "Current location is too long.");
        }

        // ── home_country ──────────────────────────────────────────────────
        if (!home_country || !home_country.trim()) {
            return fail(req, res, "Home country is required.");
        }
        home_country = home_country.trim();
        if (home_country.length > 100) {
            return fail(req, res, "Home country is too long.");
        }

        // ── university_email format ──────────────────────────────────────
        if (!university_email || !university_email.trim()) {
            return fail(req, res, "university_email is required.");
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const cleanEmail = university_email.trim().toLowerCase();
        if (!emailRegex.test(cleanEmail)) {
            return fail(req, res, "Please enter a valid email address.");
        }
        if (cleanEmail.length > 150) {
            return fail(req, res, "Email is too long.");
        }

        // ── vibe_id ───────────────────────────────────────────────────────
        if (!vibe_id) {
            return fail(req, res, "vibe_id is required.");
        }
        if (isNaN(Number(vibe_id))) {
            return fail(req, res, "vibe_id must be a number.");
        }
        const { rows: vibeCheck } = await pool.query("SELECT id FROM vibes WHERE id = $1", [Number(vibe_id)]);
        if (vibeCheck.length === 0) {
            return fail(req, res, "Invalid vibe selected.");
        }

        // ── profile_type ──────────────────────────────────────────────────
        if (!profile_type || !profile_type.trim()) {
            return fail(req, res, "Profile type is required.");
        }
        profile_type = profile_type.trim();
        const validProfileTypes = ['photo', 'avatar', 'anonymous']; // ⚠️ confirm your real allowed values
        if (!validProfileTypes.includes(profile_type)) {
            return fail(req, res, `profile_type must be one of: ${validProfileTypes.join(', ')}.`);
        }

        // ── interests: structure + existence check ───────────────────────
        if (!Array.isArray(interests) || interests.length === 0) {
            return fail(req, res, "Please select at least one interest.");
        }
        const interestIds = interests.map(i => Number(i.interest_id ?? i));
        if (interestIds.some(id => id === undefined || id === null || isNaN(id))) {
            return fail(req, res, "Each interest must have a valid interest_id.");
        }
        const { rows: validInterests } = await pool.query(
            `SELECT id FROM interests WHERE id = ANY($1::int[])`,
            [interestIds]
        );
        if (validInterests.length !== new Set(interestIds).size) {
            return fail(req, res, "One or more interest_id values are invalid.");
        }

        // ── languages: structure + existence check ───────────────────────
        if (!Array.isArray(languages) || languages.length === 0) {
            return fail(req, res, "Please select at least one language.");
        }
        for (const lang of languages) {
            if (!lang.language_id || !lang.fluency_level_id || isNaN(Number(lang.language_id)) || isNaN(Number(lang.fluency_level_id))) {
                return fail(req, res, "Each language entry must include a valid language_id and fluency_level_id.");
            }
        }
        const languageIds = languages.map(l => Number(l.language_id));
        const fluencyIds = languages.map(l => Number(l.fluency_level_id));

        const { rows: validLanguages } = await pool.query(
            `SELECT id FROM languages WHERE id = ANY($1::int[])`,
            [languageIds]
        );
        if (validLanguages.length !== new Set(languageIds).size) {
            return fail(req, res, "One or more language_id values are invalid.");
        }

        const { rows: validFluencies } = await pool.query(
            `SELECT id FROM fluency_levels WHERE id = ANY($1::int[])`,
            [fluencyIds]
        );
        if (validFluencies.length !== new Set(fluencyIds).size) {
            return fail(req, res, "One or more fluency_level_id values are invalid.");
        }

        // Duplicate language check (same language selected twice)
        if (new Set(languageIds).size !== languageIds.length) {
            return fail(req, res, "Duplicate languages are not allowed.");
        }

        // ── ready_to_start / premium_boost ────────────────────────────────
        const boolStrings = ['0', '1', 'true', 'false'];

        if (ready_to_start === undefined || ready_to_start === '') {
            return fail(req, res, "Please select whether you are ready to start.");
        }
        if (!boolStrings.includes(String(ready_to_start))) {
            return fail(req, res, "ready_to_start must be a boolean value.");
        }

        if (premium_boost === undefined || premium_boost === '') {
            return fail(req, res, "Please choose whether to join the Premium Boost program.");
        }
        if (!boolStrings.includes(String(premium_boost))) {
            return fail(req, res, "premium_boost must be a boolean value.");
        }

        // ── code_of_conduct_agreed ────────────────────────────────────────
        if (code_of_conduct_agreed === undefined || Number(code_of_conduct_agreed) !== 1) {
            return fail(req, res, "You must agree to the Code of Conduct before submitting your application.");
        }

        // ── File validation ───────────────────────────────────────────────
        const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
        const maxImageSize = 5 * 1024 * 1024;   // 5MB
        const maxAudioSize = 15 * 1024 * 1024;  // 15MB

        if (profile_type === 'photo' && !req.files?.profile_photo) {
            return fail(req, res, "Profile photo is required when profile_type is 'photo'.");
        }

        if (req.files?.profile_photo) {
            const file = req.files.profile_photo[0];
            if (!allowedImageTypes.includes(file.mimetype)) {
                return fail(req, res, "Profile photo must be JPEG, PNG, or WEBP.");
            }
            if (file.size > maxImageSize) {
                return fail(req, res, "Profile photo must be under 5MB.");
            }
        }

        if (!req.files?.primary_voice) {
            return fail(req, res, "Primary voice recording is required.");
        }
        {
            const file = req.files.primary_voice[0];
            if (file.size > maxAudioSize) {
                return fail(req, res, "Primary voice file must be under 15MB.");
            }
            const isAudio = await isActuallyAudio(file.path);
            if (!isAudio) {
                return fail(req, res, "Primary voice must be a genuine audio file.");
            }
        }

        if (req.files?.secondary_voice) {
            const file = req.files.secondary_voice[0];
            if (file.size > maxAudioSize) {
                return fail(req, res, "Secondary voice file must be under 15MB.");
            }
            const isAudio = await isActuallyAudio(file.path);
            if (!isAudio) {
                return fail(req, res, "Secondary voice must be a genuine audio file.");
            }
        }

        let profilePhoto = req.files?.profile_photo ? req.files.profile_photo[0].filename : null;
        let primaryVoice = req.files?.primary_voice ? req.files.primary_voice[0].filename : null;
        let secondaryVoice = req.files?.secondary_voice ? req.files.secondary_voice[0].filename : null;

        // ── Duplicate email check ─────────────────────────────────────────
        const { rows: users } = await pool.query(
            "SELECT id, user_type FROM users WHERE email = $1",
            [cleanEmail]
        );

        let userId;
        if (users.length > 0) {
            const existingUser = users[0];

            const { rows: existingListenerDetails } = await pool.query(
                "SELECT user_id FROM listener_details WHERE user_id = $1",
                [existingUser.id]
            );

            if (existingUser.user_type === 'listener' && existingListenerDetails.length > 0) {
                return fail(req, res, "This email already exists as a listener. Use edit instead of adding again.");
            }

            if (existingUser.user_type === 'user') {
                return fail(req, res, "This email is already registered as a regular user.");
            }

            userId = existingUser.id;
            await pool.query(
                `UPDATE users SET name = $1, user_type = 'listener' WHERE id = $2`,
                [full_name, userId]
            );
        } else {
            const { rows: result } = await pool.query(
                `INSERT INTO users (name, email, user_type, email_verified, status)
                 VALUES ($1,$2,$3,$4,$5) RETURNING id`,
                [full_name, cleanEmail, 'listener', 0, 1]
            );
            userId = result[0].id;
        }

        if (profile_type === 'photo' && profilePhoto) {
            await pool.query(`UPDATE users SET profile_photo = $1 WHERE id = $2`, [profilePhoto, userId]);
        }

        await pool.query(`
            INSERT INTO listener_details
            (
                user_id, current_location, home_country, university_email, vibe_id,
                profile_type, primary_voice, secondary_voice, ready_to_start, premium_boost,
                code_of_conduct_agreed, application_status, profile_photo_status,
                primary_voice_status, secondary_voice_status
            )
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
                application_status=EXCLUDED.application_status,
                profile_photo_status=EXCLUDED.profile_photo_status,
                primary_voice_status=EXCLUDED.primary_voice_status,
                secondary_voice_status=EXCLUDED.secondary_voice_status
        `, [
            userId, current_location, home_country, cleanEmail, Number(vibe_id),
            profile_type, primaryVoice, secondaryVoice, ready_to_start, premium_boost,
            code_of_conduct_agreed, 2, 1, 1, 1
        ]);

        await pool.query("DELETE FROM listener_preferred_languages WHERE user_id=$1", [userId]);
        for (const language of languages) {
            await pool.query(
                `INSERT INTO listener_preferred_languages (user_id,language_id,fluency_level_id) VALUES($1,$2,$3)`,
                [userId, language.language_id, language.fluency_level_id]
            );
        }

        await pool.query("DELETE FROM user_interests WHERE user_id=$1", [userId]);
        for (const interest of interests) {
            await pool.query(
                `INSERT INTO user_interests (user_id,interest_id) VALUES($1,$2)`,
                [userId, Number(interest.interest_id ?? interest)]
            );
        }

        res.status(200).json({
            status: true,
            message: "Listener added successfully."
        });

    } catch (error) {
        console.error('Add listener error:', error);
        cleanupUploadedFiles(req.files); // clean up on unexpected errors too
        res.status(200).json({ status: false, message: error.message });
    }
});

// GET /api/admin/users-list
router.get('/users-list', auth, role('admin'), async (req, res) => {
    try {
        const { page, limit, offset } = getPagination(req.query);
        const { search, status } = req.query;

        let conditions = [`user_type = 'user'`];
        let params = [];

        // ── search validation ────────────────────────────────────────────
        if (search !== undefined) {
            if (typeof search !== 'string') {
                return res.status(200).json({ status: false, message: 'search must be a string.' });
            }
            const trimmedSearch = search.trim();
            if (trimmedSearch.length > 100) {
                return res.status(200).json({ status: false, message: 'search query is too long.' });
            }
            if (trimmedSearch) {
                const like = `%${trimmedSearch}%`;
                conditions.push(`(name ILIKE $${params.length + 1} OR email ILIKE $${params.length + 2} OR phone ILIKE $${params.length + 3})`);
                params.push(like, like, like);
            }
        }

        // ── status validation ────────────────────────────────────────────
        if (status !== undefined && status !== '') {
            if (isNaN(Number(status)) || ![0, 1].includes(Number(status))) {
                return res.status(200).json({ status: false, message: 'status must be 0 (Blocked) or 1 (Active).' });
            }
            conditions.push(`status = $${params.length + 1}`);
            params.push(Number(status));
        }

        const WHERE = `WHERE ` + conditions.join(' AND ');

        // Count total
        const { rows: countRow } = await pool.query(
            `SELECT COUNT(id) AS total FROM users ${WHERE}`,
            params
        );
        const total = Number(countRow[0].total);

        // Fetch page
        const { rows: users } = await pool.query(
            `SELECT id, name, email, phone, profile_photo, created_at, status
             FROM users
             ${WHERE}
             ORDER BY created_at DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );

        const BASE_URL = `${req.protocol}://${req.get('host')}`;
        users.forEach(u => {
            if (u.profile_photo) u.profile_photo = `${BASE_URL}/uploads/${u.profile_photo}`;
        });

        res.status(200).json({
            status: true,
            message: 'Users list fetched successfully.',
            data: users,
            pagination: {
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('Users list error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});

// Post /api/admin/block-user
router.post('/block-user', auth, role('admin'), async (req, res) => {
    try {
        let { user_id, status } = req.body;

        // ── Required fields ──────────────────────────────────────────────
        if (user_id === undefined || user_id === null || user_id === '') {
            return res.status(200).json({
                status: false,
                message: 'user_id is required.'
            });
        }

        if (status === undefined || status === null || status === '') {
            return res.status(200).json({
                status: false,
                message: 'status is required.'
            });
        }

        // ── user_id format validation ────────────────────────────────────
        if (isNaN(Number(user_id)) || !Number.isInteger(Number(user_id)) || Number(user_id) <= 0) {
            return res.status(200).json({
                status: false,
                message: 'user_id must be a valid positive integer.'
            });
        }
        user_id = Number(user_id);

        // ── status format validation (normalize before checking) ─────────
        if (isNaN(Number(status)) || ![0, 1].includes(Number(status))) {
            return res.status(200).json({
                status: false,
                message: 'status must be 0 (Blocked) or 1 (Active).'
            });
        }
        status = Number(status);

        // ── Check user exists and is actually a regular user ─────────────
        const { rows: users } = await pool.query(
            `SELECT id, status AS current_status FROM users
             WHERE id = $1 AND user_type = 'user'`,
            [user_id]
        );

        if (users.length === 0) {
            return res.status(200).json({
                status: false,
                message: 'User not found.'
            });
        }

        // ── Prevent redundant update (already in the requested state) ────
        if (Number(users[0].current_status) === status) {
            return res.status(200).json({
                status: false,
                message: `User is already ${status === 1 ? 'active' : 'blocked'}.`
            });
        }

        // Update status
        await pool.query(
            `UPDATE users
             SET status = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [status, user_id]
        );

        res.status(200).json({
            status: true,
            message: status === 1
                ? 'User activated successfully.'
                : 'User blocked successfully.'
        });

    } catch (error) {
        console.error('Block user error:', error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// LANGUAGE, vibe , interest 

// GET /api/admin/get-languages
router.get('/get-languages', auth, role('admin'), async (req, res) => {
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
        }, 200);

    } catch (error) {
        console.error(error);

        res.status(200).json({
            status: false,
            message: error.message
        }, 200);
    }
});
// GET /api/admin/get-fluencies
router.get('/get-fluencies', auth, role('admin'), async (req, res) => {
    try {
        const { rows: levels } = await pool.query('SELECT id, level_name FROM fluency_levels ORDER BY id ASC');
        res.status(200).json({ status: true, message: 'Fluency levels fetched.', data: levels });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});
// GET /api/admin/get-vibes
router.get('/get-vibes', auth, role('admin'), async (req, res) => {
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
        }, 200);

    } catch (error) {
        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        }, 200);
    }
});
// GET /api/admin/get-interests
router.get('/get-interests', auth, role('admin'), async (req, res) => {
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
        }, 200);

    } catch (error) {
        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        }, 200);
    }
});

// POST /api/admin/add-language
router.post('/add-language', auth, role('admin'), async (req, res) => {
    try {
        let { language_name } = req.body;

        // ── Required ──────────────────────────────────────────────────────
        if (!language_name || typeof language_name !== 'string' || !language_name.trim()) {
            return res.status(200).json({
                status: false,
                message: 'Language Name is required.'
            });
        }

        language_name = language_name.trim();

        // ── Length validation ─────────────────────────────────────────────
        if (language_name.length < 2 || language_name.length > 50) {
            return res.status(200).json({
                status: false,
                message: 'Language Name must be between 2 and 50 characters.'
            });
        }

        // ── Character validation (letters, spaces, hyphens only) ─────────
        if (!/^[a-zA-Z\s-]+$/.test(language_name)) {
            return res.status(200).json({
                status: false,
                message: 'Language Name can only contain letters, spaces, and hyphens.'
            });
        }

        // ── Duplicate check ───────────────────────────────────────────────
        const { rows: existingLanguage } = await pool.query(
            `SELECT id FROM languages WHERE LOWER(language_name) = LOWER($1)`,
            [language_name]
        );

        if (existingLanguage.length > 0) {
            return res.status(200).json({
                status: false,
                message: 'Language already exists.'
            });
        }

        // Insert language
        const { rows: result } = await pool.query(
            `INSERT INTO languages (language_name) VALUES ($1) RETURNING id`,
            [language_name]
        );

        return res.status(200).json({
            status: true,
            message: 'Language added successfully.',
            id: result[0].id
        });

    } catch (error) {
        console.error('Add language error:', error);
        return res.status(200).json({
            status: false,
            message: error.message
        });
    }
});
// POST /api/admin/add-vibe
router.post('/add-vibe', auth, role('admin'), async (req, res) => {
    try {
        let { vibe_name } = req.body;

        // ── Required ──────────────────────────────────────────────────────
        if (!vibe_name || typeof vibe_name !== 'string' || !vibe_name.trim()) {
            return res.status(200).json({
                status: false,
                message: 'Vibe Name is required.'
            });
        }

        vibe_name = vibe_name.trim();

        // ── Length validation ─────────────────────────────────────────────
        if (vibe_name.length < 2 || vibe_name.length > 50) {
            return res.status(200).json({
                status: false,
                message: 'Vibe Name must be between 2 and 50 characters.'
            });
        }


        // ── Character validation ──────────────────────────────────────────
        if (!/^[a-zA-Z\s'&-]+$/.test(vibe_name)) {
            return res.status(200).json({
                status: false,
                message: 'Vibe Name can only contain letters, spaces.'
            });
        }

        // ── Duplicate check ───────────────────────────────────────────────
        const { rows: existing } = await pool.query(
            `SELECT id FROM vibes WHERE LOWER(vibe_name) = LOWER($1)`,
            [vibe_name]
        );

        if (existing.length > 0) {
            return res.status(200).json({
                status: false,
                message: 'Vibe already exists.'
            });
        }

        const { rows: result } = await pool.query(
            `INSERT INTO vibes (vibe_name) VALUES ($1) RETURNING id`,
            [vibe_name]
        );

        return res.status(200).json({
            status: true,
            message: 'Vibe added successfully.',
            id: result[0].id
        });

    } catch (error) {
        console.error('Add vibe error:', error);
        return res.status(200).json({
            status: false,
            message: error.message
        });
    }
});
// POST /api/admin/add-interest
router.post('/add-interest', auth, role('admin'), async (req, res) => {
    try {
        let { interest_name } = req.body;

        // ── Required ──────────────────────────────────────────────────────
        if (!interest_name || typeof interest_name !== 'string' || !interest_name.trim()) {
            return res.status(200).json({
                status: false,
                message: 'Interest Name is required.'
            });
        }

        interest_name = interest_name.trim();

        // ── Length validation ─────────────────────────────────────────────
        if (interest_name.length < 2 || interest_name.length > 50) {
            return res.status(200).json({
                status: false,
                message: 'Interest Name must be between 2 and 50 characters.'
            });
        }

        // ── Character validation ──────────────────────────────────────────
        if (!/^[a-zA-Z\s'&-]+$/.test(interest_name)) {
            return res.status(200).json({
                status: false,
                message: 'Interest Name can only contain letters, spaces .'
            });
        }

        // ── Duplicate check ───────────────────────────────────────────────
        const { rows: existing } = await pool.query(
            `SELECT id FROM interests WHERE LOWER(interest_name) = LOWER($1)`,
            [interest_name]
        );

        if (existing.length > 0) {
            return res.status(200).json({
                status: false,
                message: 'Interest already exists.'
            });
        }

        const { rows: result } = await pool.query(
            `INSERT INTO interests (interest_name) VALUES ($1) RETURNING id`,
            [interest_name]
        );

        return res.status(200).json({
            status: true,
            message: 'Interest added successfully.',
            id: result[0].id
        });

    } catch (error) {
        console.error('Add interest error:', error);
        return res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// POST /api/admin/edit-language
router.post('/edit-language', auth, role('admin'), async (req, res) => {
    try {
        let { id, language_name } = req.body;

        // ── id validation ─────────────────────────────────────────────────
        if (id === undefined || id === null || id === '') {
            return res.status(200).json({
                status: false,
                message: 'id is required.'
            });
        }
        if (isNaN(Number(id)) || !Number.isInteger(Number(id)) || Number(id) <= 0) {
            return res.status(200).json({
                status: false,
                message: 'id must be a valid positive integer.'
            });
        }
        id = Number(id);

        // ── language_name validation ─────────────────────────────────────
        if (!language_name || typeof language_name !== 'string' || !language_name.trim()) {
            return res.status(200).json({
                status: false,
                message: 'Language Name is required.'
            });
        }
        language_name = language_name.trim();

        if (language_name.length < 2 || language_name.length > 50) {
            return res.status(200).json({
                status: false,
                message: 'Language Name must be between 2 and 50 characters.'
            });
        }
        if (!/^[a-zA-Z\s-]+$/.test(language_name)) {
            return res.status(200).json({
                status: false,
                message: 'Language Name can only contain letters, spaces, and hyphens.'
            });
        }

        // ── Check language exists ─────────────────────────────────────────
        const { rows: language } = await pool.query(
            `SELECT id FROM languages WHERE id = $1`,
            [id]
        );

        if (language.length === 0) {
            return res.status(200).json({
                status: false,
                message: 'Language not found.'
            });
        }

        // ── Duplicate name (excluding this record) ────────────────────────
        const { rows: existingName } = await pool.query(
            `SELECT id FROM languages WHERE LOWER(language_name) = LOWER($1) AND id != $2`,
            [language_name, id]
        );

        if (existingName.length > 0) {
            return res.status(200).json({
                status: false,
                message: 'Language already exists.'
            });
        }

        await pool.query(
            `UPDATE languages SET language_name = $1, updated_at = NOW() WHERE id = $2`,
            [language_name, id]
        );

        res.status(200).json({
            status: true,
            message: 'Language updated successfully.'
        });

    } catch (error) {
        console.error('Edit language error:', error);
        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});
// POST /api/admin/edit-vibe
router.post('/edit-vibe', auth, role('admin'), async (req, res) => {
    try {
        let { id, vibe_name } = req.body;

        // ── id validation ─────────────────────────────────────────────────
        if (id === undefined || id === null || id === '') {
            return res.status(200).json({
                status: false,
                message: 'id is required.'
            });
        }
        if (isNaN(Number(id)) || !Number.isInteger(Number(id)) || Number(id) <= 0) {
            return res.status(200).json({
                status: false,
                message: 'id must be a valid positive integer.'
            });
        }
        id = Number(id);

        // ── vibe_name validation ──────────────────────────────────────────
        if (!vibe_name || typeof vibe_name !== 'string' || !vibe_name.trim()) {
            return res.status(200).json({
                status: false,
                message: 'Vibe Name is required.'
            });
        }
        vibe_name = vibe_name.trim();

        if (vibe_name.length < 2 || vibe_name.length > 50) {
            return res.status(200).json({
                status: false,
                message: 'Vibe Name must be between 2 and 50 characters.'
            });
        }
        if (!/^[a-zA-Z\s'&-]+$/.test(vibe_name)) {
            return res.status(200).json({
                status: false,
                message: 'Vibe Name can only contain letters, spaces.'
            });
        }

        // ── NEW: Check vibe actually exists before updating ───────────────
        const { rows: existingVibe } = await pool.query(
            `SELECT id FROM vibes WHERE id = $1`,
            [id]
        );
        if (existingVibe.length === 0) {
            return res.status(200).json({
                status: false,
                message: 'Vibe not found.'
            });
        }

        // ── Duplicate name (excluding this record) ────────────────────────
        const { rows: existing } = await pool.query(
            `SELECT id FROM vibes WHERE LOWER(vibe_name) = LOWER($1) AND id <> $2`,
            [vibe_name, id]
        );

        if (existing.length > 0) {
            return res.status(200).json({
                status: false,
                message: 'Vibe already exists.'
            });
        }

        const { rows: result } = await pool.query(
            `UPDATE vibes SET vibe_name = $1 WHERE id = $2 RETURNING id`,
            [vibe_name, id]
        );

        return res.status(200).json({
            status: true,
            message: 'Vibe updated successfully.',
            id: result[0].id
        });

    } catch (error) {
        console.error('Edit vibe error:', error);
        return res.status(200).json({
            status: false,
            message: error.message
        });
    }
});
// POST /api/admin/edit-interest
router.post('/edit-interest', auth, role('admin'), async (req, res) => {
    try {
        let { id, interest_name } = req.body;

        // ── id validation ─────────────────────────────────────────────────
        if (id === undefined || id === null || id === '') {
            return res.status(200).json({
                status: false,
                message: 'id is required.'
            });
        }
        if (isNaN(Number(id)) || !Number.isInteger(Number(id)) || Number(id) <= 0) {
            return res.status(200).json({
                status: false,
                message: 'id must be a valid positive integer.'
            });
        }
        id = Number(id);

        // ── interest_name validation ──────────────────────────────────────
        if (!interest_name || typeof interest_name !== 'string' || !interest_name.trim()) {
            return res.status(200).json({
                status: false,
                message: 'Interest Name is required.'
            });
        }
        interest_name = interest_name.trim();

        if (interest_name.length < 2 || interest_name.length > 50) {
            return res.status(200).json({
                status: false,
                message: 'Interest Name must be between 2 and 50 characters.'
            });
        }
        if (!/^[a-zA-Z\s'&-]+$/.test(interest_name)) {
            return res.status(200).json({
                status: false,
                message: 'Interest Name can only contain letters, spaces.'
            });
        }

        // ── NEW: Check interest actually exists before updating ───────────
        const { rows: existingInterest } = await pool.query(
            `SELECT id FROM interests WHERE id = $1`,
            [id]
        );
        if (existingInterest.length === 0) {
            return res.status(200).json({
                status: false,
                message: 'Interest not found.'
            });
        }

        // ── Duplicate name (excluding this record) ────────────────────────
        const { rows: existing } = await pool.query(
            `SELECT id FROM interests WHERE LOWER(interest_name) = LOWER($1) AND id <> $2`,
            [interest_name, id]
        );

        if (existing.length > 0) {
            return res.status(200).json({
                status: false,
                message: 'Interest already exists.'
            });
        }

        const { rows: result } = await pool.query(
            `UPDATE interests SET interest_name = $1 WHERE id = $2 RETURNING id`,
            [interest_name, id]
        );

        return res.status(200).json({
            status: true,
            message: 'Interest updated successfully.',
            id: result[0].id
        });

    } catch (error) {
        console.error('Edit interest error:', error);
        return res.status(200).json({
            status: false,
            message: error.message
        });
    }
});

// POST /api/admin/delete-language
router.post('/delete-language', auth, role('admin'), async (req, res) => {
    try {

        const { id } = req.body;

        if (id === undefined || id === null || id === '') {
            return res.status(200).json({ status: false, message: 'Please provide the language ID to delete.' });
        }
        if (isNaN(Number(id)) || !Number.isInteger(Number(id)) || Number(id) <= 0) {
            return res.status(200).json({ status: false, message: 'Invalid language ID provided.' });
        }

        const { rows } = await pool.query(
            `SELECT id
             FROM languages
             WHERE id = $1`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(200).json({
                status: false,
                message: 'Language not found.'
            });
        }

        await pool.query(
            `DELETE FROM languages
             WHERE id = $1`,
            [id]
        );

        res.status(200).json({
            status: true,
            message: 'Language deleted successfully.'
        });

    } catch (error) {
        console.error(error);

        res.status(200).json({
            status: false,
            message: error.message
        });
    }
});
//post /api/admin/delete-vibe
router.post('/delete-vibe', auth, role('admin'), async (req, res) => {
    try {

        const { id } = req.body;

        if (id === undefined || id === null || id === '') {
            return res.status(200).json({
                status: false,
                message: 'Please provide the vibe ID to delete.'
            }, 200);
        }
        if (isNaN(Number(id)) || !Number.isInteger(Number(id)) || Number(id) <= 0) {
            return res.status(200).json({ status: false, message: 'Invalid vibe ID provided.' });
        }

        const { rows: result } = await pool.query(
            `DELETE FROM vibes WHERE id = $1 RETURNING id`,
            [id]
        );

        return res.status(200).json({
            status: true,
            message: 'Vibe deleted successfully.',
            id: result[0].id
        }, 200);

    } catch (error) {
        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        }, 200);
    }
});
//post /api/admin/delete-interest
router.post('/delete-interest', auth, role('admin'), async (req, res) => {
    try {

        const { id } = req.body;

        if (id === undefined || id === null || id === '') {
            return res.status(200).json({
                status: false,
                message: 'Please provide the interest ID to delete.'
            }, 200);
        }
        if (isNaN(Number(id)) || !Number.isInteger(Number(id)) || Number(id) <= 0) {
            return res.status(200).json({ status: false, message: 'Invalid interest ID provided.' });
        }

        const { rows: result } = await pool.query(
            `DELETE FROM interests  WHERE id = $1 RETURNING id`,
            [id]
        );

        return res.status(200).json({
            status: true,
            message: 'Interest deleted successfully.',
            id: result[0].id
        }, 200);

    } catch (error) {
        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        }, 200);
    }
});

//─────────────────────────────────────────────────────────────────────────────

// GET /api/admin/get-reviews
router.get('/get-reviews', auth, role('admin'), async (req, res) => {
    try {
        const { page, limit, offset } = getPagination(req.query);
        const { search, listener_id, min_rating, max_rating, start_date, end_date } = req.query;

        let conditions = ['1=1'];
        let params = [];

        // ── search ────────────────────────────────────────────────────────
        if (search !== undefined && search.trim()) {
            if (search.trim().length > 100) {
                return res.status(200).json({ status: false, message: 'search query is too long.' });
            }
            const like = `%${search.trim()}%`;
            conditions.push(`(l.name ILIKE $${params.length + 1} OR l.email ILIKE $${params.length + 2} OR u.name ILIKE $${params.length + 3} OR u.email ILIKE $${params.length + 4})`);
            params.push(like, like, like, like);
        }

        // ── listener_id ───────────────────────────────────────────────────
        if (listener_id !== undefined && listener_id !== '') {
            if (isNaN(Number(listener_id)) || !Number.isInteger(Number(listener_id)) || Number(listener_id) <= 0) {
                return res.status(200).json({ status: false, message: 'listener_id must be a valid positive integer.' });
            }
            conditions.push(`lr.listener_id = $${params.length + 1}`);
            params.push(Number(listener_id));
        }

        // ── min_rating / max_rating ───────────────────────────────────────
        if (min_rating !== undefined && min_rating !== '') {
            if (isNaN(Number(min_rating)) || Number(min_rating) < 1 || Number(min_rating) > 5) {
                return res.status(200).json({ status: false, message: 'min_rating must be a number between 1 and 5.' });
            }
            conditions.push(`lr.rating >= $${params.length + 1}`);
            params.push(Number(min_rating));
        }
        if (max_rating !== undefined && max_rating !== '') {
            if (isNaN(Number(max_rating)) || Number(max_rating) < 1 || Number(max_rating) > 5) {
                return res.status(200).json({ status: false, message: 'max_rating must be a number between 1 and 5.' });
            }
            conditions.push(`lr.rating <= $${params.length + 1}`);
            params.push(Number(max_rating));
        }
        if (min_rating !== undefined && max_rating !== undefined && min_rating !== '' && max_rating !== '' && Number(min_rating) > Number(max_rating)) {
            return res.status(200).json({ status: false, message: 'min_rating cannot be greater than max_rating.' });
        }

        // ── start_date / end_date ─────────────────────────────────────────
        if (start_date !== undefined && start_date.trim()) {
            if (isNaN(Date.parse(start_date.trim()))) {
                return res.status(200).json({ status: false, message: 'start_date must be a valid date.' });
            }
            conditions.push(`lr.created_at >= $${params.length + 1}`);
            params.push(start_date.trim());
        }
        if (end_date !== undefined && end_date.trim()) {
            if (isNaN(Date.parse(end_date.trim()))) {
                return res.status(200).json({ status: false, message: 'end_date must be a valid date.' });
            }
            conditions.push(`lr.created_at <= $${params.length + 1}`);
            params.push(end_date.trim());
        }

        const WHERE = `WHERE ` + conditions.join(' AND ');

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) AS total
             FROM listener_reviews lr
             JOIN users l ON lr.listener_id = l.id
             JOIN users u ON lr.user_id = u.id
             ${WHERE}`,
            params
        );
        const total = Number(countRows[0].total);

        const { rows: reviews } = await pool.query(
            `SELECT
                lr.id, lr.rating, lr.review, lr.created_at, lr.updated_at,
                l.id AS listener_id, l.name AS listener_name, l.email AS listener_email, l.profile_photo AS listener_profile_photo,
                u.id AS reviewer_id, u.name AS reviewer_name, u.email AS reviewer_email
            FROM listener_reviews lr
            JOIN users l ON lr.listener_id = l.id
            JOIN users u ON lr.user_id = u.id
            ${WHERE}
            ORDER BY lr.created_at DESC
            LIMIT $${params.length + 1}
            OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );

        const BASE_URL = `${req.protocol}://${req.get('host')}`;
        reviews.forEach(r => {
            if (r.listener_profile_photo) r.listener_profile_photo = `${BASE_URL}/uploads/${r.listener_profile_photo}`;
        });

        res.status(200).json({
            status: true,
            message: 'Reviews fetched successfully.',
            data: reviews,
            pagination: { total, page, limit, total_pages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('Fetch reviews error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});
// GET /api/admin/get-payments
router.get('/get-payments', auth, role('admin'), async (req, res) => {
    try {
        const { page, limit, offset } = getPagination(req.query);
        const { search, status, package_id, payment_gateway, start_date, end_date } = req.query;

        let conditions = ['1=1'];
        let params = [];

        // ── search ────────────────────────────────────────────────────────
        if (search !== undefined && search.trim()) {
            if (search.trim().length > 100) {
                return res.status(200).json({ status: false, message: 'search query is too long.' });
            }
            const like = `%${search.trim()}%`;
            conditions.push(`(u.name ILIKE $${params.length + 1} OR u.email ILIKE $${params.length + 2} OR p.payment_id ILIKE $${params.length + 3})`);
            params.push(like, like, like);
        }

        // ── status ────────────────────────────────────────────────────────
        const validPaymentStatuses = ['success', 'failed', 'pending', 'refunded'];
        if (status !== undefined && status.trim()) {
            if (!validPaymentStatuses.includes(status.trim().toLowerCase())) {
                return res.status(200).json({ status: false, message: `status must be one of: ${validPaymentStatuses.join(', ')}.` });
            }
            conditions.push(`p.status = $${params.length + 1}`);
            params.push(status.trim().toLowerCase());
        }

        // ── package_id ────────────────────────────────────────────────────
        if (package_id !== undefined && package_id !== '') {
            if (isNaN(Number(package_id)) || !Number.isInteger(Number(package_id)) || Number(package_id) <= 0) {
                return res.status(200).json({ status: false, message: 'package_id must be a valid positive integer.' });
            }
            conditions.push(`p.package_id = $${params.length + 1}`);
            params.push(Number(package_id));
        }

        // ── payment_gateway ───────────────────────────────────────────────
        if (payment_gateway !== undefined && payment_gateway.trim()) {
            if (payment_gateway.trim().length > 50) {
                return res.status(200).json({ status: false, message: 'payment_gateway value is too long.' });
            }
            conditions.push(`p.payment_gateway = $${params.length + 1}`);
            params.push(payment_gateway.trim());
        }

        // ── start_date / end_date ─────────────────────────────────────────
        if (start_date !== undefined && start_date.trim()) {
            if (isNaN(Date.parse(start_date.trim()))) {
                return res.status(200).json({ status: false, message: 'start_date must be a valid date.' });
            }
            conditions.push(`p.created_at >= $${params.length + 1}`);
            params.push(start_date.trim());
        }
        if (end_date !== undefined && end_date.trim()) {
            if (isNaN(Date.parse(end_date.trim()))) {
                return res.status(200).json({ status: false, message: 'end_date must be a valid date.' });
            }
            conditions.push(`p.created_at <= $${params.length + 1}`);
            params.push(end_date.trim());
        }

        const WHERE = `WHERE ` + conditions.join(' AND ');

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) AS total
             FROM payments p
             JOIN users u ON p.user_id = u.id
             LEFT JOIN minute_packages mp ON p.package_id = mp.id
             ${WHERE}`,
            params
        );
        const total = Number(countRows[0].total);

        const { rows: sumRows } = await pool.query(
            `SELECT COALESCE(SUM(p.amount), 0) AS total_amount
             FROM payments p
             JOIN users u ON p.user_id = u.id
             LEFT JOIN minute_packages mp ON p.package_id = mp.id
             ${WHERE}`,
            params
        );
        const total_amount = sumRows[0].total_amount;

        const { rows: payments } = await pool.query(
            `SELECT
                p.id, p.amount, p.payment_gateway, p.payment_id, p.status, p.created_at,
                u.id AS user_id, u.name AS user_name, u.email AS user_email, u.phone AS user_phone,
                mp.id AS package_id, mp.package_name, mp.minutes AS package_minutes, mp.price AS package_price
            FROM payments p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN minute_packages mp ON p.package_id = mp.id
            ${WHERE}
            ORDER BY p.created_at DESC
            LIMIT $${params.length + 1}
            OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );

        res.status(200).json({
            status: true,
            message: 'Payments fetched successfully.',
            data: payments,
            pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
            summary: { total_amount }
        });
    } catch (error) {
        console.error('Fetch payments error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});
// GET /api/admin/get-conversations
router.get('/get-conversations', auth, role('admin'), async (req, res) => {
    try {
        const { page, limit, offset } = getPagination(req.query);
        const { search, status, listener_id, user_id, start_date, end_date } = req.query;

        let conditions = ['1=1'];
        let params = [];

        // ── search ────────────────────────────────────────────────────────
        if (search !== undefined && search.trim()) {
            if (search.trim().length > 100) {
                return res.status(200).json({ status: false, message: 'search query is too long.' });
            }
            const like = `%${search.trim()}%`;
            conditions.push(`(u.name ILIKE $${params.length + 1} OR u.email ILIKE $${params.length + 2} OR l.name ILIKE $${params.length + 3} OR l.email ILIKE $${params.length + 4})`);
            params.push(like, like, like, like);
        }

        // ── status ────────────────────────────────────────────────────────
        const validCallStatuses = ['completed', 'missed', 'cancelled', 'ongoing'];
        if (status !== undefined && status.trim()) {
            if (!validCallStatuses.includes(status.trim().toLowerCase())) {
                return res.status(200).json({ status: false, message: `status must be one of: ${validCallStatuses.join(', ')}.` });
            }
            conditions.push(`uc.status = $${params.length + 1}`);
            params.push(status.trim().toLowerCase());
        }

        // ── listener_id / user_id ─────────────────────────────────────────
        if (listener_id !== undefined && listener_id !== '') {
            if (isNaN(Number(listener_id)) || !Number.isInteger(Number(listener_id)) || Number(listener_id) <= 0) {
                return res.status(200).json({ status: false, message: 'listener_id must be a valid positive integer.' });
            }
            conditions.push(`uc.listener_id = $${params.length + 1}`);
            params.push(Number(listener_id));
        }

        if (user_id !== undefined && user_id !== '') {
            if (isNaN(Number(user_id)) || !Number.isInteger(Number(user_id)) || Number(user_id) <= 0) {
                return res.status(200).json({ status: false, message: 'user_id must be a valid positive integer.' });
            }
            conditions.push(`uc.user_id = $${params.length + 1}`);
            params.push(Number(user_id));
        }

        // ── start_date / end_date ─────────────────────────────────────────
        if (start_date !== undefined && start_date.trim()) {
            if (isNaN(Date.parse(start_date.trim()))) {
                return res.status(200).json({ status: false, message: 'start_date must be a valid date.' });
            }
            conditions.push(`uc.started_at >= $${params.length + 1}`);
            params.push(start_date.trim());
        }
        if (end_date !== undefined && end_date.trim()) {
            if (isNaN(Date.parse(end_date.trim()))) {
                return res.status(200).json({ status: false, message: 'end_date must be a valid date.' });
            }
            conditions.push(`uc.started_at <= $${params.length + 1}`);
            params.push(end_date.trim());
        }

        const WHERE = `WHERE ` + conditions.join(' AND ');

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) AS total
             FROM user_conversations uc
             JOIN users u ON uc.user_id = u.id
             JOIN users l ON uc.listener_id = l.id
             ${WHERE}`,
            params
        );
        const total = Number(countRows[0].total);

        const { rows: calls } = await pool.query(
            `SELECT
                uc.id, uc.room_id, uc.started_at, uc.ended_at, uc.status, uc.created_at,
                EXTRACT(EPOCH FROM (uc.ended_at - uc.started_at)) AS duration_seconds,
                u.id AS user_id, u.name AS user_name, u.email AS user_email, u.profile_photo AS user_profile_photo,
                l.id AS listener_id, l.name AS listener_name, l.email AS listener_email, l.profile_photo AS listener_profile_photo
            FROM user_conversations uc
            JOIN users u ON uc.user_id = u.id
            JOIN users l ON uc.listener_id = l.id
            ${WHERE}
            ORDER BY uc.started_at DESC
            LIMIT $${params.length + 1}
            OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );

        const BASE_URL = `${req.protocol}://${req.get('host')}`;
        calls.forEach(c => {
            if (c.user_profile_photo) c.user_profile_photo = `${BASE_URL}/uploads/${c.user_profile_photo}`;
            if (c.listener_profile_photo) c.listener_profile_photo = `${BASE_URL}/uploads/${c.listener_profile_photo}`;
        });

        res.status(200).json({
            status: true,
            message: 'Calls fetched successfully.',
            data: calls,
            pagination: { total, page, limit, total_pages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('Fetch calls error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});
// GET /api/admin/get-user-details/:id
router.get('/get-user-details/:id', auth, role('admin'), async (req, res) => {
    try {
        const { id } = req.params;

        // ── id validation ─────────────────────────────────────────────────
        if (isNaN(Number(id)) || !Number.isInteger(Number(id)) || Number(id) <= 0) {
            return res.status(200).json({ status: false, message: 'id must be a valid positive integer.' });
        }
        const userId = Number(id);

        // 1. Base user
        const { rows: userRows } = await pool.query(
            `SELECT
                u.id, u.name, u.user_type, u.email, u.phone,
                u.email_verified, u.profile_photo, u.status,
                u.preferred_language_id, u.created_at, u.updated_at,
                u.email_verified_at
             FROM users u
             WHERE u.id = $1`,
            [userId]
        );

        if (userRows.length === 0) {
            return res.status(200).json({ status: false, message: 'User not found.' });
        }

        const user = userRows[0];
        const BASE_URL = `${req.protocol}://${req.get('host')}`;
        if (user.profile_photo) user.profile_photo = `${BASE_URL}/uploads/${user.profile_photo}`;

        // 2. Listener details
        const { rows: listenerRows } = await pool.query(
            `SELECT
                ld.id, ld.current_location, ld.home_country, ld.university_email,
                ld.profile_type, ld.primary_voice, ld.secondary_voice,
                ld.application_status, ld.ready_to_start, ld.premium_boost,
                ld.code_of_conduct_agreed, ld.profile_photo_status,
                ld.primary_voice_status, ld.secondary_voice_status,
                ld.tagline, ld.bio, ld.rating, ld.total_reviews,
                ld.available_now, ld.call_price, ld.total_calls,
                ld.is_verified, ld.last_active,
                v.vibe_name AS vibe,
                ld.created_at, ld.updated_at
             FROM listener_details ld
             LEFT JOIN vibes v ON ld.vibe_id = v.id
             WHERE ld.user_id = $1`,
            [userId]
        );
        const listenerDetails = listenerRows[0] || null;
        if (listenerDetails) {
            if (listenerDetails.primary_voice) listenerDetails.primary_voice = `${BASE_URL}/uploads/${listenerDetails.primary_voice}`;
            if (listenerDetails.secondary_voice) listenerDetails.secondary_voice = `${BASE_URL}/uploads/${listenerDetails.secondary_voice}`;
        }

        // 3. Languages
        const { rows: languages } = await pool.query(
            `SELECT l.id, l.language_name, fl.level_name AS fluency
             FROM listener_preferred_languages ul
             JOIN languages l ON ul.language_id = l.id
             JOIN fluency_levels fl ON ul.fluency_level_id = fl.id
             WHERE ul.user_id = $1`,
            [userId]
        );

        // 4. Interests
        const { rows: interests } = await pool.query(
            `SELECT DISTINCT i.id, i.interest_name
             FROM interests i
             WHERE i.id IN (
                 SELECT interest_id FROM listener_interests WHERE user_id = $1
                 UNION
                 SELECT interest_id FROM user_interests WHERE user_id = $1
             )`,
            [userId]
        );

        // 5. Reviews received
        const { rows: reviewsReceived } = await pool.query(
            `SELECT lr.id, lr.rating, lr.review, lr.created_at,
                    u.id AS reviewer_id, u.name AS reviewer_name, u.email AS reviewer_email
             FROM listener_reviews lr
             JOIN users u ON lr.user_id = u.id
             WHERE lr.listener_id = $1
             ORDER BY lr.created_at DESC`,
            [userId]
        );

        // 6. Reviews given
        const { rows: reviewsGiven } = await pool.query(
            `SELECT lr.id, lr.rating, lr.review, lr.created_at,
                    l.id AS listener_id, l.name AS listener_name, l.email AS listener_email
             FROM listener_reviews lr
             JOIN users l ON lr.listener_id = l.id
             WHERE lr.user_id = $1
             ORDER BY lr.created_at DESC`,
            [userId]
        );

        // 7. Conversations
        const { rows: conversations } = await pool.query(
            `SELECT uc.id, uc.started_at, uc.ended_at, uc.status,
                    EXTRACT(EPOCH FROM (uc.ended_at - uc.started_at)) AS duration_seconds,
                    uc.user_id, cu.name AS user_name,
                    uc.listener_id, cl.name AS listener_name
             FROM user_conversations uc
             JOIN users cu ON uc.user_id = cu.id
             JOIN users cl ON uc.listener_id = cl.id
             WHERE uc.user_id = $1 OR uc.listener_id = $1
             ORDER BY uc.started_at DESC
             LIMIT 50`,
            [userId]
        );

        // 8. Minute balance
        const { rows: minuteRows } = await pool.query(
            `SELECT free_minutes, purchased_minutes, remaining_minutes, updated_at
             FROM user_minutes
             WHERE user_id = $1`,
            [userId]
        );
        const minutes = minuteRows[0] || null;

        // 9. Minute transactions
        const { rows: minuteTransactions } = await pool.query(
            `SELECT id, user_id, listener_id, type, source, minutes, amount, reference_id, created_at
             FROM minute_transactions
             WHERE user_id = $1 OR listener_id = $1
             ORDER BY created_at DESC
             LIMIT 50`,
            [userId]
        );

        // 10. Payments
        const { rows: payments } = await pool.query(
            `SELECT p.id, p.amount, p.payment_gateway, p.payment_id, p.status, p.created_at,
                    mp.id AS package_id, mp.package_name, mp.minutes AS package_minutes, mp.price AS package_price
             FROM payments p
             LEFT JOIN minute_packages mp ON p.package_id = mp.id
             WHERE p.user_id = $1
             ORDER BY p.created_at DESC
             LIMIT 50`,
            [userId]
        );

        // 11. Saved listeners
        const { rows: savedListeners } = await pool.query(
            `SELECT sl.id, sl.listener_id, l.name AS listener_name, l.profile_photo, sl.created_at
             FROM saved_listeners sl
             JOIN users l ON sl.listener_id = l.id
             WHERE sl.user_id = $1`,
            [userId]
        );
        savedListeners.forEach(s => {
            if (s.profile_photo) s.profile_photo = `${BASE_URL}/uploads/${s.profile_photo}`;
        });

        // 12. Notification settings
        const { rows: notifRows } = await pool.query(
            `SELECT saved_listener_online, checkin_reminders, product_updates, updated_at
             FROM notification_settings
             WHERE user_id = $1`,
            [userId]
        );
        const notificationSettings = notifRows[0] || null;

        // 13. Saved cards
        const { rows: cards } = await pool.query(
            `SELECT id, provider, card_last4, card_brand, is_default, created_at
             FROM card_payment
             WHERE user_id = $1`,
            [userId]
        );

        res.status(200).json({
            status: true,
            message: 'User details fetched successfully.',
            data: {
                user, listener_details: listenerDetails, languages, interests,
                reviews_received: reviewsReceived, reviews_given: reviewsGiven,
                conversations, minutes, minute_transactions: minuteTransactions,
                payments, saved_listeners: savedListeners,
                notification_settings: notificationSettings, cards
            }
        });
    } catch (error) {
        console.error('Fetch user details error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});
// GET /api/admin/get-packages
router.get('/get-packages', auth, role('admin'), async (req, res) => {
    try {
        const { page, limit, offset } = getPagination(req.query);
        const { search, status, is_popular } = req.query;

        let conditions = ['1=1'];
        let params = [];

        // ── search ────────────────────────────────────────────────────────
        if (search !== undefined && search.trim()) {
            if (search.trim().length > 100) {
                return res.status(200).json({ status: false, message: 'search query is too long.' });
            }
            conditions.push(`package_name ILIKE $${params.length + 1}`);
            params.push(`%${search.trim()}%`);
        }

        // ── status ────────────────────────────────────────────────────────
        if (status !== undefined && status !== '') {
            if (!['true', 'false', '1', '0'].includes(String(status).toLowerCase())) {
                return res.status(200).json({ status: false, message: 'status must be true/false or 1/0.' });
            }
            conditions.push(`status = $${params.length + 1}`);
            params.push(status === 'true' || status === '1');
        }

        // ── is_popular ────────────────────────────────────────────────────
        if (is_popular !== undefined && is_popular !== '') {
            if (!['true', 'false', '1', '0'].includes(String(is_popular).toLowerCase())) {
                return res.status(200).json({ status: false, message: 'is_popular must be true/false or 1/0.' });
            }
            conditions.push(`is_popular = $${params.length + 1}`);
            params.push(is_popular === 'true' || is_popular === '1');
        }

        const WHERE = `WHERE ` + conditions.join(' AND ');

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) AS total FROM minute_packages ${WHERE}`,
            params
        );
        const total = Number(countRows[0].total);

        const { rows: packages } = await pool.query(
            `SELECT id, package_name, minutes, price, is_popular, status, created_at, updated_at
             FROM minute_packages
             ${WHERE}
             ORDER BY id DESC
             LIMIT $${params.length + 1}
             OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );

        res.status(200).json({
            status: true,
            message: 'Packages fetched successfully.',
            data: packages,
            pagination: { total, page, limit, total_pages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('Fetch packages error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/admin/add-package
router.post('/add-package', auth, role('admin'), async (req, res) => {
    try {
        let { package_name, minutes, price, is_popular, status } = req.body;

        // ── package_name ──────────────────────────────────────────────────
        if (!package_name || typeof package_name !== 'string' || !package_name.trim()) {
            return res.status(200).json({ status: false, message: 'package_name is required.' });
        }
        package_name = package_name.trim();
        if (package_name.length < 2 || package_name.length > 100) {
            return res.status(200).json({ status: false, message: 'package_name must be between 2 and 100 characters.' });
        }

        // ── minutes ───────────────────────────────────────────────────────
        if (minutes === undefined || minutes === null || minutes === '') {
            return res.status(200).json({ status: false, message: 'minutes is required.' });
        }
        if (isNaN(Number(minutes)) || !Number.isInteger(Number(minutes)) || Number(minutes) <= 0) {
            return res.status(200).json({ status: false, message: 'minutes must be a positive whole number.' });
        }
        if (Number(minutes) > 100000) {
            return res.status(200).json({ status: false, message: 'minutes value is unrealistically large.' });
        }

        // ── price ─────────────────────────────────────────────────────────
        if (price === undefined || price === null || price === '') {
            return res.status(200).json({ status: false, message: 'price is required.' });
        }
        if (isNaN(Number(price)) || Number(price) < 0) {
            return res.status(200).json({ status: false, message: 'price must be a non-negative number.' });
        }
        if (Number(price) > 100000) {
            return res.status(200).json({ status: false, message: 'price value is unrealistically large.' });
        }

        // ── is_popular / status (optional booleans) ──────────────────────
        const boolStrings = ['true', 'false', '0', '1'];
        if (is_popular !== undefined && !boolStrings.includes(String(is_popular).toLowerCase())) {
            return res.status(200).json({ status: false, message: 'is_popular must be a boolean value.' });
        }
        if (status !== undefined && !boolStrings.includes(String(status).toLowerCase())) {
            return res.status(200).json({ status: false, message: 'status must be a boolean value.' });
        }

        // ── Duplicate package_name check ───────────────────────────────────
        const { rows: existing } = await pool.query(
            `SELECT id FROM minute_packages WHERE LOWER(package_name) = LOWER($1)`,
            [package_name]
        );
        if (existing.length > 0) {
            return res.status(200).json({ status: false, message: 'A package with this name already exists.' });
        }

        const { rows } = await pool.query(
            `INSERT INTO minute_packages (package_name, minutes, price, is_popular, status)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, package_name, minutes, price, is_popular, status, created_at, updated_at`,
            [
                package_name,
                Number(minutes),
                Number(price),
                is_popular === true || is_popular === 'true' || is_popular === '1',
                status === undefined ? true : (status === true || status === 'true' || status === '1')
            ]
        );

        res.status(200).json({
            status: true,
            message: 'Package created successfully.',
            data: rows[0]
        });
    } catch (error) {
        console.error('Add package error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});
// POST /api/admin/edit-package
router.post('/edit-package', auth, role('admin'), async (req, res) => {
    try {
        let { id, package_name, minutes, price, is_popular, status } = req.body;

        // ── id validation (was missing entirely) ──────────────────────────
        if (id === undefined || id === null || id === '') {
            return res.status(200).json({ status: false, message: 'id is required.' });
        }
        if (isNaN(Number(id)) || !Number.isInteger(Number(id)) || Number(id) <= 0) {
            return res.status(200).json({ status: false, message: 'id must be a valid positive integer.' });
        }
        id = Number(id);

        const { rows: existingRows } = await pool.query(
            `SELECT id FROM minute_packages WHERE id = $1`,
            [id]
        );
        if (existingRows.length === 0) {
            return res.status(200).json({ status: false, message: 'Package not found.' });
        }

        let fields = [];
        let params = [];

        // ── package_name ──────────────────────────────────────────────────
        if (package_name !== undefined) {
            if (typeof package_name !== 'string' || !package_name.trim()) {
                return res.status(200).json({ status: false, message: 'package_name cannot be empty.' });
            }
            package_name = package_name.trim();
            if (package_name.length < 2 || package_name.length > 100) {
                return res.status(200).json({ status: false, message: 'package_name must be between 2 and 100 characters.' });
            }

            // Duplicate check (excluding this record)
            const { rows: dup } = await pool.query(
                `SELECT id FROM minute_packages WHERE LOWER(package_name) = LOWER($1) AND id != $2`,
                [package_name, id]
            );
            if (dup.length > 0) {
                return res.status(200).json({ status: false, message: 'A package with this name already exists.' });
            }

            fields.push(`package_name = $${params.length + 1}`);
            params.push(package_name);
        }

        // ── minutes ───────────────────────────────────────────────────────
        if (minutes !== undefined) {
            if (isNaN(Number(minutes)) || !Number.isInteger(Number(minutes)) || Number(minutes) <= 0) {
                return res.status(200).json({ status: false, message: 'minutes must be a positive whole number.' });
            }
            if (Number(minutes) > 100000) {
                return res.status(200).json({ status: false, message: 'minutes value is unrealistically large.' });
            }
            fields.push(`minutes = $${params.length + 1}`);
            params.push(Number(minutes));
        }

        // ── price ─────────────────────────────────────────────────────────
        if (price !== undefined) {
            if (isNaN(Number(price)) || Number(price) < 0) {
                return res.status(200).json({ status: false, message: 'price must be a non-negative number.' });
            }
            if (Number(price) > 100000) {
                return res.status(200).json({ status: false, message: 'price value is unrealistically large.' });
            }
            fields.push(`price = $${params.length + 1}`);
            params.push(Number(price));
        }

        // ── is_popular / status ───────────────────────────────────────────
        const boolStrings = ['true', 'false', '0', '1'];
        if (is_popular !== undefined) {
            if (!boolStrings.includes(String(is_popular).toLowerCase())) {
                return res.status(200).json({ status: false, message: 'is_popular must be a boolean value.' });
            }
            fields.push(`is_popular = $${params.length + 1}`);
            params.push(is_popular === true || is_popular === 'true' || is_popular === '1');
        }
        if (status !== undefined) {
            if (!boolStrings.includes(String(status).toLowerCase())) {
                return res.status(200).json({ status: false, message: 'status must be a boolean value.' });
            }
            fields.push(`status = $${params.length + 1}`);
            params.push(status === true || status === 'true' || status === '1');
        }

        if (fields.length === 0) {
            return res.status(200).json({ status: false, message: 'No fields provided to update.' });
        }

        fields.push(`updated_at = now()`);
        params.push(id);

        const { rows } = await pool.query(
            `UPDATE minute_packages
             SET ${fields.join(', ')}
             WHERE id = $${params.length}
             RETURNING id, package_name, minutes, price, is_popular, status, created_at, updated_at`,
            params
        );

        res.status(200).json({
            status: true,
            message: 'Package updated successfully.',
            data: rows[0]
        });
    } catch (error) {
        console.error('Edit package error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});
//------------------------------------
// DELETE /api/admin/delete-package/:id
router.delete('/delete-package/:id', auth, role('admin'), async (req, res) => {
    try {
        const { id } = req.params;

        if (id === undefined || id === null || id === '') {
            return res.status(200).json({ status: false, message: 'Please provide the package ID to delete.' });
        }
        if (isNaN(Number(id)) || !Number.isInteger(Number(id)) || Number(id) <= 0) {
            return res.status(200).json({ status: false, message: 'Invalid package ID provided.' });
        }

        // Check if package is referenced by any payment (avoid FK violation / orphaned history)
        const { rows: usedRows } = await pool.query(
            `SELECT COUNT(*) AS count FROM payments WHERE package_id = $1`,
            [id]
        );

        if (Number(usedRows[0].count) > 0) {
            return res.status(200).json({
                status: false,
                message: 'Cannot delete: this package has existing payment records. Consider disabling it instead (set status to false).'
            });
        }

        const { rows } = await pool.query(
            `DELETE FROM minute_packages WHERE id = $1 RETURNING id`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(200).json({ status: false, message: 'Package not found.' });
        }

        res.status(200).json({
            status: true,
            message: 'Package deleted successfully.'
        });
    } catch (error) {
        console.error('Delete package error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});
// GET /api/admin/get-settings
router.get('/get-settings', auth, role('admin'), async (req, res) => {
    try {
        const { search } = req.query;

        let conditions = ['1=1'];
        let params = [];

        if (search && search.trim()) {
            conditions.push(`(setting_key ILIKE $${params.length + 1} OR setting_value ILIKE $${params.length + 2})`);
            params.push(`%${search.trim()}%`, `%${search.trim()}%`);
        }

        const WHERE = `WHERE ` + conditions.join(' AND ');

        const { rows: settings } = await pool.query(
            `SELECT id, setting_key, setting_value, created_at, updated_at
             FROM app_settings
             ${WHERE}
             ORDER BY id ASC`,
            params
        );

        res.status(200).json({
            status: true,
            message: 'Settings fetched successfully.',
            data: settings
        });
    } catch (error) {
        console.error('Fetch settings error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});
// POST /api/admin/add-setting
router.post('/add-setting', auth, role('admin'), async (req, res) => {
    try {
        const { setting_key, setting_value } = req.body;

        if (!setting_key || !setting_key.trim()) {
            return res.status(200).json({ status: false, message: 'setting_key is required.' });
        }
        if (setting_value === undefined || setting_value === null || setting_value === '') {
            return res.status(200).json({ status: false, message: 'setting_value is required.' });
        }

        // Check for duplicate key (setting_key is UNIQUE)
        const { rows: existing } = await pool.query(
            `SELECT id FROM app_settings WHERE setting_key = $1`,
            [setting_key.trim()]
        );
        if (existing.length > 0) {
            return res.status(200).json({ status: false, message: 'A setting with this key already exists. Use edit instead.' });
        }

        const { rows } = await pool.query(
            `INSERT INTO app_settings (setting_key, setting_value)
             VALUES ($1, $2)
             RETURNING id, setting_key, setting_value, created_at, updated_at`,
            [setting_key.trim(), String(setting_value)]
        );

        res.status(200).json({
            status: true,
            message: 'Setting created successfully.',
            data: rows[0]
        });
    } catch (error) {
        console.error('Add setting error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});
// POST /api/admin/edit-setting
router.post('/edit-setting', auth, role('admin'), async (req, res) => {
    try {
        const { id, setting_key, setting_value } = req.body;

        if (!id) {
            return res.status(200).json({
                status: false,
                message: 'id is required.'
            });
        }

        // Check setting exists
        const check = await pool.query(
            `SELECT * FROM app_settings WHERE id = $1`,
            [id]
        );

        if (check.rows.length === 0) {
            return res.status(200).json({
                status: false,
                message: 'Setting not found.'
            });
        }

        const updates = [];
        const values = [];
        let index = 1;

        if (setting_key !== undefined) {
            updates.push(`setting_key = $${index++}`);
            values.push(setting_key);
        }

        if (setting_value !== undefined) {
            updates.push(`setting_value = $${index++}`);
            values.push(String(setting_value));
        }

        if (updates.length === 0) {
            return res.status(200).json({
                status: false,
                message: 'Nothing to update.'
            });
        }

        updates.push(`updated_at = NOW()`);

        values.push(id);

        const { rows } = await pool.query(
            `UPDATE app_settings
             SET ${updates.join(', ')}
             WHERE id = $${index}
             RETURNING *`,
            values
        );

        return res.status(200).json({
            status: true,
            message: 'Setting updated successfully.',
            data: rows[0]
        });

    } catch (error) {
        console.error(error);
        return res.status(200).json({
            status: false,
            message: error.message
        });
    }
});
// DELETE /api/admin/delete-setting/:key
router.delete('/delete-setting/:id', auth, role('admin'), async (req, res) => {
    try {
        const { id } = req.params;

        if (id === undefined || id === null || id === '') {
            return res.status(200).json({ status: false, message: 'Please provide the setting ID to delete.' });
        }
        if (isNaN(Number(id)) || !Number.isInteger(Number(id)) || Number(id) <= 0) {
            return res.status(200).json({ status: false, message: 'Invalid setting ID provided.' });
        }

        const { rows } = await pool.query(
            `DELETE FROM app_settings WHERE id = $1 RETURNING id`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(200).json({ status: false, message: 'Setting not found.' });
        }

        res.status(200).json({
            status: true,
            message: 'Setting deleted successfully.'
        });
    } catch (error) {
        console.error('Delete setting error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});
// GET /api/admin/dashboard
router.get('/dashboard', auth, role('admin'), async (req, res) => {
    try {
        // Run independent queries in parallel for speed
        const [
            userStats,
            listenerStats,
            revenueStats,
            callStats,
            recentSignups,
            recentPayments,
            topListeners,
            pendingApplications
        ] = await Promise.all([

            // 1. User counts
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE user_type = 'user') AS total_users,
                    COUNT(*) FILTER (WHERE user_type = 'user' AND status = 1) AS active_users,
                    COUNT(*) FILTER (WHERE user_type = 'user' AND status = 0) AS blocked_users,
                    COUNT(*) FILTER (WHERE user_type = 'user' AND created_at >= NOW() - INTERVAL '30 days') AS new_users_30d,
                    COUNT(*) FILTER (WHERE user_type = 'user' AND created_at >= NOW() - INTERVAL '7 days') AS new_users_7d
                FROM users
            `),

            // 2. Listener counts / application funnel
            pool.query(`
                SELECT
                    COUNT(*) AS total_listeners,
                    COUNT(*) FILTER (WHERE ld.application_status = 1) AS pending_applications,
                    COUNT(*) FILTER (WHERE ld.application_status = 2) AS approved_listeners,
                    COUNT(*) FILTER (WHERE ld.application_status = 3) AS rejected_listeners,
                    COUNT(*) FILTER (WHERE ld.available_now = true) AS available_now,
                    COUNT(*) FILTER (WHERE ld.premium_boost = true) AS premium_boost_count
                FROM users u
                JOIN listener_details ld ON u.id = ld.user_id
                WHERE u.user_type = 'listener'
            `),

            // 3. Revenue
            pool.query(`
                SELECT
                    COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0) AS total_revenue,
                    COALESCE(SUM(amount) FILTER (WHERE status = 'success' AND created_at >= NOW() - INTERVAL '30 days'), 0) AS revenue_30d,
                    COALESCE(SUM(amount) FILTER (WHERE status = 'success' AND created_at >= NOW() - INTERVAL '7 days'), 0) AS revenue_7d,
                    COALESCE(SUM(amount) FILTER (WHERE status = 'success' AND created_at >= CURRENT_DATE), 0) AS revenue_today,
                    COUNT(*) FILTER (WHERE status = 'success') AS successful_payments,
                    COUNT(*) FILTER (WHERE status = 'failed') AS failed_payments
                FROM payments
            `),

            // 4. Calls / conversations
            pool.query(`
                SELECT
                    COUNT(*) AS total_calls,
                    COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '30 days') AS calls_30d,
                    COUNT(*) FILTER (WHERE started_at >= CURRENT_DATE) AS calls_today,
                    COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (ended_at - started_at))/60) FILTER (WHERE ended_at IS NOT NULL), 1), 0) AS avg_duration_minutes,
                    COUNT(*) FILTER (WHERE status = 'completed') AS completed_calls,
                    COUNT(*) FILTER (WHERE status != 'completed') AS other_status_calls
                FROM user_conversations
            `),

            // 5. Recent signups (mixed users + listeners)
            pool.query(`
                SELECT id, name, email, user_type, created_at
                FROM users
                WHERE user_type IN ('user', 'listener')
                ORDER BY created_at DESC
                LIMIT 5
            `),

            // 6. Recent payments
            pool.query(`
                SELECT p.id, p.amount, p.status, p.payment_gateway, p.created_at,
                       u.name AS user_name, u.email AS user_email
                FROM payments p
                JOIN users u ON p.user_id = u.id
                ORDER BY p.created_at DESC
                LIMIT 5
            `),

            // 7. Top rated / most active listeners
            pool.query(`
                SELECT u.id, u.name, u.profile_photo, ld.rating, ld.total_reviews, ld.total_calls
                FROM users u
                JOIN listener_details ld ON u.id = ld.user_id
                WHERE u.user_type = 'listener' AND ld.application_status = 2
                ORDER BY ld.rating DESC NULLS LAST, ld.total_reviews DESC
                LIMIT 5
            `),

            // 8. Pending applications needing admin attention
            pool.query(`
                SELECT u.id, u.name, u.email, ld.created_at
                FROM users u
                JOIN listener_details ld ON u.id = ld.user_id
                WHERE ld.application_status = 1
                ORDER BY ld.created_at ASC
                LIMIT 5
            `)
        ]);

        const BASE_URL = `${req.protocol}://${req.get('host')}`;

        const topListenersData = topListeners.rows.map(l => ({
            ...l,
            profile_photo: l.profile_photo ? `${BASE_URL}/uploads/${l.profile_photo}` : null,
            rating: l.rating ? Number(l.rating) : 0
        }));

        res.status(200).json({
            status: true,
            message: 'Dashboard data fetched successfully.',
            data: {
                users: userStats.rows[0],
                listeners: listenerStats.rows[0],
                revenue: revenueStats.rows[0],
                calls: callStats.rows[0],
                recent_signups: recentSignups.rows,
                recent_payments: recentPayments.rows,
                top_listeners: topListenersData,
                pending_applications: pendingApplications.rows
            }
        });

    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});
// POST /api/admin/logout
router.post('/logout', auth, role('admin'), async (req, res) => {
    try {

        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(200).json({
                status: false,
                message: "Bearer token is required."
            });
        }

        const token = authHeader.split(' ')[1];

        // Decode JWT to get expiry time
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');

        const expires_at = new Date(decoded.exp * 1000);

        await pool.query(
            `INSERT INTO blacklisted_tokens
            (
                token,
                expires_at
            )
            VALUES
            ($1, $2)
            ON CONFLICT (token) DO NOTHING`,
            [token, expires_at]
        );

        return res.status(200).json({
            status: true,
            message: "Admin logged out successfully."
        });

    } catch (error) {

        console.error('Admin logout error:', error);

        return res.status(200).json({
            status: false,
            message: error.message
        });

    }
});

//─────────────────────────────────────────────────────────────────────────────//

// GET /api/admin/get-setting/:key
router.get('/get-setting/:key', auth, role('admin'), async (req, res) => {
    try {
        const { key } = req.params;

        const { rows } = await pool.query(
            `SELECT id, setting_key, setting_value, created_at, updated_at
             FROM app_settings
             WHERE setting_key = $1`,
            [key]
        );

        if (rows.length === 0) {
            return res.status(200).json({ status: false, message: 'Setting not found.' });
        }

        res.status(200).json({
            status: true,
            message: 'Setting fetched successfully.',
            data: rows[0]
        });
    } catch (error) {
        console.error('Fetch setting error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. BLOCK / UNBLOCK LISTENER
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/block-listener
// Body: { user_id, status }  — 0 = Blocked, 1 = Active
router.post('/block-listener', auth, role('admin'), async (req, res) => {
    try {
        const { user_id, status } = req.body;

        if (user_id === undefined || user_id === null || user_id === '') {
            return res.json({
                status: false,
                message: 'Please provide the listener ID.'
            });
        }
        if (isNaN(Number(user_id)) || !Number.isInteger(Number(user_id)) || Number(user_id) <= 0) {
            return res.json({ status: false, message: 'Invalid listener ID provided.' });
        }

        if (status === undefined || status === null || status === '') {
            return res.json({
                status: false,
                message: 'Please provide the status (0 to block, 1 to activate).'
            });
        }

        if (![0, 1].includes(Number(status))) {
            return res.json({
                status: false,
                message: 'Status must be 0 (Blocked) or 1 (Active).'
            });
        }

        const { rows: listener } = await pool.query(
            `SELECT id FROM users WHERE id = $1 AND user_type = 'listener'`,
            [user_id]
        );

        if (listener.length === 0) {
            return res.json({
                status: false,
                message: 'Listener not found.'
            });
        }

        await pool.query(
            `UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2`,
            [Number(status), user_id]
        );

        res.json({
            status: true,
            message: Number(status) === 1
                ? 'Listener activated successfully.'
                : 'Listener blocked successfully.'
        });

    } catch (error) {
        console.error(error);
        res.json({ status: false, message: error.message });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// 2. DELETE A REVIEW (moderation) — recalculates listener rating after removal
// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/delete-review/:id
router.delete('/delete-review/:id', auth, role('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;

        if (id === undefined || id === null || id === '') {
            return res.json({ status: false, message: 'Please provide the review ID to delete.' });
        }
        if (isNaN(Number(id)) || !Number.isInteger(Number(id)) || Number(id) <= 0) {
            return res.json({ status: false, message: 'Invalid review ID provided.' });
        }

        await client.query('BEGIN');

        const { rows: reviewRows } = await client.query(
            `SELECT listener_id FROM listener_reviews WHERE id = $1`,
            [id]
        );

        if (reviewRows.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ status: false, message: 'Review not found.' });
        }

        const listener_id = reviewRows[0].listener_id;

        await client.query(`DELETE FROM listener_reviews WHERE id = $1`, [id]);

        // Recalculate rating & total_reviews for that listener
        const { rows: stats } = await client.query(
            `SELECT
                ROUND(AVG(rating)::numeric, 1) AS rating,
                COUNT(*) AS total_reviews
             FROM listener_reviews
             WHERE listener_id = $1`,
            [listener_id]
        );

        await client.query(
            `UPDATE listener_details
             SET rating = COALESCE($1, 5.0), total_reviews = $2
             WHERE user_id = $3`,
            [stats[0].rating, stats[0].total_reviews, listener_id]
        );

        await client.query('COMMIT');

        res.json({
            status: true,
            message: 'Review deleted successfully.',
            data: {
                listener_id,
                new_rating: stats[0].rating ? Number(stats[0].rating) : 5.0,
                total_reviews: Number(stats[0].total_reviews)
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.json({ status: false, message: error.message });
    } finally {
        client.release();
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// 3. REFUND / UPDATE PAYMENT STATUS — reverses purchased minutes on refund
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/update-payment-status
// Body: { payment_id, status }  — e.g. 'refunded', 'failed', 'success'
router.post('/update-payment-status', auth, role('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { payment_id, status } = req.body;

        if (!payment_id || !status || !status.trim()) {
            return res.json({ status: false, message: 'payment_id and status are required.' });
        }

        await client.query('BEGIN');

        const { rows: paymentRows } = await client.query(
            `SELECT p.id, p.user_id, p.status AS old_status, p.package_id, mp.minutes
             FROM payments p
             LEFT JOIN minute_packages mp ON p.package_id = mp.id
             WHERE p.id = $1`,
            [payment_id]
        );

        if (paymentRows.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ status: false, message: 'Payment not found.' });
        }

        const payment = paymentRows[0];

        await client.query(
            `UPDATE payments SET status = $1 WHERE id = $2`,
            [status.trim(), payment_id]
        );

        // If transitioning INTO refunded (and wasn't already refunded), reverse the minutes
        let minutesReversed = 0;
        if (status.trim() === 'refunded' && payment.old_status !== 'refunded' && payment.minutes) {
            minutesReversed = payment.minutes;

            await client.query(
                `UPDATE user_minutes
                 SET purchased_minutes = GREATEST(0, purchased_minutes - $1),
                     remaining_minutes = GREATEST(0, remaining_minutes - $1),
                     updated_at = NOW()
                 WHERE user_id = $2`,
                [minutesReversed, payment.user_id]
            );

            await client.query(
                `INSERT INTO minute_transactions (user_id, type, source, minutes, amount, reference_id)
                 VALUES ($1, 'debit', 'refund', $2, 0, $3)`,
                [payment.user_id, -Math.abs(minutesReversed), payment_id]
            );
        }

        await client.query('COMMIT');

        res.json({
            status: true,
            message: `Payment status updated to '${status.trim()}' successfully.`,
            data: { minutes_reversed: minutesReversed }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.json({ status: false, message: error.message });
    } finally {
        client.release();
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// 4. MANUALLY ADJUST A USER'S MINUTE BALANCE — auditable via minute_transactions
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/adjust-minutes
// Body: { user_id, minutes, reason }  — minutes can be negative (deduct) or positive (grant)
router.post('/adjust-minutes', auth, role('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { user_id, minutes, reason } = req.body;

        if (!user_id || minutes === undefined || Number(minutes) === 0) {
            return res.json({ status: false, message: 'user_id and a non-zero minutes value are required.' });
        }

        await client.query('BEGIN');

        const { rows: userRows } = await client.query(
            `SELECT id FROM users WHERE id = $1`,
            [user_id]
        );
        if (userRows.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ status: false, message: 'User not found.' });
        }

        // Ensure a user_minutes row exists
        const { rows: minuteRows } = await client.query(
            `SELECT id, remaining_minutes FROM user_minutes WHERE user_id = $1`,
            [user_id]
        );

        const delta = Number(minutes);

        if (minuteRows.length === 0) {
            await client.query(
                `INSERT INTO user_minutes (user_id, free_minutes, purchased_minutes, remaining_minutes)
                 VALUES ($1, 0, GREATEST(0, $2), GREATEST(0, $2))`,
                [user_id, delta]
            );
        } else {
            await client.query(
                `UPDATE user_minutes
                 SET remaining_minutes = GREATEST(0, remaining_minutes + $1),
                     purchased_minutes = CASE WHEN $1 > 0 THEN purchased_minutes + $1 ELSE purchased_minutes END,
                     updated_at = NOW()
                 WHERE user_id = $2`,
                [delta, user_id]
            );
        }

        await client.query(
            `INSERT INTO minute_transactions (user_id, type, source, minutes, amount)
             VALUES ($1, $2, 'admin_adjustment', $3, 0)`,
            [user_id, delta > 0 ? 'credit' : 'debit', delta]
        );

        await client.query('COMMIT');

        const { rows: updated } = await pool.query(
            `SELECT remaining_minutes FROM user_minutes WHERE user_id = $1`,
            [user_id]
        );

        res.json({
            status: true,
            message: `${delta > 0 ? 'Granted' : 'Deducted'} ${Math.abs(delta)} minute(s) successfully.`,
            data: {
                new_remaining_minutes: updated[0].remaining_minutes,
                reason: reason || null
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.json({ status: false, message: error.message });
    } finally {
        client.release();
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// 5. DELETE A REGULAR USER (admin-side) — cleans up all dependent rows first
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/delete-user
// Body: { user_id }
router.post('/delete-user', auth, role('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { user_id } = req.body;

        if (user_id === undefined || user_id === null || user_id === '') {
            return res.json({ status: false, message: 'Please provide the user ID to delete.' });
        }
        if (isNaN(Number(user_id)) || !Number.isInteger(Number(user_id)) || Number(user_id) <= 0) {
            return res.json({ status: false, message: 'Invalid user ID provided.' });
        }

        await client.query('BEGIN');

        const { rows } = await client.query(
            `SELECT id FROM users WHERE id = $1 AND user_type = 'user'`,
            [user_id]
        );

        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ status: false, message: 'User not found.' });
        }

        // Clean up all FK-dependent rows before deleting the user itself
        await client.query(`DELETE FROM notification_settings WHERE user_id = $1`, [user_id]);
        await client.query(`DELETE FROM card_payment WHERE user_id = $1`, [user_id]);
        await client.query(`DELETE FROM saved_listeners WHERE user_id = $1`, [user_id]);
        await client.query(`DELETE FROM user_interests WHERE user_id = $1`, [user_id]);
        await client.query(`DELETE FROM listener_preferred_languages WHERE user_id = $1`, [user_id]);
        await client.query(`DELETE FROM listener_reviews WHERE user_id = $1`, [user_id]);
        await client.query(`DELETE FROM minute_transactions WHERE user_id = $1`, [user_id]);
        await client.query(`DELETE FROM payments WHERE user_id = $1`, [user_id]);
        await client.query(`DELETE FROM user_minutes WHERE user_id = $1`, [user_id]);
        await client.query(`DELETE FROM user_conversations WHERE user_id = $1`, [user_id]);
        await client.query(`DELETE FROM users WHERE id = $1`, [user_id]);

        await client.query('COMMIT');

        res.json({ status: true, message: 'User deleted successfully.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.json({ status: false, message: error.message });
    } finally {
        client.release();
    }
});
// Helper: shared listener SELECT fragment
const LISTENER_SELECT = `
    SELECT
        u.id, u.name, u.email, u.phone, u.profile_photo,
        ld.current_location, ld.home_country, ld.university_email,
        ld.profile_type, ld.primary_voice, ld.secondary_voice,
        ld.ready_to_start, ld.premium_boost, ld.code_of_conduct_agreed,
        ld.application_status, ld.profile_photo_status, ld.primary_voice_status, ld.secondary_voice_status,
        STRING_AGG(DISTINCT i.interest_name, ', ') AS interests
    FROM users u
    JOIN listener_details ld ON u.id = ld.user_id
    LEFT JOIN listener_interests li ON li.user_id = u.id
    LEFT JOIN interests i ON i.id = li.interest_id
    WHERE u.user_type = 'listener'
`;

// Helper: attach languages array to a list of listeners
async function attachLanguages(listeners) {
    if (!listeners.length) return;
    const ids = listeners.map(l => l.id);
    const { rows: languages } = await pool.query(`
        SELECT ul.user_id, ul.language_id, l.language_name AS language,
               ul.fluency_level_id, fl.level_name AS fluency
        FROM listener_preferred_languages ul
        JOIN languages l  ON ul.language_id = l.id
        JOIN fluency_levels fl ON ul.fluency_level_id = fl.id
        WHERE ul.user_id = ANY($1::int[])
    `, [ids]);
    const map = {};
    languages.forEach(lang => {
        if (!map[lang.user_id]) map[lang.user_id] = [];
        map[lang.user_id].push({
            language_id: lang.language_id,
            language: lang.language,
            fluency_level_id: lang.fluency_level_id,
            fluency: lang.fluency
        });
    });
    listeners.forEach(l => { l.languages = map[l.id] || []; });
}

// Helper: parse & validate pagination params
function getPagination(query) {
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 10));
    const offset = (page - 1) * limit;
    return { page, limit, offset };
}

// GET /api/admin/dashboard-old
router.get('/dashboard-old', auth, role('admin'), async (req, res) => {
    try {
        const { rows: countRows } = await pool.query(`
            SELECT
                COUNT(*) AS total_listeners,
                SUM(CASE WHEN ld.application_status = 1 THEN 1 ELSE 0 END) AS submitted,
                SUM(CASE WHEN ld.application_status = 2 THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN ld.application_status = 3 THEN 1 ELSE 0 END) AS rejected
            FROM users u
            JOIN listener_details ld ON u.id = ld.user_id
            WHERE u.user_type = 'listener'
        `);
        res.status(200).json({ status: true, data: countRows[0] });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// GET /api/admin/pending-listeners?page=1&limit=10
router.get('/pending-listeners', auth, role('admin'), async (req, res) => {
    try {
        const { page, limit, offset } = getPagination(req.query);
        const WHERE = LISTENER_SELECT + ` AND ld.application_status = 1`;

        const { rows: totalRows } = await pool.query(
            `SELECT COUNT(*) AS total FROM users u JOIN listener_details ld ON u.id = ld.user_id WHERE u.user_type = 'listener' AND ld.application_status = 1`
        );
        const total = totalRows[0].total;

        const { rows: listeners } = await pool.query(WHERE + ` ORDER BY u.id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
        await attachLanguages(listeners);

        res.status(200).json({
            status: true,
            message: 'Pending listeners fetched.',
            data: listeners,
            pagination: { total, page, limit, total_pages: Math.ceil(total / limit) }
        });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// GET /api/admin/approved-listeners?page=1&limit=10
router.get('/approved-listeners', auth, role('admin'), async (req, res) => {
    try {
        const { page, limit, offset } = getPagination(req.query);
        const WHERE = LISTENER_SELECT + ` AND ld.application_status = 2`;

        const { rows: totalRows } = await pool.query(
            `SELECT COUNT(*) AS total FROM users u JOIN listener_details ld ON u.id = ld.user_id WHERE u.user_type = 'listener' AND ld.application_status = 2`
        );
        const total = totalRows[0].total;

        const { rows: listeners } = await pool.query(WHERE + ` ORDER BY u.id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
        await attachLanguages(listeners);

        res.status(200).json({
            status: true,
            message: 'Approved listeners fetched.',
            data: listeners,
            pagination: { total, page, limit, total_pages: Math.ceil(total / limit) }
        });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// GET /api/admin/rejected-listeners?page=1&limit=10
router.get('/rejected-listeners', auth, role('admin'), async (req, res) => {
    try {
        const { page, limit, offset } = getPagination(req.query);
        const WHERE = LISTENER_SELECT + ` AND ld.application_status = 3`;

        const { rows: totalRows } = await pool.query(
            `SELECT COUNT(*) AS total FROM users u JOIN listener_details ld ON u.id = ld.user_id WHERE u.user_type = 'listener' AND ld.application_status = 3`
        );
        const total = totalRows[0].total;

        const { rows: listeners } = await pool.query(WHERE + ` ORDER BY u.id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
        await attachLanguages(listeners);

        res.status(200).json({
            status: true,
            message: 'Rejected listeners fetched.',
            data: listeners,
            pagination: { total, page, limit, total_pages: Math.ceil(total / limit) }
        });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// GET /api/admin/search-listeners?search=john&page=1&limit=10
router.get('/search-listeners', auth, role('admin'), async (req, res) => {
    try {
        const { page, limit, offset } = getPagination(req.query);
        const search = req.query.search || '';
        const like = `%${search}%`;

        const { rows: totalRows } = await pool.query(
            `SELECT COUNT(*) AS total FROM users u JOIN listener_details ld ON u.id = ld.user_id
             WHERE u.user_type = 'listener'
             AND (u.name LIKE $1 OR u.email LIKE $2 OR ld.home_country LIKE $3 OR ld.university_email LIKE $4)`,
            [like, like, like, like]
        );
        const total = totalRows[0].total;

        const { rows: listeners } = await pool.query(
            LISTENER_SELECT + ` AND (u.name LIKE $1 OR u.email LIKE $2 OR ld.home_country LIKE $3 OR ld.university_email LIKE $4) ORDER BY u.id DESC LIMIT $5 OFFSET $6`,
            [like, like, like, like, limit, offset]
        );
        await attachLanguages(listeners);

        res.status(200).json({
            status: true,
            message: 'Search results.',
            data: listeners,
            pagination: { total, page, limit, total_pages: Math.ceil(total / limit) }
        });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/admin/delete-listener
router.post('/delete-listener', auth, role('admin'), async (req, res) => {
    try {
        const { user_id } = req.body;
        if (!user_id) return res.status(200).json({ status: false, message: 'User ID is required.' });

        await pool.query('DELETE FROM listener_details WHERE user_id = $1', [user_id]);
        await pool.query('DELETE FROM listener_preferred_languages WHERE user_id = $1', [user_id]);
        await pool.query('DELETE FROM users WHERE id = $1 AND user_type = \'listener\'', [user_id]);

        res.status(200).json({ status: true, message: 'Listener deleted successfully.' });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/admin/update-premium-boost
router.post('/update-premium-boost', auth, role('admin'), async (req, res) => {
    try {
        const { user_id, premium_boost } = req.body;
        if (!user_id || premium_boost === undefined) return res.status(200).json({ status: false, message: 'User ID and premium_boost are required.' });
        if (![0, 1].includes(Number(premium_boost))) return res.status(200).json({ status: false, message: 'premium_boost must be 0 or 1.' });

        const result = await pool.query('UPDATE listener_details SET premium_boost = $1 WHERE user_id = $2', [Number(premium_boost), user_id]);
        if (result.rowCount === 0) return res.status(200).json({ status: false, message: 'Listener not found.' });

        res.status(200).json({ status: true, message: `Premium boost ${Number(premium_boost) === 1 ? 'enabled' : 'disabled'} successfully.` });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// GET /api/admin/get-listener/:user_id
// Get full details of a single listener (profile + listener_details + languages)
router.get('/get-listener/:user_id', auth, role('admin'), async (req, res) => {
    try {
        const { user_id } = req.params;

        const { rows: listener } = await pool.query(`
            SELECT
                u.id, u.name, u.email, u.phone, u.profile_photo,
                ld.current_location, ld.home_country, ld.university_email,
                ld.profile_type, ld.primary_voice, ld.secondary_voice,
                ld.ready_to_start, ld.premium_boost, ld.code_of_conduct_agreed,
                ld.application_status, ld.profile_photo_status,
                ld.primary_voice_status, ld.secondary_voice_status,
                COALESCE(ld.unsettled_amount, 0.00) AS unsettled_amount,
                COALESCE(ld.settled_amount, 0.00) AS settled_amount,
                COALESCE(ld.total_calls, 0) AS total_calls,
                ld.call_price,
                ld.rating
            FROM users u
            JOIN listener_details ld ON u.id = ld.user_id
            WHERE u.id = $1 AND u.user_type = 'listener'
        `, [user_id]);

        if (listener.length === 0)
            return res.status(200).json({ status: false, message: 'Listener not found.' });

        const { rows: languages } = await pool.query(`
            SELECT ul.language_id, l.language_name AS language,
                   ul.fluency_level_id, fl.level_name AS fluency
            FROM listener_preferred_languages ul
            JOIN languages l  ON ul.language_id = l.id
            JOIN fluency_levels fl ON ul.fluency_level_id = fl.id
            WHERE ul.user_id = $1
        `, [user_id]);

        // Fetch interests from listener_interests table
        const { rows: interests } = await pool.query(`
            SELECT i.id, i.interest_name
            FROM listener_interests li
            JOIN interests i ON i.id = li.interest_id
            WHERE li.user_id = $1
            ORDER BY i.interest_name
        `, [user_id]);

        const BASE_URL = `${req.protocol}://${req.get('host')}`;
        const l = listener[0];
        if (l.profile_photo) l.profile_photo = `${BASE_URL}/uploads/${l.profile_photo}`;
        if (l.primary_voice) l.primary_voice = `${BASE_URL}/uploads/${l.primary_voice}`;
        if (l.secondary_voice) l.secondary_voice = `${BASE_URL}/uploads/${l.secondary_voice}`;
        l.languages = languages;
        l.interests = interests;

        res.status(200).json({ status: true, data: l });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/admin/edit-listener
// Edit an existing listener's details (files optional — only replaces if new file provided)
// Body (multipart/form-data): user_id (required), + any fields to update
router.post(
    '/edit-listener',
    auth, role('admin'),
    upload.fields([
        { name: 'profile_photo', maxCount: 1 },
        { name: 'primary_voice', maxCount: 1 },
        { name: 'secondary_voice', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const { user_id, full_name, current_location, home_country,
                university_email, interests, profile_type,
                ready_to_start, premium_boost } = req.body;

            if (!user_id)
                return res.status(200).json({ status: false, message: 'user_id is required.' });

            // Verify listener exists
            const { rows: exists } = await pool.query(
                `SELECT u.id FROM users u
                 JOIN listener_details ld ON u.id = ld.user_id
                 WHERE u.id = $1 AND u.user_type = 'listener'`,
                [user_id]
            );
            if (exists.length === 0)
                return res.status(200).json({ status: false, message: 'Listener not found.' });

            // ── Update users table ──────────────────────────────────────────
            const userUpdates = [];
            const userParams = [];
            if (full_name) { userUpdates.push('name = ?'); userParams.push(full_name); }
            if (req.files?.profile_photo) {
                userUpdates.push('profile_photo = ?');
                userParams.push(req.files.profile_photo[0].filename);
            }
            if (userUpdates.length > 0) {
                let queryStr = `UPDATE users SET ${userUpdates.join(', ')} WHERE id = ?`;
                let pIndex = 1;
                queryStr = queryStr.replace(/\?/g, () => `$${pIndex++}`);
                userParams.push(user_id);
                await pool.query(queryStr, userParams);
            }

            // ── Update listener_details table ──────────────────────────────
            const ldUpdates = [];
            const ldParams = [];
            if (current_location) { ldUpdates.push('current_location = ?'); ldParams.push(current_location); }
            if (home_country) { ldUpdates.push('home_country = ?'); ldParams.push(home_country); }
            if (university_email) { ldUpdates.push('university_email = ?'); ldParams.push(university_email); }
            if (interests) { ldUpdates.push('interests = ?'); ldParams.push(interests); }
            if (profile_type) { ldUpdates.push('profile_type = ?'); ldParams.push(profile_type); }
            if (ready_to_start !== undefined) { ldUpdates.push('ready_to_start = ?'); ldParams.push(ready_to_start); }
            if (premium_boost !== undefined) { ldUpdates.push('premium_boost = ?'); ldParams.push(Number(premium_boost)); }
            if (req.files?.primary_voice) {
                ldUpdates.push('primary_voice = ?', 'primary_voice_status = 1');
                ldParams.push(req.files.primary_voice[0].filename);
            }
            if (req.files?.secondary_voice) {
                ldUpdates.push('secondary_voice = ?', 'secondary_voice_status = 1');
                ldParams.push(req.files.secondary_voice[0].filename);
            }

            if (ldUpdates.length > 0) {
                let queryStr = `UPDATE listener_details SET ${ldUpdates.join(', ')} WHERE user_id = ?`;
                let pIndex = 1;
                queryStr = queryStr.replace(/\?/g, () => `$${pIndex++}`);
                ldParams.push(user_id);
                await pool.query(queryStr, ldParams);
            }

            // ── Update languages (if provided) ─────────────────────────────
            if (req.body.languages) {
                let languages = [];
                try { languages = JSON.parse(req.body.languages); } catch (_) { }
                if (Array.isArray(languages) && languages.length > 0) {
                    await pool.query('DELETE FROM listener_preferred_languages WHERE user_id = $1', [user_id]);
                    for (const lang of languages) {
                        await pool.query(
                            'INSERT INTO listener_preferred_languages (user_id, language_id, fluency_level_id) VALUES ($1, $2, $3)',
                            [user_id, lang.language_id, lang.fluency_level_id]
                        );
                    }
                }
            }

            res.status(200).json({ status: true, message: 'Listener updated successfully.' });
        } catch (error) {
            res.status(200).json({ status: false, message: error.message });
        }
    }
);

// POST /api/admin/update-application-status
// Manually override a listener's application status
// Body: { user_id, application_status }  — 1=submitted, 2=approved, 3=rejected
router.post('/update-application-status', auth, role('admin'), async (req, res) => {
    try {
        const { user_id, application_status } = req.body;

        if (!user_id || application_status === undefined)
            return res.status(200).json({ status: false, message: 'user_id and application_status are required.' });

        if (![1, 2, 3].includes(Number(application_status)))
            return res.status(200).json({ status: false, message: 'application_status must be 1 (submitted), 2 (approved), or 3 (rejected).' });

        const result = await pool.query(
            'UPDATE listener_details SET application_status = $1 WHERE user_id = $2',
            [Number(application_status), user_id]
        );

        if (result.rowCount === 0)
            return res.status(200).json({ status: false, message: 'Listener not found.' });

        const labels = { 1: 'submitted', 2: 'approved', 3: 'rejected' };
        res.status(200).json({ status: true, message: `Application status updated to '${labels[Number(application_status)]}' successfully.` });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ACCOUNT APIS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/admin/profile
// Get the currently logged-in admin's profile
router.get('/profile', auth, role('admin'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, name, email, phone, profile_photo, user_type FROM users WHERE id = $1',
            [req.user.id]
        );
        if (rows.length === 0)
            return res.status(200).json({ status: false, message: 'Admin not found.' });

        res.status(200).json({ status: true, data: rows[0] });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/admin/change-password
// Admin changes their own password
// Body: { current_password, new_password, confirm_password }
router.post('/change-password', auth, role('admin'), async (req, res) => {
    try {
        const { current_password, new_password, confirm_password } = req.body;

        if (!current_password || !new_password || !confirm_password)
            return res.status(200).json({ status: false, message: 'current_password, new_password, and confirm_password are required.' });

        if (new_password !== confirm_password)
            return res.status(200).json({ status: false, message: 'new_password and confirm_password do not match.' });

        if (new_password.length < 6)
            return res.status(200).json({ status: false, message: 'New password must be at least 6 characters.' });

        const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        if (rows.length === 0)
            return res.status(200).json({ status: false, message: 'Admin not found.' });

        const isMatch = await bcrypt.compare(current_password, rows[0].password);
        if (!isMatch)
            return res.status(200).json({ status: false, message: 'Current password is incorrect.' });

        const hashed = await bcrypt.hash(new_password, 12);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.user.id]);

        res.status(200).json({ status: true, message: 'Password changed successfully.' });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// LISTENER UTILITY APIS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/admin/filter-options
// Returns distinct values used in listener records — useful for populating
// filter dropdowns in the admin panel (countries, profile_types, languages)
router.get('/filter-options', auth, role('admin'), async (req, res) => {
    try {
        const [
            { rows: countries },
            { rows: profileTypes },
            { rows: languages }
        ] = await Promise.all([
            pool.query(`
                SELECT DISTINCT home_country AS value
                FROM listener_details
                WHERE home_country IS NOT NULL AND home_country != ''
                ORDER BY home_country ASC
            `),
            pool.query(`
                SELECT DISTINCT profile_type AS value
                FROM listener_details
                WHERE profile_type IS NOT NULL AND profile_type != ''
                ORDER BY profile_type ASC
            `),
            pool.query(`
                SELECT l.id, l.language_name AS value
                FROM languages l
                WHERE l.status = 1
                ORDER BY l.language_name ASC
            `)
        ]);

        res.status(200).json({
            status: true,
            data: {
                countries: countries.map(r => r.value),
                profile_types: profileTypes.map(r => r.value),
                languages
            }
        });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/admin/reset-listener-password
// Admin sets a new password for a specific listener
// Body: { user_id, new_password }
router.post('/reset-listener-password', auth, role('admin'), async (req, res) => {
    try {
        const { user_id, new_password } = req.body;

        if (!user_id || !new_password)
            return res.status(200).json({ status: false, message: 'user_id and new_password are required.' });

        if (new_password.length < 6)
            return res.status(200).json({ status: false, message: 'Password must be at least 6 characters.' });

        const { rows } = await pool.query(
            `SELECT id FROM users WHERE id = $1 AND user_type = 'listener'`,
            [user_id]
        );
        if (rows.length === 0)
            return res.status(200).json({ status: false, message: 'Listener not found.' });

        const hashed = await bcrypt.hash(new_password, 12);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, user_id]);

        res.status(200).json({ status: true, message: 'Listener password reset successfully.' });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/admin/bulk-update-status
// Approve or reject multiple listeners in one request
// Body: { user_ids: [1, 2, 3], application_status: 2 }
router.post('/bulk-update-status', auth, role('admin'), async (req, res) => {
    try {
        const { user_ids, application_status } = req.body;

        if (!Array.isArray(user_ids) || user_ids.length === 0)
            return res.status(200).json({ status: false, message: 'user_ids must be a non-empty array.' });

        if (![1, 2, 3].includes(Number(application_status)))
            return res.status(200).json({ status: false, message: 'application_status must be 1 (submitted), 2 (approved), or 3 (rejected).' });

        const result = await pool.query(
            `UPDATE listener_details SET application_status = $1 WHERE user_id = ANY($2::int[])`,
            [Number(application_status), user_ids]
        );

        const labels = { 1: 'submitted', 2: 'approved', 3: 'rejected' };
        res.status(200).json({
            status: true,
            message: `${result.rowCount} listener(s) marked as '${labels[Number(application_status)]}' successfully.`,
            affected: result.rowCount
        });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/admin/bulk-delete-listeners
// Delete multiple listeners in one request
// Body: { user_ids: [1, 2, 3] }
router.post('/bulk-delete-listeners', auth, role('admin'), async (req, res) => {
    try {
        const { user_ids } = req.body;

        if (!Array.isArray(user_ids) || user_ids.length === 0)
            return res.status(200).json({ status: false, message: 'user_ids must be a non-empty array.' });

        await pool.query('DELETE FROM listener_details WHERE user_id = ANY($1::int[])', [user_ids]);
        await pool.query('DELETE FROM listener_preferred_languages WHERE user_id = ANY($1::int[])', [user_ids]);
        const result = await pool.query(
            `DELETE FROM users WHERE id = ANY($1::int[]) AND user_type = 'listener'`,
            [user_ids]
        );

        res.status(200).json({
            status: true,
            message: `${result.rowCount} listener(s) deleted successfully.`,
            deleted: result.rowCount
        });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/admin/bulk-update-mixed-status
// Approve or reject multiple listeners with different statuses in one request
// Body: { updates: [{ user_id: 1, application_status: 2 }, { user_id: 2, application_status: 3 }] }
router.post('/bulk-update-mixed-status', auth, role('admin'), async (req, res) => {
    try {
        const { updates } = req.body;

        if (!Array.isArray(updates) || updates.length === 0)
            return res.status(200).json({ status: false, message: 'updates must be a non-empty array.' });

        let updatedCount = 0;
        for (const item of updates) {
            const { user_id, application_status } = item;
            if (user_id && [1, 2, 3].includes(Number(application_status))) {
                const result = await pool.query(
                    'UPDATE listener_details SET application_status = $1 WHERE user_id = $2',
                    [Number(application_status), user_id]
                );
                if (result.rowCount > 0) {
                    updatedCount++;
                }
            }
        }

        res.status(200).json({
            status: true,
            message: `${updatedCount} listener(s) updated successfully.`,
            updated: updatedCount
        });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/admin/update-media-status
// Update profile photo, primary voice, and/or secondary voice status for a single user in one request
// Body: { user_id, profile_photo_status, primary_voice_status, secondary_voice_status }
// Statuses: 0=pending, 1=approved, 2=rejected
router.post('/update-media-status', auth, role('admin'), async (req, res) => {
    try {
        const { user_id, profile_photo_status, primary_voice_status, secondary_voice_status } = req.body;

        if (!user_id) {
            return res.status(200).json({ status: false, message: "User ID is required." });
        }

        const updates = [];
        const params = [];

        if (profile_photo_status !== undefined) {
            if (![0, 1, 2].includes(Number(profile_photo_status))) return res.status(200).json({ status: false, message: "Invalid profile_photo_status." });
            updates.push('profile_photo_status = ?');
            params.push(Number(profile_photo_status));
        }

        if (primary_voice_status !== undefined) {
            if (![0, 1, 2].includes(Number(primary_voice_status))) return res.status(200).json({ status: false, message: "Invalid primary_voice_status." });
            updates.push('primary_voice_status = ?');
            params.push(Number(primary_voice_status));
        }

        if (secondary_voice_status !== undefined) {
            if (![0, 1, 2].includes(Number(secondary_voice_status))) return res.status(200).json({ status: false, message: "Invalid secondary_voice_status." });
            updates.push('secondary_voice_status = ?');
            params.push(Number(secondary_voice_status));
        }

        if (updates.length === 0) {
            return res.status(200).json({ status: false, message: "No statuses provided to update." });
        }

        params.push(user_id);

        let queryStr = `UPDATE listener_details SET ${updates.join(', ')} WHERE user_id = ?`;
        let pIndex = 1;
        queryStr = queryStr.replace(/\?/g, () => `$${pIndex++}`);

        const result = await pool.query(queryStr, params);

        if (result.rowCount === 0) {
            return res.status(200).json({ status: false, message: "Listener not found." });
        }

        // Auto-approve logic
        const { rows: checkRows } = await pool.query(
            'SELECT profile_photo_status, primary_voice_status, secondary_voice_status, application_status FROM listener_details WHERE user_id = $1',
            [user_id]
        );
        let autoApproved = false;
        if (checkRows.length > 0) {
            const l = checkRows[0];
            if (Number(l.profile_photo_status) === 1 && Number(l.primary_voice_status) === 1 && Number(l.secondary_voice_status) === 1 && Number(l.application_status) !== 2) {
                await pool.query('UPDATE listener_details SET application_status = 2 WHERE user_id = $1', [user_id]);
                autoApproved = true;
            }
        }

        let message = 'Media status updated successfully.';
        if (autoApproved) {
            message += ' Application automatically approved!';
        }

        res.status(200).json({ status: true, message });

    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/admin/add-fluency
// Body: { level_name }
router.post('/add-fluency', auth, role('admin'), async (req, res) => {
    try {
        const { level_name } = req.body;
        if (!level_name) return res.status(200).json({ status: false, message: 'level_name is required.' });

        const { rows: result } = await pool.query(
            'INSERT INTO fluency_levels (level_name, status) VALUES ($1, true) RETURNING id',
            [level_name]
        );
        res.status(200).json({ status: true, message: 'Fluency level added successfully.', id: result[0].id });
    } catch (error) {
        res.status(200).json({ status: false, message: error.message });
    }
});

// =========================================================================
// LISTENER RATE, SETTLEMENT & CALL EARNINGS LOG ENDPOINTS
// =========================================================================

// GET /api/admin/get-listener-rate
// Get current configured listener minute rate
router.get('/get-listener-rate', auth, role('admin'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, setting_key, setting_value, created_at, updated_at
             FROM app_settings
             WHERE setting_key = 'listener_rate_per_minute'
             LIMIT 1`
        );

        const rate = rows.length > 0 && !isNaN(Number(rows[0].setting_value))
            ? Number(rows[0].setting_value)
            : 0.20;

        res.status(200).json({
            status: true,
            message: 'Listener rate per minute fetched successfully.',
            data: {
                setting_key: 'listener_rate_per_minute',
                rate_per_minute: rate.toFixed(2),
                rate_numeric: rate,
                setting_record: rows[0] || null
            }
        });
    } catch (error) {
        console.error('Get listener rate error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/admin/set-listener-rate
// Update or set listener rate per minute
// Body: { rate } or { listener_rate_per_minute } or { setting_value }
router.post('/set-listener-rate', auth, role('admin'), async (req, res) => {
    try {
        const rawRate = req.body.rate ?? req.body.listener_rate_per_minute ?? req.body.setting_value;

        if (rawRate === undefined || rawRate === null || rawRate === '') {
            return res.status(200).json({
                status: false,
                message: 'Rate value is required (rate / listener_rate_per_minute / setting_value).'
            });
        }

        const numericRate = Number(rawRate);
        if (isNaN(numericRate) || numericRate < 0) {
            return res.status(200).json({
                status: false,
                message: 'Rate must be a non-negative number.'
            });
        }

        const formattedRate = numericRate.toFixed(2);

        // Check if setting already exists
        const { rows: existing } = await pool.query(
            `SELECT id FROM app_settings WHERE setting_key = 'listener_rate_per_minute' LIMIT 1`
        );

        let settingRecord = null;
        if (existing.length > 0) {
            const { rows: updated } = await pool.query(
                `UPDATE app_settings
                 SET setting_value = $1,
                     updated_at = NOW()
                 WHERE setting_key = 'listener_rate_per_minute'
                 RETURNING id, setting_key, setting_value, created_at, updated_at`,
                [formattedRate]
            );
            settingRecord = updated[0];
        } else {
            const { rows: inserted } = await pool.query(
                `INSERT INTO app_settings (setting_key, setting_value, created_at, updated_at)
                 VALUES ('listener_rate_per_minute', $1, NOW(), NOW())
                 RETURNING id, setting_key, setting_value, created_at, updated_at`,
                [formattedRate]
            );
            settingRecord = inserted[0];
        }

        res.status(200).json({
            status: true,
            message: 'Listener rate per minute updated successfully.',
            data: {
                setting_key: 'listener_rate_per_minute',
                rate_per_minute: formattedRate,
                rate_numeric: numericRate,
                setting_record: settingRecord
            }
        });
    } catch (error) {
        console.error('Set listener rate error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});

// POST /api/admin/settle-listener
// Settle listener's unsettled amount (partial or full)
// Body: { listener_id, amount (optional - defaults to all unsettled), note, payment_method, transaction_ref }
router.post('/settle-listener', auth, role('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const admin_id = req.user.id;
        const { listener_id, amount, note, payment_method, transaction_ref } = req.body;

        if (!listener_id) {
            return res.status(200).json({
                status: false,
                message: 'listener_id is required.'
            });
        }

        const parsedListenerId = Number(listener_id);
        if (isNaN(parsedListenerId) || !Number.isInteger(parsedListenerId) || parsedListenerId <= 0) {
            return res.status(200).json({
                status: false,
                message: 'listener_id must be a valid positive integer.'
            });
        }

        await client.query('BEGIN');

        // Check listener details with row lock
        const { rows: listenerRows } = await client.query(
            `SELECT u.id, u.name, u.email, ld.unsettled_amount, ld.settled_amount
             FROM users u
             JOIN listener_details ld ON ld.user_id = u.id
             WHERE u.id = $1
             FOR UPDATE OF ld`,
            [parsedListenerId]
        );

        if (listenerRows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(200).json({
                status: false,
                message: 'Listener not found.'
            });
        }

        const listener = listenerRows[0];
        const currentUnsettled = Number(listener.unsettled_amount || 0);
        const currentSettled = Number(listener.settled_amount || 0);

        if (currentUnsettled <= 0) {
            await client.query('ROLLBACK');
            return res.status(200).json({
                status: false,
                message: 'Listener has no unsettled amount to settle (current unsettled amount: $0.00).'
            });
        }

        // Determine settle amount
        let settleAmount = currentUnsettled;
        if (amount !== undefined && amount !== null && amount !== '') {
            const parsedAmount = Number(amount);
            if (isNaN(parsedAmount) || parsedAmount <= 0) {
                await client.query('ROLLBACK');
                return res.status(200).json({
                    status: false,
                    message: 'Settlement amount must be a positive number.'
                });
            }
            if (parsedAmount > currentUnsettled) {
                await client.query('ROLLBACK');
                return res.status(200).json({
                    status: false,
                    message: `Settlement amount ($${parsedAmount.toFixed(2)}) cannot exceed current unsettled amount ($${currentUnsettled.toFixed(2)}).`
                });
            }
            settleAmount = parsedAmount;
        }

        settleAmount = parseFloat(settleAmount.toFixed(2));
        const newUnsettled = Math.max(0, parseFloat((currentUnsettled - settleAmount).toFixed(2)));
        const newSettled = parseFloat((currentSettled + settleAmount).toFixed(2));

        // 1. Update listener_details
        const { rows: updatedListenerRows } = await client.query(
            `UPDATE listener_details
             SET unsettled_amount = $1,
                 settled_amount = $2,
                 updated_at = NOW()
             WHERE user_id = $3
             RETURNING user_id, unsettled_amount, settled_amount`,
            [newUnsettled, newSettled, parsedListenerId]
        );

        // 2. Insert into listener_settlements
        const { rows: settlementRows } = await client.query(
            `INSERT INTO listener_settlements (listener_id, admin_id, amount, note, payment_method, transaction_ref, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'completed', NOW())
             RETURNING id, listener_id, admin_id, amount, note, payment_method, transaction_ref, status, created_at`,
            [
                parsedListenerId,
                admin_id,
                settleAmount,
                note ? String(note).trim() : 'Settlement processed by admin',
                payment_method ? String(payment_method).trim() : 'manual',
                transaction_ref ? String(transaction_ref).trim() : null
            ]
        );

        await client.query('COMMIT');

        res.status(200).json({
            status: true,
            message: `Successfully settled $${settleAmount.toFixed(2)} for ${listener.name}.`,
            data: {
                settlement: settlementRows[0],
                listener: {
                    id: listener.id,
                    name: listener.name,
                    email: listener.email,
                    previous_unsettled_amount: currentUnsettled.toFixed(2),
                    settled_this_transaction: settleAmount.toFixed(2),
                    remaining_unsettled_amount: newUnsettled.toFixed(2),
                    total_settled_amount: newSettled.toFixed(2)
                }
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Settle listener error:', error);
        res.status(200).json({ status: false, message: error.message });
    } finally {
        client.release();
    }
});

// GET /api/admin/settlements
// List all settlements with filters and pagination
router.get('/settlements', auth, role('admin'), async (req, res) => {
    try {
        const { listener_id, search, status, from_date, to_date } = req.query;
        const page = Math.max(1, parseInt(req.query.page || 1));
        const limit = Math.max(1, parseInt(req.query.limit || 20));
        const offset = (page - 1) * limit;

        const conditions = ['1=1'];
        const params = [];

        if (listener_id) {
            conditions.push(`ls.listener_id = $${params.length + 1}`);
            params.push(Number(listener_id));
        }

        if (status && status.trim()) {
            conditions.push(`ls.status = $${params.length + 1}`);
            params.push(status.trim());
        }

        if (search && search.trim()) {
            conditions.push(`(u.name ILIKE $${params.length + 1} OR u.email ILIKE $${params.length + 2} OR ls.transaction_ref ILIKE $${params.length + 3} OR ls.note ILIKE $${params.length + 4})`);
            params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
        }

        if (from_date && from_date.trim()) {
            conditions.push(`ls.created_at >= $${params.length + 1}`);
            params.push(from_date.trim());
        }

        if (to_date && to_date.trim()) {
            conditions.push(`ls.created_at <= $${params.length + 1}`);
            params.push(to_date.trim());
        }

        const WHERE = `WHERE ` + conditions.join(' AND ');

        // Count total
        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) AS total
             FROM listener_settlements ls
             LEFT JOIN users u ON u.id = ls.listener_id
             ${WHERE}`,
            params
        );
        const total = parseInt(countRows[0]?.total || 0);

        // Sum total settled amount for current filter
        const { rows: sumRows } = await pool.query(
            `SELECT SUM(ls.amount) AS total_settled_sum
             FROM listener_settlements ls
             LEFT JOIN users u ON u.id = ls.listener_id
             ${WHERE}`,
            params
        );
        const totalSettledSum = Number(sumRows[0]?.total_settled_sum || 0).toFixed(2);

        // Fetch records
        const { rows: settlements } = await pool.query(
            `SELECT ls.id, ls.listener_id, ls.admin_id, ls.amount, ls.note, ls.payment_method, ls.transaction_ref, ls.status, ls.created_at,
                    u.name AS listener_name, u.email AS listener_email, u.phone AS listener_phone, u.profile_photo AS listener_profile_photo,
                    adm.name AS admin_name, adm.email AS admin_email
             FROM listener_settlements ls
             LEFT JOIN users u ON u.id = ls.listener_id
             LEFT JOIN users adm ON adm.id = ls.admin_id
             ${WHERE}
             ORDER BY ls.created_at DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );

        const BASE_URL = `${req.protocol}://${req.get('host')}`;
        settlements.forEach(s => {
            if (s.listener_profile_photo) {
                s.listener_profile_photo = `${BASE_URL}/uploads/${s.listener_profile_photo}`;
            }
        });

        res.status(200).json({
            status: true,
            message: 'Settlements fetched successfully.',
            data: {
                total,
                page,
                limit,
                total_settled_sum: totalSettledSum,
                settlements
            }
        });
    } catch (error) {
        console.error('Fetch settlements error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});

// GET /api/admin/call-earnings-logs
// List all call ended earnings logs with filters and pagination
router.get('/call-earnings-logs', auth, role('admin'), async (req, res) => {
    try {
        const { listener_id, user_id, call_id, search, from_date, to_date } = req.query;
        const page = Math.max(1, parseInt(req.query.page || 1));
        const limit = Math.max(1, parseInt(req.query.limit || 20));
        const offset = (page - 1) * limit;

        const conditions = ['1=1'];
        const params = [];

        if (listener_id) {
            conditions.push(`cel.listener_id = $${params.length + 1}`);
            params.push(Number(listener_id));
        }

        if (user_id) {
            conditions.push(`cel.user_id = $${params.length + 1}`);
            params.push(Number(user_id));
        }

        if (call_id) {
            conditions.push(`cel.call_id = $${params.length + 1}`);
            params.push(Number(call_id));
        }

        if (search && search.trim()) {
            conditions.push(`(lu.name ILIKE $${params.length + 1} OR lu.email ILIKE $${params.length + 2} OR cu.name ILIKE $${params.length + 3} OR cu.email ILIKE $${params.length + 4})`);
            params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
        }

        if (from_date && from_date.trim()) {
            conditions.push(`cel.created_at >= $${params.length + 1}`);
            params.push(from_date.trim());
        }

        if (to_date && to_date.trim()) {
            conditions.push(`cel.created_at <= $${params.length + 1}`);
            params.push(to_date.trim());
        }

        const WHERE = `WHERE ` + conditions.join(' AND ');

        // Count total
        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) AS total
             FROM call_earnings_logs cel
             LEFT JOIN users lu ON lu.id = cel.listener_id
             LEFT JOIN users cu ON cu.id = cel.user_id
             ${WHERE}`,
            params
        );
        const total = parseInt(countRows[0]?.total || 0);

        // Sum totals
        const { rows: sumRows } = await pool.query(
            `SELECT SUM(cel.amount) AS total_amount_sum, SUM(cel.total_minutes) AS total_minutes_sum
             FROM call_earnings_logs cel
             LEFT JOIN users lu ON lu.id = cel.listener_id
             LEFT JOIN users cu ON cu.id = cel.user_id
             ${WHERE}`,
            params
        );
        const totalAmountSum = Number(sumRows[0]?.total_amount_sum || 0).toFixed(2);
        const totalMinutesSum = parseInt(sumRows[0]?.total_minutes_sum || 0);

        // Fetch logs
        const { rows: logs } = await pool.query(
            `SELECT cel.id, cel.call_id, cel.listener_id, cel.user_id, cel.duration_seconds, cel.total_minutes, cel.rate_per_minute, cel.amount, cel.created_at,
                    lu.name AS listener_name, lu.email AS listener_email, lu.profile_photo AS listener_profile_photo,
                    cu.name AS caller_name, cu.email AS caller_email, cu.profile_photo AS caller_profile_photo
             FROM call_earnings_logs cel
             LEFT JOIN users lu ON lu.id = cel.listener_id
             LEFT JOIN users cu ON cu.id = cel.user_id
             ${WHERE}
             ORDER BY cel.created_at DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );

        const BASE_URL = `${req.protocol}://${req.get('host')}`;
        logs.forEach(l => {
            if (l.listener_profile_photo) {
                l.listener_profile_photo = `${BASE_URL}/uploads/${l.listener_profile_photo}`;
            }
            if (l.caller_profile_photo) {
                l.caller_profile_photo = `${BASE_URL}/uploads/${l.caller_profile_photo}`;
            }
        });

        res.status(200).json({
            status: true,
            message: 'Call earnings logs fetched successfully.',
            data: {
                total,
                page,
                limit,
                total_amount_sum: totalAmountSum,
                total_minutes_sum: totalMinutesSum,
                logs
            }
        });
    } catch (error) {
        console.error('Fetch call earnings logs error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});

// GET /api/admin/listeners-settlement-summary
// Summary overview of all listeners with unsettled, settled balances, and call totals
router.get('/listeners-settlement-summary', auth, role('admin'), async (req, res) => {
    try {
        const { listener_id, search, status, from_date, to_date, sort_by } = req.query;
        const page = Math.max(1, parseInt(req.query.page || 1));
        const limit = Math.max(1, parseInt(req.query.limit || 20));
        const offset = (page - 1) * limit;

        const conditions = ["u.user_type = 'listener'"];
        const params = [];

        if (listener_id) {
            conditions.push(`u.id = $${params.length + 1}`);
            params.push(Number(listener_id));
        }

        if (status !== undefined && status !== null && status !== '') {
            conditions.push(`ld.application_status = $${params.length + 1}`);
            params.push(Number(status));
        }

        if (search && search.trim()) {
            conditions.push(`(u.name ILIKE $${params.length + 1} OR u.email ILIKE $${params.length + 2} OR u.phone ILIKE $${params.length + 3})`);
            params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
        }

        if (from_date && from_date.trim()) {
            conditions.push(`u.created_at >= $${params.length + 1}`);
            params.push(from_date.trim());
        }

        if (to_date && to_date.trim()) {
            conditions.push(`u.created_at <= $${params.length + 1}`);
            params.push(to_date.trim());
        }

        const WHERE = `WHERE ` + conditions.join(' AND ');

        let orderBy = 'COALESCE(ld.unsettled_amount, 0) DESC';
        if (sort_by === 'settled') {
            orderBy = 'COALESCE(ld.settled_amount, 0) DESC';
        } else if (sort_by === 'calls') {
            orderBy = 'COALESCE(ld.total_calls, 0) DESC';
        } else if (sort_by === 'name') {
            orderBy = 'u.name ASC';
        }

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) AS total
             FROM users u
             JOIN listener_details ld ON ld.user_id = u.id
             ${WHERE}`,
            params
        );
        const total = parseInt(countRows[0]?.total || 0);

        // Aggregate overall totals
        const { rows: aggRows } = await pool.query(
            `SELECT 
                SUM(COALESCE(ld.unsettled_amount, 0)) AS total_unsettled_all,
                SUM(COALESCE(ld.settled_amount, 0)) AS total_settled_all,
                SUM(COALESCE(ld.total_calls, 0)) AS total_calls_all
             FROM users u
             JOIN listener_details ld ON ld.user_id = u.id
             ${WHERE}`,
            params
        );

        const { rows: listeners } = await pool.query(
            `SELECT 
                u.id, u.name, u.email, u.phone, u.profile_photo,
                COALESCE(ld.unsettled_amount, 0.00) AS unsettled_amount,
                COALESCE(ld.settled_amount, 0.00) AS settled_amount,
                (COALESCE(ld.unsettled_amount, 0.00) + COALESCE(ld.settled_amount, 0.00)) AS total_earnings,
                COALESCE(ld.total_calls, 0) AS total_calls,
                ld.call_price,
                ld.rating,
                ld.application_status,
                (
                    SELECT MAX(created_at) 
                    FROM listener_settlements 
                    WHERE listener_id = u.id
                ) AS last_settled_at
             FROM users u
             JOIN listener_details ld ON ld.user_id = u.id
             ${WHERE}
             ORDER BY ${orderBy}
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );

        const BASE_URL = `${req.protocol}://${req.get('host')}`;
        listeners.forEach(l => {
            if (l.profile_photo) {
                l.profile_photo = `${BASE_URL}/uploads/${l.profile_photo}`;
            }
        });

        res.status(200).json({
            status: true,
            message: 'Listener settlement summary fetched successfully.',
            data: {
                total,
                page,
                limit,
                overall_unsettled_total: Number(aggRows[0]?.total_unsettled_all || 0).toFixed(2),
                overall_settled_total: Number(aggRows[0]?.total_settled_all || 0).toFixed(2),
                overall_calls_total: parseInt(aggRows[0]?.total_calls_all || 0),
                listeners
            }
        });
    } catch (error) {
        console.error('Fetch settlement summary error:', error);
        res.status(200).json({ status: false, message: error.message });
    }
});

module.exports = router;

