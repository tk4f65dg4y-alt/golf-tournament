const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth, requireAdmin } = require('../src/auth');

const STANDARD_STROKE_INDEX = [7, 15, 1, 13, 5, 17, 3, 11, 9, 8, 16, 2, 14, 6, 18, 4, 12, 10];

router.get('/courses', requireAuth, async (req, res, next) => {
  try {
    const { rows: courses } = await pool.query(
      `SELECT c.*, COUNT(ch.id)::int AS hole_count
       FROM courses c LEFT JOIN course_holes ch ON ch.course_id = c.id
       GROUP BY c.id ORDER BY c.name`
    );
    res.render('courses', { courses });
  } catch (err) {
    next(err);
  }
});

router.post('/courses', requireAdmin, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.redirect('/courses');
    const { rows } = await pool.query('INSERT INTO courses (name) VALUES ($1) RETURNING id', [name.trim()]);
    const courseId = rows[0].id;
    // Seed with a standard par-72 / textbook stroke-index layout so there's
    // always a sane default to tweak rather than 18 blank rows.
    for (let h = 1; h <= 18; h++) {
      const par = [3, 8, 12, 17].includes(h) ? 3 : [5, 9, 14, 18].includes(h) ? 5 : 4;
      await pool.query(
        'INSERT INTO course_holes (course_id, hole_number, par, stroke_index) VALUES ($1, $2, $3, $4)',
        [courseId, h, par, STANDARD_STROKE_INDEX[h - 1]]
      );
    }
    res.redirect(`/courses/${courseId}`);
  } catch (err) {
    next(err);
  }
});

router.post('/courses/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM courses WHERE id = $1', [req.params.id]);
    res.redirect('/courses');
  } catch (err) {
    next(err);
  }
});

router.get('/courses/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows: courseRows } = await pool.query('SELECT * FROM courses WHERE id = $1', [req.params.id]);
    if (!courseRows.length) return res.status(404).render('error', { message: 'Course not found.' });
    const { rows: holes } = await pool.query(
      'SELECT * FROM course_holes WHERE course_id = $1 ORDER BY hole_number',
      [req.params.id]
    );
    const totalPar = holes.reduce((s, h) => s + h.par, 0);
    res.render('course-detail', { course: courseRows[0], holes, totalPar });
  } catch (err) {
    next(err);
  }
});

router.post('/courses/:id/holes', requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const courseId = req.params.id;
    const { par, stroke_index } = req.body; // arrays indexed 1..18 (index 0 unused)

    const pars = [];
    const strokeIndexes = [];
    for (let h = 1; h <= 18; h++) {
      pars.push(Math.min(6, Math.max(3, Number(par[h]) || 4)));
      strokeIndexes.push(Number(stroke_index[h]));
    }

    // Stroke index must be a valid 1-18 permutation (each hole a unique
    // difficulty rank). If the submitted values aren't, fall back to
    // hole order rather than leaving the course half-configured.
    const isValidPermutation =
      strokeIndexes.length === 18 &&
      new Set(strokeIndexes).size === 18 &&
      strokeIndexes.every((n) => Number.isInteger(n) && n >= 1 && n <= 18);
    const finalIndexes = isValidPermutation ? strokeIndexes : Array.from({ length: 18 }, (_, i) => i + 1);

    await client.query('BEGIN');
    await client.query('DELETE FROM course_holes WHERE course_id = $1', [courseId]);
    for (let h = 1; h <= 18; h++) {
      await client.query(
        'INSERT INTO course_holes (course_id, hole_number, par, stroke_index) VALUES ($1, $2, $3, $4)',
        [courseId, h, pars[h - 1], finalIndexes[h - 1]]
      );
    }
    await client.query('COMMIT');
    res.redirect(`/courses/${courseId}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
