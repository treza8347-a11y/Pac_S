
// ===== CONFIGURATION =====
const RECAPTCHA_SITE_KEY = '6LdmQd0tAAAAAK5m1Y45Gxa_VdG2_DdJZWt7nw0K';
const API_ENDPOINT = '/api/submit';
const MIN_FORM_TIME = 5000;        // 5s minimum (formulaire plus long ici)
const RECAPTCHA_MIN_SCORE = 0.5;

const $ = (sel) => document.querySelector(sel);
const form = $('#leadForm');
const submitBtn = $('#submitBtn');
const btnText = submitBtn.querySelector('.btn__text');
const btnLoader = submitBtn.querySelector('.btn__loader');
const successMsg = $('#successMsg');
const globalError = $('#globalError');

$('#formStartTime').value = Date.now();

// ===== RÉCUPÉRATION DE L'IP PUBLIQUE (côté client, en secours) =====
(async function fetchIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    $('#ipAddress').value = data.ip || '';
  } catch (e) {
    console.warn('IP non récupérée côté client.');
  }
})();

// ===== VALIDATION =====
function showError(field, message) {
  field.classList.add('invalid');
  const errEl = document.querySelector(`[data-error="${field.name}"]`);
  if (errEl) errEl.textContent = message;
}
function clearError(field) {
  field.classList.remove('invalid');
  const errEl = document.querySelector(`[data-error="${field.name}"]`);
  if (errEl) errEl.textContent = '';
}

function validateField(field) {
  const value = field.type === 'checkbox' ? field.checked : field.value.trim();

  if (field.required && !value) {
    showError(field, 'Ce champ est obligatoire.');
    return false;
  }
  if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    showError(field, 'Email invalide.');
    return false;
  }
  if (field.type === 'tel' && value) {
    const cleaned = value.replace(/[\s().-]/g, '');
    if (!/^(\+?\d{9,15})$/.test(cleaned)) {
      showError(field, 'Téléphone invalide.');
      return false;
    }
  }
  if (field.name === 'postalCode' && value && !/^[0-9]{5}$/.test(value)) {
    showError(field, 'Code postal invalide (5 chiffres).');
    return false;
  }
  if (field.type === 'number' && value !== '') {
    const n = Number(value);
    if (field.min !== '' && n < Number(field.min)) {
      showError(field, `Minimum : ${field.min}`);
      return false;
    }
    if (field.max !== '' && n > Number(field.max)) {
      showError(field, `Maximum : ${field.max}`);
      return false;
    }
  }
  if (field.minLength > 0 && value && value.length < field.minLength) {
    showError(field, `Minimum ${field.minLength} caractères.`);
    return false;
  }
  clearError(field);
  return true;
}

// Validation en direct
form.querySelectorAll('input, select, textarea').forEach((field) => {
  if (field.name === 'website') return;
  if (field.type === 'hidden') return;
  field.addEventListener('blur', () => validateField(field));
  field.addEventListener('input', () => {
    if (field.classList.contains('invalid')) validateField(field);
  });
});

// Formatage auto du code postal (chiffres uniquement)
$('#postalCode').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
});

// ===== SOUMISSION =====
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  globalError.hidden = true;

  // 1) Honeypot
  const honeypot = form.querySelector('#website');
  if (honeypot.value !== '') {
    console.warn('Honeypot déclenché.');
    return fakeSuccess();
  }

  // 2) Temps minimum
  const startTime = parseInt($('#formStartTime').value, 10);
  if (Date.now() - startTime < MIN_FORM_TIME) {
    showGlobalError('Veuillez prendre le temps de remplir le formulaire.');
    return;
  }

  // 3) Validation
  const fields = [...form.querySelectorAll('input:not([name="website"]):not([type="hidden"]), select, textarea')];
  const allValid = fields.map(validateField).every(Boolean);
  if (!allValid) {
    showGlobalError('Merci de corriger les champs en rouge.');
    document.querySelector('.invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  setLoading(true);

  try {
    // 4) reCAPTCHA v3
    const token = await new Promise((resolve, reject) => {
      grecaptcha.ready(() => {
        grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: 'submit' })
          .then(resolve).catch(reject);
      });
    });
    $('#recaptchaToken').value = token;

    // 5) Payload
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    payload.formStartTime = startTime;
    payload.submittedAt = new Date().toISOString();
    payload.userAgent = navigator.userAgent;

    // 6) Envoi
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Erreur serveur.');
    }
    if (result.score !== undefined && result.score < RECAPTCHA_MIN_SCORE) {
      console.warn('Score trop bas :', result.score);
      return fakeSuccess();
    }
    realSuccess();
  } catch (err) {
    console.error(err);
    showGlobalError('Une erreur est survenue. Veuillez réessayer.');
  } finally {
    setLoading(false);
  }
});

// ===== UI =====
function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  btnText.hidden = isLoading;
  btnLoader.hidden = !isLoading;
}
function realSuccess() {
  form.reset();
  $('#formStartTime').value = Date.now();
  successMsg.hidden = false;
  setTimeout(() => { successMsg.hidden = true; }, 10000);
}
function fakeSuccess() {
  form.reset();
  successMsg.hidden = false;
}
function showGlobalError(message) {
  globalError.textContent = message;
  globalError.hidden = false;
  globalError.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
