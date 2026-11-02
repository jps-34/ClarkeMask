# ClarkeMask

**<ins>La version 0.3.0 change la méthode du masquage dans WBPP, et l'endroit où on le choisit. Il
n'utilise plus d'Event Script : dans WBPP, onglet *Pipeline*, décocher *Event Script* et choisir
`ClarkeMask-PipelineBuilder.js` dans *Pipeline builder* à la place. Les fichiers de WBPP ne sont plus
modifiés.</ins>**

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

* **Dans WBPP** : un pipeline builder ajoute une étape de masquage juste après la registration,
  avant la normalisation locale et l'intégration. Des copies masquées des brutes, à 0 sous les
  masques, passent à la suite du pipeline de WBPP, dont l'intégration rejette déjà le 0 pour les
  brutes. Les fichiers de WBPP ne sont pas modifiés.
* **Détection** : la direction des traînées vient de la solution astrométrique de la brute
  (déclinaison constante) ; chaque traînée est suivie segment par segment, sa largeur tirée de son
  propre profil. Critères et paramètres : [DETECTOR.md](DETECTOR.md) (en anglais). Nécessite une
  solution astrométrique (plate solving à l'acquisition, ou ImageSolver sur la brute de référence).
  Une solution en miroir (« flipped », constatée avec certains WCS écrits à l'acquisition et convertis par PixInsight avant la 1.9.6) est détectée
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
PixInsight et utilisées par le pipeline builder de WBPP.

## Réglage : threads de détection

Les brutes d'un groupe sont détectées en parallèle, une par thread ;
le masquage et l'enregistrement restent faits dans l'ordre, et les résultats sont les mêmes qu'en
série. **Auto** (par défaut) utilise autant de threads que de processeurs permis dans les
préférences de PixInsight, dans la limite de la mémoire disponible (chaque thread garde une brute
en mémoire) ; **1** détecte en série. Se règle dans le dialogue, utilisé par le pipeline builder
de WBPP.

## Prérequis

* PixInsight 1.9.6 ou plus (le builder est testé avec WBPP 3.2.0).
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
3. *Script > JPS > ClarkeMask* (*Script > Utilities* jusqu'à la 0.2.3). Le pipeline builder de WBPP `ClarkeMask-PipelineBuilder.js` est
   installé dans le même dossier ; son chemin est affiché en bas du dialogue.

Ou télécharger le dossier `scripts/` et lancer `ClarkeMask.js` par *Script > Execute Script File*
(`ClarkeMask.js`, `ClarkeMaskCore.js` et `ClarkeMaskEngine.js` doivent rester ensemble ;
`ClarkeMask-PipelineBuilder.js` n'a besoin de rien d'autre).

## Utilisation

**Avec WBPP** (copies masquées des brutes registrées, utilisées par la normalisation locale,
l'intégration et le drizzle de WBPP) :

1. Lancer une fois *Script > JPS > ClarkeMask* pour vérifier les réglages ; le dialogue
   affiche le chemin du pipeline builder.
2. Dans WBPP, *Pipeline > Pipeline builder* : l'activer et choisir `ClarkeMask-PipelineBuilder.js`
   dans le dossier de ClarkeMask. Le panneau Pipeline montre alors une étape *ClarkeMask masking*
   après chaque registration. Laisser *Event Script* décoché.
3. Lancer WBPP comme d'habitude. Masques, carte de couverture, rapports et journal sont dans
   `<sortie WBPP>/ClarkeMask/`.

Une copie masquée de chaque brute qui a des traînées est écrite dans
`<sortie WBPP>/ClarkeMask/copies/`, avec ses propres données drizzle, et la suite de WBPP l'utilise ;
les brutes registrées de WBPP ne sont pas modifiées. Une dernière étape supprime les copies
d'images ; leurs fichiers `.xdrz` et `.xnml` restent. **Espace disque :** pendant le passage, une
copie complète par brute masquée. Les traînées géostationnaires touchent souvent toutes les brutes :
prévoir alors autant d'espace libre que les brutes registrées.

**Contrôles de sécurité.** En plus de l'interface documentée du pipeline builder de WBPP, le builder
s'appuie sur des parties de WBPP qui peuvent changer dans une future version : il les vérifie avant
de mettre quoi que ce soit en file, et vérifie les brutes avant de leur passer les copies. Si quelque
chose n'est pas comme prévu, si un groupe n'a pas de solution astrométrique, ou si une brute ne peut
pas être traitée, il arrête le passage avec un message dans la console, plutôt que de laisser WBPP
intégrer des brutes non masquées. Son journal indique la version de WBPP ; une version autre que
celle testée est signalée. À un deuxième passage avec les mêmes brutes, l'enregistrement vient du
cache de WBPP, mais la normalisation locale est recalculée.

**Seul** (*Script > JPS > ClarkeMask*), sur des brutes registrées ; les entrées ne sont
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

Copyright (c) 2026 Jacques Pouyaud. Publié sous
[licence publique générale GNU, version 3 ou ultérieure](LICENSE) (GPL-3.0-or-later) : il peut être
utilisé, étudié, partagé et modifié ; toute œuvre distribuée qui intègre ce code doit être publiée
sous la même licence, avec son code source. Les versions jusqu'à 0.2.1 ont été publiées sous licence
MIT, qui reste valable pour les copies de ces versions.

**Demande de crédit.** En cas de reprise de la méthode ou du code de ClarkeMask, dans un script, une
application ou un tutoriel, merci de le citer par son nom avec un lien vers ce dépôt. C'est une
demande, pas une condition de la licence ; quand le code lui-même est repris, la GPL impose déjà de
conserver la mention de copyright.

Rapports de bogues et suggestions bienvenus dans les issues GitHub.

*Code écrit par Claude (Anthropic), sous la direction de Jacques Pouyaud.*
