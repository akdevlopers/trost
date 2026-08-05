const multer = require("multer");
const path = require("path");

// Storage Configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "uploads/");
    },

    filename: function (req, file, cb) {
        const uniqueName = Date.now() + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

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
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    }
});