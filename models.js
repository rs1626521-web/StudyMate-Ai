import mongoose from 'mongoose';

const subjectSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  examDate: { type: Date },
  topics: [{ type: String, trim: true }],
  priority: { type: String, enum: ['low','medium','high','very-high'], default: 'medium' }
}, { _id: true });

const educationSchema = new mongoose.Schema({
  type: { type: String, enum: ['School','College'] },
  level: String,
  semester: String,
  subjects: [subjectSchema],
  timetableText: String
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  resetTokenHash: { type: String, default: null, index: true },
  resetTokenExpiresAt: { type: Date, default: null },
  education: educationSchema,
  streak: { type: Number, default: 0 },
  readiness: { type: Number, default: 0 },
  topicsDone: { type: Number, default: 0 },
  studyMinutes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const connectionSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending','accepted','rejected'], default: 'pending' }
}, { timestamps: true });
connectionSchema.index({ requester: 1, recipient: 1 }, { unique: true });

const taskSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  subject: String,
  priority: { type: String, enum: ['Low','Medium','High'], default: 'Medium' },
  dueDate: Date,
  done: { type: Boolean, default: false }
}, { timestamps: true });


const chatSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, default: 'New Chat', trim: true },
  messages: [{
    role: { type: String, enum: ['user','assistant'], required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });
chatSchema.index({ user: 1, updatedAt: -1 });

const pyqSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: String,
  rawText: { type: String, required: true },
  analysis: mongoose.Schema.Types.Mixed
}, { timestamps: true });

export const User = mongoose.model('User', userSchema);
export const Connection = mongoose.model('Connection', connectionSchema);
export const Task = mongoose.model('Task', taskSchema);
export const PYQ = mongoose.model('PYQ', pyqSchema);
export const Chat = mongoose.model('Chat', chatSchema);
