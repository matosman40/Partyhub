/**
 * Amorce des banques de BOUM ! : 10 entrées par type et par niveau, écrites pour ce jeu.
 * Au premier démarrage, elles sont insérées en « à valider » et passent par le même moteur
 * de validation que l’import : une ligne qui ne passerait pas serait signalée au démarrage.
 * Format : type ; niveau ; texte ; réponse (facultative). Aucune ligne ne reprend un jeu existant.
 */
export const SEED_TEXT = `
# Phrases à trous
phrase_trous ; doux ; Pour sa retraite, le maire a offert ___ à tout le village.
phrase_trous ; doux ; Le dimanche, mon grand-père rêve de ___ dans son jardin.
phrase_trous ; doux ; En cas d’urgence, ouvrez ___ et surtout ne touchez pas à ___.
phrase_trous ; doux ; La cantine a servi ___ accompagné de ___ en guise de dessert.
phrase_trous ; doux ; Mon chat réclame ___ chaque matin à six heures.
phrase_trous ; doux ; Le prof a confisqué ___ puis il l’a mangé en classe.
phrase_trous ; doux ; Au mariage, la mariée a lancé ___ au lieu du bouquet.
phrase_trous ; doux ; Pour le goûter, les enfants préfèrent ___ à ___.
phrase_trous ; doux ; Le guide touristique recommande ___ pendant la visite du château.
phrase_trous ; doux ; Dans la notice, on lit : ___ n’est pas un jouet.
phrase_trous ; corse ; Ce soir, la voisine a organisé un concours de ___ dans le hall.
phrase_trous ; corse ; Le président de l’association a démissionné après ___.
phrase_trous ; corse ; Au supermarché, quelqu’un a glissé ___ dans le caddie de ___.
phrase_trous ; corse ; La météo annonce ___ suivi de ___ pour tout le week-end.
phrase_trous ; corse ; Le DJ a passé ___ pendant que le public réclamait ___.
phrase_trous ; corse ; Mon oncle prétend avoir survécu à ___ grâce à ___.
phrase_trous ; corse ; Le cours de yoga s’est terminé par ___ et une poignée de ___.
phrase_trous ; corse ; Le bulletin de l’élève mentionne ___ et une tendance à ___.
phrase_trous ; corse ; Dans le nouveau jeu vidéo, il faut éviter ___ et récupérer ___.
phrase_trous ; corse ; Le chef a refusé de servir ___ tant qu’on n’avait pas goûté ___.
phrase_trous ; limite ; La sorcière a jeté ___ dans la marmite, puis elle a demandé ___.
phrase_trous ; limite ; Le fantôme du château se plaint toujours de ___ et de ___.
phrase_trous ; limite ; Le vampire a refusé le menu : ___ n’était pas assez ___.
phrase_trous ; limite ; Dans la forêt, le loup a acheté ___ au marché noir.
phrase_trous ; limite ; Le zombie a juré qu’il ne mangerait plus jamais ___.
phrase_trous ; limite ; Le médecin de la sorcière a prescrit ___ et trois jours de ___.
phrase_trous ; limite ; Le roi a fait enfermer ___ pour avoir chanté ___ trop fort.
phrase_trous ; limite ; Le monstre du placard exige ___ avant de rendre ___.
phrase_trous ; limite ; Le pirate a enterré ___ au pied de ___, sans carte.
phrase_trous ; limite ; L’extraterrestre demande qu’on lui apporte ___ et une vieille ___.
# Cartes réponse
carte_reponse ; doux ; une otarie un peu trop bourrée
carte_reponse ; doux ; un hérisson qui fait du yoga
carte_reponse ; doux ; le slip de grand-père
carte_reponse ; doux ; une fourchette très sérieuse
carte_reponse ; doux ; un poulet en costume
carte_reponse ; doux ; trois pingouins qui dansent le tango
carte_reponse ; doux ; une chaussette orpheline
carte_reponse ; doux ; un canard qui réclame son bain
carte_reponse ; doux ; le ronflement d’un chameau
carte_reponse ; doux ; une pizza qui parle avec l’accent du Sud
carte_reponse ; corse ; un sandwich qui a trop de fromage
carte_reponse ; corse ; la tante qui met du sel partout
carte_reponse ; corse ; un aspirateur jaloux
carte_reponse ; corse ; une licorne qui fait du skate
carte_reponse ; corse ; le GPS perdu dans la cuisine
carte_reponse ; corse ; un ours en peluche qui donne des conseils boursiers
carte_reponse ; corse ; un vieux four qui chante en italien
carte_reponse ; corse ; une tortue en retard à son propre anniversaire
carte_reponse ; corse ; la mamie qui gagne toujours au Scrabble
carte_reponse ; corse ; un troupeau de moutons à la discothèque
carte_reponse ; limite ; une sorcière qui vend des verrues en ligne
carte_reponse ; limite ; le fantôme qui laisse des avis négatifs
carte_reponse ; limite ; un dragon qui a peur des souris
carte_reponse ; limite ; une momie en retard de trois mille ans
carte_reponse ; limite ; un vampire allergique aux pâtes
carte_reponse ; limite ; un monstre du placard en pantoufles
carte_reponse ; limite ; le zombie qui fait son régime
carte_reponse ; limite ; un squelette qui oublie ses clés
carte_reponse ; limite ; une araignée qui a le vertige
carte_reponse ; limite ; un troll qui fait la grasse matinée
# Situations (Détecteur de mauvaise foi)
situation ; doux ; Tu as mangé la dernière part de gâteau, puis tu as dit que c’était le chat.
situation ; doux ; Tu as dit à ta mère que tu étais à la bibliothèque, alors que tu étais au cinéma.
situation ; doux ; Tu as juré que tu savais faire du vélo sans les mains, puis tu es tombé dans un buisson.
situation ; doux ; Tu as envoyé un message à la mauvaise personne : c’était pour ton chef.
situation ; doux ; Tu arrives en retard à ton propre mariage, mais tu prétends que c’était voulu.
situation ; doux ; Tu as cassé le vase du salon, puis tu as accusé le vent.
situation ; doux ; Tu as promis de faire la vaisselle la semaine dernière, et tu attends que la pile soit haute.
situation ; doux ; Tu as rangé ta chambre en cachant tout sous le lit.
situation ; doux ; Tu prétends avoir lu le livre du club, alors que tu as vu le film.
situation ; doux ; Tu as dit que tu étais déjà à la fête, alors que tu n’as pas encore quitté ton canapé.
situation ; corse ; Tu as mis du sel dans le café de ton patron, en pensant que c’était du sucre.
situation ; corse ; Tu as laissé ton chien garer la voiture du voisin, c’était selon toi un accident.
situation ; corse ; Tu as repris trois fois le buffet en disant que c’était pour goûter.
situation ; corse ; Tu as affirmé que ta grand-mère t’avait appris le karaté.
situation ; corse ; Tu as gagné au loto de la kermesse avec un ticket que tu avais trouvé par terre.
situation ; corse ; Tu as fait exploser le micro-ondes avec un œuf dedans, et tu dis que c’était une expérience scientifique.
situation ; corse ; Tu as prétendu avoir couru le marathon, alors que tu as pris le bus.
situation ; corse ; Tu as donné ton numéro de téléphone à un inconnu pour qu’il te rende ton parapluie.
situation ; corse ; Tu as dit à la police que ton chat avait témoigné.
situation ; corse ; Tu as signé un bail sans le lire, et tu es désormais le propriétaire d’un canard.
situation ; limite ; Tu as fait croire à toute la classe que tu avais un fantôme dans ton sac à dos.
situation ; limite ; Tu as remplacé le sucre de la fête de famille par du sel, et tu fais semblant d’être surpris.
situation ; limite ; Tu prétends être l’arrière-petit-fils d’un pirate pour obtenir une table au restaurant.
situation ; limite ; Tu as vendu une vieille chaise comme un trésor royal, et l’acheteur y croit encore.
situation ; limite ; Tu as dit au concierge que tes chaussures étaient des monstres et qu’elles avaient besoin de dormir ici.
situation ; limite ; Tu as juré avoir vu un ovni au-dessus du parking, alors que c’était ton propre ballon de foot.
situation ; limite ; Tu as voulu faire la bise au chien de la voisine, et tu as embrassé la laitue.
situation ; limite ; Tu as menti sur ton âge pour entrer au zoo, et un koala t’a adopté.
situation ; limite ; Tu as fait un discours de mariage en confondant les deux mariés.
situation ; limite ; Tu as expliqué à ton banquier que tes économies étaient cachées dans un hamster.
# Sujets d’épitaphe
sujet_epitaphe ; doux ; un poisson rouge qui a trop vécu
sujet_epitaphe ; doux ; un réveil qui a toujours été en retard
sujet_epitaphe ; doux ; une chaussette orpheline
sujet_epitaphe ; doux ; un grille-pain qui a tout grillé
sujet_epitaphe ; doux ; la dernière part de pizza
sujet_epitaphe ; doux ; un parapluie qui n’a jamais plu
sujet_epitaphe ; doux ; un chat qui méritait mieux
sujet_epitaphe ; doux ; le wifi du café du coin
sujet_epitaphe ; doux ; un gâteau qui n’a pas survécu à l’anniversaire
sujet_epitaphe ; doux ; une plante arrosée au café
sujet_epitaphe ; corse ; un ami qui disait toujours « on verra demain »
sujet_epitaphe ; corse ; le GPS qui nous a menés au bord de la mer
sujet_epitaphe ; corse ; le voisin qui chantait sous la douche à quatre heures
sujet_epitaphe ; corse ; un tupperware disparu au fond du frigo
sujet_epitaphe ; corse ; un vieux dentiste très sympa
sujet_epitaphe ; corse ; l’ordinateur qui ne marchait que sur le ventre
sujet_epitaphe ; corse ; la clé de la voiture, restée dans la voiture
sujet_epitaphe ; corse ; le cousin qui racontait toujours la même blague
sujet_epitaphe ; corse ; le dernier concombre du potager
sujet_epitaphe ; corse ; une imprimante qui n’a jamais rien imprimé
sujet_epitaphe ; limite ; une sorcière qui ne lisait jamais le mode d’emploi
sujet_epitaphe ; limite ; un vampire qui détestait le soleil et les pâtes
sujet_epitaphe ; limite ; un fantôme trop timide pour hanter
sujet_epitaphe ; limite ; un dragon qui faisait des crêpes
sujet_epitaphe ; limite ; une momie qui voulait partir en vacances
sujet_epitaphe ; limite ; un monstre du placard qui avait peur du noir
sujet_epitaphe ; limite ; un zombie qui n’a jamais réussi son régime
sujet_epitaphe ; limite ; un squelette qui oubliait de rire
sujet_epitaphe ; limite ; un troll qui ronflait sous son pont
sujet_epitaphe ; limite ; un loup qui avait juré d’arrêter les moutons
# Situations à conseiller (Le pire conseil)
situation_conseil ; doux ; Ton voisin te demande comment réparer son grille-pain.
situation_conseil ; doux ; Ta sœur veut cuisiner des pâtes pour la première fois.
situation_conseil ; doux ; Ton ami veut passer un entretien d’embauche déguisé en pingouin.
situation_conseil ; doux ; Un enfant te demande comment dessiner un bon chien.
situation_conseil ; doux ; Ta cousine hésite à offrir un hamster pour son anniversaire.
situation_conseil ; doux ; Ton collègue veut impressionner le chef pendant la réunion.
situation_conseil ; doux ; Tu veux arrêter les bonbons avant le repas.
situation_conseil ; doux ; Ton père veut apprendre à envoyer un message pour la première fois.
situation_conseil ; doux ; Ton amie veut dormir dans le jardin en plein hiver.
situation_conseil ; doux ; Tu dois faire une présentation sans avoir préparé la moindre diapositive.
situation_conseil ; corse ; Ton voisin veut déménager dans la forêt pour ne plus voir personne.
situation_conseil ; corse ; Ton ami se demande s’il peut manger le sapin une fois les fêtes finies.
situation_conseil ; corse ; Tu veux réparer la machine à laver avec une fourchette et beaucoup de culot.
situation_conseil ; corse ; Ton patron veut envoyer un courriel à toute l’équipe à trois heures du matin.
situation_conseil ; corse ; Ta mamie veut faire un saut en parachute pour ses cent ans.
situation_conseil ; corse ; Ton frère veut cacher la télécommande dans le congélateur pour gagner du temps.
situation_conseil ; corse ; Tu veux faire la sieste pendant ton examen de conduite.
situation_conseil ; corse ; Ton cousin veut dire à la factrice qu’il l’adore, en plein mariage.
situation_conseil ; corse ; Ta voisine veut apprendre le piano en jouant avec les pieds.
situation_conseil ; corse ; Tu vas au mariage de ton ex en tenue de pompier.
situation_conseil ; limite ; Le fantôme de ta grand-mère veut repeindre le salon en rose fluo.
situation_conseil ; limite ; Ton colocataire vampire veut organiser une fête pour fêter son bronzage.
situation_conseil ; limite ; Le monstre du placard veut emménager dans ton frigo à cause du chauffage.
situation_conseil ; limite ; Un sorcier veut lancer une crème anti-rides pour grenouilles.
situation_conseil ; limite ; Un loup te demande de garder ses moutons pendant les vacances.
situation_conseil ; limite ; Le roi veut interdire les chaussettes dépareillées dans tout le royaume.
situation_conseil ; limite ; Une momie veut ouvrir un restaurant qui ne sert que du pain sec.
situation_conseil ; limite ; Le dragon veut entrer au club de yoga, mais il crache du feu pendant les postures.
situation_conseil ; limite ; Un troll te propose d’échanger ton pont contre un abonnement de sport.
situation_conseil ; limite ; Un zombie veut se marier et te demande de choisir les fleurs.
# Citations (Qui a dit ça ?)
citation ; doux ; Je ne suis pas en retard, je suis en avance sur demain.
citation ; doux ; Le chocolat, c’est comme les amis : on n’en a jamais assez.
citation ; doux ; Ce n’est pas un pull moche, c’est un pull qui réfléchit.
citation ; doux ; Je fais du sport : je cours après mes bonnes idées.
citation ; doux ; Mon GPS dit que je suis arrivé, mais je suis encore dans la voiture.
citation ; doux ; Si la vie te donne des citrons, demande du sel et un peu de tequila.
citation ; doux ; Je ne ronfle pas, je joue de la trompette dans mon sommeil.
citation ; doux ; Ce n’est pas que je dors, c’est que mes yeux prennent des vacances.
citation ; doux ; J’ai promis à mon chat de faire la vaisselle, et il m’a cru.
citation ; doux ; Ce poulet a l’air sûr de lui, il a déjà une recette.
citation ; corse ; J’ai réussi à ouvrir le bocal, mais le couvercle a gagné.
citation ; corse ; La cuisine est une science, et moi je suis le laboratoire explosif.
citation ; corse ; Je ne mange pas trop vite, je mange juste plusieurs choses à la fois.
citation ; corse ; Mon pain est si dur qu’il tient debout tout seul.
citation ; corse ; Je n’ai pas mangé le gâteau, il est parti tout seul dans mon ventre.
citation ; corse ; Les chiens sont les meilleurs amis de l’homme, et les pires voleurs de chaussettes.
citation ; corse ; La balance dit que j’ai maigri, c’est sûrement la balance qui ment.
citation ; corse ; Mon sens de l’orientation est excellent : je me perds exactement là où je voulais aller.
citation ; corse ; Ce n’est pas un ronflement, c’est une alarme anti-cambrioleurs.
citation ; corse ; Le tiramisu prouve que la vie est juste : même les desserts sont pleins de café.
citation ; limite ; Mon fantôme de compagnie me réveille tous les soirs pour se plaindre de sa vie.
citation ; limite ; Je ne suis pas un vampire, je suis juste très pâle et très affamé de pâtes.
citation ; limite ; Le dragon de mon voisin a brûlé ma pelouse, mais le gazon repousse toujours.
citation ; limite ; La sorcière m’a dit que mon avenir était flou, je pense qu’elle a besoin de lunettes.
citation ; limite ; Le troll sous le pont veut une mutuelle, il dit que c’est pour sa santé.
citation ; limite ; Les zombies ont raison, la salade c’est trop bon pour être vrai.
citation ; limite ; Un squelette m’a dit qu’il avait tout perdu, sauf sa bonne humeur.
citation ; limite ; Le monstre du placard porte des chaussons, parce que le plancher est froid.
citation ; limite ; La momie a raté son train, elle dit que ça fait trois mille ans qu’elle attend.
citation ; limite ; Le loup a juré qu’il ne soufflerait plus sur les maisons, seulement sur les crêpes.
# Questions (Réponse rapide)
question ; doux ; Quelle est la capitale du Canada ? ; Ottawa
question ; doux ; Quel fruit sert à faire le cidre ? ; pomme
question ; doux ; De quelle couleur est le ciel par temps clair ? ; bleu
question ; doux ; Quel est le plus grand océan du monde ? ; Pacifique
question ; doux ; Quel animal fait « cocorico » ? ; coq
question ; doux ; Quelle est la monnaie du Japon ? ; yen
question ; doux ; Dans quel pays se trouve la tour Eiffel ? ; France
question ; doux ; Quel instrument a des touches noires et blanches ? ; piano
question ; doux ; Quel est le contraire de « chaud » ? ; froid
question ; doux ; Quel est l’animal terrestre le plus rapide ? ; guépard
question ; corse ; Qui a peint La Joconde ? ; Léonard de Vinci
question ; corse ; Quelle planète est surnommée la planète rouge ? ; Mars
question ; corse ; Quel est le plus petit pays du monde ? ; Vatican
question ; corse ; Quel explorateur a atteint l’Amérique en 1492 ? ; Christophe Colomb
question ; corse ; Quel est le plus grand désert chaud du monde ? ; Sahara
question ; corse ; Quelle est la capitale de l’Australie ? ; Canberra
question ; corse ; Quel écrivain a imaginé le capitaine Nemo ? ; Jules Verne
question ; corse ; Dans quelle ville se trouve la statue de la Liberté ? ; New York
question ; corse ; Quel est le symbole chimique de l’or ? ; Au
question ; corse ; Quel est le plus grand mammifère terrestre ? ; éléphant
# Questions chiffrées (Combien ?)
question_chiffre ; doux ; Combien de pattes a une araignée ? ; 8
question_chiffre ; doux ; Combien de cordes compte une guitare classique ? ; 6
question_chiffre ; doux ; Combien de joueurs par équipe sur un terrain de football ? ; 11
question_chiffre ; doux ; Combien de jours y a-t-il dans une semaine ? ; 7
question_chiffre ; doux ; Combien de côtés a un hexagone ? ; 6
question_chiffre ; doux ; Combien de roues a un tricycle ? ; 3
question_chiffre ; doux ; Combien de minutes dans une heure ? ; 60
question_chiffre ; doux ; Combien de doigts a une personne, mains et pieds comptés ? ; 20
question_chiffre ; doux ; Combien de faces a un dé classique ? ; 6
question_chiffre ; doux ; Combien de lettres compte l’alphabet français ? ; 26
question_chiffre ; corse ; Combien de dents a un adulte, dents de sagesse incluses ? ; 32
question_chiffre ; corse ; Combien de cœurs a une pieuvre ? ; 3
question_chiffre ; corse ; Combien d’os compte le corps humain adulte ? ; 206
question_chiffre ; corse ; Combien de jours dure une année bissextile ? ; 366
question_chiffre ; corse ; Combien de cases compte un échiquier ? ; 64
question_chiffre ; corse ; Combien de bras a une pieuvre ? ; 8
question_chiffre ; corse ; Combien de cartes compte un jeu de 52 cartes sans les jokers ? ; 52
question_chiffre ; corse ; Combien de sommets a un cube ? ; 8
question_chiffre ; corse ; Combien de côtés a un ennéagone ? ; 9
question_chiffre ; corse ; Combien de cartes a-t-on en main au tarot à quatre joueurs ? ; 18
# Indices de pays (Où est-ce ?)
pays_indice ; doux ; Sa capitale est Ottawa. ; CA
pays_indice ; doux ; Sa capitale est Rome, et son drapeau est vert, blanc et rouge. ; IT
pays_indice ; doux ; Sa capitale est Tokyo. ; JP
pays_indice ; doux ; Ce pays est célèbre pour ses kangourous et son opéra à Sydney. ; AU
pays_indice ; doux ; Sa capitale est Brasília. ; BR
pays_indice ; doux ; Ses glaciers attirent les touristes, et sa capitale est Reykjavik. ; IS
pays_indice ; doux ; Son fromage le plus connu est le gouda. ; NL
pays_indice ; doux ; Sa capitale est Madrid. ; ES
pays_indice ; doux ; Ce pays est célèbre pour son tango et ses pampas. ; AR
pays_indice ; doux ; Sa capitale est Berlin. ; DE
pays_indice ; corse ; Le sirop d’érable est sa spécialité, et son hiver est très long. ; CA
pays_indice ; corse ; Ce pays a la plus grande barrière de corail du monde au large de sa côte nord-est. ; AU
pays_indice ; corse ; Le Machu Picchu se trouve sur son territoire. ; PE
pays_indice ; corse ; Les pyramides de Gizeh se trouvent sur son territoire. ; EG
pays_indice ; corse ; Il a trois capitales, dont Pretoria. ; ZA
pays_indice ; corse ; Le Kremlin se trouve dans sa capitale, Moscou. ; RU
pays_indice ; corse ; Le Taj Mahal se trouve sur son territoire. ; IN
pays_indice ; corse ; Le Kilimandjaro se trouve sur son territoire. ; TZ
pays_indice ; corse ; Le Mont Everest se trouve entre ce pays et la Chine. ; NP
pays_indice ; corse ; Sa capitale est Ankara. ; TR
# Mots secrets
mot_secret ; doux ; un trombone
mot_secret ; doux ; une banane qui glisse
mot_secret ; doux ; un sandwich au fromage
mot_secret ; doux ; une pantoufle
mot_secret ; doux ; un parapluie
mot_secret ; doux ; une tortue
mot_secret ; doux ; un vélo
mot_secret ; doux ; un chat
mot_secret ; doux ; une crêpe
mot_secret ; doux ; un hamster
mot_secret ; corse ; un aspirateur
mot_secret ; corse ; une guitare
mot_secret ; corse ; un pingouin
mot_secret ; corse ; une cuillère géante
mot_secret ; corse ; un frigo
mot_secret ; corse ; une sirène
mot_secret ; corse ; une montgolfière
mot_secret ; corse ; un hérisson
mot_secret ; corse ; un robot
mot_secret ; corse ; un poisson rouge
# Consignes photo
consigne_photo ; doux ; Prenez la pose d’un chat qui déteste le lundi.
consigne_photo ; doux ; Faites la photo la plus sérieuse possible avec une chaussette sur la tête.
consigne_photo ; doux ; Imitez une statue de la place du village, en équilibre sur une chaise.
consigne_photo ; doux ; Faites un selfie avec la personne la plus grande de la pièce.
consigne_photo ; doux ; Prenez en photo quelque chose de rond dans la pièce.
consigne_photo ; doux ; Montrez comment vous dormiriez sur un nuage.
consigne_photo ; doux ; Faites la grimace d’un sandwich qui vient d’être mordu.
consigne_photo ; doux ; Prenez la pose du plus grand explorateur de la cuisine.
consigne_photo ; doux ; Photographiez-vous en train de commander un café avec le regard d’un détective.
consigne_photo ; doux ; Faites la photo d’une attente de bus, avec la classe d’un roi.
consigne_photo ; corse ; Prenez la pose d’un champion olympique de la lenteur.
consigne_photo ; corse ; Faites une photo où vous avez l’air de cacher un secret énorme.
consigne_photo ; corse ; Imitez une gargouille qui surveille le frigo.
consigne_photo ; corse ; Faites la photo d’un bonhomme de neige en plein mois d’août.
consigne_photo ; corse ; Prenez la pose de quelqu’un qui vient de gagner un concours de tarte au citron.
consigne_photo ; corse ; Prenez la pose d’un superhéros qui a oublié son costume.
consigne_photo ; corse ; Faites la photo d’un animal imaginaire qui hésite à traverser la rue.
consigne_photo ; corse ; Imitez un ballon de baudruche au moment où on le gonfle trop.
consigne_photo ; corse ; Faites la pose du voyageur qui a raté son train au bord du quai.
consigne_photo ; corse ; Montrez le visage de quelqu’un qui découvre que le dessert est une salade.
# Thèmes de galerie
theme_galerie ; doux ; Des chaussettes
theme_galerie ; doux ; Les pieds
theme_galerie ; doux ; Des objets ronds
theme_galerie ; doux ; Des choses qui volent
theme_galerie ; doux ; Des chapeaux
theme_galerie ; doux ; Les dessins animés du matin
theme_galerie ; doux ; Des animaux qui font la sieste
theme_galerie ; doux ; Des cuisines en désordre
theme_galerie ; doux ; Des parapluies
theme_galerie ; doux ; Des nez
theme_galerie ; corse ; Les mauvais cadeaux
theme_galerie ; corse ; Les jouets cassés
theme_galerie ; corse ; Des visages surpris
theme_galerie ; corse ; Les objets qu’on ne retrouve jamais
theme_galerie ; corse ; Les vieux téléphones
theme_galerie ; corse ; Des fourchettes en action
theme_galerie ; corse ; Les pires coiffures de l’année
theme_galerie ; corse ; Les animaux qui ont l’air coupables
theme_galerie ; corse ; Les restes du frigo
theme_galerie ; corse ; Des bouteilles vides après une fête
# Chansons à chanter (titre ; artiste ou film)
chanson ; doux ; Happy ; Pharrell Williams
chanson ; doux ; Dancing Queen ; ABBA
chanson ; doux ; Hey Jude ; The Beatles
chanson ; doux ; Thriller ; Michael Jackson
chanson ; doux ; Shape of You ; Ed Sheeran
chanson ; doux ; Ça plane pour moi ; Plastic Bertrand
chanson ; doux ; Hotel California ; Eagles
chanson ; doux ; Like a Prayer ; Madonna
chanson ; doux ; Yellow Submarine ; The Beatles
chanson ; doux ; Get Lucky ; Daft Punk
chanson ; corse ; Lose Yourself ; Eminem
chanson ; corse ; Smells Like Teen Spirit ; Nirvana
chanson ; corse ; Mr. Brightside ; The Killers
chanson ; corse ; Bohemian Rhapsody ; Queen
chanson ; corse ; Gangnam Style ; PSY
chanson ; corse ; Stayin' Alive ; Bee Gees
chanson ; corse ; La Vie en rose ; Édith Piaf
chanson ; corse ; Non, je ne regrette rien ; Édith Piaf
chanson ; corse ; Uptown Funk ; Mark Ronson / Bruno Mars
chanson ; corse ; Macarena ; Los del Río
# Métiers à mimer
metier ; doux ; pompier
metier ; doux ; berger
metier ; doux ; boulanger
metier ; doux ; dentiste
metier ; doux ; jongleur
metier ; doux ; pêcheur
metier ; doux ; clown
metier ; doux ; astronaute
metier ; doux ; facteur
metier ; doux ; coiffeur
metier ; corse ; chef cuisinier
metier ; corse ; pilote de ligne
metier ; corse ; vétérinaire
metier ; corse ; professeur de danse
metier ; corse ; maître nageur
metier ; corse ; magicien
metier ; corse ; bûcheron
metier ; corse ; plombier
metier ; corse ; chanteur d’opéra
metier ; corse ; dresseur de pigeons
`.trim();
