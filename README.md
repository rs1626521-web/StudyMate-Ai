# StudyMate AI — Real App MVP

A simple but scalable student platform:
- Frontend: plain HTML/CSS/JS
- Backend: Node.js + Express
- Database: MongoDB + Mongoose
- Authentication: JWT + bcrypt
- Friends: follow request → accept → connected leaderboard
- PYQ: upload/paste text + Groq topic analysis with stronger local fallback
- AI: secure backend proxy to Groq when `GROQ_API_KEY` is configured, with local fallback
- Planner: exam date + subjects + 10-minute to 4-hour study time + PYQ-priority topics + quick quizzes

## Run

1. Install Node.js 20+ and MongoDB (local or Atlas).
2. Copy `backend/.env.example` to `backend/.env` and set MongoDB URI, JWT secret, and optionally the AI key.
3. In `backend/`: `npm install` then `npm run dev`.
4. Serve `frontend/` with a static server on port 5500, e.g. `npx serve -l 5500 frontend`.
5. Open `http://localhost:5500`.

Do not put `GROQ_API_KEY` or any provider key in frontend JavaScript. Keep it only in the backend environment.


Password reset behavior: reset links use CLIENT_URL when configured; otherwise, in local development they use the browser Origin that requested the reset. The reset flow never asks for the old password. After a successful reset it returns to Login with the reset email prefilled.

Final fixes: profile view, shorthand Gmail login/search, Groq→Gemini fallback, clamped stats, quiz answer review, and improved voice recognition.


### Email shorthand
Login and forgot-password accept a username without @ and normalize it to `@gmail.com`; friend search supports the same shorthand.


Final fix: chat-history saves are race-safe, AI providers have independent timeouts/fallback, and negative legacy stats are repaired at startup.
