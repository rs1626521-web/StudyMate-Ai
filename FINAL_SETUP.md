# StudyMate AI — Final local setup

1. Install dependencies in `backend`:
   `npm install`
2. Create `backend/.env` using `.env.example`.
3. Set your own `JWT_SECRET` and existing AI keys. Do not share them.
4. Start backend:
   `npm start`
5. Start frontend from `frontend`:
   `npx serve -l 5500`

## AI providers
Groq is tried first. If Groq fails or times out, Gemini is tried next. If both are unavailable, a local fallback response is returned.

## Chat history reliability
Chat history uses atomic MongoDB updates and a client-side save queue. This prevents Mongoose VersionError crashes when multiple chat saves happen close together.

## Stats repair
On backend startup, old negative `topicsDone` / `studyMinutes` values are repaired to zero.

## Email shorthand
A username-like value without `@` is treated as a Gmail address, e.g. `rahul` -> `rahul@gmail.com`.
