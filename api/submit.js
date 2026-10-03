// api/submit.js
const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const MIN_SCORE = 0.5;
const MIN_FORM_TIME = 5000;

// Plages IP de data centers / VPN connus (à enrichir)
const SUSPICIOUS_IP_PREFIXES = [
  '35.', '34.', '104.', '130.211.', '146.148.',  // Google Cloud
  '52.', '54.', '3.', '18.',                     // AWS
  '20.', '40.', '51.', '13.',                    // Azure
  '45.', '185.', '198.',                         // VPN fréquents
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const {
      firstName, lastName, phone, email, address, postalCode, city,
      housingType, status, surface, heating, income, household,
      consent, website, formStartTime, submittedAt, userAgent,
      recaptchaToken, ipAddress,
    } = body;

    // 1) Honeypot
    if (website && website.trim() !== '') {
      console.warn('Honeypot déclenché');
      return res.status(200).json({ success: true, silent: true });
    }

    // 2) Champs obligatoires
    const required = { firstName, lastName, phone, email, address, postalCode, city,
      housingType, status, surface, heating, income, household };
    for (const [key, val] of Object.entries(required)) {
      if (!val || String(val).trim() === '') {
        return res.status(400).json({ success: false, error: `Champ manquant : ${key}` });
      }
    }
    if (!consent) {
      return res.status(400).json({ success: false, error: 'Consentement manquant.' });
    }

    // 3) Validation basique côté serveur
    if (!/^[0-9]{5}$/.test(postalCode)) {
      return res.status(400).json({ success: false, error: 'Code postal invalide.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Email invalide.' });
    }
    if (Number(surface) < 5 || Number(surface) > 1000) {
      return res.status(400).json({ success: false, error: 'Surface invalide.' });
    }
    if (Number(household) < 1 || Number(household) > 20) {
      return res.status(400).json({ success: false, error: 'Nombre de personnes invalide.' });
    }

    // 4) Temps de remplissage
    const elapsed = Date.now() - parseInt(formStartTime, 10);
    if (!formStartTime || elapsed < MIN_FORM_TIME) {
      console.warn('Soumission trop rapide :', elapsed, 'ms');
      return res.status(200).json({ success: true, silent: true });
    }

    // 5) reCAPTCHA v3
    if (!recaptchaToken) {
      return res.status(400).json({ success: false, error: 'Token reCAPTCHA manquant.' });
    }
    const params = new URLSearchParams({
      secret: process.env.RECAPTCHA_SECRET_KEY,
      response: recaptchaToken,
    });
    const verifyRes = await fetch(RECAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.success || verifyData.score < MIN_SCORE) {
      console.warn('reCAPTCHA rejeté :', verifyData);
      return res.status(200).json({ success: true, silent: true, score: verifyData.score || 0 });
    }

    // 6) IP serveur (plus fiable que côté client)
    const serverIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                  || req.socket?.remoteAddress || '';
    const finalIp = serverIp || ipAddress || '';

    if (SUSPICIOUS_IP_PREFIXES.some((p) => finalIp.startsWith(p))) {
      console.warn('IP suspecte bloquée :', finalIp);
      return res.status(200).json({ success: true, silent: true });
    }

    // 7) Transmission à Apps Script
    const payload = {
      secret: process.env.APPS_SCRIPT_SECRET,
      firstName, lastName, phone, email, address, postalCode, city,
      housingType, status, surface, heating, income, household,
      consent: true,
      ip: finalIp,
      userAgent,
      submittedAt: submittedAt || new Date().toISOString(),
      score: verifyData.score,
      action: verifyData.action,
    };

    const appsRes = await fetch(process.env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!appsRes.ok) throw new Error('Erreur Apps Script : ' + appsRes.status);

    return res.status(200).json({ success: true, score: verifyData.score });
  } catch (err) {
    console.error('Erreur serveur :', err);
    return res.status(500).json({ success: false, error: 'Erreur interne.' });
  }
}
