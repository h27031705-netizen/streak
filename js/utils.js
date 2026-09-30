// ---------- Date Helpers ----------
function todayISO() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(dateA, dateB) {
  const a = new Date(`${dateA}T00:00:00Z`);
  const b = new Date(`${dateB}T00:00:00Z`);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function formatDateLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------- Emoji Helpers ----------
const RANDOM_ENCOURAGEMENTS = [
  "You're on fire! 🔥", "Keep it up, champ! 💪", "Consistency wins! 🏆",
  "One more day closer to greatness! 🚀", "Look at you go! ⭐"
];

function randomEncouragement() {
  return RANDOM_ENCOURAGEMENTS[Math.floor(Math.random() * RANDOM_ENCOURAGEMENTS.length)];
}

// ---------- Small DOM helper ----------
function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}