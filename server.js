const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { GoogleGenAI } = require('@google/genai');
const { createIsolatedEngine } = require('./elenya-refonte-52.4/qa/engine.cjs');

const app = express();
const PORT = 3000;

// Protection et parsing limité
app.use(express.json({ limit: '1mb' }));

// Bloquer l'accès direct aux fichiers sensibles
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (p.includes('.env') || p.includes('.git') || p.endsWith('.zip') || p.startsWith('/qa') || p.includes('..')) {
    return res.status(403).json({ ok: false, error: 'Accès interdit' });
  }
  next();
});

// Moteur GAS local via contextes isolés stateless par requête
const projectRoot = path.join(__dirname, 'elenya-refonte-52.4/project');
let isolatedEngine = null;
try {
  isolatedEngine = createIsolatedEngine(projectRoot);
} catch (e) {
  console.warn('Moteur local isolé non initialisé:', e.message);
}

// Convertisseur PCM 16-bit 24kHz mono -> WAV
function pcmToWav(pcmBuffer, sampleRate = 24000, numChannels = 1) {
  const wav = Buffer.alloc(44 + pcmBuffer.length);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + pcmBuffer.length, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM format
  wav.writeUInt16LE(numChannels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * numChannels * 2, 28);
  wav.writeUInt16LE(numChannels * 2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcmBuffer.length, 40);
  pcmBuffer.copy(wav, 44);
  return wav;
}

const STYLE_PROMPTS = {
  fantasy: "Lis ce texte en français de France, comme une narration de livre audio de fantasy. Voix naturelle, posée et immersive. Débit légèrement lent, pauses souples entre les phrases, émotion retenue. Évite le ton publicitaire et la diction mécanique. Dans les dialogues, adapte subtilement l’intention du personnage. Respecte exactement le texte. Voix seule, sans musique ni bruitage.",
  mystic: "Interprète le texte comme une présence ancienne qui confie un secret. Timbre naturel, intime et légèrement soufflé, sans forcer la gravité. Débit lent mais vivant, silences après les images fortes, tension discrète. Évite la monotonie, le chuchotement permanent et le ton de bande-annonce. Respecte exactement le texte. Voix seule, sans musique ni bruitage."
};

// 30 voix officielles Gemini TTS avec graphie exacte ('Iapetus' avec un I majuscule)
const OFFICIAL_VOICE_IDS = new Set([
  'Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe', 'Callirrhoe', 'Charon', 'Despina',
  'Enceladus', 'Erinome', 'Fenrir', 'Gacrux', 'Iapetus', 'Kore', 'Laomedeia', 'Leda', 'Orus', 'Puck',
  'Pulcherrima', 'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel', 'Vindemiatrix', 'Zephyr', 'Zubenelgenubi'
]);

// Phrase fixe d'aperçu pour tester les voix (19 mots, indépendante du scénario)
const PREVIEW_SAMPLE_TEXT = "Sur les crêtes de givre, le vent murmure les légendes d'Elenya. Les cristaux d'éther s'illuminent dans la pénombre glaciale.";

// Lazy Gemini client
let geminiClient = null;
function getGeminiClient() {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY non configurée');
    }
    geminiClient = new GoogleGenAI({ apiKey });
  }
  return geminiClient;
}

// Limiteur de concurrence simple pour la synthèse vocale (max 2 requêtes simultanées)
let activeTtsRequests = 0;
const MAX_CONCURRENT_TTS = 2;
const ttsQueue = [];

function acquireTtsSlot() {
  return new Promise((resolve, reject) => {
    if (activeTtsRequests < MAX_CONCURRENT_TTS) {
      activeTtsRequests++;
      return resolve();
    }
    // File d'attente bornée
    if (ttsQueue.length >= 8) {
      return reject(new Error('QUEUE_FULL'));
    }
    const timeout = setTimeout(() => {
      const idx = ttsQueue.findIndex(item => item.resolve === resolve);
      if (idx !== -1) ttsQueue.splice(idx, 1);
      reject(new Error('QUEUE_TIMEOUT'));
    }, 45000);
    ttsQueue.push({ resolve, timeout });
  });
}

function releaseTtsSlot() {
  activeTtsRequests = Math.max(0, activeTtsRequests - 1);
  if (ttsQueue.length > 0) {
    const next = ttsQueue.shift();
    clearTimeout(next.timeout);
    activeTtsRequests++;
    next.resolve();
  }
}

// Endpoint de narration vocale TTS
app.post('/api/tts', async (req, res) => {
  let slotAcquired = false;
  try {
    const { text, voice, style, isPreview } = req.body || {};

    const finalText = isPreview
      ? PREVIEW_SAMPLE_TEXT
      : (typeof text === 'string' ? text.trim() : '');

    if (!finalText) {
      return res.status(400).json({ ok: false, code: 'INVALID_REQUEST', error: 'Texte manquant ou invalide' });
    }

    if (finalText.length > 3500) {
      return res.status(400).json({
        ok: false,
        code: 'TEXT_TOO_LONG',
        error: 'Le segment de texte dépasse la longueur maximale recommandée. Veuillez utiliser la segmentation narrative.'
      });
    }

    const selectedVoice = OFFICIAL_VOICE_IDS.has(voice) ? voice : 'Charon';
    const styleInstruction = STYLE_PROMPTS[style] || STYLE_PROMPTS.fantasy;
    const fullPrompt = `${styleInstruction}\n\nTexte :\n${finalText}`;

    let ai;
    try {
      ai = getGeminiClient();
    } catch (err) {
      return res.status(503).json({
        ok: false,
        code: 'NO_API_KEY',
        error: 'Service de narration non configuré sur le serveur.'
      });
    }

    try {
      await acquireTtsSlot();
      slotAcquired = true;
    } catch (queueErr) {
      return res.status(429).json({
        ok: false,
        code: 'SERVER_BUSY',
        error: 'Le serveur est très sollicité. Réessaie dans quelques instants.'
      });
    }

    // Timeout de génération (45s pour preview, 120s pour récit)
    const timeoutMs = isPreview ? 45000 : 120000;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    // Annulation côté client si la connexion se ferme
    req.on('close', () => {
      clearTimeout(timeoutTimer);
      controller.abort();
    });

    let response;
    try {
      response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: [{ parts: [{ text: fullPrompt }] }],
        config: {
          abortSignal: controller.signal,
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice }
            }
          }
        }
      });
    } finally {
      clearTimeout(timeoutTimer);
    }

    const part = response.candidates?.[0]?.content?.parts?.[0];
    const base64Audio = part?.inlineData?.data;

    if (!base64Audio) {
      return res.status(500).json({ ok: false, code: 'EMPTY_AUDIO', error: 'Aucune donnée audio générée' });
    }

    const pcmBuffer = Buffer.from(base64Audio, 'base64');
    const wavBuffer = pcmToWav(pcmBuffer, 24000, 1);
    const audioUrl = `data:audio/wav;base64,${wavBuffer.toString('base64')}`;

    return res.json({
      ok: true,
      audioUrl,
      voice: selectedVoice,
      style: style || 'fantasy',
      isPreview: !!isPreview
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota')) {
      return res.status(429).json({
        ok: false,
        code: 'QUOTA_EXCEEDED',
        error: 'Quota de synthèse vocale atteint. Réessaie dans quelques instants.'
      });
    }
    if (msg.includes('abort') || msg.includes('aborted') || msg.includes('TIMEOUT')) {
      return res.status(504).json({
        ok: false,
        code: 'TIMEOUT',
        error: 'Le délai de génération vocale a expiré.'
      });
    }
    console.error('Erreur synthèse vocale TTS:', msg);
    return res.status(500).json({
      ok: false,
      code: 'GENERATION_ERROR',
      error: 'Erreur lors de la génération vocale.'
    });
  } finally {
    if (slotAcquired) {
      releaseTtsSlot();
    }
  }
});

// Whitelist stricte des fonctions moteur autorisées
const ALLOWED_GAS_METHODS = new Set([
  'serverGetMainMenu',
  'serverGetPendingScene',
  'serverProcessChoice',
  'serverStartNewGamePlus',
  'serverGetExplorer',
  'serverSaveGame',
  'serverLoadGame',
  'serverGetBuildInfo',
  'serverValidateDatabase',
  'serverRunAAAHealthCheck'
]);

// Endpoint proxy sécurisé et stateless pour simuler google.script.run
app.post('/api/gas/:functionName', (req, res) => {
  if (!isolatedEngine) {
    return res.status(503).json({ ok: false, error: 'Moteur local indisponible' });
  }

  const fnName = req.params.functionName;
  if (!ALLOWED_GAS_METHODS.has(fnName)) {
    return res.status(403).json({ ok: false, error: 'Opération non autorisée' });
  }

  const args = req.body?.args;
  if (!Array.isArray(args)) {
    return res.status(400).json({ ok: false, error: 'Format des arguments invalide' });
  }

  try {
    // Traitement spécifique pour garantir l'isolation complète des utilisateurs :
    if (fnName === 'serverSaveGame') {
      const state = args[0];
      if (!state || typeof state !== 'object' || !state.currentSceneId) {
        return res.json({ ok: true, result: { ok: false, error: 'État de sauvegarde invalide' } });
      }
      // Ne stocke rien dans un état partagé serveur : valide et informe le client
      return res.json({ ok: true, result: { ok: true, localOnly: true } });
    }

    if (fnName === 'serverLoadGame') {
      // Les sauvegardes sont préservées de façon étanche dans le navigateur local du joueur
      return res.json({ ok: true, result: { ok: false, localOnly: true, error: 'Sauvegardes gérées localement dans ce navigateur.' } });
    }

    if (fnName === 'serverGetMainMenu') {
      const clientMeta = (args[0] && typeof args[0] === 'object') ? args[0] : {};
      const required = [
        'ach_fin_ombre','ach_fin_eclaireur','ach_fin_poly','ach_fin_solo',
        'ach_fin_reconciliation','ach_fin_hiver','ach_fin_sacrifice','ach_fin_mortelle','ach_fin_brisee'
      ];
      const clientAchievements = Array.isArray(clientMeta.achievements) ? clientMeta.achievements : [];
      const unlocked = required.every(a => clientAchievements.includes(a));
      const result = {
        ngPlusUnlocked: unlocked,
        achievements: clientAchievements,
        globalFlags: Array.isArray(clientMeta.globalFlags) ? clientMeta.globalFlags : [],
        classicSave: null,
        ngPlusSave: null,
        classicEnds: required.filter(a => clientAchievements.includes(a)).length,
        classicEndsRequired: required.length
      };
      return res.json({ ok: true, result });
    }

    if (fnName === 'serverStartNewGamePlus') {
      const clientMeta = (args[0] && typeof args[0] === 'object') ? args[0] : {};
      const clientAchievements = Array.isArray(clientMeta.achievements) ? clientMeta.achievements : [];
      const required = [
        'ach_fin_ombre','ach_fin_eclaireur','ach_fin_poly','ach_fin_solo',
        'ach_fin_reconciliation','ach_fin_hiver','ach_fin_sacrifice','ach_fin_mortelle','ach_fin_brisee'
      ];
      const unlocked = required.every(a => clientAchievements.includes(a));
      if (!unlocked) {
        return res.json({ ok: true, result: { ok: false, error: 'NEW GAME+ verrouillé. Termine les 9 fins classiques requises.' } });
      }
      const rawRes = isolatedEngine.run('serverStartNewGamePlus', []);
      return res.json({ ok: true, result: rawRes });
    }

    // serverProcessChoice et serverGetPendingScene s'exécutent dans un contexte isolé éphémère
    const result = isolatedEngine.run(fnName, args);
    return res.json({ ok: true, result });
  } catch (err) {
    console.error(`Erreur exécution isolée ${fnName}:`, err.message);
    return res.status(500).json({ ok: false, error: 'Une erreur est survenue lors du traitement de la requête.' });
  }
});

// Servir les assets statiques autorisés
app.use('/assets', express.static(path.join(__dirname, 'elenya-refonte-52.4/assets')));
app.use('/docs', express.static(path.join(__dirname, 'elenya-refonte-52.4/docs')));
app.use('/project', express.static(projectRoot));

// Assemblage et service du visual novel V12_Jeu.html
app.get(['/', '/index.html'], (req, res) => {
  const v12Path = path.join(projectRoot, 'V12_Jeu.html');
  if (!fs.existsSync(v12Path)) {
    return res.status(404).send('V12_Jeu.html introuvable');
  }

  let html = fs.readFileSync(v12Path, 'utf8');

  // Remplacer <?!= include('FileName'); ?>
  html = html.replace(/<\?!\s*=\s*include\('([^']+)'\);\s*\?>/g, (match, fileName) => {
    const filePath = path.join(projectRoot, `${fileName}.html`);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    return `<!-- Fichier manquant: ${fileName} -->`;
  });

  // Injecter le bridge google.script.run sécurisé
  const bridgeScript = `
<script>
(function() {
  if (!window.google) window.google = {};
  if (!window.google.script) window.google.script = {};
  if (!window.google.script.run) {
    function makeRunner() {
      var successHandler = null, failureHandler = null;
      var runner = {
        withSuccessHandler: function(fn) { successHandler = fn; return runner; },
        withFailureHandler: function(fn) { failureHandler = fn; return runner; }
      };
      var methods = [
        'serverGetMainMenu', 'serverGetPendingScene',
        'serverProcessChoice', 'serverStartNewGamePlus',
        'serverSaveGame', 'serverLoadGame', 'serverGetExplorer',
        'serverGetBuildInfo', 'serverValidateDatabase',
        'serverRunAAAHealthCheck'
      ];
      function createCaller(m) {
        return function() {
          var args = Array.prototype.slice.call(arguments);
          fetch('/api/gas/' + encodeURIComponent(m), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ args: args })
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data && data.ok) {
              if (successHandler) successHandler(data.result);
            } else {
              if (failureHandler) failureHandler(new Error((data && data.error) || 'Erreur requête'));
            }
          })
          .catch(function(err) {
            if (failureHandler) failureHandler(err);
          });
        };
      }
      methods.forEach(function(m) {
        runner[m] = createCaller(m);
      });
      if (typeof Proxy !== 'undefined') {
        return new Proxy(runner, {
          get: function(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop === 'string' && prop.startsWith('server')) {
              return createCaller(prop);
            }
            return target[prop];
          }
        });
      }
      return runner;
    }
    window.google.script.run = makeRunner();
    window.google.script.run.withSuccessHandler = function(fn) {
      var r = makeRunner();
      return r.withSuccessHandler(fn);
    };
    window.google.script.run.withFailureHandler = function(fn) {
      var r = makeRunner();
      return r.withFailureHandler(fn);
    };
  }
})();
</script>
`;
  html = html.replace('</head>', `${bridgeScript}\n</head>`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur Elenya en écoute sur le port ${PORT}`);
});
