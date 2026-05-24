import { downloadShareCard, shareToX } from './share.js';


// ── DATA ─────────────────────────────────────────────────────────────────────

const ALL_TAGS = [
    // Cut
    { id: 'circumcised',        label: 'Circumcised',        category: 'Cut'     },
    { id: 'uncircumcised',      label: 'Uncircumcised',      category: 'Cut'     },

    // Curve
    { id: 'straight',           label: 'Straight',           category: 'Curve'   },
    { id: 'curved-upward',      label: 'Upward Curve',       category: 'Curve'   },
    { id: 'curved-downward',    label: 'Downward Curve',     category: 'Curve'   },
    { id: 'curved-left',        label: 'Left Curve',         category: 'Curve'   },
    { id: 'curved-right',       label: 'Right Curve',        category: 'Curve'   },
    { id: 's-curve',            label: 'S-Curve',            category: 'Curve'   },

    // Profile
    { id: 'uniform',            label: 'Uniform Girth',      category: 'Profile' },
    { id: 'thick-base',         label: 'Thick Base',         category: 'Profile' },
    { id: 'thick-mid',          label: 'Thick Middle',       category: 'Profile' },
    { id: 'tapered',            label: 'Tapered',            category: 'Profile' },
    { id: 'flared',             label: 'Flared Head',        category: 'Profile' },
    { id: 'hourglass',          label: 'Hourglass',          category: 'Profile' },

    // Head
    { id: 'large-head',         label: 'Large Glans',        category: 'Head'    },
    { id: 'small-head',         label: 'Small Glans',        category: 'Head'    },
    { id: 'mushroom',           label: 'Mushroom Head',      category: 'Head'    },
    { id: 'pointed',            label: 'Pointed',            category: 'Head'    },
    { id: 'prominent-ridge',    label: 'Prominent Corona',   category: 'Head'    },
    { id: 'defined-neck',       label: 'Defined Neck',       category: 'Head'    },

    // Surface
    { id: 'prominent-veins',    label: 'Prominent Veins',    category: 'Surface' },
    { id: 'unusually-smooth',   label: 'Unusually Smooth',   category: 'Surface' },
    { id: 'pronounced-ridging', label: 'Pronounced Ridging', category: 'Surface' },
    { id: 'high-contrast',      label: 'High-Contrast Tip',  category: 'Surface' },

    // Notable
    { id: 'asymmetric',         label: 'Asymmetric',         category: 'Notable' },
    { id: 'prominent-raphe',    label: 'Prominent Raphe',    category: 'Notable' },
    { id: 'grower',             label: 'Grower',             category: 'Notable' },
];

// Weights must sum to 1.0
const WEIGHTS = { length: 0.40, girth: 0.40, shape: 0.20 };

let averages  = null;
let prefs     = null;
let insults   = null;
let lastStats = null;

// ── DATA LOADING ──────────────────────────────────────────────────────────────

async function loadData() {
    const [avgRes, prefRes, insultRes] = await Promise.all([
        fetch(new URL('./jsons/average.json', import.meta.url)),
        fetch(new URL('./jsons/preferences.json', import.meta.url)),
        fetch(new URL('./jsons/insults.json', import.meta.url)),
    ]);
    averages = await avgRes.json();
    prefs    = await prefRes.json();
    insults  = await insultRes.json();
    buildTagUI();
}

// ── TAG UI ────────────────────────────────────────────────────────────────────

function tagPrefClass(tagId) {
    if (prefs.tags.preferred.includes(tagId)) return 'tag-preferred';
    if (prefs.tags.disliked.includes(tagId))  return 'tag-disliked';
    return 'tag-neutral';
}

function buildTagUI() {
    const container = document.getElementById('tag-container');
    const categories = [...new Set(ALL_TAGS.map(t => t.category))];

    for (const cat of categories) {
        const group = document.createElement('div');
        group.className = 'tag-group';

        const label = document.createElement('p');
        label.className = 'tag-category-label';
        label.textContent = cat;
        group.appendChild(label);

        const row = document.createElement('div');
        row.className = 'tag-row';

        for (const t of ALL_TAGS.filter(t => t.category === cat)) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tag ' + tagPrefClass(t.id);
            btn.dataset.tag = t.id;
            btn.textContent = t.label;
            btn.addEventListener('click', () => btn.classList.toggle('tag-active'));
            row.appendChild(btn);
        }

        group.appendChild(row);
        container.appendChild(group);
    }
}

// ── SCORING ───────────────────────────────────────────────────────────────────

function toInches(value, unit) {
    return unit === 'cm' ? value / 2.54 : value;
}

// Tent function: +1 at preference, 0 at average, negative beyond.
// The symmetric point (preference + d) also returns 0, then goes negative.
function tentScore(value, average, preference) {
    const d = preference - average;
    if (d === 0) return 0;
    return 1 - Math.abs(value - preference) / Math.abs(d);
}

function scoreShape() {
    const selected = [...document.querySelectorAll('.tag.tag-active')].map(b => b.dataset.tag);
    let sum = 0;
    for (const id of selected) {
        if (prefs.tags.preferred.includes(id))      sum += 0.25;
        else if (prefs.tags.disliked.includes(id))  sum -= 0.25;
    }
    return Math.max(-1, Math.min(1, sum));
}

function calculate(lengthRaw, girthRaw, unit) {
    const length = toInches(lengthRaw, unit);
    const girth  = toInches(girthRaw,  unit);

    const prefLen   = toInches(prefs.length,    prefs.unit);
    const prefGirth = toInches(prefs.girth,     prefs.unit);
    const avgLen    = toInches(averages.length,  averages.unit);
    const avgGirth  = toInches(averages.girth,   averages.unit);

    const tLen   = tentScore(length, avgLen,   prefLen);
    const tGirth = tentScore(girth,  avgGirth, prefGirth);
    const tShape = scoreShape();

    const weighted = WEIGHTS.length * tLen + WEIGHTS.girth * tGirth + WEIGHTS.shape * tShape;
    const raw = 5 + 5 * weighted;
    return Math.max(0, Math.min(10, Math.round(raw * 10) / 10));
}

// ── VERDICT ───────────────────────────────────────────────────────────────────

const responses ={
    9.0: [
        "Perfect. Absolutely perfect. A+. Pics please?",
        "Wow. Just... wow. You really went all out, huh? I'm impressed.",
        "Can I ride it? No? Can I at least see it? You know, for science?",
        "Nice Cock. Peak."
    ],
    8.0: [
        "Solid. Above average where it counts. No complaints. B grade.",
        "Decent. I prefer something else but still. Really nice.",
        "Not bad. Could be better, but it's serviceable.",
        "Would be a really fun ride. Not the best but still would rearrange me.",
        
    ],
    7.0: [
        "Above average. Not bad at all.",
        "Pretty good. I like it.",
        "Hey user nice cock.",
        "Ok. Now we're getting somewhere."
    ],
    5.5: [
        "It's okay. I guess? I mean... It's not terrible.",
        "Meh. Little above average. Not by much.",
        "Halfway decent.",
        "Still probably fun. Probably."
    ],
    4.0: [
        "Eh? Not great. But not terrible. It's still servicable.",
        "It's not great, but it's not terrible either. I guess it's serviceable.",
        "I guess it works.",
        "It's not the size it's how you use it~ remember that."
    ],
    0.0: [
        "We're being generous calling this a submission.",
        "What are you wanting me to degrade you here?",
        "Congrats. You put in a submission. I'm. Not impressed.",
        "Technically a cock... Just... Not really worth my time honestly."
    ],
    "null": [
        "I'm not sure what to say about this one.",
        "This is a cock? Are you sure?",
        "Um... I don't know what to do with this. Really...",
        "This is a cock? Are you sure? This is a cock? Are you sure?",
        "I need a moment to process this.",
        "Actual submissions only. You know that. Right?"
    ]
}

function randResponse(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function calcVerdict(score) {

    if (score >= 9.0) return randResponse(responses[9.0]);
    if (score >= 8.0) return randResponse(responses[8.0]);
    if (score >= 7.0) return randResponse(responses[7.0]);
    if (score >= 5.5) return randResponse(responses[5.5]);
    if (score >= 4.0) return randResponse(responses[4.0]);
    if (score > 0.0) return randResponse(responses[0.0]);
    return randResponse(responses["null"]);
}

function degradeUser(length) {
    const tiers = insults["degrading-insults"]["length"];
    if (length >= 8) return randResponse(tiers["extra-long"]);
    if (length >= 7) return randResponse(tiers["long"]);
    if (length >= 5) return randResponse(tiers["medium"]);
    if (length >= 1) return randResponse(tiers["short"]);
    return randResponse(tiers["micro"]);
}

// ── RENDER ────────────────────────────────────────────────────────────────────

function render(score, verdict, stats) {
    lastStats = stats;
    document.getElementById('final-rating').textContent = score.toFixed(1);
    document.getElementById('commentary').textContent   = verdict;
    document.getElementById('save-png').removeAttribute('hidden');
    document.getElementById('share-x').removeAttribute('hidden');
}

// ── SAVE PNG ──────────────────────────────────────────────────────────────────

function savePNG() {
    const score   = parseFloat(document.getElementById('final-rating').textContent);
    const verdict = document.getElementById('commentary').textContent;
    downloadShareCard(score, verdict, lastStats);
}

// ── INIT ──────────────────────────────────────────────────────────────────────

export function init() {
    document.addEventListener('DOMContentLoaded', () => {
        loadData().catch(console.error);

    const unitSelect  = document.getElementById('inch-vs-cm');
    const lengthInput = document.getElementById('dick-length');
    const girthInput  = document.getElementById('dick-girth');
    const lengthLabel = document.querySelector('label[for="dick-length"]');
    const girthLabel  = document.querySelector('label[for="dick-girth"]');

    function syncUnitLabels() {
        const cm = unitSelect.value === 'cm';
        lengthInput.placeholder = cm ? 'e.g. 14' : 'e.g. 5.5';
        girthInput.placeholder  = cm ? 'e.g. 12' : 'e.g. 4.5';
        lengthLabel.textContent = cm ? 'Penis Length (cm)' : 'Penis Length (in)';
        girthLabel.textContent  = cm ? 'Penis Girth — circumference (cm)' : 'Penis Girth — circumference (in)';
    }

    unitSelect.addEventListener('change', syncUnitLabels);
    syncUnitLabels();

    document.querySelector('.btn-gold').addEventListener('click', () => {
        if (!prefs || !averages) return;

        const lengthEl = document.getElementById('dick-length');
        const girthEl  = document.getElementById('dick-girth');
        const unit     = document.getElementById('inch-vs-cm').value;
        const degrade  = document.getElementById('degrade-mode').checked;

        const length = parseFloat(lengthEl.value);
        const girth  = parseFloat(girthEl.value);

        const lengthBad = isNaN(length) || length <= 0;
        const girthBad  = isNaN(girth)  || girth  <= 0;

        lengthEl.classList.toggle('input-error', lengthBad);
        girthEl.classList.toggle('input-error',  girthBad);

        if (lengthBad || girthBad) return;

        const score        = calculate(length, girth, unit);
        const lengthInches = toInches(length, unit);
        const verdict      = (degrade && insults) ? degradeUser(lengthInches) : calcVerdict(score);
        const tags         = [...document.querySelectorAll('.tag.tag-active')].map(b => b.textContent);
        render(score, verdict, { length, girth, unit, tags });
    });

    document.getElementById('save-png').addEventListener('click', savePNG);

    document.getElementById('share-x').addEventListener('click', () => {
        const score   = parseFloat(document.getElementById('final-rating').textContent);
        const verdict = document.getElementById('commentary').textContent;
        shareToX(score, verdict, lastStats);
    });
})};
