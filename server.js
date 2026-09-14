const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { GoogleGenAI } = require('@google/genai');
const { loadEngine } = require('./elenya-refonte-52.4/qa/engine.cjs');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Moteur GAS local via VM pour une expérience de jeu autonome et fluide
const projectRoot = path.join(__dirname, 'elenya-refonte-52.4/project');
let engine = null;
try {
  engine = loadEngine(projectRoot);
} catch (e) {
  console.warn('Moteur local GAS non chargé:', e.message);
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

const OFFICIAL_VOICE_IDS = new Set([
  'Charon', 'Fenrir', 'Zephyr', 'Kore', 'Puck', 'Enceladus', 'Algenib', 'Gacrux', 'Achernar', 'Sulafat',
  'Aoede', 'Callirrhoe', 'Despina', 'Erinome', 'Lapetus', 'Laomedeia', 'Leda', 'Orus', 'Pulcherrima',
  'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Umbriel', 'Vindemiatrix', 'Zubenelgenubi',
  'Achird', 'Algieba', 'Alnilam', 'Autonoe'
]);

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

// Endpoint de narration vocale naturelle multi-voix
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice, style } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ ok: false, error: 'Texte manquant' });
    }

    const selectedVoice = OFFICIAL_VOICE_IDS.has(voice) ? voice : 'Charon';
    const styleInstruction = STYLE_PROMPTS[style] || STYLE_PROMPTS.fantasy;
    const fullPrompt = `${styleInstruction}\n\nTexte :\n${text.slice(0, 2000)}`;

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-tts-preview',
      contents: [{ parts: [{ text: fullPrompt }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: selectedVoice }
          }
        }
      }
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    const base64Audio = part?.inlineData?.data;

    if (!base64Audio) {
      return res.status(500).json({ ok: false, error: 'Aucune donnée audio générée' });
    }

    const pcmBuffer = Buffer.from(base64Audio, 'base64');
    const wavBuffer = pcmToWav(pcmBuffer, 24000, 1);
    const audioUrl = `data:audio/wav;base64,${wavBuffer.toString('base64')}`;

    return res.json({
      ok: true,
      audioUrl,
      voice: selectedVoice,
      style: style || 'fantasy'
    });
  } catch (err) {
    console.error('Erreur synthèse vocale TTS:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint proxy pour simuler google.script.run en local
app.post('/api/gas/:functionName', (req, res) => {
  if (!engine || !engine.ctx) {
    return res.status(503).json({ ok: false, error: 'Moteur local indisponible' });
  }
  const fnName = req.params.functionName;
  const args = req.body?.args || [];
  try {
    const fn = engine.ctx[fnName];
    if (typeof fn !== 'function') {
      return res.status(404).json({ ok: false, error: `Fonction ${fnName} introuvable` });
    }
    const result = fn.apply(null, args);
    return res.json({ ok: true, result });
  } catch (err) {
    console.error(`Erreur exécution ${fnName}:`, err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Servir les assets statiques
app.use('/assets', express.static(path.join(__dirname, 'elenya-refonte-52.4/assets')));
app.use('/docs', express.static(path.join(__dirname, 'elenya-refonte-52.4/docs')));
app.use('/project', express.static(projectRoot));

// Page d'accueil : assembler le visual novel V12_Jeu.html
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

  // Injecter le bridge google.script.run si exécuté hors Apps Script
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
        'serverGetMainMenu', 'serverGetBuildInfo', 'serverGetPendingScene',
        'serverProcessChoice', 'serverSaveGame', 'serverLoadGame',
        'serverGetExplorer', 'serverRunComprehensiveQA', 'serverValidateDatabase'
      ];
      methods.forEach(function(m) {
        runner[m] = function() {
          var args = Array.prototype.slice.call(arguments);
          fetch('/api/gas/' + m, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ args: args })
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.ok) {
              if (successHandler) successHandler(data.result);
            } else {
              if (failureHandler) failureHandler(new Error(data.error));
            }
          })
          .catch(function(err) {
            if (failureHandler) failureHandler(err);
          });
        };
      });
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
