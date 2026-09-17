from pathlib import Path
import re

ASSETS = Path('elenya-refonte-52.4/project/21_Assets.js')
SCRIPTS = Path('elenya-refonte-52.4/project/Scripts_Game.html')

assets = ASSETS.read_text(encoding='utf-8')
ending_pattern = re.compile(
    r"// V52\.3\.0 — une cinématique distincte pour chacune des 33 fins et épilogues\.\n"
    r"const ELENYA_ENDING_VIDEO_IDS_V55 = Object\.freeze\(\[.*?\]\);\n\n"
    r"function endingVideoV55_\(scene, sceneId\) \{.*?\n\}",
    re.S,
)
ending_replacement = """// V52.4.4 — compatibilité historique : les 33 IDs restent déclarés.
// Le pack V55 ne contient toutefois que 13 fichiers binaires réellement distincts.
// Une fin qui réutilise le fichier d'une autre fin ne doit plus afficher cette
// cinématique comme si elle lui appartenait : elle garde alors son décor/sa CG.
const ELENYA_ENDING_VIDEO_IDS_V55 = Object.freeze([
  'FIN_POLY','GAME_OVER_SURCHARGE','GAME_OVER_SIRENE','GAME_OVER_SCELLEE',
  'FIN_HIVER','FIN_SACRIFICE','FIN_MORTELLE','FIN_OMBRE','FIN_ECLAIREUR',
  'FIN_SOLO','FIN_RECONCILIATION','FIN_BRISEE','FIN_CHAOS','FIN_TEMOIN',
  'FIN_EQUILIBRE','FIN_REDEMPTION','FIN_VERITE','GAME_OVER_VENIN',
  'GAME_OVER_POSSESSION','FIN_VEYRA','FIN_SERAPHINE','FIN_MIRA','FIN_CORONA',
  'FIN_DETTE_ANNULEE','ACTE5_02V','ACTE5_02D','ACTE5_02R',
  'NG_FIN_LIBERATION','NG_FIN_AMOUR','NG_FIN_DEUX_MAINS','NG_FIN_VIDE',
  'NG_FIN_CYCLE','NG_FIN_FRONTIERE'
]);
const ELENYA_ENDING_VIDEO_PRIMARY_IDS_V55 = Object.freeze([
  'FIN_POLY','GAME_OVER_SIRENE','FIN_SACRIFICE','FIN_MORTELLE',
  'FIN_OMBRE','FIN_ECLAIREUR','FIN_RECONCILIATION','FIN_BRISEE',
  'FIN_CHAOS','GAME_OVER_VENIN','FIN_CORONA','ACTE5_02V','NG_FIN_CYCLE'
]);
const ELENYA_ENDING_VIDEO_DUPLICATE_IDS_V55 = Object.freeze([
  'GAME_OVER_SURCHARGE','GAME_OVER_SCELLEE','FIN_HIVER','FIN_SOLO',
  'FIN_TEMOIN','FIN_EQUILIBRE','FIN_REDEMPTION','FIN_VERITE',
  'GAME_OVER_POSSESSION','FIN_VEYRA','FIN_SERAPHINE','FIN_MIRA',
  'FIN_DETTE_ANNULEE','ACTE5_02D','ACTE5_02R','NG_FIN_LIBERATION',
  'NG_FIN_AMOUR','NG_FIN_DEUX_MAINS','NG_FIN_VIDE','NG_FIN_FRONTIERE'
]);

function endingVideoV55_(scene, sceneId) {
  if (!scene || scene.isEnd !== true) return null;
  const id = String(scene.sceneNumber || sceneId || '');
  // « none » reste truthy pour empêcher SceneManager de reprendre un ancien
  // transitionGif faux, puis normalizeAssetRef le transforme en null côté client.
  if (ELENYA_ENDING_VIDEO_DUPLICATE_IDS_V55.indexOf(id) >= 0) return 'none';
  return ELENYA_ENDING_VIDEO_PRIMARY_IDS_V55.indexOf(id) >= 0
    ? ELENYA_ART_V55_BASE + 'endings/' + id + '.mp4'
    : null;
}"""
assets2, count = ending_pattern.subn(ending_replacement, assets, count=1)
if count != 1:
    raise SystemExit('Bloc des vidéos de fins introuvable ou ambigu')
ASSETS.write_text(assets2, encoding='utf-8')

scripts = SCRIPTS.read_text(encoding='utf-8')

old_bases = "const art54 = 'https://cdn.jsdelivr.net/gh/Sunstrader/elenya-3d-assets@main/game-v54/';\nconst art55 = art54.replace('game-v54/', 'game-v55/');"
new_bases = old_bases + "\nconst art56 = 'https://cdn.jsdelivr.net/gh/Sunstrader/elenya-3d-assets@b02779d6f91076b3bfedc96622b311255ce7f1ac/game-v56/backgrounds/';"
if old_bases not in scripts:
    raise SystemExit('Bases galerie introuvables')
scripts = scripts.replace(old_bases, new_bases, 1)

old_decor = "const allCG = Object.keys(bgNames).map(id => ({url:art54+'backgrounds/'+id+'.webp',name:bgNames[id],type:'image',group:'Décor'}));"
new_decor = """const v56Decor = {
  'auberge':['rustic-inn-corner','Auberge — salle commune'],
  'autel-reveil':['awakening-frost-chamber','Réveil — autel de basalte'],
  'bibliotheque':['winter-library-oblique','Bibliothèque — vue de la mezzanine'],
  'foret-noire':['snow-forest-sideview','Lisière — pente nocturne'],
  'galeries-basalte':['basalt-catacombs-transverse','Galeries — voûtes irrégulières'],
  'serre':['winter-greenhouse-oblique','Serre — bassin et verrières'],
  'trone-ebene':['ebony-throne-lateral','Trône — cathédrale éventrée']
};
const allCG = Object.keys(bgNames).map(id => {
  const modern = v56Decor[id];
  return modern
    ? {url:art56+modern[0]+'.webp',legacyUrl:art54+'backgrounds/'+id+'.webp',name:modern[1],type:'image',group:'Décor'}
    : {url:art54+'backgrounds/'+id+'.webp',name:bgNames[id],type:'image',group:'Décor'};
});
// Le ravin V56 est un cadrage distinct des catacombes et mérite sa propre case.
allCG.push({url:art56+'basalt-ravine-oblique.webp',legacyUrl:art54+'backgrounds/galeries-basalte.webp',name:'Combe — après les lances de givre',type:'image',group:'Décor'});"""
if old_decor not in scripts:
    raise SystemExit('Construction des décors galerie introuvable')
scripts = scripts.replace(old_decor, new_decor, 1)

old_loop = "endingIds.forEach(id => allCG.push({\n  url:art55+'endings/'+id+'.mp4',"
unique_loop = """const uniqueEndingVideoIds = [
  'FIN_POLY','GAME_OVER_SIRENE','FIN_SACRIFICE','FIN_MORTELLE',
  'FIN_OMBRE','FIN_ECLAIREUR','FIN_RECONCILIATION','FIN_BRISEE',
  'FIN_CHAOS','GAME_OVER_VENIN','FIN_CORONA','ACTE5_02V','NG_FIN_CYCLE'
];
uniqueEndingVideoIds.forEach(id => allCG.push({
  url:art55+'endings/'+id+'.mp4',"""
if old_loop not in scripts:
    raise SystemExit('Boucle des fins galerie introuvable')
scripts = scripts.replace(old_loop, unique_loop, 1)

old_unlock = "item.className = 'gallery-item' + (unlocked.includes(cg.url) ? '' : ' locked');\nif (unlocked.includes(cg.url)) {"
new_unlock = "const cgUnlocked = unlocked.includes(cg.url) || (cg.legacyUrl && unlocked.includes(cg.legacyUrl));\nitem.className = 'gallery-item' + (cgUnlocked ? '' : ' locked');\nif (cgUnlocked) {"
if old_unlock not in scripts:
    raise SystemExit('Compatibilité déblocage galerie introuvable')
scripts = scripts.replace(old_unlock, new_unlock, 1)

SCRIPTS.write_text(scripts, encoding='utf-8')
print('Patch visuel appliqué aux sources.')
