require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5432;
const initDb = require('./config/initDb');

// Initialize database tables and columns
initDb();


// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded files statically (checks local disk first, fallbacks/redirects to AWS S3)
app.use('/uploads/:filename', (req, res, next) => {
    const filename = req.params.filename;
    const localFilePath = path.join(uploadsDir, filename);
    if (fs.existsSync(localFilePath)) {
        return res.sendFile(localFilePath);
    }
    const s3BaseUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com`;
    res.redirect(`${s3BaseUrl}/${filename}`);
});
app.use('/uploads', express.static(uploadsDir));

// Import routes
const authRoutes = require('./routes/auth');
const listenerRoutes = require('./routes/listener');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');

// Mount routes
app.use('/api', authRoutes);
app.use('/api', listenerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', userRoutes);

// Health check
app.get('/', (req, res) => {
    res.json({ status: true, message: 'Trost Friend App API (Node.js) is running!' });
});

// Global error handler (catches Multer errors and other unhandled errors)
const multer = require('multer');
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        console.error('Multer error:', err.code, err.field, err.message);
        return res.json({ status: false, message: `Upload error: ${err.message} (field: ${err.field})` });
    }
    if (err) {
        console.error('Server error:', err.message);
        return res.json({ status: false, message: err.message });
    }
    next();
});

// Start server
app.listen(PORT, () => {
    console.log(`\n  Server running on http://127.0.0.1:${PORT}\n`);
});
