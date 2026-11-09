// lib/glossary.js: French words for the English a brain is mostly written in.
// Word matching cannot cross languages, so a question asked in French would
// miss notes written in English. Applied to the question only: the files and
// the index stay as they are. Accents and plurals are handled by the tokenizer.
//
// General working vocabulary, not a list of what any one brain contains.
'use strict';

module.exports = [
  // Actions
  ['ajouter', 'add'], ['appeler', 'call'], ['appliquer', 'apply'], ['arreter', 'stop'], ['bloquer', 'block blocked'], ['casser', 'break broken'],
  ['changer', 'change'], ['charger', 'load'], ['chercher', 'search find'], ['choisir', 'choose pick'], ['cliquer', 'click'], ['comparer', 'compare'],
  ['configurer', 'configure'], ['connecter', 'connect'], ['construire', 'build'], ['contenir', 'contain'], ['copier', 'copy'], ['corriger', 'fix correct'],
  ['couper', 'cut'], ['creer', 'create'], ['decider', 'decide'], ['demarrer', 'start'], ['deplacer', 'move'], ['deployer', 'deploy'], ['detecter', 'detect'],
  ['disparaitre', 'disappear missing vanished'], ['disparu', 'missing disappears vanished'], ['echouer', 'fail'], ['ecrire', 'write'], ['effacer', 'delete erase'],
  ['empecher', 'prevent block'], ['enlever', 'remove'], ['enregistrer', 'save record'], ['envoyer', 'send upload'], ['essayer', 'try'], ['executer', 'run execute'],
  ['exporter', 'export'], ['fermer', 'close'], ['fusionner', 'merge'], ['generer', 'generate'], ['gerer', 'manage handle'], ['imprimer', 'print'], ['importer', 'import'],
  ['installer', 'install'], ['lancer', 'launch start run'], ['lire', 'read'], ['manquer', 'missing'], ['mesurer', 'measure'], ['modifier', 'edit change'], ['montrer', 'show'],
  ['mettre', 'put set'], ['nettoyer', 'clean'], ['ouvrir', 'open'], ['oublier', 'forget'], ['partager', 'share'], ['perdre', 'lose lost'], ['planter', 'crash'], ['plante', 'crash crashed'],
  ['pousser', 'push'], ['prouver', 'prove'], ['publier', 'publish'], ['ranger', 'store'], ['recevoir', 'receive'], ['redemarrer', 'restart'], ['refuser', 'refuse refused'],
  ['regenerer', 'regenerate'], ['relancer', 'restart rerun retry'], ['relire', 'review'], ['remplacer', 'replace'], ['renommer', 'rename'], ['renouveler', 'renew'],
  ['repartir', 'restart relaunch'], ['repondre', 'answer respond reply'], ['resoudre', 'solve resolve'], ['retirer', 'remove'], ['revenir', 'return revert'], ['sauvegarder', 'save backup'],
  ['signer', 'sign'], ['supprimer', 'delete remove'], ['surcharger', 'override'], ['tester', 'test'], ['tourner', 'run'], ['traduire', 'translate'], ['trouver', 'find'],
  ['utiliser', 'use'], ['valider', 'validate approve'], ['verifier', 'check verify'], ['voir', 'see'],

  // Things
  ['abandon', 'retired retirement dnf'], ['abandonner', 'retire retired'], ['abonnement', 'subscription'], ['adresse', 'address'], ['affichage', 'display'], ['afficher', 'display show render'],
  ['annonce', 'listing posting'], ['annonces', 'listings postings'], ['appli', 'app'], ['application', 'app application'], ['arbre', 'tree'], ['avertissement', 'warning'],
  ['bail', 'lease'], ['barre', 'bar'], ['base', 'base database'], ['boite', 'box'], ['bonus', 'bonus'], ['boutique', 'shop store'], ['branche', 'branch'], ['brouillon', 'draft'],
  ['cache', 'cache'], ['carte', 'card map'], ['chemin', 'path'], ['cible', 'target'], ['clavier', 'keyboard'], ['cle', 'key'], ['client', 'client customer'], ['code', 'code'],
  ['commande', 'command order'], ['composant', 'component'], ['compte', 'account'], ['conflit', 'conflict'], ['contrat', 'contract'], ['couleur', 'color colour'], ['courriel', 'email'],
  ['degrade', 'gradient'], ['demande', 'request'], ['depot', 'repository repo'], ['dossier', 'folder directory'], ['droit', 'right'], ['droits', 'rights permissions'], ['ecran', 'screen'],
  ['echec', 'failure'], ['entreprise', 'company'], ['entretien', 'interview'], ['environnement', 'environment'], ['equipe', 'team'], ['erreur', 'error'], ['espace', 'space'], ['etape', 'step'],
  ['etat', 'state status'], ['fenetre', 'window'], ['fichier', 'file'], ['fichiers', 'files'], ['fil', 'thread'], ['fond', 'background'], ['grille', 'grid'], ['hauteur', 'height'],
  ['identifiant', 'id identifier'], ['image', 'image'], ['journal', 'journal log'], ['largeur', 'width'], ['lien', 'link'], ['ligne', 'line'], ['liste', 'list'], ['logiciel', 'software'],
  ['longueur', 'length'], ['machine', 'machine'], ['marque', 'brand'], ['memoire', 'memory'], ['message', 'message'], ['mission', 'mission'], ['modele', 'model template'], ['module', 'module'],
  ['navigateur', 'browser'], ['niveau', 'level'], ['nom', 'name'], ['note', 'note'], ['outil', 'tool'], ['outils', 'tools'], ['page', 'page'], ['paiement', 'payment'], ['panneau', 'panel'],
  ['parametre', 'parameter setting'], ['parametres', 'settings parameters'], ['patron', 'boss'], ['pilote', 'driver'], ['piste', 'track'], ['plainte', 'complaint'], ['poste', 'role position'],
  ['prix', 'price'], ['probleme', 'problem issue'], ['projet', 'project'], ['question', 'question'], ['recette', 'recipe'], ['reponse', 'answer response'], ['reseau', 'network'], ['role', 'role'],
  ['salaire', 'salary'], ['sauvegarde', 'backup'], ['serveur', 'server'], ['signature', 'signature'], ['site', 'site website'], ['style', 'style'], ['tableau', 'table board'], ['tache', 'task'],
  ['taille', 'size'], ['test', 'test'], ['texte', 'text'], ['titre', 'title headline'], ['tour', 'lap'], ['utilisateur', 'user'], ['valeur', 'value'], ['verrou', 'lock'], ['version', 'version'],
  ['vitesse', 'speed'], ['voiture', 'car'],

  // Qualities and states
  ['ancien', 'old'], ['ancienne', 'old'], ['automatique', 'automatic'], ['bloque', 'blocked stuck'], ['casse', 'broken'], ['clair', 'plain clear'], ['complet', 'complete full'], ['coupe', 'cut'],
  ['dernier', 'last latest'], ['derniere', 'last latest'], ['doublon', 'duplicate'], ['ferme', 'closed'], ['final', 'final trailing'], ['finale', 'final trailing'], ['gratuit', 'free'],
  ['lent', 'slow'], ['libre', 'free'], ['local', 'local'], ['nouveau', 'new'], ['nouvelle', 'new'], ['obligatoire', 'required mandatory'], ['ouvert', 'open'], ['pleine', 'solid full'], ['plein', 'solid full'],
  ['premier', 'first'], ['premiere', 'first'], ['prive', 'private'], ['public', 'public'], ['rapide', 'fast quick'], ['requis', 'required'], ['seul', 'only alone'], ['silencieux', 'silent silently'],
  ['vide', 'empty'], ['vieux', 'old stale'], ['visible', 'visible'],

  // Phrases
  ['mot de passe', 'password'], ['mise a jour', 'upgrade update'], ['mises a jour', 'upgrades updates'], ['mise en ligne', 'deploy launch'], ['mise en production', 'deploy production'],
  ['base de donnees', 'database'], ['ligne de commande', 'command line'], ['pull request', 'pull request'], ['point virgule', 'semicolon'], ['bac a sable', 'sandbox'], ['nom de domaine', 'domain'],
  ['en prod', 'production'], ['en production', 'production'], ['droit de travail', 'right to work work authorization'], ['teletravail', 'remote'], ['sur site', 'onsite office'],
];
