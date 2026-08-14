const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { auth, verifyOtpToken, verifyPhoneToken } = require('../middleware/auth');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const { sendOtpEmail } = require('../utils/email');

//these all user login 

// POST /api/send-email-otp
router.post('/send-email-otp', async (req, res) => {
    try {
        const { email } = req.body;

        // Email required
        if (!email) {
            return res.status(200).json({
                status: false,
                message: "Email is required."
            });
        }

        // Remove spaces
        const cleanEmail = email.trim().toLowerCase();

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(cleanEmail)) {
            return res.status(200).json({
                status: false,
                message: "Please enter a valid email address."
            });
        }

        // Check existing user
        const { rows: users } = await pool.query(
            `SELECT *
             FROM users
             WHERE email = $1
             LIMIT 1`,
            [cleanEmail]
        );

        // Completed account already exists
        if (users.length > 0 && users[0].password) {
            return res.status(200).json({
                status: false,
                message: "Email already registered."
            });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000);

        if (users.length > 0) {

            // Update temporary account
            await pool.query(
                `UPDATE users
                 SET
                    email_otp = $1,
                    otp_created_at = NOW(),
                    email_verified = false,
                    email_verified_at = NULL
                 WHERE email = $2`,
                [otp, cleanEmail]
            );

        } else {

            // Create temporary account
            await pool.query(
                `INSERT INTO users
                (
                    email,
                    email_otp,
                    otp_created_at,
                    email_verified,
                    user_type
                )
                VALUES
                (
                    $1,
                    $2,
                    NOW(),
                    false,
                    'user'
                )`,
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

        return res.status(200).json({
            status: false,
            message: error.message
        });

    }
});
// POST /api/verify-email-otp
router.post('/verify-email-otp', async (req, res) => {
    try {

        let { email, otp } = req.body;

        // Trim and normalize email
        email = email?.trim().toLowerCase();

        // Email and OTP required
        if (!email || !otp) {
            return res.status(200).json({
                status: false,
                message: "Email and OTP are required."
            }, 200);
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
            return res.status(200).json({
                status: false,
                message: "Please enter a valid email address."
            }, 200);
        }

        // OTP must be 6 digits
        const otpRegex = /^[0-9]{6}$/;

        if (!otpRegex.test(String(otp))) {
            return res.status(200).json({
                status: false,
                message: "OTP must be a 6-digit number."
            }, 200);
        }

        const { rows: users } = await pool.query(
            `SELECT *
            FROM users
            WHERE email = $1
            LIMIT 1`,
            [email]
        );

        if (users.length === 0) {
            return res.status(200).json({
                status: false,
                message: "Email not found."
            }, 200);
        }

        const user = users[0];

        // Already registered
        if (user.password) {
            return res.status(200).json({
                status: false,
                message: "Email already registered."
            }, 200);
        }

        // Wrong OTP
        if (String(user.email_otp) !== String(otp)) {
            return res.status(200).json({
                status: false,
                message: "Invalid OTP."
            }, 200);
        }

        // OTP Expired
        const { rows: otpValid } = await pool.query(
            `SELECT 1
            FROM users
            WHERE email = $1
            AND otp_created_at >= NOW() - INTERVAL '5 minutes'`,
            [email]
        );

        if (otpValid.length === 0) {
            return res.status(200).json({
                status: false,
                message: "OTP has expired. Please request a new OTP."
            }, 200);
        }

        // OTP is valid
        await pool.query(
            `UPDATE users
            SET
                email_verified = true,
                email_verified_at = NOW(),
                email_otp = NULL,
                otp_created_at = NULL
            WHERE email = $1`,
            [email]
        );

        return res.status(200).json({
            status: true,
            message: "Email verified successfully."
        }, 200);

    } catch (error) {

        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        }, 200);

    }
});
// POST /api/register
router.post('/register', async (req, res) => {
    try {
        let {
            name,
            email,
            phone,
            password,
            confirm_password
        } = req.body;

        // Trim inputs
        name = name?.trim();
        email = email?.trim().toLowerCase();
        phone = phone?.trim();

        // Required validation
        if (!name || !email || !phone || !password || !confirm_password) {
            return res.status(200).json({
                status: false,
                message: "Name, email, phone, password and confirm password are required."
            });
        }

        // Name validation
        if (name.length < 3 || name.length > 50) {
            return res.status(200).json({
                status: false,
                message: "Name must be between 3 and 50 characters."
            });
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
            return res.status(200).json({
                status: false,
                message: "Please enter a valid email address."
            });
        }

        // Phone validation (10 digits)
        const phoneRegex = /^[0-9]{10}$/;

        if (!phoneRegex.test(phone)) {
            return res.status(200).json({
                status: false,
                message: "Phone number must be exactly 10 digits."
            });
        }

        // Password validation
        if (password.length < 8) {
            return res.status(200).json({
                status: false,
                message: "Password must be at least 8 characters."
            });
        }

        // Confirm password
        if (password !== confirm_password) {
            return res.status(200).json({
                status: false,
                message: "Password and confirm password do not match."
            });
        }

        // Find user by email
        const { rows: users } = await pool.query(
            `SELECT *
             FROM users
             WHERE email = $1
             LIMIT 1`,
            [email]
        );

        // No record at all -> OTP was never requested/verified for this email
        if (users.length === 0) {
            return res.status(200).json({
                status: false,
                message: "Please verify your email first."
            });
        }

        const user = users[0];

        // Already registered — FIXED: use truthy check, not the always-true
        // "!== null || !== undefined || !== ''" combination
        if (user.password) {
            return res.status(200).json({
                status: false,
                message: "Email already registered."
            });
        }

        // Email must be verified
        if (!user.email_verified) {
            return res.status(200).json({
                status: false,
                message: "Please verify your email first."
            });
        }

        // Verification expired — FIXED: reuse the row we already fetched
        // instead of firing a second query
        const verifiedAt = user.email_verified_at ? new Date(user.email_verified_at) : null;
        const isExpired = !verifiedAt || (Date.now() - verifiedAt.getTime()) > 5 * 60 * 1000;

        if (isExpired) {
            return res.status(200).json({
                status: false,
                message: "OTP verification expired. Please verify your email again."
            });
        }

        // Phone already exists
        const { rows: existingPhone } = await pool.query(
            `SELECT id
             FROM users
             WHERE phone = $1
             AND email != $2`,
            [phone, email]
        );

        if (existingPhone.length > 0) {
            return res.status(200).json({
                status: false,
                message: "Phone number already exists."
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Complete registration — FIXED: keep email_verified = true,
        // only clear the OTP fields (previously this reset email_verified
        // to false, which would break login right after registering)
        await pool.query(
            `UPDATE users
             SET
                name = $1,
                phone = $2,
                password = $3,
                user_type = 'user',
                email_otp = NULL,
                otp_created_at = NULL,
                updated_at = NOW()
             WHERE email = $4`,
            [
                name,
                phone,
                hashedPassword,
                email
            ]
        );

        // Get updated user
        const { rows: result } = await pool.query(
            `SELECT
                id,
                name,
                email,
                phone,
                user_type
             FROM users
             WHERE email = $1`,
            [email]
        );

        const registeredUser = result[0];

        // Initialize user_minutes with 10 free minutes
        try {
            const { rows: existingMinutes } = await pool.query(
                `SELECT id FROM user_minutes WHERE user_id = $1`,
                [registeredUser.id]
            );

            if (existingMinutes.length === 0) {
                await pool.query(
                    `INSERT INTO user_minutes (user_id, free_minutes, purchased_minutes, remaining_minutes, updated_at)
                     VALUES ($1, 10, 0, 10, NOW())`,
                    [registeredUser.id]
                );
            } else {
                await pool.query(
                    `UPDATE user_minutes
                     SET free_minutes = free_minutes + 10,
                         remaining_minutes = remaining_minutes + 10,
                         updated_at = NOW()
                     WHERE user_id = $1`,
                    [registeredUser.id]
                );
            }
        } catch (walletError) {
            console.error("Failed to add 10 free minutes to new user wallet:", walletError);
        }

        // Generate JWT
        const token = jwt.sign(
            {
                userId: registeredUser.id,
                user_type: registeredUser.user_type
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "30d"
            }
        );

        return res.status(200).json({
            status: true,
            message: "Registration successful.",
            access_token: token,
            token_type: "Bearer",
            user: registeredUser
        });

    } catch (error) {

        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });

    }
});
// POST /api/login
router.post('/login', async (req, res) => {
    try {
        const { email, password, user_type } = req.body;

        if (!email || !password || !user_type) {
            return res.status(200).json({
                status: false,
                message: 'Email, password and user_type are required.'
            });
        }

        if (!['user', 'listener'].includes(user_type)) {
            return res.status(200).json({
                status: false,
                message: "Invalid user type."
            });
        }
        // Find user by email
        const { rows: users } = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (users.length === 0) {
            return res.status(200).json({
                status: false,
                message: 'User not found.'
            });
        }

        const user = users[0];

        // Check user type
        if (user.user_type !== user_type) {
            return res.status(200).json({
                status: false,
                message: `This account is registered as ${user.user_type}. Please use the correct login.`
            });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(200).json({
                status: false,
                message: 'Invalid password.'
            });
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

        res.status(200).json({
            status: true,
            message: 'Login successful.',
            access_token: token,
            token_type: 'Bearer',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                user_type: user.user_type
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(200).json({
            status: false,
            message: error.message
        }, 200);
    }
});

//phone login 
// POST /api/login
router.post('/phone_login', async (req, res) => {
    try {
        const { phone, password, user_type } = req.body;

        if (!phone || !password || !user_type) {
            return res.json({
                status: false,
                message: "Phone, password and user_type are required."
            });
        }

        if (!['user', 'listener'].includes(user_type)) {
            return res.json({
                status: false,
                message: "Invalid user type."
            });
        }

        // Find user
        const { rows } = await pool.query(
            `SELECT *
             FROM users
             WHERE phone = $1`,
            [phone]
        );

        if (rows.length === 0) {
            return res.json({
                status: false,
                message: "User not found."
            });
        }

        const user = rows[0];

        // Check user type
        if (user.user_type !== user_type) {
            return res.json({
                status: false,
                message: `This account is registered as ${user.user_type}.`
            });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.json({
                status: false,
                message: "Invalid password."
            });
        }

        // Phone not verified
        if (!user.phone_verified) {

            const otp = Math.floor(100000 + Math.random() * 900000).toString();

            const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

            await pool.query(
                `UPDATE users
                 SET
                    phone_otp = $1,
                    phone_otp_expires_at = $2
                 WHERE id = $3`,
                [
                    otp,
                    expiresAt,
                    user.id
                ]
            );

            // TODO: Send OTP using SMS provider
            console.log("Phone OTP:", otp);

            const verificationToken = jwt.sign(
                {
                    userId: user.id,
                    purpose: "phone_verification"
                },
                process.env.JWT_SECRET,
                {
                    expiresIn: "10m"
                }
            );

            return res.json({
                status: false,
                otp_required: true,
                message: "Phone verification required.",
                verification_token: verificationToken,
                otp: otp // Added for testing
            });
        }

        // Generate JWT
        const token = jwt.sign(
            {
                userId: user.id,
                user_type: user.user_type
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "30d"
            }
        );

        return res.json({
            status: true,
            message: "Login successful.",
            access_token: token,
            token_type: "Bearer",
            user: {
                id: user.id,
                name: user.name,
                phone: user.phone,
                email: user.email,
                user_type: user.user_type
            }
        });

    } catch (error) {
        console.error(error);

        return res.json({
            status: false,
            message: error.message
        });
    }
});
// POST /api/verify-phone-otp
router.post("/verify-phone-otp", verifyPhoneToken, async (req, res) => {

    try {

        const { otp } = req.body;

        if (!otp) {
            return res.json({
                status: false,
                message: "OTP is required."
            });
        }

        const { rows } = await pool.query(
            `SELECT *
             FROM users
             WHERE id = $1`,
            [req.user.userId]
        );

        if (rows.length === 0) {
            return res.json({
                status: false,
                message: "User not found."
            });
        }

        const user = rows[0];

        if (user.phone_otp !== otp) {
            return res.json({
                status: false,
                message: "Invalid OTP."
            });
        }

        if (
            !user.phone_otp_expires_at ||
            new Date() > new Date(user.phone_otp_expires_at)
        ) {
            return res.json({
                status: false,
                message: "OTP expired."
            });
        }

        await pool.query(
            `UPDATE users
             SET
                phone_verified = TRUE,
                phone_otp = NULL,
                phone_otp_expires_at = NULL,
                updated_at = NOW()
             WHERE id = $1`,
            [user.id]
        );

        // Actual login token
        const accessToken = jwt.sign(
            {
                userId: user.id,
                user_type: user.user_type
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "30d"
            }
        );

        return res.json({
            status: true,
            message: "Phone verified successfully.",
            access_token: accessToken,
            token_type: "Bearer"
        });

    } catch (error) {

        console.error(error);

        return res.json({
            status: false,
            message: error.message
        });

    }

});

// POST /api/change-password
router.post('/change-password', auth, async (req, res) => {
    try {
        const user_id = req.user.id;

        const {
            current_password,
            new_password,
            confirm_password
        } = req.body;

        // Validation
        if (!current_password || !new_password || !confirm_password) {
            return res.json({
                status: false,
                message: "current_password, new_password and confirm_password are required."
            });
        }

        if (new_password !== confirm_password) {
            return res.json({
                status: false,
                message: "New password and confirm password do not match."
            });
        }

        if (new_password.length < 6) {
            return res.json({
                status: false,
                message: "New password must be at least 6 characters."
            });
        }

        // Get user
        const { rows } = await pool.query(
            `SELECT password
             FROM users
             WHERE id = $1`,
            [user_id]
        );

        if (rows.length === 0) {
            return res.json({
                status: false,
                message: "User not found."
            });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(
            current_password,
            rows[0].password
        );

        if (!isMatch) {
            return res.json({
                status: false,
                message: "Current password is incorrect."
            });
        }

        // Prevent same password
        const samePassword = await bcrypt.compare(
            new_password,
            rows[0].password
        );

        if (samePassword) {
            return res.json({
                status: false,
                message: "New password must be different from the current password."
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(new_password, 10);

        // Update password
        await pool.query(
            `UPDATE users
             SET
                password = $1,
                updated_at = NOW()
             WHERE id = $2`,
            [
                hashedPassword,
                user_id
            ]
        );

        return res.json({
            status: true,
            message: "Password changed successfully."
        });

    } catch (error) {
        console.error(error);

        return res.json({
            status: false,
            message: error.message
        });
    }
});

// POST /api/logout
router.post('/logout', auth, async (req, res) => {
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
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

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
            message: "Logged out successfully."
        });

    } catch (error) {

        console.error(error);

        return res.status(200).json({
            status: false,
            message: error.message
        });

    }
});

// router.post('/login', async (req, res) => {
//     try {
//         const { email, password } = req.body;

//         if (!email || !password) {
//             return res.status(200).json({ status: false, message: 'Email and password are required.' });
//         }

//         const { rows: users } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

//         if (users.length === 0) {
//             return res.status(200).json({ status: false, message: 'User not found' });
//         }

//         const user = users[0];

//         const isMatch = await bcrypt.compare(password, user.password);
//         if (!isMatch) {
//             return res.status(200).json({ status: false, message: 'Invalid password' });
//         }

//         const tempToken = jwt.sign(
//             {
//                 userId: user.id,
//                 type: 'otp'
//             },
//             process.env.JWT_SECRET,
//             { expiresIn: '200m' }
//         );

//         res.status(200).json({
//             status: true,
//             message: 'Login successful.',
//             access_token: tempToken,
//             token_type: 'Bearer',

//         });
//     } catch (error) {
//         console.error('Login error:', error);
//         res.status(200).json({ status: false, message: error.message });
//     }
// });
module.exports = router;
