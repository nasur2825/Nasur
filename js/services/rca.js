/* NASUR - Just-Culture Worker RCA Coach (Phase 4)
   Non-blaming interview guide, behaviour classification, system-focused 5-Whys and CAPA suggestions. */

export const LANGS = [
  { id: 'en', label: 'English' },
  { id: 'ta', label: 'தமிழ்' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'ar', label: 'العربية' }
];

/* Short phrases to say to the worker, in four languages */
export const PHRASES = {
  sit: {
    en: 'Please sit down. Would you like some water?',
    ta: 'தயவுசெய்து உட்காருங்கள். தண்ணீர் வேண்டுமா?',
    hi: 'कृपया बैठिए। क्या आप पानी लेंगे?',
    ar: 'تفضل بالجلوس. هل تريد بعض الماء؟'
  },
  not_in_trouble: {
    en: 'You are not in trouble. We want to understand what happened so we can fix the system.',
    ta: 'நீங்கள் எந்தப் பிரச்சினையிலும் இல்லை. என்ன நடந்தது என்று புரிந்துகொண்டு அமைப்பைச் சரிசெய்யவே இங்கே இருக்கிறோம்.',
    hi: 'आप किसी मुसीबत में नहीं हैं। हम समझना चाहते हैं कि क्या हुआ ताकि व्यवस्था ठीक कर सकें।',
    ar: 'أنت لست في مشكلة. نريد أن نفهم ما حدث لنصلح النظام.'
  },
  own_words: {
    en: 'Tell me in your own words what happened.',
    ta: 'என்ன நடந்தது என்பதை உங்கள் வார்த்தைகளில் சொல்லுங்கள்.',
    hi: 'आप अपने शब्दों में बताइए कि क्या हुआ।',
    ar: 'أخبرني بكلماتك ماذا حدث.'
  },
  easier_safer: {
    en: 'What would have made this task easier or safer?',
    ta: 'இந்த வேலையை எளிதாகவும் பாதுகாப்பாகவும் செய்ய எது உதவியிருக்கும்?',
    hi: 'इस काम को आसान और सुरक्षित बनाने में क्या मदद करता?',
    ar: 'ما الذي كان سيجعل هذه المهمة أسهل وأكثر أمانًا؟'
  },
  thanks: {
    en: 'Thank you for telling me. Your honesty helps keep everyone safe.',
    ta: 'சொன்னதற்கு நன்றி. உங்கள் நேர்மை அனைவரையும் பாதுகாப்பாக வைக்க உதவும்.',
    hi: 'बताने के लिए धन्यवाद। आपकी ईमानदारी सबको सुरक्षित रखती है।',
    ar: 'شكرًا لأنك أخبرتني. صدقك يساعد في الحفاظ على سلامة الجميع.'
  }
};

export function phrase(id, lang) {
  const p = PHRASES[id];
  return p ? p[lang] || p.en : '';
}

/* Interview steps, in order */
export const INTERVIEW_STEPS = [
  {
    id: 'prepare',
    title: '1. Prepare before you meet',
    minutes: 10,
    do: [
      'Secure the area and make sure first aid and medical care are done first.',
      'Collect facts: photos, permit, job plan, equipment and weather. Do not form a conclusion yet.',
      'Choose a quiet private place away from the crowd, not the manager’s office.',
      'Arrange an interpreter or a trusted colleague if the worker is more comfortable in another language.'
    ],
    avoid: ['Do not interview while the worker is injured, shaking or still in shock.', 'Do not bring many people. One or two is enough.'],
    say: []
  },
  {
    id: 'welcome',
    title: '2. Seat the worker and build trust',
    minutes: 5,
    do: [
      'Greet by name, shake hands if it is natural, and sit at the same level, side by side or at an angle, not across a desk.',
      'Offer water or tea and let the worker settle. Switch off your phone.',
      'Speak slowly and softly. Keep your hands open and relaxed.'
    ],
    avoid: ['Do not stand over the worker.', 'Do not start with “Why did you…?”.', 'Do not treat the worker like an accused person.'],
    say: ['sit', 'not_in_trouble']
  },
  {
    id: 'purpose',
    title: '3. Explain the purpose',
    minutes: 3,
    do: [
      'Say the goal is to learn and fix the system, not to find someone to blame.',
      'Explain what will be written down and who will see it.',
      'Tell the worker they can stop, take a break or have a colleague with them.'
    ],
    avoid: ['Do not promise what you cannot guarantee, such as “nothing will happen”.'],
    say: ['not_in_trouble']
  },
  {
    id: 'listen',
    title: '4. Listen to their story',
    minutes: 10,
    do: [
      'Ask one open question and then stay quiet. Let them finish without interrupting.',
      'Nod, keep eye contact and repeat back key points: “So you were doing X when Y happened.”',
      'Write short notes in their words. Note time, place, tools, people and instructions.'
    ],
    avoid: ['Do not ask leading questions.', 'Do not correct them or argue about facts at this stage.'],
    say: ['own_words']
  },
  {
    id: 'timeline',
    title: '5. Walk through the timeline',
    minutes: 10,
    do: [
      'Build the sequence step by step: before the job, during, at the moment, after.',
      'Ask what they saw, heard and thought at each step, and what they expected to happen.',
      'Ask what is normal practice on this job and how it is usually done on busy days.'
    ],
    avoid: ['Do not use words like negligent, careless, stupid or lazy.'],
    say: []
  },
  {
    id: 'system',
    title: '6. Ask system questions',
    minutes: 10,
    do: [
      'Were the right tools, materials and PPE available and in good condition?',
      'Were the instructions, permit and training clear and realistic for the time given?',
      'Was there time pressure, fatigue, heat, noise, poor light or crowding?',
      'Did a supervisor or colleague know what you were doing? Could you ask for help or stop work easily?',
      'Has this happened or almost happened before? What would a new worker find hard here?'
    ],
    avoid: ['Do not ask “Why didn’t you follow the procedure?”. Ask “What made the procedure hard to follow?”.'],
    say: ['easier_safer']
  },
  {
    id: 'close',
    title: '7. Close with respect and support',
    minutes: 5,
    do: [
      'Summarise what you understood and ask if anything is missing or wrong.',
      'Thank them and explain the next steps and when they will hear back.',
      'Check on their wellbeing and arrange medical or counselling support if needed.',
      'Return later to share what was changed because of what they told you.'
    ],
    avoid: ['Do not discuss discipline in this meeting.'],
    say: ['thanks']
  }
];

/* ---------- Just-Culture classification ---------- */

export const BEHAVIOUR_QUESTIONS = [
  { id: 'unintended', text: 'Was the action different from what the person meant to do (a slip, lapse or honest mistake)?' },
  { id: 'consciousRisk', text: 'Did the person knowingly take a substantial and unjustified risk?' },
  { id: 'peersWouldDo', text: 'Substitution test: would two or three other competent workers in the same situation likely have done the same?' },
  { id: 'systemPressure', text: 'Did time pressure, missing tools, unclear rules or normal site practice push toward this behaviour?' }
];

export function classifyBehaviour(a) {
  const ans = a || {};
  if (ans.unintended) {
    return {
      type: 'human_error',
      label: 'Human error',
      response: ['Console and support the worker.', 'Fix the system: design, tools, layout, workload, checks.', 'Share the learning with everyone.'],
      note: 'Human error is a normal part of work. Remove the traps that make the error easy.'
    };
  }
  if (ans.consciousRisk && !ans.peersWouldDo && !ans.systemPressure) {
    return {
      type: 'reckless',
      label: 'Reckless behaviour',
      response: ['Follow the company disciplinary process fairly, with HR and management.', 'Still review the system for contributing causes.', 'Record facts only and treat the person with dignity.'],
      note: 'Use this label only after the system has been checked. Reckless means conscious disregard of a substantial risk.'
    };
  }
  return {
    type: 'at_risk',
    label: 'At-risk behaviour',
    response: ['Coach the worker one to one and explain the real risk.', 'Find out why the shortcut felt normal and remove the reason.', 'Check the supervisor and site culture for drift from the procedure.'],
    note: 'At-risk behaviour is a choice where the risk was not seen or was believed to be justified. Coach, do not punish.'
  };
}

/* ---------- System-focused 5-Whys ---------- */

export const WHY_CATEGORIES = [
  { id: 'equipment', label: 'Equipment & tools', prompts: ['Was the equipment suitable, inspected and in good condition?', 'Was a guard, interlock or safe tool missing or hard to use?'] },
  { id: 'procedure', label: 'Procedure & instructions', prompts: ['Was there a clear written method for this job?', 'Was the procedure realistic for the real working conditions?'] },
  { id: 'training', label: 'Training & competence', prompts: ['Was the person trained and assessed for this task?', 'Did they know the hazard and the safe way?'] },
  { id: 'supervision', label: 'Supervision & communication', prompts: ['Did the supervisor brief the job and check progress?', 'Could the worker raise a concern or stop work without fear?'] },
  { id: 'planning', label: 'Planning & time pressure', prompts: ['Was enough time, manpower and material planned?', 'Did the schedule push people to rush?'] },
  { id: 'environment', label: 'Work environment', prompts: ['Were heat, cold, noise, light, space or weather a factor?', 'Was housekeeping or access poor?'] },
  { id: 'human', label: 'Fatigue & human factors', prompts: ['Were long hours, night shift or fatigue a factor?', 'Was the task design confusing, awkward or monotonous?'] },
  { id: 'management', label: 'Management & resources', prompts: ['Were budget, staff or spares cut in a way that raised risk?', 'Were previous warnings or near misses acted on?'] },
  { id: 'design', label: 'Design & change', prompts: ['Was a recent change reviewed for safety?', 'Could the job or layout be designed to remove the hazard?'] }
];

export function newChain(problem) {
  return { problem: String(problem || '').slice(0, 300), whys: [], rootCause: '', category: '' };
}

export function nextWhyQuestion(chain) {
  const n = chain.whys.length;
  if (n >= 5) return '';
  const last = n ? chain.whys[n - 1].a : chain.problem;
  if (!String(last || '').trim()) return 'Write the answer first.';
  return 'Why ' + (n === 0 ? 'did this happen' : 'was that so') + '? (Why ' + (n + 1) + ' of 5, based on: “' + String(last).slice(0, 80) + '”)';
}

export function addWhy(chain, answer) {
  const a = String(answer || '').trim().slice(0, 300);
  if (!a || chain.whys.length >= 5) return chain;
  const q = chain.whys.length === 0 ? 'Why did this happen?' : 'Why? (' + chain.whys[chain.whys.length - 1].a.slice(0, 60) + ')';
  return { ...chain, whys: chain.whys.concat([{ q, a }]) };
}

const KEYWORDS = {
  equipment: ['guard', 'tool', 'machine', 'equipment', 'broken', 'worn', 'defect', 'maintenance', 'inspect', 'interlock', 'tharam', 'karuvi'],
  procedure: ['procedure', 'method statement', 'instruction', 'sop', 'permit', 'no plan', 'unclear', 'jsa'],
  training: ['training', 'untrained', 'not aware', 'did not know', 'new worker', 'competen', 'induction'],
  supervision: ['supervisor', 'supervision', 'briefing', 'communication', 'nobody checked', 'no one', 'language', 'afraid'],
  planning: ['rush', 'time pressure', 'deadline', 'target', 'manpower', 'short staff', 'schedule', 'hurry'],
  environment: ['heat', 'hot', 'rain', 'wet', 'dark', 'light', 'noise', 'dust', 'slippery', 'crowd', 'space'],
  human: ['fatigue', 'tired', 'sleep', 'overtime', 'night shift', 'distract', 'stress'],
  management: ['budget', 'cost', 'resource', 'ignored', 'previous', 'repeat', 'management'],
  design: ['design', 'layout', 'change', 'modification', 'access']
};

export function suggestCategory(text) {
  const t = String(text || '').toLowerCase();
  let best = '';
  let bestScore = 0;
  Object.keys(KEYWORDS).forEach((k) => {
    const score = KEYWORDS[k].filter((w) => t.indexOf(w) >= 0).length;
    if (score > bestScore) {
      best = k;
      bestScore = score;
    }
  });
  return best;
}

/* ---------- CAPA suggestions per root cause category ---------- */

const CAPA = {
  equipment: [
    { text: 'Repair or replace the faulty equipment and fit the missing guard or interlock before reuse.', hierarchy: 'Engineering', kind: 'corrective' },
    { text: 'Add this equipment to a documented pre-use check and planned maintenance schedule.', hierarchy: 'Administrative', kind: 'preventive' }
  ],
  procedure: [
    { text: 'Rewrite the procedure with the workers who do the job and test it on site.', hierarchy: 'Administrative', kind: 'corrective' },
    { text: 'Brief all crews on the revised procedure and confirm understanding.', hierarchy: 'Administrative', kind: 'preventive' }
  ],
  training: [
    { text: 'Train and assess the worker and the crew for this task before they continue.', hierarchy: 'Administrative', kind: 'corrective' },
    { text: 'Update the training matrix and add this task to induction.', hierarchy: 'Administrative', kind: 'preventive' }
  ],
  supervision: [
    { text: 'Brief the supervisor on pre-job briefings and spot checks. Record the briefing.', hierarchy: 'Administrative', kind: 'corrective' },
    { text: 'Set up a simple way for any worker to stop work without fear.', hierarchy: 'Administrative', kind: 'preventive' }
  ],
  planning: [
    { text: 'Re-plan the task with realistic time, manpower and materials.', hierarchy: 'Administrative', kind: 'corrective' },
    { text: 'Add a safety check to the planning stage of similar jobs.', hierarchy: 'Administrative', kind: 'preventive' }
  ],
  environment: [
    { text: 'Control the environmental factor: lighting, ventilation, shading, drainage, barriers or housekeeping.', hierarchy: 'Engineering', kind: 'corrective' },
    { text: 'Add weather and conditions to the daily start-up briefing and stop-work triggers.', hierarchy: 'Administrative', kind: 'preventive' }
  ],
  human: [
    { text: 'Review shift length, rest breaks and overtime for the crew.', hierarchy: 'Administrative', kind: 'corrective' },
    { text: 'Redesign the task to reduce monotony, awkward posture or confusion.', hierarchy: 'Engineering', kind: 'preventive' }
  ],
  management: [
    { text: 'Review the resource or budget decision with management and record the risk accepted.', hierarchy: 'Administrative', kind: 'corrective' },
    { text: 'Create a tracker so previous warnings and near misses are closed on time.', hierarchy: 'Administrative', kind: 'preventive' }
  ],
  design: [
    { text: 'Review the design or recent change and remove the hazard at source where possible.', hierarchy: 'Elimination', kind: 'corrective' },
    { text: 'Add a management-of-change check before similar changes.', hierarchy: 'Administrative', kind: 'preventive' }
  ]
};

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* rootCauses: [{ category, text }] */
export function suggestCapa(rootCauses, opts) {
  const o = opts || {};
  const corrDays = o.severe ? 3 : 7;
  const prevDays = o.severe ? 14 : 30;
  const out = [];
  (rootCauses || []).forEach((rc) => {
    const list = CAPA[rc.category] || [];
    list.forEach((c) => {
      out.push({
        text: c.text + (rc.text ? ' (Cause: ' + String(rc.text).slice(0, 100) + ')' : ''),
        hierarchy: c.hierarchy,
        kind: c.kind,
        responsible: '',
        target_date: addDays(c.kind === 'corrective' ? corrDays : prevDays),
        category: rc.category
      });
    });
  });
  return out;
}

export function newRca() {
  return {
    interview: { worker: '', interviewer: '', date: '', notes: '', systemAnswers: {} },
    behaviour: { answers: {}, result: null },
    chains: [],
    rootCauses: [],
    contributing: '',
    capa: []
  };
}

export function rcaSummaryText(incident, rca) {
  const lines = [];
  lines.push('Incident ' + (incident.incident_no || '') + ' · ' + (incident.date || '') + ' ' + (incident.time || '') + ' · ' + (incident.location || ''));
  if (rca.behaviour && rca.behaviour.result) lines.push('Just-Culture result: ' + rca.behaviour.result.label);
  (rca.chains || []).forEach((c, i) => {
    lines.push('Why chain ' + (i + 1) + ': ' + c.problem);
    c.whys.forEach((w, j) => lines.push('  Why ' + (j + 1) + ': ' + w.a));
  });
  (rca.rootCauses || []).forEach((r) => {
    const cat = WHY_CATEGORIES.find((x) => x.id === r.category);
    lines.push('Root cause (' + (cat ? cat.label : 'Other') + '): ' + r.text);
  });
  (rca.capa || []).forEach((c, i) => lines.push('Action ' + (i + 1) + ' [' + c.kind + ', ' + c.hierarchy + ']: ' + c.text));
  return lines.join('\n');
}
