/* =========================================================
   StudyMate AI - Upgraded Frontend
   Replace the COMPLETE frontend/app.js with this file.
   ========================================================= */

const API = 'http://localhost:5000/api';

let token = localStorage.getItem('sm_token') || '';
let me = null;
let eduType = '';
let chatHistory = JSON.parse(localStorage.getItem('sm_chat_history') || '[]');
let activeChatId = localStorage.getItem('sm_active_chat_id') || '';
let savedChats = [];
let isAIThinking = false;

const $ = id => document.getElementById(id);

const normalizeEmail = value => { const raw = String(value || '').trim().toLowerCase(); return raw ? (raw.includes('@') ? raw : raw + '@gmail.com') : ''; };

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));

/* =========================================================
   API HELPER
========================================================= */
async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) headers.Authorization = 'Bearer ' + token;

  const response = await fetch(API + path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || `Request failed (${response.status})`);
  }

  return data;
}

/* =========================================================
   NAVIGATION
========================================================= */
function go(id) {
  document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));

  const page = $(id);
  if (!page) return;

  page.classList.add('active');

  document.querySelectorAll('nav button').forEach(button => {
    button.classList.toggle('active', button.dataset.page === id);
  });

  if (id === 'home') loadDashboard();
  if (id === 'friends') loadFriends();
  if (id === 'setup') renderEdu();
  if (id === 'planner') loadTasks();
  if (id === 'assistant') {
    renderChat();
    setTimeout(() => $('ask')?.focus(), 100);
  }
}

function toast(message) {
  const element = $('toast');
  if (!element) return;

  element.textContent = message;
  element.classList.add('show');

  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    element.classList.remove('show');
  }, 2500);
}

/* =========================================================
   AUTH
========================================================= */
let authMode = 'login';

document.querySelectorAll('#email, #forgotEmail').forEach(input => {
  input?.addEventListener('blur', () => {
    const value = input.value.trim();
    if (value && !value.includes('@')) input.value = value + '@gmail.com';
  });
});

document.querySelectorAll('[data-auth]').forEach(button => {
  button.onclick = () => {
    authMode = button.dataset.auth;

    document.querySelectorAll('[data-auth]').forEach(item => {
      item.classList.toggle('active', item === button);
    });

    $('authView').classList.toggle('register-mode', authMode === 'register');
    $('authMsg').textContent = '';
  };
});

$('authForm').onsubmit = async event => {
  event.preventDefault();

  try {
    const body = {
      email: normalizeEmail($('email').value),
      password: $('password').value
    };

    if (authMode === 'register') {
      body.name = $('name').value.trim();
    }

    const data = await api(
      '/auth/' + (authMode === 'register' ? 'register' : 'login'),
      {
        method: 'POST',
        body: JSON.stringify(body)
      }
    );

    token = data.token;
    localStorage.setItem('sm_token', token);

    await boot();
  } catch (error) {
    $('authMsg').textContent = error.message;
    $('authMsg').style.color = '#ef476f';
  }
};

$('forgotPasswordBtn')?.addEventListener('click', () => {
  $('authForm').classList.add('hidden');
  $('forgotPasswordBtn').classList.add('hidden');
  $('forgotView').classList.remove('hidden');
  $('forgotEmail').value = $('email').value.trim();
  if ($('forgotEmail').value) localStorage.setItem('sm_reset_email', $('forgotEmail').value);
  $('forgotEmail').focus();
  $('authMsg').textContent = '';
});

$('backToLogin')?.addEventListener('click', () => {
  $('forgotView').classList.add('hidden');
  $('authForm').classList.remove('hidden');
  $('forgotPasswordBtn').classList.remove('hidden');
  $('forgotMsg').textContent = '';
});

$('forgotForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const data = await api('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: normalizeEmail($('forgotEmail').value) })
    });
    $('forgotMsg').textContent = data.message;
    $('forgotMsg').style.color = '';
  } catch (error) {
    $('forgotMsg').textContent = 'Please try again.';
    $('forgotMsg').style.color = '#ef476f';
  }
});

function checkResetLink() {
  const params = new URLSearchParams(location.search);
  const resetToken = params.get('reset');
  if (!resetToken) return false;
  $('authView').classList.add('hidden');
  $('appView').classList.add('hidden');
  $('resetView').classList.remove('hidden');
  $('resetForm').dataset.token = resetToken;
  return true;
}

$('resetForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('resetPassword').value;
  const confirm = $('resetPassword2').value;
  if (password.length < 6) return $('resetMsg').textContent = 'Password must be at least 6 characters.';
  if (password !== confirm) return $('resetMsg').textContent = 'Passwords do not match.';
  try {
    const data = await api('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: event.currentTarget.dataset.token, password })
    });
    $('resetMsg').textContent = 'Password updated successfully. You can now log in with your new password.';
    $('resetMsg').style.color = '#22a06b';
    const savedEmail = $('forgotEmail')?.value.trim() || localStorage.getItem('sm_reset_email') || '';
    setTimeout(() => {
      history.replaceState({}, document.title, location.pathname);
      $('resetView').classList.add('hidden');
      $('authView').classList.remove('hidden');
      $('authForm').classList.remove('hidden');
      $('forgotPasswordBtn').classList.remove('hidden');
      $('email').value = savedEmail;
      $('password').value = '';
      $('authMsg').textContent = 'Password changed. Enter your new password to continue.';
      $('authMsg').style.color = '#22a06b';
    }, 1400);
  } catch (error) {
    $('resetMsg').textContent = error.message;
    $('resetMsg').style.color = '#ef476f';
  }
});

$('logout').onclick = () => {
  token = '';
  localStorage.removeItem('sm_token');
  chatHistory = [];
  localStorage.removeItem('sm_chat_history');

  $('appView').classList.add('hidden');
  $('authView').classList.remove('hidden');
};

async function boot() {
  if (checkResetLink()) return;
  try {
    const data = await api('/me');
    me = data.user;
    refreshProfileUI();

    $('authView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    $('hello').textContent = 'Hi, ' + me.name + '!';

    renderChat();
    await loadChatHistory();
    await loadDashboard();
  } catch (error) {
    token = '';
    localStorage.removeItem('sm_token');
    $('appView').classList.add('hidden');
    $('authView').classList.remove('hidden');
  }
}

/* =========================================================
   DASHBOARD
========================================================= */
function refreshProfileUI() {
  if (!me) return;
  const name = me.name || 'Student';
  const initials = name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase() || 'S';
  $('hello') && ($('hello').textContent = 'Hi, ' + name + '!');
  $('profileName') && ($('profileName').textContent = name);
  $('profileAvatar') && ($('profileAvatar').textContent = initials);
  $('profileBigName') && ($('profileBigName').textContent = name);
  $('profileBigEmail') && ($('profileBigEmail').textContent = me.email || '');
  $('profileBigAvatar') && ($('profileBigAvatar').textContent = initials);
  if ($('profileDetails')) {
    const e=me.education||{}; const subs=(e.subjects||[]).map(x=>x.name).join(', ')||'Not set';
    $('profileDetails').innerHTML = `<div><b>Education</b><span>${esc(e.type||'Not set')}</span></div><div><b>Year / Level</b><span>${esc(e.level||'Not set')}</span></div><div><b>Semester</b><span>${esc(e.semester||'Not set')}</span></div><div><b>Subjects</b><span>${esc(subs)}</span></div><div><b>Readiness</b><span>${me.readiness||0}%</span></div><div><b>Topics done</b><span>${Math.max(0,me.topicsDone||0)}</span></div><div><b>Study minutes</b><span>${Math.max(0,me.studyMinutes||0)}</span></div>`;
  }
}

async function loadDashboard() {
  try {
    const [tasksData, leaderboardData] = await Promise.all([
      api('/tasks'),
      api('/leaderboard')
    ]);

    const tasks = tasksData.tasks || [];
    const leaderboard = leaderboardData.leaderboard || [];
    const rankIndex = leaderboard.findIndex(item => item.me);
    const rank = rankIndex >= 0 ? rankIndex + 1 : '—';

    let days = '—';
    let subject = 'Set your exam date';

    if (me?.education?.subjects?.length) {
      const upcoming = me.education.subjects
        .filter(item => item.examDate)
        .sort((a, b) => new Date(a.examDate) - new Date(b.examDate))[0];

      if (upcoming) {
        days = Math.max(
          0,
          Math.ceil((new Date(upcoming.examDate) - new Date()) / 86400000)
        );
        subject = upcoming.name;
      }
    }

    $('days').textContent = days;
    $('examText').textContent = subject;

    $('stats').innerHTML = [
      ['🎯', me.readiness + '%', 'Readiness'],
      ['✅', Math.max(0, me.topicsDone || 0), 'Topics done'],
      ['⏱', Math.max(0, me.studyMinutes || 0), 'Study minutes'],
      ['🏆', '#' + rank, 'Friends rank']
    ].map(item => `
      <div class="card">
        <div style="font-size:24px">${item[0]}</div>
        <h2>${esc(item[1])}</h2>
        <small>${esc(item[2])}</small>
      </div>
    `).join('');

    $('tasks').innerHTML = tasks.slice(0, 5).map(taskHTML).join('') || '<p>No tasks yet.</p>';

    const next = tasks.find(item => !item.done);

    $('nextStep').innerHTML = next
      ? `<b>${esc(next.title)}</b><p>High-value next step. Start this before lower-priority tasks.</p>`
      : '<b>All caught up 🎉</b>';
  } catch (error) {
    toast(error.message);
  }
}

function taskHTML(task) {
  return `
    <div class="task">
      <div style="flex:1;min-width:0">
        <b>${esc(task.title)}</b>
        <small>${esc(task.subject || '')} · ${esc(task.priority || 'Medium')}</small>
      </div>
      <button class="btn secondary" onclick="${task.done ? `toggleTask('${task._id}',false)` : `startTaskQuiz('${task._id}')`}">
        ${task.done ? 'Undo' : 'Quick Quiz'}
      </button>
    </div>
  `;
}

async function loadTasks() {
  try {
    const data = await api('/tasks');
    $('allTasks').innerHTML = data.tasks.map(taskHTML).join('') || '<p>No tasks.</p>';
  } catch (error) {
    toast(error.message);
  }
}

let activeQuiz = null;

async function startTaskQuiz(taskId) {
  try {
    const data = await api('/quiz/' + taskId);
    activeQuiz = { ...data, index:0, answers:[], minutes: Number(data.recommendedMinutes || 15) };
    $('quizTitle').textContent = '🧠 Quick Quiz — ' + data.topic;
    $('quizSubtitle').textContent = `${data.questions.length} questions · complete this quiz to mark the task done`;
    $('quizModal').classList.remove('hidden');
    renderQuizQuestion();
  } catch (error) { toast(error.message); }
}

function renderQuizQuestion() {
  const q = activeQuiz.questions[activeQuiz.index];
  const n = activeQuiz.index + 1;
  $('quizBody').innerHTML = `
    <div class="quiz-progress">Question ${n} of ${activeQuiz.questions.length}</div>
    <h3 class="quiz-question">${esc(q.question)}</h3>
    <div class="quiz-options">${q.options.map((option,i)=>`<button class="quiz-option" onclick="answerQuiz(${i})">${String.fromCharCode(65+i)}. ${esc(option)}</button>`).join('')}</div>
  `;
}

function answerQuiz(choice) {
  activeQuiz.answers.push(choice);
  if (activeQuiz.index < activeQuiz.questions.length - 1) { activeQuiz.index++; renderQuizQuestion(); return; }
  finishQuiz();
}

async function finishQuiz() {
  const score = activeQuiz.answers.reduce((sum, answer, i) => sum + (answer === activeQuiz.questions[i].answer ? 1 : 0), 0);
  const total = activeQuiz.questions.length;
  const percent = Math.round(score / total * 100);
  const review = activeQuiz.questions.map((q,i) => {
    const chosen = activeQuiz.answers[i];
    const ok = chosen === q.answer;
    return `<div class="quiz-review ${ok?'correct':'wrong'}"><b>${ok?'✅':'❌'} Q${i+1}</b><div>${esc(q.question)}</div><small>Your answer: <b>${esc(q.options[chosen] ?? 'Not answered')}</b></small>${ok?'':`<small>Correct answer: <b>${esc(q.options[q.answer])}</b></small>`}<small>${ok?'Correct.':'Review this topic and try again.'}</small></div>`;
  }).join('');
  try {
    if (percent >= 60) {
      await api('/tasks/' + activeQuiz.taskId, { method:'PATCH', body:JSON.stringify({ done:true, studyMinutes: activeQuiz.minutes || 15 }) });
      $('quizBody').innerHTML = `<div class="quiz-result"><div class="quiz-score">${score}/${total}</div><h3>${percent >= 80 ? 'Excellent! 🎉' : 'Good job! 💪'}</h3><p>${percent}% correct. Task completed and your progress was updated.</p><div class="quiz-review-wrap">${review}</div><button class="btn primary" onclick="closeQuizAndRefresh()">Continue</button></div>`;
    } else {
      $('quizBody').innerHTML = `<div class="quiz-result"><div class="quiz-score">${score}/${total}</div><h3>Keep practicing! 📚</h3><p>${percent}% correct. Score at least 60% to mark this task complete.</p><div class="quiz-review-wrap">${review}</div><button class="btn primary" onclick="startTaskQuiz('${activeQuiz.taskId}')">Retry Quiz</button></div>`;
    }
  } catch (error) { toast(error.message); }
}
function closeQuizAndRefresh() {
  $('quizModal').classList.add('hidden'); activeQuiz = null; loadTasks(); loadDashboard();
}

$('closeQuiz')?.addEventListener('click', closeQuizAndRefresh);

async function toggleTask(id, done) {
  try {
    await api('/tasks/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ done })
    });

    toast(done ? 'Task completed ✅' : 'Task reopened');
    await loadDashboard();
    await loadTasks();
  } catch (error) {
    toast(error.message);
  }
}

/* =========================================================
   EDUCATION
========================================================= */
function educationType(type) {
  eduType = type;

  $('school').classList.toggle('active', type === 'School');
  $('college').classList.toggle('active', type === 'College');

  if (type === 'School') {
    $('eduFields').innerHTML = `
      <label>
        Class
        <select id="level">
          <option>6</option><option>7</option><option>8</option>
          <option>9</option><option>10</option><option>11</option><option>12</option>
        </select>
      </label>
      <label>
        Subjects
        <input id="eduSubjects" placeholder="Maths, Science, English">
      </label>
    `;
  } else {
    $('eduFields').innerHTML = `
      <label>
        Year
        <select id="level">
          <option>1st Year</option><option>2nd Year</option>
          <option>3rd Year</option><option>4th Year</option>
        </select>
      </label>
      <label>
        Semester
        <select id="semester">
          <option>Semester 1</option><option>Semester 2</option>
          <option>Semester 3</option><option>Semester 4</option>
          <option>Semester 5</option><option>Semester 6</option>
          <option>Semester 7</option><option>Semester 8</option>
        </select>
      </label>
      <label>
        Subjects
        <input id="eduSubjects" placeholder="DBMS, Java, OS">
      </label>
    `;
  }
}

function renderEdu() {
  if (me?.education?.type) {
    educationType(me.education.type);

    setTimeout(() => {
      if ($('level')) $('level').value = me.education.level || '';
      if ($('semester')) $('semester').value = me.education.semester || '';
      if ($('eduSubjects')) {
        $('eduSubjects').value = (me.education.subjects || [])
          .map(item => item.name)
          .join(', ');
      }
      renderExams();
    }, 20);
  } else {
    $('eduFields').innerHTML = '<p>Select School or College.</p>';
  }

  $('tt').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;

    const text = await file.text();
    me.education = me.education || {};
    me.education.timetableText = text;

    toast('Timetable uploaded. Save setup to send it to the backend.');
  };
}

async function saveEducation() {
  const subjects = ($('eduSubjects')?.value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  const payload = {
    type: eduType || me.education?.type || 'School',
    level: $('level')?.value || me.education?.level,
    semester: $('semester')?.value || '',
    subjects: subjects.map(name => ({ name })),
    timetableText: me.education?.timetableText || ''
  };

  try {
    const data = await api('/me/education', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });

    me = data.user;
    renderExams();
    toast('Education saved ✅');
    go('planner');
  } catch (error) {
    toast(error.message);
  }
}

function renderExams() {
  const subjects = me?.education?.subjects || [];

  $('examList').innerHTML = subjects.length
    ? subjects.map(item => `
        <div class="task">
          <b>${esc(item.name)}</b>
          <small>${item.examDate ? new Date(item.examDate).toLocaleDateString() : 'Exam date to be added'}</small>
        </div>
      `).join('')
    : 'No subjects yet.';
}

function useEducationSubjects() {
  if (me?.education?.subjects?.length) {
    $('subjects').value = me.education.subjects.map(item => item.name).join(', ');
  } else {
    toast('Set education first');
  }
}

/* =========================================================
   PLANNER
========================================================= */
async function generatePlan() {
  const date = $('examDate').value;
  const subjects = ($('subjects').value || '')
    .split(',')
    .map(name => ({ name: name.trim(), examDate: date }))
    .filter(item => item.name);

  if (!date) return toast('Please select your exam date');
  if (!subjects.length) return toast('Please add at least one subject');

  try {
    const data = await api('/planner/generate', {
      method: 'POST',
      body: JSON.stringify({
        examDate: date,
        subjects,
        availableMinutes: Number($('studyTime').value)
      })
    });

    const topics = data.importantTopics || [];
    const topicBlock = topics.length
      ? `<div class="planner-focus"><div class="planner-focus-head"><b>🔥 Important topics to focus on</b><small>Based on repeated concepts in your latest PYQs</small></div>${topics.map(item => `<div class="focus-topic"><span>${esc(item.topic)}</span><small>${item.count} matches · ${esc(item.level)}</small></div>`).join('')}</div>`
      : `<div class="planner-focus planner-focus-empty"><b>🎯 No PYQ priority yet</b><small>Analyze your previous-year questions in PYQs to make the planner show the most important topics instead of studying randomly.</small></div>`;

    $('planResult').innerHTML = `
      <b>${esc(data.note)}</b>
      <p>${data.days} days left</p>
      ${topicBlock}
      <div class="planner-subject-plan"><b>Subject priority</b>${data.plan.map(item => `
        <div class="task">
          <div>
            <b>${esc(item.subject)}</b>
            <small>${esc(item.priority)} · ${item.recommendedMinutes} min${item.importantTopics?.length ? ' · Focus: ' + esc(item.importantTopics.join(', ')) : ''}</small>
          </div>
        </div>
      `).join('')}</div>
    `;

    // Create topic-focused tasks when PYQ priorities exist; otherwise create subject tasks.
    if (topics.length) {
      for (const item of topics.slice(0, 6)) {
        await api('/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title: 'Revise important topic: ' + item.topic,
            subject: item.topic,
            priority: item.level === 'very-high' || item.level === 'high' ? 'High' : 'Medium'
          })
        });
      }
    } else {
      for (const item of data.plan.slice(0, 6)) {
        await api('/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title: 'Study ' + item.subject,
            subject: item.subject,
            priority: item.priority === 'very-high' ? 'High' : item.priority === 'high' ? 'Medium' : 'Low'
          })
        });
      }
    }

    await loadTasks();
    toast('Planner generated ⚡');
  } catch (error) {
    toast(error.message);
  }
}

function addTaskPrompt() {
  const title = prompt('Task title?');
  if (!title) return;

  api('/tasks', {
    method: 'POST',
    body: JSON.stringify({ title, priority: 'Medium' })
  })
    .then(() => {
      toast('Task added');
      loadTasks();
      loadDashboard();
    })
    .catch(error => toast(error.message));
}

/* =========================================================
   PYQ
========================================================= */
async function analyzePYQ() {
  const file = $('pyqFile').files[0];
  const text = $('pyqText').value;

  if (!file && !text.trim()) {
    return toast('Add PYQs first');
  }

  try {
    let data;

    if (file) {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(API + '/pyq/analyze', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token
        },
        body: formData
      });

      data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'PYQ analysis failed');
      }
    } else {
      data = await api('/pyq/analyze', {
        method: 'POST',
        body: JSON.stringify({ text })
      });
    }

    const analysis = data.analysis;

    $('pyqResult').innerHTML = `
      <b>${analysis.questions} questions analyzed</b>
      <div style="margin-top:10px">
        ${(analysis.priority || []).map(item => `
          <div class="task">
            <div>
              <b>${esc(item.topic)}</b>
              <small>${item.count} matches · ${esc(item.level)}</small>
            </div>
            <span>🎯</span>
          </div>
        `).join('')}
      </div>
      <p><small>${esc(analysis.disclaimer || '')}</small></p>
    `;

    toast('PYQs analyzed ✅');
  } catch (error) {
    toast(error.message);
  }
}

/* =========================================================
   AI CHAT
   - Conversation memory
   - Markdown rendering
   - Typing indicator
   - Better language control
   - Enter to send
========================================================= */
function saveChatHistory() {
  /* Keep the browser copy small and useful. */
  chatHistory = chatHistory.slice(-30);
  localStorage.setItem('sm_chat_history', JSON.stringify(chatHistory));
}

function markdownToHTML(markdown) {
  let text = String(markdown ?? '').replace(/\r\n/g, '\n');

  /* Protect code blocks first. */
  const codeBlocks = [];
  text = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, language, code) => {
    const index = codeBlocks.length;
    codeBlocks.push(`
      <pre class="ai-code"><code>${esc(code.trim())}</code></pre>
    `);
    return `@@CODEBLOCK_${index}@@`;
  });

  text = esc(text);

  /* Inline code */
  text = text.replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>');

  /* Bold / italic */
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  const lines = text.split('\n');
  const output = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      output.push('</ul>');
      inList = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      continue;
    }

    if (/^@@CODEBLOCK_\d+@@$/.test(trimmed)) {
      closeList();
      output.push(trimmed);
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      closeList();
      output.push('<h4>' + trimmed.replace(/^###\s+/, '') + '</h4>');
      continue;
    }

    if (/^##\s+/.test(trimmed)) {
      closeList();
      output.push('<h3>' + trimmed.replace(/^##\s+/, '') + '</h3>');
      continue;
    }

    if (/^#\s+/.test(trimmed)) {
      closeList();
      output.push('<h3>' + trimmed.replace(/^#\s+/, '') + '</h3>');
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)/);
    if (bullet) {
      if (!inList) {
        output.push('<ul>');
        inList = true;
      }
      output.push('<li>' + bullet[1] + '</li>');
      continue;
    }

    const numbered = trimmed.match(/^\d+[.)]\s+(.+)/);
    if (numbered) {
      if (!inList) {
        output.push('<ol>');
        inList = true;
      }
      output.push('<li>' + numbered[1] + '</li>');
      continue;
    }

    closeList();
    output.push('<p>' + trimmed + '</p>');
  }

  closeList();

  let html = output.join('');

  html = html.replace(/@@CODEBLOCK_(\d+)@@/g, (_, index) => codeBlocks[Number(index)] || '');

  return html || '<p>Sorry, I could not generate an answer.</p>';
}

function addChat(type, text, options = {}) {
  const element = document.createElement('div');
  element.className = 'msg ' + type + (options.typing ? ' ai-typing' : '');

  if (options.typing) {
    element.innerHTML = `
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span style="margin-left:8px">StudyMate is thinking…</span>
    `;
  } else if (type === 'ai') {
    element.innerHTML = markdownToHTML(text);
    if (text && !String(text).startsWith('⚠️')) {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.innerHTML = `
        <button class="msg-action" type="button" data-speak="1">🔊 Listen</button>
        <button class="msg-action" type="button" data-copy="1">▣ Copy</button>
      `;
      actions.querySelector('[data-speak]').onclick = () => speakText(stripMarkdown(text));
      actions.querySelector('[data-copy]').onclick = async () => {
        try { await navigator.clipboard.writeText(stripMarkdown(text)); toast('Answer copied'); } catch { toast('Copy not available'); }
      };
      element.appendChild(actions);
    }
  } else {
    element.textContent = text;
  }

  $('chat').appendChild(element);
  $('chat').scrollTop = $('chat').scrollHeight;

  return element;
}

async function loadChatHistory() {
  if (!token) return;
  try {
    const data = await api('/chats');
    savedChats = data.chats || [];
    if (activeChatId && !savedChats.some(c => String(c.id) === String(activeChatId))) activeChatId = '';
    renderChatHistoryList();
  } catch (error) {
    console.warn('Chat history unavailable:', error.message);
  }
}

function renderChatHistoryList() {
  const list = $('chatHistoryList');
  if (!list) return;
  if (!savedChats.length) {
    list.innerHTML = '<div class="history-empty">No previous chats yet.<br>Start a new conversation and it will appear here.</div>';
    return;
  }
  list.innerHTML = savedChats.map(chat => `
    <div class="history-item ${String(chat.id) === String(activeChatId) ? 'active' : ''}" data-chat-id="${esc(chat.id)}">
      <button class="history-open" type="button">
        <span class="history-chat-icon">💬</span>
        <span class="history-chat-copy"><b>${esc(chat.title)}</b><small>${chat.messageCount} message${chat.messageCount === 1 ? '' : 's'}</small></span>
      </button>
      <button class="history-delete" type="button" title="Delete chat">×</button>
    </div>`).join('');
  list.querySelectorAll('.history-open').forEach(btn => btn.onclick = async () => {
    const id = btn.closest('.history-item').dataset.chatId;
    await openChat(id);
  });
  list.querySelectorAll('.history-delete').forEach(btn => btn.onclick = async event => {
    event.stopPropagation();
    const id = btn.closest('.history-item').dataset.chatId;
    if (!confirm('Delete this chat permanently?')) return;
    try {
      await api('/chats/' + encodeURIComponent(id), { method: 'DELETE' });
      if (String(activeChatId) === String(id)) {
        activeChatId = '';
        chatHistory = [];
        localStorage.removeItem('sm_active_chat_id');
        localStorage.removeItem('sm_chat_history');
        renderChat();
      }
      await loadChatHistory();
      toast('Chat deleted');
    } catch (error) { toast(error.message); }
  });
}

async function openChat(id) {
  try {
    const data = await api('/chats/' + encodeURIComponent(id));
    activeChatId = String(data.chat._id || data.chat.id);
    chatHistory = (data.chat.messages || []).map(m => ({ role: m.role, content: m.content }));
    localStorage.setItem('sm_active_chat_id', activeChatId);
    saveChatHistory();
    renderChat();
    $('chatHistoryModal')?.classList.add('hidden');
    go('assistant');
    toast('Chat opened');
  } catch (error) { toast(error.message); }
}

let persistChain = Promise.resolve();

function persistActiveChat() {
  persistChain = persistChain.then(async () => {
    if (!token || !chatHistory.length) return;
    try {
      if (!activeChatId) {
        const first = chatHistory.find(m => m.role === 'user');
        const title = first?.content?.trim().slice(0, 60) || 'New Chat';
        const created = await api('/chats', { method: 'POST', body: JSON.stringify({ title }) });
        activeChatId = String(created.chat.id);
        localStorage.setItem('sm_active_chat_id', activeChatId);
      }
      await api('/chats/' + encodeURIComponent(activeChatId), {
        method: 'PUT',
        body: JSON.stringify({ messages: chatHistory })
      });
      await loadChatHistory();
    } catch (error) {
      console.warn('Could not save chat history:', error.message);
    }
  });
  return persistChain;
}

function renderChat() {
  const chat = $('chat');
  if (!chat) return;

  chat.innerHTML = '';

  if (!chatHistory.length) {
    addChat(
      'ai',
      `Hi ${me?.name || 'there'}! 👋\n\nI’m your StudyMate AI. Ask me anything about your studies — explanations, examples, summaries, quizzes, coding, maths problems, exam preparation, study plans or PYQs.\n\nYou can write in English, हिंदी, or Hinglish.`
    );
    return;
  }

  chatHistory.forEach(message => {
    addChat(message.role === 'user' ? 'me' : 'ai', message.content);
  });
}

async function askAI() {
  if (isAIThinking) return;

  const input = $('ask');
  const question = input.value.trim();

  if (!question) return;

  const selectedLanguage = $('lang').value || 'Auto';
  const language = selectedLanguage === 'Auto' ? detectLanguage(question) : selectedLanguage;
  updateLanguageStatus(selectedLanguage === 'Auto' ? language : selectedLanguage);

  addChat('me', question);
  chatHistory.push({ role: 'user', content: question });
  saveChatHistory();
  await persistActiveChat();

  input.value = '';
  input.focus();

  isAIThinking = true;

  const sendButton = $('sendBtn');
  if (sendButton) {
    sendButton.disabled = true;
    sendButton.textContent = '…';
  }

  const typingElement = addChat('ai', '', { typing: true });

  try {
    const data = await api('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({
        message: question,
        language,
        mode: 'assistant',
        history: chatHistory.slice(-16),
        context: {
          education: me?.education || {},
          readiness: me?.readiness || 0,
          topicsDone: me?.topicsDone || 0,
          studyMinutes: me?.studyMinutes || 0
        }
      })
    });

    typingElement.remove();

    const reply = data.reply || 'I could not generate a response.';

    addChat('ai', reply);
    chatHistory.push({ role: 'assistant', content: reply });
    saveChatHistory();
    await persistActiveChat();
  } catch (error) {
    typingElement.remove();

    const errorMessage =
      `⚠️ AI service error\n\n${error.message}\n\nPlease check that the StudyMate backend is running and that Groq or Gemini is configured in backend/.env.`;

    addChat('ai', errorMessage);

    /* Remove only the unanswered user message so a temporary failure
       does not pollute future conversation context. */
    chatHistory.pop();
    saveChatHistory();
  } finally {
    isAIThinking = false;

    if (sendButton) {
      sendButton.disabled = false;
      sendButton.textContent = 'Send';
    }
  }
}

function promptAI(question) {
  go('assistant');
  $('ask').value = question;
  askAI();
}

/* Enter = send. Shift+Enter is not needed because this is a single-line input. */
$('ask').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    askAI();
  }
});

/* When language changes, tell the user that the next answer will use it. */
$('lang').addEventListener('change', () => {
  localStorage.setItem('sm_language', $('lang').value);
  toast('AI language: ' + $('lang').value);
});

const savedLanguage = localStorage.getItem('sm_language');
if (savedLanguage && ['Auto', 'Easy English', 'Hindi', 'Hinglish'].includes(savedLanguage)) {
  $('lang').value = savedLanguage;
}

/* =========================================================
   FRIENDS
========================================================= */
async function findFriend() {
  const query = prompt('Search student name or email');
  if (!query) return;

  try {
    const data = await api('/friends/search?q=' + encodeURIComponent(query));

    if (!data.users.length) {
      return toast('No student found');
    }

    const user = data.users[0];

    if (confirm('Send follow request to ' + user.name + '?')) {
      await api('/friends/request/' + user._id, { method: 'POST' });
      toast('Follow request sent 🤝');
    }
  } catch (error) {
    toast(error.message);
  }
}

async function loadFriends() {
  try {
    const data = await api('/friends');

    $('requests').innerHTML = data.incoming.length
      ? data.incoming.map(item => `
          <div class="task">
            <div style="flex:1">
              <b>${esc(item.requester.name)}</b>
              <small>wants to connect</small>
            </div>
            <button class="btn primary" onclick="accept('${item._id}')">Accept</button>
          </div>
        `).join('')
      : 'No requests';

    $('connected').innerHTML = data.connected.length
      ? data.connected.map(user => `
          <div class="task">
            <div>
              <b>${esc(user.name)}</b>
              <small>${user.readiness}% readiness</small>
            </div>
            <span>✓</span>
          </div>
        `).join('')
      : 'No connections';

    const leaderboard = await api('/leaderboard');

    $('leaderboard').innerHTML = leaderboard.leaderboard.map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${esc(item.name)}${item.me ? ' (You)' : ''}</td>
        <td>${item.readiness}%</td>
        <td>${item.streak}</td>
        <td><b>${item.performance}</b>/100</td>
      </tr>
    `).join('');
  } catch (error) {
    toast(error.message);
  }
}

async function accept(id) {
  try {
    await api('/friends/' + id + '/accept', { method: 'POST' });
    toast('Connected 🤝');
    await loadFriends();
    await loadDashboard();
  } catch (error) {
    toast(error.message);
  }
}

/* =========================================================
   UI ENHANCEMENTS
========================================================= */
function detectLanguage(text) {
  if (/[\u0900-\u097F]/.test(text)) return 'Hindi';
  const lower = String(text).toLowerCase();
  const romanHindi = /\b(kya|kyu|kyon|hai|hain|ho|hoga|hogi|mujhe|aapko|tum|mera|meri|mere|kaise|kaisa|samjhao|batao|chahiye|nahi|nahin|acha|accha|iske|uske|yah|yeh|wo|woh|karo|karna|krna|se|mein|me|par|aur|bas|phir|abhi|kyuki|kyunki|padh|padho|padhai|exam|marks|question|dikhao)\b/;
  return romanHindi.test(lower) ? 'Hinglish' : 'Easy English';
}

function updateLanguageStatus(language) {
  const el = $('languageStatus');
  if (!el) return;
  el.textContent = 'Auto-detected: ' + language;
  const label = $('langBtnLabel');
  if (label) label.textContent = $('lang').value === 'Auto' ? 'Auto' : $('lang').value;
}

function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/```[\w+-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/[*_#>`]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function speakText(text) {
  if (!('speechSynthesis' in window)) return toast('Text-to-speech is not supported in this browser');
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const lang = $('lang').value === 'Hindi' ? 'hi-IN' : ($('lang').value === 'Hinglish' ? 'en-IN' : 'en-US');
  utter.lang = lang;
  utter.rate = 0.95;
  window.speechSynthesis.speak(utter);
}

function setupVoiceInput() {
  const button = $('micBtn');
  if (!button) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    button.title = 'Voice input is not supported in this browser';
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 3;
  recognition.lang = navigator.language?.toLowerCase().startsWith('hi') ? 'hi-IN' : 'en-IN';
  let finalTranscript = '';
  recognition.onstart = () => { finalTranscript=''; button.classList.add('recording'); toast('Listening… speak naturally, then pause.'); };
  recognition.onend = () => {
    button.classList.remove('recording');
    if (finalTranscript.trim()) { $('ask').value = finalTranscript.trim(); $('ask').focus(); updateLanguageStatus(detectLanguage(finalTranscript)); askAI(); }
  };
  recognition.onerror = event => { button.classList.remove('recording'); if(event.error!=='aborted') toast('Could not hear that. Try again.'); };
  recognition.onresult = event => {
    let interim='';
    for(let i=event.resultIndex;i<event.results.length;i++){ const text=event.results[i][0].transcript; if(event.results[i].isFinal) finalTranscript += text + ' '; else interim += text; }
    $('ask').value = (finalTranscript + interim).trim();
  };
  button.onclick = () => {
    try { recognition.start(); } catch { /* already listening */ }
  };
}

function setupLanguageMenu() {
  const btn = $('langBtn');
  const menu = $('languageMenu');
  if (!btn || !menu) return;
  const position = () => {
    const r = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, r.right - 150) + 'px';
    menu.style.top = (r.bottom + 8) + 'px';
  };
  btn.onclick = () => { position(); menu.classList.toggle('hidden'); };
  menu.querySelectorAll('[data-language]').forEach(item => {
    item.onclick = () => {
      $('lang').value = item.dataset.language;
      localStorage.setItem('sm_language', item.dataset.language);
      updateLanguageStatus(item.dataset.language === 'Auto' ? 'Auto' : item.dataset.language);
      menu.classList.add('hidden');
      toast('Language: ' + item.textContent.trim());
    };
  });
  document.addEventListener('click', event => {
    if (!menu.contains(event.target) && !btn.contains(event.target)) menu.classList.add('hidden');
  });
}

function setupSidebar() {
  const app = $('appView');
  const btn = $('sidebarToggle');
  if (!app || !btn) return;
  const saved = localStorage.getItem('sm_sidebar_collapsed') === '1';
  if (saved) app.classList.add('sidebar-collapsed');
  const refresh = () => {
    const collapsed = app.classList.contains('sidebar-collapsed');
    btn.textContent = collapsed ? '›' : '‹';
    btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  };
  btn.onclick = () => {
    app.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sm_sidebar_collapsed', app.classList.contains('sidebar-collapsed') ? '1' : '0');
    refresh();
  };
  refresh();
}

function setupDiagramPreview() {
  const open = $('previewDiagram');
  const modal = $('diagramModal');
  const close = $('closeDiagram');
  if (!open || !modal) return;
  open.onclick = () => {
    const latestUser = [...chatHistory].reverse().find(item => item.role === 'user');
    $('diagramSubtitle').textContent = latestUser?.content ? 'For: ' + latestUser.content.slice(0, 100) : 'Study visual';
    modal.classList.remove('hidden');
  };
  close?.addEventListener('click', () => modal.classList.add('hidden'));
  modal.querySelector('[data-close="diagram"]')?.addEventListener('click', () => modal.classList.add('hidden'));
}

/* =========================================================
   THEME
========================================================= */
const savedTheme = localStorage.getItem('sm_theme');
if (savedTheme === 'dark') document.body.classList.add('dark');
$('theme').onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('sm_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  $('theme').textContent = document.body.classList.contains('dark') ? '☀' : '☾';
};
$('theme').textContent = document.body.classList.contains('dark') ? '☀' : '☾';

document.getElementById('viewProfile')?.addEventListener('click', async () => { try { const data = await api('/me'); me = data.user; refreshProfileUI(); $('profileModal')?.classList.remove('hidden'); } catch(e){ toast(e.message); } });
document.getElementById('closeProfile')?.addEventListener('click', () => $('profileModal')?.classList.add('hidden'));
$('profileModal')?.addEventListener('click', e => { if(e.target === $('profileModal')) $('profileModal').classList.add('hidden'); });

/* =========================================================
   START UI FEATURES
========================================================= */
setupSidebar();
setupVoiceInput();
setupLanguageMenu();
setupDiagramPreview();
updateLanguageStatus($('lang').value || 'Auto');
$('newChat')?.addEventListener('click', startNewChat);
$('historyNewChat')?.addEventListener('click', startNewChat);
$('clearChat')?.addEventListener('click', async () => {
  if (!activeChatId) {
    chatHistory = [];
    localStorage.removeItem('sm_chat_history');
    renderChat();
    toast('Chat cleared');
    return;
  }
  if (!confirm('Clear this chat permanently?')) return;
  try {
    await api('/chats/' + encodeURIComponent(activeChatId), { method: 'DELETE' });
    startNewChat(false);
    await loadChatHistory();
    toast('Chat cleared');
  } catch (error) { toast(error.message); }
});

function startNewChat(showToast = true) {
  chatHistory = [];
  activeChatId = '';
  localStorage.removeItem('sm_chat_history');
  localStorage.removeItem('sm_active_chat_id');
  renderChat();
  $('chatHistoryModal')?.classList.add('hidden');
  go('assistant');
  $('ask')?.focus();
  if (showToast) toast('New chat started');
}

$('chatHistoryBtn')?.addEventListener('click', async () => {
  await loadChatHistory();
  $('chatHistoryModal')?.classList.remove('hidden');
});
$('closeChatHistory')?.addEventListener('click', () => $('chatHistoryModal')?.classList.add('hidden'));
$('chatHistoryModal')?.querySelector('[data-close="history"]')?.addEventListener('click', () => $('chatHistoryModal')?.classList.add('hidden'));
/* =========================================================
   NAV BUTTONS
========================================================= */
document.querySelectorAll('nav button').forEach(button => {
  button.onclick = () => go(button.dataset.page);
});

/* =========================================================
   START
========================================================= */
if (token) {
  boot();
}
