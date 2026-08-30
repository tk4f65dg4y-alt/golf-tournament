const express = require('express');
const router = express.Router();
const { requireAuth } = require('../src/auth');
const { COURSES } = require('../src/data');

function difficultyOrder(holes) {
  return [...holes].sort((a, b) => a.strokeIndex - b.strokeIndex).map((h) => h.number);
}

router.get('/courses', requireAuth, (req, res) => {
  res.render('courses', {
    church: { ...COURSES.church, difficultyOrder: difficultyOrder(COURSES.church.holes) },
    village: { ...COURSES.village, difficultyOrder: difficultyOrder(COURSES.village.holes) }
  });
});

module.exports = router;
