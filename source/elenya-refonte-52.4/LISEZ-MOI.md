# Elenya — 52.4.0-rc3-audio

Correctif audio ciblé sur l’archive 52.4.0-rc2 retrouvée le 14 septembre 2026.

- Musique, ambiances et effets baissés à 25 % de leur volume pendant la parole, sans suppression. Baisse en 200 ms, remontée en 500 ms.
- Atténuation indépendante des fondus et des rotations musicales.
- Volume rétabli à la valeur choisie, y compris après un changement de réglage pendant la lecture.
- Effets toujours joués et atténuation des effets déjà en cours.
- Sélecteur de voix françaises, chargement tardif des voix pris en compte, choix mémorisé et bouton d’écoute de la scène. Le choix automatique privilégie les voix signalées Natural/Neural/Online/Premium/Enhanced quand elles existent, puis le français de France. C’est une préférence de sélection, pas une garantie de qualité.
- Phrases courtes regroupées pour réduire les redémarrages. Vitesse par défaut 0,95 pour les nouveaux réglages ; réglages existants conservés.
- Narrateur à volume 100 % par défaut ; activation facultative inchangée.

Les sauvegardes, le scénario, les 3 CG et les 33 vidéos conservent leur contenu et leurs références. Le code n’a pas été déployé sur Apps Script.

## Musiques

Les 32 MP3 ont été retrouvés (22 nouveaux + 10 précédents). L’inventaire avec empreintes est dans `docs/musiques-retrouvees-2026-09-14.json`. Ce correctif conserve les 10 musiques déjà utilisées. Les 22 nouvelles ne sont pas encore raccordées aux scènes ni publiées. Les fichiers audio ne sont pas dupliqués dans cette archive de code.

## Validation

Voir `qa/resultats-audio.json`, `qa/resultats-client-audio.json` et `qa/resultats-verification-audio.json`. Tests Node avec DOM et audio simulés ; aucune écoute sur l’appareil du joueur ni recette sur le site Google Apps Script. La qualité des voix dépend des voix françaises proposées par le navigateur et le système.

## Cloud Shell

Téléverser l’archive dans le dossier personnel Cloud Shell, puis exécuter ce bloc complet. La sauvegarde du code actuel est créée avant le poussage ; une erreur interrompt le bloc.

```bash
set -e
cd ~
clasp login
elenya_backup_dir=$(mktemp -d "$HOME/elenya-avant-audio.XXXXXX")
cd "$elenya_backup_dir"
clasp clone 1IEWLRwRA8i5MYtkMOsmTkOn1YTZ4RiJmiMIzMhXhmKnwPiVkoD7rtyo0
cd ~
unzip -o elenya-52.4.0-rc3-audio.zip -d elenya-52.4.0-rc3-audio
cd ~/elenya-52.4.0-rc3-audio/elenya-refonte-52.4
node qa/audio-narration.cjs
node qa/client-state.cjs
cd project
clasp push --force
clasp open-script
```

Dans Apps Script : Déployer → Gérer les déploiements → Modifier → Nouvelle version → Déployer. Mettre à jour le déploiement existant pour conserver l’URL.
