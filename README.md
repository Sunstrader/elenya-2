# Elenya 52 Audio — 52.4.3 Free Voice

Cette build prépare les **2 260 segments français** d’Elenya pour une narration pré-générée avec **Gemini 3.1 Flash TTS Free Tier uniquement**.

## Zéro dépense par conception

- Backend autorisé : `gemini-free` uniquement.
- Les backends Google Cloud / Vertex / payants sont refusés par le générateur.
- `scripts/prepare-cloud-tts.sh` est volontairement neutralisé.
- La première préparation exige de confirmer que le projet de la clé est affiché **Free** dans Google AI Studio.
- Si un `GEMINI_FREE_PROJECT_ID` est fourni et que Cloud Billing est actif, la préparation s’arrête.
- Sur HTTP 429 / quota gratuit atteint, la génération sauvegarde son avancement et s’arrête. Relancer plus tard reprend sans refaire les fichiers existants.
- Aucune clé API n’est embarquée dans le jeu ni demandée aux joueurs.

## Voix candidates

- Algenib
- Achird
- Sulafat
- Leda

## Corpus

- 246 scènes jouables (+ scène technique)
- 1 269 variantes narratives
- 2 260 segments uniques
- 731 582 caractères par voix

## Cloud Shell

```bash
bash scripts/prepare-gemini-free.sh
npm run voice:previews
npm run voice:status
```

Pour générer Sulafat en priorité :

```bash
npm run voice:generate
npm run voice:status
```

Les quatre voix :

```bash
npm run voice:generate:all
```

## Vérifications

```bash
npm test
npm run lint
npm run build
npm run voice:status
```

Le joueur n’utilise jamais l’API Gemini directement.