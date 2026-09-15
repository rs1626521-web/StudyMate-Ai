import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import multer from 'multer';
import { auth, signToken } from './auth.js';
import { User, Connection, Task, PYQ, Chat } from './models.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '2mb' }));

function sendErr(res, status, message) { return res.status(status).json({ error: message }); }

function normalizeEmail(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.includes('@') ? raw : `${raw}@gmail.com`;
}

function makeMailer() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
    auth: { user, pass }
  });
}

async function sendPasswordResetEmail(to, resetUrl) {
  const transporter = makeMailer();
  if (!transporter) return false;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transporter.sendMail({
    from,
    to,
    subject: 'Reset your StudyMate AI password',
    text: `We received a request to reset your StudyMate AI password.\n\nOpen this link within 15 minutes to choose a new password:\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>Reset your StudyMate AI password</h2><p>We received a request to reset your password.</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#6f57ff;color:#fff;text-decoration:none;border-radius:8px">Reset Password</a></p><p>This link expires in <b>15 minutes</b> and can be used only once.</p><p>If you did not request this, you can safely ignore this email.</p></div>`
  });
  return true;
}

app.get('/api/health', (_, res) => res.json({ ok: true, service: 'StudyMate API' }));

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, password } = req.body || {};
    const email = normalizeEmail(req.body?.email);
    if (!name || !email || !password || password.length < 6) return sendErr(res, 400, 'Name, email and a 6+ character password are required');
    const exists = await User.findOne({ email });
    if (exists) return sendErr(res, 409, 'An account with this email already exists');
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, passwordHash });
    res.status(201).json({ token: signToken(user._id.toString()), user: publicUser(user) });
  } catch (e) { console.error(e); sendErr(res, 500, 'Registration failed'); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { password } = req.body || {};
    const email = normalizeEmail(req.body?.email);
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) return sendErr(res, 401, 'Invalid email or password');
    res.json({ token: signToken(user._id.toString()), user: publicUser(user) });
  } catch (e) { console.error(e); sendErr(res, 500, 'Login failed'); }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    // Always return the same response so attackers cannot discover registered emails.
    const generic = 'If an account with that email exists, a password reset link has been sent.';
    if (!email) return res.json({ message: generic });

    const user = await User.findOne({ email });
    if (!user) return res.json({ message: generic });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.resetTokenHash = tokenHash;
    user.resetTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    const configuredClientUrl = String(process.env.CLIENT_URL || '').split(',')[0].trim().replace(/\/$/, '');
    const requestOrigin = String(req.get('origin') || '').trim().replace(/\/$/, '');
    const clientUrl = configuredClientUrl || requestOrigin || 'http://localhost:5500';
    const resetUrl = `${clientUrl}/?reset=${rawToken}`;

    try {
      const sent = await sendPasswordResetEmail(user.email, resetUrl);
      if (!sent && process.env.NODE_ENV !== 'production') {
        console.log(`DEV password reset link for ${user.email}: ${resetUrl}`);
      }
    } catch (mailError) {
      console.error('Password reset email failed:', mailError.message);
      if (process.env.NODE_ENV !== 'production') console.log(`DEV password reset link for ${user.email}: ${resetUrl}`);
    }

    res.json({ message: generic });
  } catch (e) {
    console.error(e);
    res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    if (!token || password.length < 6) return sendErr(res, 400, 'A valid reset link and a 6+ character password are required');

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({ resetTokenHash: tokenHash, resetTokenExpiresAt: { $gt: new Date() } });
    if (!user) return sendErr(res, 400, 'This reset link is invalid or has expired. Please request a new one.');

    user.passwordHash = await bcrypt.hash(password, 12);
    user.resetTokenHash = undefined;
    user.resetTokenExpiresAt = undefined;
    await user.save();
    res.json({ message: 'Password updated successfully. You can now log in.' });
  } catch (e) {
    console.error(e);
    sendErr(res, 500, 'Password reset failed');
  }
});

app.get('/api/me', auth, async (req, res) => res.json({ user: publicUser(await User.findById(req.user._id)) }));

app.put('/api/me/education', auth, async (req, res) => {
  try {
    const { type, level, semester, subjects = [], timetableText = '' } = req.body || {};
    if (!['School','College'].includes(type)) return sendErr(res, 400, 'Education type must be School or College');
    const normalized = subjects.map(s => typeof s === 'string' ? { name: s } : s).filter(s => s.name);
    const user = await User.findByIdAndUpdate(req.user._id, { education: { type, level, semester, subjects: normalized, timetableText } }, { new: true });
    res.json({ user: publicUser(user) });
  } catch (e) { console.error(e); sendErr(res, 500, 'Education setup failed'); }
});

app.get('/api/tasks', auth, async (req, res) => res.json({ tasks: await Task.find({ user: req.user._id }).sort({ done: 1, dueDate: 1, createdAt: -1 }) }));
app.post('/api/tasks', auth, async (req, res) => {
  const { title, subject, priority='Medium', dueDate } = req.body || {};
  if (!title) return sendErr(res, 400, 'Task title required');
  const task = await Task.create({ user: req.user._id, title, subject, priority, dueDate });
  res.status(201).json({ task });
});
app.patch('/api/tasks/:id', auth, async (req, res) => {
  const existing = await Task.findOne({ _id: req.params.id, user: req.user._id });
  if (!existing) return sendErr(res, 404, 'Task not found');
  const wasDone = Boolean(existing.done);
  const nextDone = typeof req.body?.done === 'boolean' ? req.body.done : wasDone;
  Object.assign(existing, req.body || {});
  existing.done = nextDone;
  await existing.save();

  // Update learning stats only when a task crosses from open -> completed.
  if (!wasDone && nextDone) {
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { topicsDone: 1, studyMinutes: Math.max(5, Number(req.body?.studyMinutes || 15)) }
    });
  } else if (wasDone && !nextDone) {
    await User.findByIdAndUpdate(req.user._id, [
      { $set: { topicsDone: { $max: [0, { $subtract: ['$topicsDone', 1] }] }, studyMinutes: { $max: [0, { $subtract: ['$studyMinutes', Math.max(5, Number(req.body?.studyMinutes || 15))] }] } } }
    ]);
  }
  res.json({ task: existing });
});

app.get('/api/quiz/:taskId', auth, async (req, res) => {
  const task = await Task.findOne({ _id: req.params.taskId, user: req.user._id }).lean();
  if (!task) return sendErr(res, 404, 'Task not found');
  const subject = String(task.subject || task.title || 'General').toLowerCase();
  const banks = [
    { key:['web development','html'], topic:'Web Development', qs:[
      ['HTML is mainly used for what?',['Styling pages','Structuring page content','Managing databases','Routing networks'],1],
      ['Which technology is primarily used for styling a web page?',['HTML','CSS','SQL','DNS'],1],
      ['Which JavaScript keyword declares a block-scoped variable that can be reassigned?',['const','let','class','import'],1],
      ['What does HTTP primarily define?',['Web communication rules','Image compression','CPU scheduling','Database indexing'],0],
      ['Which is a common client-side JavaScript API?',['DOM','MongoDB','SMTP','TCP checksum'],0]
    ]},
    { key:['computer networks','network','osi'], topic:'Computer Networks', qs:[
      ['Which OSI layer handles routing?',['Physical','Data Link','Network','Presentation'],2],
      ['What does IP primarily provide?',['Logical addressing','Web styling','File compression','Database joins'],0],
      ['Which protocol is connection-oriented?',['UDP','TCP','IP','DNS'],1],
      ['What is a LAN?',['Large Area Network','Local Area Network','Linked Access Node','Logical Application Network'],1],
      ['DNS is mainly used to?',['Translate domain names to IP addresses','Encrypt passwords','Compress files','Schedule processes'],0]
    ]},
    { key:['software engineering'], topic:'Software Engineering', qs:[
      ['What is the main goal of requirements analysis?',['Understand what the system must do','Write CSS','Tune a CPU','Compress images'],0],
      ['Which model follows sequential development phases?',['Waterfall','Random Forest','OSI','Stack'],0],
      ['Unit testing usually tests what?',['Small pieces of code','Entire companies','Internet cables','Exam papers'],0],
      ['Version control helps teams to?',['Track code changes','Increase monitor size','Replace databases','Create passwords'],0],
      ['A bug is best described as?',['A software defect','A network cable','A design color','A database server'],0]
    ]},
    { key:['artificial intelligence','ai'], topic:'AI', qs:[
      ['What is supervised learning trained with?',['Labeled examples','No data','Only images','Only rules'],0],
      ['What is a model in machine learning?',['A learned mathematical representation','A keyboard','A network cable','A file extension'],0],
      ['Which is an example of classification?',['Spam vs not spam','Predicting house price','Sorting files by name','Compressing a video'],0],
      ['Overfitting means a model?',['Memorizes training data too closely','Has no parameters','Cannot learn at all','Always gets 100% on new data'],0],
      ['Which metric is common for classification?',['Accuracy','Voltage','Latency only','Disk size'],0]
    ]},
    { key:['normalization','normal forms','3nf','2nf','1nf','bcnf'], topic:'Normalization', qs:[
      ['What is the main goal of database normalization?',['Reduce redundancy and update anomalies','Make every table larger','Remove all primary keys','Avoid using SQL'],0],
      ['Which normal form requires atomic values?',['1NF','2NF','3NF','BCNF'],0],
      ['A relation is in 2NF when it is in 1NF and has no?',['Partial dependency on a candidate key','Foreign keys','Rows','Columns'],0],
      ['3NF mainly removes which type of dependency?',['Transitive dependency','Network dependency','Memory dependency','Visual dependency'],0],
      ['BCNF is generally stricter than?',['3NF','1NF','NoSQL','HTML'],0]
    ]},
    { key:['osi'], topic:'OSI Model', qs:[
      ['Which OSI layer is responsible for routing?',['Physical','Data Link','Network','Application'],2],
      ['Which layer provides end-to-end transport?',['Transport','Session','Presentation','Physical'],0],
      ['Which OSI layer is closest to the end user?',['Application','Network','Data Link','Physical'],0],
      ['MAC addressing is primarily associated with which layer?',['Data Link','Transport','Session','Application'],0],
      ['Encryption and data formatting are commonly associated with which layer?',['Presentation','Network','Physical','Transport'],0]
    ]},
    { key:['process scheduling','scheduling','round robin','fcfs'], topic:'Process Scheduling', qs:[
      ['Which algorithm gives each process a fixed time slice?',['Round Robin','FCFS','FIFO disk','DFS'],0],
      ['FCFS stands for?',['First Come First Served','Fast CPU First System','File Control First Service','First Cache File Search'],0],
      ['Which scheduling concept can cause starvation?',['Priority scheduling','HTML','DNS','Normalization'],0],
      ['Turnaround time is generally?',['Completion time minus arrival time','Arrival time minus burst time','Burst time plus RAM','CPU speed'],0],
      ['The time a process waits in the ready queue is called?',['Waiting time','Response packet','Seek time','Compile time'],0]
    ]},
    { key:['dbms','database','sql'], topic:'DBMS / SQL', qs:[
      ['What does SQL stand for?',['Structured Query Language','Simple Question Logic','System Queue Language','Sequential Query Link'],0],
      ['Which command retrieves rows?',['SELECT','DROP','ALTER','GRANT'],0],
      ['A primary key should identify a row?',['Uniquely','Randomly','Approximately','Only by color'],0],
      ['Which is used to combine rows from related tables?',['JOIN','PRINT','STYLE','ROUTE'],0],
      ['ACID is associated with?',['Database transactions','Web colors','Network cables','CPU registers'],0]
    ]}
  ];
  const bank = banks.find(b => b.key.some(k => subject.includes(k))) || { key:[], topic:task.subject || 'General', qs:[
    ['What is the best first step when studying a new topic?',['Understand the core concept','Skip directly to guessing','Memorize random words','Avoid examples'],0],
    ['What helps check whether you really understand a topic?',['Active recall','Only rereading','Ignoring questions','Skipping practice'],0],
    ['What is a good revision strategy?',['Practice questions and spaced review','Study everything randomly once','Never test yourself','Only highlight text'],0],
    ['When you find a weak area, what should you do?',['Revisit it and practice','Ignore it','Delete your notes','Stop studying'],0],
    ['Why use previous-year questions?',['To identify recurring concepts and exam patterns','To guarantee exact questions','To replace all learning','To avoid revision'],0]
  ]};
  res.json({ taskId:task._id, topic:bank.topic, questions:bank.qs.map(([question,options,answer])=>({question,options,answer})) });
});
app.delete('/api/tasks/:id', auth, async (req, res) => { await Task.deleteOne({ _id: req.params.id, user: req.user._id }); res.json({ ok: true }); });

app.get('/api/friends', auth, async (req, res) => {
  const me = req.user._id;
  const [incoming, outgoing, accepted] = await Promise.all([
    Connection.find({ recipient: me, status: 'pending' }).populate('requester', 'name email readiness streak topicsDone'),
    Connection.find({ requester: me, status: 'pending' }).populate('recipient', 'name email readiness streak topicsDone'),
    Connection.find({ status: 'accepted', $or: [{ requester: me }, { recipient: me }] }).populate('requester', 'name email readiness streak topicsDone').populate('recipient', 'name email readiness streak topicsDone')
  ]);
  const connected = accepted.map(c => String(c.requester._id) === String(me) ? c.recipient : c.requester);
  res.json({ incoming, outgoing, connected });
});

app.get('/api/friends/search', auth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ users: [] });
  const emailQ = q.includes('@') ? q : `${q}@gmail.com`;
  const users = await User.find({
    _id: { $ne: req.user._id },
    $or: [
      { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { email: emailQ.toLowerCase() }
    ]
  }).select('name email readiness streak topicsDone').limit(10);
  res.json({ users });
});

app.post('/api/friends/request/:userId', auth, async (req, res) => {
  if (String(req.params.userId) === String(req.user._id)) return sendErr(res, 400, 'You cannot follow yourself');
  const target = await User.findById(req.params.userId);
  if (!target) return sendErr(res, 404, 'Student not found');
  const existing = await Connection.findOne({ requester: req.user._id, recipient: target._id });
  if (existing) return sendErr(res, 409, 'Request already exists');
  const reverse = await Connection.findOne({ requester: target._id, recipient: req.user._id });
  if (reverse?.status === 'pending') return sendErr(res, 409, 'This student already sent you a request');
  const c = await Connection.create({ requester: req.user._id, recipient: target._id });
  res.status(201).json({ connection: c });
});

app.post('/api/friends/:connectionId/accept', auth, async (req, res) => {
  const c = await Connection.findOne({ _id: req.params.connectionId, recipient: req.user._id, status: 'pending' });
  if (!c) return sendErr(res, 404, 'Request not found');
  c.status='accepted'; await c.save(); res.json({ connection: c });
});
app.post('/api/friends/:connectionId/reject', auth, async (req, res) => {
  const c = await Connection.findOne({ _id: req.params.connectionId, recipient: req.user._id, status: 'pending' });
  if (!c) return sendErr(res, 404, 'Request not found');
  c.status='rejected'; await c.save(); res.json({ connection: c });
});

app.get('/api/leaderboard', auth, async (req, res) => {
  const me = req.user._id;
  const accepted = await Connection.find({ status: 'accepted', $or: [{ requester: me }, { recipient: me }] });
  const ids = [me, ...accepted.flatMap(c => [c.requester, c.recipient])].map(String);
  const unique = [...new Set(ids)];
  const users = await User.find({ _id: { $in: unique } }).select('name readiness streak topicsDone studyMinutes');
  const leaderboard = users.map(u => ({ id:u._id, name:u.name, readiness:u.readiness, streak:u.streak, topicsDone:u.topicsDone, performance: performanceScore(u), me:String(u._id)===String(me) })).sort((a,b)=>b.performance-a.performance);
  res.json({ leaderboard });
});

app.post('/api/pyq/analyze', auth, upload.single('file'), async (req, res) => {
  try {
    let raw = req.body?.text || '';
    let fileName = '';
    if (req.file) { fileName = req.file.originalname; raw = req.file.buffer.toString('utf8'); }
    if (!raw.trim()) return sendErr(res, 400, 'Paste PYQs or upload a text file');
    const subjects = (req.user.education?.subjects || []).map(s => typeof s === 'string' ? s : s.name).filter(Boolean);
    let analysis = await analyzePYQWithAI(raw, subjects);
    if (!analysis) analysis = analyzePYQLocally(raw, subjects);
    const doc = await PYQ.create({ user:req.user._id, fileName, rawText:raw, analysis });
    res.status(201).json({ id:doc._id, analysis, source: process.env.GROQ_API_KEY ? 'groq' : process.env.GEMINI_API_KEY ? 'gemini' : 'local' });
  } catch (e) { console.error(e); sendErr(res, 500, 'PYQ analysis failed'); }
});



// ================= CHAT HISTORY =================
app.get('/api/chats', auth, async (req, res) => {
  const chats = await Chat.find({ user: req.user._id })
    .select('title updatedAt createdAt messages')
    .sort({ updatedAt: -1 })
    .limit(50);
  res.json({ chats: chats.map(c => ({
    id: c._id,
    title: c.title || 'New Chat',
    updatedAt: c.updatedAt,
    messageCount: c.messages.length
  })) });
});

app.get('/api/chats/:id', auth, async (req, res) => {
  const chat = await Chat.findOne({ _id: req.params.id, user: req.user._id });
  if (!chat) return sendErr(res, 404, 'Chat not found');
  res.json({ chat });
});

app.post('/api/chats', auth, async (req, res) => {
  const title = String(req.body?.title || 'New Chat').trim().slice(0, 80) || 'New Chat';
  const chat = await Chat.create({ user: req.user._id, title, messages: [] });
  res.status(201).json({ chat: { id: chat._id, title: chat.title, updatedAt: chat.updatedAt, messageCount: 0 } });
});

app.put('/api/chats/:id', auth, async (req, res) => {
  try {
    const update = {};
    if (typeof req.body?.title === 'string') {
      update.title = req.body.title.trim().slice(0, 80) || 'New Chat';
    }
    if (Array.isArray(req.body?.messages)) {
      update.messages = req.body.messages
        .filter(m => m && ['user','assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim())
        .slice(-60)
        .map(m => ({ role: m.role, content: m.content }));
    }
    const chat = await Chat.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!chat) return sendErr(res, 404, 'Chat not found');
    res.json({ chat });
  } catch (e) {
    console.error('Chat update failed:', e);
    sendErr(res, 500, 'Could not save chat history');
  }
});

app.delete('/api/chats/:id', auth, async (req, res) => {
  const result = await Chat.deleteOne({ _id: req.params.id, user: req.user._id });
  if (!result.deletedCount) return sendErr(res, 404, 'Chat not found');
  res.json({ ok: true });
});

app.post('/api/ai/chat', auth, async (req, res) => {
  const { message, language='Easy English', mode='assistant', context={}, history=[] } = req.body || {};
  if (!message?.trim()) return sendErr(res, 400, 'Message required');
  const result = await askAI({ message, language, mode, context, history, user:req.user });
  res.json(result);
});

app.post('/api/planner/generate', auth, async (req, res) => {
  try {
    const { examDate, subjects = [], availableMinutes } = req.body || {};
    if (!examDate || !subjects.length) return sendErr(res, 400, 'Exam date and subjects are required');
    const totalMinutes = Math.max(10, Number(availableMinutes || 60));
    const start = new Date();
    const end = new Date(examDate + 'T23:59:59');
    const days = Math.max(1, Math.ceil((end - start) / 86400000));

    const latestPYQ = await PYQ.findOne({ user: req.user._id }).sort({ createdAt: -1 }).lean();
    const importantTopics = (latestPYQ?.analysis?.priority || [])
      .slice(0, 10)
      .map(item => ({ topic: item.topic, count: Number(item.count || 0), level: item.level || 'medium', subject: item.subject || '' }));

    // Distribute today's time across important topics first. If PYQs exist,
    // do not create random subject-only tasks.
    const topicTasks = importantTopics.slice(0, Math.max(1, Math.min(6, Math.ceil(totalMinutes / 10))));
    const perTopic = Math.max(5, Math.floor(totalMinutes / Math.max(1, topicTasks.length)));
    const plan = subjects.map((s, i) => {
      const subject = String(s.name || s).trim();
      const matched = importantTopics.filter(t =>
        (t.subject && t.subject.toLowerCase() === subject.toLowerCase()) ||
        t.topic.toLowerCase().includes(subject.toLowerCase()) || subject.toLowerCase().includes(t.topic.toLowerCase())
      );
      return {
        subject, examDate,
        priority: matched.length ? (matched[0].level === 'very-high' ? 'very-high' : matched[0].level === 'high' ? 'high' : 'medium') : (i < 2 ? 'high' : 'medium'),
        recommendedMinutes: matched.length ? Math.min(totalMinutes, Math.max(5, matched.slice(0,3).length * perTopic)) : Math.max(5, Math.floor(totalMinutes / Math.max(1, subjects.length))),
        importantTopics: matched.map(t => t.topic).slice(0, 5)
      };
    });

    res.json({
      days, totalMinutes, plan, importantTopics,
      hasPYQAnalysis: Boolean(importantTopics.length),
      note: days <= 3 ? 'Priority Mode' : days <= 7 ? 'Focused Revision' : 'Full Preparation',
      strategy: importantTopics.length
        ? 'PYQ-first: repeated concepts are shown first so you focus on high-value topics instead of studying randomly.'
        : 'Start with PYQ analysis to unlock topic-level priorities.'
    });
  } catch (e) { console.error(e); sendErr(res, 500, 'Planner generation failed'); }
});

function publicUser(u){ return { id:u._id, name:u.name, email:u.email, education:u.education, streak:u.streak, readiness:u.readiness, topicsDone:u.topicsDone, studyMinutes:u.studyMinutes }; }
function performanceScore(u){ return Math.round((u.readiness*.55) + (Math.min(100,u.topicsDone*2)*.25) + (Math.min(100,u.streak*7)*.20)); }

function normalizeTopic(topic) {
  return String(topic || '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

async function analyzePYQWithAI(text, subjects=[]) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) return null;
  const prompt = `Analyze these previous-year exam questions for a student. Identify recurring/high-value concepts, group similar wording, and return ONLY valid JSON.
Student subjects: ${JSON.stringify(subjects)}
Return exactly: {"questions":number,"priority":[{"topic":string,"subject":string,"count":number,"level":"very-high|high|medium"}],"repeated":[{"topic":string,"subject":string,"count":number}],"disclaimer":string}
Rules: count recurrence only from the supplied questions; merge synonyms such as "normal forms/3NF/normalization" when clearly the same concept; do not invent questions; prioritize concepts appearing multiple times and concepts that are central to the supplied questions. If a concept appears once but is clearly important, it may be medium. Disclaimer must say this is a revision signal, not a guarantee.
Questions:\n${text.slice(0, 30000)}`;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},
      body:JSON.stringify({ model:process.env.GROQ_MODEL||'openai/gpt-oss-120b', messages:[{role:'system',content:'You are a careful PYQ analyst. Output JSON only.'},{role:'user',content:prompt}], temperature:0.1, max_tokens:1800 })
    });
    if (!r.ok) { console.error('Groq PYQ error:', r.status); return null; }
    const data=await r.json();
    const raw=String(data?.choices?.[0]?.message?.content||'').trim().replace(/^```json\s*/,'').replace(/```$/,'').trim();
    const parsed=JSON.parse(raw);
    if (!Array.isArray(parsed.priority)) return null;
    parsed.priority=parsed.priority.map(x=>({topic:normalizeTopic(x.topic),subject:normalizeTopic(x.subject),count:Number(x.count||0),level:['very-high','high','medium'].includes(x.level)?x.level:'medium'})).filter(x=>x.topic && x.count>0).slice(0,10);
    parsed.repeated=Array.isArray(parsed.repeated) ? parsed.repeated.map(x=>({topic:normalizeTopic(x.topic),subject:normalizeTopic(x.subject),count:Number(x.count||0)})).filter(x=>x.topic).slice(0,15) : parsed.priority;
    parsed.questions=Number(parsed.questions)||text.split(/\r?\n+/).filter(Boolean).length;
    parsed.disclaimer=parsed.disclaimer||'Frequency is a revision signal, not a guarantee that a question will repeat.';
    return parsed;
  } catch (e) { console.error('Groq PYQ analysis failed:', e.message); return null; }
}

function analyzePYQLocally(text, subjects=[]) {
  const lines=text.split(/\r?\n+/).map(s=>s.replace(/^\s*[\d.)-]+\s*/,'').trim()).filter(Boolean);
  const rules = [
    ['Normalization','DBMS / SQL',/normalization|normal forms?|1nf|2nf|3nf|bcnf/i],
    ['SQL','DBMS / SQL',/\bsql\b|select|insert|update|delete|query/i],
    ['Joins','DBMS / SQL',/\bjoins?\b|inner join|left join|right join|full join/i],
    ['Transactions','DBMS / SQL',/transaction|commit|rollback/i],
    ['ACID','DBMS / SQL',/\bacid\b|atomicity|consistency|isolation|durability/i],
    ['Indexing','DBMS / SQL',/index(?:ing)?|b-tree|hash index/i],
    ['ER Model','DBMS / SQL',/er model|entity relationship|cardinality/i],
    ['Operating Systems','Operating Systems',/operating system|\bos\b/i],
    ['Process Scheduling','Operating Systems',/scheduling|fcfs|round robin|sjf|priority scheduling/i],
    ['Deadlock','Operating Systems',/deadlock|banker's algorithm|bankers algorithm/i],
    ['Computer Networks','Computer Networks',/computer network|networking/i],
    ['OSI','Computer Networks',/\bosi\b|seven layers?|application layer|transport layer|network layer/i],
    ['TCP/IP','Computer Networks',/\btcp\b|\bip\b|udp|internet protocol/i],
    ['OOP','Programming',/object[- ]oriented|\boop\b/i],
    ['Inheritance','Programming',/inheritance|polymorphism|encapsulation|abstraction/i],
    ['Recursion','Programming',/recursion|recursive/i],
    ['Arrays','Programming',/\barrays?\b/i],
    ['Stacks','Data Structures',/\bstacks?\b/i],
    ['Queues','Data Structures',/\bqueues?\b/i],
    ['Web Development','Web Development',/html|css|javascript|web development|dom|http/i],
    ['Software Engineering','Software Engineering',/software engineering|requirements|waterfall|agile|testing|sdlc/i],
    ['Artificial Intelligence','AI',/artificial intelligence|\bai\b|machine learning|neural network|classification|regression/i],
  ];
  const ranked=rules.map(([topic,subject,re])=>({topic,subject,count:lines.filter(x=>re.test(x)).length})).filter(x=>x.count>0);
  // Add explicit subject matches if they are not covered by the rules.
  for (const subject of subjects) {
    const name=String(subject).trim();
    if(name && !ranked.some(x=>x.subject.toLowerCase()===name.toLowerCase())) {
      const count=lines.filter(x=>x.toLowerCase().includes(name.toLowerCase())).length;
      if(count) ranked.push({topic:name,subject:name,count});
    }
  }
  ranked.sort((a,b)=>b.count-a.count);
  const priority=ranked.slice(0,10).map((x,i)=>({...x,level:x.count>=3||i<2?'very-high':x.count>=2||i<5?'high':'medium'}));
  return {questions:lines.length,repeated:ranked.slice(0,15),priority,disclaimer:'Frequency is a revision signal, not a guarantee that a question will repeat.'};
}

async function askAI({message,language='Easy English',mode='assistant',context={},history=[],user}){
  const languageInstruction = language === 'Hindi'
    ? 'Answer mainly in Hindi using Devanagari script. Use English technical words where appropriate. Keep Hindi simple and student-friendly.'
    : language === 'Hinglish'
      ? 'Answer in natural Hinglish using Roman Hindi mixed with English. Do not use Devanagari unless asked.'
      : 'Answer in simple, clear English.';
  const studentProfile = { name:user?.name||'', education:user?.education||{}, readiness:user?.readiness||0, topicsDone:user?.topicsDone||0, studyMinutes:user?.studyMinutes||0 };
  const safeHistory = Array.isArray(history) ? history.slice(-16).filter(x => x && (x.role==='user'||x.role==='assistant') && typeof x.content==='string').map(x=>({role:x.role,content:x.content})) : [];
  const messages=[{role:'system',content:`You are StudyMate AI, a highly capable personal study assistant and tutor.\n${languageInstruction}\nAnswer the student's actual question. Remember conversation history and understand follow-ups. Explain difficult concepts step-by-step. Be accurate. Never guarantee a particular exam question. Be friendly and practical. Student profile: ${JSON.stringify(studentProfile)}. Additional context: ${JSON.stringify(context)}. Current mode: ${mode}`} , ...safeHistory, {role:'user',content:message}];
  async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }

  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    try {
      const r=await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${groqKey}`},body:JSON.stringify({model:process.env.GROQ_MODEL||'openai/gpt-oss-120b',messages,temperature:0.5,max_tokens:1800})});
      if(r.ok){ const data=await r.json(); const out=String(data?.choices?.[0]?.message?.content||'').trim(); if(out) return {reply:out,source:'groq'}; }
      else console.error('Groq error:', r.status, await r.text().catch(()=>'') );
    } catch (e) { console.error('Groq call failed:', e.message); }
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    try {
      const text = `System instructions: You are StudyMate AI. ${languageInstruction} Answer the student's actual question accurately and practically. Never guarantee an exam question.\nStudent profile: ${JSON.stringify(studentProfile)}\nContext: ${JSON.stringify(context)}\nConversation: ${JSON.stringify(safeHistory)}\nStudent question: ${message}`;
      const url=`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL||'gemini-2.5-flash'}:generateContent?key=${encodeURIComponent(geminiKey)}`;
      const r=await fetchWithTimeout(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text}]}],generationConfig:{temperature:0.5,maxOutputTokens:1800}})});
      if(r.ok){ const data=await r.json(); const out=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim(); if(out) return {reply:out,source:'gemini'}; }
      else console.error('Gemini error:', r.status, await r.text().catch(()=>''));
    } catch (e) { console.error('Gemini call failed:', e.message); }
  }

  return {reply:localAI(message,language,mode,user),source:'local-fallback'};
}
function localAI(message,language,mode,user){
  const q=message.toLowerCase();
  if(q.includes('10 min')) return '🚨 10-minute revision: 4 min on your highest-priority topic → 3 min formulas/definitions → 2 min recall → 1 min breathe and review. Do not start a completely new difficult chapter now.';
  if(q.includes('improve')||q.includes('check')) return `🔎 Your checkup: readiness ${user.readiness}%, ${user.topicsDone} topics completed, ${user.studyMinutes} study minutes. Improve next by doing timed PYQs, revising weak topics, and taking a short quiz after each major concept.`;
  if(q.includes('summar')) return '📝 Summary mode: send the topic name and I will turn it into easy points, examples, memory tricks and an exam-ready answer.';
  if(q.includes('explain')) return `📚 Explain mode: tell me the topic (for example, “Explain DBMS normalization in easy Hindi”). I will adapt the explanation to ${language} and your level.`;
  if(q.includes('quiz')) return '🧠 Quiz mode: ask “quiz me on [topic]” and I will give short questions with explanations after your answers.';
  return `Got it. I can help with “${message}”. Tell me the subject/topic and your preferred language (${language}) if you want a more focused answer.`;
}

const port=Number(process.env.PORT||5000);
try{
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/studymate');
  console.log('MongoDB connected');
  await User.updateMany(
    { $or: [{ topicsDone: { $lt: 0 } }, { studyMinutes: { $lt: 0 } }] },
    { $max: { topicsDone: 0, studyMinutes: 0 } }
  );
}catch(e){ console.error('MongoDB connection failed:',e.message); process.exit(1); }
app.listen(port,()=>console.log(`StudyMate API running on http://localhost:${port}`));
