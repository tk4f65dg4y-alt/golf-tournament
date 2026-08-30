const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth, requirePlayer } = require('../src/auth');
const { findPlayer } = require('../src/data');

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  }
});

function withUploaderNames(photos) {
  for (const p of photos) {
    const uploader = findPlayer(p.uploaded_by);
    p.uploader_name = uploader ? uploader.name : 'Someone';
  }
  return photos;
}

router.get('/photos', requireAuth, async (req, res, next) => {
  try {
    const { rows: photos } = await pool.query('SELECT * FROM photos ORDER BY created_at DESC');
    res.render('photos', { photos: withUploaderNames(photos), error: null });
  } catch (err) {
    next(err);
  }
});

router.post('/photos', requirePlayer, (req, res, next) => {
  upload.single('photo')(req, res, async (err) => {
    try {
      if (err) {
        const { rows: photos } = await pool.query('SELECT * FROM photos ORDER BY created_at DESC');
        return res.render('photos', { photos: withUploaderNames(photos), error: err.message });
      }
      if (!req.file) return res.redirect('/photos');
      await pool.query(
        'INSERT INTO photos (uploaded_by, filename, caption) VALUES ($1, $2, $3)',
        [req.user.id, req.file.filename, (req.body.caption || '').trim() || null]
      );
      res.redirect('/photos');
    } catch (e) {
      next(e);
    }
  });
});

router.post('/photos/:id/delete', requirePlayer, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM photos WHERE id = $1', [req.params.id]);
    const photo = rows[0];
    if (!photo) return res.redirect('/photos');
    if (photo.uploaded_by !== req.user.id && !req.user.isCaptain) {
      return res.status(403).render('error', { message: 'You can only delete your own photos.' });
    }
    await pool.query('DELETE FROM photos WHERE id = $1', [req.params.id]);
    const fs = require('fs');
    fs.unlink(path.join(uploadDir, photo.filename), () => {});
    res.redirect('/photos');
  } catch (err) {
    next(err);
  }
});

module.exports = { router, uploadDir };
