# ClarkeMask

**Script PixInsight : masque les traînées de satellites géostationnaires dans chaque brute, pour
que l'intégration de WBPP les rejette pixel par pixel.**

*English version: [README.md](README.md)*

Les cibles proches de la ceinture géostationnaire (la ceinture de Clarke) récoltent des traînées
de satellites dans la plupart des brutes. Le ciel dérive parallèlement à la ceinture, la cible y
reste donc toute la nuit ; les traînées sont parallèles, serrées dans une bande étroite, souvent
faibles. La réjection de pixels à l'intégration n'est pas faite pour ce cas, et écarter les brutes
reviendrait à écarter l'essentiel de la session.

ClarkeMask répare au lieu d'écarter : il trouve chaque traînée dans chaque brute registrée et ne
masque que les pixels qu'elle couvre. À l'intégration, chaque pixel est alors empilé à partir des
brutes propres à cet endroit : le nombre de valeurs varie d'un pixel à l'autre.

## Principe

* **Dans WBPP** : un script d'événement s'exécute juste après la registration, avant la
  normalisation locale et l'intégration. Les pixels masqués sont mis à 0, valeur que l'intégration
  de WBPP rejette déjà pour les brutes.
* **Détection** : la direction des traînées vient de la solution astrométrique de la brute
  (déclinaison constante) ; chaque traînée est suivie segment par segment, sa largeur tirée de son
  propre profil. Critères et paramètres : [DETECTOR.md](DETECTOR.md) (en anglais). Nécessite une
  solution astrométrique (plate solving à l'acquisition, ou ImageSolver sur la brute de référence).
  Une solution en miroir (« flipped », constatée avec certains WCS écrits à l'acquisition) est détectée
  d'après les traînées elles-mêmes et corrigée.
* **Un fichier masque par brute**, gardé dans un dossier `ClarkeMask` de la sortie de WBPP pour
  contrôle.
* Brutes monochromes comme couleur (OSC).
* **Coût des masques** : masquer fait perdre du temps de pose, pas du signal. Une ligne de score
  donne le pire cas (brutes perdues, pose et SNR conservés, part du champ) et le SNR moyen conservé,
  avec un tableau par nombre de brutes perdues et une carte de la pose conservée.
* Pas d'IA, aucune modification des brutes originales ou calibrées.

## Réglage : angle maximal par rapport à la ceinture

Un satellite strictement géostationnaire trace sa traînée exactement selon la direction est-ouest
du ciel (déclinaison constante). Les satellites géosynchrones inclinés, surtout les plus anciens,
dérivent lentement en déclinaison et tracent des traînées inclinées de quelques degrés.
L'**angle maximal** fixe jusqu'à quel écart avec la direction de la ceinture une traînée est
encore masquée ; les traînées droites au-delà sont seulement signalées.

* **2,5° (par défaut)** : géostationnaires et objets légèrement inclinés.
* Une valeur plus grande masque aussi des objets plus inclinés, mais la détection est plus longue
  (elle est répétée sur davantage de directions inclinées), et d'autres types d'objets deviennent
  plus probables aux grands angles.
* 0 : direction de la ceinture seulement.

**Au-delà, confirmation par la longueur** (`ClarkeMask/maxConfirmedAngle`, 7° par défaut) : un
objet géosynchrone défile à la vitesse sidérale, sa traînée a donc une longueur connue (dérive
sidérale pendant la pose). Entre l'angle maximal et cette seconde limite, une traînée droite est
masquée si sa longueur correspond et si ses deux bouts sont dans l'image ; sinon elle est seulement
signalée. Une valeur plus grande explore davantage de directions inclinées et prend plus de temps.
Nécessite la durée de pose dans les en-têtes.

Les deux valeurs se règlent dans le dialogue ; elles sont enregistrées dans les réglages de
PixInsight et utilisées par le script d'événement de WBPP.

## Réglage : threads de détection

Avec PixInsight 1.9.5 ou plus, les brutes d'un groupe sont détectées en parallèle, une par thread ;
le masquage et l'enregistrement restent faits dans l'ordre, et les résultats sont les mêmes qu'en
série. **Auto** (par défaut) utilise autant de threads que de processeurs permis dans les
préférences de PixInsight, dans la limite de la mémoire disponible (chaque thread garde une brute
en mémoire) ; **1** détecte en série. Se règle dans le dialogue, utilisé par le script d'événement
de WBPP. Avec PixInsight 1.9.4, la détection est en série.

## Prérequis

* PixInsight 1.9.4 ou plus ; 1.9.5 ou plus pour la détection en parallèle.
* Des brutes registrées (monochromes ou couleur) avec une **solution astrométrique** : plate
  solving à l'acquisition (WCS écrit par le logiciel d'acquisition), ou brute de référence résolue
  avec ImageSolver avant WBPP. L'option de plate solving de WBPP n'aide pas ici : elle ne résout
  que les masters, après l'intégration. Les brutes registrées par WBPP portent la solution de la
  brute de référence.
* Pour la confirmation par la longueur : la durée de pose dans les en-têtes (`EXPTIME` ou
  `EXPOSURE`).

## Installation

1. *Resources > Updates > Manage Repositories*, ajouter `https://jps-34.github.io/ClarkeMask/`
2. *Check for Updates*, redémarrer PixInsight (activer *Allow unsigned update repositories* tant
   que le dépôt n'est pas signé).
3. *Script > Utilities > ClarkeMask*. Le script d'événement WBPP `ClarkeMask-WBPP.js` est installé
   dans le même dossier ; son chemin est affiché en bas du dialogue.

Ou télécharger le dossier `scripts/` et lancer `ClarkeMask.js` par *Script > Execute Script File*
(les quatre fichiers doivent rester ensemble).

## Utilisation

**Avec WBPP** (masquage sur place des brutes registrées, avant la normalisation locale et
l'intégration) :

1. Lancer une fois *Script > Utilities > ClarkeMask* pour vérifier les réglages ; le dialogue
   affiche le chemin du script d'événement.
2. Dans WBPP, *Pipeline > Event Script* : l'activer et choisir `ClarkeMask-WBPP.js` dans le
   dossier de ClarkeMask.
3. Lancer WBPP comme d'habitude. Masques, carte de couverture et rapports sont dans
   `<sortie WBPP>/ClarkeMask/`.

**Seul** (*Script > Utilities > ClarkeMask*), sur des brutes registrées ; les entrées ne sont
jamais modifiées :

1. **Ajouter des brutes...** (registrées, avec solution astrométrique) et choisir un dossier de
   sortie.
2. **Prévisualiser** : masques, rapport et coût des masques, rien d'autre n'est écrit.
3. **Voir la brute et son masque** (ou double-clic sur une brute) : la brute s'ouvre avec son
   masque en surimpression ; **Voir la carte de couverture** ouvre la fraction de pose conservée
   par pixel.
4. **Appliquer** : copies masquées `<brute>_cm.xisf` dans le dossier de sortie, avec 0 sous les
   masques (PixInsight) ou NaN (autres logiciels d'empilement).

Pour visualiser le résultat d'un passage WBPP, choisir `<sortie WBPP>/ClarkeMask/groupNN` comme
dossier de sortie et ajouter les brutes registrées correspondantes.

## Remerciements

Merci à [nico1038](https://telescopius.com/profile/nico1038) pour ses tests sur ses propres données
et pour le rapport précis à l'origine de la version 0.2.1 : des brutes de référence dont PixInsight
convertit la solution astrométrique en miroir (« flipped ») après un retournement au méridien.

## Licence

Copyright (c) 2026 Jacques Pouyaud. [Licence MIT](LICENSE).
Rapports de bogues et suggestions bienvenus dans les issues GitHub.

*Code écrit par Claude (Anthropic), sous la direction de Jacques Pouyaud.*
