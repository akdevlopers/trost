const { S3Client } = require("@aws-sdk/client-s3");
const multer = require("multer");
const multerS3 = require("multer-s3");
const path = require("path");

// S3 Client configuration
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Storage Configuration
const s3Storage = multerS3({
    s3: s3,
    bucket: process.env.AWS_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: function (req, file, cb) {
        const uniqueName = Date.now() + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

// Wrap _handleFile to inject 'filename' property for compatibility with existing codebase
const originalHandleFile = s3Storage._handleFile;
s3Storage._handleFile = function (req, file, cb) {
    originalHandleFile.call(s3Storage, req, file, function (err, info) {
        if (err) return cb(err);
        // info contains key, location, bucket, etc.
        // We set filename to key so that all controllers (e.g. req.file.filename) work without modification
        info.filename = info.key;
        cb(null, info);
    });
};

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === "profile_photo") {
        const allowed = [".jpg", ".jpeg", ".png"];
        if (allowed.includes(ext)) {
            return cb(null, true);
        }
        return cb(new Error("Profile photo must be JPG, JPEG or PNG"));
    }
    if (
        file.fieldname === "primary_voice" ||
        file.fieldname === "secondary_voice"
    ) {
        const allowed = [
            ".mp3",
            ".mpeg",
            ".wav",
            ".m4a"
        ];
        if (allowed.includes(ext)) {
            return cb(null, true);
        }
        return cb(new Error("Voice file must be MP3, MPEG, WAV or M4A"));
    }
    cb(new Error("Invalid file field"));
};

module.exports = multer({
    storage: s3Storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    }
});